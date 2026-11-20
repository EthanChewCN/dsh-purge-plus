# 移植矩阵（PORT MATRIX）

本文件是本仓库的**唯一事实来源**：safe 2.0.0 的每一项，在本基座（community 1.7.20）里
是「已等价」「真缺口」还是「冲突」，都记在这里，并附可复查的源码证据。

判定原则：

1. **上游已有等价实现 → 不移植。** 重复实现会互相覆盖，且升级时两边都要跟。
2. **上游用源码补丁解决、safe 用运行时钩子解决同一问题 → 保留上游。** 源码补丁在
   `decide()` 里直接返回，比挂 waterfall 更彻底，也不会因宿主事件改名而静默失效。
3. **只有上游完全没有的行为才进 overlay。** 目前 4 条补丁 + 1 个围栏模块。
4. 所有自有补丁 id 从 **201** 起，永不复用 1..96（两家在那一段语义冲突，见 §4）。

---

## 1. 运行时模块：safe 有、community 无文件名，但语义已覆盖

### 1.1 `subagent-control.js`（97 行）

| safe 的部件 | community 的等价实现 | 判定 |
|---|---|---|
| **P1** `session/event` 里把 `approval/policy: never` 翻成 `ask` | `#9 APPROVAL_AUTO_GRANT` 直接改宿主 `decide()`：<br>`if (this.effectivePolicy(session) === "never") return "rejected";` → `return "allowed-once";`<br>（`lib/patches/engine.mjs:14`） | **多余**。上游把拒绝分支整个删掉了，连 policy 都不用翻 |
| **P2** `approval/request` waterfall 恒返回 `allowed-once` | 同上。上游的 `replace` 把 `this.ctx.waterfall(... "approval/request" ...)` 整段注释掉，**waterfall 根本不会被调用** | **多余**。P2 挂上去永远收不到事件 |
| **P3** `session/event` 把 `sandbox/mode` 拉成 `danger-full-access` | `#51 FRESH_SESSION_FULL_ACCESS`：`const name = this.defaultPreset;` → `this.ctx.shell.sandboxMode === "danger-full-access" ? "danger-full-access" : this.defaultPreset;`<br>（`lib/patches/new-tools.mjs:1195`） | **部分多余**。上游让新会话跟随部署档；P3 额外处理"会话中途被降档"，属边缘场景 |
| **P4** `session/created` 时写一条 `sandbox/mode: danger-full-access` | 同上 `#51` | **部分多余**。P4 只写会话日志，不改官方文件；与 #51 叠加会重复写事件 |

**结论：不移植。** 唯一残留价值是 P3 的"中途降档纠偏"，但它会持续向会话日志追加
`sandbox/mode` 事件（每次被降档就写一条），把日志刷成噪音，而 #51 已覆盖 99% 场景。

> 如果将来确实需要 P3，正确做法是**只补 P3**，不要整包搬 `subagent-control.js`
> —— P1/P2 在 #9 生效时是死代码。

### 1.2 `tool-gate.js`（129 行）

| safe 的部件 | community 的等价实现 | 判定 |
|---|---|---|
| `coerceGate()`：pre-execute 的 `ask/deny/cancel` 全降成 `allow` | `#59 OFFICIAL_AUTO_REVIEW_PASSTHROUGH` 直接改 auto-review 的 `tools/pre-execute` 源码<br>（`lib/patches/new-tools.mjs:2025`，`skipIfMarked: true`） | **多余**。上游改的是拒绝方的源码，本层不再有 deny 可降 |
| `coercePost()`：post-execute 的 `block` 降成 `accept` | `#19 TOOL_RESULT_PRUNER_DISABLED` + `#48 TOOL_SHELL_DELETE_MOVE_NEUTRAL` 已分别处理结果裁剪与删除/移动提示 | **多余** |
| `denyDelegation()`：**子代理（叶子节点）不得再派活** | **无。** community 没有任何"禁止套娃"的运行时约束 | **真缺口 → 已移植** |

**结论：只移植 `denyDelegation`，落在 `lib/subagent-fence.js`（约 90 行）。**
附带修正：safe 原版在 catch 分支里也返回 `{kind:"allow"}` 覆盖下游异常，本仓库保留该
行为但去掉了整包的三层 coerce 包装。

---

## 2. 补丁：safe 独有 9 条，逐条判定

