  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_cleanup',
    description: '演练收尾的清理清单：我们留下的 webshell / 自建账号 / 上传文件 / 改过的配置 / 隧道，逐条登记并给结论。'
      + 'action=list 看清单与进度；add 登记一条（同 target+kind 且未收口会自动去重）；update 给结论。'
      + 'status 只能是 open / done / wontfix，wontfix 必须写 detail 说明原因。'
      + '还有 open 项就不算清理完毕 —— 报告里这一栏是给靶标方看的，不是给自己看的。',
    parameters: {
      action: { type: 'string', description: 'list / add / update，默认 list' },
      id: { type: 'number', description: 'update：清理项 id' },
      asset_id: { type: 'number', description: 'add：关联资产 id' },
      target: { type: 'string', description: 'add：主机或入口（IP / 域名 / 主机:端口）' },
      location: { type: 'string', description: 'add：具体位置（文件路径 / 账号名 / webshell 路径 / 隧道监听端口）。'
        + 'target 只写「哪台机器」，location 才是「删哪个东西」—— 两者一起才说得清。' },
      kind: { type: 'string', description: 'webshell / account / file / service / tunnel / config / other' },
      title: { type: 'string', description: 'add：一句话说清要删什么（必填）' },
      detail: { type: 'string', description: '细节；wontfix 时必填原因' },
      evidence_ref: { type: 'string', description: '证据引用' },
      priority: { type: 'string', description: 'high / medium / low' },
      status: { type: 'string', description: 'update：open / done / wontfix' },
      limit: { type: 'number', description: 'list：最多几条（默认 100）' },
      engagement: { type: 'string', description: '靶标 id（一般不用传）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const t = covTarget(store, exec, args && args.engagement)
      if (t.error) return covAmbiguous(t.error)
      if (!t.id) return JSON.stringify({ ok: true, total: 0, items: [], note: '还没有靶标' }, null, 2)
      const action = String((args && args.action) || 'list').trim()
      try {
        if (action === 'list') {
          return JSON.stringify(Object.assign({ ok: true, engagement: t.id }, store.listCleanup(t.id, {
            status: args && args.status, kind: args && args.kind,
            asset_id: args && args.asset_id, limit: args && args.limit,
          })), null, 2)
        }
        if (action === 'add') {
          const out = store.addCleanup(t.id, {
            asset_id: args && args.asset_id, target: args && args.target, location: args && args.location,
            kind: args && args.kind,
            title: args && args.title, detail: args && args.detail,
            evidence_ref: args && args.evidence_ref, priority: args && args.priority,
            created_by: exec && exec.agentId,
          })
          return JSON.stringify(Object.assign({ ok: true, engagement: t.id }, out), null, 2)
        }
        if (action === 'update') {
          const out = store.updateCleanup(t.id, args && args.id, {
            status: args && args.status, detail: args && args.detail,
            evidence_ref: args && args.evidence_ref, priority: args && args.priority,
            target: args && args.target, title: args && args.title,
          }, exec && exec.agentId)
          return JSON.stringify(Object.assign({ ok: true, engagement: t.id }, out), null, 2)
        }
        return JSON.stringify({ ok: false, error: '未知 action：' + action + '（list/add/update）' }, null, 2)
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2)
      }
    },
  })))
