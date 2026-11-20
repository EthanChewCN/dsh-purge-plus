  /* ---------- [dsh-purge-plus] P20 会话关系图 ---------- */

  /**
   * 会话关系图的数据源（**只用本机数据**）。
   *
   * 刻意不直打宿主的 `/api/session/list`：那个 rpcId/method 没有版本承诺，
   * 宿主一升级就静默变成空白图且不报错。这里的三样东西都是自己的：
   *   - `sessions.json`：会话 → 靶标绑定（P1 落盘，原子写）
   *   - `listEngagements()`：靶标清单（含已删除的会被过滤掉）
   *   - `agent_report`：每个会话最新一条未确认的回报 → 节点上挂「在等谁」
   *
   * 绑定指向已删除靶标的会话不返回（否则图上会出现连不到根节点的孤点）。
   */
  sessionGraph() {
    const engagements = this.listEngagements({ includeStats: false })
    const existing = new Set(engagements.map((e) => e.id))
    const bindings = this.sessionBindings()
    /* 在等谁：每会话取最新一条未确认回报。读失败（表不存在）当作没有回报，
       而不是让整张图报错 —— 关系图比「有没有待办」更重要。 */
    const waiting = new Map()
    for (const eng of engagements) {
      let rows = []
      try {
        const q = this.attentionQueue(eng.id, { limit: 100 })
        rows = (q && q.items) || []
      } catch { rows = [] }
      for (const row of rows) {
        const sid = row && row.session_id
        if (!sid || waiting.has(sid)) continue
        waiting.set(sid, {
          status: row.status || '', stage: row.stage || '',
          reason: row.reason || (Array.isArray(row.needs) && row.needs.length
            ? '需要 ' + row.needs.map((n) => n.detail || n.kind || '').filter(Boolean).join('/')
            : ''),
        })
      }
    }
    const sessions = []
    const countBy = {}
    for (const [sid, value] of Object.entries(bindings)) {
      if (!existing.has(value.engagement)) continue
      countBy[value.engagement] = (countBy[value.engagement] || 0) + 1
      sessions.push({
        id: sid,
        short: sid.length > 14 ? sid.slice(0, 8) + '…' + sid.slice(-4) : sid,
        engagement: value.engagement,
        name: value.name,
        at: value.at,
        waiting: waiting.get(sid) || null,
      })
    }
    /* 稳定顺序：靶标按创建时间倒序（与 listEngagements 一致），靶标内按绑定时间倒序 */
    const order = new Map(engagements.map((e, i) => [e.id, i]))
    sessions.sort((a, b) => (order.get(a.engagement) - order.get(b.engagement))
      || String(b.at || '').localeCompare(String(a.at || '')))
    return {
      engagements: engagements.map((e) => ({
        id: e.id, name: e.name, status: e.status, created_at: e.created_at,
        scope: e.scope || [],
      })),
      sessions: sessions,
      count_by_engagement: countBy,
      source: 'sessions.json',
      note: '数据源是本机落盘的绑定表（sessions.json），不依赖宿主内部 RPC。',
    }
  }
