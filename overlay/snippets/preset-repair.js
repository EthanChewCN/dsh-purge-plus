/* ---------- [dsh-purge-plus] P31 预设自愈（safe 2.0.2 lib/redteam/index.js） ----------
 *
 * 为什么需要：宿主每次升级都会让已部署的红队预设「半失效」——
 *   · 0.2.1 起 toolFilter 废弃，留着它整份预设 registered-broken；
 *   · 0.2.2 把 list_agents 合进主入口，旧行会让 registry 恒报 never started；
 *   · workflow 引擎换包名后，组合里那几行指向不存在的包，模式下拉会被抽空；
 *   · 子代理选模型在新宿主上不再允许，锁成父模型才不报错；
 *   · 官方新增 tool-schedule 行，老预设没有，定时提醒能力直接缺席。
 *
 * 本包原先的 apply 在「预设已存在」时直接 kept —— 也就是说**自愈代码存在但走不到**。
 * 这里补齐 safe 的 6 段修复，并把 apply 的捷径去掉（见下面的 apply 编辑）。
 * 每段都是「只在真的需要时才改」，改完返回 changed，便于断言幂等。
 */

/**
 * 0.2.2+ 把 `list_agents` 合进 dsh-tool-subagent-control 主入口，
 * `@deepseek-ai/dsh-tool-subagent-control/list-agents` 子路径已不再导出。
 * 老预设留着这一行会让 registry 恒报 never started（list_agents 工具由主包
 * 照常注册，功能不丢），于是整份预设 registered-broken。宿主仍有该子路径时保持原样。
 */

/**
 * 0.2.2+ 把 `list_agents` 合进 dsh-tool-subagent-control 主入口，
 * `@deepseek-ai/dsh-tool-subagent-control/list-agents` 子路径已不再导出。
 * 老预设留着这一行会让 registry 恒报 never started（list_agents 工具由主包
 * 照常注册，功能不丢），于是整份预设 registered-broken。宿主仍有该子路径时保持原样。
 */

/**
 * 0.2.2+ 把 `list_agents` 合进 dsh-tool-subagent-control 主入口，
 * `@deepseek-ai/dsh-tool-subagent-control/list-agents` 子路径已不再导出。
 * 老预设留着这一行会让 registry 恒报 never started（list_agents 工具由主包
 * 照常注册，功能不丢），于是整份预设 registered-broken。宿主仍有该子路径时保持原样。
 */
function disableUnavailableListAgents(text) {
  const id = 'tool-subagent-list-agents'
  if (!text.includes(id)) return { text, changed: false }
  let available = false
  try {
    available = hostHasPackage('@deepseek-ai/dsh-tool-subagent-control/list-agents')
  } catch {
    available = false
  }
  if (available) return { text, changed: false }
  return setRowDisabled(text, id, true)
}

/**
 * 0.2.1 `dsh-tool-subagent` 看见 config.toolFilter 就抛错，整份预设 registered-broken。
 * 只剥这个键及其嵌套 allow/deny，其余预设正文不动。
 */
