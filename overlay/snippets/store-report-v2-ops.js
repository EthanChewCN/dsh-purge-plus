    /* ---------- [dsh-purge-plus] P8 数据证明与四段式报告 op ---------- */
    /* 三个 op 共用同一个靶标解析口径（显式 > 会话绑定 > 指针），与覆盖度/清理一致。 */
    if (op === 'dataProofs' || op === 'addDataProof') {
      const pid = covEngagementId()
      if (!pid) return { ok: false, error: '请先在顶部选择或创建一个靶标' }
      try {
        if (op === 'dataProofs') {
          return Object.assign({ ok: true, engagement: pid }, store.listDataProofs(pid, {
            target: req.target, asset_id: req.asset_id, limit: req.limit,
          }))
        }
        const out = store.addDataProof(pid, {
          asset_id: req.asset_id, vuln_id: req.vuln_id, target: req.target,
          source: req.source, interface: req.interface, fields: req.fields,
          row_count: req.row_count, sample: req.sample, query: req.query,
          evidence_ref: req.evidence_ref, pii_type: req.pii_type, note: req.note,
          created_by: req.actor,
        })
        return Object.assign({ ok: true, engagement: pid }, out)
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }

    /* 四段式报告单独一个 op：ReportTab 只调它一次，不再串三个请求。
       串请求会让「总分」「复现率」「清理进度」分别来自三个时刻，页面上自相矛盾。 */
    if (op === 'reportV2') {
      const rid = covEngagementId()
      if (!rid) return { ok: false, error: '请先在顶部选择或创建一个靶标' }
      try {
        return Object.assign({ ok: true, engagement: rid }, store.reportV2(rid, {
          limit: req.limit, shotRef: req.shotRef, groupMin: req.groupMin,
        }))
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }
