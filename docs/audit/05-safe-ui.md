# 05 · safe 2.0.0 主面板 UI 审计

> 审计对象：`vendor/safe/client.js`（23,299 行，单文件浏览器 bundle）。
> 标注约定：`[静态]` = 只读代码得出；`[实测]` = 用 Node 装载真实源码片段跑过。
> 行号以当前 `vendor/safe/` 快照为准（2026-11-20）。
> 本文只覆盖客户端 UI；服务端路由与 op 实现只在"能否对上"这一层被引用。

## 0. 先给三个会改变移植结论的事实

这三条与「safe 的 UI 比 community 多几个页签」这个直觉相反，必须先说清：

1. **safe 的设置面板没有页签。** `SettingsRoot` 只是一个纵向容器，把 `PurgifySection` / `RulesSection` / `SkillsSection` 三个 section 顺序排下来（`client.js:4892-4898`），没有 tab 状态、没有 `TABS` 常量。community 的 6 页签（`vendor/community/client.js:13805-13812`）在 safe 里被拆成了「单列滚动 + 一个浮动 dock」。
2. **`TAB_GROUPS` 不是设置面板的页签，是演练台的页签。** 它定义在 `client.js:21484-21491`，属于内联进本文件的演练台 bundle（`__dshPurgeDrill`，`client.js:5592-21815`），管 12 个演练台页签。设置面板与它无关。
3. **站内全屏 hook 写完了，但没有活路径能走到它。** `useWorkbenchFullscreen`（`client.js:61`）确实在 `Panel` 里被调用（`client.js:21497`），但 `Panel` 在本插件里只有一处挂载点，而且是 `embedded: true`（`client.js:22648`）；`embedded` 为真时全屏按钮被渲染成 `null`（`client.js:21739`）、`FULL_REQUEST_EVENT` 监听直接 `return`（`client.js:21507-21508`）、`full` 恒为 `false`（`client.js:21498`）。dock 头部的「全屏」按钮走的是 `window.open(...#redteam-full)`（`client.js:21984-21986`），而那个 hash 只被 `isFullWindow()` 读取（`client.js:15668`），读取它的 `Panel` 又只在 embedded 下挂载 —— 所以这条链也是断的。详见 §3.12 与 §9 的 `SF-UI-041/042`。

---

## 1. 模块清单

### 1.1 文件级

| 文件 | 行数 | 一句话职责 | 是否被 index.js 加载 |
|---|---|---|---|
| `vendor/safe/client.js` | 23,299 | 浏览器侧全部 UI：浮动 dock、补丁/规则/技能三区、回退按钮、提醒胶囊、发送门禁、内联演练台 | 是。宿主 `dsh-client-modules` 按**包名**匹配浏览器模块名（`client.js:1` 的 `window.__ModuleLoader__.load({ id: "dsh-purge-safe" })`），包名与 `package.json` 的 `name` 必须一致 |

### 1.2 文件内分段（这是读懂它的唯一办法）

`client.js` 不是"一个模块"，是**两个 bundle 拼在一起**：外层是 safe 主客户端，中间整段塞了演练台 bundle。

| 段 | 行范围 | 行数 | 职责 | 备注 |
|---|---|---|---|---|
| 模块外壳 | 1 | 1 | `__ModuleLoader__.load({id:"dsh-purge-safe", factory})` | 改包名必须同步改这里 |
| 全屏 hook 注入块 | 3-299 | 297 | `useWorkbenchFullscreen` + 4 个 DOM 辅助函数 | 由构建脚本从 `lib/ui-fullscreen.js` 内联；`/* __DSH_PURGE_FULLSCREEN_BEGIN__ */`（`client.js:2`） |
| 主题注入块 | 300-524 | 225 | `createProductTheme` / `productThemeHost` / `productTheme` 单例 | `lib/ui-theme.js` 内联；`__DSH_PURGE_THEME_BEGIN__`（`client.js:300`） |
| **主模块工厂开始** | 527-5591 | 5,065 | `name/inject/NS`、i18n 字典、`PURGE_CSS`、补丁/规则/技能三区、回退按钮 | `var module = {exports:{}}`（`client.js:527`） |
| i18n | 708-1407 | 700 | `zh`（708-1057）+ `en`（1058-1407），各 346 键 | 两字典键集完全一致 `[静态]` |
| `PURGE_CSS` | 1408-3264 | 1,857 | 主面板全部样式 | 432 个类 |
| **演练台 IIFE** | 5592-21815 | 16,224 | `const __dshPurgeDrill = (() => {...})()`，返回 `{CSS, Panel, setUI, useUI, isFullWindow, setDockWidth}` | `client.js:21809-21814` |
| └ 全屏/主题副本 | 5596-6122 | 527 | 与 3-524 逐字重复（因为演练台源码单独编译过一次） | `[静态]` 两段函数体一致 |
| └ 演练台 `CSS` | 6325-15665 | 9,341 | 860 个类；其中 7349-15664 是"产品皮肤"8316 行 | 占全文件 40% |
| **主模块尾部** | 21816-23299 | 1,484 | drill 授权、dock bus、attention、PurgeDock、AttentionToast、apply | 与 527-5591 是同一个 `module.exports` |

`[静态]` 结论：**UI 逻辑只有约 6.5k 行，剩下 17k 行是 CSS 和内联的演练台。** 移植主面板不需要碰 5592-21815 那 16k 行，只需要它的两个导出（`Panel`、`CSS`）。

---

## 2. 数据模型

客户端**没有任何持久化业务对象**。所有状态分四层：`localStorage`、`sessionStorage`、模块级内存、宿主服务只读快照。

### 2.1 localStorage

| 键 | 值形状 | 写点 | 读点 | 生命周期 |
|---|---|---|---|---|
| `dsh-purge-safe-ui-theme` | `"dusk"｜"white"｜"system"` | `client.js:495-509`（`productTheme.set`） | `client.js:369-390`（`readStoredMode`） | 永久；`system` 时再按宿主属性解析 |
| `dshp-ui-surface` | `"desktop"｜"web"` | `client.js:573`（`rememberUiSurface`，只写 `desktop`） | `client.js:556` | 永久；用来决定是否发 `x-dsh-surface` 头 |
| `dsh-purge-safe-user-notice-v1` | `"1"` | `client.js:21830` | `client.js:21827` | 永久；首次欢迎弹窗已读标记（键名刻意混淆） |
| `dsh-purge-safe-drill-auth` | `"1"` | `client.js:21839` | `client.js:21835` | 永久；但**以服务端 `drill-grant` 为准**（见 §3.9） |
| `dsh-purge-safe-dock-geom-v4` | `{x,y,w,h}` | `client.js:22034` | `client.js:22028` | 永久；dock 几何，混淆键名 |
| `dsh-purge-safe:attention-pos` | `{x,y}` | `client.js:23035` | `client.js:23025` | 永久；胶囊位置 |
| `rt-last-engagement` | 字符串 id | `client.js:15710` | `client.js:15707` | 永久；演练台"上次选择" |
| `rt-dock-geom-v1` | `{x,y,w,h}` | `client.js:21287` | `client.js:21256` | 永久；演练台独立面板几何（embedded 时不写，`client.js:21286`） |
| `rt-unread:<eng>` | `{tab:{count,at}}` | `client.js:21208` | `client.js:21202` | 按靶标；未读基线 |
| `rt-collapse:<prefix>` | `{key:bool}` | `client.js:19423` | `client.js:19417` | 按"页签+靶标"；折叠态 |
| `rt-dock-width` | 数字 | 无人写（只读） | `client.js:21248` | **只读遗留键**：`defaultRtGeom` 读它，但全文件没有写它的代码 `[静态]` |

### 2.2 sessionStorage

| 键 | 值 | 写点 | 读点 | 说明 |
|---|---|---|---|---|
| `dshp-ui-surface` | `"desktop"` | `client.js:572` | `client.js:561` | localStorage 的镜像，供隐私模式兜底 |
| `dshp-rewind-draft:<sid>` | 字符串 | `client.js:5027`（`writeDraft`） | `client.js:5033`（`peekDraft`） | 回退后要填回输入框的正文 |
| `dshp-rewind-arm:<sid>` | 时间戳字符串 | `client.js:5049` | `client.js:5056-5058` | 填充授权时间戳；45s 过期（`ARM_TTL_MS`，`client.js:4922`） |

### 2.3 模块级内存状态

`[静态]` 全部是 `let`/`const` 顶层变量，随页面存活；刷新即清零。

| 变量 | 定义 | 形状 | 谁写 | 谁读 | 生命周期 |
|---|---|---|---|---|---|
| `translate` | `client.js:537` | 函数 | `apply()`（`client.js:23268`）、`SettingsRoot` 渲染时（`client.js:4891`） | `useT()`（`client.js:538-540`） | 页面级。**注意**：`SettingsRoot` 在渲染期赋值，所以第一个渲染它之前的组件拿到的是 `(k)=>k` 原样键 |
| `rewindSeenAt` | `client.js:4923` | 毫秒时间戳 | `client.js:5503`、`client.js:5578` | 轮询比较（`5576` 判定） | 页面级；`installRewindWatch` 每 1200ms 比对服务端 `at` |
| `rewindSessions` / `rewindHost` / `rewindWorkspace` / `rewindConversation` | `client.js:4924-4927` | 宿主服务引用 | `installRewindUi`（`client.js:23242-23245`） | `currentSessionId`（`client.js:4941`）、`conversationFace`（`client.js:5072`）等 | 页面级；插件卸载不清空（**泄漏点**，见 §8） |
| `pendingComposer` | `client.js:4928` | `{sessionId,text,at}` | `writeDraft`（`client.js:5027`）、`clearStoredDraft`（`client.js:5040`） | `peekDraft`（`client.js:5033`） | 单槽，后写覆盖 |
| `armedFill` | `client.js:4929` | `{sessionId,text,at}` | `armComposerFill`（`client.js:5044`）、`takeArmedFill`（`client.js:5053`） | `takeArmedFill` | 单槽 + 45s TTL |
| `restartLockUntil` | `client.js:4759` | 时间戳 | `client.js:4763` 附近 | 重启去重 | 页面级 |
| `ui` / `subs` | `client.js:15729-15730` | `{open,tab}` / `Set<fn>` | `setUI`（`client.js:15731-15737`） | `useUI`（`client.js:15741-15750`） | **演练台页签 + 开关的唯一真相源**，跨组件共享 |
| `dockWidthTag` | `client.js:15739` | `null` | 无人写 | 无人读 | 死变量（`setDockWidth` 是空函数，`client.js:15740`） |
| `shotCache` / `shotLoading` | `client.js:15768-15769` | `Map<string,dataURL>` / `Map<string,Promise>` | `loadShot`（`client.js:15771-15783`） | `shotSrc`（`client.js:15770`） | **无淘汰**，页面级累积 |
| `SESSION_MAP_RPC_SEQ` | `client.js:20299` | 自增整数 | `nextSessionMapRpcId`（`client.js:20300`） | 同上 | 页面级 |
| `drillGrantGen` / `drillGrantPosting` / `drillGrantState` / `drillSyncRetryTimer` | `client.js:21820-21823` | 数字 / `{ready,granted}` / timer | `writeDrillAuth`（`client.js:21842`）、`syncDrillGrant`（`client.js:21860`） | `readDrillAuth`（`client.js:21833`） | 页面级；`ready=true` 后 localStorage 不再被读 |
| `dockBus` | `client.js:21892` | `{open,tab,authOpen,pending,listeners:Set}` | `setDock`（`client.js:21894`） | `useDock`（`client.js:21898`） | 页面级；**dock 的全部 UI 状态** |
| `attentionState` | `client.js:21919` | `{at,items,people,gaps,note,engagement,session,listeners,timer}` | `publishAttention`（`client.js:21920`） | `useAttention`（`client.js:21956`） | 页面级；单例轮询，见 §3.7 |

