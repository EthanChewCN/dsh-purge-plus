/**
 * [dsh-purge-plus] 官方 Agent Teams 任务板的数据面（只读）+ 模式开关。
 *
 * 为什么必须放在这里（ui.js），而不是 store-core：
 *   任务板的数据源**不在本插件里**。官方 `dsh-agent-team` 把每个任务作为
 *   `team/task` 事件追加到**根会话**的日志，投影由 `sessionProjections` 的
 *   `agentTeam` 单元负责。store-core 是无 Cordis 依赖的纯模块（只有 root 目录），
 *   拿不到 Session 对象，也拿不到团队服务。ui.js 有 ctx，两条都能拿到。
 *
 * 三个刻意的取舍：
 *   1. **只读**。写操作（建/改/认领任务）需要「确切的调用者 Agent」做授权，
 *      面板里没有 Agent 身份，伪造一个 caller 等于绕过 `TEAM_LEAD_REQUIRED`。
 *      面板只提供「看」和「开/关团队模式」两件事。
 *   2. **不猜根会话**。用宿主的判据（origin / delegationDepth），与 team-mode.js
 *      保持同一套口径；`parentSession` 不参与判定（续接/分支也会写它）。
 *   3. **回报层缺失要说出来**。任务能读到、但子会话回报读不到时，
 *      返回 `reports_available:false`，而不是把「没有回报」画成「一切正常」。
 */

/** 会话 id 的短形式，只用于显示。 */
function teamShortId(id) {
  const text = String(id || '')
  return text.length > 14 ? text.slice(0, 8) + '\u2026' + text.slice(-4) : text
}

/**
 * 根会话判定，与 lib/redteam/team-mode.js 同一口径。
 * @param session - 活会话。
 * @returns 是否是它自己那棵协作树的根。
 */
function teamIsRoot(session) {
  const header = (session && session.header) || {}
  const origin = String(header.origin || '').toLowerCase()
  if (origin === 'subagent' || origin === 'teammate' || origin === 'delegate') return false
  return Number(header.delegationDepth || 0) <= 0
}

/**
 * 团队任务板与模式开关。
 * @param ctx - 插件上下文（取 sessions / agentTeams）。
 * @param store - 资产库实例（只用于把子会话回报并到任务上，可为 null）。
 * @param request - `{ op: 'teamBoard'|'teamBoardMode', session?, enabled? }`。
 * @returns JSON 结果，或 undefined 表示不是这两个 op。
 */
