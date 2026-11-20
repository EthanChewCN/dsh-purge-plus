# 01 · community 1.7.20 面板 UI 全量（`client.js` + `lib/redteam/client.js`）

> 范围：community 1.7.20 的**浏览器半侧**全部代码。只读审计，未改任何代码。
> 标注约定：`[静态]` = 读 vendor 快照得出；`[实测]` = 实际跑脚本/grep 计算得出（命令见文末）。
> 行号以 `vendor/community/` 当前快照为准。

---

## 1. 模块清单

### 1.1 物理文件

| 文件 | 行数 | 一句话职责 | 是否被 `index.js` 加载 |
|---|---|---|---|
| `vendor/community/client.js` | 15,601 | 唯一真正被宿主加载的浏览器模块（`package.json` `exports["./client"]` → `./client.js`）；内含外壳面板 + 内嵌演练台 | **是**。`package.json:12` 声明 `"./client": "./client.js"`；`package.json:214-221` 的 `dsh.client.platform = "web"` 与 6 个 `inject` 决定它作为 web 客户端模块挂载 |
| `vendor/community/lib/redteam/client.js` | 4,218 | 演练台的**手写源文件**，被 `scripts/build-client.mjs` 抽成工厂片段内嵌进 `client.js` | **否**。`package.json` 的 `exports` 里没有 `./redteam/client`；`files` 含 `lib` 所以它随包发布，但无任何代码路径 require 它 |

`[实测]` `grep -c "lib/redteam/client" vendor/community --include=*.js` 只命中 `scripts/build-client.mjs`；运行时无引用。

### 1.2 `client.js` 内部的 27 个 `src/*` 段（按 `// src/…` 注释切分）

| 起始行 | 结束行 | 源模块 | 职责 |
|---|---|---|---|
| 34 | 44 | `entry.js` | `__export` 导出表：`PanelOverlays` / `PurgeIcon` / `apply` / `inject` |
| 45 | 49 | `shared/react.js` | `h = React.createElement`（外壳唯一创建函数别名） |
| 50 | 52 | `styles/base.css` | `base_default`，25,674 字符 / 179 条规则 |
| 53 | 55 | `styles/native.css` | `native_default`，9,509 字符 / 74 条规则（插件设置页 `.dshpp-native` 根） |
| 56 | 58 | `styles/page.css` | `page_default`，26,471 字符 / 228 条规则（Purge 整页 `.dshpp-page` 根） |
| 59 | 96 | `shared/runtime-error.js` | `runtimeRepairDetails(report)`：把 `cli_repair` 报告拍平成错误行 |
| 97 | 270 | `api/client.js` | `apiUrl` / `apiTimeoutMs` / `requestJson` / `apiJson` / `rulesApi` / `skillsApi` |
| 271 | 8957 | `vendor/drill.js` | 演练台整块（8,687 行），IIFE 产出 `__dshPurgeDrill` |
| 8958 | 9113 | `state/dock.js` | 授权状态、`/dsh-purge/drill-grant` 同步、`dockBus` 发布订阅 |
| 9114 | 9116 | `components/auth.js` | 只留 `rd = require("react-dom")` |
| 9117 | 10015 | `shared/locale.js` | `NS`、`translate` 单例、`zh`（433 键）、`en`（433 键） |
| 10016 | 10171 | `components/auth.js` | `AUTH_LEGAL_HTML`（约 3.2 万字符法务正文）+ `AuthGate` |
| 10172 | 10211 | `state/rewind-visibility.js` | 回退按钮显隐的模块级单例 + `/dsh-purge/boost` 读写 |
| 10212 | 10282 | `components/rewind-setting.js` | `RewindSetting`（「更多」页的开关） |
| 10283 | 10826 | `components/patch-status.js` | `statusKind` / `LAYER_GROUP` / `PatchHealth` / `Switch` / `PatchGroupSwitches` / `PatchGroups` / `PatchApplySteps` |
| 10827 | 10897 | `components/primitives.js` | `formatSize` / `noticeNode` / `Btn` / `Pill` / `HelpTip` |
| 10898 | 10926 | `shared/apply-result.js` | `incompleteApplyDetail(result, t)` |
| 10927 | 10997 | `components/advanced.js` | `HooksDenySection` |
| 10998 | 11149 | `components/restart.js` | `RestartAsk` / `waitForRestart` / `restartDsh` / `detectHostTheme` |
| 11150 | 11215 | `shared/versions.js` | `splitListedVersion` / `listedVersionNewer` / `listedCeiling` / `keepListedVersion` / `preferListed` / `versionChoiceLabel` |
| 11216 | 12207 | `components/settings-form.js` | **`PurgifySection`**（992 行）：状态页 / 提示词页 / 更多页三合一渲染器 |
| 12208 | 12270 | `state/session-context.js` | `bindSessionContext` / `clientCurrentCwd` / `useCurrentCwd` |
| 12271 | 12705 | `components/rules.js` | `RulesSection`（435 行） |
| 12706 | 13093 | `components/skills.js` | `skillUiAllowed` + `SkillsSection`（388 行） |
| 13094 | 13803 | `components/maintenance.js` | `useText` / `StatusExtras` / `assertMaintenanceResult` / `maintenanceNotice` / `UpdatePreferences` / `UpdateChannelDialog` / `CommunityMaintenance` |
| 13804 | 14087 | `components/page.js` | `TABS` / `PurgeGlyph` / `StatusStrip` / `LayoutNotice` / `VersionNotice` / `PurgePage` |
| 14088 | 14090 | `assets/sidebar-glyph.png` | 40×64 PNG 的 base64 常量 `sidebar_glyph_default` |
| 14091 | 14190 | `state/preset-menu.js` | `bindPresetMenu`：折叠 `unrestricted-child-*` 历史别名 |
| 14191 | 14202 | `state/legacy-visibility.js` | `ENTRY_CSS` + `installLegacyVisibility` |
| 14203 | 14205 | `components/rewind.js` | 只留 `react-dom` 引入 |
| 14206 | 14548 | `state/rewind-draft.js` | 草稿持久化、composer 填充调度、`dropInheritedQueue`、`openRewoundSession` |
| 14549 | 14969 | `components/rewind.js` | `RewindMenu` / `RewindFallback` / `RewindSafe` / `RewindDraftSync` / `RewindButton` / `installRewindWatch` / `installRewindUi` |
| 14970 | 14975 | `components/welcome.js` + `styles/welcome.css` | `rd3` 引入 + `welcome_default`（3,040 字符 / 22 条规则） |
| 14976 | 15076 | `components/welcome.js` | `WelcomeNotice` |
| 15077 | 15184 | `state/redteam-mode.js` | `isRedteamPresetId` / `readSessionAgentPreset` / `isRedteamModeActive` / `looksLikeSendControl` |
| 15185 | 15463 | `components/env-gate.js` | `fetchEnvAdaptStatus` / `EnvironmentDialog` / `EnvAdaptSendGate` |
| 15464 | 15601 | `entry.js` | `inject` / `PurgeIcon` / `PurgeGlyphIcon` / `DetailSettings` / `PanelOverlays` / `apply(ctx)` |

### 1.3 组件总数

`[实测]` 外壳段（第 1–270、8958–15601 行）共 210 个顶层定义，其中 **37 个 React 组件**：`AuthGate` `RewindSetting` `Tile` `PatchHealth` `Switch` `PatchGroupSwitches` `PatchGroups` `PatchApplySteps` `Btn` `Pill` `HelpTip` `HooksDenySection` `RestartAsk` `PurgifySection` `RulesSection` `SkillsSection` `StatusExtras` `UpdatePreferences` `UpdateChannelDialog` `CommunityMaintenance` `PurgeGlyph` `StatusStrip` `LayoutNotice` `VersionNotice` `PurgePage` `RewindMenu` `RewindFallback` `RewindSafe` `RewindDraftSync` `RewindButton` `WelcomeNotice` `EnvironmentDialog` `EnvAdaptSendGate` `PurgeIcon` `PurgeGlyphIcon` `DetailSettings` `PanelOverlays`。

演练台段共 **34 个顶层 `function`**（`[实测]` 按 `function <name>` 抽取）。其中 26 个是组件：`AssetsTab` `DiscoveryView` `PromptsTab` `SkillsTab` `HttpBlock` `FindingsTab` `ChainTab` `ReportTab` `AttackFilesTab` `KnowledgeTab` `EnvTab` `ScoreTab` `TestingTab` `SessionTab` `AgentsTab` `ConcurrencyCard` `VersionBar` `Panel` `SidebarButton` `HeaderButton` `FullButton` `Section` `Clip` `PriTag` `TestTag` `ProvTag`；8 个是辅助：`clampRtGeom` `defaultRtGeom` `loadRtGeom` `useCollapse` `groupByStage` `detailEvidence` `targetKeyOf` `apply`。

另有 4 个 `const` 箭头组件不在这 34 个之内：`ShotImage`（`client.js:929`）、`ShotStrip`（`client.js:982`）、`RtBoundary`（class，`7778`）、`segBlock` 工厂（`1280`）。

> `Section`（`client.js:6951`）`[实测]` `grep -c "h2(Section" client.js` = **0**，是死组件（51 行）。

---

## 2. 数据模型

### 2.1 localStorage / sessionStorage

| 载体 | 键 | 类型 | 谁写 | 谁读 | 生命周期 |
|---|---|---|---|---|---|
| localStorage | `dsh-purge-drill-auth` | `"1"` / 删除 | `setDrillAuthLocal`（`client.js:8973-8981`） | `readDrillAuth`（`client.js:8965-8971`） | 勾选法务三项并点确认后写入；服务端 `drill-grant` 返回 `granted:false` 时由 `syncDrillGrant` 删除（`client.js:9030`） |
| localStorage | `rt-collapse:<prefix>` | JSON 对象 `{key:boolean}` | `collapseSave`（`client.js:6921-6925`） | `collapseLoad`（`client.js:6912-6919`） | 每次折叠/展开写一次；`prefix` 目前只有 `assets-side:<engagementId>`（`client.js:1122`）。无清理路径，按靶标累积 |
| localStorage | `rt-unread:<engagementId>` | JSON `{tab:{count,at}}` | `saveUnread`（`client.js:8291-8296`） | `loadUnread`（`client.js:8282-8290`） | 每 25 s 拉一次 `consoleDigest`（`client.js:8548`）后写；切靶标时 `setSeen(loadUnread(eng))`（`client.js:8526`）。**按靶标累积，无清理** |
| localStorage | `rt-dock-geom-v1` | JSON `{x,y,w,h}` | `Panel` 的 `useEffect`（`client.js:8356-8361`） | `loadRtGeom`（`client.js:8337-8346`） | 每次拖动/缩放写；`embedded` 模式不写（`client.js:8357` 提前 return） |
| localStorage | `rt-dock-width` | 数字字符串 | `defaultRtGeom` 只读不写（`client.js:8329`）—— **全文件无写入点** | `defaultRtGeom`（`client.js:8329`） | 遗留键：1.1.71 时代写过，现在只读。**只读遗留** |
| sessionStorage | `dshp-rewind-draft:<sessionId>` | 字符串（草稿） | `writeDraft`（`client.js:14285-14293`） | `peekDraft`（`client.js:14293-14301`） | `clearStoredDraft` 清除（`client.js:14303-14314`）；用 sessionStorage（`client.js:14217-14222`）故随标签页消失 |
| sessionStorage | `dshp-rewind-arm:<sessionId>` | 时间戳字符串 | `armComposerFill`（`client.js:14316-14324`） | `takeArmedFill`（`client.js:14326-14348`） | 有 `ARM_TTL_MS = 45000`（`client.js:14210`）过期判定；`clearStoredDraft` 一并删 |
| localStorage | `dsh-purge-user-notice-v1` | `"1"` | `writeWelcomeAck`（`client.js:14985-14990`） | `readWelcomeAck`（`client.js:14978-14984`） | 首启法务弹窗勾选后写入，**永久**，无重置入口 |
| localStorage | `dshpp-theme` / `dshpp-theme-mode` | 任意 | **全文件无写入点** | **无读取点**；只在卸载成功后 `removeItem`（`client.js:11736-11737`） | 纯遗留清理目标 |
| localStorage | 预设菜单无键 | — | — | — | 折叠状态只在 DOM 上打 `data-purge-collapsed-alias`（`client.js:14174`），不持久化 |

### 2.2 模块级内存状态（无持久化，刷新即重置）

| 变量 | 位置 | 类型 | 谁写 | 谁读 | 重置时机 |
|---|---|---|---|---|---|
| `dockBus` | `client.js:9040-9046` | `{open,tab,authOpen,pending,listeners:Set}` | `setDock(patch)`（`client.js:9047-9058`） | `useDock()`（`client.js:9059-9070`）、`syncDrillGrant` 读 `dockBus.tab/authOpen/pending` | 永不整体重置；`setDock` 每次新建对象并广播 |
| `drillGrantState` | `client.js:8962` | `{ready,granted}` | `setDrillAuthLocal`（`client.js:8973`） | `readDrillAuth`（`client.js:8965`） | 首读后 `ready:true` 即作为权威值，不再读 localStorage |
| `drillGrantGen` / `drillGrantPosting` | `client.js:8960-8961` | number | `writeDrillAuth`（`client.js:8983-9000`）、`startGrantSync` 清理函数（`client.js:9002-9008`） | 同上 | 每次写授权 `+1`，用来丢弃过期响应 |
| `drillSyncRetryTimer` | `client.js:8963` | timeout id | `syncDrillGrant`（`client.js:9009-9038`） | 同上 | 最多重试 5 次，间隔 400 ms（`client.js:9032-9035`） |
| `pendingStatus` | `client.js:175` | Promise \| null | `apiJson`（`client.js:176-194`） | 同上 | 仅对 `GET /dsh-purge/status` 做 in-flight 去重，promise settle 后清空 |
| `restartOnce` | `client.js:11070` | boolean | `restartDsh`（`client.js:11071-11131`） | 同上 | 成功进入重启流程后置 `true` 防重入；失败分支置回 `false` |
| `seenAt`（回退游标） | `client.js:14211` | number | `noteRewindAt`（`client.js:14235-14237`） | `getRewindSeenAt`（`client.js:14232`） | 进程内单调递增，防止同一 `at` 重复触发 |
| `workspace` / `conversation` / `host2` | `client.js:14213-14214`、`12210` | 宿主 ctx | `bindRewindHost`（`14224`）/ `bindSessionContext`（`12219`） | `currentSessionId` / `hostSessions` | ctx 销毁时置 null（`client.js:12234-12237`） |
| `pendingComposer` / `armedFill` | `client.js:14215-14216` | `{sessionId,text,at}` | `writeDraft` / `armComposerFill` | `peekDraft` / `takeArmedFill` | 单槽，切换 sessionId 即覆盖 |
| `visible` + `listeners` | `client.js:10173-10175` | boolean + Set | `publish`（`client.js:10181-10185`） | `subscribeRewind`（`client.js:10176-10180`） | 单例；`RewindSetting` 与 `RewindSafe` 共享 |
| `pendingRead` | `client.js:10174` | Promise \| undefined | `readRewindVisibility`（`client.js:10191-10200`） | 同上 | 去重并发读；`saveRewindVisibility` 成功后清空（`client.js:10207`） |
| `preferenceListeners` | `client.js:13567` | Set | `UpdatePreferences.save` / `UpdateChannelDialog.save` 经 `publishPreferences`（`13568-13570`） | `CommunityMaintenance` 的 `receive`（`13597-13602`） | `CommunityMaintenance` 卸载时移除 |
| `shotCache` / `shotLoading` | `client.js:904-905` | `Map<string,dataURL>` / `Map<string,Promise>` | `loadShot`（`client.js:907-927`） | `shotSrc`（`client.js:906`） | **永不清理**，按 `eng:id` 累积；切靶标不清 |
| `ui` + `subs` | `client.js:851-862` | `{open,tab}` + Set | `setUI`（`client.js:853-862`） | `useUI`（`client.js:866-878`） | 模块级；初始 `{open:true,tab:"assets"}` |
| `turn` / `cleanup` | `client.js:14093-14094` | number / fn | `bindPresetMenu.open`（`client.js:14100`） | 同上 | 每次点击 `+1` 丢弃旧异步；`apply` 的 cleanup 递增 |
| `nativeSidebar` | `client.js:9112` | null | **无写入点** | `setDock` 判空（`client.js:9052`） | 恒为 `null` → `setDock` 里的 `nativeSidebar.openTab("dsh-purge")` 分支**永不执行** |

