  /* ---------- [dsh-purge-plus] P7 覆盖度引擎 ---------- */
  //
  // 三张表：asset_coverage（外部单资产五项深挖）/ host_coverage（内网主机六项）/
  // host_finding（主机侧结构化发现）。列名与 safe 2.0.0 完全一致，老库能直接接上。
  //
  // 与 safe 的两处刻意差异：
  //
  //   ① 「收口」判定更严。safe 只看五个维度是不是 done|blocked|not_applicable；
  //      这里额外检查「有没有挂着还没推完的发现」——比如 privesc 标了 done，
  //      但 host_finding 里最后一条 privesc 还停在 partial，那就是自相矛盾。
  //      不查这个，覆盖度会变成一份「我自己说做完了」的自我评价。
  //
  //   ② 内外网归属按 IP 现算，不读 asset.scope。本包的 asset 表没有 scope 列
  //      （scope 由 scopeOfIp 推导），照抄 safe 的 `COALESCE(a.scope, ...)` 会
  //      在每一行上都退化成同一个值，队列于是把内外网混在一起。

  static ASSET_COV_FIELDS = ['surface', 'web', 'auth', 'cve', 'app']
  static HOST_COV_FIELDS = ['files', 'privesc', 'web', 'db', 'lateral']
  static COV_DONE = ['done', 'blocked', 'not_applicable']
  static HOST_FINDING_KINDS = ['file', 'credential', 'privesc', 'lateral', 'web', 'db', 'config', 'share']

  /**
   * 取（必要时初始化）一行覆盖度记录。
   *
   * 用 INSERT OR IGNORE + SELECT 而不是先查后插：两个智能体同时汇报同一台主机时，
   * 先查后插会有一个拿到 undefined 然后崩在下一行的字段访问上。
   * 表名只允许这两张，字符串拼接不接外部输入。
   */
  #ensureCoverageRow(db, table, assetId) {
    if (table !== 'asset_coverage' && table !== 'host_coverage') throw new Error('unknown coverage table: ' + table)
    db.prepare('INSERT OR IGNORE INTO ' + table + '(asset_id) VALUES(?)').run(Number(assetId))
    return db.prepare('SELECT * FROM ' + table + ' WHERE asset_id = ?').get(Number(assetId))
  }

  /**
   * 某资产上登记过的开放端口（带服务名），覆盖度队列用来提示「还差哪些面」。
   *
   * [dsh-purge-plus] 这里曾经是一个裸 `catch { return [] }`：列不存在、表被改坏、
   * SQL 写错，全部退化成「这台资产没有开放端口」—— 调用方看到的是「没数据」，
   * 而不是「读失败」。现在只对「老库缺列」这一种情况降级，其余照原样抛。
   * 同时把 safe 的 port 字段补齐（provenance / banner），否则归属证明里
   * 「这个端口是扫出来的还是被动观测到的」无从判断。
   */
  #covPortsOf(db, assetId, limit = 20) {
    const run = (cols) => db.prepare(
      'SELECT ' + cols + ' '
      + 'FROM port p LEFT JOIN service s ON s.port_id = p.id '
      + "WHERE p.asset_id = ? AND p.state = 'open' ORDER BY p.port ASC LIMIT ?").all(Number(assetId), Number(limit))
    try {
      return run('p.port, p.proto, p.state, p.provenance, p.banner, p.url, p.title, s.name AS service, s.product, s.version')
    } catch (e) {
      const msg = String((e && e.message) || e)
      if (!/no such column|no such table/i.test(msg)) throw e
      /* 老库没有 provenance/banner 列：退回不带这两列的查询，端口本身仍然可用 */
      return run('p.port, p.proto, p.state, p.url, p.title, s.name AS service, s.product, s.version')
    }
  }

  /* ── 外部资产：surface / web / auth / cve / app ───────────────── */

  getAssetCoverage(id, assetId) {
    const db = this.db(id)
    const asset = this.getAsset(id, assetId)
    if (asset === undefined) throw new Error('asset not found')
    const row = this.#ensureCoverageRow(db, 'asset_coverage', asset.id)
    const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM vuln WHERE asset_id = ? GROUP BY status').all(asset.id)
    const count = (st) => Number((byStatus.find((v) => v.status === st) || {}).n || 0)
    const missing = RedteamStore.ASSET_COV_FIELDS.filter((k) => !RedteamStore.COV_DONE.includes(String(row[k] || 'untested')))
    return Object.assign({}, row, {
      asset: {
        id: asset.id, ip: asset.ip, primary_name: asset.primary_name,
        priority: asset.priority, potential: asset.potential, state: asset.state,
        segment: asset.segment_cidr, scope: scopeOfIp(asset.ip),
        /* [dsh-purge-plus] asset.ports：上游 safe 的 getAssetCoverage 也带这个键
           （它的 asset 表没有 ports 列，所以恒为 undefined —— 这里给真数据）。
           端口在独立表里，按 asset_id 现取，与下面顶层的 ports 是同一份。 */
        ports: this.#covPortsOf(db, asset.id),
      },
      ports: this.#covPortsOf(db, asset.id),
      candidates: count('candidate'), confirmed: count('confirmed'), exploited: count('exploited'),
      missing,
      /* complete 只表示「这一行收口了」，不表示「这台资产打透了」——
         打透要看得分点，那是 P6 的事。 */
      complete: row.status === 'closed' || row.status === 'blocked',
    })
  }

  updateAssetCoverage(id, assetId, patch = {}, actor = null) {
    const db = this.db(id)
    const row = this.#ensureCoverageRow(db, 'asset_coverage', assetId)
    const sets = []
    const args = []
    for (const f of RedteamStore.ASSET_COV_FIELDS.concat(['blocked_reason', 'note'])) {
      if (!Object.prototype.hasOwnProperty.call(patch, f)) continue
      /* 只认四个状态值。写 `finished` / `yes` / 空串这类都会让队列永远认为没做完，
         而界面上看起来「标过了」。宁可当场报错，也不要留一条静默不生效的记录。 */
      if (RedteamStore.ASSET_COV_FIELDS.includes(f)) {
        const v = String(patch[f] === undefined || patch[f] === null ? '' : patch[f]).trim()
        const allowed = ['untested', 'partial'].concat(RedteamStore.COV_DONE)
        if (!allowed.includes(v)) throw new Error(f + ' 只能是 ' + allowed.join('/') + '，收到 ' + JSON.stringify(patch[f]))
        sets.push(f + ' = ?'); args.push(v)
      } else {
        sets.push(f + ' = ?'); args.push(patch[f] === undefined ? null : patch[f])
      }
    }
    /* status 单独处理：它不在 ASSET_COV_FIELDS 里（那五项是「做了什么」，
       status 是「这一行收没收口」）。漏掉这一步的后果是 closeAssetCoverage
       把 status 传进来、却一个字都没写进去 —— 收口之后行还是 open，
       队列于是永远认为这台资产没做完。第一版就是这么错的，回归当场红了。 */
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
      const st = String(patch.status === undefined || patch.status === null ? '' : patch.status).trim()
      if (!['open', 'closed', 'blocked'].includes(st)) {
        throw new Error('status 只能是 open/closed/blocked，收到 ' + JSON.stringify(patch.status))
      }
      sets.push('status = ?'); args.push(st)
    }
    if (sets.length === 0) return this.getAssetCoverage(id, assetId)
    sets.push('updated_by = ?', 'updated_at = ?')
    args.push(actor === undefined ? null : actor, nowIso(), row.asset_id)
    db.prepare('UPDATE asset_coverage SET ' + sets.join(', ') + ' WHERE asset_id = ?').run(...args)
    return this.getAssetCoverage(id, assetId)
  }

  /**
   * 资产收口。
   *
   * closed 要求五项全部 done|blocked|not_applicable —— 报错信息里点名缺哪几项，
   * 因为「资产还没深挖完」这句话对智能体没有可执行性，它需要知道下一步做什么。
   * blocked 必须写原因：没写原因的 blocked 和「忘了做」在数据上无法区分。
   */
  closeAssetCoverage(id, assetId, opts = {}) {
    const cov = this.getAssetCoverage(id, assetId)
    const status = opts.status === 'blocked' ? 'blocked' : 'closed'
    const reason = String(opts.reason === undefined || opts.reason === null ? '' : opts.reason).trim()
    if (status === 'blocked' && reason === '') throw new Error('blocked 必须写 reason（例如「无外网出口」「授权范围不含该段」）')
    if (status === 'closed' && cov.missing.length > 0) {
      throw new Error('资产还没深挖完，缺少：' + cov.missing.join(' / ')
        + '。先把这五项标成 done/blocked/not_applicable 再收口；批量扫完就交不算完成。')
    }
    return this.updateAssetCoverage(id, assetId, { status, blocked_reason: reason || null }, opts.actor)
  }

  /** 外部资产深挖队列：只返回还没收口、且确实还缺项的资产。 */
  assetNextActions(id, opts = {}) {
    const db = this.db(id)
    const limit = Math.min(Math.max(Number(opts.limit) || 8, 1), 30)
    const where = []
    const args = []
    if (opts.assetId !== undefined && opts.assetId !== null) { where.push('a.id = ?'); args.push(Number(opts.assetId)) }
    /* 不按 state 过滤 dead：状态是探测结论，不是「不用打」的理由。
       真正决定要不要打的是覆盖度行本身。 */
    const rows = db.prepare('SELECT * FROM asset a' + (where.length ? ' WHERE ' + where.join(' AND ') : '')
      + " ORDER BY CASE COALESCE(a.priority,'medium') WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, a.id ASC LIMIT 400").all(...args)
    const actions = []
    for (const a of rows) {
      if (scopeOfIp(a.ip) !== 'external') continue
      let cov
      try { cov = this.getAssetCoverage(id, a.id) } catch { continue }
      if (cov.complete) continue
      if (cov.missing.length === 0) continue
      actions.push({
        asset_id: a.id, asset_ip: a.ip, primary_name: a.primary_name,
        priority: a.priority || 'medium', missing: cov.missing,
        ports: (cov.ports || []).slice(0, 20).map((p) => ({
          port: p.port, service: p.service, product: p.product, version: p.version, url: p.url, title: p.title,
        })),
        reason: '单资产深挖未完成：' + cov.missing.join('/'),
      })
    }
    return { total: actions.length, actions: actions.slice(0, limit) }
  }

  /* ── 内网主机：files / privesc / web / db / lateral ───────────── */

  /**
   * 从已有登记推导「这台主机我们到底有没有权限」。
   *
   * 为什么要推导而不是只读 host_coverage.access：智能体常常只写 access_session
   * 或 credential，忘了回头更新覆盖度行。只读行的话，明明拿到了 root 也会显示
   * access=none，于是 closeHostCoverage 会要求写 blocked_reason —— 一个已经拿下
   * 的主机被迫填「没有权限」，数据就废了。
   */
  #covDeriveAccess(db, asset) {
    const ip = String(asset.ip || '')
    let creds = 0
    try { creds = Number(db.prepare('SELECT COUNT(*) AS n FROM credential WHERE asset_id = ? OR host = ?').get(asset.id, ip).n) || 0 } catch { creds = 0 }
    let sessions = []
    try { sessions = db.prepare('SELECT privilege, method, username FROM access_session WHERE asset_id = ? OR host = ?').all(asset.id, ip) } catch { sessions = [] }
    if (sessions.length === 0) return { access: 'none', credentials: creds }
    const best = sessions.find((r) => /root|system|admin|administrator|管理员/i.test(String(r.privilege || ''))) || sessions[0]
    return {
      access: String(best.privilege || best.method || 'user'),
      credentials: Math.max(creds, sessions.filter((r) => String(r.username || '').trim() !== '').length),
    }
  }

  getHostCoverage(id, assetId) {
    const db = this.db(id)
    const asset = this.getAsset(id, assetId)
    if (asset === undefined) throw new Error('asset not found')
    const row = this.#ensureCoverageRow(db, 'host_coverage', asset.id)
    const derived = this.#covDeriveAccess(db, asset)
    const findings = (() => {
      try { return db.prepare('SELECT * FROM host_finding WHERE asset_id = ? ORDER BY id DESC LIMIT 100').all(asset.id) } catch { return [] }
    })()
    /* 每个维度的最新一条发现的 kind，用来做「标了 done 但发现还停在 partial」的一致性检查 */
    const latestKind = {}
    for (const f of findings) if (latestKind[f.kind] === undefined) latestKind[f.kind] = f
    const missing = RedteamStore.HOST_COV_FIELDS.filter((k) => !RedteamStore.COV_DONE.includes(String(row[k] || 'untested')))
    return Object.assign({}, row, {
      /* 行里写的 access 优先（人能改），但推导值更高时用推导值 —— 只上不下。 */
      access: row.access && row.access !== 'none' ? row.access : derived.access,
      credentials: Math.max(Number(row.credentials) || 0, derived.credentials),
      asset: {
        id: asset.id, ip: asset.ip, primary_name: asset.primary_name,
        priority: asset.priority, potential: asset.potential, scope: scopeOfIp(asset.ip),
      },
      open_ports: this.#covPortsOf(db, asset.id, 200).length,
      findings,
      missing,
      complete: row.status === 'closed' || row.status === 'blocked',
    })
  }

  updateHostCoverage(id, assetId, patch = {}, actor = null) {
    const db = this.db(id)
    const row = this.#ensureCoverageRow(db, 'host_coverage', assetId)
    const sets = []
    const args = []
    for (const f of RedteamStore.HOST_COV_FIELDS.concat(['access', 'status', 'blocked_reason'])) {
      if (!Object.prototype.hasOwnProperty.call(patch, f)) continue
      if (RedteamStore.HOST_COV_FIELDS.includes(f)) {
        const v = String(patch[f] === undefined || patch[f] === null ? '' : patch[f]).trim()
        const allowed = ['untested', 'partial'].concat(RedteamStore.COV_DONE)
        if (!allowed.includes(v)) throw new Error(f + ' 只能是 ' + allowed.join('/') + '，收到 ' + JSON.stringify(patch[f]))
        sets.push(f + ' = ?'); args.push(v)
      } else if (f === 'status') {
        const st = String(patch.status === undefined || patch.status === null ? '' : patch.status).trim()
        if (!['open', 'closed', 'blocked'].includes(st)) {
          throw new Error('status 只能是 open/closed/blocked，收到 ' + JSON.stringify(patch.status))
        }
        sets.push('status = ?'); args.push(st)
      } else {
        sets.push(f + ' = ?'); args.push(patch[f] === undefined ? null : patch[f])
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'credentials')) {
      const n = Number(patch.credentials)
      if (!Number.isFinite(n) || n < 0) throw new Error('credentials 必须是非负数字')
      /* credentials 在 HOST_COV_FIELDS 之外单独处理：它是计数不是状态词，
         混进上面那条状态校验会直接报错。 */
      sets.push('credentials = ?'); args.push(Math.floor(n))
    }
    if (sets.length === 0) return this.getHostCoverage(id, assetId)
    sets.push('updated_by = ?', 'updated_at = ?')
    args.push(actor === undefined ? null : actor, nowIso(), row.asset_id)
    db.prepare('UPDATE host_coverage SET ' + sets.join(', ') + ' WHERE asset_id = ?').run(...args)
    return this.getHostCoverage(id, assetId)
  }

  /**
   * 记一条结构化主机发现，并顺手把对应维度从 untested 推到 partial。
   *
   * 为什么自动推：智能体记了「拿到 /etc/shadow」却忘了把 files 标成 partial，
   * 队列就会一直提示「文件还没看」。自动推只升不降（partial 不会覆盖 done），
   * 也不会把维度直接标成 done —— 一条发现证明「看过」，不证明「看完」。
   */
  addHostFinding(id, f = {}) {
    const db = this.db(id)
    const asset = this.getAsset(id, f.asset_id)
    if (asset === undefined) throw new Error('asset not found')
    const kind = String(f.kind === undefined || f.kind === null ? '' : f.kind).trim()
    if (!RedteamStore.HOST_FINDING_KINDS.includes(kind)) {
      throw new Error('host finding kind 只能是 ' + RedteamStore.HOST_FINDING_KINDS.join('/') + '，收到 ' + JSON.stringify(f.kind))
    }
    const title = String(f.title === undefined || f.title === null ? '' : f.title).trim()
    if (title === '') throw new Error('title 不能为空：没有标题的发现，三天后没人知道它是什么')
    db.prepare('INSERT INTO host_finding(asset_id, kind, title, detail, evidence_ref, created_by, created_at) VALUES(?,?,?,?,?,?,?)')
      .run(asset.id, kind, title,
        f.detail === undefined ? null : f.detail,
        f.evidence_ref === undefined ? null : f.evidence_ref,
        f.created_by === undefined ? null : f.created_by,
        nowIso())
    const row = this.#ensureCoverageRow(db, 'host_coverage', asset.id)
    /* 凭据计数要基于「生效值」加一，不能基于行里的裸值。
       getHostCoverage 报的是 max(行里的, 从 access_session 推导的)；
       直接写 行里+1，在「推导值更大」时等于没加 —— 明明记了一条新凭据，
       面板上的数字纹丝不动。 */
    const effectiveCreds = (() => {
      try { return Number(this.getHostCoverage(id, asset.id).credentials) || 0 } catch { return Number(row.credentials) || 0 }
    })()
    const partial = (v) => (v === 'untested' || v === null || v === undefined ? 'partial' : v)
    const patch = {}
    if (kind === 'file' || kind === 'config' || kind === 'share') patch.files = partial(row.files)
    if (kind === 'privesc') patch.privesc = partial(row.privesc)
    if (kind === 'lateral') patch.lateral = partial(row.lateral)
    if (kind === 'web') patch.web = partial(row.web)
    if (kind === 'db') patch.db = partial(row.db)
    const findingId = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id)
    const coverage = Object.keys(patch).length > 0
      ? this.updateHostCoverage(id, asset.id, patch, f.created_by)
      : this.getHostCoverage(id, asset.id)
    /* credential 单独加计数：它不在 HOST_COV_FIELDS 里，走 updateHostCoverage 会被状态校验拦住。 */
    if (kind === 'credential') {
      const next = effectiveCreds + 1
      return { finding_id: findingId, coverage: this.updateHostCoverage(id, asset.id, { credentials: next }, f.created_by) }
    }
    return { finding_id: findingId, coverage }
  }

  listHostFindings(id, opts = {}) {
    const db = this.db(id)
    const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200)
    const where = []
    const args = []
    if (opts.asset_id !== undefined && opts.asset_id !== null) { where.push('asset_id = ?'); args.push(Number(opts.asset_id)) }
    if (opts.kind) { where.push('kind = ?'); args.push(String(opts.kind)) }
    let rows = []
    try {
      rows = db.prepare('SELECT * FROM host_finding' + (where.length ? ' WHERE ' + where.join(' AND ') : '')
        + ' ORDER BY id DESC LIMIT ?').all(...args, limit)
    } catch { rows = [] }
    return { total: rows.length, findings: rows }
  }

  /**
   * 主机收口。
   *
   * 没有权限的主机**不能**标 closed —— 只能 blocked 且必须写原因。这条是 safe 的
   * 原意，保留：否则「打不进去」和「打完了」在数据上完全一样，报告里就分不清
   * 哪些资产是真的验过、哪些是连门都没进去。
   */
  closeHostCoverage(id, assetId, opts = {}) {
    const cov = this.getHostCoverage(id, assetId)
    const reason = String(opts.reason === undefined || opts.reason === null ? '' : opts.reason).trim()
    if (cov.access === 'none') {
      if (reason === '') throw new Error('没有主机权限，收口必须写 reason（例如「无入口」「认证失败」「无可用漏洞」）')
      return this.updateHostCoverage(id, assetId, { status: 'blocked', blocked_reason: reason }, opts.actor)
    }
    const status = opts.status === 'blocked' ? 'blocked' : 'closed'
    if (status === 'blocked' && reason === '') throw new Error('blocked 必须写 reason')
    if (status === 'closed' && cov.missing.length > 0) {
      throw new Error('主机还没收口，缺少：' + cov.missing.join(' / ')
        + '。先标成 done/blocked/not_applicable 再收口；打一个点就结束不算完成。')
    }
    return this.updateHostCoverage(id, assetId, { status, blocked_reason: reason || null }, opts.actor)
  }

  /** 内网下一动作队列。只给方向，不做任何自动利用。 */
  hostNextActions(id, opts = {}) {
    const db = this.db(id)
    const limit = Math.min(Math.max(Number(opts.limit) || 8, 1), 30)
    const where = []
    const args = []
    if (opts.assetId !== undefined && opts.assetId !== null) { where.push('a.id = ?'); args.push(Number(opts.assetId)) }
    const rows = db.prepare('SELECT * FROM asset a' + (where.length ? ' WHERE ' + where.join(' AND ') : '')
      + " ORDER BY CASE COALESCE(a.priority,'medium') WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, a.id ASC LIMIT 400").all(...args)
    const actions = []
    for (const a of rows) {
      if (scopeOfIp(a.ip) !== 'internal') continue
      let cov
      try { cov = this.getHostCoverage(id, a.id) } catch { continue }
      if (cov.complete) continue
      const missing = cov.missing.slice()
      /* 有权限但还没做复用：这是最容易被漏掉的一步，单独提一条。 */
      if (Number(cov.credentials) > 0 && !RedteamStore.COV_DONE.includes(String(cov.lateral || 'untested'))) {
        if (!missing.includes('lateral')) missing.push('lateral')
      }
      if (missing.length === 0) continue
      actions.push({
        asset_id: a.id, asset_ip: a.ip, primary_name: a.primary_name,
        priority: a.priority || 'medium', access: cov.access, credentials: Number(cov.credentials) || 0,
        missing,
        findings: cov.findings.length,
        reason: cov.access === 'none'
          ? '还没拿到入口：' + missing.join('/')
          : '主机未收口：' + missing.join('/'),
      })
    }
    return { total: actions.length, actions: actions.slice(0, limit) }
  }

  /* ── 汇总：给「现在在等谁」与态势首页共用 ─────────────────────── */

  /**
   * 覆盖度缺口总数。
   *
   * attentionQueue 会按名字探测这个方法所在的队列函数；这里再包一层是为了
   * 让「缺口总数」只有一个定义 —— 首页、卡片、工具三处都读这一份，
   * 免得三处各算一遍、数字对不上。
   */
  coveragePending(id) {
    const out = { external: 0, internal: 0, total: 0 }
    try { out.external = Number(this.assetNextActions(id, { limit: 30 }).total) || 0 } catch { out.external = 0 }
    try { out.internal = Number(this.hostNextActions(id, { limit: 30 }).total) || 0 } catch { out.internal = 0 }
    out.total = out.external + out.internal
    return out
  }

  /** 覆盖率快照：分母是「已测绘资产」，分子是「已收口」。 */
  coverageSummary(id) {
    const db = this.db(id)
    let assets = []
    try { assets = db.prepare('SELECT id, ip, primary_name, priority FROM asset').all() } catch { assets = [] }
    const sum = {
      assets: assets.length,
      external: { assets: 0, closed: 0, blocked: 0, open: 0 },
      internal: { assets: 0, closed: 0, blocked: 0, open: 0 },
      findings: 0,
      pending: { external: 0, internal: 0, total: 0 },
    }
    for (const a of assets) {
      const scope = scopeOfIp(a.ip) === 'internal' ? 'internal' : 'external'
      sum[scope].assets += 1
      let cov = null
      try { cov = scope === 'internal' ? this.getHostCoverage(id, a.id) : this.getAssetCoverage(id, a.id) } catch { cov = null }
      if (cov === null) { sum[scope].open += 1; continue }
      if (cov.status === 'closed') sum[scope].closed += 1
      else if (cov.status === 'blocked') sum[scope].blocked += 1
      else sum[scope].open += 1
    }
    try { sum.findings = Number(db.prepare('SELECT COUNT(*) AS n FROM host_finding').get().n) || 0 } catch { sum.findings = 0 }
    sum.pending = this.coveragePending(id)
    /* 一个百分比都不给：分母里有大量「扫出来但根本没打算打」的资产，
       算出来的完成率会低得没有意义，反而让人以为整个靶标没动。 */
    return sum
  }
