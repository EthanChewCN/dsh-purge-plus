    /* ---------- [dsh-purge-plus] P9 清理清单 op ---------- */
    /* 三个 op 共用同一个靶标解析口径（显式 > 会话绑定 > 指针）。 */
    if (op === 'cleanup' || op === 'addCleanup' || op === 'updateCleanup' || op === 'cleanupSummary') {
      const cid = covEngagementId()
      if (!cid) return { ok: false, error: '请先在顶部选择或创建一个靶标' }
      try {
        if (op === 'cleanup') {
          return Object.assign({ ok: true, engagement: cid }, store.listCleanup(cid, {
            status: req.status, kind: req.kind, asset_id: req.asset_id, limit: req.limit,
          }))
        }
        if (op === 'addCleanup') {
          /* [dsh-purge-plus] 兼容 safe 的 `{ item: {…} }` 包装：safe 的调用约定是
             `req.item || req`。分发层过去只看 req.kind，包了一层的调用方会拿到
             「kind 收到 undefined」，而它明明给了 kind。 */
          const src = req.item !== null && typeof req.item === 'object' && !Array.isArray(req.item) ? req.item : req
          return Object.assign({ ok: true, engagement: cid }, store.addCleanup(cid, {
            asset_id: src.asset_id, target: src.target, location: src.location,
            kind: src.kind, title: src.title,
            detail: src.detail, evidence_ref: src.evidence_ref, priority: src.priority,
            created_by: src.created_by !== undefined ? src.created_by : src.actor,
          }))
        }
        if (op === 'updateCleanup') {
          if (req.id === undefined || req.id === null) return { ok: false, error: 'updateCleanup 需要 id' }
          /* [dsh-purge-plus] 只把请求里**真的给了**的键交给 store。
             面板只发 {status, detail} 时，其余 5 个键曾经被当成"改成 NULL"传下去，
             清理台账的 target/title 就这样被一次状态更新清空。 */
          const patch = {}
          for (const k of ['status', 'detail', 'evidence_ref', 'priority', 'target', 'title', 'location']) {
            if (req[k] !== undefined) patch[k] = req[k]
          }
          return Object.assign({ ok: true, engagement: cid }, store.updateCleanup(cid, req.id, patch, req.actor))
        }
        return Object.assign({ ok: true, engagement: cid }, store.cleanupSummary(cid))
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }
