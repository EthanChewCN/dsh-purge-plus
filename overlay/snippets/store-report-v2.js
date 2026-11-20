  /* ---------- [dsh-purge-plus] P8 数据证明 + 四段式交付报告 ---------- */
  //
  // 两件事：
  //   ① data_proof 表：敏感数据的**结构化**证明（字段 / 条数 / 样本 / 可复现查询）。
  //      自由文本 evidence 没法核对"到底多少条、哪些字段"，验收时只能听我们说。
  //   ② reportV2()：把 scoreReport 已经算好的条目重新组织成交付文档的四段结构。
  //
  // ⚠️ reportV2 **不重新算分**。它只做搬运与分组：总分、逐条分值、计分口径全部来自
  //    scoreReport。两套算法并存必然出现「报告 350、面板 320」这种无法解释的差，
  //    而交付物与面板对不上账，等于整份报告作废。
  //
  // 与 safe 的两处刻意差异：
  //   ① 归属证明的「强弱」按**可复核性**判，不按"有没有写备注"判：
  //      有截图 / 有原始 HTTP 报文 / 有数据样本 = strong；只有文字与端口指纹 = weak。
  //      safe 只看 evidence 字段非空，于是"我扫到了这个 IP"和"我拿到了这个库"同档。
  //   ② 内网资产要**真的进去了**才算「入口资产」。只被发现、没拿到任何会话/凭据/通道的
  //      内网 IP 不进归属证明第一段 —— 否则一台旁路扫描到的打印机也会被写成"内网入口"。

  addDataProof(id, d = {}) {
    const db = this.db(id)
    const rowCount = Number(d.row_count)
    if (!Number.isFinite(rowCount) || rowCount < 0) throw new Error('data_proof.row_count 必须是非负数字')
    const fields = Array.isArray(d.fields) ? d.fields.join(',') : String(d.fields || '')
    if (fields.trim() === '') throw new Error('data_proof.fields required：写清泄露字段（如 姓名/身份证号/手机号）')
    const r = db.prepare(`INSERT INTO data_proof(asset_id, vuln_id, target, source, interface, fields, row_count, sample, query, evidence_ref, pii_type, note, created_by, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      d.asset_id ?? null, d.vuln_id ?? null, d.target ?? null, d.source ?? null, d.interface ?? null,
      fields, rowCount, d.sample ?? null, d.query ?? null, d.evidence_ref ?? null,
      d.pii_type ?? 'pii', d.note ?? null, d.created_by ?? null, nowIso(),
    )
    return { id: Number(r.lastInsertRowid), row_count: rowCount, meets_threshold: rowCount >= 10000, fields: fields.split(',').filter(Boolean) }
  }

  listDataProofs(id, f = {}) {
    const db = this.db(id)
    const where = []
    const args = []
    if (f.target) { where.push('target LIKE ?'); args.push('%' + String(f.target) + '%') }
    if (f.asset_id !== undefined && f.asset_id !== null) { where.push('asset_id = ?'); args.push(Number(f.asset_id)) }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : ''
    const limit = Math.min(Number(f.limit) || 100, 500)
    return {
      total: db.prepare('SELECT COUNT(*) AS n FROM data_proof ' + clause).get(...args).n,
      items: db.prepare('SELECT * FROM data_proof ' + clause + ' ORDER BY id DESC LIMIT ?').all(...args, limit).map((r) => ({
        ...r,
        fields: String(r.fields || '').split(',').filter(Boolean),
        meets_threshold: Number(r.row_count) >= 10000,
      })),
    }
  }

  /**
   * 四段式交付报告。
   *
   * 段结构对应验收人真正会看的东西：
   *   一、资产归属证明 —— 凭什么说这些资产是我们的战果
   *   二、得分汇总表   —— 一共多少分、分在哪个阶段
   *   三、得分点复现   —— 每一条怎么重做一遍（命令 / 报文 / 截图 / 缺口）
   *   四、交付清单     —— 我们留下了什么、清理干净没有
   */
  reportV2(id, options = {}) {
    const db = this.db(id)
    const base = this.scoreReport(id, options)
    const items = base.items || []
    const stageRows = this.listStages(id)
    const stageMeta = new Map(stageRows.map((s) => [s.code, s]))
    const oneLine = (t, n) => String(t === null || t === undefined ? '' : t).replace(/\s*\n+\s*/g, ' ').trim().slice(0, n || 200)

    /* ── 一、资产归属证明 ────────────────────────────────────────────────
       数据源：data_proof（结构化证明）+ http_evidence（可重放报文）+ shot（截图）
              + vuln（已确认漏洞）+ asset_coverage / host_coverage（做到哪一步）。
       这五样都是"别人能自己复核"的，不是我们写的结论。 */
    const proofs = this.listDataProofs(id, { limit: 500 }).items
    const proofByAsset = new Map()
    const proofByTarget = new Map()
    for (const p of proofs) {
      if (p.asset_id !== null && p.asset_id !== undefined) {
        const k = Number(p.asset_id)
        if (!proofByAsset.has(k)) proofByAsset.set(k, [])
        proofByAsset.get(k).push(p)
      } else if (p.target) {
        const k = String(p.target)
        if (!proofByTarget.has(k)) proofByTarget.set(k, [])
        proofByTarget.get(k).push(p)
      }
    }
    const httpByAsset = new Map()
    try {
      for (const r of db.prepare('SELECT asset_id, COUNT(*) AS n FROM http_evidence WHERE asset_id IS NOT NULL GROUP BY asset_id').all()) {
        httpByAsset.set(Number(r.asset_id), Number(r.n))
      }
    } catch { /* 老库没有 http_evidence 时忽略 */ }
    const shotsByAsset = new Map()
    try {
      for (const r of db.prepare('SELECT asset_id, COUNT(*) AS n FROM shot WHERE asset_id IS NOT NULL GROUP BY asset_id').all()) {
        shotsByAsset.set(Number(r.asset_id), Number(r.n))
      }
    } catch { /* 老库没有 shot 表时忽略 */ }
    const vulnByAsset = new Map()
    try {
      for (const r of db.prepare("SELECT asset_id, COUNT(*) AS n FROM vuln WHERE status IN ('confirmed','exploited') GROUP BY asset_id").all()) {
        if (r.asset_id !== null && r.asset_id !== undefined) vulnByAsset.set(Number(r.asset_id), Number(r.n))
      }
    } catch { /* 忽略 */ }
    /* 内网入口判定：有访问会话 / webshell / 隧道 / 凭据，才算"进去了"。
       只被发现不算 —— 否则旁路扫到的一台打印机会被写成"内网入口资产"。 */
    const entryAssets = new Set()
    try {
      for (const r of db.prepare('SELECT DISTINCT asset_id FROM access_session WHERE asset_id IS NOT NULL').all()) entryAssets.add(Number(r.asset_id))
      for (const r of db.prepare('SELECT DISTINCT asset_id FROM webshell WHERE asset_id IS NOT NULL').all()) entryAssets.add(Number(r.asset_id))
      for (const r of db.prepare('SELECT DISTINCT asset_id FROM tunnel WHERE asset_id IS NOT NULL').all()) entryAssets.add(Number(r.asset_id))
      for (const r of db.prepare('SELECT DISTINCT asset_id FROM credential WHERE asset_id IS NOT NULL').all()) entryAssets.add(Number(r.asset_id))
    } catch { /* 老库缺表时忽略：宁可少写，不编造入口 */ }
    const coverageByAsset = new Map()
    try {
      for (const r of db.prepare('SELECT asset_id, status, surface, web, auth, cve, app FROM asset_coverage').all()) coverageByAsset.set(Number(r.asset_id), r)
    } catch { /* 忽略 */ }
    const hostCovByAsset = new Map()
    try {
      for (const r of db.prepare('SELECT asset_id, status, access, files, privesc, web, db AS dbface, lateral FROM host_coverage').all()) hostCovByAsset.set(Number(r.asset_id), r)
    } catch { /* 忽略 */ }

    const scoreAssetIds = new Set(items.map((x) => Number(x.asset_id)).filter((v) => Number.isFinite(v)))
    const assetRows = db.prepare(`SELECT a.id, a.ip, a.primary_name, COALESCE(a.scope, (${SCOPE_SQL})) AS scope
      FROM asset a ORDER BY a.ip`).all()

    const proofEntryOf = (a) => {
      const aid = Number(a.id)
      const mine = proofByAsset.get(aid) || []
      const httpN = httpByAsset.get(aid) || 0
      const shotN = shotsByAsset.get(aid) || 0
      const vulnN = vulnByAsset.get(aid) || 0
      const acov = coverageByAsset.get(aid) || null
      const hcov = hostCovByAsset.get(aid) || null
      const evidence = []
      if (mine.length > 0) {
        const totalRows = mine.reduce((n, p) => n + (Number(p.row_count) || 0), 0)
        evidence.push({
          kind: 'data',
          label: '数据样本',
          detail: mine.map((p) => (p.interface || p.target || '—') + '：' + (p.fields || []).join('/')
            + '，' + (Number(p.row_count) || 0) + ' 条' + (p.sample ? '，样本「' + oneLine(p.sample, 60) + '」' : '')).join('；'),
        })
        if (totalRows > 0) evidence.push({ kind: 'scale', label: '数据规模', detail: totalRows + ' 条（P1 门槛 10000）' })
      }
      if (httpN > 0) evidence.push({ kind: 'http', label: '原始报文', detail: httpN + ' 份可重放请求' })
      if (shotN > 0) evidence.push({ kind: 'shot', label: '现场截图', detail: shotN + ' 张' })
      if (vulnN > 0) evidence.push({ kind: 'vuln', label: '已确认漏洞', detail: vulnN + ' 条' })
      if (acov) evidence.push({ kind: 'coverage', label: '外部覆盖度', detail: 'surface/' + (acov.surface || '—') + ' web/' + (acov.web || '—') + ' auth/' + (acov.auth || '—') + ' cve/' + (acov.cve || '—') + ' app/' + (acov.app || '—') })
      if (hcov) evidence.push({ kind: 'host', label: '主机覆盖度', detail: 'access/' + (hcov.access || '—') + ' files/' + (hcov.files || '—') + ' privesc/' + (hcov.privesc || '—') + ' lateral/' + (hcov.lateral || '—') })
      if (evidence.length === 0) evidence.push({ kind: 'text', label: '仅端口/指纹', detail: '除资产自身信息外没有可复核材料' })
      /* 强弱按可复核性判：有实证材料 = strong，只有文字 = weak */
      const strong = mine.some((p) => Number(p.row_count) > 0) || httpN > 0 || shotN > 0 || vulnN > 0
      return {
        asset_id: aid,
        ip: a.ip || '',
        name: a.primary_name || '',
        scope: a.scope === 'internal' ? 'internal' : 'external',
        strength: strong ? 'strong' : 'weak',
        evidence,
        data_proofs: mine,
        shots: shotN,
        http: httpN,
        vulns: vulnN,
      }
    }

    const internet = []
    const internalEntry = []
    for (const a of assetRows) {
      const aid = Number(a.id)
      const isInternal = a.scope === 'internal'
      if (isInternal) {
        if (!entryAssets.has(aid)) continue
        internalEntry.push(proofEntryOf(a))
      } else if (scoreAssetIds.has(aid) || proofByAsset.has(aid) || httpByAsset.has(aid) || shotsByAsset.has(aid) || vulnByAsset.has(aid)) {
        internet.push(proofEntryOf(a))
      }
    }
    /* 没有任何 asset_id 的数据证明（智能体常只写 target）：单列出来，不硬塞进某台资产 */
    const orphanProofs = []
    for (const [target, list] of proofByTarget.entries()) {
      orphanProofs.push({
        target,
        total_rows: list.reduce((n, p) => n + (Number(p.row_count) || 0), 0),
        items: list,
      })
    }

    /* ── 二、得分汇总表 ─────────────────────────────────────────────── */
    const stageSummary = (base.stages || []).map((st) => ({
      code: st.code,
      name: st.name,
      ordinal: st.ordinal,
      count: st.items.length,
      points: st.points,
      cumulative: st.cumulative,
    }))
    const stageTables = {}
    for (const it of items) {
      const code = it.stage_code || 'internet'
      if (!stageTables[code]) stageTables[code] = []
      stageTables[code].push({
        chain_no: it.chain_no,
        code: it.code || '',
        point_name: it.point_name || '',
        target: it.target || '',
        asset_ip: it.asset_ip || '',
        points: it.points || 0,
        counted: it.counted !== false,
        evidence: oneLine(it.evidence, 160),
        recorded_at: it.recorded_at || '',
      })
    }

    /* ── 三、得分点复现 ─────────────────────────────────────────────── */
    const reproOf = (x) => {
      const requests = Array.isArray(x.requests) ? x.requests : []
      const attackFiles = []
      try {
        if (x.vuln && x.vuln.id !== null && x.vuln.id !== undefined) {
          for (const f of db.prepare('SELECT name, path, kind FROM attack_file WHERE vuln_id = ? ORDER BY id').all(Number(x.vuln.id))) {
            attackFiles.push({ name: f.name, path: f.path, kind: f.kind || '' })
          }
        }
      } catch { /* 老库没有 attack_file 时忽略 */ }
      const gaps = []
      if (x.incomplete) gaps.push('这条记录缺步骤或缺命令，照着报告复现不出来')
      if (requests.length === 0 && !x.replay_cmd) gaps.push('没有抓包也没有可执行命令，只能看文字描述')
      if (x.replay_cmd_kind === 'template') gaps.push('复现命令是按得分点模板填的，占位符可能没填全')
      if ((x.replay_cmd_unfilled || []).length > 0) gaps.push('未填占位符：' + (x.replay_cmd_unfilled || []).join(' '))
      if ((x.shots || []).length === 0) gaps.push('没有截图')
      if (x.replay_http_rebuilt) gaps.push('报文是按当日命令/回显重建的，不是原始抓包')
      return {
        chain_no: x.chain_no,
        code: x.code || '',
        point_name: x.point_name || '',
        points: x.points || 0,
        counted: x.counted !== false,
        stage_code: x.stage_code || 'internet',
        target: x.target || '',
        asset_ip: x.asset_ip || '',
        gained: x.gained || '',
        vuln: x.vuln || null,
        evidence: oneLine(x.evidence, 300),
        note: oneLine(x.note, 200),
        /* 复现三件套：命令 / 报文（前 3 条）/ 截图 */
        replay_cmd: x.replay_cmd || null,
        replay_cmd_kind: x.replay_cmd_kind || null,
        replay_cmd_unfilled: x.replay_cmd_unfilled || [],
        replay_source: x.replay_source || null,
        http: requests.slice(0, 3).map((r) => ({
          label: r.label || '',
          method: r.method || 'GET',
          url: r.url || '',
          status: r.status === undefined ? null : r.status,
          request: r.request || '',
          response: oneLine(r.response, 1000),
          note: r.note || '',
          source: r.source || '',
        })),
        http_total: requests.length,
        shots: (x.shots || []).map((s) => ({ id: s.id, url: s.url, label: s.label || '', kind: s.kind || 'screenshot' })),
        attack_files: attackFiles,
        steps: (x.steps || []).slice(0, 8).map((s) => ({
          seq: s.seq, title: s.title || '', tool: s.tool || '', result: oneLine(s.result, 200),
        })),
        credentials: (x.credentials || []).map((c) => ({ host: c.host || '', username: c.username || '', privilege: c.privilege || '', source: c.source || '' })),
        gaps,
        incomplete: x.incomplete === true,
      }
    }
    const reproItems = items.map(reproOf)
    const pickStage = (code) => reproItems.filter((x) => x.stage_code === code)
    /* 内网按 /24 分段：一条一条堆 60 台主机的复现步骤没人看，
       按网段分组才能看出"这个段是从哪台跳进去的"。 */
    const internalBySegment = new Map()
    for (const x of pickStage('internal')) {
      const seg = x.asset_ip ? cidrOf(x.asset_ip) : '（未标资产）'
      if (!internalBySegment.has(seg)) internalBySegment.set(seg, [])
      internalBySegment.get(seg).push(x)
    }
    const internalSegments = Array.from(internalBySegment.entries())
      .map(([segment, list]) => ({
        segment,
        count: list.length,
        points: list.reduce((n, x) => n + (x.counted ? x.points : 0), 0),
        items: list,
      }))
      .sort((a, b) => String(a.segment).localeCompare(String(b.segment)))

    const reproducible = reproItems.filter((x) => x.replay_cmd !== null || x.http.length > 0).length
    const summary = {
      points: base.summary ? base.summary.points : 0,
      items: items.length,
      reproducible,
      unreproducible: items.length - reproducible,
      complete: items.length > 0 && reproducible === items.length,
      stages: stageSummary.length,
      internet_assets: internet.length,
      internal_entries: internalEntry.length,
      data_proofs: proofs.length,
      data_proof_rows: proofs.reduce((n, p) => n + (Number(p.row_count) || 0), 0),
    }

    /* ── 四、交付清单（清理台账）────────────────────────────────────── */
    let cleanup = { total: 0, open: 0, done: 0, wontfix: 0, items: [] }
    try {
      if (typeof this.cleanupSummary === 'function') {
        const cs = this.cleanupSummary(id)
        /* 计数用 cleanupSummary（它按 kind 归好类），明细用 listCleanup：
           cleanupSummary 只回计数、不回行 —— 只拿它当数据源，第四段会是一张空表，
           而「没有遗留」和「有遗留但没显示」在交付物里是完全相反的两件事。 */
        const rows = typeof this.listCleanup === 'function' ? (this.listCleanup(id, { limit: 200 }).items || []) : []
        cleanup = {
          total: cs.total || 0,
          open: cs.open || 0,
          done: cs.done || 0,
          wontfix: cs.wontfix || 0,
          cleared: cs.cleared === true,
          by_kind: cs.by_kind || {},
          items: rows.slice(0, 200).map((c) => ({
            id: c.id, kind: c.kind, target: c.target || '', location: c.location || '',
            title: c.title || '',
            status: c.status, priority: c.priority || 'medium', detail: oneLine(c.detail, 200),
          })),
        }
      }
    } catch { /* 清理清单是 P9 才有的能力，老库没有就留空 */ }

    return {
      target: base.target || '',
      generated_at: nowIso(),
      summary,
      asset_proof: { internet, internal_entry: internalEntry, orphan: orphanProofs },
      stage_summary: stageSummary,
      stage_tables: stageTables,
      repro: {
        internet: pickStage('internet'),
        boundary: pickStage('boundary'),
        internal_segments: internalSegments,
        target: pickStage('target'),
      },
      cleanup,
      /* 原始 markdown 一并带上：ReportV2 的「下载 .md」用它，不必再请求一次 */
      markdown: base.markdown || '',
    }
  }
