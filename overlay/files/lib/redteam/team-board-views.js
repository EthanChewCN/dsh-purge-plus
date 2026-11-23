/**
 * 团队任务视图的纯规则：写域重叠告警。
 *
 * 为什么要复制一份：宿主 @deepseek-ai/dsh-agent-team 的 `projectTaskView`
 * 不在包的公开导出里（index.ts 只导出 TeamService 与类型），而它的
 * `listTasks(caller)` 需要一个 Agent 做授权。面板是只读的，拿不到 Agent 时
 * 只能读会话投影里的 `TeamTaskSnapshot` —— 快照里**没有** ready /
 * writeScopeWarnings 这两个派生字段，直接取永远是空数组。
 * 于是这里按 src/task-view.ts 的原文规则重算，保证两条路给出同一结果。
 *
 * 与上游同口径的四点（改了就会与宿主分叉，别顺手"优化"）：
 *   1. 只跟「其它 in_progress 任务」比，completed / pending 的兄弟不算冲突；
 *   2. 写域是路径前缀，比较必须落在路径分隔符上（recon 与 reconciliation 不重叠）；
 *   3. 告警文案逐字为 `write scopes overlap with <id>`，前端按这个串匹配；
 *   4. 空串不特殊处理 —— 上游 `'' === ''` 为真就为真，不做"善意收窄"。
 */

/**
 * 两个写域是否在路径组件上重叠。
 * @param {string} left 规范化后的写域
 * @param {string} right 规范化后的写域
 * @returns {boolean} 任一包含另一方时为真
 */
export function scopesOverlap(left, right) {
  const a = String(left == null ? '' : left)
  const b = String(right == null ? '' : right)
  /* 逐字照抄上游，连空串那条也算。空串其实进不了库 —— 写入时
     `writeScope('')` 抛 TEAM_INVALID_WRITE_SCOPE（validation.ts:28），
     所以这条分支当前不可达。仍然照抄的理由：可达性依赖的是上游校验，
     在这里"善意收窄"等于把一个上游保证复制进自己的判据，上游哪天放宽就静默分叉。
     没声明写域的情形是空数组（`writeScopes: []`），`some()` 不迭代，自然不告警。 */
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/')
}

/**
 * 按宿主同一条规则算一条任务的写域重叠告警。
 * @param {Array<object>} tasks 同板全部任务（含 deleted，函数内部按 status 过滤）
 * @param {object} task 目标任务快照
 * @returns {string[]} 告警文案，形如 `write scopes overlap with task-2`
 */
export function writeScopeWarningsOf(tasks, task) {
  const out = new Set()
  if (!task) return []
  const mine = Array.isArray(task.writeScopes) ? task.writeScopes.map(String) : []
  if (mine.length === 0) return []
  for (const other of Array.isArray(tasks) ? tasks : []) {
    if (!other || String(other.id) === String(task.id)) continue
    if (other.status !== 'in_progress') continue
    const theirs = Array.isArray(other.writeScopes) ? other.writeScopes.map(String) : []
    if (theirs.length === 0) continue
    if (mine.some((l) => theirs.some((r) => scopesOverlap(l, r)))) {
      out.add('write scopes overlap with ' + String(other.id))
    }
  }
  return [...out]
}
