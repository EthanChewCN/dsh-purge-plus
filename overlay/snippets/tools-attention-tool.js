  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_attention',
    description: '查看「现在在等谁」：按最需要人排序列出子智能体的未处理回报（等解答 / 等验收 / 受阻 / 失败 / 在跑），每条带 needs 一次列齐。主会话每轮派活前先看这个，不要靠读报告猜谁在等。',
    parameters: {
      limit: { type: 'number', description: '最多返回几条（默认 20，上限 100）' },
      engagement: { type: 'string', description: '靶标 id（一般不用传：自动取本会话绑定的靶标）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      let bound = ''
      try {
        bound = resolveEngagement(store, exec, args && args.engagement)
      } catch (e) {
        /* 读操作不该因为「靶标有歧义」而抛错：把选择权交回给调用方，并说清为什么。 */
        return JSON.stringify({
          ok: false,
          reason: 'engagement_ambiguous',
          error: String((e && e.message) || e),
          note: '传 engagement 参数指定靶标，或先 redteam_session_bind 绑定本会话。',
        }, null, 2)
      }
      if (!bound) return JSON.stringify({ ok: true, total: 0, awaiting_person: 0, items: [], pending_coverage: 0, coverage_available: false, note: '还没有靶标' }, null, 2)
      const queue = store.attentionQueue(bound, { limit: args && args.limit })
      return JSON.stringify(Object.assign({ ok: true, engagement: bound }, queue), null, 2)
    },
  })))