### 2.4 宿主侧只读数据源（不持久化，只订阅）

| 来源 | 取法 | 行号 | 用途 |
|---|---|---|---|
| 当前会话 id | `uiWorkspace.selection.getSnapshot().sessionId` → 退化到 `sessions.list.getSnapshot().current` | `client.js:4941-4951` | 回退按钮、attention 轮询、门禁 |
| 会话标题 | `sessions.list.getSnapshot().byId[sid].header.title`（或 `.title`） | `client.js:4953-4963` | 传给演练台做"按标题反查靶标" |
| 会话 cwd | `projectionValues.cwd` → `.cwd` → `.header.cwd` | `client.js:22211-22226` | 规则页 `scan-cwd` 的默认目录 |
| 会话 preset | `projectionValues.agentPreset` → `.agentPreset` → `.header.agentPreset` | `client.js:22195-22210` | 判断是否红队模式（`client.js:22250`） |
| 会话队列 | `sessions.sessionOf(scope(sid)).getSnapshot().queue` | `client.js:5191-5199` | 回退后清掉继承来的排队项 |
| 输入框 draft | `conversation.input.shell(sid).state.getSnapshot().draft` | `client.js:5098-5108` | 判断能否覆盖、是否已填 |

---

## 3. 业务逻辑（按入口）

### 3.1 `apply(ctx)` — 插件唯一入口

`client.js:23266-23293`。

**判据 / 顺序**

1. `ctx.locale.register(NS, {zh, en})`（`client.js:23267`），`NS = "settings.dsh-purge-safe"`（`client.js:536`）。
2. `translate = ctx.locale.bind(NS)`（`client.js:23268`）。
3. `ctx.slots.inject("shell.overlay", ...)` 注册 `id: "dsh-purge-safe-dock"`、`order: 50`（`client.js:23270-23275`），渲染 6 个组件：`WelcomeNotice, PurgeDock, HeroNewSessionMount, TabRowPurgeMount, EnvAdaptSendGate, AttentionToast`（`client.js:23274`）。
4. `ctx.inject(["sessions","uiWorkspace","workspaces","conversation"], host => installRewindUi(host))`（`client.js:23279`）；失败退化到 `ctx.sessions`（`client.js:23280-23281`）；再失败退化到三依赖版本（`client.js:23285-23286`）；全失败只 `console.warn`（`client.js:23288`）。

**导出**：`exports.name = "dsh-purge-safe"`（`client.js:23294`）、`exports.inject = ["slots","locale"]`（`client.js:535`、`23295`）、`exports.apply`（`client.js:23296`）。

**失败路径**：三段 `try/catch` 全是降级不抛错。`shell.overlay` 注册没有 `try`——若宿主没有该 slot，整个 `apply` 抛错（`client.js:23270`）。

### 3.2 `PurgeDock` — 浮动面板（真正的主面板）

`client.js:22503-22708`。

**状态**：`geom`（`localStorage` 持久化，`client.js:22026-22036`）、`dockTheme`（`detectHostTheme`，`client.js:4839-4857`）、`currentSid`/`currentTitle`（800ms 轮询，`client.js:22538-22549`）。

**判据**

- `st.open === false` → `data-open="0"` + `style.display` 不设，实际靠 CSS 隐藏 `[静态]`；组件仍渲染（`client.js:22652-22666`）。
- `st.tab === "clean"` → 渲染 `SettingsRoot`（`client.js:22645-22646`）。
- `st.tab === "drill" && readDrillAuth()` → 渲染 `__dshPurgeDrill.Panel {embedded:true, sessionId, sessionTitle}`（`client.js:22647-22648`）。
- 未授权 → 一行灰字 `t("dock.unauthorized")`（`client.js:22649`）。

**副作用**

- 挂 3 个 `<style>` 到 `document.head`：`PURGE_CSS`（`data-dsh-purge-safe-ui`，只在缺失时插入，`client.js:22519-22526`）、演练台 `CSS`（`data-dsh-purge-safe-drill`，每次挂载插入、卸载移除，`client.js:22527-22531`）、宽度变量 `:root{--dshp-dock-w/--dshp-dock-h}`（`client.js:22532-22535`）。
- 用 `react-dom.createPortal(panel, document.body)`（`client.js:22695-22702`）——dock **不在任何 slot 里**，是从 `shell.overlay` 的 fiber 里 portal 到 body。
- 拖拽/四向缩放全部手写 `mousedown→window.mousemove/mouseup`（`client.js:22561-22645`），无 pointer events，无 `setPointerCapture`。

**失败路径**：`require("react-dom")` 失败 → `portal = null` → 直接渲染 `panel`（会落在 slot 容器里，样式错位但可用，`client.js:22698-22702`）。

### 3.3 `PurgifySection` — 补丁区

`client.js:3551-4084`。这是 safe 里最大的一个组件（534 行、19 个 `useState`）。

**入口 1：`loadAll(opts)`（`client.js:3597-3690`）**

- 判据：`quiet = opts.quiet || patchBusyRef.current || keepSuccessNoticeRef.current`（`client.js:3598`）；`quiet` 时不拉 override/own-servers（`client.js:3655`）。
- `GET /dsh-purge-safe/status`（`client.js:3614`）：若 `d.applying === true || d.ready === false` → 合并进 state + `scheduleRetry()`（`client.js:3616-3628`；重试逻辑在 `client.js:3602-3612`，700ms 一次、上限 40 次）。
- `d.ok` → `setState(d)`；`d.boot_full_quit && !suppressRestartAsk` → `setAskRestart(true)`（`client.js:3630-3641`）。
- 失败：`soft = /timeout|cross-origin|连不上接口/`（`client.js:3647`）或 `holdNotice()` → 静默重试；否则 `setNotice(error)`（`client.js:3648-3654`）。
- `GET /dsh-purge-safe/override`（`client.js:3656`）：`packed = d.defaultContent`，`shown = d.content ?? packed`；**只在 `!promptSeededRef.current || !promptDirtyRef.current` 时覆盖输入框**（`client.js:3658-3675`）——即用户改过就不覆盖。
- `GET /dsh-purge-safe/own-servers`（`client.js:3677`）：失败静默吞（`client.js:3682-3683`）。
- 生命周期：挂载即跑一次 + 5s 后再跑一次（`client.js:3684-3689`）。

**入口 2：`doAction(action, actionKey)`（`client.js:3700-3795`）**

- 只被两处调用：`apply`（`client.js:3988`）、`revert`（`client.js:3989`）。
- 判据：`action === "apply"` → body 带 `{content: readPromptBox()}`，否则 `{}`（`client.js:3705-3707`）；`surface === "desktop"` 时 body 加 `surface:"desktop"`（`client.js:3708`）。
- 请求：`POST /dsh-purge-safe/<action>`（`client.js:3709`），**裸 `fetch` 不走 `apiJson`**，因此没有超时与错误归一。
- 并发保护：`actionTicket` 自增，回包时 `ticket !== actionTicket.current` 直接丢弃（`client.js:3716`）。
- `responseNeedsPrompt(d)` → `rejectNeedPrompt`（关重启询问 + 红字 + `window.alert`，`client.js:3717-3720`、`3690-3695`）。
- 失败路径三分支（`client.js:3755-3792`）：`host_written === false` 拼 `restart.incomplete.host`；`action === "apply"` 成功后按 `ask_restart/restarting/needs_full_quit` 决定弹重启窗。

**入口 3：`saveOverride` / `restoreOverride`（`client.js:3797-3875`）**

- 判据：`bothInjectEmpty(readPromptBox(), defaultOverrideRef.current)` → 视为"清空注入"，直接 `rejectNeedPrompt`（`client.js:3832-3839`）。
- `POST /dsh-purge-safe/override {content}`（`client.js:3805`、`3850`）；成功后 `promptDirtyRef.current = false`（`client.js:3821`）。

**入口 4：`doUninstall`（`client.js:3905-3936`）**

- `POST /dsh-purge-safe/uninstall {}`（`client.js:3911`）。
- 桌面端：`d.surface === "desktop" || d.fullApp` → 直接返回（不轮询，`client.js:3915`）。
- Web 端：`waitHostAfterUninstall`（`client.js:3877-3903`）每 500ms `GET /`（`client.js:3880`），成功则清 `dshp-theme`/`dshp-theme-mode` 并 `location.reload()`；90s 超时报 `restart.timeout`。
- `fetch` 直接抛 `failed to fetch` 也按"已卸载"处理（`client.js:3920-3927`）。

**入口 5：重启询问 `RestartAsk`（`client.js:3525-3550`）+ `restartDsh`（`client.js:4761-4837`）**

- `POST /dsh-purge-safe/restart`（`client.js:4787`），带 `{surface}`；最多 4 轮重试（`client.js:4778`、`4795`、`4805`、`4832`）。
- `waitForRestart` 轮询 `GET /dsh-purge-safe/status`（`client.js:4733`），`d.ok && d.ready !== false` → `reopenAfterRestart()`（`client.js:4740`）。

### 3.4 `RulesSection`

`client.js:4091-4354`。

**op 通道**：`rulesApi(op, extra)` = `POST /dsh-purge-safe/rules {op, ...extra}`（`client.js:682-688`）。这是本插件唯一的"op 复用单路由"写法。

| op | 触发 | 行号 |
|---|---|---|
| `status` | 挂载 + 每次动作后 | `client.js:4110` |
| `read` | 点规则条目 | `client.js:4147` |
| `activate` | 点「启用」 | `client.js:4198` |
| `delete` | 点「删除」（先 `window.confirm`） | `client.js:4209` |
| `reset` | 点「恢复默认」（先 confirm） | `client.js:4233` |
| `set-policy` | `<select>` 变更即提交 | `client.js:4246` |
| `scan-cwd` | 点「扫描目录」 | `client.js:4260` |
| `toggle-cwd` | 目录项勾选框 | `client.js:4277` |
| `save` | 编辑器保存（含"另存为新规则"） | `client.js:4310`、`4344` |

**判据**：`d.ok` 才算成功；`action === "save" || "activate"` 时额外 `warnNeedPrompt`（`client.js:4133`）。`policyOptions` 缺省 `["fallback","strict","always"]`（`client.js:4218`）。

**失败路径**：`st` 置为 `{ok:false, rules:[], active:null}` 并红字（`client.js:4114-4124`）；列表空时显示 `t("rules.empty")`（`client.js:4170`）。

### 3.5 `SkillsSection`

`client.js:4434-4723`。

**op 通道**：`skillsApi(op, extra)` 先打 `POST /dsh-purge-safe/skills`，若错误串匹配 `/\b404\b|\b405\b|non-json/` 则重试 `POST /dsh-purge-safe/skill`（`client.js:694-704`；`skillsRouteMissing` 判定在 `690-692`）。这是"新路由未加载时退回旧路由"的兼容层。

