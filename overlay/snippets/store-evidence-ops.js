    /* ---------- [dsh-purge-plus] P12 证据账本 op ---------- */
    /* 账本是本包独有的信任链：子智能体说"我拿到了"是 claimed，必须核对后才算 observed。
       面板要能一眼看出"还有几条没核实"，否则这条纪律只存在于工具描述里。 */
    if (op === 'evidenceLedger') {
      const lid = covEngagementId()
      if (!lid) return { ok: false, error: '请先在顶部选择或创建一个靶标' }
      /* 三样东西各自 try：账本/未解决问题任一张表坏掉，都不该让整页空白 ——
         一个能看见"核不了"的面板，比一个白屏有用。 */
      let ledger = null
      let unknowns = null
      try {
        const db = store.db(lid)
        ledger = new EvidenceLedger(db)
        unknowns = new UnknownRegistry(db)
      } catch (e) {
        return { ok: false, engagement: lid, error: '证据账本打不开：' + String((e && e.message) || e) }
      }
      const limit = Math.min(Number(req.limit) || 100, 500)
      const out = { ok: true, engagement: lid, unverified: 0, unresolved_claims: 0, total: 0, items: [], unknowns: [], unknown_total: 0, errors: [] }
      try {
        out.unverified = Number(ledger.countUnverified(lid)) || 0
      } catch (e) { out.errors.push('countUnverified: ' + String((e && e.message) || e)) }
      try {
        out.unresolved_claims = Number(ledger.countUnresolvedClaims(lid)) || 0
      } catch (e) { out.errors.push('countUnresolvedClaims: ' + String((e && e.message) || e)) }
      try {
        const all = ledger.list({ engagement_id: lid, limit: 500 })
        out.total = all.length
        const confidence = typeof req.confidence === 'string' && req.confidence ? req.confidence : ''
        out.items = (confidence ? all.filter((x) => x.confidence === confidence) : all).slice(0, limit)
      } catch (e) {
        /* 账本的 list() 会逐条校验语义哈希，**任何一条被改过就整批抛错**。
           这是刻意的（账本被篡改就该报警），但面板不能因此白屏：
           退回只读原始列，并把 degraded 标出来 —— 让人看见"这里有一条对不上"，
           而不是看见一个空页面然后以为账本是空的。 */
        out.errors.push('list: ' + String((e && e.message) || e))
        out.degraded = true
        try {
          const rows = store.db(lid).prepare(
            'SELECT ev_id, confidence, authority, operation, recorded_at, source_agent, recorded_by FROM evidence ORDER BY recorded_at DESC LIMIT ?',
          ).all(limit)
          out.total = rows.length
          out.items = rows.map((r) => Object.assign({}, r, { integrity: 'unverified', result: null }))
        } catch (e2) {
          out.errors.push('raw: ' + String((e2 && e2.message) || e2))
        }
      }
      try {
        const list = unknowns.list({ engagement_id: lid, status: req.unknown_status || undefined, limit: 200 })
        out.unknown_total = list.length
        out.unknowns = list.slice(0, limit)
      } catch (e) { out.errors.push('unknowns: ' + String((e && e.message) || e)) }
      /* 三个数字都是 0 且一条记录都没有 → 是"还没开始记账"，不是"全部核实完毕"。
         这两种状态在面板上必须长得不一样，否则空白页会被读成绿灯。 */
      out.empty = out.total === 0 && out.unknown_total === 0
      return out
    }