### 2.3 组件内状态（`useState`）清单

`[实测]` 外壳段 `useState(` 共 96 处、演练台段 118 处。关键生命周期：

| 组件 | state | 重置时机 |
|---|---|---|
| `PurgePage`（`13950`） | `tab` 初始 `"status"`；`visited` 初始 `{status:true}`；`info` | `visited` 只增不减：页签一旦打开过就永久保留其子树（`13955-13958`），切走只 `hidden` 不卸载 |
| `PurgifySection`（`11217`） | 22 个 `useState` + 8 个 `useRef` | `promptSeededRef` / `ownSeededRef` 保证 textarea 只在首次加载时灌值（`11505-11508`、`11513-11516`），后续 `loadAll` 不覆盖用户输入 |
| `PatchGroups`（`10633`） | `open` 初始 `{code:true}`；`filter` 初始 `"all"` | 切靶标不重置（无 key 变化） |
| `StatusExtras`（`13102`） | `check` / `boost` / `busy` / `notice` | 只在挂载时 `load()` 一次（`13111-13113`），`PurgePage` 每次进状态页都会重挂（因 `hidden` 而非卸载 → 实际**只加载一次**） |
| `CommunityMaintenance`（`13571`） | 9 个 `useState` + 4 个 `useRef` | `generation` ref 递增作废在途请求（`13580`、`13611`）；卸载时 `mounted=false` + `generation++` |
| `Panel`（`8345`，演练台） | 11 个 `useState` | `eng` 变更触发 `loadSnapshot` + `consoleDigest` 轮询重建（`8520-8558`） |

---

## 3. 业务逻辑

### 3.1 `apply(ctx)` — 模块装配（`client.js:15521-15600`）

- 入口签名：`apply(ctx)`，`inject = ["slots","locale"]`（`client.js:15466`）。
- 判据 / 副作用按顺序：
  1. `ctx.effect(() => installLegacyVisibility(), "panel legacy visibility")`（`15522`）→ 往 `document.head` 追加 `<style data-dsh-purge-panel-visibility="1">`，内容 `ENTRY_CSS` 隐藏 `.dshp-launch,.dshp-hero-chip,.dshp-tab-chip,.dshp-dock`（`14192`）。
  2. `ctx.inject(["sessions","uiWorkspace"], …)` → `bindSessionContext`（`15523-15525`）。
  3. `ctx.inject(["remote","remote.agentPresets"], …)` → `bindPresetMenu(document, () => host3.remote.agentPresets.list())`（`15526-15531`）。
  4. `ctx.effect(startGrantSync, "panel grant sync")`（`15532`）。
  5. `ctx.inject(["sessions","uiWorkspace","conversation"], installRewindUi)`（`15533-15536`）。
  6. `ctx.effect(() => ctx.locale.register(NS, { zh, en }), "panel locale")` + `setTranslate(ctx.locale.bind(NS))`（`15537-15539`）。
  7. 6 处 `ctx.slots.inject` + `ctx.slots.register`（见 5.1）。
- 失败路径：`ctx.inject` 缺依赖时宿主不调用回调，对应功能整块不挂载（例如没有 `remote.agentPresets` 则预设菜单折叠失效），无日志。

### 3.2 `PurgePage` 页签切换（`client.js:13950-14087`）

- 签名：`PurgePage()`，无 props。
- 判据：`const active = TABS.find(row => row[0] === tab) || TABS[0]`（`13977`）；`visited` 决定子页是否挂载（`14033-14054`）。
- 副作用：
  - `useEffect` 在 `tab === "status"` 时 `loadInfo()`（`13960-13962`）。
  - 第二个 `useEffect`：当 `info.asar_handoff.phase` ∈ `{starting,ready,waiting_for_quit,waiting_for_unlock,moving}` 时每 2 s 轮询 `/dsh-purge/status`（`13963-13972`）。
- 失败路径：`loadInfo` 的 `.catch` 把 `setInfo(unavailableStatus(error))`（`13959`）→ `VersionNotice` 渲染红字提示（`13934-13946`），`StatusStrip` 显示「读取失败」。

### 3.3 应用 / 还原 / 卸载（`PurgifySection`）

**`doAction(action, actionKey)`（`11524-11623`）**

- 签名：`doAction("apply"|"revert", "action.apply"|"action.revert")`；调用点只有 `11942`、`11951`。
- 判据：
  1. `ticket = ++actionTicket.current`（`11527`）；响应回来若 `ticket !== actionTicket.current` 直接丢弃（`11547`）。
  2. `responseNeedsPrompt(d)` 为真（`d.needPrompt` 或 `d.injectSource === "none"`，`client.js:236-238`）→ `rejectNeedPrompt`：`setAskRestart(false)` + 红字 + `window.alert(tr("need.prompt"))`（`11518-11523`）。
  3. `!d.ok` → 错误文案拼 `runtimeRepairDetails(d.cli_repair)`（`11550-11562`）。
  4. `action === "apply" && d.complete === false` → 走 `incompleteApplyDetail` 显示「写入不完整」，并 `loadAll()`；若 `d.restarting || d.needs_full_quit` 则弹重启框（`11576-11589`）。
  5. `action === "apply" && d.manualQuit` → 固定文案「补丁已写入磁盘，当前进程尚未加载…」（`11591-11600`），**不弹重启框**。
- 副作用：`POST /dsh-purge/apply`（body `{content}`）或 `POST /dsh-purge/revert`（body `{}`）；`fetch` 直连不走 `apiJson`（`11539-11546`），所以**不受 `apiTimeoutMs` 约束、不解析非 JSON 错误**。
- 失败路径：`.catch` 统一 `tr("err.action", {action, error})`；`.finally` 仅在 ticket 仍有效时清 `patchBusy`。

**`doUninstall()`（`11754-11798`）**

- 判据：`POST /dsh-purge/uninstall` body `"{}"`；`!d.ok` 抛错。
- 副作用：成功后 `setNotice(d.note || hostText(tr,"uninstall.done",d.surface))`；若 `d.surface === "desktop" || d.fullApp || hostSurfaceOf(state) === "desktop"` 则**直接返回不轮询**（`11771`），否则 `waitHostAfterUninstall`。
- `waitHostAfterUninstall`（`11724-11752`）：从 800 ms 起每 500 ms `GET /`，`r.ok` 后删 `dshpp-theme*` 并 `location.reload()`；超 90 s 报 `restart.timeout`。
- 失败路径：`failed to fetch|networkerror|load failed` 被当作「已卸载」处理（`11778-11786`）——因为进程自杀会断开连接。

### 3.4 提示词读写（`saveOverride` / `restoreOverride`）

**`saveOverride()`（`11626-11676`）**

- 判据：
  1. `promptPending.current` 为真直接 return（防重入）。
  2. `bothInjectEmpty(content, defaultOverrideRef.current)` 为真 → `rejectNeedPrompt`（`11636-11639`）。即**提交内容与内置默认都为空时拒绝**。
  3. `POST /dsh-purge/override` body `{content}`。
  4. `responseNeedsPrompt(d)` → 拒绝（`11645-11648`）。
- 副作用：`readPromptBox()` 从 DOM 节点读实时值而非 state（`11265-11270`），避免 IME 未提交丢字。
- 失败路径：`!d.ok` 抛错 → `t("err.save", {error})`。

**`restoreOverride()`（`11693-11737`）**：把 `defaultOverride` 写回 textarea 并 `POST /dsh-purge/override`；`!d.ok` 报 `err.save`。

### 3.5 服务器名单（`saveOwnServers`，`11678-11691`）

- 判据：`ownPending.current || !ownLoaded` 直接 return（`11679`）。
- 副作用：`POST /dsh-purge/own-servers` body `{content}`；提示语按 `d.dropped > 0` 分三档（`11687`）。
- 失败路径：`err.save`。

### 3.6 在线更新（`PurgifySection` 内 5 个 callback）

| 入口 | 行号 | op | 判据 | 副作用 |
|---|---|---|---|---|
| `checkUpdate(id)` | `11310-11330` | `GET /dsh-purge/update` | `!d \|\| (!d.ok && !d.channel)` → 抛 | `applyUpdateInfo(d, tr, "check")`；`setCanApplyUpdate(d.hasUpdate && !d.error)`（`11298`） |
| `postUpdate(body, kind, id)` | `11331-11386` | `POST /dsh-purge/update` | `d.needsFullQuit` → 弹重启框；`d.restartAfter` → 只提示；`d.applied && d.reloadClient !== false` → 280 ms 后 `location.reload()`；`d.needRestart` → 弹重启框 | 见左 |
| `doUpdate(id)` | `11387-11402` | `POST` body `{op:"apply", ref: lane==="beta"?"beta":"master", channel: lane}` | — | 成功后按 `postUpdate` 分支走 |
| `changeChannel(next)` | `11403-11424` | `POST` body `{op:"channel", channel: next}` | `window.confirm(tr("update.confirmChannel"))` 取消则 return | 乐观更新 `channel`/`updateInfo`，失败回滚（`11420-11423`） |
| `switchSelected(id)` | `11425-11457` | `POST` body `{op:"switch", ref}` | `!ref` return；`window.confirm(tr("update.confirmSwitch"))` | 同上 |

- 版本选择算法（`shared/versions.js`）：`listedCeiling` 用本地版本当上限（`11171-11186`），`keepListedVersion` 剔预发布（`11187-11195`），`preferListed` 优先 `current`→`latest`→首项（`11196-11207`）。`listedVersionNewer` 对预发布段用**字符串比较**（`11169`），非语义化比较。

### 3.7 补丁组开关（`PatchGroupSwitches.toggle`，`10559-10584`）

- 判据：`!flags || busy` return（`10560`）。
- 副作用：`POST /dsh-purge/boost` body `{ [key]: next }`，`key ∈ {permissionPatches, contextManagement}`；成功后回灌 `d.permissionPatches !== false` / `d.contextManagement === true`（**注意两者默认值相反**，`10571-10574`），并调 `onSaved()` → `loadAll()`。
- 失败路径：`sw.fail`。

### 3.8 破甲自检 / 强化段（`StatusExtras`，`13102-13244`）

- `load()`（`13107-13110`）：并发 `GET /dsh-purge/selfcheck` 与 `GET /dsh-purge/boost`；任一失败置 `null` 而不报错。
- `toggle()`（`13114-13127`）：`POST /dsh-purge/boost` body `{enabled: !boost}`；成功后提示「重启后生效」。
- `rerun()`（`13128-13137`）：重拉 `selfcheck`。
- 探针按钮（`13195-13215`）：`POST /dsh-purge/probe` body `"{}"`，把 `r.message` 显示为 notice。
- 判据分层：`failed = layers.filter(l => l.state==="broken" || !l.state && !l.ok)`（`13140-13142`）；`pendingLayers`、`uncertain = state ∈ {inferred,unknown}`（`13143-13146`）；`total = layers.filter(l => l.applicable !== false).length`（`13150`）。

### 3.9 Hooks 拒绝旁路（`HooksDenySection`，`10928-10996`）

- 挂载时 `GET /dsh-purge/hooks-deny`；`d.hooksDenyBypass !== false` 决定初值（`10935-10937`）。
- 勾选即 `POST /dsh-purge/hooks-deny` body `{hooksDenyBypass}`（`10945-10950`），成功后 `onSaved()`。
- 失败路径：`err.save`；`cfg` 为 `null` 时整块 `return null`（`10968`）。

### 3.10 规则集（`RulesSection`，`12278-12705`）

- 依赖 `cwd = useCurrentCwd()`（`12280`）→ `status` 请求带 `{cwd}`。
- op 与判据：

| 动作 | 行号 | 触发 | 判据 / 副作用 |
|---|---|---|---|
| `status` | `12293-12311` | 挂载 + 每次写操作后 | 带 `cwd`；`!d.ok` → `st = {ok:false,rules:[],active:null}` + 红字 |
| `read` | `12338-12360` | 点规则行 / Enter / Space | 回填 `editId/editName/editTarget/content` |
| `save` | `12313-12336` 经 `doPost` | 新建 / 编辑器保存 | 成功后 `warnNeedPrompt(d, t)`（`12322`）→ 需要提示词时弹 alert |
| `activate` | 同上 | 行内「使用」 | 同上 |
| `delete` | 同上 | 行内「删除」，先 `window.confirm(tr("confirm.delete"))` | 若正编辑同一条则 `clearEditor()` |
| `reset` | `12467-12478` | 标题行「恢复默认」，先 confirm | `clearEditor()` 后 `doPost("reset", {})` |
| `set-policy` | `12493` | 下拉变更 | body `{policy}` |
| `scan-cwd` | `12512-12525` | 「重新扫描」 | `cwd` 取 `st.cwd` 否则 `clientCurrentCwd()`；都没有则发 `{}` |
| `toggle-cwd` | `12548-12555` | 工作区文件勾选 | body `{path, enabled}` |

- 失败路径：全部走 `err.action` / `err.read` / `err.rules`；`busy` 期间所有按钮 `disabled`。
- `policyOptions` 回落：`st.workspace_policies` 为空数组时用 `["fallback","strict","always"]`（`12460`）。

### 3.11 技能（`SkillsSection`，`12720-13093`）

- **整块闸门**：`skillUiAllowed(d)`（`12707-12719`）——版本 <1.12 且非 1.1.11 特例时返回 false；`if (!onBeta) return null`（`12890`）→ 该页签渲染为空白（不是「不可用」提示）。
- 数据来源双路：先 `GET /dsh-purge/status`，若 `d.skills` 存在直接用它，否则 `skillsApi("status")`（`12748-12762`）。
- op：`status` / `read` / `save` / `delete` / `import`。
- `import` 两种载荷：
  - zip：`{data: base64, name: file.name}`（`12836`）
  - 文件夹：`{files: [{path, content: base64, encoding:"base64"}], name: 首层目录名}`（`12862-12872`）
- 目录导入过滤 `keepFolderFile`（`12819-12831`）：拒 `..`、`node_modules`、`.git`、`__MACOSX`、`.system`、`._*`、`.DS_Store`。
- 路由回落：`skillsApi` 对 404/405 自动改打 `/dsh-purge/skill`（`1262-1269`）。
- 失败路径：`skillsRouteMissing(e)` 为真时统一提示「需重启宿主」`err.skills.needRestart`（`12742`、`12808`）。

### 3.12 社区维护（`CommunityMaintenance`，`13571-13802`）

- `load()`（`13579-13610`）：`GET /dsh-purge/community`；`!Array.isArray(result.backups)` 视为响应无效（`13588`）。`generation` ref 作废在途请求；`previousSave === latestSave.current` 时把本地乐观值合回去（`13591-13593`）。
- `run(op)`（`13613-13672`）：
  - `running.current` 防重入（`13614`）。
  - `op === "rollback"` 需 `window.confirm`（长文案，`13615-13618`）。
  - `op === "update"` 需 `window.confirm`（`13619-13622`）。
  - body 固定 `{op, id: selected, ref: release}`（`13628-13632`）——**`check`/`backup` 也带这两个空字段**。
  - `op === "check"` 分支额外校验 `Array.isArray(r.versions)`，并把 `r.versions.filter(v => v.asset)` 存进 `releases`（`13635-13641`）。
  - 非 `check` 的操作在 `finally` 里 `await load()`（`13666`）。
- 「最近动作」（`13687-13708`）：`GET /dsh-purge/audit?limit=10`，把每条除 `at/event/pid` 外的字段 `JSON.stringify` 后拼行；空数组提示「还没有动作记录」。
- 失败路径：`timeout` 单独文案「维护请求超时，操作可能仍在执行…」（`13665`）。

### 3.13 更新偏好与通道（`UpdatePreferences` / `UpdateChannelDialog`）

- 两者都 `POST /dsh-purge/community` body `{op:"preferences", value: patch}`（`13292-13296`、`13427-13431`）。
- `UpdatePreferences.save`（`13287-13302`）：`locked.current` 防重入；成功后 `onSaved(result.update_preferences)` → `publishPreferences`。
- 间隔下拉的候选：`[...new Set([1,6,12,24,value.intervalHours])].sort()`（`13350`）——当前值不在预设里时也会出现。
- `UpdateChannelDialog.save`（`13413-13439`）：只提交**变化过**的字段：`mirrorUrl` / `proxyUrl` / `githubToken` / `clearGithubToken`（`13416-13421`）。空 token 表示不改（`13435-13437`）。
- 关闭：`Escape` 在捕获阶段拦截并 `stopPropagation`（`13405-13412`）；遮罩点击关闭（`13444-13447`）。

### 3.14 回退按钮（`state/rewind-visibility.js` + `components/rewind.js`）

- `readRewindVisibility()`（`10191-10200`）：`GET /dsh-purge/boost`，`valueFrom` 要求 `reply.ok === true && typeof reply.rewind === "boolean"`，否则抛 `无法读取回退按钮设置`（`10186-10190`）。
- `saveRewindVisibility(value)`（`10201-10209`）：`POST /dsh-purge/boost` body `{rewind: value}`。
- `RewindSafe`（`14781-14813`）：`getDerivedStateFromError` → `failed:true`，降级渲染 `RewindFallback`；`visible` 由 `subscribeRewind` 驱动。
- `RewindButton.runRewind(mode)`（`14855-14882`）：`POST /dsh-purge/rewind` body `{sessionId, mode}`，`mode ∈ {"once","round"}`；要求 `data.ok && data.sessionId && data.cleared !== false`，否则抛「没有清掉之前发送的内容」。
- `installRewindWatch`（`14927-14950`）：每 **1200 ms** `GET /dsh-purge/rewind`，`data.at > seenAt` 且当前会话匹配 `data.parentId` 时回填输入框并 `openRewoundSession`。
- `scheduleEchoClear`（`14447-14485`）：`GET /dsh-purge/last-user?sessionId=…`，若最后一条用户消息与草稿相同则清空 composer（防「回退后又把同一句发出去」）。
- `FILL_DELAYS = [0,50,180,400,800]`（`14209`）：多次重试填充，因为 composer 可能被宿主重渲染。

### 3.15 授权门（`AuthGate`，`10018-10171`）

- 判据（三个同时满足才 `ready`）：
  1. `left === 0`：10 秒倒计时（`10024-10036`）。
  2. `readEnd === true`：法务区滚到底（`10037-10041` + `onScroll` 判定 `scrollTop + clientHeight >= scrollHeight - 8`，`10055-10062`）；若内容本就不需要滚动则挂载即置真（`10039`）。
  3. `checks.read && checks.scope && checks.ban`（`10047`）。
- 副作用（点确认）：`writeDrillAuth(true)` → 写 localStorage + `POST /dsh-purge/drill-grant`（`8983-9000`）；`setDock({authOpen:false, open:true, tab:"drill"})`；按 `pending` 分支 `__dshPurgeDrill.setUI({open:true})` / `{open:true,tab:"env"}` / `window.open(...#redteam-full)`（`10128-10163`）。
- 失败路径：点「不同意」→ `setDock({authOpen:false, tab:"clean", pending:"tab"})`（`10121`）。**`"clean"` 不在 `TABS` 也不在任何 `st.tab ===` 分支**（见 8.3）。

### 3.16 演练台门禁（`requestDrill`，`9071-9106`）

- `readDrillAuth()` 为真 → 直接开面板；`pending === "env"` 额外 `setUI({open:true,tab:"env"})`；`pending === "full"` 额外开新窗口。
- 为假 → `setDock({open:true, tab:"drill", authOpen:true, pending})`。
- `syncDrillGrant`（`9009-9038`）：`GET /dsh-purge/drill-grant`；`r.granted` 真则本地置真并关掉授权框；假则**强制**把 `dockBus` 拨回 `{open:true,tab:"drill",authOpen:true}`（`9025-9031`）——即服务端撤销授权会立刻踢回授权门。失败重试 5×400 ms。

### 3.17 发送闸门（`EnvAdaptSendGate`，`15219-15462`）

- 触发条件 `mustBlockSubmit()`（`15258-15269`）：`isRedteamModeActive()` 为真 **且** 缓存 `ready` 为假（缓存 2500 ms）。
- 三种拦截手段：
  1. 打补丁 `shell.submit`（`15260-15279`，400 ms 定时器在 `15291`）：包装 `submit` 并替换 `shell.actions.submit`。
  2. 捕获阶段监听 `pointerdown`/`click`（处理器 `15334-15341`，注册 `15357`）：`looksLikeSendControl(e.target)`（`15155-15184`）为真则 `preventDefault + stopPropagation + stopImmediatePropagation`。
  3. 捕获阶段监听 `keydown`（处理器 `15342-15356`，注册 `15359`）：Enter 且非 Shift、非输入法组合、焦点在 composer 内、且不在 `.dshp-dock/.dshp-auth-mask/.rt-dock/.dshp-env-gate` 内。
- 拦截后：未授权 → 直接 `requestDrillEnv()`；已授权 → 弹 `EnvironmentDialog`。
- 跳过：`POST /redteam/api` `{op:"platformEnvAdaptSkip", skip:true}`（`15390-15406`）；**网络失败也把缓存置 `ready:true`**（`15401-15406`）——离线时闸门永久放行直到刷新。
- `isRedteamModeActive()`（`15106-15153`）：先读会话 `projectionValues.agentPreset` / `agentPreset` / `header.agentPreset`；再退到 DOM 查询 `[data-agent-preset='redteam']` 等语义属性；最后按文案正则 `/红队模式/`、`/^RedTeam\b/i` 匹配 seat label。**三套启发式串联，任一命中即真**。

### 3.18 演练台（`vendor/drill.js`）

**装配**：IIFE（`client.js:273-8954`）返回 `{CSS, Panel, setUI, useUI, isFullWindow, setDockWidth}`（`8943-8952`）。`setDockWidth` 是空函数（`864`）。

**`Panel(props)`（`8345-8895`）**

- props：`{embedded?: boolean}`。`embedded` 时：不写几何、不加拖动把手、不渲染标题/刷新/全屏/收起按钮（`8726-8770` 多处 `full || embedded ? null`）。
- 三态外壳：`full`（`location.hash === "#redteam-full"`，`826-833`）/ `embedded` / 浮动 dock。
- 判据与副作用：
  - 挂载 `POST /redteam/api {op:"bootstrap"}`（`8401-8418`）→ `engagements`，取 `r.current` 或首个作 `eng`，随后 `loadSnapshot(eng)`。
  - `eng` 变更：`loadSnapshot` → `{op:"snapshot"}`（`8368-8383`）；并启动 `consoleDigest` 轮询（**25 s**，`8520-8558`）。
  - 靶标下拉变更：`{op:"activateEngagement"}`（`8752-8757`），失败静默（`.catch(()=>{})`）。
  - 页签点击：`markTabSeen(tab)` 写 unread + `setUI({tab})` + `refreshKey+1`（`8840-8844`）。
- 失败路径：`bootstrap` 失败 → `setErr("无法连接资产库")`，整块只显示红字（`8631`）；单页渲染异常由 `RtBoundary`（`7778-7812`）兜住，显示「该页面渲染出错：<msg>」+「回到资产测绘」按钮。
- 空态：无靶标时 `!eng` 分支渲染「还没有靶标 / 输入攻防演练靶标单位名称…」+ 输入框 + 「创建靶标」（`8638-8680`）。

**页签枚举**（`8583-8594`，10 项，顺序即渲染顺序）：

```
assets 资产测绘 / env 环境适配 / agents 智能体 / sessions 会话隧道 / findings 漏洞战果
chain 攻击链 / scores 得分目标 / report 报告 / knowledge 知识库 / skills 技能库
```

**body 分发**（`8630-8712`）：`knowledge`→`KnowledgeTab`；`env`→`EnvTab`；`skills`→`SkillsTab`；`agents|prompts`→`AgentsTab`；`assets|testing`→`AssetsTab`；`sessions`→`SessionTab`；`findings|attackfiles`→`FindingsTab`；`chain`→`ChainTab`；`report`→`ReportTab`；`scores`→`ScoreTab`；其余 →「未知页签」（`8708`）。

> 13 个可分发 key，页签栏只有 10 个 → `prompts` / `testing` / `attackfiles` **无按钮可达**，只能由其它页内嵌（`AttackFilesTab` 在 `3829`、`TestingTab` 在 `2100`、`PromptsTab` 在 `7929`）。

---

## 4. 对外接口

### 4.1 HTTP：`/redteam/api`（POST，`op` 路由）

`api(req)`（`client.js:828-850`）→ `fetch(apiUrl("/redteam/api"), {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(req)})`。

**返回值契约（与 `/dsh-purge/*` 的 `apiJson` 不同）**：先 `res.text()` 再 `JSON.parse`；解析失败返回 `{ok:false, error:"<status> non-json: …"}`；`!res.ok` 时把 `data` 与 `{ok:false,error}` 合并后**resolve**。**HTTP 5xx 不会 reject**，只有网络层失败才 reject。调用方必须自己判 `r.ok === false`。

UI 侧发出的 45 个 op（43 在演练台段 + 2 在 `env-gate.js`）：

| op | 发出位置 | 入参（除 op 外） | 出参被谁消费 |
|---|---|---|---|
| `bootstrap` | `8389` `8402` `8440` | 无 | `r.engagements[]`、`r.current`；`AgentsTab` 在无 `eng` 时也用它取 `r.roles`（`7827`） |
| `snapshot` | `8376` | `engagement` | 整个 `snapshot` state：`stats` / `segments` / `tests` |
| `consoleDigest` | `8539` | `engagement` | `r.sections` → `digest`，驱动页签红点 |
| `openEngagement` | `8422` | `name` | `r.engagement.id` → `refreshList(id)` |
| `activateEngagement` | `8782` | `engagement` | 忽略返回值 |
| `assets` | `1130` | `engagement,cidr?,q?,service?,port?,provenance?,test_status?,priority?,scope?,state?,sort,limit:400` | `r.total`、`r.items[]` |
| `asset` | `1211` | `engagement,id` | `r.asset` → 详情展开区 |
| `domains` | `1190` | `engagement,cidr?` | `r.items[]` → 域名视图 |
| `web` | `1198` | `engagement,cidr?` | `r.items[]` → Web 视图 |
| `discoveryTimeline` | `2128` | 见 `DiscoveryView` | 时间线 |
| `activeTests` | `7046` | `engagement` | `TestingTab` 全量数据 |
| `prompts` | `2271` `2346` | `engagement` | `r.roles` → `PromptsTab`/`AgentsTab` |
| `savePrompt` | `2300` | `engagement,role,content` | 成功后重载 |
| `resetPrompts` | `2335` | `engagement,role?` | 成功后重载 |
| `skillCatalog` | `2482` | `refresh?` | `SkillsTab` 列表 |
| `skillRead` | `2511` | `id` | 技能正文 |
| `vulns` | `3136` | `engagement,status?,severity?,q?` | `FindingsTab` 列表 |
| `updateVuln` | `3190` | `engagement,id,patch` | 成功后重载 |
| `credentials` | `3170` | `engagement` | 凭据子页 |
| `access` | `3175` | `engagement` | 访问会话子页 |
| `attackFiles` | `3180` `5039` | `engagement` | 文件列表 |
| `readAttackFile` | `5062` | `engagement,path` | 文件正文 |
| `scoreChain` | `3867` `4425` | `engagement` | `ChainTab` / `ReportTab` 共用 |
| `scoreReport` | `4417` | `engagement` | 报告 markdown |
| `scores` | `6345` | `engagement` | `ScoreTab` 全量 |
| `saveScorePoint` | `6393` | `engagement,point` | 成功后重载 |
| `deleteScorePoint` | `6423` | `engagement,id` | 成功后重载 |
| `pocSearch` | `5289` | `q?,category?,source?,verified?,page?,templateOffset?` | `KnowledgeTab` 列表 + `tpl` 分页 |
| `pocGet` | `5324` | `id` | 正文 |
| `pocUse` | `5343` | `id` | 复用计数 |
| `platformConfigGet` | `5880` | 无 | `EnvTab` 全部表单初值 |
| `platformConfigSave` | `5913` | `config` | 保存结果 |
| `platformAssignToolkit` | `5942` | `folder` | `r.assigned` 数量 |
| `sessions` | `7333` | `engagement` | `SessionTab` 全量 |
| `probeSessions` | `7349` | `engagement,timeoutMs:6000` | 在线/可用计数 |
| `updateTunnel` | `7385` | `engagement,id,patch:{status,check_note}` | 成功后重载 |
| `updateWebshell` | `7397` | 同上 | 同上 |
| `agentsStatus` | `7842` | 无 | `r.used`、`r.max`、`r.source` |
| `setAgentsMax` | `7951` | `max` | 并发上限 |
| `updateCheck` | `8064` | 无 | `r.current/latest/updateAvailable/blockers/notes/install.mode` |
| `version` | `8069` `8084` | 无 | 同上（降级用） |
| `updateApply` | `8101` | `target` | `r.installed` |
| `shotData` | `910` | `engagement,id` | `r.base64`、`r.mime` → dataURL |
| `platformEnvAdaptStatus` | `15188` | 无 | `r.ready`、`r.skipped`、`r.message` |
| `platformEnvAdaptSkip` | `15410` | `skip:true` | 直接置缓存 ready |

