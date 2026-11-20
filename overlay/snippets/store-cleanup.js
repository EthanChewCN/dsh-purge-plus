  /* ---------- [dsh-purge-plus] P9 清理清单 ---------- */
  //
  // 演练结束前必须回答一个非技术问题：**我们留下了什么**。
  // webshell、自己注册的账号、上传的 payload、改过的配置、开的隧道 —— 这些不清理，
  // 靶标方的安全水位比演练前更差，报告写得再漂亮也是负分。
  //
  // 所以这张表不是「发现」，是「待办」：每条都有 status，收口前必须逐条给结论。

  static CLEANUP_KINDS = ['webshell', 'account', 'file', 'service', 'tunnel', 'config', 'other']
  static CLEANUP_STATUS = ['open', 'done', 'wontfix']

  /** 记一条清理项。kind 必填、title 必填 —— 没有标题的清理项没人会去清。 */
  addCleanup(id, item = {}) {
    const db = this.db(id)
    const kind = String(item.kind === undefined || item.kind === null ? '' : item.kind).trim()
    if (!RedteamStore.CLEANUP_KINDS.includes(kind)) {
      throw new Error('cleanup kind 只能是 ' + RedteamStore.CLEANUP_KINDS.join('/') + '，收到 ' + JSON.stringify(item.kind))
    }
    const title = String(item.title === undefined || item.title === null ? '' : item.title).trim()
    if (title === '') throw new Error('title 不能为空：清理项必须一句话说清要删什么')
    const target = String(item.target === undefined || item.target === null ? '' : item.target).trim()
    /* 具体位置（文件路径 / 账号名 / 隧道监听端口）。target 只说「哪台机器」，
       说不清「删哪个东西」—— 去重键也必须带上它，否则同主机第二个马会被静默吞掉。 */
    const location = String(item.location === undefined || item.location === null ? '' : item.location).trim()
    /* 同 kind + 同 target + **同 location** + 还没收口的才算重复。
       location 必须进键：同一台主机上两个不同的 webshell 是两条清理项，
       只按 target 去重会让第二条被静默吞掉（返回 deduped:true，一个字节都不写），
       而演练收尾是按这张清单逐个删的 —— 漏掉的那一个就留在靶标里了。
       用 COALESCE 而不是 `target = ?`：NULL 与 NULL 在 SQL 里不相等，
       老写法会让「没写 target」的清理项**永远不去重**。 */
    const dup = (target === '' && location === '') ? undefined : db.prepare(
      "SELECT id FROM cleanup_item WHERE kind = ? AND COALESCE(target, '') = ? AND COALESCE(location, '') = ? AND status = 'open'")
      .get(kind, target, location)
    if (dup) return { cleanup_id: Number(dup.id), deduped: true, dedup_key: kind + '|' + target + '|' + location }
    db.prepare('INSERT INTO cleanup_item(asset_id, target, kind, title, detail, evidence_ref, status, priority, created_by, created_at) ' +
      'VALUES(?,?,?,?,?,?,?,?,?,?)').run(
      item.asset_id === undefined || item.asset_id === null ? null : Number(item.asset_id),
      target === '' ? null : target, kind, title,
      item.detail === undefined ? null : item.detail,
      item.evidence_ref === undefined ? null : item.evidence_ref,
      'open',
      String(item.priority || 'medium'),
      item.created_by === undefined ? null : item.created_by,
      nowIso())
    const newId = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id)
    return { cleanup_id: newId, deduped: false }
  }

  listCleanup(id, f = {}) {
    const db = this.db(id)
    const limit = Math.min(Math.max(Number(f.limit) || 100, 1), 500)
    const where = []
    const args = []
    if (f.status) { where.push('status = ?'); args.push(String(f.status)) }
    if (f.kind) { where.push('kind = ?'); args.push(String(f.kind)) }
    if (f.asset_id !== undefined && f.asset_id !== null) { where.push('asset_id = ?'); args.push(Number(f.asset_id)) }
    let rows = []
    let queryError = null
    try {
      rows = db.prepare('SELECT * FROM cleanup_item' + (where.length ? ' WHERE ' + where.join(' AND ') : '')
        + " ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'wontfix' THEN 1 ELSE 2 END, " +
        "CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id DESC LIMIT ?").all(...args, limit)
    } catch (e) { rows = []; queryError = String((e && e.message) || e) }
    const byStatus = { open: 0, done: 0, wontfix: 0 }
    const byKind = {}
    for (const r of rows) {
      if (byStatus[r.status] !== undefined) byStatus[r.status] += 1
      byKind[r.kind] = (byKind[r.kind] || 0) + 1
    }
    return {
      total: rows.length,
      by_status: byStatus,
      by_kind: byKind,
      /* 还有 open 的就不能宣布演练收尾 —— 这条给报告与首页用。
         **查不出来 ≠ 清干净**：查询失败时 cleared 必须是 null（未知），
         否则「读库出错」会被渲染成一句对外承诺「已清干净」。 */
      cleared: queryError === null ? byStatus.open === 0 : null,
      query_error: queryError,
      items: rows,
    }
  }

  /**
   * 更新一条清理项。
   *
   * `wontfix` 必须写原因：不清理是一种决定，不是遗漏。没有原因的 wontfix
   * 在报告里和「忘了做」完全一样，靶标方拿到手也没法判断风险。
   */
  updateCleanup(id, itemId, patch = {}, actor = null) {
    const db = this.db(id)
    const row = db.prepare('SELECT * FROM cleanup_item WHERE id = ?').get(Number(itemId))
    if (!row) throw new Error('cleanup item not found: ' + itemId)
    const sets = []
    const args = []
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
      const st = String(patch.status === undefined || patch.status === null ? '' : patch.status).trim()
      if (!RedteamStore.CLEANUP_STATUS.includes(st)) {
        throw new Error('status 只能是 ' + RedteamStore.CLEANUP_STATUS.join('/') + '，收到 ' + JSON.stringify(patch.status))
      }
      const reason = String(patch.detail === undefined || patch.detail === null ? (row.detail || '') : patch.detail).trim()
      if (st === 'wontfix' && reason === '') {
        throw new Error('wontfix 必须写 detail 说明为什么不清理（例如「客户要求保留以做取证」）')
      }
      sets.push('status = ?'); args.push(st)
    }
    for (const f of ['detail', 'evidence_ref', 'priority', 'target', 'title', 'location']) {
      if (Object.prototype.hasOwnProperty.call(patch, f)) {
        sets.push(f + ' = ?'); args.push(patch[f] === undefined ? null : patch[f])
      }
    }
    if (sets.length === 0) return { cleanup: row }
    sets.push('updated_by = ?', 'updated_at = ?')
    args.push(actor === undefined ? null : actor, nowIso(), Number(itemId))
    db.prepare('UPDATE cleanup_item SET ' + sets.join(', ') + ' WHERE id = ?').run(...args)
    return { cleanup: db.prepare('SELECT * FROM cleanup_item WHERE id = ?').get(Number(itemId)) }
  }

  /** 清理进度汇总：给报告尾部和首页用。 */
  cleanupSummary(id) {
    const db = this.db(id)
    const out = { total: 0, open: 0, done: 0, wontfix: 0, cleared: null, by_kind: {} }
    let rows = []
    let queryError = null
    try { rows = db.prepare('SELECT kind, status FROM cleanup_item').all() } catch (e) {
      rows = []
      queryError = String((e && e.message) || e)
    }
    for (const r of rows) {
      out.total += 1
      if (out[r.status] !== undefined) out[r.status] += 1
      out.by_kind[r.kind] = (out.by_kind[r.kind] || 0) + 1
    }
    /* 同上：查不出来是「未知」，不是「已清干净」 */
    out.cleared = queryError === null ? out.open === 0 : null
    if (queryError !== null) out.query_error = queryError
    return out
  }
