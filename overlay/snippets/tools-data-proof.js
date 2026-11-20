  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_data_proof',
    description: 'P1 敏感数据的**结构化**证明：字段 / 条数 / 脱敏样本 / 可复现查询，比自由文本 evidence 可核对。'
      + 'action=add 记一条（row_count>=10000 自动标 meets_threshold）；list 查。'
      + 'reportV2 的「资产归属证明」第一段就是拿这张表当证据，没记就写不出归属。',
    parameters: {
      action: { type: 'string', description: 'add / list，默认 list' },
      target: { type: 'string', description: '数据所在目标（IP / URL / 系统名）' },
      source: { type: 'string', description: 'api / db / file / backup' },
      interface: { type: 'string', description: '接口路径 / 库表 / 文件路径' },
      fields: { type: 'array', items: { type: 'string' }, description: '泄露字段，例如 姓名 / 身份证号 / 手机号' },
      row_count: { type: 'number', description: '实际条数（P1 门槛 10000）' },
      sample: { type: 'string', description: '脱敏样本（1–3 条）' },
      query: { type: 'string', description: '可复现的查询/请求' },
      evidence_ref: { type: 'string', description: '证据文件路径' },
      pii_type: { type: 'string', description: 'pii / 三要素 / 其他' },
      asset_id: { type: 'number', description: '关联资产 id' },
      vuln_id: { type: 'number', description: '关联漏洞 id' },
      note: { type: 'string' },
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
          return JSON.stringify(Object.assign({ ok: true, engagement: t.id }, store.listDataProofs(t.id, {
            target: args && args.target, asset_id: args && args.asset_id, limit: args && args.limit,
          })), null, 2)
        }
        if (action === 'add') {
          const out = store.addDataProof(t.id, {
            asset_id: args && args.asset_id, vuln_id: args && args.vuln_id, target: args && args.target,
            source: args && args.source, interface: args && args.interface, fields: args && args.fields,
            row_count: args && args.row_count, sample: args && args.sample, query: args && args.query,
            evidence_ref: args && args.evidence_ref, pii_type: args && args.pii_type,
            note: args && args.note, created_by: exec && exec.agentId,
          })
          return JSON.stringify(Object.assign({ ok: true, engagement: t.id }, out), null, 2)
        }
        return JSON.stringify({ ok: false, error: '未知 action：' + action + '（add/list）' }, null, 2)
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2)
      }
    },
  })))