| op | 触发 | 行号 |
|---|---|---|
| `status` | 挂载 | `client.js:4473` |
| `read` | 点技能卡片 | `client.js:4505` |
| `import` | 选 zip 或选目录后 | `client.js:4542` |
| `delete` | 删除 | `client.js:4631` |
| `save` | 编辑器保存 | `client.js:4714` |

**判据**：`skillUiAllowed(d)` 门禁（`client.js:4355-4365`）；导入时 `keepFolderFile` 过滤 `node_modules/.git/__MACOSX/.system/._*/DS_Store` 与含 `..` 的路径（`client.js:4555-4566`）；zip 走 `FileReader.readAsDataURL` 取 base64（`client.js:4523-4533`）。

**失败路径**：`skillsRouteMissing(e)` → 提示 `t("err.skills.needRestart")`（`client.js:4496-4501`）。

### 3.6 `RewindButton` — 输入框右侧「回退」

`client.js:5459-5567`，挂在 `conversation.input.right`（`client.js:23245-23253`）。

**判据**

- `disabled = busy || !sessionId`（`client.js:5553`）。
- 菜单两项：`runRewind("once")` / `runRewind("round")`（`client.js:5366`、`5378`）。
- `POST /dsh-purge-safe/rewind {sessionId, mode}`（`client.js:5498`）。
- 成功判据：`data.ok && data.sessionId && data.cleared !== false`（`client.js:5503`）——**`cleared === false` 视为失败**，文案「没有清掉之前发送的内容」。
- 成功后：`rewindSeenAt = data.at`；`isPluginDraft(text)` 则清空；`armComposerFill` → `openRewoundSession` → `scheduleComposerFill`（`client.js:5503-5507`）。

**副作用链（这是最容易做错的一段）**

1. `armComposerFill(sid, text)`：写 `armedFill` + `sessionStorage[draft]` + `sessionStorage[arm]`（`client.js:5044-5051`）。
2. `openRewoundSession(sessions, sid)`：最多 25 次 × 120ms，先 `sessions.refresh()` 再 `uiWorkspace.openSession(sid)`（无则 `sessions.open(sid)`），确认 `selection.getSnapshot().sessionId === sid` 后清队列（`client.js:5204-5233`）。
3. `scheduleComposerFill(sid, text)`：在 `[0,50,180,400,800]`ms 五次尝试写 draft；一旦发现"用户已经改成别的"就永久停手（`client.js:5128-5153`、`4921`）。

**失败路径**：任何一步抛错 → 按钮文字变「回退失败: …」（截断 18 字，`client.js:5538-5542`）；`RewindSafe` 是 error boundary，渲染崩了就退化成 class 版 `RewindFallback`（`client.js:5237-5246`、`5390-5457`）。

**全局副作用（与回退无关但同段）**：模块加载时就装了一个"输入框看门狗"——`visibilitychange`/`focus`/`pageshow` + 8s 定时 + `MutationObserver`，发现 composer 不存在就重开当前会话（`client.js:4980-5004`）。这是为修"重启后输入框消失"，代价是常驻三套监听。

### 3.7 `AttentionToast` + `refreshAttention` — 悬浮胶囊

`client.js:23050-23238`（组件）、`21918-21970`（数据）、`22920-23019`（动作）。

**数据入口**：`POST /redteam/api {op:"attention", session?}`（`client.js:21930-21935`）。**主模块传 `session`，演练台 `OverviewTab` 传 `engagement`**（`client.js:15970`）——同一个 op 两种入参，服务端需两者都支持。

**轮询**：`ATTENTION_POLL_MS = 8000`（`client.js:21918`）；`startAttentionPolling` 先 `setTimeout(refreshAttention, 1200)` 再 `setInterval`（`client.js:21947-21952`）；监听器归零时 `stopAttentionPolling`（`client.js:21964-21967`）。**单例**：所有 `useAttention()` 共享一个 timer，注释明确写了"两个组件各自轮询会打两次接口"（`client.js:21911`）。

**渲染判据（顺序敏感）**

1. `people === 0` → `return null`（`client.js:23109`）——**注意 `justDropped` 那个 `useEffect` 必须在它之前**，否则 hook 数量跳变会 React #310 崩整个 overlay（注释 `client.js:23093`，`useEffect` 本体 `23088-23107`）。
2. `quiet = snoozeUntil && Date.now() < snoozeUntil`（`client.js:23112`）——不是隐藏，是收成小圆点。
3. `items = items.filter(stage.startsWith("person/")).slice(0,3)`（`client.js:23113`）；`rest = people - items.length`。
4. `urgent = items.some(stage === "person/blocked" | "person/failed")`（`client.js:23068`）。

**展示内容**：头部 `⚠ 等你处理 N`（`t("attn.toast.title")` + `people`，`client.js:23207-23215`）；每条 `stage 文案 / who / reason / needs[]`（`client.js:23223-23231`）；`rest>0` 与 `gaps>0` 两行补充（`client.js:23233-23234`）；底部「去处理」+「稍后/恢复」（`client.js:23235-23237`）。

**stage 文案映射**：`person/answer→等你解答`、`person/review→等你验收`、`person/blocked→卡住了`、`person/failed→失败了`、`working→在跑`、其余 `等待`（`client.js:22910-22918`）`[实测]` 已跑该映射。

**点击「去处理」`handleAttention`（`client.js:22995-23001`）**

1. `openAttention()`：`requestDrill("tab")` + `__dshPurgeDrill.setUI({open:true, tab:"overview"})`（`client.js:22920-22927`）。
2. `attentionPrompt(a)`：把 `person/*` 条目拼成一段可直接发送的中文指令（`client.js:22936-22970`），最后一句要求用 `redteam_attention action=ack session_id=...` 收口。
3. `fillAttentionPrompt(text)`：**只填不发**。优先 `conversation.input.shell(sid).setDraft(text)`，失败退 `armComposerFill + scheduleComposerFill`；输入框已是同文则跳过（`client.js:22972-22993`）。

**「稍后」**：`SNOOZE_MS = 10min`、`SNOOZE_URGENT_MS = 3min`（`client.js:23020-23021`）；到点用 `setTimeout` 自己恢复（`client.js:23071-23078`），注释写明"签名式忽略等于永久静音"（`client.js:22908`）。

**拖拽**：`pointerdown` 在**头部**上 `setPointerCapture`（不能捕获到外层胶囊，否则冒泡收不到，注释 `client.js:23145-23146`）；拖动期间直接写 `el.style.left/top` 不走 `setState`（注释 `client.js:23158-23161`）；松手才落 state + 存 localStorage；`justDropped` 用坐标判定而非 `pointerleave`（`client.js:23088-23107`）；`suppressRef` 300ms 挡掉抬手补发的 click（`client.js:23127`）。

**挂载点**：`shell.overlay`（`client.js:23270-23275`），**不是** `conversation.input.right`。`conversation.input.right` 只挂 `RewindSafe`（`client.js:23245`）。

### 3.8 `EnvAdaptSendGate` — 发送前门禁

`client.js:22312-22501`。

**判据链 `mustBlockSubmit`（`client.js:22345-22356`）**

1. `!isRedteamModeActive()` → 放行（非红队预设不管）。
2. 缓存超过 2500ms → 异步 `refresh()`，但**本次仍用旧缓存判定**。
3. `cached.ready` → 放行。
4. 否则 `blockAndOpen()` 并返回 `true`（拦）。

`blockAndOpen`（`client.js:22331-22343`）：未授权 → `requestDrillEnv()`（先走完整授权窗）；已授权 → 只弹精简窗。

**三重拦截（这是它真正的实现方式）**

| 层 | 手段 | 行号 |
|---|---|---|
| 1 | **猴补宿主 `shell.submit`**：`WeakMap` 存 `origSubmit`，卸载时逐个还原 | `client.js:22357-22394` |
| 2 | 捕获阶段 `pointerdown`/`click` 命中"发送控件"则 `preventDefault + stopImmediatePropagation` | `client.js:22410-22431` |
| 3 | 捕获阶段 `keydown` Enter（非 Shift、非 composing、在 composer 内）同样拦 | `client.js:22417-22431` |

「发送控件」识别 `looksLikeSendControl`（`client.js:22270-22296`）：label 含 `发送|Submit|Send`；或 `[data-composer-card]` 内的 `primary` 按钮且带 svg；或 `form` 内的 `type=submit`。排除 `停止|Stop`。

**副作用**：`op:"platformEnvAdaptSkip" {skip:true}`（`client.js:22467`）；轮询 `op:"platformEnvAdaptStatus"` 每 5000ms（`client.js:22298-22306`、`22403`）。

**失败路径**：`fetchEnvAdaptStatus` 全 `.catch(()=>null)`（`client.js:22304`）；`fetchEnvAdaptStatusSync` 恒返回 `null`（`client.js:22309`）——注释说明不再用同步 XHR，缓存缺失按"未知→保守 block"。

### 3.9 `WelcomeNotice` / `AuthGate` / `syncDrillGrant` — 三道授权门

**`WelcomeNotice`（`client.js:22037-22094`）**：`!readWelcomeAck()` 时 portal 到 body；单个勾选框，勾了才能点确认，确认写 `WELCOME_KEY`（`client.js:22078-22084`）。

**`AuthGate`（`client.js:22096-22183`）**：三条件同时满足才能过——倒计时 10s 归零（`client.js:22099-22108`）、法律文本滚到底（`scrollTop+clientHeight >= scrollHeight-8`，`client.js:22121-22125`；首屏不需滚动时 `client.js:22111-22114` 直接置真）、三个勾选框全勾（`client.js:22117`）。`locked = left>0 || !readEnd`，锁定时勾选框 `disabled` 且不可切换（`client.js:22116`、`22131-22134`）。
通过后 `writeDrillAuth(true)`（`client.js:22168`），按 `pending` 决定落到 `drill` / `env` / `full` 三种去向（`client.js:22167-22178`）。
法律正文是 22KB 的单行 HTML 常量 `AUTH_LEGAL_HTML`（`client.js:21824`），用 `dangerouslySetInnerHTML` 注入（`client.js:22144`）。

**`readDrillAuth` / `writeDrillAuth` / `syncDrillGrant`（`client.js:21833-21890`）**

- 读：`drillGrantState.ready` 优先，否则 localStorage（`client.js:21833-21836`）。
- 写：先本地立即置位（乐观），再 `POST /dsh-purge-safe/drill-grant {}`，回包以服务端 `granted` 覆盖（`client.js:21842-21858`）；用 `drillGrantGen` 代际号丢弃过期回包。
- 同步：`GET /dsh-purge-safe/drill-grant`，失败最多重试 5 次 × 400ms（`client.js:21860-21890`）；`granted===false` 且当前正停在 drill 页 → 强制弹授权窗（`client.js:21877-21880`）。
- 模块加载即调一次 `syncDrillGrant()`（`client.js:21999`）。

**设计要点**：localStorage 只是缓存，**服务端才是权威**——这挡住了"清 localStorage 绕过授权"。

### 3.10 演练台 `Panel` — 页签容器

`client.js:21262-21772`。

**入参**：`{embedded?, sessionId?, sessionTitle?}`。`embedded` 影响 4 件事：几何持久化（`client.js:21286`，`embedded` 直接 `return undefined` 不写 localStorage）、resize 监听（`client.js:21290`）、全屏按钮（`client.js:21739`）、拖拽条（`client.js:21704-21707`）。

