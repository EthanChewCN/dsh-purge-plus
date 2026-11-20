    /* ---------- [dsh-purge-plus] P20 会话关系图 op ---------- */
    /* 与 sessionBindings 同段（全局，不需要靶标）：图要画「所有靶标 + 所有绑定」，
       而不是「当前靶标下有什么」。 */
    if (op === 'sessionGraph') {
      const rawGraphSession = typeof req.session === 'string' ? req.session : ''
      let graphRoot = rawGraphSession
      if (rawGraphSession && typeof req.resolveRoot === 'function') {
        try {
          const resolved = req.resolveRoot(rawGraphSession)
          if (typeof resolved === 'string' && resolved) graphRoot = resolved
        } catch { /* 解析器坏掉时按原样处理 */ }
      }
      try {
        const base = store.sessionGraph()
        return Object.assign({ ok: true }, base, {
          session: rawGraphSession || null,
          root_session: graphRoot || null,
          current: store.activeEngagementId() || null,
          sessions: (base.sessions || []).map((s) => Object.assign({}, s, {
            current: !!(graphRoot && s.id === graphRoot),
          })),
        })
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }
