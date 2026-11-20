    /**
     * [dsh-purge-plus] 「现在在等谁」：智能体页卡片、redteam_attention 工具、
     * 以后接的侧栏角标与悬浮提醒，四处共用这一份实现，谁都不许自己再写一套排序。
     *
     * 靶标解析顺序：显式 engagement > 会话绑定 > 当前靶标指针。
     * 会话绑定排在指针前面，是因为面板/工具拿到的永远是「我这个会话」的靶标；
     * 多个会话并行时指针只有一个，用它会把别人的等待算到自己头上。
     */
    if (op === 'attention') {
      let attId = typeof req.engagement === 'string' ? req.engagement.trim() : ''
      if (!attId && typeof req.session === 'string' && req.session) {
        let root = req.session
        if (typeof req.resolveRoot === 'function') {
          try {
            const resolved = req.resolveRoot(req.session)
            if (typeof resolved === 'string' && resolved) root = resolved
          } catch { /* 解析失败就按原样查 */ }
        }
        try {
          const bound = store.sessionBinding(root)
          if (bound) attId = bound
        } catch { /* 没有绑定表就退回指针 */ }
      }
      if (!attId && typeof store.activeEngagementId === 'function') attId = store.activeEngagementId() || ''
      if (!attId) return { ok: true, total: 0, awaiting_person: 0, items: [], pending_coverage: 0, coverage_available: false, note: '还没有靶标' }
      return Object.assign({ ok: true, engagement: attId }, store.attentionQueue(attId, { limit: req.limit }))
    }
    /**
     * 处理完一条等待后的收口动作。`attentionQueue` 只认事实，不会自己判断
     * 「这条是不是已经处理过了」——那需要人/主会话点头，所以单独一个 op。
     */
    if (op === 'attentionAck') {
      let ackId = typeof req.engagement === 'string' ? req.engagement.trim() : ''
      if (!ackId && typeof req.session === 'string' && req.session) {
        try {
          const bound = store.sessionBinding(req.session)
          if (bound) ackId = bound
        } catch { /* 没有绑定表就退回指针 */ }
      }
      if (!ackId && typeof store.activeEngagementId === 'function') ackId = store.activeEngagementId() || ''
      if (!ackId) return { ok: false, error: '请先在顶部选择或创建一个靶标' }
      const ackOut = store.acknowledgeAgentReports(ackId, {
        session_id: req.session_id, ids: req.ids, all: req.all === true,
      })
      if (ackOut.error) return Object.assign({ ok: false, engagement: ackId }, ackOut)
      return Object.assign({ ok: true, engagement: ackId }, ackOut, store.attentionQueue(ackId, { limit: req.limit }))
    }