**状态**：`engagements`、`eng`（当前靶标）、`snapshot`、`err`、`newName`、`geom`、`creating`、`refreshKey`、`digest`、`seen`、`boundEng`、`following`、`followSource`、`manualPickRef`、`bindSeq`（`client.js:21265-21280`）。

**入口 1：首次加载（`client.js:21344-21362`）**
`op:"bootstrap"` → `engagements` + `r.current` 作 fallback；`sessionId` 存在则 `applySessionBinding`。

**入口 2：`applySessionBinding`（`client.js:21323-21352`）** —— 决定"面板跟哪个靶标"
优先级：`op:"sessionBinding" {session}` 返回的 `bound` → 按会话标题反查（`engagementByTitle`）→ `localStorage["rt-last-engagement"]` → 都不中则不动。
保护：`bindSeq` 代际号（`client.js:21325`、`21328`）；`manualHere()` 为真（用户手选过且当前会话没变）则不覆盖（`client.js:21340`）。

**入口 3：`openEngagement`（`client.js:21362-21374`）**：`op:"openEngagement" {name}` → `refreshList(id)`。

**入口 4：`refreshAll`（`client.js:21376-21382`）**：`setRefreshKey(+1)` + 重新 `bootstrap` + `snapshot`。

**入口 5：未读摘要轮询（`client.js:21431-21450`）**
`op:"consoleDigest" {engagement}` 每 25000ms；`digestInflight` 单飞防堆叠（`client.js:21438`）。`markTabSeen(tab)` 把当前摘要记成已读并写 localStorage（`client.js:21453-21472`）。`digestHasNew(prev,cur)`：`count` 变大或 `at` 变新（字符串比较）即算新（`client.js:21212-21220`）。

**入口 6：切靶标（`client.js:21618-21636`）**
`manualPickRef.current = sessionId`、`following=false`、`setBoundEng(next)`，并**发两个 op**：`bindSessionEngagement {session, engagement}`（`client.js:21633`）与 `activateEngagement {engagement, session?}`（`client.js:21635`）。两者都 `.catch(()=>{})` 静默。

**跟随徽章**：`手选`（warn）/`跟随`（on）/`未绑`（`client.js:21580-21605`）。

**失败路径**：`err` 非空时整个 body 变成 `h('div',{className:'rt-err'}, err)`（`client.js:21523-21524`）——**错误态会盖掉所有页签内容**，且没有"重试"按钮，只能点顶栏「刷新」。

### 3.11 `TAB_GROUPS` — 导航分组（community 完全没有）

**定义**：`client.js:21484-21494`（数组 21484-21490、别名 21492、`groupOf` 21493、`activeGroup` 21494）。

```js
const TAB_GROUPS = [
  { key:'overview',      label:'工作总览', tabs:['overview'] },
  { key:'assets',        label:'资产台账', tabs:['assets'] },
  { key:'collaboration', label:'协同进度', tabs:['agents'] },
  { key:'results',       label:'成果与报告', tabs:['findings','chain','scores','report'] },
  { key:'resources',     label:'资源中心', tabs:['sessions','artifacts','knowledge','skills'] },
  { key:'settings',      label:'环境与设置', tabs:['env'] },
]
const TAB_ALIASES = { testing:'assets', attackfiles:'artifacts', prompts:'agents' }
const groupOf = (tab) => TAB_GROUPS.find(g => g.tabs.indexOf(TAB_ALIASES[tab]||tab) !== -1) || TAB_GROUPS[0]
```

**与页签表怎么联动**：`tabs`（12 项，`client.js:21477-21481`）是"叶子页签 → 中文名"的字典；`TAB_GROUPS` 是"分组 → 叶子 id 列表"。`activeGroup = groupOf(st.tab)`（`client.js:21494`）。分组按钮点 `activateGroup`：

```js
const activateGroup = (group) => {
  const next = group.tabs.indexOf(st.tab) >= 0 ? st.tab : group.tabs[0]
  goTab(next); setRefreshKey(v => v + 1)
}   // client.js:21687-21691
```

即：**已经在该组内就留在原页签，否则跳到该组第一个页签**。

**点击后如何切换**：`goTab(tab)` = `markTabSeen(tab)` + `setUI({tab})`（`client.js:21495`）。`setUI` 改模块级 `ui` 并广播给所有 `subs`（`client.js:15731-15737`），`useUI` 订阅（`client.js:15741-15750`）。**没有路由、没有 URL、没有 history**。

**二级页签**：`activeGroup.tabs.length > 1` 才渲染 `.rt-subnav`（`client.js:21752-21766`）——只有 `results`(4) 与 `resources`(4) 有二级页签；`overview/assets/collaboration/settings` 是单页签组，不渲染二级条。`[实测]` 已跑 `groupOf` 全部 16 个输入（含 3 个别名与 1 个未知值），未知值回落到 `overview`。

**键盘导航**（`client.js:21692-21701`）：`Home/End` 跳首尾（`21693-21694`）；`↑↓←→` 循环（`21695-21696`）；`preventDefault` 后 `activateGroup`（`21698`）并把焦点移到对应 `[role="tab"]`（`21699`）。`tabIndex` 用 roving：只有 `activeGroup` 是 `0`，其余 `-1`（`client.js:21720`）。

**未读红点**：`groupHasUnread(g) = g.tabs.some(t => unreadOf(t))`（`client.js:21577`），只在**非当前组**时显示（`client.js:21727-21729`）。

**响应式**：`compactNavigation` 由 `ResizeObserver` 观察 `shellElementRef` 宽度 ≤760px 决定（`client.js:21668-21682`），写 `data-nav-layout="compact"|"sidebar"`（`client.js:21683`），CSS 据此把纵向导航改成横向（`client.js:3224` 等）。

### 3.12 `useWorkbenchFullscreen` — 站内全屏 hook

**定义**：`client.js:61-299`（源码 `lib/ui-fullscreen.js`，288 行）。返回 `{expanded, enter, exit, toggle, isExpanded}` `[实测]`（键集合已打印）。

**它不是"CSS 全屏"，是"原生全屏 + CSS 兜底"双轨**：

- `enter()`（`client.js:89-137`）：先**同步** `setActive(true)`（`client.js:97`，注释在 `95-96`：不能等 `requestFullscreen` 的 promise，否则用户手势窗口过期），再 `target.requestFullscreen()`（`client.js:111`）。原生请求被拒 → 保留 CSS 兜底并 `return true`（`client.js:120-123`）。
- `exit()`（`client.js:139-197`）：先 `setActive(false)`（`client.js:156`），再对原生全屏做**最多 8 次循环 drain**（`client.js:162-183`）——因为浏览器可能一次只弹一层嵌套全屏（注释 `client.js:179-180`）。
- Esc 监听（`client.js:241-260`）：`keydown` 且 `activeRef.current` 才处理（`client.js:242`）；**以下两种情况不拦**：① 原生全屏元素是 target 的子孙（嵌套浮层自己拥有全屏，`client.js:246`）；② target 内存在 `.rt-session-map-expanded,.rt-shot-zoom,.dshp-modal-bg,.dshp-restart-mask,.dshp-auth-mask,.rt-modal,[role="dialog"][aria-modal="true"]` 任一（`client.js:248-252`）。命中时既不 `preventDefault` 也不 `exit`（`client.js:254-256`）。
- `fullscreenchange` 处理（`client.js:206-239`）：区分"自己退出"（`ownedExitRef`）、"请求被取消"（`pendingRequest.cancelled`）、"嵌套子元素抢了全屏"（`containsNode(target,current)` → 直接 return，不改变外层状态）。
- 卸载清理（`client.js:263-289`）：`mountedRef=false`（`client.js:265`）、代际号 +1（`client.js:266`）、取消 pending（`client.js:267-268`）、**只有在确认自己仍持有原生全屏时才 `exitFullscreen`**（`client.js:274-288`）。

**`[实测]` 结果**（Node 装载 `client.js:3-299` 真实源码，注入假 React/假 document）：

| 场景 | 观察 |
|---|---|
| `enter()` 正常 | `requestFullscreen` 调用 1 次，`expanded=true`，返回 `true` |
| `enter()` 后按 Esc | `expanded=false`，`document.fullscreenElement=null` |
| `requestFullscreen` reject | `enter()` 仍返回 `true`，`expanded` 保持 `true`（CSS 兜底生效） |
| target 内存在 `.rt-shot-zoom` 时按 Esc | **不** `preventDefault`，`expanded` 保持 `true`（嵌套浮层优先） |
| 无 target | `enter()` 返回 `true`，`expanded=true`（纯 CSS 全屏）；`exit()` 返回 `false`（无原生可退） |
| `toggle()` ×2 | `true → false` |

**关键结论：它不碰宿主 slot、不设 `document.body.dataset`。** 全屏只是给 shell 元素加类：`shellProps.className = 'rt-full rt-studio'`（`client.js:21558-21564`），`data-fullscreen` 同步写 `'true'|'false'`（`client.js:21684`），CSS `.rt-full{position:fixed;inset…;z-index:60}`（`client.js:6506-6508`）。

**它在本插件里是死路径**（§0 第 3 条）：`full = !embedded && (isFullWindow() || fullscreen.expanded)`（`client.js:21498`），而 `Panel` 只有 `embedded:true` 一处挂载（`client.js:22648`）→ `full` 恒 `false` → 21739 的全屏按钮不渲染 → `FULL_REQUEST_EVENT` 监听在 `client.js:21508` 直接 `return undefined`。dock 的「全面浏览」走 `window.open(...#redteam-full)`（`client.js:21984-21986`），但新窗口里没有任何代码按 `isFullWindow()` 挂载非 embedded 的 `Panel`，所以新窗口只会显示正常 DSH 界面。

### 3.13 演练台各页签的取数

| 页签 | 组件 | 行号 | op | 轮询 |
|---|---|---|---|---|
| `overview` | `OverviewTab` | 15932 | `scoreChain`,`scores`,`sessions`,`agentsStatus`,`attention`（`Promise.all`，15952-15958） | `attention` 每 8s（15973-15981） |
| `assets` | `AssetsTab` | 16200 | `assets`,`asset`,`domains`,`web` | 无 |
| `assets/timeline` | `DiscoveryView` | 16668 | `discoveryTimeline` | 无 |
| `agents`（含 prompts） | `AgentsTab` | 21005 | `prompts`（无靶标时 `bootstrap`）,`agentsStatus` | 无 |
| `agents`→子 | `SessionMap` | 20382 | `sessionBindings` + **宿主 `/api/session/list`** | 5s（文案在 `client.js:21059`："运行状态每 5 秒刷新一次"） |
| `agents`→子 | `ConcurrencyCard` | 21113 | `setAgentsMax` | 无 |
| `sessions` | `SessionTab` | 19641 | `sessions`,`probeSessions`,`updateTunnel`,`updateWebshell` | 无 |
| `artifacts` | `ArtifactsTab` | 17086 | `credentials`,`access`,`attackFiles` | 无 |
| `findings` | `FindingsTab` | 17130 | `vulns`,`updateVuln`,`attackFiles` | 无 |
| `chain` | `ChainTab` | 17401 | `scoreChain` | 无 |
| `report` | `ReportTab` | 17732 | `scoreReport`,`scoreChain` | 无 |
| `scores` | `ScoreTab` | 19108 | `scores`,`saveScorePoint`,`deleteScorePoint` | 无 |
| `knowledge` | `KnowledgeTab` | 18054 | `pocSearch`,`pocGet`,`pocUse` | 无 |
| `skills` | `SkillsTab` | 16813 | `skillCatalog`,`skillRead` | 无 |
| `env` | `EnvTab` | 18772 | `platformConfigGet`,`platformConfigSave`,`platformAssignToolkit`,`intelStatus`,`intelRefresh` | 无 |
| 详情内 | `ShotImage` | 15785 | `shotData`（懒加载 + 模块级缓存） | 无 |
| 顶栏 | `VersionBar` | 21174 | `GET /dsh-purge-safe/status`（6s abort） | 一次 |
| — | `ProxySettings` | 18329 | `proxyPoolGet`,`proxyConfigImport`,`proxyPoolDisconnect` | **无调用方，死代码** |

`[静态]` `ProxySettings`（443 行）全文件只有定义处一个引用，从未被 `h()` 调用。

---

## 4. 对外接口

### 4.1 插件自有 HTTP（`/dsh-purge-safe/*`）

| 类型 | 路径 | 入参 | 出参（客户端读取的字段） | 调用方 | 是否公开 |
|---|---|---|---|---|---|
| GET | `/dsh-purge-safe/status` | — | `ok, ai_base, patches, patch_status, patch_names, patches_total, patches_applied, shim_cmd/ps1/bin, has_backup, applying, ready, boot_full_quit, asar_still_sealed, desktop_exe, desktop_install, patches_lost, override_status, control_surface, surface, plugin_version` | `client.js:3614`、`4461`、`4733`、`21180` | 插件自有 |
| GET | `/dsh-purge-safe/override` | — | `ok, content, defaultContent` | `client.js:3656` | 插件自有 |
| POST | `/dsh-purge-safe/override` | `{content}` | `ok, content, needPrompt, injectSource` | `client.js:3805`,`3850` | 插件自有 |
| GET | `/dsh-purge-safe/own-servers` | — | `ok, content` | `client.js:3675` | 插件自有 |
| POST | `/dsh-purge-safe/own-servers` | `{content}` | `ok, content, dropped` | `client.js:4054` | 插件自有 |
| POST | `/dsh-purge-safe/{apply\|revert}` | `{content?}`(+`surface`) | `ok, error, needPrompt, host_written, ask_restart, restarting, needs_full_quit` | `client.js:3709` | 插件自有 |
| POST | `/dsh-purge-safe/uninstall` | `{}` | `ok, note, surface, fullApp, error` | `client.js:3911` | 插件自有 |
| POST | `/dsh-purge-safe/restart` | `{surface}` | `ok, ready` | `client.js:4787` | 插件自有 |
| POST | `/dsh-purge-safe/rules` | `{op, ...}`（9 种 op 见 §3.4） | `ok, rules[], active, workspace_policy, workspace_policies[], cwd, cwd_candidates[], content, name, target, error` | `client.js:683` | 插件自有 |
| POST | `/dsh-purge-safe/skills`（回退 `/skill`） | `{op, ...}`（5 种 op） | `ok, skills[], content, description, imported[], error` | `client.js:700`,`702` | 插件自有 |
| POST | `/dsh-purge-safe/rewind` | `{sessionId, mode:"once"\|"round"}` | `ok, sessionId, parentId, text, at, cleared` | `client.js:5498`,`5412` | 插件自有 |
| GET | `/dsh-purge-safe/rewind` | — | `sessionId, parentId, text, at` | `client.js:5574`（1200ms 轮询） | 插件自有 |
| POST | `/dsh-purge-safe/continue` | `{sessionId, force}` | `ok` | `client.js:5262`,`5312` | 插件自有（**调用链已注释掉**） |
| GET | `/dsh-purge-safe/continue` | `?sessionId=` | — | `client.js:5293` | 同上 |
| GET/POST | `/dsh-purge-safe/continue/settings` | — / `{...}` | — | `client.js:3430`,`3442` | 同上（`ContinueRetrySection` 已注释，`client.js:4022`） |
| GET | `/dsh-purge-safe/last-user` | `?sessionId=` | `text` | `client.js:5173` | 插件自有 |
| GET | `/dsh-purge-safe/drill-grant` | — | `ok, granted` | `client.js:21865` | 插件自有 |
| POST | `/dsh-purge-safe/drill-grant` | `{}` | `granted` | `client.js:21850` | 插件自有 |
| GET | `/` | — | 只要 `r.ok` | `client.js:3880`（卸载后探活） | 宿主根路由 |

**统一包装**：`apiJson(p, init)`（`client.js:634-661`）——`AbortController` 超时（按路径分级，`client.js:616-631`：`apply` 240s、`status/override/own-servers/revert` 120s、`skill` POST 120s、`uninstall` 90s、`restart` 20s、其余 20s）、`cache:"no-store"`、`credentials:"same-origin"`、非 2xx 时把 `needPrompt/injectSource==="none"` 或 503 当成功返回（`client.js:645-650`）、abort 归一成 `Error("timeout")`、网络错归一成「连不上接口，请确认 dsh 还在跑后 Ctrl+F5」（`client.js:654-660`）。

### 4.2 演练台 HTTP（`/redteam/api`，全部 POST）

51 个 op，按首次出现行号列出（`[静态]` 用 `grep "op: '"` 全量抽取）：

| op | 行号 | 调用组件 |
|---|---|---|
| `shotData` | 15774 | `ShotImage` |
| `scoreChain` | 15950 / 17413 / 17750 | `OverviewTab` / `ChainTab` / `ReportTab` |
| `scores` | 15951 / 19122 | `OverviewTab` / `ScoreTab` |
| `sessions` | 15952 / 19652 | `OverviewTab` / `SessionTab` |
| `agentsStatus` | 15953 / 21022 | `OverviewTab` / `AgentsTab` |
| `attention` | 15954 / 15970 | `OverviewTab`（带 `engagement`） |
| `assets` | 16235 | `AssetsTab` |
| `domains` | 16257 | `AssetsTab` |
| `web` | 16264 | `AssetsTab` |
| `asset` | 16281 | `AssetsTab` |
| `discoveryTimeline` | 16677 | `DiscoveryView` |
| `prompts` | 16732 / 16767 | `PromptsTab` / `AgentsTab` |
| `savePrompt` | 16749 | `PromptsTab` |
| `resetPrompts` | 16763 | `PromptsTab` |
| `skillCatalog` | 16829 | `SkillsTab` |
| `skillRead` | 16855 | `SkillsTab` |
| `credentials` | 17099 | `ArtifactsTab` |
| `access` | 17100 | `ArtifactsTab` |
| `attackFiles` | 17098 / 17161 / 17982 | `ArtifactsTab` / `FindingsTab` / `AttackFilesTab` |
| `vulns` | 17152 | `FindingsTab` |
| `updateVuln` | 17167 | `FindingsTab` |
| `readAttackFile` | 17994 | `AttackFilesTab` |
| `pocSearch` | 18088 | `KnowledgeTab` |
| `pocGet` | 18104 | `KnowledgeTab` |
| `pocUse` | 18116 | `KnowledgeTab` |
| `proxyPoolGet` | 18438 / 18454 | `ProxySettings`（死） |
| `proxyPoolDisconnect` | 18557 | 同上 |
| `proxyConfigImport` | 18572 / 18591 | 同上 |
| `platformConfigGet` | 18823 | `EnvTab` |
| `platformConfigSave` | 18846 | `EnvTab` |
| `platformAssignToolkit` | 18859 | `EnvTab` |
| `intelStatus` | 18788 | `EnvTab` |
| `intelRefresh` | 18792 | `EnvTab` |
| `saveScorePoint` | 19146 | `ScoreTab` |
| `deleteScorePoint` | 19166 | `ScoreTab` |
| `activeTests` | 19521 | `TestingTab` |
| `probeSessions` | 19662 | `SessionTab` |
| `updateTunnel` | 19681 | `SessionTab` |
| `updateWebshell` | 19686 | `SessionTab` |
| `sessionBindings` | 20345 | `SessionMap` |
| `setAgentsMax` | 21129 | `ConcurrencyCard` |
| `snapshot` | 21298 | `Panel` |
| `bootstrap` | 21306 / 21344 / 21378 | `Panel` |
| `sessionBinding` | 21328 | `Panel` |
| `openEngagement` | 21367 | `Panel` |
| `consoleDigest` | 21439 | `Panel` |
| `bindSessionEngagement` | 21633 | `Panel` |
| `activateEngagement` | 21635 | `Panel` |
| `scoreReport` | 17745 | `ReportTab` |
| `platformEnvAdaptStatus` | 22302 | `EnvAdaptSendGate`（双引号写法） |
| `platformEnvAdaptSkip` | 22467 | `EnvAdaptSendGate`（双引号写法） |

统一入口：`const api = (req) => fetch('/redteam/api', {POST, json}).then(readApiJson)`（`client.js:15699-15704`）。`readApiJson` 把空体/非 JSON 都转成 `{ok:false,error:"中文原因"}`，**永不抛错**（`client.js:15683-15696`）。

### 4.3 宿主内部 API（唯一一处，且是私有 RPC）

| 类型 | 路径 | 入参 | 出参 | 调用方 | 是否公开 |
|---|---|---|---|---|---|
| HTTP POST | `/api/session/list` | `{type:"client-request", rpcId, method:"session/list", payload:{args:{_request:{}}}}` | `{type:"server-response", rpcId, result:{ok:true, value:{items[], sourceUpdatedAt?}}}` | `requestSessionMapSummaries`（`client.js:20308-20335`） | **否**。宿主渲染进程↔主进程的内部 RPC；`rpcId`/`method` 无版本承诺 |

**契约校验**（`validateSessionListResponse`，`client.js:19902-20030`）：
- 必须 `type==="server-response"` 且 `rpcId` 回显一致，`result.ok===true`，`result.value.items` 是数组（`client.js:19903-19912`）；
- `items.length > 5000` 抛 `session-list-row-limit`（`client.js:19914`）；
- 每行必须 `sessionId` 非空字符串、无重复（`client.js:19916-19921`）；
- `parentSessionId` 允许 `null` 或非空串，其他类型抛错（`client.js:19923-19931`）；
- `updatedAt` 必须是有限数字（`client.js:19932-19937`）；`cwd` 必须是字符串（`client.js:19938-19940`）；
- `activity` 由 `raw.running === true/false/其他` 映射成 `running/idle/unknown`（`client.js:19946`）；
- `projections.values` 里读 `title`、`subagent{label,mode}`、`subagentTiming{settledMs,active{since,through},lastTurnCompleted}`、`subagentCatalog[]`（≤ `SESSION_MAP_MAX_NODES`）、`todos[]`（≤100，`content` 截 500）（`client.js:19952-20011`）；
- 标题形如 `redteamRole: recon` 时改写显示名（`client.js:19969-19975`）；
- 最后 `assertSessionMapParentGraph(items)` 校验父子图无环（`client.js:20016`、`19878`）。

**超时**：`SESSION_MAP_REQUEST_TIMEOUT_MS = 6000`（`client.js:20305`）；响应体流式读取上限 4MiB（`client.js:20273`）。

### 4.4 宿主 Cordis 服务 / slot

