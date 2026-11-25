  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_proxy_pool',
    description: '代理节点池：看清单 / 存节点 / 导入配置 / 测连通性 / 选生效节点。'
      + '**本工具不改本机网络、不起代理引擎、不写系统代理** —— 它只维护节点清单与「当前生效节点」，'
      + '实际走代理由你给单条命令加 `--proxy socks5://host:port` 完成。'
      + 'connect 会先真连一次 TCP，连不上就返回 ok:false 且**不切换**生效节点。',
    parameters: {
      action: { type: 'string', description: 'status / save / delete / import / test / connect / disconnect，默认 status' },
      id: { type: 'string', description: '单个节点 id（save 更新 / test / connect / delete 用）' },
      ids: { type: 'array', items: { type: 'string' }, description: '批量：test / delete 多个节点' },
      yaml: { type: 'string', description: 'import 时的配置文本：Clash 的 proxies 段 / URI 列表（vmess:// ss:// trojan:// socks5:// http://）/ base64 订阅' },
      profile: {
        type: 'object', additionalProperties: true,
        description: 'save 时的节点：{id?, name, protocol, host, port, username, secret, cipher, kind}。省略 secret 表示保留旧口令，传空串才是清空',
      },
      timeout_ms: { type: 'number', description: '探测超时毫秒（500–60000），默认用池子策略里的值' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args) {
      const action = String((args && args.action) || 'status').trim()
      const timeout = Number(args && args.timeout_ms) > 0 ? Number(args.timeout_ms) : undefined
      try {
        if (action === 'status') return JSON.stringify(Object.assign({ ok: true }, store.proxyPoolSnapshot()), null, 2)
        if (action === 'save') {
          const profile = args && args.profile && typeof args.profile === 'object' ? args.profile : {}
          return JSON.stringify(Object.assign({ ok: true }, store.proxyProfileSave(profile)), null, 2)
        }
        if (action === 'delete') {
          if (Array.isArray(args && args.ids) && args.ids.length > 0) {
            return JSON.stringify(Object.assign({ ok: true }, store.proxyProfilesDelete(args.ids)), null, 2)
          }
          return JSON.stringify(Object.assign({ ok: true }, store.proxyProfileDelete(args && args.id)), null, 2)
        }
        if (action === 'import') {
          const out = store.proxyPoolImport(String((args && args.yaml) || ''))
          return JSON.stringify(Object.assign({ ok: out.importedCount > 0 }, out), null, 2)
        }
        if (action === 'test') {
          if (args && args.id) {
            const one = await store.proxyProfileTest(args.id, { timeoutMs: timeout })
            return JSON.stringify(Object.assign({ ok: one.ok }, one), null, 2)
          }
          return JSON.stringify(Object.assign({ ok: true }, await store.proxyPoolTest(args && args.ids, { timeoutMs: timeout })), null, 2)
        }
        if (action === 'connect') {
          const out = args && args.id
            ? await store.proxyProfileConnect(args.id, { timeoutMs: timeout })
            : await store.proxyPoolConnect({ ids: args && args.ids, timeoutMs: timeout })
          return JSON.stringify(Object.assign({ ok: true }, out), null, 2)
        }
        if (action === 'disconnect') return JSON.stringify(Object.assign({ ok: true }, store.proxyPoolDisconnect()), null, 2)
        return JSON.stringify({ ok: false, error: '未知 action：' + action + '（status/save/delete/import/test/connect/disconnect）' }, null, 2)
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2)
      }
    },
  })))
