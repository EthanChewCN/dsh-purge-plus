    /* [dsh-purge-plus] 清理清单：把「演练收尾要删掉什么」做成可编辑面板。
       之前只有 redteam_cleanup 工具能写，面板只能看报告里的只读汇总 ——
       人想补一条「这个 webshell 还没删」得去跟智能体说话，很别扭。
       这里补齐「人也能登记」的那一半：表单 + 逐条收口 + 去重提示。 */

    const CLEANUP_KINDS = [
      ['webshell', 'webshell'], ['account', '自建账号'], ['file', '上传文件'],
      ['service', '服务 / 计划任务'], ['tunnel', '隧道 / 代理'], ['config', '改过的配置'], ['other', '其它'],
    ]

    function CleanupPanel(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [data, setData] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const [form, setForm] = React.useState({ kind: 'webshell', target: '', location: '', title: '', detail: '', priority: 'medium' })

      const load = () => {
        if (!eng) { setData(null); return }
        api({ op: 'cleanup', engagement: eng }).then((r) => {
          setData(r && r.ok !== false ? r : null)
        }, () => setData(null))
      }
      React.useEffect(load, [eng, refreshKey])

      const setField = (k) => (e) => setForm((f) => Object.assign({}, f, { [k]: e.target.value }))

      const submit = () => {
        if (!eng) return
        if (!String(form.title || '').trim()) { setMsg({ err: '先一句话说清要删什么（标题必填）' }); return }
        setBusy(true); setMsg(null)
        api(Object.assign({ op: 'addCleanup', engagement: eng }, form)).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '登记失败' }); return }
          if (r.deduped) {
            setMsg({ err: '同主机 + 同类型 + 同位置已有一条未收口的记录（id ' + r.cleanup_id + '）：换个 location 或 kind 再登记' })
            return
          }
          setMsg({ ok: '已登记（id ' + (r.cleanup_id || '?') + '）' })
          setForm((f) => Object.assign({}, f, { target: '', location: '', title: '', detail: '' }))
          load()
          if (typeof props.onChanged === 'function') props.onChanged()
        }, (e) => { setBusy(false); setMsg({ err: String(e) }) })
      }

      const settle = (row, status) => {
        let detail = row.detail || ''
        if (status === 'wontfix') {
          const why = globalThis.prompt('不处理的理由（必填 —— 报告里这一栏是给靶标方看的）：', detail)
          if (why === null) return
          if (!String(why).trim()) { setMsg({ err: '「不处理」必须写理由，否则和「忘了做」在报告里分不出来' }); return }
          detail = String(why).trim()
        }
        api({ op: 'updateCleanup', engagement: eng, id: row.id, status, detail }).then((r) => {
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '更新失败' }); return }
          setMsg({ ok: '已更新 #' + row.id })
          load()
          if (typeof props.onChanged === 'function') props.onChanged()
        }, (e) => setMsg({ err: String(e) }))
      }

      const items = (data && data.items) || []
      const byStatus = (data && data.by_status) || { open: 0, done: 0, wontfix: 0 }
      const queryError = data && data.query_error

      return h('div', { className: 'rt-card' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, '清理清单'),
          h('span', { className: 'rt-tag' }, '未处理 ' + (byStatus.open || 0)),
          h('span', { className: 'rt-tag' }, '已清理 ' + (byStatus.done || 0)),
          h('span', { className: 'rt-tag' }, '不处理 ' + (byStatus.wontfix || 0)),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', onClick: () => setOpen((v) => !v) }, open ? '收起表单' : '登记一条'),
          h('button', { className: 'rt-btn', onClick: load }, '刷新')),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', margin: '6px 0 8px' } },
          '我们留下的东西要逐条交代：target 只写「哪台机器」，location 才是「删哪个东西」（文件路径 / 账号名 / webshell 路径 / 监听端口）。'),
        queryError ? h('div', { className: 'rt-err' }, '读库失败，清单不可信：' + queryError) : null,
        open ? h('div', { className: 'rt-pane', style: { marginBottom: 10 } },
          h('div', { className: 'rt-toolbar' },
            h('select', { className: 'rt-input', value: form.kind, onChange: setField('kind') },
              CLEANUP_KINDS.map((k) => h('option', { key: k[0], value: k[0] }, k[1]))),
            h('input', { className: 'rt-input', placeholder: '主机 / 入口（10.0.0.5 或 host:8080）', value: form.target, onChange: setField('target') }),
            h('input', { className: 'rt-input', placeholder: '具体位置（/var/www/x.php · 账号 deploy · 监听 1080）', value: form.location, onChange: setField('location') })),
          h('div', { className: 'rt-toolbar', style: { marginTop: 6 } },
            h('input', { className: 'rt-input', style: { flex: 1 }, placeholder: '要删什么（必填，一句话）', value: form.title, onChange: setField('title') }),
            h('select', { className: 'rt-input', value: form.priority, onChange: setField('priority') },
              h('option', { value: 'high' }, '高'), h('option', { value: 'medium' }, '中'), h('option', { value: 'low' }, '低'))),
          h('div', { className: 'rt-toolbar', style: { marginTop: 6 } },
            h('input', { className: 'rt-input', style: { flex: 1 }, placeholder: '细节（可选）', value: form.detail, onChange: setField('detail') }),
            h('button', { className: 'rt-btn rt-btn-primary', disabled: busy, onClick: submit }, busy ? '登记中…' : '登记'))) : null,
        msg && msg.err ? h('div', { className: 'rt-err' }, msg.err) : null,
        msg && msg.ok ? h('div', { className: 'rt-ok' }, msg.ok) : null,
        items.length === 0
          ? h('div', { className: 'rt-empty' }, '没有登记清理项。真留了 webshell / 账号 / 隧道却这里是空的，等于没交代。')
          : h('div', { role: 'region', tabIndex: 0, 'aria-label': '清理项列表，支持滚动' }, items.map((c) => h('div', { key: 'cl' + c.id, className: 'rt-vrow' },
            h('span', { className: 'rt-tag' }, c.kind || 'other'),
            h('span', { className: 'rt-mono' }, c.target || '—'),
            h('span', { className: 'rt-mono', title: c.location || '' }, c.location || '（未写位置）'),
            h('span', { style: { flex: 1, minWidth: 0 } }, c.title || '—'),
            h('span', { className: 'rt-tag' }, c.status === 'done' ? '已清理' : c.status === 'wontfix' ? '不处理' : '未处理'),
            c.status === 'open' ? h('button', { className: 'rt-btn', onClick: () => settle(c, 'done') }, '标记已清理') : null,
            c.status === 'open' ? h('button', { className: 'rt-btn', onClick: () => settle(c, 'wontfix') }, '不处理') : null,
            c.status !== 'open' ? h('button', { className: 'rt-btn', onClick: () => settle(c, 'open') }, '重新打开') : null)))
      )
    }