| 类型 | 名称 | 入参 | 调用方 | 是否公开 |
|---|---|---|---|---|
| slot | `shell.overlay`（`id:"dsh-purge-safe-dock"`, `order:50`） | — | `client.js:23270-23275` | 公开 slot |
| slot | `conversation.input.right`（`id:"dsh-purge-safe-rewind"`, `order:20`, `inject:(sessionId)=>({sessionId,t})`） | — | `client.js:23245-23253` | 公开 slot |
| 服务 | `ctx.locale.register/bind` | `NS,{zh,en}` | `client.js:23267-23268` | 公开 |
| 服务 | `ctx.slots.inject/register` | — | `client.js:23245`,`23270` | 公开 |
| 服务 | `ctx.effect` | fn + label | `client.js:23267`,`23263` | 公开 |
| 服务 | `ctx.inject([...], fn)` | 依赖名数组 | `client.js:23279`,`23286` | 公开 |
| 服务 | `sessions.list.getSnapshot()` | — | `client.js:4943`,`4956` | 公开 |
| 服务 | `sessions.refresh()` / `sessions.open(id)` / `sessions.scope(id)` / `sessions.sessionOf(actx)` | — | `client.js:5210`,`5218`,`5090`,`5191` | 公开 |
| 服务 | `uiWorkspace.selection.getSnapshot()` / `uiWorkspace.openSession(id)` | — | `client.js:4943`,`5216` | 公开 |
| 服务 | `conversation.input.shell(sid)` / `.for(actx)` / `.setDraft(text)` / `.state.getSnapshot()` | — | `client.js:5084-5118` | 公开 |
| **猴补** | `shell.submit` 被替换为 `gatedSubmit` | — | `client.js:22360-22374` | **未公开契约**：读的是宿主 `SessionInputShell` 实例方法 |

### 4.5 DOM 契约（全部非公开，靠选择器/文案匹配）

| 选择器 / 属性 | 用途 | 行号 |
|---|---|---|
| `[data-composer-card], [data-composer-seat]` | 定位输入框容器 | `client.js:4968`,`22291`,`22428` |
| `[contenteditable='true'], textarea` | 输入框本体 | `client.js:4968` |
| `[role='tablist']` + 文案 `轨迹/上下文/对话`（含英文） | 找官方页签行，插入 purge chip | `client.js:22751-22780` |
| `[class*='heroWorkspaceRow' i]` 或 `[data-dsh-hero-workspace-row]` | 找首页锚点 | `client.js:22742-22744` |
| `[class*='menuAnchor' i]` | 首页次级锚点 | `client.js:22747` |
| 文案 `标准模式/红队模式/Standard mode/Red Team` | 首页锚点定位 | `client.js:22745-22748` |
| `data-ds-dark-theme` / `data-theme` / `color-scheme` | 判断宿主主题 | `client.js:4839-4857`,`333-350` |
| CSS 变量 `--dsh-frame-chrome-top` / `--dsh-frame-top-clearance` / `--dsh-windows-titlebar-height` | 演练台避开标题栏 | `client.js:21223-21231` |
| `button, [role='button'], [role='tab'], a, [class*='tab' i]` | 发送控件启发式（`looksLikeSendControl`） | `client.js:22270-22296`；标签扫描器在 `22718-22738` |

### 4.6 全局桥

| 名称 | 方向 | 行号 |
|---|---|---|
| `window.__dshPurgeAttentionGo` | 暴露给演练台面板（另一 bundle）触发"去处理" | `client.js:23005` |
| `window.__dshpComposerWatch` / `window.__dshpComposerWatchTick` | 看门狗去重标记 | `client.js:4981`,`4991` |
| `window.__ModuleLoader__.load` | 模块注册 | `client.js:1` |

---

## 5. UI 触点

### 5.1 顶层页签全量（问题 1 的正面回答）

**设置面板：0 个页签。** `SettingsRoot`（`client.js:4859-4899`）的整个渲染体是：

```js
h("div", { className:"dshp-root", "data-theme": theme },
  h("style", null, PURGE_CSS),
  h(PurgifySection), h(RulesSection), h(SkillsSection))
```

三个 section 全部常驻、纵向堆叠，没有 `hidden`、没有 tab 状态（`client.js:4892-4898`）。`PurgeDock` 的两个页签是 `clean` / `drill`（`client.js:22669-22690`），`clean` 里就是这整列。

**演练台：12 个叶子页签 / 6 个分组。** 定义在 `client.js:21477-21481`：

| 叶子 id | 中文名 | 所属分组 | 组件 | 行号 | 依赖 op |
|---|---|---|---|---|---|
| `overview` | 态势 | `overview` 工作总览 | `OverviewTab` | 15932 | `scoreChain`,`scores`,`sessions`,`agentsStatus`,`attention` |
| `assets` | 资产测绘 | `assets` 资产台账 | `AssetsTab` | 16200 | `assets`,`asset`,`domains`,`web` |
| `agents` | 智能体 | `collaboration` 协同进度 | `AgentsTab` | 21005 | `prompts`,`agentsStatus`（+ 内嵌 `SessionMap`/`ConcurrencyCard`/`PromptsTab`） |
| `findings` | 漏洞战果 | `results` 成果与报告 | `FindingsTab` | 17130 | `vulns`,`updateVuln`,`attackFiles` |
| `chain` | 攻击链 | `results` | `ChainTab` | 17401 | `scoreChain` |
| `scores` | 得分目标 | `results` | `ScoreTab` | 19108 | `scores`,`saveScorePoint`,`deleteScorePoint` |
| `report` | 报告 | `results` | `ReportTab` | 17732 | `scoreReport`,`scoreChain` |
| `sessions` | 会话隧道 | `resources` 资源中心 | `SessionTab` | 19641 | `sessions`,`probeSessions`,`updateTunnel`,`updateWebshell` |
| `artifacts` | 凭据与文件 | `resources` | `ArtifactsTab` | 17086 | `credentials`,`access`,`attackFiles` |
| `knowledge` | 知识库 | `resources` | `KnowledgeTab` | 18054 | `pocSearch`,`pocGet`,`pocUse` |
| `skills` | 技能库 | `resources` | `SkillsTab` | 16813 | `skillCatalog`,`skillRead` |
| `env` | 环境适配 | `settings` 环境与设置 | `EnvTab` | 18772 | `platformConfigGet/Save`,`platformAssignToolkit`,`intelStatus/Refresh` |

**另有 3 个"幽灵页签"**：`testing`、`attackfiles`、`prompts` 在 `tabs` 数组里**不存在**，但 `body` 分派里各有一个分支（`client.js:21533`,`21554`,`21556`），只有 `st.tab` 恰好等于这些值才会命中。它们只能经 `TAB_ALIASES`（`client.js:21492`）参与**分组**，而 `setUI` 从不下发这些值 → 三个分支不可达 `[静态]`。

**渲染分派**（`client.js:21522-21557`）：`err` 优先 → 6 个"无靶标也能看"的全局页（`overview/artifacts/knowledge/env/skills/agents`，`client.js:21525-21534`）→ 无 `eng` 时显示"还没有靶标"创建卡（`client.js:21536-21551`）→ 其余按 id 分派 → 兜底 `未知页签`。

### 5.2 组件清单

| 组件名 | 文件:行 | 依赖的 op | 展示字段 | 交互 |
|---|---|---|---|---|
| `SettingsRoot` | 4859-4899 | 无 | — | 只做主题同步（`MutationObserver` + `matchMedia`，`client.js:4862-4890`）并赋 `translate`（`4891`） |
| `PurgifySection` | 3551-4084 | 6 条 `/dsh-purge-safe/*` | 版本、`applied/total` 进度条、`shim_cmd/ps1/bin` 徽章、备份有无、补丁分组、注入正文、自有服务列表 | apply/revert/uninstall/保存注入/恢复注入/保存自有服务/重启 |
| `PatchGroups` | 3375-3422 | 无（吃 state） | 按 `LAYER_GROUP`（提示词/代码/工具/0.1.5 兼容/0.2.0 兼容，`client.js:3317-3324`）分组，每组 `#id 标题` + 状态 Pill | 点组头展开/收起 |
| `RestartAsk` | 3525-3550 | `/restart` | 三种 surface 文案 | 稍后 / 重启 |
| `RulesSection` | 4091-4354 | `rules` ×9 op | 规则列表（名称、`target · size`、当前标记）、策略下拉、cwd 候选列表、编辑器 | 见 §3.4 |
| `SkillsSection` | 4434-4723 | `skills` ×5 op | 技能卡片、来源、可用状态、诊断、内容 | 读/存/删/导入 zip/导入目录 |
| `RewindButton` | 5459-5567 | `/rewind` POST | 按钮文字「回退/回退中…/失败前18字」 | 弹菜单 → 回退上一步 / 回退上一轮 |
| `RewindFallback` | 5390-5457 | 同上 | 同上（class 版） | 同上 |
| `PurgeDock` | 22503-22708 | 无（壳） | 标题 `dsh-purge-safe`、两个页签 | 拖动、四向缩放、切页签、全屏（新窗口）、关闭 |
| `WelcomeNotice` | 22037-22094 | 无 | 欢迎 + 三条禁止 + 仓库链接 | 勾选 → 确认 |
| `AuthGate` | 22096-22183 | `drill-grant` POST | 10s 倒计时、22KB 法律全文、三勾选 | 滚到底 + 三勾 → 授权 |
| `EnvAdaptSendGate` | 22312-22501 | `platformEnvAdaptStatus/Skip` | 状态消息、Kali 提示 | 「去适配」/「确认跳过」二次确认 |
| `AttentionToast` | 23050-23238 | `attention` | `people` 数、前 3 条 `stage/who/reason/needs`、`rest`、`gaps` | 拖拽、去处理、稍后/恢复 |
| `NativeChipMount` | 22813-22890 | 无 | 一枚按钮（文案 `dock.newSession`） | 开/关 dock；**portal 进宿主 DOM，不是 slot** |
| `HeroNewSessionMount` | 22892-22894 | — | `NativeChipMount kind="hero"` | 插在首页 hero 行后 |
| `TabRowPurgeMount` | 22896-22898 | — | `NativeChipMount kind="tab"` | 插在官方页签行末 |
| `Panel` | 21262-21772 | 7 个（`bootstrap/snapshot/sessionBinding/openEngagement/consoleDigest/bindSessionEngagement/activateEngagement`） | 见 §5.1 | 见 §3.10/3.11 |
| `OverviewTab` | 15932-16199 | 5 个 | 四宫格指标、得分轨道、缺口 Top5、已得 Top5、待办、入口卡片 | 点缺口跳 `scores`、点待办跳对应页 |
| `AssetsTab` | 16200-16667 | 4 个 | 网段 tab、主机表、详情面板、域名/Web 视图 | 切视图、选网段、点资产看详情 |
| `SessionMap` | 20382-21004 | `sessionBindings` + `/api/session/list` | 会话节点图（父子连线）、状态点、todos、当前任务、统计 | 缩放/拖动/方向键微调/搜索/活动筛选/全屏地图（自身原生全屏，`client.js:20764`） |
| `ReportV2` | 17613-17731 | 无（吃 props） | 报告分段、`data_proof` 归属证明、trace | 只读 |
| `ConcurrencyCard` | 21113-21173 | `setAgentsMax` | 当前上限、已用 | 改数字 → 保存 |

### 5.3 AttentionToast 挂载位置（问题 4 的正面回答）

挂在 **`shell.overlay`**（`client.js:23270-23275`，与 `PurgeDock` 同一个 slot、同一段 JSX），**不是** `conversation.input.right`。`conversation.input.right` 只有 `RewindSafe`（`client.js:23245-23253`），且 `ContinueSafe` 的注册被整段注释掉（`client.js:23254-23263`）。源码注释也写了侧栏角标已退役（`client.js:23276-23277`），提醒只留胶囊一个出口。