async function handleTeamBoardOp(ctx, store, request) {
  const op = request && request.op
  if (op !== 'teamBoard' && op !== 'teamBoardMode' && op !== 'teamModeAudit' && op !== 'teamModeReset') return undefined

  const sessions = (() => { try { return ctx.get('sessions') } catch { return undefined } })()
  const teams = (() => { try { return ctx.get('agentTeams') } catch { return undefined } })()
  if (!sessions || typeof sessions.list !== 'function') {
    return { ok: false, error: 'sessions 服务不可用：读不到会话列表（宿主版本不匹配？）' }
  }
  if (!teams || !teams.projection || typeof teams.projection.stateOf !== 'function') {
    return {
      ok: false,
      error: 'agentTeams 服务不可用：官方 dsh-agent-team 未加载。团队任务板的数据与工具都由它提供，本插件只是读它的投影。',
    }
  }

  /** 读一个会话的团队投影。读不到（投影失败）返回 null，不抛。 */
  const stateOf = (session) => {
    try { return teams.projection.stateOf(session) || null } catch { return null }
  }

  const live = (() => { try { return sessions.list() || [] } catch { return [] } })()

  /** 一行摘要：面板的会话选择器与角标共用。 */
  const summaryOf = (session) => {
    const state = stateOf(session)
    const tasks = state && Array.isArray(state.tasks) ? state.tasks : []
    const kept = tasks.filter((t) => t && t.status !== 'deleted')
    const header = (session && session.header) || {}
    const counts = { pending: 0, in_progress: 0, completed: 0 }
    for (const t of kept) if (counts[t.status] !== undefined) counts[t.status] += 1
    return {
      id: String(session.id || ''),
      short: teamShortId(session.id),
      preset: String(header.agentPreset || ''),
      created_at: Number(header.createdAt) || null,
      enabled: state ? state.enabled === true : false,
      total: kept.length,
      done: counts.completed,
      in_progress: counts.in_progress,
      pending: counts.pending,
      seq: Number(session.seq) || 0,
      failure: state && state.failure ? String(state.failure) : null,
    }
  }

  const rows = live.filter(teamIsRoot).map(summaryOf)
  /* 选择器只列「真有东西的」：有任务，或者团队模式开着（开着但还没建任务是合法的起始态）。 */
  const boards = rows.filter((r) => r.total > 0 || r.enabled)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))

  /** 按 id / 前缀找一个活会话。 */
  const findSession = (raw) => {
    const want = String(raw || '').trim()
    if (!want) return undefined
    const exact = live.find((s) => String(s.id) === want)
    if (exact) return exact
    const byPrefix = live.filter((s) => String(s.id).startsWith(want))
    return byPrefix.length === 1 ? byPrefix[0] : undefined
  }

  /* ── 模式开关 ─────────────────────────────────────────────────────── */
  if (op === 'teamBoardMode') {
    /* 缺参数和找不到会话是两件事。v0.1.58 两种情况都报"会话不在本进程"，
       可事实是"你没给 session" —— 面板传参时不会踩，手写 API 会，而错误文案
       会把人往"宿主没这个会话"上带。 */
    if (!String(request.session || '').trim()) {
      return { ok: false, error: 'teamBoardMode 需要 session 参数（要切换哪个会话的团队模式）' }
    }
    const target = findSession(request.session)
    if (!target) return { ok: false, error: '找不到会话：' + String(request.session) + '（已关闭或 id 不对；归档会话要先打开）' }
    if (!teamIsRoot(target)) return { ok: false, error: '只能切换根会话的团队模式：子代理没有自己的任务板' }
    const want = request.enabled === true
    const state = stateOf(target)
    if (state && state.enabled === want) {
      return { ok: true, enabled: want, changed: false, note: '已经是这个状态，没有写事件' }
    }
    try {
      /* 与官方 setEnabled 同一条路径：追加事件 + 落盘屏障。
         不复用 setEnabled 是因为它要一个 Agent 做授权，面板里没有 Agent。 */
      target.append('team/mode', { enabled: want })
      if (typeof sessions.flush === 'function') await sessions.flush(target)
    } catch (error) {
      return { ok: false, error: '写 team/mode 失败：' + (error && error.message ? error.message : String(error)) }
    }
    return {
      ok: true, enabled: want, changed: true,
      note: want
        ? '已开启：下一步起工具目录里会出现 team_task_*'
        : '已关闭：下一步起不再注入 team_task_*（已建的任务不会删）',
    }
  }

  /* ── 历史 team/mode 审计与清理 ─────────────────────────────────────
     为什么需要它：`team/mode` 一旦写进会话日志，就永久生效 —— 日志是 append-only，
     没有「删掉那条事件」这种操作。旧版本把「非红队会话」误判成红队写进去的开关，
     只能靠**再追加一条 `{enabled:false}`** 关回去。

     三条纪律：
       ① 只关「最后一条 team/mode 是 enabled:true，且会话预设不是红队」的会话；
       ② 已经表过态（enabled:false）的不碰，避免制造无意义的事件；
       ③ 写入前先复读，确认 next seq，再追加一条 —— 不猜、不重排、不改历史。

     活会话走 session.append（宿主的正规路径）；归档会话走 sessionPersistence
     的写句柄（与宿主自己恢复会话时同一套 API），写完立刻 flush 并关闭。 */
  if (op === 'teamModeAudit' || op === 'teamModeReset') {
    const persistence = (() => { try { return ctx.get('sessionPersistence') } catch { return undefined } })()
    if (!persistence || typeof persistence.list !== 'function') {
      return { ok: false, error: 'sessionPersistence 不可用：读不到归档会话的日志' }
    }
    const reason = (e) => (e && e.message ? e.message : String(e))

    let isRedteam = () => false
    try {
      const identity = await import('../identity.js')
      if (identity && typeof identity.isRedteamPresetId === 'function') isRedteam = identity.isRedteamPresetId
    } catch { /* 身份模块缺失时按「非红队」保守处理：那只会多关，不会漏关 */ }

    let stored = []
    try { stored = await persistence.list() } catch (error) {
      return { ok: false, error: '列会话失败：' + reason(error) }
    }

    /** 一个会话的团队事实：读日志（活会话读内存，归档读磁盘）。 */
    const inspect = async (meta) => {
      const header = (meta && meta.header) || {}
      const id = String(header.id || '')
      if (!id) return null
      const liveSession = (() => { try { return sessions.get(id) } catch { return undefined } })()
      let events = []
      let readError = ''
      if (liveSession && typeof liveSession.snapshotEvents === 'function') {
        try { events = liveSession.snapshotEvents() || [] } catch (error) { readError = reason(error) }
      }
      if (events.length === 0 && !readError) {
        let handle = null
        try {
          handle = await persistence.open(id, 'read')
          const got = await handle.read(0, Number.MAX_SAFE_INTEGER)
          events = (got && got.events) || []
        } catch (error) { readError = reason(error) } finally {
          if (handle && typeof handle.close === 'function') { try { await handle.close() } catch { /* 关闭失败不影响结论 */ } }
        }
      }
      let lastMode = null
      let modeEvents = 0
      /* 会话头里的 agentPreset 是「建会话时」的快照，切过预设它不会变。
         只看 header 会把「中途切到红队」的会话判成非红队，进而把它的团队模式关掉。
         以最后一条 agent-preset/selected 为准，header 只做兜底。 */
      let lastPreset = ''
      const tasks = new Map()
      for (const event of events) {
        if (!event) continue
        if (event.type === 'team/mode') {
          modeEvents += 1
          lastMode = event.data && typeof event.data === 'object' ? event.data.enabled === true : null
        } else if (event.type === 'agent-preset/selected') {
          const picked = event.data && typeof event.data === 'object' ? event.data.agentPreset : null
          if (picked) lastPreset = String(picked)
        } else if (event.type === 'team/task') {
          const task = event.data && event.data.task
          if (task && task.id) tasks.set(String(task.id), String(task.status || ''))
        }
      }
      const kept = [...tasks.values()].filter((s) => s !== 'deleted')
      const preset = String(lastPreset || header.agentPreset || '')
      const redteam = (() => { try { return isRedteam(preset) === true } catch { return false } })()
      return {
        id,
        short: teamShortId(id),
        preset,
        preset_source: lastPreset ? 'selected' : 'header',
        redteam,
        created_at: Number(header.createdAt) || null,
        live: Boolean(liveSession),
        events: events.length,
        mode_events: modeEvents,
        last_enabled: lastMode,
        tasks: kept.length,
        tasks_done: kept.filter((s) => s === 'completed').length,
        needs_reset: lastMode === true && !redteam,
        read_error: readError || null,
        seq: events.length > 0 ? Number(events[events.length - 1].seq) + 1 : 0,
      }
    }

    const rows = []
    const startedAt = Date.now()
    let headerRedteam = 0
    for (const meta of stored) {
      const header = (meta && meta.header) || {}
      /* 这里刻意不做「header 是红队就跳过、不读日志」的快路。
         header.agentPreset 是建会话时的快照，中途切走它不变，所以快路会漏掉
         「头是红队、中途切到普通、team/mode 还开着」的会话——而那正是要清理的那一类。
         实测全量读本机 65 个会话 / 104MB / 11.2 万事件约 2.1 秒，代价可以接受。 */
      try { if (isRedteam(String(header.agentPreset || '')) === true) headerRedteam += 1 } catch { /* 身份模块异常按非红队处理 */ }
      const row = await inspect(meta)
      if (row) rows.push(row)
    }
    const durationMs = Date.now() - startedAt

    const need = rows.filter((r) => r.needs_reset)
    const errors = rows.filter((r) => r.read_error)
    /* 「被误关」的候选：当前预设是红队、但最后一条 team/mode 是关闭。
       只列出来给人看，不自动开——用户可能自己关过。 */
    const restorable = rows.filter((r) => r.redteam && r.last_enabled === false && r.mode_events > 0)

    if (op === 'teamModeAudit') {
      return {
        ok: true,
        scanned: rows.length,
        /* 头是红队的会话数（信息项，不再用于跳过） */
        header_redteam: headerRedteam,
        duration_ms: durationMs,
        unreadable: errors.map((r) => ({ id: r.id, short: r.short, error: r.read_error })),
        needs_reset: need.map((r) => ({
          id: r.id, short: r.short, preset: r.preset, preset_source: r.preset_source,
          created_at: r.created_at,
          live: r.live, mode_events: r.mode_events, last_enabled: r.last_enabled,
          tasks: r.tasks, tasks_done: r.tasks_done,
        })),
        restorable: restorable.map((r) => ({
          id: r.id, short: r.short, preset: r.preset, preset_source: r.preset_source,
          mode_events: r.mode_events, tasks: r.tasks,
        })),
        note: need.length === 0
          ? '没有需要清理的：非红队会话里没有处于开启状态的 team/mode。'
          : '这 ' + need.length + ' 个会话最后一条 team/mode 是「开启」，但当前预设不是红队'
            + '（判定依据是最后一条 agent-preset/selected，header 只做兜底）。'
            + '日志是 append-only，清理方式只能是再追加一条 {enabled:false}。',
      }
    }

    /* restore：显式点名的会话把团队模式开回去。
       不做自动推断——红队会话里用户也可能手动关过，自动开回去等于改用户的选择。
       所以只认 request.restore 里逐个写出来的 id，且必须复核「当前预设确实是红队」。 */
    const restoreResults = []
    const restoreIds = Array.isArray(request.restore) ? request.restore.map((v) => String(v)).filter(Boolean) : []
    for (const rid of restoreIds) {
      const row = rows.find((r) => r.id === rid) || null
      if (!row) { restoreResults.push({ id: rid, ok: false, error: '不在扫描结果里：会话未找到或日志读不出来' }); continue }
      if (!row.redteam) { restoreResults.push({ id: rid, short: row.short, ok: false, error: '当前预设不是红队（' + row.preset + '），拒绝开启' }); continue }
      try {
        const liveSession = (() => { try { return sessions.get(rid) } catch { return undefined } })()
        if (liveSession) {
          liveSession.append('team/mode', { enabled: true })
          if (typeof sessions.flush === 'function') await sessions.flush(liveSession)
          restoreResults.push({ id: rid, short: row.short, path: 'live', ok: true })
        } else {
          const handle = await persistence.open(rid, 'write')
          try {
            const got = await handle.read(0, Number.MAX_SAFE_INTEGER)
            const events = (got && got.events) || []
            const next = events.length > 0 ? Number(events[events.length - 1].seq) + 1 : 0
            await handle.append([{ type: 'team/mode', seq: next, time: Date.now(), data: { enabled: true } }])
            await handle.flush()
          } finally {
            try { await handle.close() } catch { /* 关闭失败不回滚已落盘的事件 */ }
          }
          restoreResults.push({ id: rid, short: row.short, path: 'persistence', ok: true })
        }
      } catch (error) {
        restoreResults.push({ id: rid, short: row.short, ok: false, error: reason(error) })
      }
    }
    if (restoreResults.length > 0) {
      try { if (typeof persistence.flush === 'function') await persistence.flush() } catch { /* 同上，屏障失败不改结论 */ }
    }

    /* reset：逐个追加 {enabled:false}。任何一个失败都不影响其它，逐条报告。 */
    const results = []
    for (const row of need) {
      const liveSession = (() => { try { return sessions.get(row.id) } catch { return undefined } })()
      try {
        if (liveSession) {
          liveSession.append('team/mode', { enabled: false })
          if (typeof sessions.flush === 'function') await sessions.flush(liveSession)
          results.push({ id: row.id, short: row.short, path: 'live', ok: true })
        } else {
          const handle = await persistence.open(row.id, 'write')
          try {
            const got = await handle.read(0, Number.MAX_SAFE_INTEGER)
            const events = (got && got.events) || []
            const next = events.length > 0 ? Number(events[events.length - 1].seq) + 1 : 0
            await handle.append([{ type: 'team/mode', seq: next, time: Date.now(), data: { enabled: false } }])
            await handle.flush()
          } finally {
            try { await handle.close() } catch { /* 关闭失败不回滚已落盘的事件 */ }
          }
          results.push({ id: row.id, short: row.short, path: 'persistence', ok: true })
        }
      } catch (error) {
        results.push({ id: row.id, short: row.short, ok: false, error: reason(error) })
      }
    }
    /* 兜底屏障：append 本身已 await 到底层写入，这里再打一次全量 flush，
       保证「工具报成功」与「磁盘上真有这条」是同一件事。 */
    try { if (typeof persistence.flush === 'function') await persistence.flush() } catch { /* 屏障失败不改结论，append 已经落盘 */ }
    const failed = results.filter((r) => r.ok !== true)
    const restoreFailed = restoreResults.filter((r) => r.ok !== true)
    return {
      ok: failed.length === 0 && restoreFailed.length === 0,
      reset: results.filter((r) => r.ok === true).length,
      failed,
      results,
      ...(restoreResults.length > 0
        ? { restored: restoreResults.filter((r) => r.ok === true).length, restore_failed: restoreFailed, restore_results: restoreResults }
        : {}),
      note: failed.length === 0
        ? '已追加 {enabled:false}。这些会话下次打开时团队工具不再注入；已建的任务不会删。'
        : '有 ' + failed.length + ' 个会话写入失败，逐条见 failed；成功的那些已经落盘。',
    }
  }

  /* ── 读任务板 ─────────────────────────────────────────────────────── */
  const chosen = request.session
    ? findSession(request.session)
    : (live.find((s) => String(s.id) === String(request.prefer || '')) || undefined)

  /* 明确点了名却找不到，不能静默换成"最近的那个板"：面板会把别人的任务当成
     这个会话的任务显示，而且看不出来换过。 */
  if (request.session && !chosen) {
    return {
      ok: false,
      error: '找不到会话：' + String(request.session) + '（已关闭或 id 不对；归档会话要先打开）',
      boards,
    }
  }

  /* 没指定会话时：优先「有任务且最近创建」的那个；一个都没有就返回索引本身，
     让界面显示「本机还没有任务板」，而不是把空数组画成「全部完成」。 */
  const fallbackId = boards.length > 0 ? boards[0].id : ''
  const target = chosen || (fallbackId ? findSession(fallbackId) : undefined)

  if (!target) {
    return {
      ok: true, available: true, boards, session: null,
      tasks: [], stats: { total: 0, done: 0, in_progress: 0, pending: 0, blocked: 0 },
      note: live.length === 0
        ? '本进程没有活会话。'
        : '本机还没有任何会话开过团队任务板（团队模式关闭，且没建过任务）。在红队会话里让智能体用 team_task_create 建第一条，或打开本页的开关。',
    }
  }

  const state = stateOf(target)
  if (!state) {
    return { ok: false, error: '团队投影读不出来（该会话的 team 投影失败或未注册）', boards }
  }
  if (state.failure) {
    return { ok: false, error: '团队投影损坏：' + String(state.failure), boards }
  }

  const allTasks = Array.isArray(state.tasks) ? state.tasks : []
  const keptTasks = allTasks.filter((t) => t && t.status !== 'deleted')

  /* 宿主自己的视图带 ready / writeScopeWarnings。拿它的唯一正确入口是
     `teams.listTasks(agent)` —— TeamService 上没有 `tasks.list`（上一版按那个
     名字探测，永远拿不到宿主视图，于是退回快照，writeScopeWarnings 恒空）。
     Agent 从 agents 服务按会话 id 取；团队模式关着时 listTasks 会抛
     TEAM_DISABLED，那就退回快照，并按同一条规则自己算。 */
  let hostView = null
  try {
    const agentsSvc = (() => { try { return ctx.get('agents') } catch { return undefined } })()
    const agent = agentsSvc && typeof agentsSvc.get === 'function' ? agentsSvc.get(target.id) : undefined
    if (agent && typeof teams.listTasks === 'function') {
      const got = teams.listTasks(agent)
      if (Array.isArray(got)) hostView = got
    }
  } catch { hostView = null }
  const byId = new Map((Array.isArray(hostView) ? hostView : keptTasks).map((t) => [String(t.id), t]))

  /* 依赖判定：只有「全部前置都 completed」才算可领取。未知前置一律当未完成，
     与 ticket-stage 的 hasUnfinishedDependency 同口径（陈旧投影不该让任务看起来能跑）。 */
  const readyOf = (task) => {
    if (task.status !== 'pending') return false
    const blockers = Array.isArray(task.blockedBy) ? task.blockedBy : []
    return blockers.every((id) => {
      const dep = byId.get(String(id))
      return Boolean(dep) && dep.status === 'completed'
    })
  }

  /* 子会话回报：任务上挂着「在等谁」才有用。读不到就明说，不假装没有。 */
  const reports = (() => {
    const out = {}
    try {
      if (!store || typeof store.latestAgentReports !== 'function') return null
      const ids = []
      try {
        const bindings = typeof store.sessionBindings === 'function' ? store.sessionBindings() : null
        const bound = bindings && bindings[target.id] && bindings[target.id].engagement
        if (bound) ids.push(bound)
      } catch { /* 绑定表读不到就走全量 */ }
      if (ids.length === 0 && typeof store.listEngagements === 'function') {
        const all = store.listEngagements({ includeStats: false }) || []
        for (const e of all.slice(0, 8)) ids.push(e.id)
      }
      for (const engId of ids) {
        let list = []
        try { list = store.latestAgentReports(engId, target.id, { limit: 100 }) || [] } catch { continue }
        for (const r of list) {
          const sid = r && r.session_id
          if (!sid || out[sid]) continue
          out[sid] = r
        }
      }
      return out
    } catch { return null }
  })()

  let stageOf = null
  try {
    const mod = await import('./ticket-stage.js')
    if (mod && typeof mod.taskStage === 'function') stageOf = mod.taskStage
  } catch { stageOf = null }

  /* 快照里没有派生字段，退回时按宿主同一条规则算（模块缺失就退回空数组，
     面板不因此崩 —— 但 verify 会拦模块缺失）。 */
  let warningsOf = () => []
  try {
    const mod = await import('./team-board-views.js')
    if (mod && typeof mod.writeScopeWarningsOf === 'function') warningsOf = mod.writeScopeWarningsOf
  } catch { /* 保持空实现 */ }

  const now = Date.now()
  const items = (Array.isArray(hostView) ? hostView : keptTasks).map((task) => {
    const report = (reports && task.ownerId) ? reports[String(task.ownerId)] || null : null
    let stage = ''
    let needs = []
    let reason = ''
    if (stageOf) {
      try {
        const got = stageOf({ task, report, tasks: allTasks, now })
        stage = String(got.stage || '')
        needs = Array.isArray(got.needs) ? got.needs : []
        reason = String(got.reason || '')
      } catch { stage = '' }
    }
    /* 没有回报时 taskStage 会把 in_progress 判成 queued（它分不清「没派」和「没回报」）。
       面板上「进行中」必须显示成进行中，所以这一条单独纠正，并把原因写清楚。 */
    if (task.status === 'in_progress' && (stage === 'queued' || !stage)) {
      stage = 'working'
      reason = report ? reason : '没有收到该会话的回报（回报层不可用或还没回报）'
    }
    if (task.status === 'completed') { stage = 'ended'; needs = []; reason = '' }
    if (!stage) stage = readyOf(task) ? 'idle' : 'queued'
    return {
      id: String(task.id || ''),
      revision: Number(task.revision) || 0,
      subject: String(task.subject || ''),
      description: String(task.description || ''),
      status: String(task.status || ''),
      ready: hostView ? task.ready === true : readyOf(task),
      blockedBy: Array.isArray(task.blockedBy) ? task.blockedBy.map(String) : [],
      writeScopes: Array.isArray(task.writeScopes) ? task.writeScopes.map(String) : [],
      /* 写域重叠告警：有宿主视图就用官方的，没有就按官方同一条规则现算。
         只"透传字段"是不够的 —— 快照里根本没有这个字段，透传得到的是恒空数组。 */
      writeScopeWarnings: hostView
        ? (Array.isArray(task.writeScopeWarnings) ? task.writeScopeWarnings.map(String) : [])
        : warningsOf(allTasks, task),
      owner_id: task.ownerId ? String(task.ownerId) : '',
      owner_short: task.ownerId ? teamShortId(task.ownerId) : '',
      owner_name: task.ownerName ? String(task.ownerName) : '',
      stage,
      stage_label: (() => {
        switch (stage) {
          case 'ended': return '已完成'
          case 'person/answer': return '等人提供'
          case 'person/review': return '等人验收'
          case 'person/blocked': return '受阻'
          case 'person/failed': return '失败待处理'
          case 'working': return '进行中'
          case 'queued': return '排队中'
          case 'idle': return '待领取'
          default: return '未接入'
        }
      })(),
      needs: needs.map((n) => (n && typeof n === 'object')
        ? { kind: String(n.kind || ''), detail: String(n.detail || '') }
        : { kind: '', detail: String(n || '') }),
      reason,
      report_status: report ? String(report.status || '') : '',
      report_at: report ? String(report.created_at || '') : '',
    }
  })

  const stats = {
    total: items.length,
    done: items.filter((t) => t.status === 'completed').length,
    in_progress: items.filter((t) => t.status === 'in_progress').length,
    pending: items.filter((t) => t.status === 'pending').length,
    blocked: items.filter((t) => t.status === 'pending' && t.ready === false).length,
    ready: items.filter((t) => t.status === 'pending' && t.ready === true).length,
    waiting_person: items.filter((t) => t.stage.indexOf('person/') === 0).length,
  }

  const header = (target.header || {})
  return {
    ok: true,
    available: true,
    boards,
    session: {
      id: String(target.id || ''),
      short: teamShortId(target.id),
      preset: String(header.agentPreset || ''),
      created_at: Number(header.createdAt) || null,
      is_root: teamIsRoot(target),
    },
    mode: {
      enabled: state.enabled === true,
      next_task_number: Number(state.nextTaskNumber) || 1,
      /* 任务数 ≠ 0 但模式关着：历史任务还在，只是工具不再注入。界面必须区分这两件事。 */
      stale_tasks: state.enabled === true ? 0 : items.length,
    },
    view_source: Array.isArray(hostView) ? 'host' : 'projection',
    reports_available: reports !== null,
    stats,
    tasks: items,
    note: items.length === 0
      ? (state.enabled === true
        ? '团队模式已开启，但还没有任务。让智能体用 team_task_create 建第一条。'
        : '这个会话没开团队模式，也没有历史任务。')
      : (reports === null
        ? '任务读到了，但子会话回报读不到（回报层不可用）：下面的「在等谁」只反映任务状态，不代表子代理真的没卡住。'
        : ''),
  }
}