### 4.2 HTTP：`/dsh-purge/*`

| 方法 路径 | 入参 | 出参 | 调用方（行号） |
|---|---|---|---|
| `GET /dsh-purge/status` | — | `ok,ai_base,compatibility{level,host_version,message},patches_applied,patches_total,patches_na,patches_total_all,plugin_version,patch_rows[],patch_status{},patch_names{},patch_files{},patches[],asar_still_sealed,host_layout{},asar_handoff{phase,error,detail},desktop_exe,desktop_install,surface,patches_lost,override_status,skills[],channel,update{},ready` | `13959` `11445` `11045`（重启轮询）`12748`（技能闸门） |
| `POST /dsh-purge/apply` | `{content}` | `ok,complete,defaultContent,override_content,restarting,needs_full_quit,manualQuit,needPrompt,injectSource,cli_repair` | `11539` |
| `POST /dsh-purge/revert` | `{}` | 同上（无 `content`） | `11539` |
| `POST /dsh-purge/uninstall` | `{}` | `ok,note,surface,fullApp` | `11762` |
| `POST /dsh-purge/restart` | `{}` | `ok,surface,fullApp,already,restarting,manualQuit,note,error` | `11091` |
| `GET /dsh-purge/override` | — | `ok,content,defaultContent` | `11489` |
| `POST /dsh-purge/override` | `{content}` | `ok,content,needPrompt,injectSource` | `11634` `11698` |
| `GET /dsh-purge/own-servers` | — | `ok,content` | `11510` |
| `POST /dsh-purge/own-servers` | `{content}` | `ok,content,dropped` | `11668` |
| `GET /dsh-purge/boost` | — | `ok,enabled,rewind,permissionPatches,contextManagement` | `13109` `10540` `10193` |
| `POST /dsh-purge/boost` | `{enabled}` / `{rewind}` / `{permissionPatches}` / `{contextManagement}` | 回显同名字段 | `13116` `10202` `10568` |
| `GET /dsh-purge/selfcheck` | — | `ok,layers[{title,state,ok,applicable,applied,required,total,pending[],note}]` | `13108` `13130` |
| `POST /dsh-purge/probe` | `{}` | `message` | `13209` |
| `GET /dsh-purge/hooks-deny` | — | `ztgfhFrdiIrnpkl` | `10934` |
| `POST /dsh-purge/hooks-deny` | `{hooksDenyBypass}` | `ztgfhFrdiIrnpkl` | `10945` |
| `GET /dsh-purge/update` | — | `ok,channel,localVersion,localSha,remoteVersion,remoteSha,hasUpdate,pinned,pin,versions[],lanes{},error` | `11317` `11482` |
| `POST /dsh-purge/update` | `{op:"apply",ref,channel}` / `{op:"channel",channel}` / `{op:"switch",ref}` | 同上 + `applied,reloadClient,needRestart,needsFullQuit,restartAfter` | `11339` |
| `GET /dsh-purge/community` | — | `ok,backups[{id,created_at,plugins[{version}]}],update_preferences{},update_status{},errors[]` | `13584` |
| `POST /dsh-purge/community` | `{op,id,ref}`（`check`/`backup`/`rollback`/`update`）；`{op:"preferences",value}` | `ok,versions[],hasUpdate,remoteVersion,degraded,stale,error,id,note,applied,skipped,needRestart,restart_required,release{},cleanup_warnings[],update_preferences` | `13292` `13427` `13631` |
| `GET /dsh-purge/audit?limit=10` | query `limit` | `entries[{at,event,pid,...}]` | `13696` |
| `POST /dsh-purge/rules` | `{op,...}`，`op ∈ {status,read,save,activate,delete,reset,set-policy,scan-cwd,toggle-cwd}` | `ok,rules[{id,name,target,size}],active,workspace_policy,workspace_policies[],cwd,cwd_candidates[{path,name,scope,size,selected,preview}],content,error` | `249`（`rulesApi`） |
| `POST /dsh-purge/skills`（404/405 回落 `/dsh-purge/skill`） | `{op,...}`，`op ∈ {status,read,save,delete,import}` | `ok,skills[{id,description,size,valid,userInvocable,modelInvocable}],content,imported[]` | `259`（`skillsApi`） |
| `GET /dsh-purge/drill-grant` | — | `ok,granted` | `9016` |
| `POST /dsh-purge/drill-grant` | `{}` | `granted` | `8986` |
| `GET /dsh-purge/rewind` | — | `sessionId,parentId,at,text` | `14933` |
| `POST /dsh-purge/rewind` | `{sessionId,mode}` | `ok,sessionId,at,text,cleared,error` | `14721` `14856` |
| `GET /dsh-purge/last-user?sessionId=` | query `sessionId` | `text` | `14468` |
| `GET /` | — | 任意 2xx | `11722`（卸载后探活） |

超时矩阵（`apiTimeoutMs`，`client.js:152-168`）：`community` POST 600 s / GET 20 s；`update` POST 180 s / GET 45 s；`uninstall` 90 s；`skill*` POST 120 s / GET 20 s；`status` 60 s；`apply` 240 s；`revert` 120 s；`restart` 60 s；**默认 20 s**。超时抛 `Error("timeout")`（`client.js:213`）。

### 4.3 slot 注册（6 个）

| slot | 注册参数 | 组件 | 宿主 slot 声明 |
|---|---|---|---|
| `shell.overlay` | `{id:"dsh-purge-panel-overlays", order:60}`（`15541-15550`） | `PanelOverlays` | `{kind:"list",scope:"root"}` |
| `sidebar.panellist` | `{id:"dsh-purge", order:30, label:"Purge"}`（`15552-15563`） | `PurgeGlyphIcon` | `{kind:"list",scope:"root"}`；宿主取 `options.id/order/label` 组成列表项 |
| `main` | `{key:"dsh-purge"}`（`15565-15574`） | `PurgePage` | `{kind:"keyed",scope:"root"}` |
| `plugins.bundle.config` | `{key:"dsh-purge-community"}`（`15576-15585`） | `DetailSettings` | `{kind:"keyed",scope:"root"}`；宿主 `entryKey: pkg.name` |
| `plugins.row.config` | `{key:"dsh-purge-community#dsh-purge"}`（`15587-15597`） | `DetailSettings` | `{kind:"keyed",scope:"root"}`；宿主 `entryKey: bundleDetailKey(name,version,language)` / `registryKey(...)` |
| `conversation.input.right` | `{id:"dsh-purge-rewind", order:20}`（`14955-14964`） | `RewindSafe` | `{kind:"list",scope:"session"}` |

`[静态]` 宿主 slot 声明来自 `@deepseek-ai/dsh-client-ui-layout/lib/client.js`（`"main":{kind:'keyed'}`、`shell.overlay`）、`dsh-client-ui-sidebar`（`sidebar.panellist`）、`dsh-client-ui-conversation`（`conversation.input.right`）、`dsh-client-ui-plugin-manager`（`plugins.bundle.config` / `plugins.row.config`）。

### 4.4 无 CLI / 无 agent 工具 / 无事件订阅

本模块不注册 CLI 命令、不注册 `redteam_*` 工具、不 `ctx.on` 任何宿主事件（`[实测]` `grep -c "ctx.on(" client.js` = 0）。它只消费宿主 store（`sessions` / `uiWorkspace` / `conversation` / `remote.agentPresets`）的快照。

---

## 5. UI 触点

### 5.1 顶层 6 页签（`TABS`，`client.js:13805-13812`）

| id | 标签 | 副标题 | 渲染器 |
|---|---|---|---|
| `status` | 状态 | 宿主兼容、补丁、破甲自检 | `StatusStrip` + `PurgifySection{page:"status"}` + `StatusExtras` + `CommunityMaintenance`（`14026-14031`） |
| `prompt` | 提示词 | 注入正文与破甲强化段 | `PurgifySection{page:"prompt"}`（`14033-14036`） |
| `rules` | 规则 | 规则集与工作区策略 | `RulesSection`（`14037-14040`） |
| `skills` | 技能 | DSH 技能目录 | `SkillsSection`（`14041-14044`） |
| `drill` | 演练台 | 红队演练与环境适配 | `__dshPurgeDrill.Panel{embedded:true}` 或授权卡（`14055-14075`） |
| `more` | 更多 | 会话外观与服务器设置 | `RewindSetting` + `PurgifySection{page:"more"}`（`14046-14053`） |

页签栏为 `<nav role="tablist">` + 6 个 `<button role="tab" aria-selected>`（`14009-14024`）。

#### 5.1.1 状态页区块

| 组件 | 文件:行 | 依赖 op | 展示字段 | 交互 |
|---|---|---|---|---|
| `StatusStrip` | `13829-13884` | 无（吃 `info`） | `compatibility.host_version`、`compatibility.level`（`qualified` 绿点 / 其他黄点 / 空灰点）、`patches_applied/patches_total`、`patches_na`、`plugin_version` | 4 个 `HelpTip`（`?` 悬浮说明）；无按钮 |
| `VersionNotice` | `13934-13949` | 无 | `info.ok === false` → 红字「状态读取失败：…」；`info.plugin_version !== "1.7.20"` → 黄字「官方版本 X；界面 1.7.20」 | 无 |
| `LayoutNotice` | `13885-13933` | 无 | `asar_still_sealed`、`host_layout.family === "tauri"`、`asar_handoff.phase`（13 种 phase → 中文句）、`asar_handoff.detail`、`win32_code` | 全部折叠在 `<details>`；「已从解包目录启动」时 summary 显示 ✓ |
| `PurgifySection{status}` 标题行 | `11926-11985` | — | `status.title`、扫描时间 | 「应用」`dshpp-btn-apply`（附待应用条数 `counts.pending`）、「还原」danger、「卸载」solid-danger、「刷新」`dshpp-scan`（显示 `scan.recent{time}`） |
| `PatchHealth` | `10425-10494` | 无 | 大数字 `applied / denom`、`verdict`（pending>0 → `health.verdict.pending`，否则 `.ok`）、三段进度条 `.is-ok/.is-wait/.is-off`、4 个 `Tile`（applied/pending/off/na） | 无按钮；每个 Tile 带 `HelpTip` |
| `PatchGroupSwitches` | `10533-10630` | `GET/POST /dsh-purge/boost` | 两个 `Switch`：`permissionPatches`（14 个 patch id，`10318-10333`）、`contextManagement`（2 个，#18/#19，`10334`）；chip 文案 `sw.chip.on{n,written,pending}` / `sw.chip.off{n}` | 点开关 → `toggle(key)`；`is-on` 时卡片左侧 `inset 3px` 高亮 |
| `PatchGroups` | `10633-10802` | 无 | 过滤条 `FILTERS = ["all","pending","off","na"]`（`10632`）+ 计数；分组标题 `group.<key>`、`applied / denom`、4 个状态胶囊；表头 `#` / `table.patch` / `table.status`；每行 `#id`、中文名（`t("patch."+id)`，缺键回落 `r.name`）、英文标识符 `.dshpp-row-en`、非 applied 行追加 `hint.<st>` 说明、`Pill`、`partial` 行追加 `status.partialDetail{done,total}` | 点分组头折叠（`open` 初始 `{code:true}`）；点过滤按钮切换 `filter`；`state.ok === false` → `groups.unreadable`；无 `patch_status` → 骨架屏 |
| `PatchApplySteps` | `10804-10826` | 无 | 3 步流程图 `steps.1/2/3` + `steps.foot` | 纯静态 |
| `HooksDenySection` | `10928-10996` | `GET/POST /dsh-purge/hooks-deny` | 标题 + 说明 + 单个 checkbox「旁路 hooks 拒绝」 | 折叠在状态页底部 `<details><summary>高级选项</summary>`（`12001-12004`） |
| 卸载确认弹窗 | `12008-12053` | `POST /dsh-purge/uninstall` | `uninstall.title/body` | 遮罩点击（非忙碌）关闭；`solid-danger` 确认 |
| `RestartAsk` | `11000-11043` | 无 | `restart.ask.title/body` | `createPortal` 到 `document.body`；「稍后」/「立即重启」；`data-theme` 由 `detectHostTheme()` 决定 |
| `StatusExtras` | `13102-13244` | `selfcheck` / `boost` / `probe` | 「破甲自检」行：状态点 + `N 层未生效` / `N 条待应用` / `N 层需确认` / `N 层全部在位`；逐层 `<details>` 网格（每层：点 + 名称 + `applicable===false?"不适用"` / `待应用 #a/#b` / `宿主推导` / `未确认` / `applied/required`）；「破甲强化段」行 | 「重测」「探针」「开启/关闭」 |
| `CommunityMaintenance` | `13571-13802` | 见 3.12 | 「维护：更新与本地备份」+ 本机版本徽章；通道摘要（代理地址 / 密钥是否配置）；`UpdatePreferences`；「检查社区版更新」「最近动作」「发行记录」外链；发行下拉 + 「安装所选版本」；「本地备份」+ 「刷新备份列表」+ 「立即备份」+ 备份下拉 + 「回滚插件」 | 见 3.12；回滚/安装都有 `window.confirm` |

#### 5.1.2 提示词页

| 组件 | 文件:行 | op | 字段 | 交互 |
|---|---|---|---|---|
| `PurgifySection{page:"prompt"}` | `12098-12166` | `GET/POST /dsh-purge/override` | 单 `<textarea class="dshpp-area" aria-label="提示词内容">`，`disabled` 直到 `overrideLoaded`；空值时下方红字 `need.prompt` | 「保存注入」primary tiny、「恢复默认」tiny（`!defaultOverride` 时禁用） |

#### 5.1.3 规则页

| 组件 | 文件:行 | op | 字段 | 交互 |
|---|---|---|---|---|
| 标题行 | `12462-12484` | `reset` | `rules.title` + notice | 「恢复默认」danger tiny（先 confirm） |
| 工作区策略 | `12486-12506` | `set-policy` | `<label for="dshpp-policy-select">` + `<select>`；选项来自 `workspace_policies`，空则 `["fallback","strict","always"]` | 变更即提交 |
| 工作区扫描 | `12508-12569` | `scan-cwd` / `toggle-cwd` | 当前 `cwd` 路径；候选列表每项：checkbox、`name`、`scope` 徽章（`cwd.scope.<scope>`）、`formatSize(size)`、`path`、`preview` | 「重新扫描」；勾选即提交；空态 `cwd.no.workspace` / `cwd.empty` |
| 规则列表 | `12361-12446` | `read` / `activate` / `delete` | 每行：`ruleLabel(r)`（`name (id)` 或 `id`）、当前项绿胶囊 `pill.current`、`target · formatSize(size)` | 整行 `role=button`（Enter/Space 亦可）；行内「使用」（当前项禁用）/「删除」（confirm） |
| 新建行 | `12578-12641` | `save` | 三个输入：`ph.id`、`ph.alias`、`TARGETS=["AGENTS.md","CLAUDE.md"]` 下拉 | 「新建」；id 为空 → `need.id` |
| 编辑器 | `12643-12702` | `save` | 别名输入 + target 下拉 + `<textarea>` + 保存 | 未选中时显示 `rules.pick` |

#### 5.1.4 技能页