### 5.4 CSS 体系（问题 9 的正面回答）

| 块 | 行范围 | 行数 | 类数 | 前缀 |
|---|---|---|---|---|
| `PURGE_CSS`（主面板） | 1408-3264 | 1,857 | 432 | `.dshp-*` 154、`.rt-*` 251（跨用演练台类）、`.is-*` 状态修饰 |
| `REWIND_CSS`（回退按钮） | 4900-4918 | 17 | 6 | `.dshp-rewind-*`、`.dshp-continue*` |
| 演练台 `CSS` | 6325-15665 | 9,341 | 860 | `.rt-*` 778、`.dshp-*` 40 |
| └ 其中"产品皮肤" | 7349-15664 | 8,316 | — | `/* __DSH_PRODUCT_SKIN_BEGIN__ */`…`_END__`（`client.js:7349`,`15664`） |

**内联样式**：`style: {...}` 出现 221 次，`style=` 0 次；`h(...)` 调用 2,341 次，`className` 1,604 次 `[静态]`（脚本统计）。内联样式集中在几何（`left/top/width/height`）、`margin`、`flex`、`fontSize` 微调，没有用内联样式做大块布局。

**设计令牌**：全部走 CSS 变量，不写死颜色（除少数状态色）：
- 宿主令牌 `--dsw-alias-*`（`label-primary/secondary/tertiary`、`bg-layer-1/2`、`bg-base`、`border-l1`、`state-error-primary`、`brand-primary`、`interactive-bg-hover`）
- 自有令牌 `--dshp-*`（`--dshp-line/bg/paper/ink/mute/mono/danger/dock-w/dock-h`）
- 宿主尺度令牌 `--ui-space-*`（153 处）、`--ui-text-*`、`--ui-leading-*`、`--ui-glass-*`、`--ui-water-*`
- 演练台令牌 `--rt-border/bg-surface/muted`

**主题切换**：不靠 class，靠属性选择器 + `data-theme="dusk|white"`（`client.js:1707`,`1731`,`1756`）+ 宿主 `body[data-ds-dark-theme]`（`client.js:1497`,`1709`）。`PURGE_CSS` 里同一套颜色被写了 4 遍（默认/dusk/white/宿主暗色），这是它 1,857 行的主要原因。

**死样式**：脚本比对"CSS 里定义的类"与"JS 里的字面量/动态构造"后，998 个类中 **202 个在 JS 里没有字面量出现**；其中一部分由动态拼接产生（`'dshp-btn-'+kind`（`client.js:3308`）、`'is-'+statusKind(...)`（`client.js:3314`）、`'rt-sev rt-sev-'+s`（`client.js:16971`）、`'rt-ov-metric-'+tone`（`client.js:15999`）），真正无主的集中在四族：

| 死族 | 类数 | 证据 |
|---|---|---|
| `.dshp-clean-*` | 17 | 全文件无 `dshp-clean-` 字符串，也无拼接；是某个"clean 全页版"的遗留 |
| `.dshp-studio-*` | 13 | 同上；且 `client.js:2339` 的 `[data-fullscreen=true]` 样式依赖 `dshp-studio-dock` 类，而 dock 的 className 只有 `dshp-dock`（`client.js:22651`）→ dock 全屏样式整块失效 |
| `.rt-hflow*` / `.rt-flow-*` / `.rt-hcol-*` | 24 | 旧版攻击链"横向流程"视图；现 `ChainTab` 用 `rt-ap-*`（`client.js:17438`） |
| `.rt-stage-*` / `.rt-st-*` / `.rt-step*` | 24 | 旧版阶段/步骤样式 |
| 单点 | `rt-sevbar`,`rt-weblink`,`rt-step-dot`,`rt-stage-tag`,`rt-scorepts`,`rt-livebar`,`rt-live-body`,`rt-modal-box`,`k-exp`,`k-poc`,`k-payload`,`k-script`,`k-template` | 每项全文件仅 CSS 内自引用 |

**移植成本结论**：`PURGE_CSS` 的 432 类几乎全活（死的主要是 `.dshp-clean-*`/`.dshp-studio-*` 共 30 个），可以整块搬。演练台的 9,341 行里约 8,300 行是"产品皮肤"，与 `ProxySettings`（443 行死代码）、旧流程/阶段样式一起构成主要冗余；搬演练台时必须连 `CSS` 一起搬，否则 `rt-*` 全部失效。

---

## 6. 依赖

### 6.1 内部

| 依赖 | 形式 | 行号 |
|---|---|---|
| `lib/ui-fullscreen.js` | 构建期内联为 `client.js:3-299` | `/* __DSH_PURGE_FULLSCREEN_BEGIN__ */` |
| `lib/ui-theme.js` | 构建期内联为 `client.js:300-524` | `/* __DSH_PURGE_THEME_BEGIN__ */` |
| `lib/redteam/client.js` + 5 个 css | 构建期内联为 `client.js:5592-21815` | `/* __DSH_PURGE_DRILL_BEGIN__ */`（`client.js:5590`） |
| `react` | `require("react")`，只用 `createElement/useState/useEffect/useCallback/useRef/Component` | `client.js:530-532`、`6125` |
| `react-dom` | `require("react-dom")`，只用 `createPortal`，**每次用都在 try 里** | `client.js:22698`、`22886`、`5382`、`22088`、`3543` |

### 6.2 宿主

见 §4.4 / §4.5。**必须点出的三处非公开依赖**：

1. `/api/session/list` 的内部 RPC 信封（`client.js:20315-20322`）——§4.3。
2. `shell.submit` 猴补（`client.js:22360-22374`）——依赖宿主输入框实例方法名。
3. DOM 文案/属性选择器 9 类（§4.5）——宿主改文案即失效，且**静默失效**（找不到锚点就把 chip `removeChild` 掉，`client.js:22831`、`22846`；`place*` 里另有 `22792`、`22804`）。

### 6.3 外部

| 类型 | 目标 | 行号 |
|---|---|---|
| 网络 | 无第三方域名。全部同源：`/dsh-purge-safe/*`、`/redteam/api`、`/api/session/list`、`/` | 见 §4 |
| 外链 | `t("welcome.repo")` 作为 `<a href>`，`target=_blank rel=noopener noreferrer` | `client.js:22055-22063` |
| 子进程 / 文件系统 | **无**（纯浏览器侧） | — |
| 剪贴板 | `navigator.clipboard.writeText` 经 `copyWithFeedback` | `client.js:15874-15875`、`15900` |

---

## 7. 与另一版的差异

> 按要求：本节只做**一处已核对**的对照，其余标「未查」。不做推测性结论。

| 能力 | community 行号 | safe 行号 | 差异性质 |
|---|---|---|---|
| 设置面板页签结构 | `vendor/community/client.js:13805-13812`：`TABS` 6 项 = 状态/提示词/规则/技能/演练台/更多，`vendor/community/client.js:13952` 用 `useState("status")` + `hidden` 切换（`14027-14050` 的 `{hidden: tab !== …}` 五段） | safe 无 `TABS`，无 tab 状态，三段常驻（`client.js:4892-4898`） | **删除**（页签 → 单列滚动） |
| 演练台形态 | community：`tab === "drill"` 时内联渲染（`vendor/community/client.js:14054`） | safe：移到 dock 的第二页签（`client.js:22647`），并内联整个 `__dshPurgeDrill` bundle | **重写** |
| 更多页（`RewindSetting`） | community `vendor/community/client.js:14051` | safe：`/dsh-purge-safe/rewind` 变成 `conversation.input.right` 的按钮（`client.js:23245`） | **重写**（设置项 → 输入框旁按钮） |
| 顶层页签数 | 6 | 0（设置）+ 2（dock：clean/drill）+ 12（演练台叶子） | 结构性变化 |
| 其余能力（补丁区、规则区、技能区、通知、CSS 体系、op 集） | 未查 | 见 §3/§4/§5 | **未查**：此处 community 是否有对应实现我未查 |

---

## 8. 风险与脆弱点

| 风险 | 触发条件 | 后果 | 是否可静态检出 |
|---|---|---|---|
| 宿主内部 RPC 变更 | 宿主升级改 `/api/session/list` 信封或 `session/list` 方法名 | `SessionMap` 整块空白，**不报错**；只显示"读取失败，保留上次快照；不会宣称当前在线"（`client.js:20782`） | 否（只能靠运行时） |
| `shell.submit` 猴补失配 | 宿主改输入框实例方法名/结构 | 发送门禁失效 → 未适配环境也能发；卸载时 `WeakMap` 还原失败会留 wrapper 持死闭包（`client.js:22388-22393`） | 否 |
| DOM 文案锚点失效 | 宿主改「对话/轨迹/上下文」「标准模式」等文案 | purge chip 被 `removeChild`（`client.js:22831`,`22846`；`place*` 内另有 `22792`/`22804`），静默消失 | 否 |
| `translate` 竞态 | 任何组件在 `SettingsRoot` 首次渲染前渲染 | 显示原始键名（如 `dock.clean`）而非中文；`translate` 是模块级 `let`（`client.js:537`，赋值点 `4891`） | 是 |
| `shotCache` 无淘汰 | 长时间浏览大量证据图 | 内存单调增长，无上限 | 是（`client.js:15768`） |
| `rewindHost` 等全局引用不清 | 插件禁用/重载 | 旧 ctx 被闭包持有；`installRewindUi` 不返回清理函数（`client.js:23241-23264`） | 是 |
| 未读基线首轮为空 | 第一次进面板 | `markTabSeen` 用当前 digest 兜底，注释说明"否则一进来满屏红点"（`client.js:21448-21472`） | 是 |
| `err` 覆盖全页 | 任一 `bootstrap`/`snapshot` 失败 | 所有页签内容被替换成一行红字，无重试按钮（`client.js:21523`） | 是 |
| 三个不可达页签分支 | `st.tab` 永不等于 `testing/attackfiles/prompts` | 维护者误以为存在这三个页面 | 是 |
| 全屏链路断裂 | 见 §0.3 | 用户点「全面浏览」得到的是一个普通新窗口 | 是 |
| `AuthGate` 法律文本 | 22KB 单行 HTML + `dangerouslySetInnerHTML`（`client.js:21824`,`22150`） | 内容不可 diff、不可翻译；`readEnd` 判定依赖容器 `scrollHeight`，若 CSS 把它撑开则"必须滚到底"失效（`client.js:22111-22114`） | 是 |
| `drill-grant` 双写 | 本地乐观置位后服务端拒绝 | 短暂显示已授权（`client.js:21844-21847`），随后 `syncDrillGrant` 拉回（`client.js:21872-21881`） | 是 |
| `VersionBar` 6s abort | 宿主启动慢 | 版本显示 `—`（`client.js:21190` 的 `version ? 'v'+version : '—'`），无提示 | 是 |
| 死 state 掩盖功能缺失 | `PurgifySection` 的 `canApplyUpdate/updateJob/updateInfo/updateNotice/updateBusy/channel/pick` 各只有 1-2 次引用（声明处 + 1 次读） | 在线升级 UI 已被移除，但状态与 30 个 `update.*`/`channel.*` i18n 键仍在（`client.js:3563-3575`） | 是 |
| i18n 冗余 | 346 键中 62 键无任何调用（除动态前缀 `patch./group./surface./policy./cwd.scope.`） | 翻译维护噪音 | 是 |

