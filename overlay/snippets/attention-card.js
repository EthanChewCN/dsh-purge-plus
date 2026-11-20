    /**
     * [dsh-purge-plus] 「现在在等谁」。
     *
     * 与上游 safe 的 AttentionToast 不是同一份实现：safe 的胶囊挂在插件主面板
     * （sidebar.panellist 之外的 overlay）上，只在插件面板打开时才看得见；这里做成
     * 演练台智能体页的一张卡，任何时候进这一页都能看到，并且**可以就地收口**
     * （safe 的胶囊只能看，收口得另外调 op）。
     *
     * 三处刻意的取舍：
     *   1. 不轮询：只在 refreshKey 变化或手动刷新时取一次，避免后台常驻请求。
     *   2. 收口后立刻用返回的新队列覆盖（attentionAck 本来就返回队列），不额外再拉一次。
     *   3. 覆盖度引擎未移植时，note 会明说「这条结论只覆盖智能体回报这一路」，
     *      不把「看不到缺口」说成「没有缺口」。
     */
    function AttentionCard(props) {
      const refreshKey = props.refreshKey || 0
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const load = () => {
        setBusy(true)
        api({ op: 'attention', session: props.sessionId || '', engagement: props.engagement || undefined }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
          setErr(null)
          setData(r)
        }, (e) => { setBusy(false); setErr(String((e && e.message) || e)) })
      }
      React.useEffect(load, [refreshKey, props.engagement])

      const ack = (payload) => {
        setBusy(true)
        api(Object.assign({ op: 'attentionAck', session: props.sessionId || '', engagement: props.engagement || undefined }, payload)).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setErr((r && r.error) || '收口失败'); return }
          setErr(null)
          setData(r)
        }, (e) => { setBusy(false); setErr(String((e && e.message) || e)) })
      }

      const items = (data && data.items) || []
      const total = data ? data.total : null
      const awaiting = data ? data.awaiting_person : 0
      const shortId = (s) => (String(s || '').length > 14 ? String(s).slice(0, 8) + '…' + String(s).slice(-4) : String(s || ''))
      const statusLabel = { waiting: '等解答', ready: '等验收', blocked: '受阻', failed: '失败', progress: '在跑' }
      const statusClass = (st) => (st === 'waiting' || st === 'ready') ? 'rt-tag rt-tag-warn'
        : (st === 'blocked' || st === 'failed') ? 'rt-tag rt-tag-err' : 'rt-tag rt-tag-live'
      const dim = { color: 'var(--dsw-alias-label-secondary)' }

      return h('div', { className: 'rt-card' },
        h('h4', null, '现在在等谁',
          total === null ? null : h('span', {
            className: 'rt-tag' + (awaiting > 0 ? ' rt-tag-warn' : ' rt-tag-passive'),
            style: { marginLeft: 6 },
          }, awaiting > 0 ? (awaiting + ' 个在等人') : (total > 0 ? (total + ' 个在跑') : '没有人在等')),
          data && data.coverage_available === false
            ? h('span', { className: 'rt-tag rt-tag-passive', style: { marginLeft: 6 }, title: '覆盖度引擎未移植：pending_coverage 恒为 0，不代表没有缺口' }, '覆盖度未接')
            : null),
        h('div', { style: { fontSize: 11.5, marginBottom: 8, lineHeight: 1.7, color: dim.color } },
          '按「最需要人」排序：等解答 > 等验收 > 受阻 > 失败 > 在跑。子智能体在最后一条消息里写 redteamReport 就会出现在这里。'),
        err ? h('div', { className: 'rt-err' }, err) : null,
        items.length === 0
          ? h('div', { className: 'rt-empty' }, (data && data.note) || '还没有智能体回报。')
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              items.map((it) => h('div', {
                key: it.session_id,
                style: {
                  display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline',
                  padding: '6px 8px', borderRadius: 6,
                  background: 'var(--dsw-alias-bg-layered)',
                },
              },
              h('span', { className: statusClass(it.status) }, statusLabel[it.status] || it.status),
              h('span', { style: { fontWeight: 600, fontSize: 12 } }, it.label || shortId(it.session_id)),
              it.role ? h('span', { style: { fontSize: 11, color: dim.color } }, it.role) : null,
              it.reason ? h('span', { style: { fontSize: 11.5 } }, it.reason) : null,
              (it.needs || []).map((n, i) => h('span', {
                key: i, className: 'rt-tag rt-tag-passive', title: n.kind || '',
              }, n.detail || n.kind || '')),
              h('div', { style: { flex: 1 } }),
              h('button', {
                className: 'rt-btn',
                disabled: busy,
                title: '这条已经处理过（问到答案 / 派了新活 / 确认作废）',
                onClick: () => ack({ session_id: it.session_id }),
              }, '已处理')))),
        h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? '读取中…' : '刷新'),
          total > 0
            ? h('button', { className: 'rt-btn', disabled: busy, onClick: () => ack({ all: true }) }, '全部已处理')
            : null,
          data && data.pending_coverage > 0
            ? h('span', { className: 'rt-tag rt-tag-warn', style: { alignSelf: 'center' } }, '另有 ' + data.pending_coverage + ' 个覆盖度缺口')
            : null))
    }