| 组件 | 文件:行 | op | 字段 | 交互 |
|---|---|---|---|---|
| 闸门 | `12707-12719` / `12890` | — | 版本不符时**整块不渲染** | — |
| 列表 | `12894-12961` | `read` / `delete` | 每行：`item.id`、`(valid?description:skills.invalid) · formatSize`、第二行「`/id` 或 `skills.call.userOff` · `skills.call.model` 或 `modelOff`」 | 整行点击读正文；「删除」（confirm `confirm.delete.skill`） |
| 导入 | `12989-13041` | `import` | 两个隐藏 `<input type=file>`：zip（`accept=".zip,.tgz,.tar.gz,.tar,.skill"`）、文件夹（`webkitdirectory` + `multiple`） | 「导入 zip」/「导入文件夹」 |
| 编辑器 | `13043-13088` | `save` | 描述输入 + `<textarea>` | 「保存技能」；未选中 `skills.pick` |

#### 5.1.5 演练台页

`tab === "drill"` 时：已授权 → `h("style",{"data-dsh-purge-drill":"1"}, __dshPurgeDrill.CSS)` + `h(__dshPurgeDrill.Panel,{embedded:true})`（`14055-14060`）；未授权 → 卡片「演练台需要先完成一次授权。」+「去授权」（`14062-14074`）。

#### 5.1.6 更多页

| 组件 | 文件:行 | op | 字段 | 交互 |
|---|---|---|---|---|
| `RewindSetting` | `10213-10281` | `GET/POST /dsh-purge/boost` | `<section class="dshpp-composer-settings">` + `<h3>rewind.settings` + 一个 `role="switch"` checkbox | 勾选即存；读取失败时显示错误 + 「重新读取」按钮 |
| `PurgifySection{page:"more"}` | `12169-12205` | `GET/POST /dsh-purge/own-servers` | `<textarea rows=4 style="minHeight:96">` + 提示 `own.hint` | 「保存」primary tiny |

### 5.2 演练台 10 页签

公共件：`clickable()`（`1012-1031`）给任意 div 加 `role=button/tabIndex=0/Enter|Space`；`useCollapse(prefix)`（`6927-6949`）读写 `rt-collapse:<prefix>`；`Clip`（`6982-7029`）「复制 / 展开」文本块；`Section`（`6951-6980`）**未被使用**。

| 页签 | 组件 | 行号 | 依赖 op | 结构 | 空态文案 |
|---|---|---|---|---|---|
| 资产测绘 | `AssetsTab` | `1094-2118` | `assets` `asset` `domains` `web` `discoveryTimeline`(经 `DiscoveryView`) | 左侧 `rt-side`：`全部 C 段`（`N 个网段`）、`当前测试`、按 `scope` 分组的 `外网资产`/`内网资产`（每组可折叠，头显示 `N 个 C 段` + `M 资产`）；右侧工具栏（搜索 / 服务 / 端口 / 内外网 / 来源 / 易打性 / 测试状态 / 刷新 / 5 个视图按钮）+ 结论条 `rt-concl`（台资产·存活·待测·测试中·已测·放弃 + 排序下拉）+ 表 | 表头 5 列 `IP / 易打 / 测试状态 / 开放端口 / 服务 / 指纹`；行展开后 `展开全部（端口 · 指纹 · 采集溯源 · 测试记录）▼` | 列表 `没有匹配的资产`；域名 `暂无域名数据（信息收集阶段会写入域名）` / `该 C 段下暂无域名（切换到「全部 C 段」看全量）`；Web `暂无 Web 资产（HTTP 探测后会写入 URL 与标题）` / `该 C 段下暂无 Web 资产`；加载中 `加载中…` |
| 资产时间线 | `DiscoveryView` | `2119-2261` | `discoveryTimeline` | 按天统计条 + 最近发现列表 | `还没有资产。` / `这一天没有新增资产。` / `加载失败` |
| 当前测试 | `TestingTab` | `7032-7322` | `activeTests` | 工具栏：`实时 · 5s` 开关（`auto`）、`全部展开/收起`、`刷新`；三块：正在测 / 待测队列 / 最近动过 | `当前没有资产处于「测试中」`、`没有待测资产`、`暂无`、`加载中…`、`读取失败` |
| 环境适配 | `EnvTab` | `5853-6332` | `platformConfigGet` `platformConfigSave` `platformAssignToolkit` | 表单：`platform`（`auto` 跟随本机）、`toolkitDir`、`nucleiTemplatesDir`、`binDirs`（每行一个）、`tools{}` 逐工具可执行文件、`env{FOFA_KEY,REDTEAM_VPS_HOST,REDTEAM_VPS_KEY}`、`notes`；另有「整包文件夹 → 自动分配工具」 | `待配置`、`未找到（可留空等装好）`、`(空)`、`扫描中…`、`读取中…`、`读取失败`、`自动分配失败`、`请先填写工具所在文件夹路径` |
| 智能体 | `AgentsTab` | `7815-7932` | `prompts`（有 eng）/ `bootstrap`（无 eng）+ `agentsStatus` | 工具栏：`并发上限 N`、`在跑 x / 剩余 y`（`used>=max` 转 warn 色）、`刷新`；卡片「并发规则（硬约束）」3 条、「六个角色」6 条、`ConcurrencyCard`、「角色提示词（按靶标存）」内嵌 `PromptsTab` | `占用未知`、`读取中…`、`读取失败` |
| 并发上限 | `ConcurrencyCard` | `7934-8038` | `setAgentsMax` | 数字输入 + `范围 1 – MAX` + `环境变量 REDTEAM_MAX_AGENTS` 说明 + `来源：面板中设置/默认值` | `保存中…`、`保存失败`、`已保存：并发上限 N` |
| 角色提示词 | `PromptsTab` | `2262-2468` | `prompts` `savePrompt` `resetPrompts` | 4 个角色（`ROLE_LABEL`，`895-902`）各一个 `<textarea>`；`保存后写入 agents/` 提示 | `当前为内置默认提示词（创建靶标后可按靶标保存修改）`、`请先创建靶标，再保存提示词`、`请先创建靶标，再恢复默认提示词`、`（空）`、`读取失败` |
| 会话隧道 | `SessionTab` | `7323-7777` | `sessions` `probeSessions` `updateTunnel` `updateWebshell` | 两张表：目标侧入口（WebShell）与目标侧通道（隧道）；`检测连通性`（6 s 超时）、`标记可用/标记失效`、复制 URL / 复制 fscan 命令 / 复制 gogo 命令 | `暂无（拿到 WebShell 后用 redteam_webshell_add 登记）`、`暂无（建好隧道后用 redteam_tunnel_add 登记）`、`还没有登记任何 WebShell 或隧道。`、`还没有可用的 suo5 隧道（打进内网的标准通道）`、`未声明 entry_kind，待确认`、`未检测`、`检测中…`、`检测失败`、`读取失败` |
| 漏洞战果 | `FindingsTab` | `3111-3846` | `vulns` `updateVuln` `credentials` `access` `attackFiles` | 子页签 `vulns 漏洞 / files 攻击文件 / creds 凭据 / access 访问会话`（`3770-3775`）；`vulns` 内可切「平铺列表 / 按目标聚合」（`3799-3807`） | `暂无漏洞记录`、`暂无凭据（拿到口令/密钥/Hash 后用 redteam_credential_add 落库，秒级可复用）`、`该模块的宿主代码已更新，需重启一次当前宿主（官方 exe / 社区版 / dsh web）后生效` |
| 攻击文件 | `AttackFilesTab` | `5028-5234` | `attackFiles` `readAttackFile` | 按 `attack-files/<IP\|URL主机\|C段>/` 目录组织；路径 + 效果 + 记录 | `暂无攻击文件（打通的脚本/POC/EXP 会按目标文件夹出现在这里）`、`读取失败`、`（空）` |
| 攻击链 | `ChainTab` | `3856-4370` | `scoreChain` | `STAGE_LABEL` 7 阶段（`3853-3861`）；`链路 A`（竖向）/`链路 B`（横向）切换；顶部 `总分 N 分` | `还没有得分记录。拿到成果后用 redteam_score_hit 记分，这条链才会长出来。`、`本阶段还没有得分`、`还没有产生得分的资产`、`还没有建立隧道（建好后用 redteam_tunnel_add 登记）`、`加载中…`、`读取失败` |
| 得分目标 | `ScoreTab` | `6333-6910` | `scores` `saveScorePoint` `deleteScorePoint` | 工具栏：`总分`、`N 个得分点`、`命中 M 次`、`自建不计分 N`、`服务已拿满不计分 N`、`+ 新增得分点`、`刷新`；列表按分值升序；表单字段 `name`（必填）/`category`/`points`/`description`/`enabled`/`builtin` | `暂无得分点，点右上角「新增得分点」`、`还没有 —— 拿下成果后用 redteam_score_hit 记分：写明目标资产 + 拿到的账号密码/权限`、`名称不能为空`、`保存失败`、`删除失败`、`读取失败` |
| 报告 | `ReportTab` | `4405-5020` | `scoreReport` `scoreChain` | `groupByStage`（`4371-4404`）把报告项按 7 阶段分组；每条可展开「复现步骤」+ `Clip` 原始请求 + 「复制到 Yakit」；顶部「下载 .md」 | `还没有可交付的成果。`、`复现材料待补`、`⚠️ 这一项没有原始请求记录，无法直接复现 —— 请用 redteam_http_evidence_add 补上`、`生成中…`、`生成失败`、`加载中…` |
| 知识库 | `KnowledgeTab` | `5249-5852` | `pocSearch` `pocGet` `pocUse` | 工具栏：检索框、类型/来源/归类下拉、`只看已验证`、`按归类分组/平铺显示`、`刷新`；归类总览 `rt-kb-cats`（点即筛选）；本机 nuclei 模板区（`templateOffset` 分页）；条目详情（正文 + 用法 + 来源 + `记一次复用`） | `没有命中：换个关键字再试，或去互联网找 / 自己手搓后回填。`、`知识库还是空的（本机模板目录存在但没有 yaml，请跑 nuclei -update-templates）。`、`POC/EXP 库还是空的；本机已有 N 个 nuclei 模板，但这一页没有列出来。请完全退出后重新打开客户端。`、`这条只有元数据，没有正文 —— 拿到正文后用 redteam_poc_update 补上`、`读取中…`、`读取失败` |
| 技能库 | `SkillsTab` | `2469-2959` | `skillCatalog` `skillRead` | 左列表（可用/不可用/未知 + 官方/红队/本插件自带）+ 右详情（描述、来源、何时使用、缺口、文件）；`只看不可用/未知`、`只看有明确缺口`、`只看本插件自带` 三个过滤器；`重查可用性` 跳 30 s 缓存 | `左侧选择技能查看内容`、`（无描述）`、`（空）`、`读取失败`、`该模块的宿主代码已更新，需重启一次当前宿主…` |
| 版本条 | `VersionBar` | `8039-8280` | `updateCheck` `version` `updateApply` | `v<current>` 标签（`title` 内含最新版本/安装方式/检查失败原因）；有新版本时变 warn 色并出现「有新版本 v<latest>」按钮 → 弹窗「更新 RedTeam 模式」+ `blockers[]` + 「一键更新并重启」 | `检查中…`、`检查更新失败`、`更新中…`、`更新失败`、`现在不能更新：…`、`开发态安装请用仓库流程升级`、`已安装 X，正在重启当前宿主…`、`宿主正在重启，N 秒后自动刷新页面…` |

### 5.3 侧栏与快捷入口

| 挂载点 | 渲染 | 行为 |
|---|---|---|
| `sidebar.panellist`（`id:"dsh-purge"`, `label:"Purge"`, `order:30`） | `PurgeGlyphIcon`：`<span aria-hidden>` 用 `sidebar_glyph_default`（base64 PNG）作 `mask-image`，`backgroundColor: currentColor`（`15484-15500`） | 宿主 sidebar 把 `options.id/order/label` 收成列表项；点击选中 `main` 面板 `key="dsh-purge"` |
| `main`（`key:"dsh-purge"`） | `PurgePage` | 整页 6 页签面板 |
| `plugins.bundle.config`（`key:"dsh-purge-community"`） | `DetailSettings{view}` | `view==="summary"` → 纯文本 `"Purge · 1.7.20"`；否则 `<div class="dshpp-detail-settings">` 包 `PurgePage`（`15501-15504`） |
| `plugins.row.config`（`key:"dsh-purge-community#dsh-purge"`） | `DetailSettings` | 同上，但见 8.2 —— key 形状与宿主 `entryKey` 不匹配 |
| `shell.overlay`（`id:"dsh-purge-panel-overlays"`, `order:60`） | `PanelOverlays`（`15506-15520`）：`<style>{base_default}` + `WelcomeNotice` + `EnvAdaptSendGate` + `authOpen && AuthGate` | 首启法务弹窗、发送闸门、授权弹窗三个全局浮层 |
| `conversation.input.right`（`id:"dsh-purge-rewind"`, `order:20`） | `RewindSafe`（`14781-14813`）：`RewindDraftSync`（无 UI）+ `visible && (failed ? RewindFallback : RewindButton)` | 「回退」按钮 + 菜单（`回退一次` / `回退上一轮`）；`createPortal` 定位，`ResizeObserver` + `visualViewport` 跟随（`14566-14615`） |

**全局 DOM 副作用**（不属于任何 slot）：

1. `installLegacyVisibility`（`14193-14202`）：`<style data-dsh-purge-panel-visibility="1">` 注入 `document.head`，隐藏 `.dshp-launch,.dshp-hero-chip,.dshp-tab-chip,.dshp-dock`。
2. `bindPresetMenu`（`14092-14190`）：捕获阶段 `click` 监听，给 preset 菜单里的 `unrestricted-child-<10hex>` 历史别名行打 `data-purge-collapsed-alias` + `disabled`，仅当同描述的正规子任务行存在时。
3. `EnvAdaptSendGate`：包装 `shell.submit`、拦截 `pointerdown/click/keydown`（见 3.17）。
4. `welcome_default` CSS 内联在 `WelcomeNotice` 里（`14994`），不依赖任何外部样式表。

---

## 6. 依赖

### 6.1 内部

- `client.js` 内部各段共享 3 个全局：`h`（`45-49`）、`translate`/`useT`（`9118-9126`）、`apiJson`/`apiUrl`（`97-270`）。
- 演练台段只用 `apiUrl`（`834`）与 `import_react2`，**不引用外壳任何组件**；反向也只有 `PurgePage` 引用 `__dshPurgeDrill.Panel/.CSS`（`14056-14059`）与 `setUI`（`9082`、`10149`）。
- `dock.js` 与 `page.js` 通过 `dockBus` 单向耦合（`9047-9070` / `14066`、`14071`）。

### 6.2 宿主 API / RPC / slot