---

## 9. 逐条功能清单

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| SF-UI-001 | 模块注册与包名 | `client.js:1` | 完整 | 改包名必须同步此处，否则 UI 静默不挂载 |
| SF-UI-002 | 插件入口 `apply` | `client.js:23266-23298` | 完整 | 三段 inject 降级 |
| SF-UI-003 | `shell.overlay` 注册 6 组件 | `client.js:23270-23275` | 完整 | order 50 |
| SF-UI-004 | `conversation.input.right` 注册回退按钮 | `client.js:23245-23253` | 完整 | order 20 |
| SF-UI-005 | 继续按钮 slot 注册 | `client.js:23254-23263` | **缺失** | 整段被注释 |
| SF-UI-006 | 浮动 dock 双页签 | `client.js:22669-22690` | 完整 | clean/drill |
| SF-UI-007 | dock 拖拽 + 四向缩放 | `client.js:22561-22645` | 完整 | 手写 mouse 事件 |
| SF-UI-008 | dock 几何持久化 | `client.js:22006-22036` | 完整 | 混淆键 `dsh-klmyn-...` |
| SF-UI-009 | dock portal 到 body | `client.js:22695-22702` | 完整 | 失败降级为原地渲染 |
| SF-UI-010 | 设置面板三段堆叠（无页签） | `client.js:4859-4898` | 完整 | 与 community 6 页签的**结构性差异** |
| SF-UI-011 | 补丁状态读取与重试 | `client.js:3597-3690` | 完整 | 40×700ms 上限 |
| SF-UI-012 | 补丁应用/回退 | `client.js:3700-3795` | 完整 | 裸 fetch，无超时 |
| SF-UI-013 | 补丁分组展示 | `client.js:3375-3422` | 完整 | 5 组，`LAYER_GROUP` 3317 |
| SF-UI-014 | 注入正文编辑/保存/恢复 | `client.js:3797-3875` | 完整 | 双空 → 拒绝 |
| SF-UI-015 | 自有服务列表编辑 | `client.js:4040-4082` | 完整 | 显示 `dropped` 计数 |
| SF-UI-016 | 卸载（含 Web 端探活重载） | `client.js:3905-3936`、`3877-3903` | 完整 | 90s 超时 |
| SF-UI-017 | 重启询问与重试 | `client.js:3525-3550`、`4761-4837` | 完整 | 4 轮 |
| SF-UI-018 | 在线升级 UI（检测/通道/切换） | — | **缺失** | 仅剩死 state（`3563-3575`）与 30 个 update/channel i18n 键 |
| SF-UI-019 | 规则 CRUD + 策略 + cwd 扫描 | `client.js:4091-4354` | 完整 | 9 个 op |
| SF-UI-020 | 技能 CRUD + zip/目录导入 | `client.js:4434-4723` | 完整 | 路由回退 `/skills`→`/skill` |
| SF-UI-021 | 回退按钮（上一步/上一轮） | `client.js:5459-5567` | 完整 | 只填不发 |
| SF-UI-022 | 回退 error boundary 降级 | `client.js:5237-5246`、`5390-5457` | 完整 | class 版兜底 |
| SF-UI-023 | 回退后台轮询（1200ms） | `client.js:5569-5590` | 完整 | 比较 `at` |
| SF-UI-024 | 回退后重开会话 + 清继承队列 | `client.js:5204-5233`、`5186-5202` | 完整 | 25×120ms |
| SF-UI-025 | 输入框看门狗 | `client.js:4980-5004` | 完整 | 三套监听常驻 |
| SF-UI-026 | 提醒胶囊数据轮询（8s，单例） | `client.js:21918-21970` | 完整 | 与演练台共用 op、入参不同 |
| SF-UI-027 | 提醒胶囊渲染（前 3 条 + rest/gaps） | `client.js:23109-23238` | 完整 | hook 顺序有硬约束 |
| SF-UI-028 | 提醒胶囊拖拽 + 位置持久化 | `client.js:23131-23199`、`23019-23048` | 完整 | pointer capture 在头部 |
| SF-UI-029 | 「稍后」按时长恢复（10min/3min） | `client.js:23020-23021`、`23071-23078` | 完整 | 非签名式 |
| SF-UI-030 | 「去处理」生成待办指令并填输入框 | `client.js:22936-22993`、`22995-23001` | 完整 | 只填不发 |
| SF-UI-031 | 发送前门禁（三重拦截） | `client.js:22345-22440` | 完整 | 含猴补 `shell.submit` |
| SF-UI-032 | 环境适配跳过确认 | `client.js:22440-22494` | 完整 | 二次确认 |
| SF-UI-033 | 欢迎弹窗（一次性） | `client.js:22037-22094` | 完整 | 混淆键 |
| SF-UI-034 | 授权门（10s + 滚到底 + 三勾） | `client.js:22096-22183` | 完整 | 22KB 法律 HTML |
| SF-UI-035 | 授权服务端权威同步 | `client.js:21833-21890` | 完整 | 5×400ms 重试 |
| SF-UI-036 | 演练台 12 页签 / 6 分组 | `client.js:21477-21496` | 完整 | 见 §5.1 |
| SF-UI-037 | 分组导航（键盘 + roving tabindex + 未读点） | `client.js:21687-21729` | 完整 | 见 §3.11 |
| SF-UI-038 | 二级页签（仅 results/resources） | `client.js:21752-21766` | 完整 | 单页签组不渲染 |
| SF-UI-039 | 响应式导航（≤760px 转横向） | `client.js:21668-21685` | 完整 | ResizeObserver |
| SF-UI-040 | 演练台未读摘要（25s consoleDigest） | `client.js:21431-21472`、`21212-21220` | 完整 | 单飞防堆叠 |
| SF-UI-041 | `useWorkbenchFullscreen` 原生全屏 + CSS 兜底 | `client.js:61-299` | 完整（组件级） | `[实测]` 6 场景通过 |
| SF-UI-042 | 全屏 UI 出口 | `client.js:21739`（in-place）/`21984-21986`（新窗口） | **部分** | in-place 因 `embedded` 恒真不可达；新窗口 hash 无消费者 |
| SF-UI-043 | Esc 退出全屏（含嵌套浮层豁免） | `client.js:241-260` | 完整 | `[实测]` 嵌套时不拦 |
| SF-UI-044 | 会话地图（宿主 RPC + 图布局） | `client.js:20382-21004`、`19902-20271` | 完整（脆弱） | 见 §4.3 |
| SF-UI-045 | 会话地图自身全屏 | `client.js:20420-20447`、`20764` | 完整 | 独立于外层 hook |
| SF-UI-046 | 靶标绑定与跟随（三级回退） | `client.js:21323-21352` | 完整 | bound→标题→last |
| SF-UI-047 | 靶标切换（双 op 广播） | `client.js:21618-21636` | 完整 | 两个 op 都静默失败 |
| SF-UI-048 | 并发上限编辑 | `client.js:21113-21173` | 完整 | `setAgentsMax` |
| SF-UI-049 | 演练台主题跟随宿主 | `client.js:21513-21519`、`325-358` | 完整 | `productTheme.subscribe` |
| SF-UI-050 | 宿主 DOM 注入 chip（hero / tab 行） | `client.js:22813-22898`、`22700-22811` | 完整（脆弱） | 文案锚点匹配 |
| SF-UI-051 | 站点皮肤样式（`.rt-*` 860 类） | `client.js:6325-15665` | 完整 | 40% 文件体积 |
| SF-UI-052 | 主面板样式（`.dshp-*` 432 类） | `client.js:1408-3264` | 完整 | 4 套主题色重复 |
| SF-UI-053 | 代理池设置 UI | `client.js:18329-18771` | **缺失** | 组件存在但无调用方 |
| SF-UI-054 | 旧横向攻击链视图样式 | `client.js:6694` 起 | **缺失** | 24 个 `rt-hflow*/rt-flow-*/rt-hcol-*` 类无主 |
| SF-UI-055 | dock 全屏样式 | `client.js:2339-2347` | **缺失** | 依赖 `dshp-studio-dock` 类，从未加上 |
| SF-UI-056 | 侧栏/顶栏/全屏三个入口按钮 | `client.js:21774-21799` | **缺失** | 未导出、未渲染 |
| SF-UI-057 | `ContinueRetrySection` 重试面板 | `client.js:3423-3525` | **缺失** | 调用点被注释（`4022`） |
| SF-UI-058 | `testing`/`attackfiles`/`prompts` 三个页签 | `client.js:21533`,`21554`,`21556` | **缺失** | 分支存在但值不可达 |
| SF-UI-059 | i18n 双字典（346 键 ×2） | `client.js:708-1407` | 完整 | 62 键无调用 |
| SF-UI-060 | 路由/URL 状态 | — | **缺失** | 全部状态在内存，刷新即回 `overview` |

---

## 10. 未验证项

| 编号 | ❓未验证 | 缺什么才能验证 |
|---|---|---|
| U-01 | `Panel` 在 `embedded:true` 下的真实布局表现（`rt-dock.rt-embedded` 的 width:100% 是否与 dock body 的高度链配合） | 需要在装了 `dsh-purge-safe` 的宿主里打开 dock 的演练台页签并量 `getBoundingClientRect`；本机未安装该插件 |
| U-02 | `/api/session/list` 在**当前宿主版本**是否仍接受 `payload:{args:{_request:{}}}` 这一信封 | 需要在本机向运行中的宿主发一次该 POST；本机宿主未安装 safe，路由未必挂载 |
| U-03 | `conversation.input.shell(sid)` / `.setDraft` / `.submit` 在当前宿主版本的实际签名 | 需要运行时打印 `Object.keys(shell)`；静态只能看到调用形态（`client.js:5084-5118`、`22360`） |
| U-04 | `drill-grant` 服务端返回体除 `granted` 外是否还有字段 | 需要服务端源码或一次真实响应；本次只读客户端 |
| U-05 | 62 个"无调用"的 i18n 键是否被**服务端**拼进 HTML 或日志 | 需要检索 `vendor/safe/lib/**`；本次范围限 `client.js` |
| U-06 | 202 个"JS 无字面量"的 CSS 类中，除已列四族外的其余项是否真死（可能存在 `classList.add` 之外的构造方式，如 CSS-in-JS 字符串拼接未被我脚本覆盖） | 需要逐族人工核；本次已核 `dshp-clean-*`/`dshp-studio-*`/`rt-hflow-*`/`rt-flow-*`/`rt-stage-*`/`k-*` 与 6 个单点类 |
| U-07 | `attention` op 同时接受 `session` 与 `engagement` 两种入参的服务端实现 | 需要 `lib/redteam/**` 的 op 分派代码；本次只确认客户端两处发法不同 |
| U-08 | `AUTH_LEGAL_HTML` 在窄屏下是否触发 `readEnd` 误判（容器被撑开则"必须滚到底"形同虚设） | 需要浏览器实测 `scrollHeight` vs `clientHeight` |
| U-09 | `#redteam-full` 新窗口在真实宿主里打开后的实际界面 | 需要运行时点一次；静态只能确认无代码消费该 hash 去挂载非 embedded `Panel` |
| U-10 | community 侧的补丁区/规则区/技能区/通知/CSS/op 集是否与 safe 等价 | 按任务约定本节未查；需另一份 community 审计对照 |
