    /* ---------- [dsh-purge-plus] P7 覆盖度 op ---------- */

    /**
     * 靶标解析：显式 > 会话绑定 > 当前指针。与 attention 同一口径。
     *
     * 为什么不在每个 op 里重写一遍：三处口径一旦分叉，会出现「卡片显示的是 A
     * 靶标的缺口、工具写进的是 B 靶标」这种最难查的错。
     */
    /* 用函数声明而不是 const 箭头：后面的清理清单 op 也要用它，而两段代码的
       插入顺序由构建脚本的条目顺序决定。箭头函数会踩 TDZ（先用到后声明 →
       ReferenceError），函数声明会提升，插入顺序就不重要了。 */
    function covEngagementId() {
      let gid = typeof req.engagement === 'string' ? req.engagement.trim() : ''
      if (!gid && typeof req.session === 'string' && req.session) {
        let root = req.session
        if (typeof req.resolveRoot === 'function') {
          try {
            const resolved = req.resolveRoot(req.session)
            if (typeof resolved === 'string' && resolved) root = resolved
          } catch { /* 解析失败就按原样查 */ }
        }
        try {
          const bound = store.sessionBinding(root)
          if (bound) gid = bound
        } catch { /* 没有绑定表就退回指针 */ }
      }
      if (!gid && typeof store.activeEngagementId === 'function') gid = store.activeEngagementId() || ''
      return gid
    }

    if (op === 'assetCoverage') {
      const gid = covEngagementId()
      if (!gid) return { ok: false, error: '请先在顶部选择或创建一个靶标' }
      const action = String(req.action || 'get').trim()
      try {
        if (action === 'next') return Object.assign({ ok: true, engagement: gid }, store.assetNextActions(gid, { limit: req.limit }))
        /* [dsh-purge-plus] action 白名单要在 asset_id 守卫之前：写错 action 时
           「zzz 需要 asset_id」会把人往「你没给 asset_id」上带，而真正的原因是
           action 拼错了 —— 那句「未知 action」的提示永远显示不出来。 */
        if (!['get', 'update', 'close', 'next'].includes(action)) {
          return { ok: false, error: '未知 action：' + action + '（get/update/close/next）' }
        }
        if (req.asset_id === undefined || req.asset_id === null) return { ok: false, error: action + ' 需要 asset_id' }
        if (action === 'get') return { ok: true, engagement: gid, coverage: store.getAssetCoverage(gid, req.asset_id) }
        if (action === 'update') {
          const patch = {}
          for (const f of ['surface', 'web', 'auth', 'cve', 'app', 'note']) {
            if (req[f] !== undefined) patch[f] = req[f]
          }
          if (Object.keys(patch).length === 0) return { ok: false, error: 'update 至少给一个字段' }
          return { ok: true, engagement: gid, coverage: store.updateAssetCoverage(gid, req.asset_id, patch, req.actor) }
        }
        if (action === 'close') {
          return { ok: true, engagement: gid, coverage: store.closeAssetCoverage(gid, req.asset_id, { status: req.status, reason: req.reason, actor: req.actor }) }
        }
        return { ok: false, error: '未知 action：' + action + '（get/update/close/next）' }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }

    if (op === 'hostCoverage') {
      const gid = covEngagementId()
      if (!gid) return { ok: false, error: '请先在顶部选择或创建一个靶标' }
      const action = String(req.action || 'get').trim()
      try {
        if (action === 'next') return Object.assign({ ok: true, engagement: gid }, store.hostNextActions(gid, { limit: req.limit }))
        /* 同 assetCoverage：先认 action，再要求 asset_id */
        if (!['get', 'update', 'close', 'next'].includes(action)) {
          return { ok: false, error: '未知 action：' + action + '（get/update/close/next）' }
        }
        if (req.asset_id === undefined || req.asset_id === null) return { ok: false, error: action + ' 需要 asset_id' }
        if (action === 'get') return { ok: true, engagement: gid, coverage: store.getHostCoverage(gid, req.asset_id) }
        if (action === 'update') {
          const patch = {}
          for (const f of ['files', 'privesc', 'web', 'db', 'lateral', 'access', 'credentials']) {
            if (req[f] !== undefined) patch[f] = req[f]
          }
          if (Object.keys(patch).length === 0) return { ok: false, error: 'update 至少给一个字段' }
          return { ok: true, engagement: gid, coverage: store.updateHostCoverage(gid, req.asset_id, patch, req.actor) }
        }
        if (action === 'close') {
          return { ok: true, engagement: gid, coverage: store.closeHostCoverage(gid, req.asset_id, { status: req.status, reason: req.reason, actor: req.actor }) }
        }
        return { ok: false, error: '未知 action：' + action + '（get/update/close/next）' }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }

    if (op === 'hostFinding') {
      const gid = covEngagementId()
      if (!gid) return { ok: false, error: '请先在顶部选择或创建一个靶标' }
      const action = String(req.action || 'list').trim()
      try {
        if (action === 'add') {
          const out = store.addHostFinding(gid, {
            asset_id: req.asset_id, kind: req.kind, title: req.title,
            detail: req.detail, evidence_ref: req.evidence_ref, created_by: req.actor,
          })
          return Object.assign({ ok: true, engagement: gid }, out)
        }
        if (action === 'list') {
          return Object.assign({ ok: true, engagement: gid }, store.listHostFindings(gid, {
            asset_id: req.asset_id, kind: req.kind, limit: req.limit,
          }))
        }
        return { ok: false, error: '未知 action：' + action + '（add/list）' }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }

    /* 汇总单独一个 op：P6 的态势首页与「现在在等谁」都读它，
       免得两边各算一遍、数字对不上。 */
    if (op === 'coverageSummary') {
      const gid = covEngagementId()
      if (!gid) return { ok: false, error: '请先在顶部选择或创建一个靶标' }
      try {
        return Object.assign({ ok: true, engagement: gid }, store.coverageSummary(gid))
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }
