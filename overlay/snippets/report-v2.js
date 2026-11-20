    /* [dsh-purge-plus] P8 四段式交付报告 ─────────────────────────────
       上游（community / safe 的旧版）的报告页是「一列平铺卡片」：能看，但没法交付。
       验收人拿到它要自己回答三个问题——这些资产凭什么算我们的？一共多少分？
       这一条我怎么重做一遍？四段式就是把这三件事写成有编号的文档。

       与 safe 的差异：safe 的 ReportV2 依赖 host 侧额外生成 report 模型，
       本包没有那条数据通路，所以 reportV2 由 store 侧从 scoreReport 的同一批条目
       重新组织 —— 分值一个都不重算，避免「报告 350、面板 320」。

       ⚠️ 用 ReportTabPlus 包一层而不是改 ReportTab：原有条目式视图必须还在。
         数据出任何问题（老库缺表、账本对不上）就退回它，而不是给人一个白页。 */

    const R2_CONF = {
      strong: { label: '强', cls: ' rt-r2-strong' },
      weak: { label: '弱', cls: ' rt-r2-weak' },
    }

    function R2ProofCard(props) {
      const p = props.item
      const tone = R2_CONF[p.strength] || R2_CONF.weak
      return h('div', { className: 'rt-r2-proof' },
        h('div', { className: 'rt-toolbar' },
          h('span', { className: 'rt-mono rt-r2-ip' }, p.ip || '—'),
          p.name ? h('span', { className: 'rt-tag' }, p.name) : null,
          h('span', { className: 'rt-tag' }, p.scope === 'internal' ? '内网' : '互联网'),
          h('span', { className: 'rt-tag' + tone.cls }, '归属证明：' + tone.label),
          h('div', { className: 'rt-spacer' }),
          p.shots > 0 ? h('span', { className: 'rt-mono' }, p.shots + ' 图') : null,
        ),
        h('div', { className: 'rt-r2-ev' }, (p.evidence || []).map((e, i) => h('div', { key: 'ev' + i, className: 'rt-r2-evline' },
          h('span', { className: 'rt-r2-evkind' }, e.label || e.kind || '证据'),
          h('span', null, e.detail || '')))))
    }

    function R2ReproCard(props) {
      const x = props.item
      const [openHttp, setOpenHttp] = React.useState(false)
      return h('article', { className: 'rt-r2-repro' },
        h('div', { className: 'rt-r2-repro-head' },
          h('span', { className: 'rt-r2-no' }, String(x.chain_no)),
          h('span', { className: 'rt-r2-name' }, x.point_name || x.code || '（未命名得分点）'),
          h('span', { className: 'rt-tag rt-tag-live' }, '+' + (x.points || 0) + ' 分'),
          x.counted === false ? h('span', { className: 'rt-tag rt-tag-warn' }, '未计入') : null,
          x.incomplete ? h('span', { className: 'rt-tag rt-tag-warn' }, '复现链不完整') : null,
        ),
        h('div', { className: 'rt-r2-target' },
          h('span', { className: 'rt-mono' }, x.target || x.asset_ip || '—'),
          x.vuln ? h('span', { className: 'rt-mono' }, (x.vuln.cve ? x.vuln.cve + ' ' : '') + (x.vuln.title || '')) : null),
        x.evidence ? h('div', { className: 'rt-r2-evidence' }, x.evidence) : null,
        x.replay_cmd
          ? h('div', { className: 'rt-r2-cmd' },
            h('div', { className: 'rt-r2-cmd-head' },
              h('span', null, x.replay_cmd_kind === 'template' ? '复现命令（按得分点模板填好）'
                : (x.replay_cmd_kind === 'real' ? '复现命令（当日实际执行）' : '复现命令')),
              h('div', { className: 'rt-spacer' }),
              h('button', { className: 'rt-btn', onClick: () => copyText(String(x.replay_cmd)) }, '复制')),
            h('pre', { className: 'rt-r2-pre' }, x.replay_cmd),
            (x.replay_cmd_unfilled || []).length > 0
              ? h('div', { className: 'rt-mono rt-r2-gap' }, '未填占位符：' + (x.replay_cmd_unfilled || []).join(' '))
              : null)
          : null,
        (x.http || []).length > 0
          ? h('div', { className: 'rt-r2-http' },
            h('div', { className: 'rt-r2-cmd-head' },
              h('button', { className: 'rt-btn', onClick: () => setOpenHttp((v) => !v) },
                (openHttp ? '收起' : '展开') + '原始报文（' + (x.http_total || x.http.length) + '）'),
              h('div', { className: 'rt-spacer' }),
              h('button', { className: 'rt-btn', onClick: () => copyText(String((x.http[0] || {}).request || '')) }, '复制首条到 Yakit')),
            openHttp
              ? h('div', null, (x.http || []).map((r, i) => h('div', { key: 'h' + i },
                h('div', { className: 'rt-mono' }, (r.method || 'GET') + ' ' + (r.url || '')
                  + (r.label ? '　' + r.label : '') + (r.source === 'auto' ? '　（按目标自动匹配，需核对）' : '')),
                h('pre', { className: 'rt-r2-pre' }, r.request || ''),
                r.response ? h('pre', { className: 'rt-r2-pre rt-r2-pre-dim' }, String(r.response).slice(0, 1200)) : null)))
              : null)
          : null,
        (x.shots || []).length > 0
          ? h('div', { className: 'rt-r2-shots' }, (x.shots || []).map((s) => h('div', { key: 's' + s.id, className: 'rt-r2-shot' },
            h('img', { src: s.url, alt: s.label || '证据截图', loading: 'lazy' }),
            h('span', { className: 'rt-mono' }, s.label || s.kind || ''))))
          : null,
        (x.attack_files || []).length > 0
          ? h('div', { className: 'rt-mono rt-r2-files' }, '攻击文件：' + (x.attack_files || []).map((f) => f.name + '（' + f.path + '）').join('、'))
          : null,
        (x.gaps || []).length > 0
          ? h('div', { className: 'rt-r2-gaps' }, (x.gaps || []).map((g, i) => h('div', { key: 'g' + i, className: 'rt-r2-gap' }, '· ' + g)))
          : null,
      )
    }

    function R2ReproList(props) {
      const list = props.items || []
      if (list.length === 0) return h('div', { className: 'rt-empty' }, props.empty || '无')
      return h('div', { className: 'rt-r2-list' }, list.map((x) => h(R2ReproCard, { key: 'r' + x.chain_no, item: x })))
    }

    function ReportV2(props) {
      const d = props.data || {}
      const s = d.summary || {}
      const [msg, setMsg] = React.useState(null)
      /* [dsh-purge-plus] 文档视图：交付物本体（markdown）就地渲染。
         卡片视图回答「分从哪来」，文档视图回答「交付物长什么样」，两个都要。 */
      const [doc, setDoc] = React.useState(false)
      const mdText = d.markdown || ''
      const copyMd = () => {
        copyText(mdText)
        setMsg({ ok: '已复制整份报告（' + mdText.length + ' 字符）' })
      }
      const downloadMd = () => {
        try {
          const blob = new Blob([mdText], { type: 'text/markdown;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = 'report-' + String(d.target || 'score').replace(/[^\w.\-]/g, '_') + '.md'
          a.click()
          URL.revokeObjectURL(url)
          setMsg({ ok: '已下载 markdown' })
        } catch (e) { setMsg({ err: '下载失败：' + ((e && e.message) || e) }) }
      }
      const proofSec = (title, list, empty) => h('div', { className: 'rt-r2-sec' },
        h('h4', { className: 'rt-r2-h4' }, title),
        (list || []).length === 0
          ? h('div', { className: 'rt-empty' }, empty)
          : h('div', { className: 'rt-r2-proofs' }, (list || []).map((p) => h(R2ProofCard, { key: 'p' + p.asset_id, item: p }))))

      const stageTable = h('div', { className: 'rt-r2-sec' },
        h('h4', { className: 'rt-r2-h4' }, '二、得分汇总表'),
        (d.stage_summary || []).length === 0
          ? h('div', { className: 'rt-empty' }, '还没有得分记录')
          : h('table', { className: 'rt-r2-table' },
            h('thead', null, h('tr', null, ['阶段', '计分项', '得分', '累计'].map((t) => h('th', { key: t }, t)))),
            h('tbody', null,
              (d.stage_summary || []).map((st) => h('tr', { key: 's' + st.code },
                h('td', null, (st.ordinal ? st.ordinal + '. ' : '') + st.name),
                h('td', null, String(st.count)),
                h('td', null, '+' + st.points),
                h('td', null, '+' + st.cumulative))),
              h('tr', { className: 'rt-r2-total' },
                h('td', null, '合计'), h('td', null, String(s.items || 0)),
                h('td', null, '+' + (s.points || 0)), h('td', null, '')))),
        (d.stage_summary || []).map((st) => {
          const rows = (d.stage_tables || {})[st.code] || []
          if (rows.length === 0) return null
          const head = h('thead', null, h('tr', null,
            ['#', '计分项', '目标', '分值', '证据'].map((t) => h('th', { key: t }, t))))
          const rowsJsx = h('tbody', null, rows.map((r) => h('tr', { key: 'tr' + r.chain_no },
            h('td', null, String(r.chain_no)),
            h('td', null, r.point_name || r.code || ''),
            h('td', { className: 'rt-mono' }, r.target || r.asset_ip || '—'),
            h('td', null, (r.counted === false ? '（' : '+') + r.points + (r.counted === false ? '）' : '')),
            h('td', { className: 'rt-r2-td-ev' }, r.evidence || ''),
          )))
          return h('div', { key: 't' + st.code, className: 'rt-r2-sub' },
            h('div', { className: 'rt-r2-subhead' }, st.name),
            h('table', { className: 'rt-r2-table' }, head, rowsJsx))
        }))

      const reproSec = h('div', { className: 'rt-r2-sec' },
        h('h4', { className: 'rt-r2-h4' }, '三、得分点复现'),
        h('div', { className: 'rt-r2-subhead' }, '3.1 互联网资产'),
        h(R2ReproList, { items: (d.repro || {}).internet, empty: '无互联网资产得分项' }),
        h('div', { className: 'rt-r2-subhead' }, '3.2 边界突破'),
        h(R2ReproList, { items: (d.repro || {}).boundary, empty: '无边界突破得分项' }),
        h('div', { className: 'rt-r2-subhead' }, '3.3 内网（按网段）'),
        ((d.repro || {}).internal_segments || []).length === 0
          ? h('div', { className: 'rt-empty' }, '无内网资产得分项')
          : h('div', null, ((d.repro || {}).internal_segments || []).map((seg) => h('div', { key: 'sg' + seg.segment, className: 'rt-r2-seg' },
            h('div', { className: 'rt-r2-seghead' }, h('span', { className: 'rt-mono' }, seg.segment),
              h('span', { className: 'rt-tag' }, seg.count + ' 项'),
              h('span', { className: 'rt-tag rt-tag-live' }, '+' + seg.points + ' 分')),
            h(R2ReproList, { items: seg.items })))),
        h('div', { className: 'rt-r2-subhead' }, '3.4 靶标权限'),
        h(R2ReproList, { items: (d.repro || {}).target, empty: '无靶标权限得分项' }))

      const cleanup = d.cleanup || { total: 0, open: 0, items: [] }
      const cleanupSec = h('div', { className: 'rt-r2-sec' },
        h('h4', { className: 'rt-r2-h4' }, '四、交付清单（我们留下了什么）'),
        cleanup.total === 0
          ? h('div', { className: 'rt-empty' }, '没有登记清理项。如果确实留了 webshell / 账号 / 隧道，这一栏是空的就等于没交代。')
          : h('div', null,
            h('div', { className: 'rt-mono rt-r2-clean-sum' }, '共 ' + cleanup.total + ' 项：未处理 ' + cleanup.open
              + ' · 已清理 ' + cleanup.done + ' · 不处理 ' + cleanup.wontfix
              + (cleanup.open > 0 ? '　⚠️ 还有未处理项，交付前逐条给结论' : '')),
            h('table', { className: 'rt-r2-table' },
              h('thead', null, h('tr', null, ['类型', '位置', '说明', '状态'].map((t) => h('th', { key: t }, t)))),
              h('tbody', null, (cleanup.items || []).map((c) => h('tr', { key: 'c' + c.id },
                h('td', null, c.kind || ''),
                /* 位置列：优先 location（文件路径 / 账号名 / 隧道端口），退回 target（主机）。
                   只显示 target 时，同一台机器上的两个 webshell 在表里长得一模一样。 */
                h('td', { className: 'rt-mono' }, c.location || c.target || ''),
                h('td', null, c.title || c.detail || ''), h('td', null, c.status || '')))))))

      const orphanList = (d.asset_proof || {}).orphan || []
      const orphanSec = orphanList.length === 0 ? null : h('div', null,
        h('div', { className: 'rt-r2-subhead' }, '1.3 未挂资产的证明（只写了目标）'),
        h('div', { className: 'rt-r2-proofs' }, orphanList.map((o) => {
          const bar = h('div', { className: 'rt-toolbar' },
            h('span', { className: 'rt-mono' }, o.target),
            h('span', { className: 'rt-tag' }, o.total_rows + ' 行'),
            h('div', { className: 'rt-spacer' }),
            h('span', { className: 'rt-mono' }, '补 asset_id 才能进 1.1/1.2'))
          return h('div', { key: 'o' + o.target, className: 'rt-r2-proof' }, bar)
        })))

      return h('div', { className: 'rt-main rt-r2' },
        h('div', { className: 'rt-toolbar rt-r2-bar' },
          h('span', { style: { fontWeight: 600 } }, '得分复现报告（四段式）'),
          h('span', { className: 'rt-tag rt-tag-live' }, '合计 ' + (s.points || 0) + ' 分'),
          h('span', { className: 'rt-tag' }, (s.items || 0) + ' 个计分项'),
          h('span', { className: 'rt-tag' + (s.complete ? ' rt-tag-live' : ' rt-tag-warn') },
            '可复现 ' + (s.reproducible || 0) + '/' + (s.items || 0)),
          s.data_proofs > 0 ? h('span', { className: 'rt-tag' }, '数据证明 ' + s.data_proofs + ' 条 / ' + (s.data_proof_rows || 0) + ' 行') : null,
          h('div', { className: 'rt-spacer' }),
          h('button', {
            className: 'rt-btn' + (doc ? ' rt-btn-primary' : ''),
            onClick: () => setDoc(!doc),
          }, doc ? '卡片视图' : '文档视图'),
          h('button', { className: 'rt-btn', onClick: () => props.onSwitch && props.onSwitch() }, '条目式'),
          h('button', { className: 'rt-btn', disabled: !mdText, onClick: copyMd }, '复制全文'),
          h('button', { className: 'rt-btn', disabled: !mdText, onClick: downloadMd }, '下载 .md')),
        msg ? h('div', { className: msg.ok ? 'rt-mono' : 'rt-err' }, msg.ok || msg.err) : null,
        doc
          ? h(MarkdownDoc, { text: mdText })
          : h('div', null,
        h('div', { className: 'rt-r2-sec' },
          h('h4', { className: 'rt-r2-h4' }, '一、资产归属证明'),
          h('div', { className: 'rt-r2-subhead' }, '1.1 互联网资产'),
          ((d.asset_proof || {}).internet || []).length === 0
            ? h('div', { className: 'rt-empty' }, '没有可归属的互联网资产：先记录得分或数据证明，这一栏才有内容')
            : h('div', { className: 'rt-r2-proofs' }, ((d.asset_proof || {}).internet || []).map((p) => h(R2ProofCard, { key: 'i' + p.asset_id, item: p }))),
          h('div', { className: 'rt-r2-subhead' }, '1.2 内网入口资产'),
          ((d.asset_proof || {}).internal_entry || []).length === 0
            ? h('div', { className: 'rt-empty' }, '还没有真正进去的内网资产（只有被发现、没有会话/凭据/通道的不算入口）')
            : h('div', { className: 'rt-r2-proofs' }, ((d.asset_proof || {}).internal_entry || []).map((p) => h(R2ProofCard, { key: 'n' + p.asset_id, item: p }))),
          orphanSec),
        stageTable,
        reproSec,
        cleanupSec,
      ))
    }

    /* 外层开关：V2 拿不到数据就原样退回条目式视图，不给人白页。 */
    function ReportTabPlus(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [v2, setV2] = React.useState(null)
      const [v2err, setV2err] = React.useState(null)
      const [view, setView] = React.useState('v2')
      React.useEffect(() => {
        if (!eng) { setV2(null); return }
        let alive = true
        api({ op: 'reportV2', engagement: eng }).then((r) => {
          if (!alive) return
          if (!r || r.ok === false) { setV2err((r && r.error) || '四段式报告生成失败'); setV2(null); return }
          setV2err(null)
          setV2(r)
        }, (e) => { if (alive) { setV2err(String((e && e.message) || e)); setV2(null) } })
        return () => { alive = false }
      }, [eng, refreshKey])
      if (view === 'v2' && v2) {
        return h(ReportV2, { data: v2, eng: eng, onSwitch: () => setView('v1') })
      }
      return h('div', { className: 'rt-r2-fallback' },
        v2err ? h('div', { className: 'rt-mono rt-r2-gap' }, '四段式报告不可用，已退回条目式：' + v2err) : null,
        v2 ? h('div', { className: 'rt-toolbar' },
          h('button', { className: 'rt-btn', onClick: () => setView('v2') }, '切回四段式')) : null,
        h(ReportTab, props))
    }
