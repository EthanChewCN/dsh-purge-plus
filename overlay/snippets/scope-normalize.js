/* ---------- [dsh-purge-plus] R19 授权范围归一（写侧严格、读侧宽容） ---------- */
//
// 为什么放在 store-core 而不是 dispatch / 工具层各挡一次：
//   scope 落盘的位置只有一处（openEngagement → engagement.yaml），读它的地方有六处
//   （靶标列表、靶标详情、报告、范围核对、覆盖率、报告分片）。任何一处漏挡，都会在
//   「用户看到的东西」和「磁盘上的东西」之间制造不一致。
//
// 两种真实事故：
//   · 传字符串 "10.0.0.0/8" → YAML 里存成字符串 → report 里 (meta.scope_cidrs||[]).join
//     抛 TypeError，整个报告页永久崩；
//   · 传对象 [{cidr:"…"}] → String() 成 "[object Object]" → 授权范围永久丢失，
//     而当时没有任何 op 能把 meta 改回来。
// 所以写侧只收字符串或字符串数组，其余一律抛错；读侧对历史脏数据尽量还原。

function scopeList(value) {
  const clean = (x) => typeof x === 'string' && x.trim() !== '' && x.trim() !== '[object Object]'
  if (Array.isArray(value)) return value.filter(clean).map((x) => x.trim())
  /* 老库里可能是 "10.0.0.0/8, 192.168.0.0/16" 这种整串：按逗号/分号/空白切回来 */
  if (typeof value === 'string') return value.split(/[\s,;]+/).filter(clean).map((x) => x.trim())
  return []
}

function normalizeScope(scope) {
  if (scope === undefined || scope === null) return null
  if (typeof scope === 'string') return scopeList(scope)
  if (Array.isArray(scope)) {
    for (const item of scope) {
      if (typeof item !== 'string') {
        throw new TypeError('scope 必须是 CIDR 字符串或字符串数组，数组元素收到 ' + JSON.stringify(item))
      }
    }
    return scopeList(scope)
  }
  throw new TypeError('scope 必须是 CIDR 字符串或字符串数组，收到 ' + (typeof scope))
}