function stripDeprecatedToolFilter(text) {
  const src = String(text || "")
  const nl = src.includes("\r\n") ? "\r\n" : "\n"
  const lines = src.split(/\r?\n/)
  const out = []
  let skipping = -1
  let changed = false
  for (const line of lines) {
    if (skipping >= 0) {
      if (!line.trim()) continue
      const indent = line.match(/^([ \t]*)/)[1].length
      if (indent > skipping) continue
      skipping = -1
    }
    const key = line.match(/^([ \t]*)toolFilter:[ \t]*(?:#.*)?$/)
    if (key) {
      changed = true
      skipping = key[1].length
      continue
    }
    if (/^[ \t]*toolFilter:[ \t]+[^#\s]/.test(line)) {
      changed = true
      continue
    }
    out.push(line)
  }
  if (!changed) return { text: src, changed: false }
  return { text: out.join(nl), changed: true }
}

/** 0.2 子会话一旦另选 Claude，官方身份在原生槽、注入算越狱。只锁 spawn 叶子，不动 fork。 */
function disableSubagentModelSelection(text) {
  const src = String(text || "")
  const idLine = "- id: tool-subagent"
  let next = src
  let changed = false
  let from = 0
  while (from < next.length) {
    const at = next.indexOf(idLine, from)
    if (at < 0) break
    const endId = at + idLine.length
    const ch = next[endId] || "\n"
    if (ch !== "\n" && ch !== "\r" && ch !== " " && ch !== "\t") {
      from = endId
      continue
    }
    const rest = next.slice(endId)
    const endRel = rest.search(/\n[ \t]*- id: /)
    const block = endRel < 0 ? rest : rest.slice(0, endRel)
    if (!/toolName:\s*(?:subagent\b|['"]subagent['"])/.test(block)) {
      from = endId + block.length
      continue
    }
    let patched = block
    if (/modelSelectionSettings:\s*(?:true\b|['"]true['"])/.test(patched)) {
      patched = patched.replace(/modelSelectionSettings:\s*(?:true\b|['"]true['"])/, "modelSelectionSettings: false")
    } else if (!/modelSelectionSettings\s*:/.test(patched)) {
      patched = patched.replace(
        /^([ \t]+)toolName:\s*(?:subagent\b|['"]subagent['"])[^\n]*/m,
        (line, indent) => `${line}\n${indent}modelSelectionSettings: false`,
      )
    }
    if (patched !== block) {
      next = next.slice(0, endId) + patched + next.slice(endId + block.length)
      changed = true
      from = endId + patched.length
      continue
    }
    from = endId + block.length
  }
  return { text: next, changed }
}

/**
 * 红队指挥提示词里"团队任务板 / 等待"这两段。它们跟 Team 开关和 tool-schedule
 * 成对出现：没有共享任务板就别让模型去找 `team_task_*`（工具缺席会踩空），
 * 没有 `wait_agent` 就别叫它阻塞。
 *
 * 按标记补，不整段覆盖：用户在中间插了自己的话也保留。
 */
const TEAM_BOARD_MARK = "## 共享任务板（Agent Teams"
const WAIT_MARK = "## 等待与轮询（不要空转）"
/* 现版本的指纹句。这个字段是 rc.1 才有的 `noProgress`，老文案里一个字都没有，
   所以拿它当"已是新版"的判据最稳。换文案时记得一起换。 */
const WAIT_FRESH_MARK = "noProgress"
const WAIT_SECTION_BLOCK = [
  "      ## 等待与轮询（不要空转）",
  "      只有在**还有子智能体在跑**的时候才等：派完活、手上没有可并行推进的事情，调 `wait_agent`（`timeout_ms` 300000）阻塞等。**没有子智能体在跑就不要等**，直接把结论交给用户。",
  "      判断有没有新输入看 `timedOut`：只有 `timedOut: false` **并且没有 `noProgress` 字段**才是真有新输入。老版本宿主会在没有活跃同伴时立刻返回 `timedOut: false` + `noProgress` —— 那不是消息，是告诉你没人可等，看见它就直接收工，别当成被唤醒。",
  "      它等的只有**进入当前回合**的输入：子智能体消息、子智能体完成通报、以及用户用 steer（打断当前回合）发来的话。**用户普通回车发来的消息是排队到下一回合的，不会打断这个等待** —— 用户按回车之后你还在这里干等，他就只能干看着。",
  "      不要用 `sleep`、不要反复 `list_agents` 轮询、不要自己编一段文字发给用户当作\"进度\"。",
  "      **最多等 2 次**（合计不超过约 10 分钟）：第二次仍然没等到就收工写清\"当前卡在哪、等什么资源、下一步打算\"，把控制权交回用户。",
].join("\n")
const TEAM_BOARD_HEAD = [
  "",
  "      ## 共享任务板（Agent Teams，红队默认开启）",
  "      本会话的团队协作已经开启，你可以用 `team_task_create` / `team_task_list` / `team_task_get` / `team_task_update` 维护一张共享任务板。",
  "      **建卡不等于派活**：任务板只是协调台账，`team_task_create` 建出来的卡没人会自动开工；真要干活必须另调 `subagent` 派下去。**顺序固定：先建卡 → 再 `subagent` 派活 → 打开时用 `team_task_update` 标 in_progress → 子智能体回报核对后标 completed。**",
  "      用途限定为\"让自己不丢活\"，不要把它当代替派活的手段：",
  "      - 开工前把用户给的目标拆成 3–8 张卡（subject 写\"做什么\"，description 写范围 + 验收标准 + 允许的资产层级）。",
  "      - `write_scopes` 只是给协作者的提示，**不是锁**；红队同一时刻至多 3 个执行体，真冲突由你用 `redteam_agent_slot` 的顺序挡。",
  "      - **任务 id 由宿主生成，形如 `task-1`、`task-2`**（不是纯数字 `1`）。`blocked_by` / `team_task_update` 的 `task_id` 都必须原样用建卡返回的 id；传 `\"1\"` 会被宿主拒绝并报 `blocker task \"1\" not found`。",
  "      - 卡的状态必须与真实进度一致：子智能体没回报就别标 completed，被阻塞就写 `blocked_by`。",
  "      - 一次只推进一两张卡，不要一次建 30 张然后挨个点完成。",
  "",
].join("\n")

/* 任务板段与等待段分开持有：老预设里可能已经有等待段（只是文案旧），
   这时只补任务板那半 —— 再插整块就会多出第二段等待说明，而旧的那段还排在后面
   （recency 更强，模型会照旧的那段做）。
   以前这里用 `TEAM_BOARD_BLOCK.split("\n      " + WAIT_SECTION_BLOCK)` 想切掉等待段，
   但两段之间隔着一个空行（`\n\n`），分隔符根本不存在 —— split 静默不生效，
   于是「已经有等待段」这条分支从来没起作用过。所以改成把两段拼出来，而不是切出来。 */
const TEAM_BOARD_BLOCK = TEAM_BOARD_HEAD + "\n\n" + WAIT_SECTION_BLOCK
/* 插在角色索引之前：用户预设可能是老版本正文，所以留多个锚点按顺序试。 */
const TEAM_BOARD_ANCHORS = [
  "## 六个角色",
  "## 按用户输入决定怎么开工",
  "## 并发硬约束",
  "## 指挥职责",
]

function insertTeamBoardGuidance(text) {
  const src = String(text || "")
  if (src.includes(TEAM_BOARD_MARK)) return { text: src, changed: false }
  for (const anchor of TEAM_BOARD_ANCHORS) {
    const at = src.indexOf(anchor)
    if (at < 0) continue
    /* 锚点所在行的缩进就是段落缩进，块内统一用它。 */
    const lineStart = src.lastIndexOf("\n", at - 1) + 1
    const indent = src.slice(lineStart, at)
    /* 文档里已经有等待段时只补任务板那半：再插整块会多出第二段等待说明。 */
    const boardOnly = src.includes(WAIT_MARK)
    const source = boardOnly ? TEAM_BOARD_HEAD : TEAM_BOARD_BLOCK
    const block = indent ? source.split("\n      ").join("\n" + indent) : source
    /* 锚点前面本来可能已经有一个空行；再拼 "\n\n" 就成了三连空行。
       所以先把前面的空行剥光，再统一补两行。 */
    const head = src.slice(0, lineStart).replace(/(?:\r?\n[ \t]*)+$/, "")
    const body = block.replace(/^\n+/, "").trimEnd()
    return { text: head + "\n\n" + body + "\n\n" + src.slice(lineStart), changed: true }
  }
  return { text: src, changed: false }
}

/**
 * 修之前写错的"等待"段。
 *
 * 早期版本在提示词里说 `wait_agent` 会等"用户发话"——错的。宿主 0.2.2-rc.3 的
 * waitForInput 只看 `agent.inbox.nextStep`；用户普通回车走 prompt(mode:"queue")
 * → followup → `next-turn`，根本不进 nextStep。只有子智能体消息、完成通报、
 * 和用户主动 steer 才会唤醒它。模型照着错的写就会以为用户会把自己叫醒，
 * 于是无限等下去。所以按段落指纹重写，只换这一段，别的不动。
 */
function fixStaleWaitGuidance(text) {
  const src = String(text || "")
  if (!src.includes(WAIT_MARK)) return { text: src, changed: false }
  const at = src.indexOf(WAIT_MARK)
  const lineStart = src.lastIndexOf("\n", at - 1) + 1
  const indent = src.slice(lineStart, at)
  /* 段落边界：下一行空行，或者下一个同级标题。 */
  const lines = src.slice(lineStart).split("\n")
  let end = lines.length
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim()) { end = i; break }
    if (line.trimStart().startsWith("## ")) { end = i; break }
  }
  /* [dsh-purge-plus] 只看**这一段**有没有新指纹。整篇检查会被刚插进来的新段落骗过去，
     于是旧的错误等待段永远不修、还排在新的后面（recency 更强）。 */
  if (lines.slice(0, end).join("\n").includes(WAIT_FRESH_MARK)) return { text: src, changed: false }
  const block = indent ? WAIT_SECTION_BLOCK.split("\n      ").join("\n" + indent) : WAIT_SECTION_BLOCK
  const tail = src.slice(lineStart + lines.slice(0, end).join("\n").length)
  return { text: src.slice(0, lineStart) + block + tail, changed: true }
}

function addRequireCandidate(list, pkg) {
  if (!pkg) return
  const norm = String(pkg).replace(/\\/g, '/')
  if (!list.includes(norm)) list.push(norm)
}

/** `$DSH_HOME` 可能是插件 env，也可能是 `homedir()/.dsh`。两边都在就都试。 */
function dshHomeCandidates() {
  const out = []
  const push = (p) => {
    if (!p) return
    const n = String(p).replace(/[\\/]+$/, '')
    if (!n || !existsSync(n)) return
    const key = n.replace(/\\/g, '/').toLowerCase()
    if (out.some((x) => x.replace(/\\/g, '/').toLowerCase() === key)) return
    out.push(n)
  }
  push(process.env.DSH_HOME)
  push(join(homedir(), '.dsh'))
  return out
}

function hostRequireCandidates() {
  const list = []
  try {
    considerBinRequire(list, process.argv[1])
  } catch { /* ignore */ }
  for (const home of dshHomeCandidates()) {
    addRequireCandidate(list, join(home, 'package.json'))
    for (const profile of ['web', 'desktop', 'default', 'headless']) {
      addRequireCandidate(list, join(home, 'profiles', profile, 'package.json'))
      addRequireCandidate(list, join(home, 'profiles', profile, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
    }
  }
  addRequireCandidate(list, join('D:', 'DeepSeek Harness', 'npm-global', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  addRequireCandidate(list, join('D:', 'DeepseekHarnessDesktop', 'resources', 'app', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  return list
}

function considerBinRequire(list, bin) {
  if (!bin) return
  let text = String(bin).replace(/\\/g, '/')
  try { text = realpathSync(bin).replace(/\\/g, '/') } catch { /* 解析不了就用原路径 */ }
  const needle = '/node_modules/@deepseek-ai/dsh/'
  const at = text.lastIndexOf(needle)
  if (at >= 0) addRequireCandidate(list, `${text.slice(0, at + needle.length - 1)}/package.json`)
  const nm = text.lastIndexOf('/node_modules/')
  if (nm >= 0) addRequireCandidate(list, join(text.slice(0, nm), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  const dir = dirname(text)
  addRequireCandidate(list, join(dir, '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  addRequireCandidate(list, join(dir, '..', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
}

function hostHasPackage(id) {
  for (const pkg of hostRequireCandidates()) {
    try {
      if (!pkg || !existsSync(pkg)) continue
      createRequire(pkg).resolve(id)
      return true
    } catch { /* try next */ }
  }
  try {
    createRequire(import.meta.url).resolve(id)
    return true
  } catch {
    return false
  }
}

let workflowCapCtx = null

/**
 * 红队组合里的 workflow 行一旦缺包 / 缺 ptcRuntime，Cordis 会一直 pending。
 * 宿主 registry.list() 会等每一个预设的 mount，于是标准/PTC/极简也会从下拉里消失。
 */
function detectWorkflowCaps() {
  const ptc = hostHasPackage('@deepseek-ai/dsh-workflow-ptc')
  const runtimePkg = hostHasPackage('@deepseek-ai/dsh-ptc-runtime-node')
    || hostHasPackage('@deepseek-ai/dsh-ptc-runtime')
  const worker = hostHasPackage('@deepseek-ai/dsh-workflow-worker-thread')
  const tool = hostHasPackage('@deepseek-ai/dsh-tool-workflow')
  let runtimeLive = null
  const ctx = workflowCapCtx
  if (ctx && typeof ctx.get === 'function') {
    try { runtimeLive = ctx.get('ptcRuntime') != null } catch { runtimeLive = false }
  }
  const ptcOk = ptc && (runtimeLive === true || (runtimeLive === null && runtimePkg))
  const engine = ptcOk ? 'ptc' : worker ? 'worker' : 'none'
  return {
    ptc: engine === 'ptc',
    worker: engine === 'worker',
    tool: engine !== 'none' && tool,
  }
}

function rowBlockBounds(text, id, from = 0) {
  const idLine = `- id: ${id}`
  const at = text.indexOf(idLine, from)
  if (at < 0) return null
  const endId = at + idLine.length
  const ch = text[endId] || '\n'
  if (ch !== '\n' && ch !== '\r' && ch !== ' ' && ch !== '\t') {
    return rowBlockBounds(text, id, endId)
  }
  const rest = text.slice(endId)
  const endRel = rest.search(/\n[ \t]*- id: /)
  const block = endRel < 0 ? rest : rest.slice(0, endRel)
  return { at, endId, block }
}

function setRowDisabled(text, id, disabled) {
  const hit = rowBlockBounds(text, id)
  if (!hit) return { text, changed: false }
  const want = disabled ? 'true' : 'false'
  if (new RegExp(`disabled:\\s*${want}\\b`).test(hit.block)) return { text, changed: false }
  let patched = hit.block
  if (/disabled:\s*(true|false)/.test(patched)) {
    patched = patched.replace(/disabled:\s*(true|false)/, `disabled: ${want}`)
  } else {
    const indentMatch = /\n([ \t]+)name:/.exec(patched)
    const indent = indentMatch ? indentMatch[1] : '      '
    if (/name:/.test(patched)) {
      patched = patched.replace(
        /(name:\s*'[^']+'[^\n]*)/,
        `$1\n${indent}disabled: ${want}`,
      )
    } else {
      patched = `\n${indent}disabled: ${want}` + patched
    }
  }
  if (patched === hit.block) return { text, changed: false }
  return {
    text: text.slice(0, hit.endId) + patched + text.slice(hit.endId + hit.block.length),
    changed: true,
  }
}

function readWorkflowPtcFromTemplate() {
  let template = ''
  try {
    template = readFileSync(join(packagePaths().presetDir, 'agent.cordis.yml'), 'utf8')
  } catch {
    return ''
  }
  const start = template.indexOf('    - id: workflow-ptc')
  if (start < 0) return ''
  const rest = template.slice(start)
  const next = rest.slice(1).search(/\n    - id: /)
  return (next < 0 ? rest : rest.slice(0, next + 1)).trimEnd()
}

function insertWorkflowPtcInGroup(text) {
  if (/\bid:\s*workflow-ptc\b/.test(text)) return { text, changed: false }
  const block = readWorkflowPtcFromTemplate()
  if (!block) return { text, changed: false }
  const needle = '- id: tool-workflow'
  const at = text.indexOf(needle)
  if (at < 0) return { text, changed: false }
  const lineStart = text.lastIndexOf('\n', at - 1) + 1
  const rendered = block.endsWith('\n') ? block : `${block}\n`
  return {
    text: `${text.slice(0, lineStart)}${rendered}\n${text.slice(lineStart)}`,
    changed: true,
  }
}

/**
 * 红队要排程工具。宿主 web 层常驻 dsh-schedule 服务，模型侧四个工具行由预设挂载；
 * 官方 standard / cordis / ptc 预设都有，红队原来没有 —— 结果是"官方能排程、红队不能"。
 *
 * 这里只在**缺行时补一行**，不覆盖用户已有配置（用户可能自己调过顺序或加了 config）。
 * 放的位置：`tool-ask-user` 之前，和模型面工具归在一起。找不到锚点就 append 到末尾，
 * 反正 cordis 的 row 顺序不带加载语义。
 */
const SCHEDULE_ROW_MARK = '- id: tool-schedule'
const SCHEDULE_ROW_BLOCK = [
  '',
  '# 定时提醒（官方 dsh-tool-schedule）：schedule_create / list / view / edit。',
  '# 子会话调用会被宿主拒绝（只有指挥根会话能排程），符合红队分工。',
  '- id: tool-schedule',
  "  name: '@deepseek-ai/dsh-tool-schedule'",
].join('\n')

function insertScheduleRow(text) {
  const src = String(text || '')
  if (new RegExp(`^[ \\t]*- id: tool-schedule\\b`, 'm').test(src)) return { text: src, changed: false }
  const anchor = '\n- id: tool-ask-user'
  const at = src.indexOf(anchor)
  if (at >= 0) {
    return { text: src.slice(0, at) + '\n' + SCHEDULE_ROW_BLOCK + src.slice(at), changed: true }
  }
  const tail = src.endsWith('\n') ? '' : '\n'
  return { text: src + tail + SCHEDULE_ROW_BLOCK + '\n', changed: true }
}

function repairComposition(text) {
  let next = String(text || '')
  let changed = false
  const caps = detectWorkflowCaps()
  if (caps.ptc) {
    const inserted = insertWorkflowPtcInGroup(next)
    if (inserted.changed) {
      next = inserted.text
      changed = true
    }
  }
  const rows = [
    ['workflow-ptc', !caps.ptc],
    ['workflow-worker-thread', !caps.worker],
    ['tool-workflow', !caps.tool],
    ['tool-ralph', true],
  ]
  for (const [id, disabled] of rows) {
    const patched = setRowDisabled(next, id, disabled)
    if (patched.changed) {
      next = patched.text
      changed = true
    }
  }
  const schedule = insertScheduleRow(next)
  if (schedule.changed) next = schedule.text
  return { text: next, changed: changed || schedule.changed, workflowChanged: changed, scheduleInserted: schedule.changed }
}/**
 * 预设自愈总入口。
 *
 * 前三段（改标题 / 补派活约束 / 重新启用 subagent 行）由 `repairDelegationCore`
 * 负责，与 community 基座逐字一致；这里只叠加 safe 新增的六段。
 * 拆开而不是整段替换的理由：基座那三段的文案与锚点已经跟着本包的补丁调过，
 * 整段覆盖会把这些改动一起冲掉。
 *
 * @param text - 预设文件全文。
 * @returns `{ text, changed, delegationChanged, strippedToolFilter, lockedModelSelection,
 *   compositionChanged, scheduleInserted, teamBoardInserted, waitGuidanceFixed, listAgentsDisabled }`
 */
function repairDelegation(text) {
  const core = repairDelegationCore(text)
  let next = core.text
  let changed = core.changed

  const stripped = stripDeprecatedToolFilter(next)
  if (stripped.changed) { next = stripped.text; changed = true }

  const locked = disableSubagentModelSelection(next)
  if (locked.changed) { next = locked.text; changed = true }

  /* 组合修复要读宿主实际装了哪些包，所以依赖 workflowCapCtx（installPreset 传入）。 */
  const composition = repairComposition(next)
  if (composition.changed) { next = composition.text; changed = true }

  const listAgents = disableUnavailableListAgents(next)
  if (listAgents.changed) { next = listAgents.text; changed = true }

  const teamBoard = insertTeamBoardGuidance(next)
  if (teamBoard.changed) { next = teamBoard.text; changed = true }

  /* 已部署的预设里已有任务板那段，insertTeamBoardGuidance 会跳过；
     里面的等待段还可能是错的旧文案，单独再修一次。 */
  const staleWait = fixStaleWaitGuidance(next)
  if (staleWait.changed) { next = staleWait.text; changed = true }

  return {
    text: next,
    changed,
    delegationChanged: core.changed,
    strippedToolFilter: stripped.changed,
    lockedModelSelection: locked.changed,
    compositionChanged: composition.workflowChanged === true,
    scheduleInserted: composition.scheduleInserted === true,
    teamBoardInserted: teamBoard.changed,
    waitGuidanceFixed: staleWait.changed,
    listAgentsDisabled: listAgents.changed,
  }
}
