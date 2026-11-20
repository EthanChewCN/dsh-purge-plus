    /* [dsh-purge-plus] P12 证据账本 ─────────────────────────────────────
       本包独有的一页，两边上游都没有。

       为什么要它：这个包的核心纪律是「子智能体说『我拿到了』不算，必须核实」——
       账本用内容哈希把 claimed / observed 分开，工具层也拒收未核实的结论。
       但这条纪律此前只活在工具描述里：面板上看不见「还有几条没核实」，
       于是汇报时没人被提醒，纪律等于没有出口。

       这一页要回答三个问题，顺序不能反：
         ① 还有几条是别人说的、我没核过？（unresolved_claims）
         ② 这些条目分别是什么、谁报的、什么权威等级？
         ③ 还有哪些作战问题没解决？（unknowns）
       ⚠️ 「账本是空的」与「全部核实完毕」必须长得不一样：
          前者是还没开始记账，后者是绿灯。混在一起看就是假绿灯。 */

    const CONF_LABEL = {
      claimed: '声称（未核实）',
      observed: '已核实',
      derived: '推理',
      inferred: '推测',
    }
    const CONF_TONE = { claimed: 'warn', inferred: 'warn', observed: 'ok', derived: 'mute' }

    function EvidenceRow(props) {
      const e = props.item
      const [open, setOpen] = React.useState(false)
      const conf = String(e.confidence || 'inferred')
      const result = e.result === null || e.result === undefined
        ? ''
        : (typeof e.result === 'string' ? e.result : JSON.stringify(e.result))
      return h('div', { className: 'rt-card' },
        h('div', { className: 'rt-toolbar' },
          h('span', { className: 'rt-tag rt-ev-' + (CONF_TONE[conf] || 'mute') }, CONF_LABEL[conf] || conf),
          h('span', { className: 'rt-mono' }, e.operation || '（未命名操作）'),
          e.authority ? h('span', { className: 'rt-tag' }, e.authority) : null,
          h('div', { className: 'rt-spacer' }),
          h('span', { className: 'rt-mono', title: e.ev_id }, String(e.ev_id || '').slice(0, 12) + '…'),
          h('button', { className: 'rt-btn', onClick: (ev) => { ev.stopPropagation(); setOpen((v) => !v) } }, open ? '收起' : '展开'),
        ),
        h('div', { className: 'rt-mono' },
          [e.source_agent ? '产出 ' + e.source_agent : null,
            e.recorded_by ? '记账 ' + e.recorded_by : null,
            e.recorded_at ? fmt(e.recorded_at) : null,
            e.integrity === 'unverified' ? '哈希校验未通过（原始列）' : null].filter(Boolean).join(' · ')),
        open
          ? h('div', { className: 'rt-ev-detail' },
            result ? h('pre', { className: 'rt-ev-pre' }, result) : h('div', { className: 'rt-empty' }, '没有结果字段'),
            (e.limitations || []).length > 0 ? h('div', { className: 'rt-mono' }, '局限：' + (e.limitations || []).join('；')) : null,
            (e.supporting_ev_ids || []).length > 0 ? h('div', { className: 'rt-mono' }, '支撑证据：' + (e.supporting_ev_ids || []).join(' ')) : null,
            e.parameters && Object.keys(e.parameters || {}).length > 0
              ? h('pre', { className: 'rt-ev-pre' }, JSON.stringify(e.parameters, null, 2))
              : null)
          : null,
      )
    }

    function EvidenceTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [conf, setConf] = React.useState('')

      const load = () => {
        if (!eng) { setData(null); return }
        setBusy(true); setErr(null)
        api({ op: 'evidenceLedger', engagement: eng, confidence: conf, limit: 200 }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
          setData(r)
        }, (e) => { setBusy(false); setErr(String((e && e.message) || e)) })
      }
      React.useEffect(load, [eng, refreshKey, conf])

      if (!eng) return h('div', { className: 'rt-empty' }, '先在顶部选择或创建一个靶标')
      if (err) return h('div', { className: 'rt-err' }, err)
      if (busy && data === null) return h('div', { className: 'rt-empty' }, '读取账本…')

      const items = (data && data.items) || []
      const unknowns = (data && data.unknowns) || []
      const unverified = (data && data.unverified) || 0
      const unresolved = (data && data.unresolved_claims) || 0
      const errors = (data && data.errors) || []

      /* 三种状态必须长得不一样：还没记账 / 有未核实 / 全部核实完毕 */
      const headline = data && data.empty
        ? h('div', { className: 'rt-card rt-ev-headline' },
          h('div', { className: 'rt-ev-big' }, '账本还是空的'),
          h('div', { className: 'rt-mono' }, '不是"全部核实完毕"，是还没开始记账。用 redteam_evidence_record 记第一条。'))
        : unresolved > 0
          ? h('div', { className: 'rt-card rt-ev-headline warn' },
            h('div', { className: 'rt-ev-big' }, unresolved + ' 条未闭环'),
            h('div', { className: 'rt-mono' }, '这些是"别人说拿到了、你还没核过"的结论。汇报前先 redteam_evidence_upgrade 或 redteam_evidence_verify。'))
          : h('div', { className: 'rt-card rt-ev-headline ok' },
            h('div', { className: 'rt-ev-big' }, '没有未闭环的声称'),
            h('div', { className: 'rt-mono' }, '账本共 ' + ((data && data.total) || 0) + ' 条，' + unverified + ' 条 claimed/inferred（含已核实的）。'))

      return h('div', { className: 'rt-pane' },
        headline,
        errors.length > 0 ? h('div', { className: 'rt-err' }, '部分读取失败：' + errors.join('；')) : null,
        h('div', { className: 'rt-toolbar rt-ev-filter' },
          ['', 'claimed', 'observed', 'derived', 'inferred'].map((k) => h('button', {
            key: 'f' + (k || 'all'),
            className: 'rt-tab' + (conf === k ? ' on' : ''),
            onClick: () => setConf(k),
          }, k === '' ? '全部' : (CONF_LABEL[k] || k))),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? '刷新中…' : '刷新')),
        items.length === 0
          ? h('div', { className: 'rt-empty' }, conf ? '这个置信度下没有条目' : '还没有证据条目')
          : h('div', { className: 'rt-ev-list' }, items.map((e) => h(EvidenceRow, { key: 'e' + e.ev_id, item: e }))),
        h('div', { className: 'rt-ev-section' }, '未解决的作战问题（' + ((data && data.unknown_total) || 0) + '）'),
        unknowns.length === 0
          ? h('div', { className: 'rt-empty' }, '没有登记未解决问题。打完一轮还是空的，说明这一轮的问题都收口了。')
          : h('div', { className: 'rt-ev-list' }, unknowns.map((u) => h('div', { key: 'u' + u.unk_id, className: 'rt-vrow' },
            h('span', { className: 'rt-tag' }, u.severity || 'low'),
            h('span', { className: 'rt-mono' }, u.status || 'open'),
            h('span', { className: 'rt-mono' }, u.domain || '—'),
            h('span', { style: { gridColumn: 'span 2' } }, u.question || '')))),
      )
    }
