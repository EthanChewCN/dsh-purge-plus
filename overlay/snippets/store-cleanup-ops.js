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
          return Object.assign({ ok: true, engagement: cid }, store.addCleanup(cid, {
            asset_id: req.asset_id, target: req.target, location: req.location,
            kind: req.kind, title: req.title,
            detail: req.detail, evidence_ref: req.evidence_ref, priority: req.priority,
            created_by: req.actor,
          }))
        }
        if (op === 'updateCleanup') {
          if (req.id === undefined || req.id === null) return { ok: false, error: 'updateCleanup 需要 id' }
          return Object.assign({ ok: true, engagement: cid }, store.updateCleanup(cid, req.id, {
            status: req.status, detail: req.detail, evidence_ref: req.evidence_ref,
            priority: req.priority, target: req.target, title: req.title, location: req.location,
          }, req.actor))
        }
        return Object.assign({ ok: true, engagement: cid }, store.cleanupSummary(cid))
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }
