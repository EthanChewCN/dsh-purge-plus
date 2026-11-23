    /* [dsh-purge-plus] 团队任务板 ─────────────────────────────────────
       官方 Agent Teams 的任务板，本包只做「看得见」，不代它做决定。

       为什么这一页必须存在：`team/mode` 打开之后，四个 `team_task_*` 工具会进
       工具目录，智能体开始建任务、认领任务、互相阻塞 —— 而**人这边什么都看不见**。
       官方客户端有自己的任务板视图，但它只认官方那条 UI 路径；本包的面板是全屏
       独立窗口，看不到官方那份。于是「智能体在排队、有一条在等人回答」这种状态，
       只有问一句「现在到哪了」才能知道。

       三条显示纪律（缺一条就会骗人）：
         ① 「没有任务板」与「任务全部完成」必须长得不一样 —— 前者是还没开始，
            后者是绿灯，混在一起看就是假绿灯；
         ② 团队模式关着但历史任务还在，要单独说 —— 否则人会以为工具还在，
            实际上 `team_task_*` 已经不在工具目录里了；
         ③ 回报层读不到时，不能把「没有回报」画成「没人卡住」——
            接口返回 `reports_available:false`，这一页就把话说清楚。
       ⚠️ 只读：建/改/认领任务需要「确切的调用者 Agent」做授权，面板里没有 Agent
          身份，伪造一个 caller 等于绕过 TEAM_LEAD_REQUIRED。这里只提供开关团队模式。 */

    /* 只映射到产物里真实存在的类：rt-ev-ok / rt-ev-warn / rt-ev-mute / rt-tag-live。
       写一个不存在的类不会报错，只会静默变成无色标签 —— 那比没有颜色更糟：
       人以为「没上色是因为不重要」。 */
    const TEAM_STAGE_CLASS = {
      ended: 'rt-ev-ok',
      working: 'rt-tag-live',
      'person/answer': 'rt-ev-warn',
      'person/review': 'rt-ev-warn',
      'person/blocked': 'rt-ev-warn',
      'person/failed': 'rt-ev-warn',
      queued: 'rt-ev-mute',
      idle: 'rt-ev-mute',
    }

    function TeamTaskRow(props) {
      const t = props.task
      const [open, setOpen] = React.useState(false)
      const tone = TEAM_STAGE_CLASS[t.stage] || 'rt-ev-mute'
      const meta = [
        t.blockedBy.length > 0 ? '前置 ' + t.blockedBy.join(' ') : null,
        t.writeScopes.length > 0 ? '写域 ' + t.writeScopes.join(' ') : null,
        t.reason ? t.reason : null,
      ].filter(Boolean).join(' · ')
      return h('div', { className: 'rt-card' },
        h('div', { className: 'rt-toolbar' },
          h('span', { className: 'rt-tag ' + tone }, t.stage_label),
          h('span', { className: 'rt-mono' }, t.id),
          h('span', { className: 'rt-mono', style: { opacity: 0.6 } }, 'r' + t.revision),
          h('div', { className: 'rt-spacer' }),
          t.owner_id
            ? h('span', { className: 'rt-tag', title: t.owner_id }, '执行 ' + (t.owner_name || t.owner_short))
            : h('span', { className: 'rt-tag rt-ev-mute' }, '未认领'),
          /* 官方 projectTaskView 算出的写域重叠告警。写域是建议性的、不锁文件，
             所以它不该阻断，但必须可见 —— 两条 in_progress 任务写同一目录是
             「并行改同一份东西」的预警，藏起来等于没有。 */
          Array.isArray(t.writeScopeWarnings) && t.writeScopeWarnings.length > 0
            ? h('span', { className: 'rt-tag rt-ev-warn', title: t.writeScopeWarnings.join('\n') },
              '写域冲突 ' + t.writeScopeWarnings.length)
            : null,
          h('button', {
            className: 'rt-btn', type: 'button',
            onClick: (ev) => { ev.stopPropagation(); setOpen((v) => !v) },
          }, open ? '收起' : '展开'),
        ),
        h('div', { style: { fontWeight: 600, margin: '4px 0 2px' } }, t.subject || '（无标题）'),
        meta ? h('div', { className: 'rt-mono' }, meta) : null,
        open
          ? h('div', null,
            h('pre', { className: 'rt-ev-pre', style: { whiteSpace: 'pre-wrap' } }, t.description || '（没有描述）'),
            t.needs.length > 0
              ? h('div', { className: 'rt-mono' },
                '需要：' + t.needs.map((n) => ((n.kind ? n.kind + ' ' : '') + (n.detail || '')).trim())
                  .filter(Boolean).join('；'))
              : null,
            t.report_status
              ? h('div', { className: 'rt-mono' }, '最近回报：' + t.report_status + (t.report_at ? ' · ' + t.report_at : ''))
              : null)
          : null,
      )
    }

    function TeamBoardTab(props) {
      const refreshKey = props.refreshKey || 0
      const preferred = props.session || ''
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [picked, setPicked] = React.useState('')

      const load = (sid) => {
        setBusy(true)
        setErr('')
        const req = { op: 'teamBoard' }
        const want = sid || preferred
        if (want) req.session = want
        api(req).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
          setData(r)
        }, (e) => {
          setBusy(false)
          setErr(String((e && e.message) || e))
        })
      }

      React.useEffect(() => { load(picked) }, [refreshKey, picked])

      const toggle = () => {
        const cur = data && data.session ? data.session.id : ''
        if (!cur) return
        const want = !(data && data.mode && data.mode.enabled)
        setBusy(true)
        api({ op: 'teamBoardMode', session: cur, enabled: want }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setErr((r && r.error) || '切换失败'); return }
          load(picked)
        }, (e) => {
          setBusy(false)
          setErr(String((e && e.message) || e))
        })
      }

      const boards = (data && data.boards) || []
      const tasks = (data && data.tasks) || []
      const stats = (data && data.stats) || { total: 0, done: 0 }
      const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0
      const enabled = Boolean(data && data.mode && data.mode.enabled)
      const stale = Number(data && data.mode && data.mode.stale_tasks) || 0

      return h('div', null,
        h('div', { className: 'rt-toolbar' },
          h('strong', null, '团队任务板'),
          h('span', { className: 'rt-mono', style: { opacity: 0.65 } }, '官方 Agent Teams'),
          h('div', { className: 'rt-spacer' }),
          boards.length > 0
            ? h('select', {
              className: 'rt-input', value: picked || (data && data.session ? data.session.id : ''),
              onChange: (ev) => setPicked(ev.target.value),
              title: '本进程里有任务板或开着团队模式的会话',
            }, boards.map((b) => h('option', { key: b.id, value: b.id },
              b.short + ' · ' + (b.preset || '无预设') + ' · ' + b.done + '/' + b.total)))
            : null,
          h('button', { className: 'rt-btn', type: 'button', disabled: busy, onClick: () => load(picked) },
            busy ? '读取中…' : '刷新'),
          data && data.session
            ? h('button', {
              className: 'rt-btn', type: 'button', disabled: busy, onClick: toggle,
              title: enabled
                ? '关闭后下一步起不再向工具目录注入 team_task_*；已建的任务不会删'
                : '开启后下一步起工具目录里出现 team_task_*（官方 Agent Teams）',
            }, enabled ? '关闭团队模式' : '开启团队模式')
            : null,
        ),

        err ? h('div', { className: 'rt-empty', style: { color: 'var(--dsw-alias-state-error-primary)' } }, err) : null,

        !data && !err
          ? h('div', { className: 'rt-empty' }, busy ? '读取中…' : '还没有数据')
          : null,

        data && data.session
          ? h('div', { className: 'rt-card' },
            h('div', { className: 'rt-toolbar' },
              h('span', { className: 'rt-tag ' + (enabled ? 'rt-ev-ok' : 'rt-ev-mute') }, enabled ? '团队模式已开启' : '团队模式关闭'),
              h('span', { className: 'rt-mono' }, data.session.short),
              data.session.preset ? h('span', { className: 'rt-tag' }, data.session.preset) : null,
              h('div', { className: 'rt-spacer' }),
              h('span', { className: 'rt-mono' }, '完成 ' + stats.done + ' / ' + stats.total + '（' + pct + '%）'),
            ),
            h('div', {
              style: {
                height: 6, borderRadius: 3, margin: '6px 0 2px',
                background: 'var(--dsw-alias-border-secondary, rgba(127,127,127,.25))',
              },
            }, h('div', {
              style: {
                height: 6, borderRadius: 3, width: pct + '%',
                background: 'var(--dsw-alias-state-success-primary, #2ea043)',
                transition: 'width .2s',
              },
            })),
            h('div', { className: 'rt-mono' },
              ['进行中 ' + (stats.in_progress || 0),
                '待领取 ' + (stats.ready || 0),
                '被阻塞 ' + (stats.blocked || 0),
                stats.waiting_person ? '等人处理 ' + stats.waiting_person : null].filter(Boolean).join(' · ')),
            stale > 0
              ? h('div', { className: 'rt-mono', style: { color: 'var(--dsw-alias-state-warning-primary, #d29922)' } },
                '团队模式已关闭，但还留着 ' + stale + ' 条历史任务：下面的列表是历史，工具目录里已经没有 team_task_* 了。')
              : null,
            data.reports_available === false
              ? h('div', { className: 'rt-mono', style: { opacity: 0.7 } },
                '回报层不可用：下面的「在等谁」只反映任务状态，不代表子代理真的没卡住。')
              : null,
          )
          : null,

        data && !data.session && data.note
          ? h('div', { className: 'rt-empty' }, data.note)
          : null,

        data && data.session && tasks.length === 0 && data.note
          ? h('div', { className: 'rt-empty' }, data.note)
          : null,

        tasks.length > 0
          ? h('div', null,
            tasks.map((t) => h(TeamTaskRow, { key: t.id, task: t })),
            h('div', { className: 'rt-mono', style: { opacity: 0.6, marginTop: 6 } },
              '数据源：' + (data.view_source === 'host' ? '宿主团队投影（含 ready / 写域冲突）' : '会话日志投影（团队模式关闭，ready 由面板自算）')),
          )
          : null,
      )
    }
