    /* [dsh-purge-plus] P6 态势首页。
       回答四个问题，一个屏幕内：现在什么规模 / 谁在等我 / 下一步打谁 / 覆盖到哪了。
       刻意不做成仪表盘：这块地方是「决策入口」，不是「数据展示」，所以每一栏都带
       一个能直接点的动作，而不是只给数字。 */
    /* [dsh-purge-plus] P21 情报刷新按钮。
       两段式：先确认（会真发网络请求），再显示逐条结果。
       不在加载时自动刷新 —— 打开首页就偷偷联网是最不该有的副作用。 */
    function IntelUpdateButton(props) {
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const run = (target) => {
        setBusy(true)
        setMsg(null)
        api({ op: 'intelUpdate', target: target }).then(function (r) {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ bad: (r && r.error) || '刷新失败' }); return }
          const parts = (r.results || []).map(function (x) {
            if (x.action === 'updated') return x.key + ' 已更新' + (x.count ? '（' + x.count + ' 条）' : (x.templates ? '（' + x.templates + ' 个模板）' : ''))
            if (x.action === 'dry-run') return x.key + ' 校验通过（未落盘）'
            if (x.action === 'skipped') return x.key + ' 跳过'
            return x.key + ' 失败：' + (x.error || '未知原因')
          })
          const bad = (r.results || []).some(function (x) { return x.action === 'failed' })
          setMsg(bad ? { bad: parts.join('；') } : { ok: parts.join('；') })
          if (typeof props.onDone === 'function') props.onDone()
        }, function (e) {
          setBusy(false)
          setMsg({ bad: String((e && e.message) || e) })
        })
      }
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        h('button', {
          className: 'rt-btn', type: 'button', disabled: busy,
          title: '会真发网络请求：KEV 走 CISA 官方 JSON、nuclei 走官方仓库（带大小上限与超时）',
          onClick: function () { run('all') },
        }, busy ? '更新中…' : '更新 KEV / 模板'),
        msg && msg.ok ? h('span', { style: { color: 'var(--dsw-alias-state-success-primary)' } }, msg.ok) : null,
        msg && msg.bad ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, msg.bad) : null)
    }

    function OverviewTab(props) {
      const engagement = props.engagement
      const refreshKey = props.refreshKey
      const onGo = props.onGo
      const [data, setData] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [err, setErr] = React.useState('')

      React.useEffect(() => {
        let alive = true
        if (!engagement) {
          setData(null)
          return undefined
        }
        setBusy(true)
        setErr('')
        /* 五个请求一起发：这块是首屏，串行等待会让「打开首页」变成最慢的操作。
           任何一路失败都降级成 null —— 首页不该因为某一个 op 没实现就整块红掉。 */
        Promise.all([
          api({ op: 'snapshot', engagement }).catch(function () { return null }),
          api({ op: 'coverageSummary', engagement }).catch(function () { return null }),
          api({ op: 'attention', engagement, limit: 5 }).catch(function () { return null }),
          api({ op: 'assetCoverage', engagement, action: 'next', limit: 5 }).catch(function () { return null }),
          api({ op: 'hostCoverage', engagement, action: 'next', limit: 5 }).catch(function () { return null }),
          api({ op: 'intelStatus' }).catch(function () { return null }),
        ]).then(function (out) {
          if (!alive) return
          setData({ snap: out[0], cov: out[1], att: out[2], ext: out[3], host: out[4], intel: out[5] })
          setBusy(false)
        }).catch(function (e) {
          if (!alive) return
          setErr(String((e && e.message) || e))
          setBusy(false)
        })
        return function () { alive = false }
      }, [engagement, refreshKey])

      if (!engagement) {
        return h('div', { className: 'rt-pane' },
          h('div', { className: 'rt-card' },
            h('h4', null, '还没有靶标'),
            h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
              '先在「资产台账」创建靶标，首页才有东西可看。')))
      }
      if (busy && !data) return h('div', { className: 'rt-empty' }, '正在汇总…')
      if (err) return h('div', { className: 'rt-err' }, err)

      const d = data || {}
      const snap = d.snap || {}
      const cov = d.cov || {}
      const att = d.att || {}
      const ext = (d.ext && d.ext.actions) || []
      const host = (d.host && d.host.actions) || []
      const extTotal = (d.ext && d.ext.total) || 0
      const hostTotal = (d.host && d.host.total) || 0
      const stats = snap.stats || {}
      const counts = snap.counts || {}
      const intel = d.intel || null

      const num = (v) => (v === undefined || v === null ? '—' : String(v))
      const cell = (label, value, hint) => h('div', {
        key: label,
        style: {
          minWidth: 96, padding: '8px 10px', borderRadius: 8,
          border: '1px solid var(--dsw-alias-border-l1)',
        },
      },
        h('div', { style: { fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' } }, num(value)),
        h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, label),
        hint ? h('div', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 } }, hint) : null)

      const section = (title, right, body) => h('div', { key: title, className: 'rt-card', style: { marginBottom: 10 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
          h('h4', { style: { margin: 0, fontSize: 13 } }, title),
          h('div', { style: { flex: 1 } }),
          right || null),
        body)

      const whoWaits = att.items || []
      const whoBody = whoWaits.length === 0
        ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
          att.coverage_available === false
            ? (att.coverage_error
              ? '没有人等，但覆盖度**查不出来**（' + att.coverage_error + '）：不能据此认为这一轮打完了。'
              : '没有人等。覆盖度引擎未启用，无法判断是否还有缺口。')
            : (Number(att.pending_coverage) > 0
              ? '没有人等，但还有 ' + att.pending_coverage + ' 个覆盖度缺口 —— 该派下一个智能体了。'
              : '没有人等，也没有缺口：这一轮打完了。'))
        : h('div', null, whoWaits.map(function (it) {
          return h('div', {
            key: it.session_id,
            style: { display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0', fontSize: 12 },
          },
            h('span', {
              className: 'rt-tag',
              style: { flex: 'none', fontSize: 10.5 },
            }, it.status),
            h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              (it.label || it.role || it.session_id) + (it.reason ? '：' + it.reason : '')),
            h('span', { style: { marginLeft: 'auto', color: 'var(--dsw-alias-label-secondary)', flex: 'none' } },
              it.stage || ''))
        }))

      const gapRow = (a, scope) => h('div', {
        key: scope + ':' + a.asset_id,
        style: { display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0', fontSize: 12 },
      },
        h('span', { style: { fontVariantNumeric: 'tabular-nums', flex: 'none' } }, a.asset_ip || ''),
        h('span', {
          style: {
            flex: 'none', fontSize: 10.5, padding: '0 5px', borderRadius: 999,
            border: '1px solid var(--dsw-alias-border-l1)',
            color: a.priority === 'high' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
          },
        }, a.priority || 'medium'),
        h('span', { style: { minWidth: 0, color: 'var(--dsw-alias-label-secondary)' } },
          (a.missing || []).join(' / ')))

      const gapsBody = (extTotal + hostTotal) === 0
        ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
          '两侧队列都空了。要么打完了，要么还没测绘 —— 去「资产台账」看一眼。')
        : h('div', null,
          extTotal > 0 ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', margin: '2px 0' } }, '外网 · ' + extTotal + ' 台待深挖') : null,
          ext.map(function (a) { return gapRow(a, 'ext') }),
          hostTotal > 0 ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', margin: '6px 0 2px' } }, '内网 · ' + hostTotal + ' 台待收口') : null,
          host.map(function (a) { return gapRow(a, 'host') }))

      const covBody = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
        cell('外网资产', cov.external ? cov.external.assets : 0,
          cov.external ? '已收口 ' + cov.external.closed + ' · 受阻 ' + cov.external.blocked : ''),
        cell('内网主机', cov.internal ? cov.internal.assets : 0,
          cov.internal ? '已收口 ' + cov.internal.closed + ' · 受阻 ' + cov.internal.blocked : ''),
        cell('主机发现', cov.findings, '文件/凭据/提权/横向'),
        /* [dsh-purge-plus] 查询失败时不能显示「0」：0 是「没有缺口」，查不出来是「不知道」，
           两者对下一步的影响完全相反。 */
        cell('待办缺口',
          (cov.pending && cov.pending.ok === false) ? '查不出来' : (cov.pending ? cov.pending.total : (extTotal + hostTotal)),
          (cov.pending && cov.pending.ok === false)
            ? '覆盖度查询失败：0 不代表没有缺口'
            : (cov.pending ? '外 ' + cov.pending.external + ' · 内 ' + cov.pending.internal : '')))

      /* 资源徽章：一行字，不占版面。过期/缺失用颜色区分 ——
         过期还能用（该更新了），缺失是真的没有，两者对下一步的影响不一样。 */
      const intelBadge = intel === null ? null : h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, marginBottom: 8,
          color: intel.missing_count > 0
            ? 'var(--dsw-alias-state-error-primary)'
            : intel.stale_count > 0 ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-secondary)',
        },
      },
        h('span', { style: { width: 7, height: 7, borderRadius: 999, background: 'currentColor', flex: 'none' } }),
        h('span', null, '资源保鲜：' + intel.badge),
        h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } },
          (intel.resources || []).map(function (r) {
            return r.label + (r.missing ? ' 缺失' : ' ' + r.age_days + '天')
          }).join(' · ')),
        h('div', { className: 'rt-spacer' }),
        h(IntelUpdateButton, { onDone: function () { if (typeof props.onRefresh === 'function') props.onRefresh() } }))

      return h('div', { className: 'rt-pane' },
        intelBadge,
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 } },
          cell('资产', stats.assets !== undefined ? stats.assets : counts.assets),
          cell('漏洞', stats.vulns !== undefined ? stats.vulns : counts.vulns),
          cell('已利用', stats.exploited !== undefined ? stats.exploited : counts.exploited),
          cell('凭据', stats.credentials !== undefined ? stats.credentials : counts.credentials),
          cell('主机权限', stats.access !== undefined ? stats.access : counts.access)),
        section('现在在等谁', h('button', {
          className: 'rt-btn', type: 'button',
          onClick: function () { if (onGo) onGo('agents') },
        }, '去智能体页'),
        whoBody),
        section('下一步该打谁', h('button', {
          className: 'rt-btn', type: 'button',
          onClick: function () { if (onGo) onGo('assets') },
        }, '去资产台账'),
        gapsBody),
        section('覆盖到哪了', null, covBody))
    }