| 宿主能力 | 使用方式 | 公开 API？ |
|---|---|---|
| `ctx.slots.register` / `ctx.slots.inject` | 6 处注册（`14955`、`15541-15597`） | 公开 |
| `ctx.locale.register` / `ctx.locale.bind` | `NS = "settings.dsh-purge-panel"`（`9118`、`15537-15539`） | 公开 |
| `ctx.effect` | 4 处（`15522`、`15532`、`14966`、`15537`） | 公开 |
| `ctx.inject(["sessions","uiWorkspace"])` | `bindSessionContext`（`15523`） | 公开 |
| `ctx.inject(["remote","remote.agentPresets"])` | `bindPresetMenu` 的数据源（`15526-15531`） | 公开 |
| `ctx.inject(["sessions","uiWorkspace","conversation"])` | `installRewindUi`（`15533-15536`） | 公开 |
| `sessions.list.getSnapshot()` / `sessions.scope(id)` / `sessions.sessionOf(scope)` | `clientCurrentCwd`（`12250-12265`）、`isRedteamModeActive`（`15106-15153`）、`sessionKnown`（`14261-14271`） | 公开（快照只读） |
| `uiWorkspace.selection.getSnapshot().sessionId` | `currentSessionId`（`14248-14260`） | 公开 |
| `conversation` 输入框 shell（`shell.submit` / `shell.actions.submit`） | **直接改写宿主对象的属性**（`15289-15303`），卸载时还原（`15311-15327`） | **非公开**：靠 `conversationInput(sid)` 反射拿到内部对象 |
| DOM 反射：`[data-composer-card]`、`[data-composer-seat]`、`[contenteditable='true']`、`[data-agent-preset='redteam']`、`[role="menu"]`、`[class$="_seatLabel"]` | `isRedteamModeActive`（`15125-15152`）、`looksLikeSendControl`（`15155-15184`）、`bindPresetMenu`（`14101-14106`） | **非公开**：依赖宿主 CSS module 类名后缀与 `data-*` 约定 |
| `react` / `react-dom`（`createPortal`） | `require("react")`（`272`）、`require("react-dom")`（`9115`、`10999`、`14204`） | 平台 seed 提供 |

### 6.3 外部

| 类型 | 目标 | 位置 |
|---|---|---|
| 网络 | `POST <base>/redteam/api` | `834` |
| 网络 | `<base>/dsh-purge/*`（23 条路由，见 4.2） | 见 4.2 行号 |
| 网络 | `GET <base>/`（卸载后探活） | `11722` |
| 外链 | `https://github.com/kingcharleslzy-ai/dsh-purge/releases`（「发行记录」） | `13711` |
| 外链 | `props.repo`（`PanelOverlays` 传 `https://github.com/kingcharleslzy-ai/dsh-purge`） | `15514-15516` |
| 子进程 | 无 | — |
| 文件系统 | 无（全部经 HTTP） | — |
| 剪贴板 | `navigator.clipboard.writeText` + `document.execCommand("copy")` 兜底 | `1032-1058` |

`apiUrl(p)`（`client.js:124-149`）的 base 推导：取 `__PURGE_MODULE_URL__`（`client.js:3`）的 `pathname`，截到 `/plugins/` 之后一级作 base；若与页面不同源则退到 `document.baseURI`；再不行用 `location.href`。**这是相对路径能打对的关键**。

---

## 7. 与另一版的差异

**此处 community 与 safe 的 UI 差异我未查。**

本节只回答任务第 7 问的「两处 `client.js` 的关系」——即 community 内部 `client.js` 与 `lib/redteam/client.js` 的关系：

| 维度 | `client.js`（`// src/vendor/drill.js`，271–8957） | `lib/redteam/client.js` | 差异性质 |
|---|---|---|---|
| 物理形态 | 已内嵌 + 已过 bundler（双引号、行被拆开），8,687 行 | 手写源（单引号、紧凑），4,218 行 | 同一份代码的不同格式化 |
| 组件集合 | 34 个 | 34 个 | **完全相同**（`[实测]` 名称集合双向差集皆为空，除 `applyDrillParts` 只存在于 bundle） |
| `op:` 字面量 | 50 次出现 / **43 唯一** | 50 次出现 / **43 唯一** | **完全相同**，集合逐一相等（`[实测]`） |
| `api()` 实现 | `fetch(apiUrl('/redteam/api'), …)` + `res.text()` + `JSON.parse` + 非 JSON 兜底 + `!res.ok` 合并 error（`828-850`） | `fetch('/redteam/api', …).then(res => res.json())`（`lib/redteam/client.js:618` 附近） | **重写**：bundle 版多了 base URL 推导与非 JSON 容错 |
| `.rt-btn-primary` 配色 | `background: var(--dsw-alias-label-primary,#111)` / `color: var(--dsw-alias-bg-base,#fff)` + 前置注释「brand-primary 在深色主题下是近白色（#f9fafb），当底色配 #fff 会白底白字」（`client.js:301-303`） | `background: var(--dsw-alias-brand-primary)` / `color:#fff`（`lib/redteam/client.js:46`） | **重写**：bundle 版做了品牌中性化 |
| 模块 id | `window.__ModuleLoader__.load({id:"dsh-purge-community", …})`（`client.js:3`） | `{id:'dsh-purge'}`（`lib/redteam/client.js:9`） | 占位符，源文件不参与加载 |
| 装配入口 | `applyDrillParts()` 返回 `{CSS, Panel, setUI, useUI, isFullWindow, setDockWidth}`（`8943-8952`） | `exports.apply = apply` / `exports.inject = inject`（由 `build-client.mjs` 替换掉） | 构建期改写 |

**结论：改一处不够，但只有 `client.js` 会生效。**

- 宿主只加载 `client.js`（`package.json:12`）。改 `lib/redteam/client.js` 在**当前安装状态下零效果**。
- 但仓库的构建链是 `scripts/build-client.mjs` 从 `lib/redteam/client.js` 抽片段写回 `client.js`（`build-client.mjs:12`、`52-74`）。若按仓库流程重建，`lib/redteam/client.js` 的旧内容会**覆盖** `client.js` 里已修好的 `apiUrl()` 与品牌中性化 CSS。
- 实测证据：`lib/redteam/client.js` 里的 `api()` 仍是无 base 推导的 `fetch('/redteam/api')`，而 `client.js:828` 已是 `apiUrl(...)`。两份已经漂移，且 `client.js` 是较新的一侧。
- 因此：**只改 UI 行为 → 改 `client.js`；同时要保住仓库构建链 → 两处同改**。

---

## 8. 风险与脆弱点

| 风险 | 触发条件 | 后果 | 是否可静态检出 |
|---|---|---|---|
| `plugins.row.config` 的 key 形状与宿主不符 | 宿主 `renderSlot('plugins.row.config', …, {entryKey: bundleDetailKey(name,version,language)})`（`dsh-client-ui-plugin-manager/lib/client.js`），而插件注册 key 是 `"dsh-purge-community#dsh-purge"`（`client.js:15592`） | 该 slot 永远匹配不上 → `DetailSettings` 在插件行内不渲染；且它只在 `description` 为空时作兜底，实际影响被进一步掩盖 | 是 |
| `dshpp-pill is-muted` 无对应样式 | `statusKind("disabled")` 返回 `"muted"`（`10290`）→ `Pill` 渲染 `dshpp-pill is-muted`（`10858`）；`PatchGroups` 分组头也硬写 `dshpp-pill is-muted`（`10734`）。全文件只有 `.is-ok/.is-wait/.is-miss/.is-bad`（`base_default`） | 已禁用/未启用的补丁胶囊退化成无边框无颜色的裸文字，与「未知」状态视觉不可区分 | 是（`[实测]` `grep -c "is-muted"` = 1，仅使用点，无定义） |
| `dockBus.tab = "clean"` 是无效值 | `AuthGate` 点「不同意」`setDock({authOpen:false, tab:"clean"})`（`10121`）；`dockBus` 初值也是 `"clean"`（`9046`） | `"clean"` 不在 `TABS`、不在任何 `st.tab ===` 分支。当前唯一读 `dockBus.tab` 的是 `syncDrillGrant`（`9020`，只判 `=== "drill"`），所以**暂时无害**；一旦有人按 `dockBus.tab` 去渲染就会落到「未知页签」 | 是 |
| `nativeSidebar` 恒为 `null` | `client.js:9112` 声明后无任何赋值 | `setDock` 里的 `nativeSidebar.openTab("dsh-purge")`（`9052-9056`）永不执行；`patch-client-dock.mjs` 注入的「打开原生侧栏」逻辑实际失效，只能靠 `main` slot 自己切 | 是 |
| 两套错误契约混用 | `apiJson`（`client.js:176-194`）在 `!r.ok` 时**抛**；`api`（`828-850`）在 `!r.ok` 时**resolve** `{ok:false}` | 同一 bundle 内两种心智模型；演练台里若有人写 `try/catch` 包 `api()`，HTTP 500 不会进 catch | 是 |
| `/dsh-purge/boost` 一个路由三种载荷 | `{enabled}`（`13120`）/ `{rewind}`（10205）/ `{permissionPatches,contextManagement}`（10571） | 后端必须做字段存在性分派；任一字段名改动会静默影响另外两个功能 | 是 |
| `api()` 的 `signal` 可被 init 覆盖 | `requestJson` 用 `Object.assign({cache,credentials,signal}, init)`（`client.js:201-204`） | 调用方若传自己的 `signal`，abort 定时器失效 → 请求永不超时 | 是 |
| `shotCache` 无上限、不清空 | `loadShot`（`907-927`）按 `eng:id` 累积 dataURL | 长会话浏览大量证据图后内存持续增长，切靶标不释放 | 是 |
| `rt-unread:*` / `rt-collapse:*` 按靶标累积 | `saveUnread` / `collapseSave` 只写不删 | localStorage 长期膨胀；靶标删除后残留键永不回收 | 是 |
| `EnvAdaptSendGate` 离线放行 | `platformEnvAdaptSkip` 请求 `.catch` 里也把缓存置 `ready:true`（`15401-15406`） | 一次网络抖动后，闸门在该标签页生命周期内不再拦截发送 | 是 |
| 发送闸门依赖 DOM 启发式 | `isRedteamModeActive` 靠 `[data-agent-preset='redteam']` 与 `/红队模式/` 文案（`15125-15152`）；`looksLikeSendControl` 靠 `aria-label`/`title`/`textContent` 正则（`15161-15183`） | 宿主改类名或改文案 → 闸门失效（漏拦）或误拦（`/发送|Submit|Send/` 命中无关按钮） | 是 |
| 直接改写宿主对象属性 | `shell.submit = gatedSubmit`（`15270`）、`shell.actions.submit = () => shell.submit("queue")`（`15278`） | 与其它同样包装 `submit` 的插件互相覆盖；宿主内部若缓存了 `submit` 引用则拦截失效 | 是 |
| `PurgifySection` 的三份 `notice` 共享 | `state/notice`（`11247`）同时服务状态页与提示词页与更多页（`11989`、`12145`、`12197`） | 在提示词页保存失败后切到状态页，会看到属于提示词的错误 | 是 |
| `visited` 只增不减 | `PurgePage`（`13952-13958`） | 6 个页签全打开过之后，所有子树常驻（含 `PurgifySection` 的 3 份实例：status/prompt/more 各一），内存与轮询开销叠加 | 是 |
| `StatusExtras` 只在挂载时 `load()` | `13111-13113` 空依赖数组 | 从状态页切走再回来**不会**刷新自检结果（因为只是 `hidden`），必须手动点「重测」 | 是 |
| `skillUiAllowed` 版本闸门硬编码 | `12707-12719`：`<1.12` 一律关；`1.1.11` 特例关 | 插件版本升级到 1.7.20 后该函数恒为真，闸门已成死代码；但 `!onBeta` 分支仍是 `return null`（空白页），一旦 `/status` 取不到 `plugin_version` 就整页空白且无提示 | 是 |
| `Section` 组件从未使用 | `6951-6980` | 51 行死代码；`rt-sec` 系列 CSS 仍有 6 条规则只为它存在 | 是 |
| 54 个 CSS 类只定义不使用 | 见 9.4 | 主要来自已删除的「资产关系图谱」与「攻击路径图」（`client.js:351` 注释明写「图谱视图已移除」）；`rt-flow-*` 15 条、`rt-hflow-*` 11 条、`rt-hit-*` 5 条、`rt-step-*` 7 条 | 是（`[实测]`） |
| `rt-dock-width` 只读不写 | `8329` 读，无写入 | 该键永远是历史值；`defaultRtGeom` 的宽度分支实际不可达（`clampRtGeom` 会兜住 320–1200） | 是 |
| `dshpp-theme` / `dshpp-theme-mode` 只删不写不读 | `11736-11737` | 死键；卸载流程里多两次无意义 `removeItem` | 是 |
| 6 个 i18n 键定义未用 | `action.uninstall`、`compat.host`、`compat.loading`、`compat.unavailable`、`ph.content`、`unpack.restarting`（zh 与 en 各一份） | 死文案；`action.uninstall` 尤其误导——`doAction` 只有 `apply`/`revert` 两个调用点（`11942`、`11951`） | 是（`[实测]`） |
| 大段 `dangerouslySetInnerHTML` | `AuthGate` 注入 `AUTH_LEGAL_HTML`（`10017`、`10117`） | 常量字符串，当前无注入面；但模式本身让后续若改成动态内容即成为 XSS 面 | 是 |
| `window.alert` / `window.confirm` 直接调用 | `need.prompt`（`11522`、`242`）、删除规则（`12433`）、重置规则（`12471`）、删除技能（`12936`）、回滚（`13615`）、安装版本（`13619`）、切换通道（`11406`）、切换版本（`11438`） | 在 Electron 里阻塞渲染线程；且无法被宿主主题化 | 是 |
| `restartDsh` 的 25 s 看门狗 | `11085-11088` | 桌面端 `failed to fetch` 被当作「已重启」（`11119-11124`）→ `sawDrop=true` 后**不再**提示失败，也不 reload；用户可能停在死页面 | 是 |
| `waitForRestart` 要求先掉线再回来 | `11044-11068`：`sawDown` 为假时一直 `retry()` | 若重启太快（<500 ms）从未观察到掉线，会一直轮询到 90 s 超时才报错 | 是 |
| 演练台无分页上限 | `assets` 固定 `limit:400`（`1141`） | 超过 400 台资产时列表被静默截断，UI 无「还有更多」提示 | 是 |
| `consoleDigest` 轮询 25 s 无退避 | `8551` | 面板隐藏（`st.open === false`）时仍在轮询；`embedded` 模式下也会轮询 | 是 |
| `Panel` 的 `embedded` 仍跑几何与 resize 监听 | `8356-8367` 有 `if (embedded) return`，但 `loadRtGeom` 仍在 `useState` 初值里执行（`8353`） | 无害但多余读一次 localStorage | 是 |

---

## 9. 逐条功能清单

