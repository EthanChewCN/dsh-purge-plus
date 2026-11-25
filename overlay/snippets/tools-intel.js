  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_intel',
    description: '情报资源保鲜：KEV 目录 / nuclei 模板 / 字典库在不在、多久没动过、有没有过期。'
      + 'action=status 只看（**不联网**）；refresh 重新探一遍并记录检查时间（也不联网）；'
      + 'update 才会真下载（KEV 走 CISA 官方 JSON、nuclei 走官方仓库，带大小上限与超时）；'
      + 'runtime 铺红队数据目录（知识库 DDL / pocs / toolkit / 平台配置），默认**不联网**，'
      + '要顺带拉模板就传 download=true。'
      + '引用「最新 KEV」之前先看这里，别凭印象说用的是最新的。',
    parameters: {
      action: { type: 'string', description: 'status / refresh / update / runtime，默认 status' },
      download: { type: 'boolean', description: 'runtime 时是否顺带下载 nuclei 模板（默认 false，纯本地）' },
      target: { type: 'string', description: 'update 时刷哪个：kev / nuclei / all，默认 all' },
      dry_run: { type: 'boolean', description: 'update 时只校验、不落盘' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args) {
      const action = String((args && args.action) || 'status').trim()
      try {
        if (action === 'status') return JSON.stringify(Object.assign({ ok: true }, store.intelStatus()), null, 2)
        if (action === 'refresh') return JSON.stringify(Object.assign({ ok: true }, store.intelRefresh()), null, 2)
        if (action === 'update') {
          /* 真下载：只有显式 update 才发请求。失败逐条报，不让一个资源拖垮另一个。 */
          const out = await store.intelUpdate(String((args && args.target) || 'all'), { dry_run: args && args.dry_run === true })
          const failed = (out.results || []).filter((r) => r.action === 'failed')
          return JSON.stringify(Object.assign({ ok: failed.length === 0 }, out), null, 2)
        }
        if (action === 'runtime') {
          /* 铺数据目录：默认只做本地那半。下载要显式 download=true。 */
          const mod = await import('./bootstrap-runtime.js')
          const report = await mod.ensureRedteamRuntime({ download: args && args.download === true })
          return JSON.stringify(Object.assign({ ok: true }, report), null, 2)
        }
        return JSON.stringify({ ok: false, error: '未知 action：' + action + '（status/refresh/update/runtime）' }, null, 2)
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2)
      }
    },
  })))