| safe id | 名称 | community 对应 | 判定 | 落点 |
|---|---|---|---|---|
| #52 | `SESSION_LOG_CLOUD_UPLOAD_REMOVED` | `#52 SESSION_LOG_UPLOAD_DEFAULT_OFF`（同名不同义：**默认关** vs **移除上传路径**） | **暂缓**。移除整条路径会改变会话日志插件的失败语义，需先确认云端同步关闭后 `session-log-deepseek` 的降级行为 | — |
| #89 | `SYSTEM_FIELD_EXTRACT` | `#72 MESSAGES_SYSTEM_CURRENT` + `#55 SYSTEM_PROMPT_REPLACE_HEAD` + 整套 `identity.js` 提示词层 | **拒绝**。safe 把 `role:system` 消息抽成独立 `system` 字段，会与上游"把 system 放在 messages 首位并按节点重写"的架构正面冲突，双重插入风险高 | — |
| #90 | `OPENAI_NATIVE_SYSTEM_ROLE` | `#57 DEEPSEEK_SYSTEM_ROLE` 只做 DeepSeek | **真缺口，暂缓**。价值取决于是否用 OpenAI 原生 provider；你当前用 subagent-codex/claude-code（外部 CLI，不走 provider API），收益低 | 待定 |
| #91 | `ANTHROPIC_NATIVE_PARAMS_SYSTEM` | 同上 | **真缺口，暂缓**。同上 | 待定 |
| #92 | `SUBAGENT_SAME_INJECT_PATH` | `lib/index.js:702` 已在 `session/created` 对每个 session 调 `wrapOne()` 挂 `system-prompt/assemble` | **疑似多余，待实测**。子会话也是 session，理论上已被覆盖 | — |
| #93 | `PRODUCT_ANALYTICS_DEFAULT_OFF` | **无** | **真缺口 → 已移植** | `overlay.mjs` **#201** |
| #94 | `PRODUCT_TELEMETRY_OTEL_NOOP` | **无** | **真缺口 → 已移植（改写）** | `overlay.mjs` **#202** |
| #95 | `SESSION_TELEMETRY_OTEL_DISABLED` | **无** | **真缺口 → 已移植** | `overlay.mjs` **#203** |
| #96 | `SKILL_OFFICE_ASSET_FALLBACK` | **无** | **真缺口 → 已移植（改写）** | `overlay.mjs` **#204** |

### 2.1 对 safe 原版的两处改写（必须记录）

**#202（原 safe #94）** —— safe 的替换串是：

```js
this.reporter = { emit() {}, async shutdown() {} }; return; const reporter = ctx.otel.createEventReporter({
```

`return;` 在构造函数里合法，但会**跳过尾部 `ctx.effect(shutdown)` 注册**，并留下一条
不可达的 `const` 声明。本仓库改为把工厂调用整体挪进一个永不被调用的对象字面量：

```js
const reporter = { emit() {}, async shutdown() {} };
const __purgePlusUnusedExporter = ({ /* 原参数对象原样保留 */ });
```

控制流不断，`ctx.effect` 照常注册（stub 的 `shutdown()` 是 no-op，注册也无害）。

**#204（原 safe #96）** —— safe 的替换串里用了 `statSync`，但宿主
`dsh-skill-office/lib/index.js` **只 import 了 `readFile`**（`node:fs/promises`），
`statSync` 是未定义标识符 → 打上之后 Host 启动即 `ReferenceError`。
本仓库在补丁里**额外加一条 replacement**，先补 `import { statSync } from "node:fs";`。

> 这是 safe 2.0.0 的真实缺陷，不是版本差异：它的 `dshTarget` 写 `0.2.2-rc.3`，
> 而 `statSync` 在 rc.3/rc.5 的该文件里都不存在。

---

## 3. UI / 演练台：safe 明显更多，但**暂不移植**

safe 独有 22 个前端文件（合计约 15,360 行）：

```
redteam/unified-layout.css  unified-components.css  workbench-layout.css
redteam/overview-workbench.css  sessions-view.css  settings-view.css
redteam/skills-view.css  collaboration-view.css  detail-surfaces.css
redteam/responsive-dock.css  studio-skin.css  workspace-skin.css  glass-skin.css
redteam/team-mode.js  kev.js  bootstrap-runtime.js  slot-state.js
ui-theme.css  ui-theme.js  ui-fullscreen.js  product-shell.css  preset-default.js
```