### 9.1 外壳：装配与全局

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| CM-UI-001 | 浏览器模块注册（id = 包名） | `client.js:3` | 完整 | 宿主按包名找模块，改名必须同步改此处 |
| CM-UI-002 | 注入声明 `["slots","locale"]` | `client.js:15466` | 完整 | — |
| CM-UI-003 | 旧版入口 CSS 隐藏 | `client.js:14192-14202` | 完整 | 隐藏 4 个 `.dshp-*` 遗留类 |
| CM-UI-004 | 会话上下文绑定（`uiWorkspace.selection` + `sessions.list` 订阅） | `client.js:12219-12239` | 完整 | 供 `useCurrentCwd` 使用 |
| CM-UI-005 | 预设菜单历史别名折叠 | `client.js:14092-14190` | 完整 | 只在同描述正规行存在时折叠 |
| CM-UI-006 | 授权状态同步（`drill-grant` 双向） | `client.js:8983-9038` | 完整 | 服务端撤销即踢回授权门 |
| CM-UI-007 | 回退 UI 装配（slot + watch） | `client.js:14953-14968` | 完整 | watch 1200 ms 轮询 |
| CM-UI-008 | i18n 注册（zh/en 各 433 键） | `client.js:9131-10015` | 完整 | 6 个死键，见 8 |
| CM-UI-009 | `translate` 单例 + `useT` | `client.js:9118-9126` | 完整 | 未注册 locale 时 `t(k)` 返回 `k` 本身 |
| CM-UI-010 | `hostText(t,key,surface)` 按端取键 | `client.js:111-118` | 完整 | 用于 `uninstall.done.desktop` 等 4 组 |
| CM-UI-011 | `clientGuessSurface()` 兜底判端 | `client.js:98-110` | 完整 | 三条启发式：UA 含 electron / port 43120 / href 含 `dsh desktop` |

### 9.2 外壳：状态页

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| CM-UI-020 | 页头（标题 + 副标题 + 版本徽章） | `client.js:13979-14000` | 完整 | 副标题随 `active[2]` 变 |
| CM-UI-021 | 兼容性状态条（DSH 版本 / 兼容级别 / 磁盘写入计数 / 插件版本） | `client.js:13829-13884` | 完整 | 4 段 + 4 个 HelpTip |
| CM-UI-022 | 换包/解包布局提示（13 种 phase 文案） | `client.js:13885-13933` | 完整 | `tauri` 家族单独一句 |
| CM-UI-023 | 版本不一致警告 | `client.js:13934-13949` | 完整 | 硬编码期望值 `"1.7.20"` |
| CM-UI-024 | 应用补丁（含待应用条数徽标） | `client.js:11936-11946` | 完整 | 未加载完提示词时禁用 |
| CM-UI-025 | 还原补丁 | `client.js:11947-11956` | 完整 | — |
| CM-UI-026 | 卸载插件（确认弹窗） | `client.js:11957-11967` + `12008-12053` | 完整 | 桌面端不轮询，Web 端 90 s 探活 |
| CM-UI-027 | 刷新状态（带上次扫描时刻） | `client.js:11968-11977` | 完整 | 时间格式 `zh-CN` HH:mm |
| CM-UI-028 | 补丁健康度（大数字 + 三段进度条 + 4 格） | `client.js:10425-10494` | 完整 | `denom = total - na`（`10386`） |
| CM-UI-029 | 补丁组开关：权限补丁组（14 条） | `client.js:10593-10605` | 完整 | 写 `permissionPatches` |
| CM-UI-030 | 补丁组开关：上下文管理（2 条） | `client.js:10607-10619` | 完整 | 写 `contextManagement` |
| CM-UI-031 | 补丁明细：4 档过滤（全部/待应用/已关闭/本机不适用） | `client.js:10673-10702` | 完整 | 计数实时 |
| CM-UI-032 | 补丁明细：按 layer 分组折叠（5 组） | `client.js:10704-10801` | 完整 | `GROUP_ORDER = ["prompt","code","tools","compat","dsh20"]`；默认只展开 `code` |
| CM-UI-033 | 补丁明细：三列表格 + 英文标识符第二行 + 状态说明 | `client.js:10774-10799` | 完整 | applied 行不重复解释 |
| CM-UI-034 | 补丁明细：partial 行显示文件级进度 | `client.js:10793-10796` | 完整 | 依赖 `state.patch_files[id]` |
| CM-UI-035 | 写入流程 3 步说明 | `client.js:10804-10826` | 完整 | 纯静态 |
| CM-UI-036 | 高级选项：hooks 拒绝旁路 | `client.js:10928-10996` | 完整 | 折叠在 `<details>` |
| CM-UI-037 | 重启提示弹窗（portal） | `client.js:11000-11043` | 完整 | 主题由 `detectHostTheme()` 决定 |
| CM-UI-038 | 主动重启（桌面/Web 双路径） | `client.js:11071-11131` | 部分 | 桌面端依赖 `failed to fetch` 判定已重启，见 8 |
| CM-UI-039 | 破甲自检：结论行 + 逐层网格 + 重测 | `client.js:13102-13194` | 完整 | 4 种结论文案 |
| CM-UI-040 | 破甲自检：一次性探针 | `client.js:13195-13215` | 完整 | 结果显示在行内 |
| CM-UI-041 | 破甲强化段开关 | `client.js:13216-13242` | 完整 | 提示「重启后生效」 |
| CM-UI-042 | 社区维护：本机版本徽章 | `client.js:13683-13691` | 完整 | — |
| CM-UI-043 | 社区维护：更新通道摘要（代理/密钥状态） | `client.js:13694-13700` | 完整 | 密钥永不回显明文 |
| CM-UI-044 | 社区维护：自动检查 / 间隔 / 自动安装 | `client.js:13276-13387` | 完整 | 间隔候选 1/6/12/24 + 当前值 |
| CM-UI-045 | 社区维护：更新通道对话框（镜像/代理/密钥/清除） | `client.js:13389-13566` | 完整 | Esc 捕获阶段拦截 |
| CM-UI-046 | 社区维护：检查社区版更新 | `client.js:13705` | 完整 | 结果写 `releases` |
| CM-UI-047 | 社区维护：最近动作（审计流水前 10 条） | `client.js:13687-13708` | 完整 | `GET /dsh-purge/audit?limit=10` |
| CM-UI-048 | 社区维护：发行记录外链 | `client.js:13709-13716` | 完整 | 指向上游仓库 |
| CM-UI-049 | 社区维护：安装所选版本 | `client.js:13719-13746` | 完整 | 先 confirm |
| CM-UI-050 | 社区维护：备份列表 / 立即备份 / 回滚插件 | `client.js:13747-13790` | 完整 | 下拉项显示时间 + 各插件版本 |
| CM-UI-051 | 状态读取失败的降级显示 | `client.js:13934-13946` | 完整 | 提示「点刷新重试」 |

### 9.3 外壳：其余 5 页 + 全局浮层

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| CM-UI-060 | 6 页签切换（`role=tablist`） | `client.js:14009-14024` | 完整 | `visited` 只增不减 |
| CM-UI-061 | 提示词编辑（textarea 直读写 `prompt-inject.md`） | `client.js:12100-12166` | 完整 | 从 DOM 读实时值 |
| CM-UI-062 | 保存注入 | `client.js:11626-11676` | 完整 | 双空拒绝 |
| CM-UI-063 | 恢复默认注入 | `client.js:11693-11737` | 完整 | — |
| CM-UI-064 | 规则：工作区策略下拉 | `client.js:12486-12506` | 完整 | 选项回落 3 档 |
| CM-UI-065 | 规则：工作区文件扫描 + 勾选 | `client.js:12508-12569` | 完整 | 每项显示 scope/size/preview |
| CM-UI-066 | 规则：列表 + 当前项标记 | `client.js:12361-12446` | 完整 | 整行可键盘激活 |
| CM-UI-067 | 规则：新建（id/别名/target） | `client.js:12578-12641` | 完整 | id 必填 |
| CM-UI-068 | 规则：编辑保存 | `client.js:12643-12702` | 完整 | — |
| CM-UI-069 | 规则：删除 / 恢复默认 | `client.js:12433` / `12467-12478` | 完整 | 均 confirm |
| CM-UI-070 | 技能：版本闸门 | `client.js:12707-12719` | 部分 | 不满足时整页空白无提示 |
| CM-UI-071 | 技能：列表（有效性/调用方式/大小） | `client.js:12894-12961` | 完整 | — |
| CM-UI-072 | 技能：读正文 / 保存 / 删除 | `client.js:12775-12802`、`13074`、`12936` | 完整 | — |
| CM-UI-073 | 技能：zip 导入 | `client.js:12803-12842` | 完整 | base64 上传 |
| CM-UI-074 | 技能：文件夹导入（含过滤规则） | `client.js:12819-12887` | 完整 | 拒 7 类路径 |
| CM-UI-075 | 技能：路由 404/405 自动回落 `/dsh-purge/skill` | `client.js:1262-1269` | 完整 | — |
| CM-UI-076 | 更多：回退按钮显隐开关 | `client.js:10213-10281` | 完整 | 读失败有「重新读取」 |
| CM-UI-077 | 更多：自有服务器名单编辑 | `client.js:12169-12205` | 完整 | 提示被丢弃条数 |
| CM-UI-078 | 演练台页内嵌 vs 授权卡 | `client.js:14055-14075` | 完整 | 未授权时给「去授权」 |
| CM-UI-079 | 首启法务弹窗（一次性） | `client.js:14991-15076` | 完整 | 勾选后才可关；localStorage 永久 |
| CM-UI-080 | 授权门（10 s 倒计时 + 必须滚到底 + 三项勾选） | `client.js:10018-10171` | 完整 | 内容不需滚动时自动满足「读完」 |
| CM-UI-081 | 授权门「不同意」 | `client.js:10115-10125` | 部分 | 写入无效值 `tab:"clean"` |
| CM-UI-082 | 发送闸门（红队模式下强制先做环境适配） | `client.js:15219-15462` | 完整 | 三路拦截；离线放行 |
| CM-UI-083 | 环境适配对话框 + 跳过确认 | `client.js:15193-15452` | 完整 | `<dialog>` + `showModal` |
| CM-UI-084 | 回退按钮 + 菜单（一次 / 上一轮） | `client.js:14828-14925`、`14634-14695` | 完整 | portal 定位 + 视口跟随 |
| CM-UI-085 | 回退降级（React 错误边界 → 无 portal 版本） | `client.js:14781-14813`、`14697-14780` | 完整 | — |
| CM-UI-086 | 回退后自动回填 composer（5 段延迟重试） | `client.js:14413-14446` | 完整 | `FILL_DELAYS` |
| CM-UI-087 | 回退后清空重复草稿 | `client.js:14447-14485` | 完整 | 依赖 `/dsh-purge/last-user` |
| CM-UI-088 | 回退后丢弃继承的排队消息 | `client.js:14486-14509` | 完整 | — |

### 9.4 外壳：样式

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| CM-UI-090 | `base_default`（`.dshpp-*` 组件样式） | `client.js:51` | 完整 | 25,674 字符 / 179 规则 |
| CM-UI-091 | `native_default`（插件设置页根 `.dshpp-native`） | `client.js:54` | 完整 | 9,509 字符 / 74 规则；含 `.dshpp-native-drill` 右栏窄容器适配 |
| CM-UI-092 | `page_default`（Purge 整页根 `.dshpp-page`） | `client.js:57` | 完整 | 26,471 字符 / 228 规则；含 3 段 `@container purge-page` 断点（640/520/400） |
| CM-UI-093 | `welcome_default`（首启弹窗，自持样式） | `client.js:14974` | 完整 | 3,040 字符 / 22 规则；含手机 WebView 安全区适配 |
| CM-UI-094 | `REWIND_CSS`（回退按钮/菜单） | `client.js:14550` | 完整 | 1,933 字符 / 12 规则 |
| CM-UI-095 | `ENTRY_CSS`（遗留入口隐藏） | `client.js:14192` | 完整 | 78 字符 / 1 规则 |
| CM-UI-096 | 演练台 CSS（`.rt-*`） | `client.js:279-820` | 完整 | 48,561 字符 / 422 规则 |
| CM-UI-097 | 品牌中性化覆盖（`.rt-btn-primary`） | `client.js:301-303` | 完整 | 与 `lib/redteam/client.js:46` 不同，见 7 |
| CM-UI-098 | 死样式清理 | 见下 | 缺失 | 54 个类只定义不使用 |

`[实测]` 全部 CSS 里共 **539 个不同类选择器**；把 CSS 从源码剔除后再搜类名，**54 个类**在任何 JS 里都不出现：

```
rt-flow(-action,-end,-gain,-head,-idx,-link,-name,-node,-start,-target,-times)
rt-hflow(-arrow,-end,-item,-n,-name,-node,-pts,-start,-wrap)
rt-hit(-evi,-head,-note,-target)
rt-step(-body,-detail,-dot,-head,-meta,-time,-title)
rt-ap-phase  rt-ap-result-head  rt-atest-notes  rt-chain  rt-chip  rt-counted
rt-hcol-attck  rt-hcol-sec  rt-hcol-secs  rt-live-body  rt-livebar
rt-scorepts  rt-sess-sub  rt-sevbar  rt-tag-dead  rt-weblink
```

另 40 个属于动态拼接族（`rt-pri-*` / `rt-sev-*` / `rt-st-*` / `rt-stage-*` / `rt-test-*` / `rt-scope-*` / `k-*` / `t-*`），不能判死。

### 9.5 演练台：外壳与公共件

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| CM-UI-100 | `api(req)` 统一请求 + 非 JSON 容错 | `client.js:828-850` | 完整 | HTTP 错误不 reject |
| CM-UI-101 | `useUI` / `setUI` 外部可驱动的面板状态 | `client.js:851-878` | 完整 | 供 `page.js`、`dock.js`、`AuthGate` 调用 |
| CM-UI-102 | 浮动 dock 拖动 / 四向缩放 / 几何持久化 | `client.js:8368-8367`、`8459-8519`、`8280-8346` | 完整 | `embedded` 时全关 |
| CM-UI-103 | 全屏窗口（`#redteam-full`）+ Esc 退出 | `client.js:826-833`、`8596-8626` | 完整 | — |
| CM-UI-104 | 靶标下拉（含「选择靶标 / 暂无靶标」占位） | `client.js:8766-8795` | 完整 | 变更即 `activateEngagement` |
| CM-UI-105 | 创建靶标（无靶标时的空态表单） | `client.js:8638-8680` | 完整 | Enter 亦可提交 |
| CM-UI-106 | 10 页签栏 + 未读红点 | `client.js:8583-8594`、`8835-8864` | 完整 | 红点带 `aria-label="有新内容"` |
| CM-UI-107 | 未读判定（count 增 或 at 变新） | `client.js:8297-8307` | 完整 | 25 s 轮询 `consoleDigest`（`8551`） |
| CM-UI-108 | 页脚统计（C 段/资产/存活/端口/指纹/漏洞/被动主动/SQLite 名） | `client.js:8870-8893` | 完整 | — |
| CM-UI-109 | 渲染错误边界 | `client.js:7778-7812` | 完整 | 可一键回资产测绘 |
| CM-UI-110 | `Section` 折叠容器 | `client.js:6951-6980` | 缺失 | **定义未使用** |
| CM-UI-111 | `Clip` 复制/展开文本块 | `client.js:6982-7029` | 完整 | 3 处使用 |
| CM-UI-112 | `clickable()` 键盘可达包装 | `client.js:1012-1031` | 完整 | — |
| CM-UI-113 | 复制到剪贴板（含 execCommand 兜底 + 失败提示） | `client.js:1032-1058` | 完整 | — |
| CM-UI-114 | 证据截图懒加载 + 点击放大 | `client.js:908-1005` | 完整 | 缓存永不释放 |
| CM-UI-115 | 折叠状态持久化 `rt-collapse:*` | `client.js:6912-6949` | 完整 | — |
| CM-UI-116 | `PriTag` / `TestTag` / `ProvTag` 三态标签 | `client.js:1061-1092` | 完整 | — |
| CM-UI-117 | 版本条 + 一键更新并重启 | `client.js:8039-8280` | 完整 | 倒计时 6 s 后 reload |

