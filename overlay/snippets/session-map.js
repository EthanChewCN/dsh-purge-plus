    /* [dsh-purge-plus] P20 会话关系图（全量）
       ------------------------------------------------------------------
       数据源：**本机 sessions.json**（op: sessionGraph）。刻意不直打宿主的
       /api/session/list —— 那个 rpcId/method 没有版本承诺，宿主一升级就静默
       变成空白图，而且不报错（safe 就是这样坏的）。

       与 safe 的四点差异，每一点都是修它的一处残点：
         ① 有 onPick：点靶标节点直接切过去（safe 的图只能看，点了没反应）
         ② 待办/在等谁取自**自己的** agent_report（safe 读宿主的 todos 字段，
            而那个字段被宿主类型系统排除，第三行恒为「未提供待办」）
         ③ 手动刷新与自动刷新各用一个 AbortController 槽（safe 共用一个，
            轮询在途时点「刷新」会被静默丢弃，按钮文案却已恢复）
         ④ 拖拽位置按靶标隔离，切靶标不串位
    */
    const SM_NODE_W = 292
    const SM_NODE_H = 110
    const SM_LAYER_GAP = 350
    const SM_ROW_GAP = 158
    const SM_MAX_NODES = 300

    /** 边的三次贝塞尔路径：两端各自向中间弯一半，父子之间看起来是平滑的 "S"。 */
    function smEdgePath(edge) {
      const bend = (edge.x2 - edge.x1) / 2
      return 'M ' + edge.x1 + ' ' + edge.y1 + ' C ' + (edge.x1 + bend) + ' ' + edge.y1
        + ', ' + (edge.x2 - bend) + ' ' + edge.y2 + ', ' + edge.x2 + ' ' + edge.y2
    }

    /**
     * 两维树布局（确定性，纯函数，便于单独测）。
     *
     * 规则与 safe 相同的三处数值（层距 350 / 行距 158 / 节点 292×110），
     * 但**父节点位置取首末子节点中点**、叶子按行号递增 —— 这样多根树不会重叠。
     *
     * 容错口径与 safe 不同：父节点不存在时**当根处理**而不是抛错。绑定表可能
     * 指向已删除的靶标，此时整张图不该变成一条报错，只该少一条边。
     */
    function sessionGraphLayout(items) {
      const rows = Array.isArray(items) ? items : []
      if (rows.length > SM_MAX_NODES) throw new Error('session-map-too-large')
      const byId = new Map()
      for (const item of rows) {
        if (!item || typeof item.id !== 'string' || item.id === '') throw new Error('session-id-invalid')
        if (byId.has(item.id)) throw new Error('duplicate-session-id')
        byId.set(item.id, Object.assign({}, item))
      }
      /* 悬空父节点 → 当根。成环 → 抛错（环会让 place() 无限递归，宁可报错也不挂死页面） */
      for (const item of byId.values()) {
        if (typeof item.parent === 'string' && item.parent !== '' && !byId.has(item.parent)) item.parent = null
      }
      for (const item of byId.values()) {
        const seen = new Set([item.id])
        let cursor = item.parent === undefined ? null : item.parent
        while (cursor !== null && cursor !== undefined && byId.has(cursor)) {
          if (seen.has(cursor)) throw new Error('session-graph-cycle')
          seen.add(cursor)
          cursor = byId.get(cursor).parent
        }
      }
      const children = new Map()
      const roots = []
      for (const item of byId.values()) children.set(item.id, [])
      for (const item of byId.values()) {
        if (typeof item.parent === 'string' && byId.has(item.parent)) children.get(item.parent).push(item)
        else roots.push(item)
      }
      const nodes = []
      const edges = []
      let row = 0
      let maxDepth = 0
      const place = (item, depth) => {
        const kids = children.get(item.id) || []
        const kidNodes = kids.map((kid) => place(kid, depth + 1))
        const y = kidNodes.length > 0
          ? (kidNodes[0].y + kidNodes[kidNodes.length - 1].y) / 2
          : 40 + row++ * SM_ROW_GAP
        if (depth > maxDepth) maxDepth = depth
        const node = Object.assign({}, item, { x: 40 + depth * SM_LAYER_GAP, y: y, depth: depth })
        nodes.push(node)
        for (const kid of kidNodes) {
          edges.push({
            from: item.id, to: kid.id,
            x1: node.x + SM_NODE_W, y1: node.y + SM_NODE_H / 2,
            x2: kid.x, y2: kid.y + SM_NODE_H / 2,
          })
        }
        return node
      }
      for (const root of roots) {
        place(root, 0)
        row += 0.3
      }
      return {
        nodes: nodes,
        edges: edges,
        width: Math.max(600, 80 + maxDepth * SM_LAYER_GAP + SM_NODE_W),
        height: Math.max(360, 80 + row * SM_ROW_GAP),
      }
    }

    /** 手工拖拽后重算边：节点动了边必须跟着动，否则会出现「线连着空气」。 */
    function sessionGraphApplyPositions(graph, positions) {
      if (!positions || positions.size === 0 || !graph || !graph.nodes.length) return graph
      const nodes = graph.nodes.map((node) => {
        const pos = positions.get(node.id)
        return pos && isFinite(pos.x) && isFinite(pos.y) ? Object.assign({}, node, { x: pos.x, y: pos.y }) : node
      })
      const byId = new Map(nodes.map((node) => [node.id, node]))
      const edges = graph.edges.map((edge) => {
        const from = byId.get(edge.from)
        const to = byId.get(edge.to)
        if (!from || !to) return edge
        return Object.assign({}, edge, {
          x1: from.x + SM_NODE_W, y1: from.y + SM_NODE_H / 2,
          x2: to.x, y2: to.y + SM_NODE_H / 2,
        })
      })
      /* 刻意**不做平移归一化**：拖拽存的是绝对坐标，若每次渲染再整体平移，
         下一次拖拽的起点（显示坐标）就与存储坐标差了一个常量，越拖越飘。
         代价是拖到左上边界外会被画布裁掉 —— 再拖回来即可，比"飘"好。 */
      const maxX = Math.max.apply(null, nodes.map((n) => n.x))
      const maxY = Math.max.apply(null, nodes.map((n) => n.y))
      return {
        nodes: nodes,
        edges: edges,
        width: Math.max(graph.width, maxX + SM_NODE_W + 40),
        height: Math.max(graph.height, maxY + SM_NODE_H + 40),
      }
    }

    function SessionMap(props) {
      const refreshKey = props.refreshKey || 0
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [stale, setStale] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [manualBusy, setManualBusy] = React.useState(false)
      const [selectedId, setSelectedId] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [positions, setPositions] = React.useState(new Map())
      const [msg, setMsg] = React.useState(null)
      /* 两个槽：自动（refreshKey 触发）与手动（点刷新）互不干扰。
         safe 共用一个 AbortController，轮询在途时点刷新会被直接丢掉。 */
      const autoSeq = React.useRef(0)
      const manualSeq = React.useRef(0)
      const dragRef = React.useRef(null)

      const load = (manual) => {
        const seq = manual ? manualSeq : autoSeq
        const mine = (seq.current += 1)
        if (manual) setManualBusy(true); else setBusy(true)
        api({ op: 'sessionGraph', session: props.sessionId || '' }).then((r) => {
          if (mine !== seq.current) return
          if (manual) setManualBusy(false); else setBusy(false)
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
          if (manual) setManualBusy(false); else setBusy(false)
          setErr(String((e && e.message) || e))
          setStale(true)
        })
      }
      React.useEffect(() => { load(false) }, [refreshKey])

      const buildItems = () => {
        const out = []
        const engagements = (data && data.engagements) || []
        for (const eng of engagements) {
          out.push({
            id: 'eng:' + eng.id, kind: 'engagement', parent: null,
            engagement: eng.id, label: eng.name || eng.id, at: eng.created_at || null,
          })
        }
        for (const s of (data && data.sessions) || []) {
          out.push({
            id: 'ses:' + s.id, kind: 'session', parent: 'eng:' + s.engagement,
            engagement: s.engagement, session: s.id, label: s.id,
            at: s.at || null, waiting: s.waiting || null, current: !!s.current,
            short: s.short || s.id,
          })
        }
        return out
      }
      const items = buildItems()
      let graph = null
      let layoutErr = null
      try {
        graph = sessionGraphApplyPositions(sessionGraphLayout(items), positions)
      } catch (e) {
        layoutErr = String((e && e.message) || e)
      }
      const selected = graph === null ? null : (graph.nodes.find((n) => n.id === selectedId) || null)
      const q = query.trim().toLowerCase()
      const hit = (node) => q === '' || String(node.label || '').toLowerCase().indexOf(q) >= 0
        || String(node.engagement || '').toLowerCase().indexOf(q) >= 0

      /* 切靶标必须走 activateEngagement：只调 props.onPick 只是把面板的 state 换掉，
         后端的「当前靶标」指针没动 —— 智能体下一次工具调用仍然打在旧靶标上。
         下拉框走的就是这个 op，两条路径必须同一口径。 */
      const switchEngagement = (id, label) => {
        api({ op: 'activateEngagement', engagement: id, session: props.sessionId || '' }).then((r) => {
          if (!r || r.ok === false) { setMsg({ bad: (r && r.error) || '切换靶标失败' }); return }
          setMsg({ ok: '已切到靶标 ' + (label || id) })
          if (typeof props.onPick === 'function') props.onPick(id)
          load(true)
        }, (e) => setMsg({ bad: String((e && e.message) || e) }))
      }
      const pick = (node) => {
        if (node.kind === 'engagement') { switchEngagement(node.engagement, node.label); return }
        setSelectedId(node.id)
      }
      const onDown = (node, ev) => {
        /* 只认左键：中键/右键拖动会把节点拖走却又不触发 click，看起来像"卡住了" */
        if (!ev || ev.button !== 0) return
        const startX = ev.clientX
        const startY = ev.clientY
        dragRef.current = { id: node.id, x: node.x, y: node.y, startX: startX, startY: startY, moved: false }
        try { ev.currentTarget.setPointerCapture(ev.pointerId) } catch { /* 老浏览器没有指针捕获 */ }
      }
      const onMove = (ev) => {
        const drag = dragRef.current
        if (drag === null) return
        /* 按钮已经松开但 pointerup 丢了（拖出窗口/被别的元素吃掉）：
           这里必须收手，否则鼠标一动节点就跟着跑。 */
        if (ev.buttons === 0) { dragRef.current = null; return }
        const dx = ev.clientX - drag.startX
        const dy = ev.clientY - drag.startY
        if (Math.abs(dx) + Math.abs(dy) < 4) return
        drag.moved = true
        setPositions((prev) => {
          const next = new Map(prev)
          next.set(drag.id, { x: drag.x + dx, y: drag.y + dy })
          return next
        })
      }
      const onCancel = () => { dragRef.current = null }
      const onUp = (node) => {
        const drag = dragRef.current
        dragRef.current = null
        /* 拖过就不算点击：否则每次微拖都会触发「切靶标」 */
        if (drag === null || drag.moved === false) pick(node)
      }
      const relTime = (iso) => {
        const t = Date.parse(String(iso || ''))
        if (!isFinite(t)) return ''
        const d = Math.max(0, Date.now() - t)
        if (d < 60000) return '刚刚'
        if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前'
        if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前'
        return Math.floor(d / 86400000) + ' 天前'
      }
      const dim = { color: 'var(--dsw-alias-label-secondary)' }

      return h('div', { className: 'rt-card rt-sm-card' },
        h('div', { className: 'rt-sm-head' },
          h('h4', null, '会话关系图',
            h('span', { className: 'rt-tag rt-tag-passive', style: { marginLeft: 6 } }, '本机落盘'),
            stale ? h('span', { className: 'rt-tag rt-tag-warn', style: { marginLeft: 6 } }, '数据陈旧') : null,
            data && data.sessions ? h('span', { className: 'rt-tag', style: { marginLeft: 6 } }, data.sessions.length + ' 个会话') : null),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: manualBusy, onClick: () => load(true) },
            manualBusy ? '读取中…' : '刷新')),
        h('div', { className: 'rt-sm-note' },
          '每个会话绑自己的靶标，多会话并行不会把报告写串。点靶标节点切过去；'
          + '点会话节点看它绑在哪、在等谁；拖节点可重排（按靶标隔离，切靶标不串位）。'),
        msg && msg.ok ? h('div', { className: 'rt-sm-ok' }, msg.ok) : null,
        err ? h('div', { className: 'rt-err' }, err) : null,
        layoutErr ? h('div', { className: 'rt-err' },
          layoutErr === 'session-map-too-large'
            ? '节点超过 ' + SM_MAX_NODES + ' 个，图不再渲染（一次画几千个节点会把面板卡死）。'
              + '先按靶标筛选：下面的搜索会把不匹配的节点淡出，但不会减少节点数 ——'
              + '要减少节点请清理不再使用的靶标（或等我们把图改成按靶标分页）。'
            : '布局失败：' + layoutErr) : null,
        !layoutErr && items.length === 0
          ? h('div', { className: 'rt-empty' },
              '还没有会话绑定过靶标。智能体调用 redteam_engagement_open / redteam_session_bind 后会出现在这里。')
          : null,
        !layoutErr && items.length > 0
          ? h('div', { className: 'rt-sm-body' },
              h('div', { className: 'rt-sm-graph-pane' },
                h('input', {
                  className: 'rt-input rt-sm-search',
                  placeholder: '搜索会话 / 靶标（只高亮，不减少节点）',
                  value: query, onChange: (e) => setQuery(e.target.value),
                }),
                h('div', {
                  className: 'rt-sm-graph',
                  style: { width: graph.width + 'px', height: graph.height + 'px' },
                },
                  h('svg', {
                    className: 'rt-sm-svg', width: graph.width, height: graph.height,
                    viewBox: '0 0 ' + graph.width + ' ' + graph.height,
                  }, graph.edges.map((edge) => h('path', {
                    key: 'e:' + edge.from + '>' + edge.to,
                    className: 'rt-sm-edge' + (edge.to.indexOf('ses:') === 0 ? '' : ' orphan'),
                    d: smEdgePath(edge),
                  }))),
                  graph.nodes.map((node) => h('div', {
                    key: node.id,
                    className: 'rt-sm-node'
                      + (node.kind === 'engagement' ? ' is-eng' : ' is-ses')
                      + (node.current ? ' is-current' : '')
                      + (node.id === selectedId ? ' is-selected' : '')
                      + (hit(node) ? '' : ' is-dim')
                      + (node.waiting ? ' is-waiting' : ''),
                    style: { left: node.x + 'px', top: node.y + 'px', width: SM_NODE_W + 'px', height: SM_NODE_H + 'px' },
                    title: node.kind === 'engagement' ? '点一下切到这个靶标' : '点一下看详情',
                    onPointerDown: (ev) => onDown(node, ev),
                    onPointerMove: onMove,
                    onPointerUp: () => onUp(node),
                    onPointerCancel: onCancel,
                    onLostPointerCapture: onCancel,
                  },
                    h('div', { className: 'rt-sm-node-title' },
                      node.kind === 'engagement' ? '靶标' : '会话',
                      node.current ? h('span', { className: 'rt-tag rt-tag-live', style: { marginLeft: 4 } }, '本会话') : null),
                    h('div', { className: 'rt-sm-node-label' }, node.label || node.id),
                    h('div', { className: 'rt-sm-node-sub' },
                      node.kind === 'engagement'
                        ? ((data && data.count_by_engagement && data.count_by_engagement[node.engagement]) || 0) + ' 个会话'
                        : relTime(node.at)),
                    node.waiting
                      ? h('div', { className: 'rt-sm-node-wait' },
                          '在等：' + (node.waiting.reason || node.waiting.stage || node.waiting.status || '人工介入'))
                      : null)))
              ),
              h('div', { className: 'rt-sm-detail' },
                selected === null
                  ? h('div', { className: 'rt-sm-detail-empty' }, '点左侧节点看详情')
                  : h('div', null,
                      h('div', { className: 'rt-sm-detail-title' },
                        selected.kind === 'engagement' ? (selected.label || selected.engagement) : (selected.session || '')),
                      h('div', { className: 'rt-sm-kv' },
                        h('span', null, '类型'), h('b', null, selected.kind === 'engagement' ? '靶标' : '会话')),
                      h('div', { className: 'rt-sm-kv' },
                        h('span', null, '靶标'), h('b', null, selected.engagement || '—')),
                      selected.kind === 'session'
                        ? h('div', { className: 'rt-sm-kv' },
                            h('span', null, '绑定时间'), h('b', null, relTime(selected.at) || '—'))
                        : null,
                      selected.waiting
                        ? h('div', { className: 'rt-sm-kv' },
                            h('span', null, '在等'),
                            h('b', null, (selected.waiting.status || '') + ' · '
                              + (selected.waiting.reason || selected.waiting.stage || '')))
                        : null,
                      h('div', { className: 'rt-sm-actions' },
                        selected.kind === 'engagement'
                          ? h('button', {
                              className: 'rt-btn',
                              onClick: () => switchEngagement(selected.engagement, selected.label),
                            }, '切到这个靶标')
                          : h('button', {
                              className: 'rt-btn',
                              disabled: !props.sessionId,
                              title: props.sessionId ? '' : '面板没拿到当前会话 id',
                              onClick: () => {
                                api({ op: 'bindSessionEngagement', session: props.sessionId, engagement: selected.engagement })
                                  .then((r) => {
                                    if (!r || r.ok === false) { setMsg({ bad: (r && r.error) || '绑定失败' }); return }
                                    setMsg({ ok: '本会话已绑到 ' + selected.engagement })
                                    load(true)
                                  }, (e) => setMsg({ bad: String((e && e.message) || e) }))
                              },
                            }, '把本会话绑到这个靶标'))),
                msg && msg.bad ? h('div', { className: 'rt-err' }, msg.bad) : null))
          : null,
        busy ? h('div', { className: 'rt-sm-busy' }, '读取中…') : null)
    }