**为什么不搬：** 这些文件依赖 safe 自己的 `lib/redteam/client.js`（16,247 行，比
community 的 5,414 行 `store-core.js` + 15,601 行 `client.js` 是另一套组件树）。
搬 CSS 不搬组件树 = 一堆没挂载的样式；搬组件树 = 实质上是把整个 UI 层换成 safe 的，
那就不是"移植"而是"换基座"了，与"以 community 为基座"矛盾。

**如果确实想要 safe 的演练台 UI**，正确路径是单独开一个前端 overlay 分支，
把 safe 的组件树整体替换进去，并接受 community 的 redteam 后端要跟着改。
这是一次独立工程，不在本仓库第一版范围内。

---

## 4. id 命名空间冲突（永不触碰 1..96）

| id | community 语义 | safe 语义 |
|---|---|---|
| #52 | `SESSION_LOG_UPLOAD_DEFAULT_OFF` | `SESSION_LOG_CLOUD_UPLOAD_REMOVED` |
| #85 | （已移除，被 #90 取代） | `SESSION_PROMPT_STEER_INTERRUPT` |
| #86 | （已移除，被 #90 取代） | `SESSION_QUEUE_STEER_INTERRUPT` |
| #89 | `ASK_USER_WAIT_CAPPED` | `SYSTEM_FIELD_EXTRACT` |
| #90 | `RESTORE_NATIVE_STEERING` | `OPENAI_NATIVE_SYSTEM_ROLE` |
| #91 | `BROWSER_COOKIE_NAME_IGNORE_PORT` | `ANTHROPIC_NATIVE_PARAMS_SYSTEM` |
| #92 | `HOST_MAX_HTTP_HEADER_SIZE` | `SUBAGENT_SAME_INJECT_PATH` |
| #93 | `SANDBOX_POLICY_BRAND_NEUTRAL` | `PRODUCT_ANALYTICS_DEFAULT_OFF` |
| #94 | `SKILL_BADGE_DESCRIPTION_NEUTRAL` | `PRODUCT_TELEMETRY_OTEL_NOOP` |
| #95 | `INSPECTOR_FRAME_BUDGET_RECORD_OVERHEAD` | `SESSION_TELEMETRY_OTEL_DISABLED` |
| #96 | `INSPECTOR_FRAME_BUDGET_RECORD_OVERHEAD_CLIENT` | `SKILL_OFFICE_ASSET_FALLBACK` |

**策略：自有补丁一律 ≥201，且 `build.mjs` 会断言上游最大 id 恰为 96。**
上游一旦突破 96，构建直接失败，强制人工复核本文件 —— 这是防止再次撞号的机械闸门。

状态目录（`~/.dsh/dsh-purge-community/`）**故意不改名**：那里存着既有补丁基线、
`audit.jsonl`、`preset-migrations`。改名会让历史基线变孤儿，下一次 apply 会把
官方原文当成"没打过"重打一遍。两家的 `.dshpurge.bak` 后缀相同，共用同一份基线更安全。

---

## 5. 锚点漂移监控表

这 4 条是 overlay 全部的技术债。宿主升级后 `scripts/verify.mjs` 会逐条报命中次数，
**命中 0 次 = 必须重写；命中 ≥2 次 = 会打歪**。

| 补丁 | 宿主文件 | 锚点位置（0.2.2-rc.5 实测） |
|---|---|---|
| #201 | `dsh-client-product-analytics/lib/index.js` | `:313` `enabled: z.boolean().default(true).volatile(),` |
| #202 | `dsh-host-product-telemetry-otel/lib/index.js` | `:41-42` `super(ctx, "productTelemetry");` + `const reporter = ctx.otel.createEventReporter({` |
| #203 | `dsh-session-telemetry-otel/lib/index.js` | `:25` `const DEFAULT_TELEMETRY_MODE = SessionTelemetryMode.FEEDBACK_ONLY;` |
| #204 | `dsh-skill-office/lib/index.js` | `:1` `import { readFile } from "node:fs/promises";`<br>`:59-60` `const assetRoot = config.assetRoot ?? ...` + `if (!isAbsolute(assetRoot)) throw ...` |
| 围栏 | `dsh-tools/lib/pipeline.js` | 运行时钩子 `tools/pre-execute`，无源码锚点 |