### 9.6 演练台：10 页签（详见 5.2 的结构与空态表）

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| CM-UI-120 | 资产测绘：三视图（列表 / 发现时间 / 域名 / Web）+ 测试视图 | `client.js:1094-2118` | 完整 | 5 个视图按钮；`testing` 视图无按钮（见 3.18） |
| CM-UI-121 | 资产测绘：左侧 C 段树（按内外网分组、可折叠） | `client.js:1216-1360` | 完整 | 组头显示段数与资产数 |
| CM-UI-122 | 资产测绘：7 项筛选 + 5 种排序 | `client.js:1361-1516`、`1560-1578` | 完整 | — |
| CM-UI-123 | 资产测绘：结论条（6 个可点计数） | `client.js:1553-1661` | 完整 | 再点取消 |
| CM-UI-124 | 资产测绘：行展开详情（端口/指纹/溯源/测试记录） | `client.js:1690-2100` | 完整 | 懒加载 `asset` |
| CM-UI-125 | 资产时间线 | `client.js:2119-2261` | 完整 | 按天分组 + 点选筛选 |
| CM-UI-126 | 当前测试（5 s 自动刷新开关） | `client.js:7032-7322` | 完整 | — |
| CM-UI-127 | 环境适配：平台/目录/工具/密钥/备注 表单 | `client.js:5853-6332` | 完整 | 14 个字段 |
| CM-UI-128 | 环境适配：整包文件夹自动分配工具 | `client.js:5942` 调用点 | 完整 | — |
| CM-UI-129 | 智能体：并发规则 + 六角色说明 | `client.js:7864-7918` | 完整 | 纯说明文本 |
| CM-UI-130 | 智能体：并发上限编辑（立即生效） | `client.js:7934-8038` | 完整 | 范围 1–MAX |
| CM-UI-131 | 智能体：角色提示词编辑器（4 角色） | `client.js:2262-2468` | 完整 | 内嵌于智能体页 |
| CM-UI-132 | 会话隧道：WebShell 表 + 隧道表 | `client.js:7323-7777` | 完整 | 含复制 URL / fscan / gogo 命令 |
| CM-UI-133 | 会话隧道：连通性检测（6 s） | `client.js:7345-7372` | 完整 | — |
| CM-UI-134 | 会话隧道：手动标记可用/失效 | `client.js:7377-7405` | 完整 | 写 `check_note="界面手动标记"` |
| CM-UI-135 | 漏洞战果：4 子页签（漏洞/文件/凭据/访问会话） | `client.js:3770-3775`、`3821-3846` | 完整 | — |
| CM-UI-136 | 漏洞战果：平铺 / 按目标聚合 | `client.js:3799-3807` | 完整 | — |
| CM-UI-137 | 漏洞战果：状态与等级筛选、全部展开/收起 | `client.js:3730-3798` | 完整 | — |
| CM-UI-138 | 漏洞战果：漏洞详情 + 证据（请求/响应可复制） | `client.js:3111-3700` | 完整 | `HttpBlock` |
| CM-UI-139 | 攻击文件（按目标目录） | `client.js:5028-5234` | 完整 | 可被漏洞页内嵌 |
| CM-UI-140 | 攻击链：竖向（链路 A）/ 横向（链路 B） | `client.js:3856-4370` | 完整 | 7 阶段 |
| CM-UI-141 | 得分目标：总分 + 4 个统计胶囊 | `client.js:6715-6760` | 完整 | 自建/服务封顶单独提示 |
| CM-UI-142 | 得分目标：得分点列表（按分值升序、可展开命中记录） | `client.js:6760-6910` | 完整 | 内置项禁删禁改分值 |
| CM-UI-143 | 得分目标：新增/编辑得分点 | `client.js:6373-6710` | 完整 | 6 个字段 + 校验 |
| CM-UI-144 | 得分目标：删除（内置项拒绝） | `client.js:6423` 调用点 | 完整 | — |
| CM-UI-145 | 报告：按阶段分组的复现报告 | `client.js:4405-5020` | 完整 | `groupByStage` |
| CM-UI-146 | 报告：下载 `.md`（Blob + a.download） | `client.js:4455-4466`、`4892` | 完整 | 文件名 `report-<target>.md` |
| CM-UI-147 | 报告：复制到 Yakit / 复制请求 / 复制命令 | `client.js:4870-4900` | 完整 | — |
| CM-UI-148 | 知识库：检索 + 4 维筛选 | `client.js:5289` 调用点、`5500-5540` | 完整 | 正文也参与搜索 |
| CM-UI-149 | 知识库：归类总览（点即筛选） | `client.js:5556-5590` | 完整 | — |
| CM-UI-150 | 知识库：按归类分组 / 平铺 | `client.js:5539-5552` | 完整 | — |
| CM-UI-151 | 知识库：本机 nuclei 模板分页 | `client.js:5269-5290`、`5373-5378` | 完整 | `templateOffset` 游标 |
| CM-UI-152 | 知识库：记一次复用 | `client.js:5343` 调用点 | 完整 | — |
| CM-UI-153 | 技能库：可用性三态 + 3 个过滤器 | `client.js:2469-2959` | 完整 | — |
| CM-UI-154 | 技能库：跳过 30 s 缓存重查 | `client.js:2482`（`refresh:true`） | 完整 | — |

### 9.7 op 覆盖总表（`[实测]`）

| 集合 | 数量 | 说明 |
|---|---|---|
| `client.js` 中 `op:` 字面量出现次数 | **57** | 正则 `(?<![A-Za-z0-9_$])op:\s*"([A-Za-z0-9_]+)"` |
| 去重后 | **49** | 43 在演练台段 + 6 在外壳段 |
| 发往 `/redteam/api` 的 op | **45** | 43 演练台 + `platformEnvAdaptStatus` / `platformEnvAdaptSkip` |
| 发往 `/dsh-purge/update` 的 op | **3** | `apply` / `channel` / `switch` |
| 发往 `/dsh-purge/community` 的 op | **1** | `preferences`（`check`/`backup`/`rollback`/`update` 是变量传入，非字面量） |
| **UI 有 / 后端无** | **0** | 45 个 `/redteam/api` op 全部能对上 `store-core.js` / `ui.js` 的分支 |
| **后端有 / UI 无** | **35** | 见下 |

后端 80 个 op 中 UI 从不调用的 35 个（均为写入侧，由 `redteam_*` 工具调用）：

```
addAccess addAttackFile addChainStep addCredential addHttpEvidence addScoreHit
addTunnel addVuln addWebshell assessAsset assetTest attackGraph chain graph
httpEvidence import pocDelete pocList pocSave pocStats pocUpdate report
reportTargets saveStage shotAdd shotDelete shots stages stats templateSearch
templateStats testStats tunnels vulnStats webshells
```

其余端点同样 0 个「UI 有后端无」：`/dsh-purge/rules` 9 个 op、`/dsh-purge/skills` 5 个 op。

### 9.8 死按钮 / 死入口

| 类型 | 数量 | 明细 |
|---|---|---|
| 前端有 UI 但后端无实现 | **0** | — |
| 组件定义未使用 | 1 | `Section`（`6951`） |
| slot 注册不可达 | 1 | `plugins.row.config` key 形状与宿主 `entryKey` 不符（`15592`） |
| 无效状态值 | 1 | `dockBus.tab = "clean"`（`9046`、`10121`） |
| 恒为 null 的开关 | 1 | `nativeSidebar`（`9112`）→ `setDock` 里 `openTab` 分支死 |
| 只读遗留存储键 | 1 | `rt-dock-width`（`8329`） |
| 只删不写不读的存储键 | 2 | `dshpp-theme`、`dshpp-theme-mode`（`11736-11737`） |
| 死 i18n 键 | 6 | `action.uninstall`、`compat.host`、`compat.loading`、`compat.unavailable`、`ph.content`、`unpack.restarting` |
| 无 CSS 定义的状态类 | 1 | `is-muted`（`10734`；来源 `statusKind` 的 `disabled` 分支 `10290` → `Pill`） |
| 只定义不使用的 CSS 类 | 54 | 见 9.4 |
| 页签有 body 无按钮 | 3 | `prompts` / `testing` / `attackfiles`（`8630-8712` vs `8583-8594`） |

---

## 10. 未验证项

1. ❓未验证：`plugins.row.config` 的 `entryKey` 在**运行时**是否真的永远不匹配。缺什么：需要在浏览器里打开「插件」页、展开 `dsh-purge-community` 那一行，观察 `DetailSettings` 是否出现在行内。静态只能证明 key 字面量与宿主 `bundleDetailKey(name,version,language)` / `registryKey(...)` 的形状不同，无法排除宿主另有回落路径。
2. ❓未验证：`Section` 是否被 `lib/redteam/client.js` 的**另一份**构建产物使用。缺什么：`packages/purge-panel/`（`package.json:39` 的 `build:client` 目标）不在 vendor 快照里，无法确认源 `src/` 是否还有别的引用点。
3. ❓未验证：`lib/redteam/client.js` 与 `client.js` 演练台段的**完整**语义等价性。缺什么：bundle 版经过 bundler 改写（引号、行拆分、`import_react2.default.createElement` → `h2`），只能证明「34 个组件名相同 + 43 个 op 集合相等 + CSS 与 `api()` 两处实质差异」，无法逐行证明其余部分无差异（已确认首个 JS 差异就在 `api()`）。
4. ❓未验证：`PurgePage` 的 6 个页签子树常驻带来的实际内存/轮询开销。缺什么：需要 DevTools Memory 剖面，对比「只开状态页」与「6 页全开过」两种状态。
5. ❓未验证：`EnvAdaptSendGate` 的三路拦截在真实宿主上是否**都**生效。缺什么：需要红队预设会话里实际点发送/按 Enter，分别验证 `shell.submit` 包装、`pointerdown` 捕获、`keydown` 捕获三条路径。
6. ❓未验证：`isRedteamModeActive()` 的 DOM 启发式在宿主当前版本上的命中率。缺什么：需要打印 `[data-agent-preset]`、`[data-preset-id]`、`[data-mode]` 三个属性在真实 DOM 里的实际取值。
7. ❓未验证：`rt-unread:*` / `rt-collapse:*` / `shotCache` 的长期增长量。缺什么：需要一次多靶标、长会话的实测会话后统计 localStorage 与 JS 堆。
8. ❓未验证：`dshpp-pill is-muted` 的视觉退化程度。缺什么：需要一个「有 disabled 补丁」的宿主状态 + 截图对照 `.is-miss`。
9. ❓未验证：`api()` 在 `!res.ok` 时 resolve 的契约是否被所有调用方正确处理。缺什么：需要逐调用点注入 500 响应做故障注入；静态只能列出契约，无法证明每个 `.then(ok, err)` 双参写法都覆盖了 `{ok:false}` 分支。
10. ❓未验证：`requestJson` 的 `signal` 被 `init` 覆盖的具体影响面。缺什么：需要找出所有显式传 `signal` 的调用点——静态扫描显示当前**没有**调用方传 `signal`，所以是潜在风险而非现网缺陷，无法用运行时验证「当前是否已出问题」。
11. ❓未验证：`assets` 的 `limit: 400` 截断在真实靶标上的触发频率。缺什么：需要一个 >400 台资产的库。
12. ❓未验证：`AUTH_LEGAL_HTML` 与 `welcome_default` 的文案是否与仓库内某份 markdown 同源。缺什么：`vendor/community/docs/` 下未见同名法务文档，无法确认单一真源。

---

### 复现命令

```bash
cd /Users/wheming/Documents/dsh-purge-plus

# op 字面量（排除 borderTop/top 之类误命中）
python3 - <<'PY'
import re
src=open('vendor/community/client.js',encoding='utf-8').read()
pat=re.compile(r'(?<![A-Za-z0-9_$])op:\s*"([A-Za-z0-9_]+)"')
rows=[(src.count('\n',0,m.start())+1,m.group(1)) for m in pat.finditer(src)]
print(len(rows),'occurrences,',len({o for _,o in rows}),'unique')
PY

# UI op vs 后端 op 双向差集
python3 - <<'PY'
import re
ui=set(re.findall(r'(?<![A-Za-z0-9_$])op:\s*"([A-Za-z0-9_]+)"',open('vendor/community/client.js',encoding='utf-8').read()))
be=open('vendor/community/lib/redteam/store-core.js',encoding='utf-8').read()+open('vendor/community/lib/redteam/ui.js',encoding='utf-8').read()
ops=set(re.findall(r"op [!=]== ['\"]([A-Za-z0-9_]+)['\"]",be))|set(re.findall(r"case ['\"]([A-Za-z0-9_]+)['\"]",be))
print('UI-only:',sorted(ui-ops)); print('backend-only:',len(ops-ui))
PY

# 死 CSS 类
python3 - <<'PY'
import re
src=open('vendor/community/client.js',encoding='utf-8').read(); lines=src.split('\n')
def getvar(n):
    for l in lines:
        if l.startswith('var %s ='%n): return l
    return ''
def unq(s):
    q=s[0]; b=s[1:-1]
    if q=="'": b=b.replace("\\'","'")
    b=b.replace('\\"','"').replace('\\\\','\\')
    try: return b.encode().decode('unicode_escape')
    except Exception: return b
def css(n):
    buf=getvar(n); i=buf.index('=')+1
    while buf[i] in ' \t': i+=1
    q=buf[i]; j=i+1
    while j<len(buf):
        if buf[j]=='\\': j+=2; continue
        if buf[j]==q: break
        j+=1
    return unq(buf[i:j+1])
parts=[css(n) for n in ['base_default','native_default','page_default','welcome_default','REWIND_CSS','ENTRY_CSS']]
i=src.index('const CSS = `'); parts.append(src[i+14:src.index('`;',i+14)])
allcss=''.join(parts); js=src
for p in parts: js=js.replace(p,'',1)
dead=[c for c in sorted(set(re.findall(r'\.([a-zA-Z][a-zA-Z0-9_-]*)',allcss)))
      if re.search(r'(?<![a-zA-Z0-9_-])'+re.escape(c)+r'(?![a-zA-Z0-9_-])',js) is None]
print(len(set(re.findall(r'\.([a-zA-Z][a-zA-Z0-9_-]*)',allcss))),'defined;',len(dead),'never referenced')
PY

# 两份 client 的组件集合与 op 集合是否一致
python3 - <<'PY'
import re
a=open('vendor/community/client.js',encoding='utf-8').read()
b=open('vendor/community/lib/redteam/client.js',encoding='utf-8').read()
fa=set(re.findall(r'function ([A-Za-z0-9_]+)',a)); fb=set(re.findall(r'function ([A-Za-z0-9_]+)',b))
print('rt-only:',fb-fa)
oa=set(re.findall(r'(?<![A-Za-z0-9_$])op:\s*"([A-Za-z0-9_]+)"',a))
ob=set(re.findall(r"(?<![A-Za-z0-9_$])op:\s*'([A-Za-z0-9_]+)'",b))
print('op sets equal:',oa==ob,len(oa),len(ob))
PY
```
