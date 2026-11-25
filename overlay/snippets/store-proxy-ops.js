    /* ---------- [dsh-purge-plus] P30 代理池：同步 op ---------- */
    /* 这 8 个都不需要靶标：代理池是全机共享的配置，靶标还没建的时候也该能管。
       另外 4 个（test / poolTest / connect / poolConnect）要真连 TCP，走 dispatchAsync。 */
    if (op === 'proxyPoolGet') return Object.assign({ ok: true }, store.proxyPoolSnapshot())
    if (op === 'proxyPoolSave') {
      const settings = req.settings && typeof req.settings === 'object' ? req.settings : req
      return Object.assign({ ok: true }, store.proxyPoolSavePolicy(settings))
    }
    if (op === 'proxyProfileSave') {
      const profile = req.profile && typeof req.profile === 'object' ? req.profile : req
      return Object.assign({ ok: true }, store.proxyProfileSave(profile))
    }
    if (op === 'proxyProfileDelete') return Object.assign({ ok: true }, store.proxyProfileDelete(req.id))
    if (op === 'proxyProfilesDelete') return Object.assign({ ok: true }, store.proxyProfilesDelete(req.ids))
    if (op === 'proxyPoolImport') {
      return Object.assign({ ok: true }, store.proxyPoolImport(typeof req.yaml === 'string' ? req.yaml : '', { replace: req.replace === true }))
    }
    if (op === 'proxyConfigImport') {
      /* 只解析、不写盘：面板先给预览（candidates），用户挑完再 proxyPoolImport。 */
      const parsed = store.proxyConfigParse(typeof req.yaml === 'string' ? req.yaml : '')
      return Object.assign({ ok: parsed.ok }, parsed)
    }
    if (op === 'proxyPoolDisconnect') return Object.assign({ ok: true }, store.proxyPoolDisconnect())
