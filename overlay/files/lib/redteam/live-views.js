/* [dsh-purge-plus] 会话图 / 并发名额的「实时层」纯函数。
 *
 * 为什么单独一个文件：这两段逻辑都要读宿主服务（sessions / subagents），
 * 而宿主服务在测试里造不出来。把**判定**与**取数**拆开之后，判定部分可以
 * 直接喂数组跑断言 —— 否则这两块只能靠「看一眼面板」，而面板是最后一道防线。
 *
 * 本文件不含任何 host 依赖，ui.js 与测试都能安全 import。
 */

/**
 * 把宿主里真实存在的会话（活动态 / 父子关系）并进 store.sessionGraph() 的结果。
 *
 * @param base - `{ engagements, sessions, count_by_engagement }`，sessions 只含「绑过靶标」的。
 * @param list - 宿主 `sessions.list()` 的返回，每项形如 `{ id, header: { activity, parentSession, label, title, mode } }`。
 * @returns `{ sessions, activity_counts }`，sessions 里含绑定会话 + 它们的后代。
 *
 * 三条规则，每条都对应一个真实的显示错误：
 *   ① 后代即使自己没绑靶标也画出来，靶标继承自祖先 —— 否则「子代理在干什么」永远看不到。
 *   ② 活动态缺失记 `unknown`，不记 `idle` —— 「不知道」和「闲着」是两件事。
 *   ③ 超过 300 个节点就停（前端布局上限），并且**先**放绑定会话，保证主干不会被后代挤掉。
 */
export function mergeSessionGraphLive(base, list) {
  const bound = new Map(((base && base.sessions) || []).map((s) => [String(s.id), s]))
  const meta = new Map()
  const childrenOf = new Map()
  for (const s of Array.isArray(list) ? list : []) {
    if (!s || s.id === undefined || s.id === null) continue
    const h = s.header || {}
    const id = String(s.id)
    const parent = h.parentSession === undefined || h.parentSession === null ? null : String(h.parentSession)
    meta.set(id, {
      activity: String(h.activity || 'unknown'),
      parent,
      label: String(h.label || h.title || ''),
      mode: h.mode ? String(h.mode) : '',
    })
    if (parent !== null) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, [])
      childrenOf.get(parent).push(id)
    }
  }
  const out = []
  const nodeById = new Map()
  const push = (id, engagementId, parentId, depth) => {
    if (out.length >= 300 || nodeById.has(id)) return false
    const b = bound.get(id)
    const m = meta.get(id)
    const node = {
      id,
      short: (b && b.short) || (id.length > 14 ? id.slice(0, 8) + '…' + id.slice(-4) : id),
      engagement: engagementId,
      parent: parentId,
      activity: m ? m.activity : 'unknown',
      live: m !== undefined,
      name: (b && b.name) || (m && m.label) || '',
      at: b ? b.at : null,
      waiting: b ? b.waiting : null,
      depth,
    }
    out.push(node)
    nodeById.set(id, node)
    return true
  }
  /* 两趟：先放**绑定过靶标**的会话，再挂它们的后代。
     一趟 DFS 会在封顶 300 时让第一个会话的后代把第二个绑定会话挤掉 ——
     图的主干是「哪些会话绑了靶标」，不能被枝叶挤没。 */
  for (const s of (base && base.sessions) || []) push(String(s.id), s.engagement, null, 0)
  const walk = (parentId, engagementId, depth) => {
    for (const kid of childrenOf.get(parentId) || []) {
      const existing = nodeById.get(kid)
      if (existing !== undefined) {
        /* 它自己也绑过靶标（两趟之间的重叠）：补上父子关系，不重复插入 */
        if (existing.parent === null) {
          existing.parent = parentId
          existing.depth = depth
        }
        continue
      }
      if (!push(kid, engagementId, parentId, depth)) return
      walk(kid, engagementId, depth + 1)
    }
  }
  for (const s of (base && base.sessions) || []) walk(String(s.id), s.engagement, 1)
  const activity_counts = { running: 0, idle: 0, unknown: 0 }
  for (const s of out) {
    if (s.activity === 'running') activity_counts.running += 1
    else if (s.activity === 'idle') activity_counts.idle += 1
    else activity_counts.unknown += 1
  }
  return { sessions: out, activity_counts }
}

/**
 * 并发名额的占用拆分：`waiting` / `blocked` 的执行智能体已经让出名额，
 * 只显示、不计入 used。
 *
 * 这条口径必须与 tools.js 的 `runningAll.filter(!isParked)` 完全一致，
 * 否则会出现「工具说还有名额、面板说满了」—— slot-state.js 的注释就是为这个写的。
 *
 * @param children - `[{ id, parent, label, activity, mode }]`
 * @param isParked - `(parentId, childId) => boolean`
 */
export function splitRunningParked(children, isParked) {
  const running = []
  const parked = []
  for (const c of Array.isArray(children) ? children : []) {
    if (!c || c.activity !== 'running') continue
    if (isParked(c.parent, c.id)) parked.push(c)
    else running.push(c)
  }
  return { running, parked }
}
