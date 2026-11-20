    /**
     * [dsh-purge-plus] 会话 → 靶标关系图。
     *
     * 与上游 safe 的 SessionMap 不是同一份实现，四处刻意不同：
     *   1. **数据源是自己的 sessions.json**（op: sessionBindings），不直打宿主的
     *      /api/session/list 内部 RPC —— 那个 rpcId/method 没有版本承诺，宿主一升级
     *      就静默变成空白图，而且不报错。
     *   2. **有 onPick**：点靶标直接切过去（safe 的图只能看，点了没反应）。
     *   3. **不轮询**：只在 refreshKey 变化或手动刷新时取一次；失败保留上次快照
     *      并挂「数据陈旧」标记，不假装看到的是当前状态。
     *   4. 后发先至丢弃：连点刷新时只认最后一次响应。
     */
    function SessionMap(props) {
      const refreshKey = props.refreshKey || 0
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [stale, setStale] = React.useState(false)
      const seq = React.useRef(0)

      const load = () => {
        const mine = ++seq.current
        setBusy(true)
        api({ op: 'sessionBindings', session: props.sessionId || '' }).then((r) => {
          if (mine !== seq.current) return
          setBusy(false)
          if (!r || r.ok === false) {
            setErr((r && r.error) || '读取失败')
            setStale(true)
            return
          }
          setErr(null)
          setStale(false)
          setData(r)
        }, (e) => {
          if (mine !== seq.current) return
          setBusy(false)
          setErr(String((e && e.message) || e))
          setStale(true)
        })
      }
      React.useEffect(load, [refreshKey])

      const agents = (data && data.agents) || {}
      const groups = new Map()
      for (const [sid, v] of Object.entries(agents)) {
        if (!groups.has(v.engagement)) groups.set(v.engagement, { id: v.engagement, name: v.name, sessions: [] })
        groups.get(v.engagement).sessions.push({ id: sid, at: v.at })
      }
      const cols = Array.from(groups.values()).sort((a, b) => b.sessions.length - a.sessions.length)
      const mine = (data && data.bound) || null
      const shortId = (s) => (String(s).length > 14 ? String(s).slice(0, 8) + '…' + String(s).slice(-4) : String(s))
      const relTime = (iso) => {
        const t = Date.parse(String(iso || ''))
        if (!isFinite(t)) return ''
        const d = Math.max(0, Date.now() - t)
        if (d < 60000) return '刚刚'
        if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前'
        if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前'
        return Math.floor(d / 86400000) + ' 天前'
      }
      const pick = (id) => { if (typeof props.onPick === 'function') props.onPick(id) }
      const dim = { color: 'var(--dsw-alias-label-secondary)' }

      return h('div', { className: 'rt-card' },
        h('h4', null, '会话 → 靶标',
          h('span', { className: 'rt-tag rt-tag-passive', style: { marginLeft: 6 } }, '本机落盘'),
          stale ? h('span', { className: 'rt-tag rt-tag-warn', style: { marginLeft: 6 } }, '数据陈旧') : null),
        h('div', { style: { fontSize: 11.5, marginBottom: 8, lineHeight: 1.7, color: dim.color } },
          '每个会话绑自己的靶标，多会话并行不会把报告写串。这张表落盘在 sessions.json，重启后仍在。',
          h('br'),
          '本会话：' + (mine ? ('已绑定（' + ((data && data.name) || mine) + '）') : '尚未绑定，跟全局「当前靶标」')),
        err ? h('div', { className: 'rt-err' }, err) : null,
        cols.length === 0
          ? h('div', { className: 'rt-empty' },
              '还没有会话绑定过靶标。智能体调用 redteam_engagement_open / redteam_session_bind 后会出现在这里。')
          : h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' } },
              cols.map((g) => h('div', {
                key: g.id,
                style: {
                  minWidth: 190,
                  maxWidth: 280,
                  border: '1px solid var(--dsw-alias-border-secondary, #ddd)',
                  borderRadius: 8,
                  padding: 10,
                },
              },
                h('button', {
                  className: 'rt-btn',
                  style: { width: '100%', textAlign: 'left', fontWeight: 600, marginBottom: 6 },
                  title: '切到这个靶标',
                  onClick: () => pick(g.id),
                }, (g.name || g.id) + (mine === g.id ? '（本会话）' : '')),
                g.sessions.map((s) => h('div', {
                  key: s.id,
                  style: { fontSize: 11.5, padding: '3px 0', display: 'flex', justifyContent: 'space-between', gap: 8 },
                },
                  h('code', { title: s.id, style: { fontSize: 11 } }, shortId(s.id)),
                  h('span', { style: dim }, relTime(s.at))))))),
        h('div', { style: { marginTop: 8 } },
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? '读取中…' : '刷新')))
    }

