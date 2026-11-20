    /* [dsh-purge-plus] 删除靶标：只移不删。
       confirm 必须显式为 true —— 智能体手里没有这个参数就不会误删，
       而面板上那句 confirm 是用户真点过「确定」之后才带上的。 */
    if (op === 'deleteEngagement') {
      const target = typeof req.engagement === 'string' ? req.engagement.trim() : ''
      if (!target) return { ok: false, error: 'deleteEngagement 需要 engagement' }
      if (req.confirm !== true) {
        return { ok: false, error: '删除靶标需要 confirm:true（目录会被移到 .trash，需要手动 mv 回来）' }
      }
      try { return store.deleteEngagement(target) } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
    }
