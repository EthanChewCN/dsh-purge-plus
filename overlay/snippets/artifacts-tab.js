    /* [dsh-purge-plus] 凭据与文件 ─────────────────────────────────────
       移植自 dsh-purge-safe 2.0.0（Apache-2.0），来源：
         safe/lib/redteam/client.js:592-605   SecretText
         safe/lib/redteam/client.js:11463-11487 CredentialList
         safe/lib/redteam/client.js:11488-11501 AccessList
         safe/lib/redteam/client.js:11502-11545 ArtifactsTab
       改写点（记录在 NOTICE-PLUS.md）：
         1. 只复用本基座已有的 CSS 类（rt-card / rt-vrow / rt-tag / rt-mono /
            rt-empty / rt-pane / rt-toolbar / rt-btn / rt-secret），
            不引入 safe 的 16 个 css —— 那 16 个在 safe 里也是零引用的死资产。
         2. 数据源不变：attackFiles / credentials / access 三个 op 本基座全有。
       为什么要它：safe 把「凭据 / 访问会话 / 攻击文件」从漏洞战果里拆出来单开一页，
       本基座仍混在漏洞战果里，靠滚动找；拆开后带掩码、一键复制、按类折叠。 */

    function SecretText(props) {
      const value = String(props.value === undefined || props.value === null ? '' : props.value)
      const [shown, setShown] = React.useState(false)
      if (value === '') return h('span', { className: 'rt-empty' }, props.empty || '未记录')
      return h('span', { className: props.className || 'rt-mono', style: { display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' } },
        h('span', { style: { wordBreak: 'break-all' } }, shown ? value : '••••••••'),
        h('button', { className: 'rt-btn', onClick: (e) => { e.stopPropagation(); setShown((v) => !v) } }, shown ? '隐藏' : '显示'))
    }

    function CredentialList(props) {
      const creds = props.items || []
      if (!creds.length) return h('div', { className: 'rt-empty' }, '暂无凭据（拿到口令/密钥/Hash 后用 redteam_credential_add 落库，秒级可复用）')
      return h('div', { className: 'rt-pane' }, creds.map((c) => h('article', { key: 'c' + c.id, className: 'rt-card' },
        h('div', { className: 'rt-toolbar' },
          h('span', { className: 'rt-mono' }, c.host),
          c.username ? h('span', { className: 'rt-tag' }, c.username) : null,
          h('span', { className: 'rt-tag' }, c.secret_type || 'password'),
          c.privilege ? h('span', { className: 'rt-tag' }, c.privilege) : null,
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', onClick: (e) => { e.stopPropagation(); copyText(String(c.secret_value || '')) } }, '复制')),
        h('div', null, h(SecretText, { value: c.secret_value, empty: '未记明文 —— 用 redteam_credential_add 的 secret_value 补上，面板才能直显' })),
        h('div', { className: 'rt-mono' },
          [c.source ? '来源 ' + c.source : null,
            c.tool ? '工具 ' + c.tool : null,
            c.secret_ref ? '证据 ' + c.secret_ref : null,
            c.found_by_agent ? 'by ' + c.found_by_agent : null,
            c.found_at ? fmt(c.found_at) : null].filter(Boolean).join(' · ')),
        c.note ? h('div', { className: 'rt-mono' }, '备注：' + c.note) : null)))
    }

    function AccessList(props) {
      const accesses = props.items || []
      if (!accesses.length) return h('div', { className: 'rt-empty' }, '暂无访问会话')
      return h('div', { className: 'rt-pane' }, accesses.map((a) => h('div', { key: 'a' + a.id, className: 'rt-vrow' },
        h('span', { className: 'rt-mono' }, a.host),
        h('span', null, a.username || '—'),
        h('span', { className: 'rt-tag' }, a.method || '—'),
        h('span', null, a.privilege || '—'),
        h('span', { className: 'rt-mono', title: a.session_ref || '' }, a.session_ref || '—'))))
    }

    function ArtifactsTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [files, setFiles] = React.useState([])
      const [creds, setCreds] = React.useState([])
      const [accesses, setAccesses] = React.useState([])
      const [busy, setBusy] = React.useState(false)

      const load = () => {
        if (!eng) return
        setBusy(true)
        api({ op: 'attackFiles', engagement: eng }).then((r) => setFiles((r && r.items) || []), () => {})
        api({ op: 'credentials', engagement: eng }).then((r) => setCreds((r && r.items) || []), () => {})
        api({ op: 'access', engagement: eng }).then((r) => setAccesses((r && r.items) || []), () => {})
        setBusy(false)
      }
      React.useEffect(load, [eng, refreshKey])

      const fileCount = (files || []).reduce((n, g) => n + (g.files || []).length, 0)
      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, '凭据与文件'),
          h('span', { className: 'rt-tag' }, '凭据 ' + creds.length),
          h('span', { className: 'rt-tag' }, '访问会话 ' + accesses.length),
          h('span', { className: 'rt-tag' }, '攻击文件 ' + fileCount),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? '刷新中…' : '刷新')),
        h('details', { className: 'rt-card', open: true },
          h('summary', null, '凭据 · ' + creds.length + '（默认脱敏，点开查看）'),
          h('div', { role: 'region', tabIndex: 0, 'aria-label': '凭据内容，支持滚动' }, h(CredentialList, { items: creds }))),
        h('details', { className: 'rt-card' },
          h('summary', null, '已获得访问会话 · ' + accesses.length),
          h('div', { role: 'region', tabIndex: 0, 'aria-label': '访问会话内容，支持滚动' }, h(AccessList, { items: accesses }))),
        h('details', { className: 'rt-card' },
          h('summary', null, '攻击文件 · ' + fileCount),
          h('div', { role: 'region', tabIndex: 0, 'aria-label': '文件内容，支持滚动' },
            h(AttackFilesTab, { engagement: eng, refreshKey: refreshKey }))))
    }

