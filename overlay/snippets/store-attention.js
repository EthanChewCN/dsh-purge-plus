  /* ---------- [dsh-purge-plus] 子智能体回报与「现在在等谁」 ---------- */

  /**
   * 从子智能体回报正文里抽 `redteamReport: {...}`。
   *
   * 为什么在代码里解析而不是只写提示词：判断「现在在等谁」必须依据结构化事实。
   * 靠读自然语言猜「它是不是在等人」，会把「报告里提到『等待』」也算成在等人，
   * 队列于是永远非空、同一段提示词每轮重新发一遍。解析失败返回 null —— 不猜。
   *
   * 接受两种写法（提示词写的是第一种，模型常写成第二种）：
   *   redteamReport: { status: waiting, blocked_reason: "...", needs: [...] }
   *   redteamReport: { "status": "waiting", ... }
   */
  parseAgentReport(text) {
    const raw = String(text ?? '')
    const at = raw.lastIndexOf('redteamReport')
    if (at < 0) return null
    const tail = raw.slice(at + 'redteamReport'.length)
    const brace = tail.indexOf('{')
    if (brace < 0) return null
    /* 只切到配对的那个右括号：正文里可能还有别的 JSON */
    let depth = 0
    let end = -1
    for (let i = brace; i < tail.length; i += 1) {
      const ch = tail[i]
      if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) { end = i; break }
      }
    }
    if (end < 0) return null
    const body = tail.slice(brace, end + 1)
    let obj = null
    try { obj = JSON.parse(body) } catch {
      /* 模型常写 `{ status: waiting }` 这种伪 JSON：键和裸值都没引号。
         严格解析失败就退化成按字段抽，只认这几个键，抽不到就是 null。 */
      obj = {}
      const field = (key) => {
        /* 第三组排除 `[`：`needs: [凭证]` 这种写法若让 `[` 混进来，
           整段会变成一条以方括号开头的"字符串"，看着解析成功、detail 里却多个 '['。 */
        const m = body.match(new RegExp('["\']?' + key + '["\']?\\s*:\\s*(?:"([^"]*)"|\'([^\']*)\'|([^,}\\[\\]]+))', 'i'))
        if (!m) return undefined
        return (m[1] ?? m[2] ?? m[3] ?? '').trim()
      }
      const status = field('status')
      if (status !== undefined) obj.status = status
      const reason = field('blocked_reason')
      if (reason !== undefined) obj.blocked_reason = reason
      const needsText = field('needs')
      if (needsText !== undefined) {
        /* needs 可能是数组字面量，也可能是一句自然语言；能解析成数组就用，否则按一条字符串处理 */
        const arrAt = body.search(/["']?needs["']?\s*:\s*\[/i)
        let parsedNeeds
        if (arrAt >= 0) {
          const open = body.indexOf('[', arrAt)
          let depth2 = 0
          for (let i = open; i < body.length; i += 1) {
            if (body[i] === '[') depth2 += 1
            else if (body[i] === ']') {
              depth2 -= 1
              if (depth2 === 0) {
                try { parsedNeeds = JSON.parse(body.slice(open, i + 1)) } catch {
                  /* 数组里是裸中文/裸标识符（`[凭证, VPN]`）：按逗号切成多条，去掉每条的
                     引号与方括号，空项丢掉。不切的话整段会变成一个字符串，而调用方
                     期待的是数组 —— 面板会把一条 needs 渲染成一个长标签。 */
                  parsedNeeds = body.slice(open + 1, i)
                    .split(/[,，]/)
                    .map((x) => x.trim().replace(/^["'\s[]+|["'\s\]]+$/g, '').trim())
                    .filter(Boolean)
                }
                break
              }
            }
          }
        }
        obj.needs = Array.isArray(parsedNeeds) && parsedNeeds.length ? parsedNeeds : needsText
      }
      if (obj.status === undefined) return null
    }
    if (!obj || typeof obj !== 'object') return null
    const statuses = ['progress', 'waiting', 'ready', 'blocked', 'failed', 'dropped']
    const status = String(obj.status || '').trim().toLowerCase()
    if (!statuses.includes(status)) return null
    const needs = Array.isArray(obj.needs)
      ? obj.needs.map((n) => {
        if (typeof n === 'string') return { kind: 'other', detail: n }
        if (n && typeof n === 'object') return { kind: String(n.kind || 'other'), detail: String(n.detail || n.value || '') }
        return null
      }).filter(Boolean)
      : (typeof obj.needs === 'string' && obj.needs.trim() !== '' ? [{ kind: 'other', detail: obj.needs.trim() }] : [])
    return {
      status,
      blocked_reason: obj.blocked_reason === undefined || obj.blocked_reason === null ? '' : String(obj.blocked_reason),
      needs,
    }
  }

  /** 落一条回报（按靶标库，与覆盖度同库）。同一会话的历史只留最近 20 条。 */
  recordAgentReport(id, f = {}) {
    const sessionId = String(f.session_id || '').trim()
    if (sessionId === '') throw new Error('recordAgentReport: session_id 必填')
    const db = this.db(id)
    const status = String(f.status || '').trim()
    const statuses = ['progress', 'waiting', 'ready', 'blocked', 'failed', 'dropped']
    if (!statuses.includes(status)) throw new Error('agent report status 必须是 ' + statuses.join('/'))
    db.prepare('INSERT INTO agent_report(session_id, parent_session, role, label, status, blocked_reason, needs, summary, created_at) ' +
      'VALUES(?,?,?,?,?,?,?,?,?)').run(
      sessionId,
      f.parent_session === undefined || f.parent_session === null ? null : String(f.parent_session),
      f.role ?? null,
      f.label ?? null,
      status,
      f.blocked_reason ? String(f.blocked_reason) : null,
      Array.isArray(f.needs) && f.needs.length ? JSON.stringify(f.needs) : null,
      f.summary === undefined || f.summary === null ? null : String(f.summary).slice(0, 2000),
      nowIso(),
    )
    const reportId = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id)
    /* 同一会话的历史回报只留最近 20 条，防止长会话把库撑大。
       `ORDER BY id DESC` 保证**最新那条永远在里面** —— 这是这段裁剪不丢「有人在等」的
       前提：队列只认每个会话的最新一条，被挤掉的一定已经被更新的回报取代了。 */
    db.prepare('DELETE FROM agent_report WHERE session_id = ? AND id NOT IN ' +
      '(SELECT id FROM agent_report WHERE session_id = ? ORDER BY id DESC LIMIT 20)')
      .run(sessionId, sessionId)
    return { id: reportId, session_id: sessionId, status }
  }

  /**
   * 把回报从「有人在等」里摘出去。
   *
   * 三种用法，都只作用于**该会话最新一条**，不会牵连历史：
   *   { session_id } —— 我（主会话/人）已经处理了这一条；
   *   { ids: [...] }  —— 按行号精确摘；
   *   { all: true }   —— 整条队列收口。
   *
   * 不摘的后果是结构性的：`attentionQueue` 忠实返回最新回报，于是同一条
   * `waiting` 会被每一轮调用重新算成「有人在等」，提示词每次生成都一字不差，
   * 调用方一看长度没变就再发一次 —— 这就是那条消息反复进对话的根因。
   */
  acknowledgeAgentReports(id, opts = {}) {
    const db = this.db(id)
    const at = nowIso()
    const ids = Array.isArray(opts.ids)
      ? opts.ids.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
      : []
    if (ids.length > 0) {
      const stmt = db.prepare('UPDATE agent_report SET acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL')
      let changed = 0
      for (const n of ids) changed += Number(stmt.run(at, n).changes) || 0
      return { acknowledged: changed, at }
    }
    const sessionId = typeof opts.session_id === 'string' ? opts.session_id.trim() : ''
    if (sessionId !== '') {
      const row = db.prepare('SELECT id FROM agent_report WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(sessionId)
      if (!row) return { acknowledged: 0, at }
      const changed = Number(db.prepare('UPDATE agent_report SET acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL').run(at, row.id).changes) || 0
      return { acknowledged: changed, at }
    }
    if (opts.all === true) {
      const changed = Number(db.prepare('UPDATE agent_report SET acknowledged_at = ? WHERE acknowledged_at IS NULL').run(at).changes) || 0
      return { acknowledged: changed, at }
    }
    return { acknowledged: 0, at, error: '需要 session_id / ids / all 之一' }
  }

  /** 某父会话下最新的回报（每个子会话一条）。 */
  latestAgentReports(id, parentSession, opts = {}) {
    const db = this.db(id)
    const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200)
    const rows = db.prepare(
      'SELECT r.* FROM agent_report r ' +
      'JOIN (SELECT session_id, MAX(id) AS max_id FROM agent_report WHERE parent_session = ? GROUP BY session_id) m ' +
      'ON m.max_id = r.id ORDER BY r.id DESC LIMIT ?').all(String(parentSession), limit)
    return rows.map((r) => ({
      ...r,
      needs: (() => { try { return r.needs ? JSON.parse(r.needs) : [] } catch { return [] } })(),
    }))
  }

  /**
   * 「一次演练现在卡在等谁」—— 侧栏角标、悬浮提醒、智能体页卡片、redteam_attention
   * 工具四处共用这一份实现，谁都不许自己再写一套排序。
   *
   * 顺序：等人解答 > 等人验收 > 受阻/失败 > 在跑 > 排队 > 空闲。
   * 只算**未确认**的回报（`acknowledged_at IS NULL`）。
   *
   * 与 safe 的差异：`pending_coverage` 需要覆盖度引擎（hostNextActions /
   * assetNextActions），本包**尚未移植**。safe 的做法是直接调用，靠 TypeError
   * 被 try/catch 吞掉返回 0 —— 于是「覆盖度引擎没装」和「覆盖度真的收口了」
   * 打印同一个 0，调用方无法区分。这里改成显式能力探测，并把结论写进 note。
   */
  attentionQueue(id, opts = {}) {
    const db = this.db(id)
    /* 只取「每个会话的最新一条、且未确认」——在 SQL 里收窄，不把整表拉进 JS 再自己去重。
       与 safe 的差异：safe 是 `SELECT * FROM agent_report` 全表读出来再 Map 去重，
       会话一多就是每次都全表扫描；这里交给 SQLite 的 GROUP BY + 索引。 */
    const latestRows = (() => {
      try {
        return db.prepare(
          'SELECT r.* FROM agent_report r ' +
          'JOIN (SELECT session_id, MAX(id) AS max_id FROM agent_report GROUP BY session_id) m ' +
          'ON m.max_id = r.id WHERE r.acknowledged_at IS NULL').all()
      } catch { return [] }
    })()
    const ranked = { waiting: 0, ready: 1, blocked: 2, failed: 3, progress: 4, dropped: 5 }
    const items = []
    for (const r of latestRows) {
      const rank = ranked[r.status]
      if (rank === undefined || r.status === 'dropped') continue
      let needs = []
      try { needs = r.needs ? JSON.parse(r.needs) : [] } catch { needs = [] }
      const stage = r.status === 'waiting' ? 'person/answer'
        : r.status === 'ready' ? 'person/review'
          : r.status === 'blocked' ? 'person/blocked'
            : r.status === 'failed' ? 'person/failed'
              : 'working'
      items.push({
        session_id: r.session_id, role: r.role, label: r.label, status: r.status, stage,
        reason: r.blocked_reason || '', needs, at: r.created_at, rank,
      })
    }
    items.sort((a, b) => a.rank - b.rank || String(b.at || '').localeCompare(String(a.at || '')))
    /* 缺口也算「要人处理」：队列空了但覆盖度没收口，是系统问题不是人的问题，单独报。
       覆盖度引擎未移植时 available=false，note 里明说，不假装「收口了」。 */
    const coverage = (() => {
      const fns = ['hostNextActions', 'assetNextActions']
      const present = fns.filter((fn) => typeof this[fn] === 'function')
      if (present.length === 0) return { available: false, pending: 0 }
      let pending = 0
      for (const fn of present) {
        try { pending += Number(this[fn](id, { limit: 1 }).total) || 0 } catch { /* 单个失败不影响另一个 */ }
      }
      return { available: present.length === fns.length, pending }
    })()
    const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 100)
    const note = items.length === 0
      ? (coverage.pending > 0
        ? '没有智能体在等人，但还有 ' + coverage.pending + ' 个覆盖度缺口 —— 该派下一个智能体了。'
        : coverage.available
          ? '没有人等、也没有队列缺口：这一轮打完了。'
          : '没有人等。覆盖度引擎未移植，无法判断是否还有缺口 —— 这条结论只覆盖「智能体回报」这一路。')
      : '按「最需要人」排序；连带 needs 一次性列给用户，不要只转述报告。'
    return {
      total: items.length,
      awaiting_person: items.filter((x) => x.stage.startsWith('person/')).length,
      items: items.slice(0, limit),
      pending_coverage: coverage.pending,
      coverage_available: coverage.available,
      note,
    }
  }
