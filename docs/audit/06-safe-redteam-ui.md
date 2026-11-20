# 06 · safe 2.0.0 演练台 UI（浏览器半侧）

> 审计对象：`vendor/safe/lib/redteam/client.js`，16,247 行。
> 只读审计。所有行号以当前 vendor 快照为准。
> `[静态]` = 只读了源码；`[实测]` = 实际发出过请求 / 在运行中的宿主上验证过。

---

## 1. 模块清单

### 1.1 单文件内部分段

这个"模块"是一个文件，但内部按注释标记切成 6 段，重写时必须按同样顺序拼装。

| 段 | 行范围 | 行数 | 一句话职责 | 是否被 `index.js` 加载 |
|---|---|---|---|---|
| 模块头 + `__ModuleLoader__.load({id:'dsh-purge-safe'})` | 1–11 | 11 | 声明浏览器模块 id 与 factory；id 只是构建脚本的定位占位 | 否（浏览器侧） |
| `__DSH_PURGE_FULLSCREEN_BEGIN__` → `useWorkbenchFullscreen` | 12–301 | 290 | 工作台全屏：CSS 展开 + 原生 Fullscreen API 双轨，含取消/回滚状态机 | 否 |
| 产品主题 `productTheme` | 302–539 | 238 | 读/写/订阅 `data-theme`，dusk/dawn 等模式，跨窗口同步 | 否 |
| React + 行内 Markdown 渲染 | 540–740 | 201 | `require('react')`、`rawH`、`renderInline`、包装后的 `h()` | 否 |
| `const CSS = \`…\`` | 741–10081 | 9,341 | 全量样式字符串（含 `__DSH_PRODUCT_SKIN_BEGIN__` 1765–10080 的皮肤层） | 否 |
| 桥接 + 全部组件 | 10083–16247 | 6,165 | `api()`、`Panel`、12 个页签组件、SessionMap、RtBoundary | 否 |

**结论**：`vendor/safe/lib/index.js`（host 半侧）不加载本文件。它只 import `redteam/role-section.js`（`index.js:25`）与 `redteam/bootstrap-runtime.js`（`index.js:1464`、`index.js:2430`）。本文件是**浏览器半侧**。

### 1.2 它实际怎么被装上

| 事实 | 证据 |
|---|---|
| 本文件的 factory 被**内联**进 `vendor/safe/client.js` 的 `__DSH_PURGE_DRILL_BEGIN__`(5590) … `__DSH_PURGE_DRILL_END__`(21816) 之间 | `vendor/safe/client.js:5590`、`:21816`；内联区内 `function Panel(props)` 在 `:21262`，与本源文件 `:15678` 同构 |
| 内联后被包成 IIFE 常量 `__dshPurgeDrill`，导出 `{CSS, Panel, setUI, useUI, isFullWindow, setDockWidth}` | `vendor/safe/client.js:5592`、`:21810` |
| 唯一挂载点：`h(__dshPurgeDrill.Panel, { embedded: true, sessionId, sessionTitle })`，且必须 `readDrillAuth()` 为真 | `vendor/safe/client.js:22647`–`22648` |
| 本文件自己的 `apply(ctx)` **不注册任何 slot**，只注入一个 `<style data-redteam-ui="1">` | `client.js:16225`–`16244`；`void Panel` / `void SidebarButton` / `void HeaderButton` / `void FullButton` 全部显式丢弃（`:16237`–`16240`） |

`apply()` 的原文形状（`client.js:16225`）：

```js
function apply(ctx) {
  const styleTag = document.createElement('style')
  styleTag.setAttribute('data-redteam-ui', '1')
  styleTag.textContent = CSS
  document.head.append(styleTag)
  ctx.effect(() => () => { styleTag.remove(); dockWidthTag = null })
  void Panel; void SidebarButton; void HeaderButton; void FullButton
}
exports.apply = apply
exports.inject = inject          // inject = ['slots']（:16219）
```

**这意味着**：单独加载本文件只会注入 CSS，**不会出现任何界面**。所有 UI 都由外层 `client.js` 通过 `__dshPurgeDrill.Panel` 拉起来。重写时 `apply` 可以保留为空壳，但 `exports` 必须保留 `{apply, inject}`，否则模块加载器会拒。

### 1.3 依赖的外部文件（本文件不自带）

| 依赖 | 用途 | 位置 |
|---|---|---|
| `react`（平台 seed） | 唯一 npm 依赖，`require('react')` | `client.js:542` |
| `window.__ModuleLoader__` | 模块注册器 | `client.js:8` |
| 插件 host 路由 `/redteam/api` | 全部业务 op | `vendor/safe/lib/redteam/ui.js:859` |
| 宿主 RPC `/api/session/list` | 会话关系图数据 | 宿主 `@deepseek-ai/dsh-api-session-controller` |
| 插件 host 路由 `/dsh-purge-safe/status` | 版本号 | `vendor/safe/lib/index.js:2205` |
| `window.__dshPurgeAttentionGo` | 待办条"填入主会话输入框" | 定义在 `vendor/safe/client.js:23005` |

---

## 2. 数据模型

本文件**不拥有任何持久化表**。它只读宿主与插件 host 的响应，并写 4 类浏览器本地状态。

### 2.1 浏览器本地状态（localStorage）

| 载体 | 键 | 值形状 | 谁写 | 谁读 | 生命周期 |
|---|---|---|---|---|---|
| localStorage | `rt-last-engagement` | 靶标 id 字符串 | `rememberEngagement()` `client.js:10125` | `lastEngagement()` `:10122` | 每次 followTo 覆盖；永不清理 |
| localStorage | `rt-unread:<engagement>` | `{ [tab]: {count:number, at:string\|null} }` | `saveUnread()` `:15623` | `loadUnread()` `:15616` | 切靶标时换键；永不清理 |
| localStorage | `rt-collapse:<prefix>` | `{ [key]: boolean }` | `collapseSave()` `:13838` | `collapseLoad()` `:13831` | prefix ∈ `sessions:<eng>` / `report:<eng>` / `findings:<eng>` / `files:<eng>` / `testing:<eng>` / `assets-side:<eng>` |
| localStorage | `rt-dock-geom-v1` | `{x,y,w,h}` 浮窗几何 | `Panel` effect `:15703` | `loadRtGeom()` `:15670` | 拖拽/缩放即写；`clampRtGeom` 每次读时夹紧（`:15649`） |
| localStorage | `rt-dock-width` | 数字字符串 | 仅读，从不写（`setDockWidth` 是空函数，`:10156`） | `defaultRtGeom()` `:15659` | **只读死键** |
| React state | `ui = {open:true, tab:'overview'}` | — | `setUI()` `:10147` | `useUI()` `:10157` | 模块级单例，不持久化；刷新即回 `overview` |

`setUI` 用订阅者集合广播（`:10147`–`10154`），每个订阅者调用被 `try/catch` 包裹，单个订阅者抛错不影响其他订阅者。

### 2.2 后端只读对象（全部经 `/redteam/api` 或 `/api/session/list` 取，本文件不写）

| 对象 | 来源 op | 关键字段（本文件实际读到的） | 谁读 |
|---|---|---|---|
| engagement 名册 | `bootstrap` | `engagements[].{id,name}`、`current` | `Panel` `:15722`、`:15760` |
| snapshot | `snapshot` | `stats.{assets,liveAssets,openPorts,services,segments,vulns}`、`tests.{untested,testing,tested}`、`engagement.{id,name}` | `OverviewTab` `:10390`、`AssetsTab` `:10769` |
| 得分链 | `scoreChain` | `stages[].{code,name,points,cumulative,color,goal}`、`summary.points`、`items[].stage_code` | `OverviewTab` `:10396`、`ChainTab` `:11831`、`ReportTab` `:12166` |
| 得分点 | `scores` | `items[]`/`ruleGroups[].tiers[]`，每条 `{id,name,points,earned,counted,cap,cap_used,hits[]}`；`summary.{achievedPoints,pointCount,countedHits,selfCreatedHits,serviceCappedHits,hitPointCount}` | `OverviewTab` `:10397`、`ScoreTab` `:13538` |
| 会话/入口 | `sessions` | `webshells[].{id,url,shell_type,status,privilege,pass_key,asset_ip,secret_ref,last_check,latency_ms,check_note,note}`、`tunnels[].{id,kind,listen,entry,entry_kind,entry_kind_label,reach,legit,status,command}`、`totals` | `OverviewTab` `:10398`、`SessionTab` `:14068` |
| 智能体并发 | `agentsStatus` | `{used,max,parked,parked_labels}` | `OverviewTab` `:10399`、`AgentsTab` `:15438` |
| 待办 | `attention` | `{items[].{session_id,stage,label,role,reason,needs[].{kind,detail}}, awaiting_person, pending_coverage}` | `OverviewTab` `:10400`、轮询 `:10386` |
| 未读摘要 | `consoleDigest` | `sections.{<tab>:{count,at}}` | `Panel` `:15855` |
| 漏洞 | `vulns` | `items[]`、`total`、`stats` | `FindingsTab` `:11568` |
| 凭据 | `credentials` | `items[].{id,host,username,secret_type,secret_value,privilege,source,tool,secret_ref,found_by_agent,found_at,note}` | `ArtifactsTab` `:11515` |
| 访问会话 | `access` | `items[].{id,host,username,method,privilege,session_ref}` | `ArtifactsTab` `:11516` |
| 攻击文件 | `attackFiles` | `items[].{folder,count,files[].{id,name,kind,description}}` | `ArtifactsTab` `:11514`、`AttackFilesTab` `:12398` |
| 会话关系（宿主） | `/api/session/list` | 见 §3.5 逐字段表 | `SessionMap` `:14731` |
| 会话绑定 | `sessionBindings` | `{ok,agents:{<rootSessionId>:{engagement,name,at}}}` | `SessionMap` `:14761` |

---

## 3. 业务逻辑

### 3.1 入口：`Panel(props)`（`client.js:15678`）

唯一真正的入口组件。`props` 只有三个字段：

| prop | 类型 | 缺省 | 作用 |
|---|---|---|---|
| `embedded` | boolean | false | 为真时不画收起/全屏/拖拽条，宽度 `100%`（`:15977`）；外层 `safe/client.js:22648` 传 `true` |
| `sessionId` | string\|null | null | 当前 DSH 会话 id，用于靶标绑定跟随 |
| `sessionTitle` | string | `''` | 会话标题，绑定失败时按标题模糊匹配靶标 |

**启动判据与副作用（`:15759`–`:15772`）**：

1. `api({op:'bootstrap'})` → 失败 `setErr(r.error || '无法连接资产库')` 并**停止**（不渲染页签体，`:15938` 的 `if (err)` 分支优先）。
2. 成功则 `setEngagements(r.engagements)`，取 `r.current || engagements[0].id` 作为 `eng`，`followSource='default'`，并 `loadSnapshot(eng)`。
3. 若 `sessionId` 存在，立刻 `applySessionBinding(sessionId, list, sessionTitle)`。

**靶标跟随优先级（`applySessionBinding`，`:15739`–`:15757`）**，按顺序短路：

```
1. 服务端绑定  api({op:'sessionBinding', session:id}) → r.bound 非空 → followTo(bound,'bound')
2. 标题匹配    engagementByTitle(title, list) 非空        → followTo(byTitle,'title')
3. 上次选择    localStorage 'rt-last-engagement' 非空     → followTo(last,'last')
4. 都不中      保持当前 eng
```

`engagementByTitle`（`:10135`）的匹配算法：把标题与靶标名都过 `squashName`（`~XXXX` 转字符 → 去掉所有非 `[0-9a-zA-Z\u4e00-\u9fff]` → 转小写，`:10131`）；两侧都要求长度 ≥ 3；任一方包含另一方即命中；多条命中取 `key` 最长的一条。

**并发保护**：`bindSeq` 自增序号 + `sessionId !== forSession` 双重校验（`:15745`、`:15746`），过期响应直接丢弃。

**手动选择优先**：`manualHere()`（`:15696`）为真时，`applySessionBinding` 在 `:15750` 直接 return，不再自动跟随。

### 3.2 入口：页签导航（`Panel` 渲染段 `:15892`–`:16175`）

```js
const tabs = [
  ['overview','态势'], ['assets','资产测绘'], ['env','环境适配'], ['agents','智能体'], ['sessions','会话隧道'],
  ['artifacts','凭据与文件'], ['findings','漏洞战果'], ['chain','攻击链'], ['scores','得分目标'], ['report','报告'],
  ['knowledge','知识库'], ['skills','技能库'],
]                                                            // :15892–15896，共 12 项

const TAB_GROUPS = [
  { key:'overview',      label:'工作总览',   tabs:['overview'] },
  { key:'assets',        label:'资产台账',   tabs:['assets'] },
  { key:'collaboration', label:'协同进度',   tabs:['agents'] },
  { key:'results',       label:'成果与报告', tabs:['findings','chain','scores','report'] },
  { key:'resources',     label:'资源中心',   tabs:['sessions','artifacts','knowledge','skills'] },
  { key:'settings',      label:'环境与设置', tabs:['env'] },
]                                                            // :15899–15906，共 6 组

const TAB_ALIASES = { testing:'assets', attackfiles:'artifacts', prompts:'agents' }   // :15907
```

**分组导航的工作方式**（这是 `TAB_GROUPS` 在演练台里的全部用途）：

1. `groupOf(tab)` = 找到 `tabs` 含该页签的组，找不到回落到 `TAB_GROUPS[0]`（`:15908`）。
2. 一级导航只渲染 **6 个组**（`.rt-tab-group`），不渲染 12 个页签。
3. 二级导航 `.rt-subnav` 只在 `activeGroup.tabs.length > 1` 时渲染（`:16157`），即只有"成果与报告"（4 个）和"资源中心"（4 个）两个组有二级条。
4. 点组 = `activateGroup`（`:16101`）：若当前页签已在该组内则保持，否则跳该组第 1 个页签；**并 `setRefreshKey(+1)`**。
5. 点二级页签 = `markTabSeen(tab)` + `setUI({tab})` + `setRefreshKey(+1)`（`:16160`–`:16163`）。
6. 组级红点 `groupHasUnread(g)` = 组内任一项 `unreadOf` 为真（`:15993`）。
7. 键盘：`Home`/`End`/`ArrowDown`/`ArrowRight`/`ArrowUp`/`ArrowLeft` 在组间移动（`:16106`–`:16116`）。

**`refreshKey` 递增的 5 个位置**（全量）：

| 位置 | 触发 |
|---|---|
| `:15793` | `refreshAll()` —— 各页签内"刷新"按钮、`AssetsTab` 的 `onRefresh` |
| `:15920` | `exitFull()` 且当前是全屏窗口（`isFullWindow()` 为真） |
| `:16104` | `activateGroup` 点一级导航 |
| `:16162` | 点二级页签 |
| `:14958` | **不递增**，只消费：`SessionMap` 在 `refreshKey` 变化时重读 |

**`st.tab` 与 `TAB_ALIASES` 的错配（重要）**：`body` 分发里存在 `st.tab === 'testing'`（`:15964`）、`'attackfiles'`（`:15970`）、`'prompts'`（`:15949`）三个分支，但 `st.tab` 只会被 `setUI({tab})` 写入 `tabs` 里的 12 个真实 key 或 `onGo()` 传入的 `'assets'|'findings'|'scores'|'sessions'|'agents'|'chain'`。**这三个分支不可达**，是死代码。

### 3.3 入口：`markTabSeen(tab)` / 未读红点（`:15869`–`:15889`）

1. `if (!eng) return`（`:15869`）。
2. `setSeen` 内：若 `prev` 为空，先用当前 `digest` 全量初始化基线（`:15872`–`:15876`）——**首次打开不算新内容**，否则一进来满屏红点。
3. 把 `digest[tab]` 写回，并 `saveUnread(eng, next)` 落盘。
4. `unreadOf(tab)`（`:15885`）= `digestHasNew(seen[tab], digest[tab])`；`digestHasNew`（`:15627`）判据：`cur.count > prev.count` **或** `cur.at !== prev.at && cur.at > prev.at`（字符串字典序比较 ISO 时间）。

### 3.4 入口：`consoleDigest` 轮询（`:15847`–`:15863`）

- 依赖 `[eng, refreshKey]`；`eng` 为空时 `setDigest(null); setSeen(null)` 并返回。
- 立即 `tick()` 一次，然后 `setInterval(tick, 25000)`。
- `digestInflight` 布尔守卫（`:15853`）：上一轮未返回则跳过本轮，**不排队**。
- 失败静默（`() => {}`），不打断页面。
- 卸载时 `alive = false` + `clearInterval`。

### 3.5 入口：`SessionMap(props)`（`client.js:14798`–`15384`，587 行；含 6 个纯函数与 2 个 RPC 封装则共 1,101 行，14285–15385）

这是本次审计的核心目标。以下按"照着重写"的粒度拆开。

#### 3.5.1 签名与入参

```js
function SessionMap(props)              // :14798
props = { engagement: string, refreshKey: number }
```
- `engagement` 非字符串时归一为 `''`（`:14799`）；`refreshKey` 缺省 0（`:14800`）。
- **无 `onPick` 回调**。点节点只改本地 `selectedId`，**不切换任何会话**（这是与社区版的关键差异，见 §7）。

#### 3.5.2 本地 state（15 个，`:14801`–`:14819`）

| state | 初值 | 用途 |
|---|---|---|
| `snapshot` | null | 一次成功读取的完整结果 |
| `selectedId` | null | 当前选中节点 |
| `query` | `''` | 搜索框（即时生效，不做 debounce） |
| `activity` | `'all'` | 状态筛选 `all\|running\|idle\|unknown` |
| `zoom` | 1 | 画布缩放 |
| `paused` | false | 暂停自动刷新 |
| `loading` | false | 读取中 |
| `error` | null | 最近一次错误 message |
| `pausedAt` | null | 进入暂停的时刻 |
| `clock` | `Date.now()` | 暂停态每秒推进，用来算"暂停超过 60 秒" |
| `pan` | `{x:0,y:0}` | 画布平移 |
| `expanded` | false | 全屏地图 |
| `dragging` | false | 拖动中（只影响 `data-dragging`） |
| `nodePositions` | `new Map()` | **按靶标隔离**的手工节点位置：`Map<engagement, Map<sessionId,{x,y}>>` |

refs：`graphRef`、`cameraRef`、`inFlightRef`、`requestRef`、`generationRef`、`mountedRef`、`snapshotRef`、`graphViewportRef`、`mapRef`、`dragRef`、`suppressClickRef`、`expandedRef`。

#### 3.5.3 数据来源：**两个请求，串行**

**第一请求（必需）：插件自己的绑定表**

```js
fetch('/redteam/api', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ op: 'sessionBindings', engagement }),      // :14761
  signal: controller.signal,
})                                                                   // :14758
```
- 校验：`body.ok === true` 且 `body.agents` 是普通对象，否则抛 `session-bindings-invalid`（`:14768`）。
- 超时 6000 ms（`SESSION_MAP_REQUEST_TIMEOUT_MS`，`:14721`），超时抛 `session-bindings-timeout`（`:14772`）。
- 响应体用 `readSessionMapJson` 读，上限 **4 MiB**（`:14689`）。

**第二请求（条件）：宿主内部 RPC**

```js
fetch('/api/session/list', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    type: 'client-request',
    rpcId,                                   // 'rt-session-map-<base36 ts>-<base36 seq>'
    method: 'session/list',
    payload: { args: { _request: {} } },      // 宿主签名只有一个保留参数 _request
  }),
  signal: controller.signal,                  // 与第一请求共用同一个 controller
})                                            // :14731–:14741
```
- `rpcId` 生成器 `nextSessionMapRpcId()`（`:14716`）：模块级自增 `SESSION_MAP_RPC_SEQ` + `Date.now().toString(36)`。
- 只在 `bindingResponse` 成功 **且** `scopeSessionSummaries([], binding, eng).rootIds.length > 0` 时才发（`:14891`–`:14897`）。没有绑定根会话就**不发**，直接提交空快照并 `reason='no-bound-roots'`。

#### 3.5.4 `read()` 状态机（`:14869`–`:14930`）

```
if (!engagement || inFlightRef.current) return          // 单飞，不排队
generation = generationRef.current
controller = new AbortController(); requestRef = controller; setLoading(true)
current() = mountedRef && generation 未变 && requestRef === controller

phase1: requestSessionMapBindings(engagement, controller)
  ├ current() 为假 → return null
  ├ ok === false  → throw
  ├ scopeSessionSummaries([], binding, eng).rootIds.length === 0
  │    → commit({sessions:[],orphans:[],rootIds:[],reason:'no-bound-roots',
  │             engagement, sourceObservedAt:Date.now(), stale:false, error:null})
  │    → return null（不再发第二请求）
  └ phase2: requestSessionMapSummaries(controller)
        ├ current() 为假 → return null
        └ scoped = scopeSessionSummaries(items, binding, eng)
          next = {...scoped, engagement, sourceObservedAt:Date.now(), stale:false, error:null}
          if (listResult.sourceUpdatedAt !== undefined) next.sourceUpdatedAt = ...
          commit(next)

catch(reason):
  ├ current() 为假 或 reason.name === 'AbortError' → 静默返回
  └ setError(message)
    if (snapshotRef.current) → 复制成 {...last, stale:true, error:message} 并提交   // 保留上次快照
finally:
  if (!current()) return
  inFlightRef.current = false; requestRef.current = null; setLoading(false)
```

`commit(next)`（`:14879`）只做三件事：写 `snapshotRef`、`setSnapshot`、`setError(null)`。**不碰 `selectedId`**。

#### 3.5.5 三个 effect

| 行 | 依赖 | 行为 |
|---|---|---|
| `:14932`–`:14956` | `[engagement, read]` | **切靶标即清空**：`generationRef+1`、abort 在途、`inFlightRef=false`、`snapshotRef=null`、`setSnapshot(null)`、`setSelectedId(null)`、`setQuery('')`、`setActivity('all')`、`setZoom(1)`、`setPan({0,0})`、`dragRef=null`、`setError(null)`、`setPausedAt(paused ? Date.now() : null)`、`setClock(Date.now())`；最后 `if (engagement) read()`。cleanup 再 `generationRef+1` + abort |
| `:14958`–`:14960` | `[refreshKey, engagement, read]` | **只重读，不清作用域、不清选中**：`if (refreshKey && engagement) read()` |
| `:14962`–`:14966` | `[engagement, paused, read]` | `paused` 为假时 `setInterval(read, 5000)` |
| `:14968`–`:14971` | `[paused]` | `paused` 为真时 `setInterval(() => setClock(Date.now()), 1000)` |
| `:14974`–`:14979` | `[snapshot]` | 选中项失效则回落到 `sessions[0].id`；空列表则 `null` |

**"陈旧数据"的完整判据**（这是本组件最讲究的一处）：

```js
const activeSnapshot = snapshot && snapshot.engagement === engagement ? snapshot : null   // :14982
const pausedStale    = !!(paused && pausedAt && clock - pausedAt >= 60000 && activeSnapshot)  // :14999
const displayedStale = !!(activeSnapshot && (activeSnapshot.stale || pausedStale))       // :15000
const liveSessionIds = new Set(!displayedStale && !paused
  ? graph.nodes.filter(n => n.activity === 'running').map(n => n.id) : [])              // :15001
```

即：**一旦 `displayedStale` 或 `paused`，全部"运行中"的视觉信号（光圈、流动线、live-ring）一律熄灭**，并且统计卡标签前加 `上次读取 · `（`:15140`），节点 meta 前加 `上次：`（`:15297`）。

`snapshot.engagement === engagement` 这一层（`:14982`）是为了"避免切换靶标后有一帧旧作用域泄漏"——因为 effect 在 paint 之后才跑。

#### 3.5.6 布局算法 `layoutSessionMap(items)`（`:14608`–`:14658`）

**确定性二维树布局**，无随机、无外部布局库。

```
常量：NODE_WIDTH=292 (:14286), NODE_HEIGHT=110 (:14287)
前置校验：
  rows.length > 300            → throw 'session-map-too-large'      (:14610)
  item 非对象 / id 非非空串     → throw 'session-id-invalid'         (:14614)
  id 重复                      → throw 'duplicate-session-id'       (:14616)
  assertSessionMapParentGraph  → 有环则 throw 'parent-cycle'        (:14619 → :14294)

children = Map<id, item[]>；roots = []
for item: parentId 是字符串且 children 里有该 parentId → 挂到父；否则 push 到 roots
          （即"父节点不在快照里"的行会被当成根，不是丢弃）

let row = 0, maxDepth = 0
place(item, depth):
  childNodes = children.get(item.id).map(c => place(c, depth+1))
  y = childNodes.length
        ? (childNodes[0].y + childNodes[childNodes.length-1].y) / 2   // 父 = 首末子节点的 y 中点
        : 40 + (row++) * 158                                          // 叶子占一行，行距 158
  maxDepth = max(maxDepth, depth)
  node = {...item, x: 40 + depth*350, y, depth}                       // 层距 350
  nodes.push(node)
  for child of childNodes: edges.push({
    from: item.id, to: child.id,
    x1: node.x + 292, y1: y + 55,          // 父右侧中点
    x2: child.x,      y2: child.y + 55,    // 子左侧中点
  })
  return node

for root of roots: place(root, 0); row += 0.3     // 根之间额外留 0.3 行
width  = max(600, 80 + maxDepth*350 + 292)
height = max(440, 80 + row*158)
```

注意 `row += 0.3` 是**浮点**，所以多个根时 y 会出现小数（SVG 允许）。

**边**用三次贝塞尔（`sessionMapEdgePath`，`:14603`）：`M x1 y1 C (x1+bend) y1, (x2-bend) y2, x2 y2`，`bend = (x2-x1)/2`。

**手工位置覆盖** `positionSessionMap(graph, positions)`（`:14663`–`:14686`）：按 `positions: Map<id,{x,y}>` 覆盖节点坐标，然后**重算所有边的端点**，并算出 `minX/minY`（各减 40）与新的 `width/height`（`max(600, maxRight+40-minX)` / `max(440, maxBottom+40-minY)`）。

#### 3.5.7 过滤 `selectSessionMapVisible(items, query, activity)`（`:14542`–`:14572`）

- `q = String(query||'').trim().toLocaleLowerCase()`；`status` 只接受 `running|idle|unknown`，否则 `'all'`。
- 匹配文本 = `[id, label, subagentLabel, currentTask, cwd, ...todos.map(content)]` 里所有字符串用 `\n` 连接，再 `toLocaleLowerCase().includes(q)`。
- **命中行 + 全部已知祖先** 都进可见集（`:14560`–`:14570`），祖先记进 `context` 数组。
- 返回 `{sessions, matches, context}`。

#### 3.5.8 统计 `summarizeSessionMap(items, selectedId)`（`:14578`–`:14601`）

```
counts = {total: items.length, running:0, idle:0, unknown:0}   // activity 不是 running/idle 的都算 unknown
childCounts = Map<parentId, n>                                  // 只统计父节点在 items 里的
ancestors = 从 selected 沿 parentId 上溯（带 seen 防环），unshift 保持根在前
parent   = byId.get(selected.parentId) || null
children = items.filter(i => i.parentId === selectedId)
```

#### 3.5.9 缩放与相机

- `fit(mode, layout)`（`:15013`）：`available = max(180, clientWidth-18)` / `max(180, clientHeight-18)`；`fitted = clamp(min(aw/w, ah/h), 0.08, 1.6)`；`mode==='readable'` 时 `zoom = max(0.8, fitted)` 并把选中节点（无选中则取 `depth===0` 第一个）放到视口 1/3 处；否则居中。
- `changeZoom(amount, point)`（`:15035`）：`next = clamp(zoom*amount, 0.08, 2.4)`；以 `point`（缺省视口中心）为锚点重算 pan：`x' = ax - (ax-px)*next/zoom`。**同时写 `cameraRef.current`**，因为原生 wheel 事件可能在 React 提交前连续到达（`:15044`）。
- 滚轮：`bindSessionMapWheel`（`:15103`）用**原生** `addEventListener('wheel', …, {passive:false})`，因为 React 的 wheel 是 passive 的，拦不住外层滚动。`delta = clamp(deltaY*unit, -120, 120)`，`unit` 按 `deltaMode` 取 1/16/clientHeight；缩放因子 `Math.exp(-delta*0.002)`。
- `ResizeObserver` 监听视口，尺寸变化重跑 `fit`（`:15027`–`:15034`）；依赖 `[engagement, autoGraph.width, autoGraph.height, query, activity, expanded, !!activeSnapshot]`。

#### 3.5.10 交互

| 手势 | 行为 | 行 |
|---|---|---|
| 点节点 | `onClick` → `if (!suppressClickRef.current) setSelectedId(node.id)` | `:15272` |
| 拖节点 | `pointerdown` 记录起点；移动超过 4px 才置 `suppressClickRef=true` 并 `setDragging(true)`；位移除以 `zoom` 换算回画布坐标；`setPointerCapture` | `:15060`–`:15090` |
| 拖空白 | 平移 `pan`；同样 4px 阈值 | `:15213`–`:15226` |
| 方向键（画布） | 平移 ±50 | `:15195`–`:15201` |
| 方向键（节点） | 微调位置：默认 10px，Shift 50px；并 `setSelectedId` | `:15277`–`:15288` |
| Enter / Space（节点） | `setSelectedId` | `:15285` |
| Esc | 退出全屏（仅 `expanded` 为真时；`stopPropagation`） | `:14847`–`:14855` |
| 全屏 | `toggleFullscreen`：先 `setExpanded(true)`，再尝试 `element.requestFullscreen()`，失败静默保留 CSS 全屏 | `:14836`–`:14845` |
| 重置布局 | 删掉 `nodePositions.get(engagement)` 并 `fit('all', autoGraph)` | `:15171`–`:15178` |
| 暂停 | 切 `paused`，记 `pausedAt`，重置 `clock` | `:15181`–`:15190` |

#### 3.5.11 空态与错误态（逐字）

`emptyMessage`（`:15093`–`:15101`），优先级从上到下：

| 条件 | 文案 |
|---|---|
| `!engagement` | `请选择项目后查看会话地图。` |
| `reason === 'no-bound-roots'` | `当前项目尚未绑定会话。` |
| `!activeSnapshot` | `loading ? '正在读取项目会话…' : '尚未成功读取项目会话。'` |
| `activeSnapshot && scoped.length === 0` | `已读取项目绑定，但宿主会话列表中未找到对应记录。` |
| 否则 | `null`（画图） |

错误条（`:15196`–`:15202`）：

- 有 `error` 或 `activeSnapshot.error` → `(有快照 ? '读取失败，保留上次快照；不会宣称当前在线：' : '读取失败，尚无成功快照；不会宣称当前在线：') + message`
- 否则若 `pausedStale` → `自动刷新已暂停超过 60 秒；当前快照可能已过时。`

详情栏无选中时：`filtered.sessions.length ? '选择一个节点查看详情。' : '当前筛选没有匹配节点。'`（`:15378`–`:15380`）。

#### 3.5.12 详情栏（`:15303`–`:15378`）

| 分区 | 字段 | 数据来源 |
|---|---|---|
| 标题 | `declaredRole` 中文 / `parentId` 有则"子会话"否则"根会话"；名称；状态点 + `sessionMapActivityLabel`；`宿主目录时间：` + `sessionMapTime(updatedAt)`（title 提示"宿主目录时间取创建时间与最近提示消息时间的较大值，不代表运行状态变化时间"） | `:15306`–`:15313` |
| 状态解释 | running / idle / unknown 三套固定文案 | `:15314` |
| 执行信息 | 会话模式 / 宿主智能体（`agentAvailable`）/ 子会话创建（`childCatalog.createdAt`）/ 已结束轮次活动（`settledMs`）/ 本轮已记录活动（`through - since`）/ 最近关闭轮次（`lastTurnCompleted`） | `:15318`–`:15328` |
| 任务与待办 | `currentTask`、`progressbar`（`completed/total`）、`ol` 逐条 `[已完成\|进行中\|待处理] + content`，`truncated` 时加"内容超出 500 字展示上限" | `:15328`–`:15341` |
| 会话关系 | 祖先路径按钮、父会话按钮、每个子会话按钮；点击均只 `setSelectedId` | `:15343`–`:15358` |
| 完整会话资料 | 名称来源 / 会话标题 / 宿主标题摘要 / 摘要来源 / 子会话名称 / 原标题 / 会话编号 / 父会话 / 工作目录 / 会话格式 / 会话来源 / 记录时间 / 运行依据 / 进行中待办 / 待办进度 / **交接 = `宿主未提供`** | `:15354`–`:15377` |

`SESSION_MAP_UNKNOWN = '宿主未提供'`（`:14290`）。

#### 3.5.13 页脚（`:15379`–`:15383`）

四段：`本地观察时间：sourceObservedAt` / `宿主元数据时间：sourceUpdatedAt` / 手势提示 / `光点与光圈表示运行中；连线仅表示父子关系。只读观察；现有并发卡片仍使用旧计数口径，可能与此图不同。`

#### 3.5.14 它在哪里被渲染

**只有一处**：`AgentsTab`（`client.js:15477`）

```js
h(SessionMap, { engagement: eng, refreshKey: refreshKey })     // :15477
```

上下文是"智能体"页签 → `rt-collab-section rt-collab-scope` → 标题「当前项目会话」+ 副标题「只读观察当前项目绑定的宿主会话；运行状态每 5 秒刷新一次。」+ 徽章「只读观察」（`:15471`–`:15476`）。

**注意**：`AgentsTab` 属于"全局页"，在 `!eng` 判断之前分发（`:15949`），所以没有靶标时也会渲染 `SessionMap`，此时 `engagement=''` → 走"请选择项目后查看会话地图。"

### 3.6 入口：`OverviewTab(props)`（`client.js:10348`–`10615`，268 行）

#### 3.6.1 数据来源（5 个并发 + 1 条轮询）

```js
Promise.all([
  api({op:'scoreChain',   engagement: eng}),   // :10366
  api({op:'scores',       engagement: eng}),   // :10367
  api({op:'sessions',     engagement: eng}),   // :10368
  api({op:'agentsStatus'}),                    // :10369
  api({op:'attention',    engagement: eng}),   // :10370
])
```
- **只有 `scoreChain` 失败会让整页报错**（`if (!c || c.ok === false)`，`:10374`）；其余 4 个失败各自置 `null`，页面继续渲染。
- 另开一条 `setInterval(8000)` 只刷 `attention`（`:10383`–`:10390`），不动那 4 个重查询。

#### 3.6.2 四宫格（`rt-ov-facts`，`:10520`–`:10529`）

四个可点按钮，数据全部来自 `snapshot.stats`（即 `Panel` 的 `snapshot` prop，**不是**本页自己请求的）：

| 序号 | 标签 | 字段 | 点击后 |
|---|---|---|---|
| 1 | 资产对象 | `stats.assets` | `onGo('assets')` |
| 2 | 存活资产 | `stats.liveAssets` | `onGo('assets')` |
| 3 | 开放端口 | `stats.openPorts` | `onGo('assets')` |
| 4 | 成果记录 | `stats.vulns` | `onGo('findings')` |

值为 `null`/`undefined` 时显示 `—`（`:10541`）。每个按钮带 `aria-label="查看<标签>：<值|未提供>"`。

#### 3.6.3 得分轨道（`rt-ov-rail`，`:10533`–`:10575`）

- 标题「五阶段进展」+ 副标题「按已有得分记录展示」。
- 数据：`chain.stages`（`scoreChain`）。每阶段渲染 5 层：序号 `i+1`、`name`、`points + ' 分'`、`'累计 ' + cumulative`、占比条。
- `current` 判定（`:10393`）：把 `stages` 逆序扫，取第一个 `cumulative>0 || points>0` 的阶段；都没有则取 `stages[0]`。当前阶段加 `.on`，`points>0` 加 `.has`。
- 占比 = `points / 累计总分`，`clamp(0,100)` 取整；`aria-label="本阶段得分占累计得分 N%"`（`:10570`）。
- 左侧大卡「累计得分」显示 `chain.summary.points`，副标题 `current ? '当前阶段 · '+current.name : '还没有得分记录'`，按钮「查看攻击链 →」→ `onGo('chain')`（`:10534`–`:10552`）。

#### 3.6.4 三张卡（`rt-ov-grid`，`:10551`–`:10636`）

**卡 1 · 得分明细**（`rt-ov-card-wide rt-ov-score-detail`）

两个内部视图（`scoreView` state，`:10360`）：

| 视图 | 标签 | 数值 | 副标 | 列表内容 |
|---|---|---|---|---|
| `current` | 当前得分 | `points + ' 分'` | `已得分 N 项` | `achievedRows`（Top 5） |
| `next` | 下一步得分 | `'Top ' + gaps.length` | `高分缺口` | `gapRows`（Top 5） |

计算（`:10394`–`:10404`）：
```js
allTiers = scores.items?.length ? scores.items
         : (scores.ruleGroups||[]).reduce((a,g)=>a.concat(g.tiers||[]), [])
tierFull(p) = p.cap > 0 && (p.cap_used||0) >= p.cap
gaps     = allTiers.filter(p=>!tierFull(p))
                    .sort((a,b)=>(b.points||0)-(a.points||0)).slice(0,5)
achievedAll = allTiers.filter(p => (p.hits?.length>0) || p.earned>0 || p.counted>0)
                      .sort((a,b)=>(b.earned||b.points||0)-(a.earned||a.points||0))
achieved = achievedAll.slice(0,5)
```
每行：`序号(两位补零)` + 名称 + `规则已用 x / y 分`（`cap===0` 时改为标签「一次性 / 按目标」）+ 进度条 + `+points`。点行 → `onGo('scores')`。空态：`scores ? '还没有已得分项目；点「下一步得分」看缺口。' : '加载中…'` / `scores ? '当前没有可补的高分缺口。' : '加载中…'`。

**卡 2 · 会话与通道**（`rt-ov-entry-card`）

- `metric('WebShell', onlineShells.length + '/' + shells.length, '在线', ...)`，`onlineShells = webshells.filter(x=>x.status==='online')`（`:10411`）。
- `metric('隧道', activeTunnels.length + '/' + tunnels.length, '可用', ...)`，`activeTunnels = tunnels.filter(x=>x.status==='active' && x.legit===true)`（`:10412`）——**必须 `legit===true` 才算**。
- 列表：`activeTunnels.slice(0,3)`，每行 `listen` + `kind` + `reach||'未写可达'`；空态「暂无可用隧道」。
- 右上按钮「会话隧道」→ `onGo('sessions')`。

**卡 3 · 协同与待测**（`rt-ov-team-card`）

- `metric('未评资产', tests.untested||0, '台', untested>0 ? 'warn':'mute')`
- `metric('服务已拿满', scores.summary.serviceCappedHits||0, '条', 'mute')`
- `metric('执行智能体', used===null ? '—' : used+'/'+max, '在跑', used?'ok':'mute')`，`max` 缺省 3（`:10414`）
- 两个按钮：资产测绘 / 智能体。

#### 3.6.5 待办条（`attentionBlock`，`:10464`–`:10529`）

**渲染条件**：`attentionPeople === 0 && attentionGaps === 0` 时**整块返回 null**（`:10464`）——"健康状态不该在首页抢版面"。

- 标题：`attentionPeople > 0 ? '现在需要你决定' : '该派下一个智能体了'`；计数显示 `attentionPeople` 或 `attentionGaps`。
- `STAGE_TEXT` 映射（`:10457`）：

| `it.stage` | 文案 | class |
|---|---|---|
| `person/answer` | 等你解答 | `rt-ov-attn-ask` |
| `person/review` | 等你验收 | `rt-ov-attn-review` |
| `person/blocked` | 卡住了 | `rt-ov-attn-bad` |
| `person/failed` | 失败了 | `rt-ov-attn-bad` |
| `working` | 在跑 | `rt-ov-attn-run` |
| 其它 | 等待 | `rt-ov-attn-run` |

- 每行：`[阶段标签]` + `label || role || session_id` + `reason` + `needs[]` 渲染成 `(kind||'需要') + (detail ? '：'+detail : '')` 的 warn 标签。
- `attentionItems.length===0 && attentionGaps>0` → 「没有智能体在等人，但还有 N 个覆盖度缺口。」
- 底部按钮：
  - `attentionPeople>0` 时显示「填入主会话输入框」：`try { window.__dshPurgeAttentionGo(); return } catch {}`，拿不到钩子则 `onGo('agents')`（`:10497`–`:10504`）。**只填不发**（钩子实现见 `safe/client.js:22972` `fillAttentionPrompt`，已有相同草稿时不重复写）。
  - 恒显示「看智能体」→ `onGo('agents')`、「看下一步得分」→ `onGo('scores')`。

### 3.7 入口：`ArtifactsTab(props)`（`client.js:11502`–`11545`，44 行）

#### 3.7.1 三个并发请求

```js
api({op:'attackFiles', engagement})  .then(r => setFiles((r&&r.items)||[]), () => {})   // :11514
api({op:'credentials', engagement})  .then(r => setCreds((r&&r.items)||[]), () => {})   // :11515
api({op:'access',      engagement})  .then(r => setAccesses((r&&r.items)||[]), () => {}) // :11516
```
**三个请求的失败回调全是空函数**，`err` state 在整个组件里从未被 set → 错误条（`:11528`）是**死渲染**。`busy` 在三个请求发出后立即 `setBusy(false)`（`:11517`），不等返回。

#### 3.7.2 三段折叠

用原生 `<details>`，**不是**受控组件，默认全折叠（无 `open` 属性）：

| 段 | class | summary 文案 | 内容 |
|---|---|---|---|
| 1 | `rt-artifacts-section-credentials` | `凭据 · N（默认脱敏，点开查看）` | `h(CredentialList,{items:creds})` |
| 2 | `rt-artifacts-section-access` | `已获得访问会话 · N` | `h(AccessList,{items:accesses})` |
| 3 | `rt-artifacts-section-files` | `攻击文件 · N` | `h(AttackFilesTab,{engagement,refreshKey})` |

`fileCount = files.reduce((n,g)=>n+(g.files||[]).length, 0)`（`:11519`）——**攻击文件的计数是文件数，不是文件夹数**；而第 3 段内嵌的 `AttackFilesTab` 会**再发一次 `attackFiles`**（`:12398`），即打开这一段会重复请求同一接口。

工具栏三个计数标签：`凭据 N` / `访问会话 N` / `攻击文件 N`（`:11523`–`:11525`）。

#### 3.7.3 `SecretText`（`client.js:592`–`607`）

```js
function SecretText(props) {
  const value = String(props.value ?? '')
  const [shown, setShown] = React.useState(false)
  if (value === '') return h('span', {className:'rt-secret-none'}, props.empty || '未记录')
  return h('span', {className: props.className || 'rt-mono',
                    style:{display:'inline-flex',alignItems:'center',gap:6,maxWidth:'100%'}},
    h('span', {style:{wordBreak:'break-all'}}, shown ? value : '••••••••'),
    h('button', {className:'rt-btn', onClick:(e)=>{e.stopPropagation(); setShown(v=>!v)}},
      shown ? '隐藏' : '显示'))
}
```

- **默认 `••••••••`（8 个 U+2022）**，只有点「显示」才出原值；再点变「隐藏」。
- 空值时**不渲染按钮**，直接显示 `props.empty`（`CredentialList` 传的是 `未记明文 —— 请用 redteam_credential_add 的 secret_value 补上，面板才能直显`）。
- `e.stopPropagation()` 防止在可点卡片里误触发父级。

#### 3.7.4 `CredentialList`（`:11463`–`:11483`）

每条一张 `article.rt-cred.rt-credential-card`：

| 位置 | 字段 |
|---|---|
| header | `host` / `username`(tag) / `secret_type\|\|'password'`(tag) / `privilege`(tag-active) / 「复制」按钮 |
| 密钥行 | `SecretText{value: secret_value}` |
| meta | `来源 source · 工具 tool · 证据 secret_ref · by found_by_agent · fmt(found_at)`，`filter(Boolean).join(' · ')` |
| note | `备注：note` |

「复制」调 `copyText(String(c.secret_value||''))`（`:11475`）——**直接复制原值，不要求先点显示**；`copyText` 返回的布尔被丢弃，**复制失败时界面无任何反馈**。

空态：`暂无凭据（拿到口令/密钥/Hash 后用 redteam_credential_add 落库，秒级可复用）`。

#### 3.7.5 `AccessList`（`:11485`–`:11500`）

每行 `rt-vrow.rt-access-card`：`host`(mono) / `username||'—'` / `method||'—'`(tag-active) / `privilege||'—'` / `session_ref||'—'`(mono, title 提示)。空态「暂无访问会话」。

### 3.8 入口：`ReportTab` → `ReportV2`（`client.js:12148` / `12029`）

#### 3.8.1 两条渲染路径

```js
const report = (data && data.report) || null      // :12203
if (report !== null) return h(ReportV2, {...})    // :12204–12207
// 否则走 legacy 平铺卡片（:12208–12380）
```

即：**宿主返回 `data.report` 才走 V2，否则退回旧版逐条卡片**。这是同一个"报告"页签的两套 UI。

#### 3.8.2 数据来源

`api({op:'scoreReport', engagement})`（`:12161`）。若返回 `stages` 为空但 `items` 非空，**再发一次 `scoreChain`** 并用 `groupByStage(items, chain)` 自行分组（`:12165`–`:12170`，实现 `:12001`）。

#### 3.8.3 "四段式"到底是几段

工具栏标题写的是「红队得分报告（四段式）」（`ReportTab:12322`），`ReportV2` 工具栏写「红队得分报告」（`ReportV2:12117`）。**实际段落数不一致**：

| 口径 | 段落 |
|---|---|
| Markdown 正文（后端生成，前端只折叠展示） | 4 段：资产证明 / 得分汇总 / **凭据汇总** / 得分点复现 —— 见 `ReportTab:12345` 的 summary 文案「详细报告查看（资产证明 / 得分汇总 / 凭据汇总 / 得分点复现）」 |
| `ReportV2` 的 HTML 渲染 | **3 段**：一、资产归属证明 / 二、得分汇总表 / 三、得分点复现 |

**「凭据汇总」这一段在 `ReportV2` 里没有对应渲染**（`:12127`–`:12135` 只有三个 `<section>`）。凭据只作为「二、得分汇总表」的一个**列**出现（`r.credential`，`:12105`–`:12108`），没有独立的凭据汇总段。

#### 3.8.4 `ReportV2` 三段逐段

**一、资产归属证明**（`id="rt-r2-assets"`，`:12127`）

- `proofSection('1.1 互联网资产归属证明', report.asset_proof.internet)`
- `proofSection('1.2 内网入口资产归属证明', report.asset_proof.internal_entry)`
- 每张 `proofCard(g)`：`asset.ip || asset.primary_name || '未命名资产'` + `primary_name` + `type` 标签 + `证明 {strength}`（`strength==='强'` → `rt-tag-live`，否则 `rt-tag-warn`）+ `归属证据 {g.proof||'待补'}` + `ShotStrip` 截图条（无截图时「归属截图待补」）。
- 空态：`未采集到对应资产证据。`

**二、得分汇总表**（`id="rt-r2-scores"`，`:12131`）

- 主表 `table(['阶段','计分项','得分'], stage_summary.map(s=>[s.name, s.count, '+'+s.points]))`
- 然后对每个阶段调 `stageSection(s, i)`（`:12102`）：
  - 标题 `'2.' + (i+1) + ' ' + s.name + '（' + s.count + ' 项 / +' + s.points + ' 分）'`
  - 表头按 `s.code` 三套：
    - `internet` → `['序号','得分点','分值','URL','登录凭据']`，取值 `[seq, point_name, '+'+points, url, credential]`
    - `boundary` → `['序号','得分点','分值','互联网入口点']`，取值 `[seq, point_name, '+'+points, entry]`
    - 其它 → `['序号','得分点','分值','资产','凭据']`，取值 `[seq, point_name, '+'+points, asset, credential]`
  - 空态：`本阶段无得分项。`
- `table()` 里 `null/undefined/''` 一律渲染 `—`（`:12035`）。

**三、得分点复现**（`id="rt-r2-repro"`，`:12135`）

四个子节，各自空态：

| 子节 | 数据 | 空态 |
|---|---|---|
| 3.1 互联网资产得分复现 | `report.repro.internet` | `无互联网资产得分项。` |
| 3.2 互联网边界突破复现 | `report.repro.boundary` | `无边界突破得分项。` |
| 3.3 内网资产得分复现 | `report.repro.internal_segments` | `无内网资产得分项。` |
| 3.4 靶标权限复现 | `report.repro.target` | `无靶标权限得分项。` |

`reproList(list, prefix, kind)`（`:12079`）三种分组形状：
- `kind==='boundary'`：每组 = 一个隧道；标题 `prefix + (i+1) + ' 隧道' + (i+1)`；显示 `入口`、`隧道 kind listen → reach`（缺失时 `隧道记录缺失，需补搭建证据。`）、`隧道建立命令` 代码块。
- `kind==='internet'|'target'`：每组 = 一个资产；标题 `prefix + (i+1) + ' ' + (ip||primary_name||'未命名资产')`。
- 其它（内网）：每组 = 一个网段；标题 `prefix + (i+1) + ' ' + (label||'网段') + ' “' + (cidr||'未归属网段') + '”'`，再按资产二次分组 `prefix + i.a.b`。

`reproItem(x, heading)`（`:12060`）每条渲染：

| 行 | 条件 | 内容 |
|---|---|---|
| 标题 | 恒 | `heading + ' ' + (target || asset_ip || '')` |
| 漏洞说明 | 恒 | `x.vuln ? [cve,title].join(' ') : (x.how || x.point_name)` |
| 漏洞来源提示 | `vuln_source==='step'` | `漏洞关联自攻击步骤，记分时未显式填写` |
| 结果 | `x.evidence` | `结果 {evidence}` |
| 复现命令 | `x.replay_cmd` | 代码块，标签按 `/^(powershell\|pwsh)/i` 判 `PowerShell` / `Bash / 命令` |
| HTTP 报文 | `x.requests[0..2].request` | 最多 3 条，标签 `Yakit / HTTP 报文 N` |
| **复现缺口** | 既无 `replay_cmd` 也无任何 `requests[].request` | `复现缺口：没有留存真实命令或 HTTP 报文。` |
| 攻击文件 | `x.attack_files.length` | `attack_files.map(f=>f.path).join('、')` |
| 证据文件 | 任一 `step.evidence_ref` | 去重后 join `、` |
| 复现截图 | `x.shots.length` | `ShotStrip` |
| 复现材料 | `x.gaps.length` | `复现材料：` + `gaps.join('；')` |

#### 3.8.5 导出路径

两条，都由 `ReportTab` 提供并透传给 `ReportV2`：

**复制全文**（`copy`，`:12178`）→ `copyWithFeedback(mdText, '整份报告', cb)`；`copyText`（`:10286`）先试 `navigator.clipboard.writeText`（`:10290`），失败回落 `textarea + document.execCommand('copy')`（`:10304`）；两条都失败返回 `false`，界面提示 `复制失败（浏览器未授权剪贴板）—— 请手动选中文本复制`（`:10318`）。按钮 `disabled = busy || !mdText`。

**下载 .md**（`download`，`:12181`–`:12200`）：

```js
const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
const url = URL.createObjectURL(blob)
const a = document.createElement('a'); a.href = url
const safe = String(label || 'score')
  .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
  .replace(/\s+/g, ' ').trim().slice(0, 80) || 'score'
a.download = 'report-' + safe + '.md'
a.click()
URL.revokeObjectURL(url)
```
文件名 = `report-<靶标名>.md`（`label` 传的是 `report.target || eng`，`:12134`）。`a` 未插入 DOM 即 `click()`，在部分浏览器会失败——失败被 `try/catch` 捕获并提示 `下载失败：…`。

#### 3.8.6 工具栏指标（`ReportV2:12117`–`:12135`）

`合计 N 分`（`summary.points`）/ `N 项得分`（`summary.count`）/ `可复现 X/N`（`summary.count - summary.incomplete`，`incomplete>0` 时转 warn）/ 「复制全文」/「下载 .md」/「重新生成」。

### 3.9 其余 9 个页签（按模板第 3 节要求，每入口一小节）

#### 3.9.1 `AssetsTab`（`:10616`–`11083`，468 行）

- **入口签名**：`AssetsTab({engagement, snapshot, refreshKey, onRefresh, onData})`。
- **数据**：`api({op:'assets', engagement, cidr, q, service, port, provenance, test_status, priority, scope, state, sort, limit:400})`（`:10650`–`:10656`）；`op:'domains'`（`:10673`）；`op:'web'`（`:10680`）；详情 `op:'asset'`（`:10697`）。
- **并发守卫**：`seq` 自增，旧响应 `if (my !== seq.current) return` 丢弃（`:10658`）。
- **判据**：`cidr` 非空则只看该 C 段；`view` 决定 pane（`:11060`–`:11065`）。
- **失败路径**：`setState({loading:false, error, total:0, items:[]})`，保留上次 `items` 不保留——即**清空列表**。
- **空态**：`没有匹配的资产` / `加载中…` / `该 C 段下暂无域名（切换到「全部 C 段」看全量）` / `暂无域名数据（信息收集阶段会写入域名）` / `该 C 段下暂无 Web 资产` / `暂无 Web 资产（HTTP 探测后会写入 URL 与标题…）`。

#### 3.9.2 `DiscoveryView`（`:11084`–`:11136`，53 行）

`op:'discoveryTimeline'`（`:11093`）。按天列出新增资产；`day` state 选某天。空态：`还没有资产。` / `这一天没有新增资产。` / `加载中…`。

#### 3.9.3 `PromptsTab`（`:11137`–`:11228`，92 行）

`op:'prompts'`（有靶标带 `engagement`，无靶标不带，`:11148`）、`op:'savePrompt'`（`:11165`）、`op:'resetPrompts'`（`:11179`）。
判据：`save()` 与 `reset()` 开头都 `if (!eng) { setMsg({err:'请先创建靶标…'}); return }`（`:11162`、`:11177`）。
副作用：保存成功后**本地就地合并** `roles`（不改 `content` 以外的字段）并 `setMsg({ok:'已保存'})`，不重发 `prompts`；`reset` 成功后**会重发** `prompts`（`:11185`）。
提示文案提到「四个角色全部恢复默认」，而 `ROLE_LABEL` 有 6 个角色（`:10178`）——文案与角色数不一致，实际恢复范围由后端 `resetPrompts` 决定。

#### 3.9.4 `SkillsTab`（`:11229`–`:11405`，177 行）

`op:'skillCatalog'`（`:11245`，带 `refresh`）、`op:'skillRead'`（`:11271`）。分组：`红队技能`（`library!=='official'`）/ `官方技能`（`library==='official'`）。空描述回落 `暂无描述，选择后查看技能正文。`。

#### 3.9.5 `FindingsTab`（`:11546`–`:11817`，271 行）

`op:'vulns'`（`:11568`，参数 `severity/status/q/limit:200`）、`op:'attackFiles'`（`:11577`）、`op:'updateVuln'`（`:11583`）。
- 两个视图：`grouped`（按目标聚合，默认 true）/ 平铺（`:11790`–`:11794`）。
- **子页签是死的**：`subTab` state 初值 `'vulns'`（`:11560`），全文件唯一的写入点是 `subTabBtn('vulns', …)` 自己的 `clickable(() => setSubTab(key))`（`:11780`），`key` 恒为 `'vulns'`。注释写的「漏洞 / 凭据 / 访问会话」（`:11559`）只有第一个被实现，凭据与访问会话实际是**内联在页面下部**渲染（`:11744`、`:11770`）。点这个子页签 = 把 `'vulns'` 设成 `'vulns'`，**无任何视觉变化**。
- 空态：`暂无漏洞记录`（两处）、`暂无凭据（…）`、`暂无`、`该模块的宿主代码已更新，需重启一次当前宿主（官方 exe / 社区版 / dsh web）后生效`。

#### 3.9.6 `ChainTab`（`:11817`–`:12028`，212 行）

`op:'scoreChain'`（`:11829`）。两个视图：`view='A'` 竖向逐阶段（`.rt-ap`）/ `view='B'` 横向一屏（`.rt-ap-h`）（`:11988`–`:11990`）。单条命中可展开 `hitDetail`（`:11838`）。空态：`还没有得分记录。拿到成果后用 redteam_score_hit 记分，这条链才会长出来。`
计分口径文案：`x.capped` 时标签「服务已拿满 · 不计分」并 `title=x.capped_reason`；`x.counted` 为假时显示 `+0`（`:11862`–`:11864`）。

#### 3.9.7 `AttackFilesTab`（`:12386`–`:12469`，84 行）

`op:'attackFiles'`（`:12398`）、`op:'readAttackFile'`（`:12410`）。按 `folder` 分组，`Section` 折叠状态存 `files:<eng>`。点文件行展开/收起详情（`detail.id === f.id` 切换）。详情字段：`效果 evidence` / `路径 path` / `记录 fmt(created_at) + created_by` / `pre content`。
空态：`暂无攻击文件（打通的脚本/POC/EXP 会按目标文件夹出现在这里）`；文件夹内空：`（空）`。
`FILE_KIND = {poc:'POC', exp:'EXP', script:'脚本', wordlist:'字典', other:'其他'}`（`:12384`）。

#### 3.9.8 `KnowledgeTab`（`:12470`–`:12744`，275 行）

`op:'pocSearch'`（`:12504`）、`op:'pocGet'`（`:12520`）、`op:'pocUse'`（`:12532`）。参数：`q/kind/category/engagement/asset_target/verified/templateOffset/templateLimit:40`（`:12489`–`:12500`）。**检索是显式动作**，不随输入即时请求（`:12502` 注释）。
两个结果区：本机沉淀 POC/EXP（按 `category` 分组）+ 本机 nuclei 模板（分页 40/页，`:12700`）。
空态四套（`:12720`–`:12733`）：`加载中…` / `没有命中：换个关键字再试，或去互联网找 / 自己手搓后回填。` / `POC/EXP 库还是空的；本机已有 N 个 nuclei 模板。…` / `知识库还是空的（本机模板目录在，但还没有 yaml）。…` / `知识库还是空的。点「应用」后会自动建库并下载 nuclei 模板，重启后再打开本页就会出现「本机模板 N」。`

#### 3.9.9 `EnvTab`（`:13188`–`:13523`，336 行）

`op:'platformConfigGet'`（`:13239`）、`op:'platformConfigSave'`（`:13262`）、`op:'platformAssignToolkit'`（`:13275`）、`op:'intelStatus'`（`:13204`）、`op:'intelRefresh'`（`:13208`）。
三个内部章节（`settingsSection`）：`overview 运行概况` / `config 配置表单` / `diagnostics 高级诊断`（`:13356`）。
`draft` 形状（`:13230`–`:13240`）：`{platform, toolkitDir, nucleiTemplatesDir, binDirsText, tools:{}, env:{FOFA_KEY, REDTEAM_VPS_HOST, REDTEAM_VPS_KEY}, notes}`。
判据：`保存` 按钮 `disabled = busy || !draft`，并且 `hidden: settingsSection === 'proxy'`（`:13328`）——**`'proxy'` 永远不会是当前章节**（nav 只有三个），所以这个 `hidden` 条件恒为假，是死条件。
空态：`加载中…`（`:13428`）。

#### 3.9.10 `ScoreTab`（`:13524`–`:13818`，395 行）

`op:'scores'`（`:13538`）、`op:'saveScorePoint'`（`:13562`）、`op:'deleteScorePoint'`（`:13582`）。
三个视图（`scoreView`）：`achieved 已得分` / `gap 高分缺口` / `all 全部 N`（`:13740`–`:13755`）。
内置得分点（`builtin===true`）只允许改「启用/停用」，分值/名称/分类输入框置灰并给长解释（`:13757`–`:13772`）。
空态：`暂无得分点，点右上角「新增得分点」`。

#### 3.9.11 `TestingTab`（`:13919`–`:14056`，138 行）

`op:'activeTests'`（`:13937`，`limit:20`）。5 秒轮询 + `inflight` 单飞 + `seq` 过期丢弃（`:13926`–`:13941`）。三段 `Section`：`正在测`（常显，默认开）/ `最近动过`（默认折叠）/ `待测队列`（默认折叠）。折叠键 `testing:<eng>` / `recent:<eng>` / `queue:<eng>`。
**可达性**：只从 `AssetsTab` 的「网段视图」侧栏「当前测试」进入（`:10712`–`:10717`），而侧栏默认隐藏（`showSegments=false`）——需要先点「网段视图」。

#### 3.9.12 `SessionTab`（`:14057`–`:14797`，741 行）

`op:'sessions'`（`:14068`）、`op:'probeSessions'`（`:14078`，`timeoutMs:6000`）、`op:'updateTunnel'`（`:14097`）、`op:'updateWebshell'`（`:14102`）。
三条"提示条"（`hint`）按判据生成：
- 有非加密马 → `有 N 个入口不是冰蝎马/哥斯拉马（用户连不上，不算可交付入口）`；判定 `isEncryptedShell = /behinder|godzilla|冰蝎|哥斯拉/i`（`:14088`）。
- 有通道但全 `legit!==true` → `现有 N 条通道都不算"跨越靶标边界"…`。
- 有 WebShell 但无 active suo5 → `还没有可用的 suo5 隧道（打进内网的标准通道）`；`isSuo5 = /suo5/i`（`:14089`）。
复制用 `copy(key, text)` + 1.5s 后清除「已复制」标记（`:14083`–`:14087`）。

### 3.10 入口：`RtBoundary`（`:15392`–`:15415`）

class 组件错误边界，包住**页签体**。`getDerivedStateFromError` 记 `error`；`componentDidCatch` 只 `console.error('[redteam-ui] 页面渲染出错:', error)`。
渲染：`该页面渲染出错：<message>` + 按钮「回到资产测绘」→ `setState({error:null})` + `setUI({tab:'assets'})`（`:15411`）。
**判据**：只捕获子树渲染期异常，不捕获事件处理器与异步异常。

---

## 4. 对外接口

### 4.1 模块导出

| 类型 | 名称 | 入参 | 出参 | 调用方 |
|---|---|---|---|---|
| 浏览器模块 | `id: 'dsh-purge-safe'` | factory(require) | module.exports | `window.__ModuleLoader__` |
| export | `apply(ctx)` | Cordis ctx | void（只注入 CSS） | 模块加载器 |
| export | `inject` | — | `['slots']` | 模块加载器 |
| 组件（未导出，供内联方引用） | `Panel` | `{embedded,sessionId,sessionTitle}` | React 元素 | `safe/client.js:22648` |

### 4.2 HTTP op（全部 `POST /redteam/api`）

`api()` 定义 `client.js:10115`：`fetch('/redteam/api', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(req)})` → `readApiJson`。

`readApiJson`（`:10099`）把三种坏响应统一转成 `{ok:false, error}` 中文文案：

| 情况 | 返回 |
|---|---|
| 空 body | `服务端返回空响应（HTTP <status>），请完全退出 dsh 后重新打开` |
| JSON 但不是对象 | `服务端返回内容格式不对（HTTP <status>）` |
| 不是 JSON | `服务端返回的不是 JSON（HTTP <status>），路由可能未加载` |
| fetch 抛错 | `请求演练台接口失败：<message>` |

**49 个 op**（按字母序；"可达"指能否从 UI 触发）：

| op | 调用行 | 用途 | 可达 |
|---|---|---|---|
| `access` | 11516 | 访问会话列表 | 是 |
| `activateEngagement` | 16051 | 切当前靶标 | 是（靶标下拉） |
| `activeTests` | 13937 | 正在测/最近/待测 | 是（网段视图→当前测试） |
| `agentsStatus` | 10369, 15438 | 并发名额 | 是 |
| `asset` | 10697 | 单资产详情 | 是 |
| `assets` | 10651 | 资产台账查询 | 是 |
| `attackFiles` | 11514, 11577, 12398 | 攻击文件 | 是 |
| `attention` | 10370, 10386 | 待办 | 是 |
| `bindSessionEngagement` | 16049 | 会话绑靶标 | 是（跟随条） |
| `bootstrap` | 15722, 15760, 15794 | 靶标名册 | 是 |
| `consoleDigest` | 15855 | 未读摘要 | 是 |
| `credentials` | 11515 | 凭据 | 是 |
| `deleteScorePoint` | 13582 | 删得分点 | 是 |
| `discoveryTimeline` | 11093 | 按天发现 | 是 |
| `domains` | 10673 | 域名视图 | 是 |
| `intelRefresh` | 13208 | 刷模板/KEV | 是 |
| `intelStatus` | 13204 | 模板年龄/KEV | 是 |
| `openEngagement` | 15783 | 建靶标 | 是 |
| `platformAssignToolkit` | 13275 | 整包目录自动分配 | 是 |
| `platformConfigGet` | 13239 | 读环境配置 | 是 |
| `platformConfigSave` | 13262 | 写环境配置 | 是 |
| `pocGet` | 12520 | POC 详情 | 是 |
| `pocSearch` | 12504 | 知识库检索 | 是 |
| `pocUse` | 12532 | 标记已用 | 是 |
| `probeSessions` | 14078 | 实测通道连通 | 是 |
| `prompts` | 11148, 11183, 15431 | 角色提示词 | 是 |
| `proxyConfigImport` | 12988, 13007 | 导入代理 YAML | **否**（在 ProxySettings 内） |
| `proxyPoolDisconnect` | 12973 | 断开代理 | **否** |
| `proxyPoolGet` | 12854, 12870 | 读代理池 | **否** |
| `readAttackFile` | 12410 | 读文件正文 | 是 |
| `resetPrompts` | 11179 | 恢复默认提示词 | 是 |
| `savePrompt` | 11165 | 存提示词 | 是 |
| `saveScorePoint` | 13562 | 存得分点 | 是 |
| `scoreChain` | 10366, 11829, 12166 | 攻击链 | 是 |
| `scoreReport` | 12161 | 得分报告 | 是 |
| `scores` | 10367, 13538 | 得分点 | 是 |
| `sessionBinding` | 15744 | 单会话绑定 | 是 |
| `sessionBindings` | 14761 | 全部绑定（SessionMap） | 是 |
| `sessions` | 10368, 14068 | WebShell/隧道 | 是 |
| `setAgentsMax` | 15545 | 改并发上限 | 是 |
| `shotData` | 10190 | 截图 base64 | 是（按需） |
| `skillCatalog` | 11245 | 技能目录 | 是 |
| `skillRead` | 11271 | 技能正文 | 是 |
| `snapshot` | 15714 | 靶标快照 | 是 |
| `updateTunnel` | 14097 | 改隧道状态 | 是 |
| `updateVuln` | 11583 | 改漏洞状态 | 是 |
| `updateWebshell` | 14102 | 改马状态 | 是 |
| `vulns` | 11568 | 漏洞列表 | 是 |
| `web` | 10680 | Web 资产视图 | 是 |

另有一批走 `run('xxx', …)` 的 op 名（只在 `ProxySettings` 内，同样不可达）：`proxyPoolSave`(13067)、`proxyPoolConnect`(13068)、`proxyPoolTest`(13077)、`proxyProfilesDelete`(13090)、`proxyProfileDelete`(13110)、`proxyProfileTest`(13113)、`proxyProfileConnect`(13114)、`proxyProfileSave`(13159)、`proxyPoolImport`(13171)。

### 4.3 事件 / 全局钩子

| 类型 | 名称 | 方向 | 说明 |
|---|---|---|---|
| window 全局函数 | `window.__dshPurgeAttentionGo` | 读 | 由 `safe/client.js:23005` 提供；本文件 `:10499` 调用，失败回落 `onGo('agents')` |
| window 事件 | `rt-open-full` | 派发+监听 | 派发 `requestFullInPlace`(`:10084`)；监听 `Panel` effect (`:15926`) |
| DOM 事件 | `fullscreenchange` | 监听 | `SessionMap` `:14851` |
| DOM 事件 | `keydown` | 监听 | `SessionMap` Esc 处理 `:14852` |
| DOM 事件 | `wheel` (native, passive:false) | 监听 | `SessionMap` `:15120` |
| URL hash | `#redteam-full` | 读 | `isFullWindow()` `:10084` |

### 4.4 无 slot

本文件不注册任何 slot（§1.2）。

---

## 5. UI 触点

### 5.1 顶层 6 组 / 12 页签

| 组 | 页签 key | 标签 | 组件 | 文件:行 | 依赖 op | 主要展示字段 | 空态 |
|---|---|---|---|---|---|---|---|
| 工作总览 | `overview` | 态势 | `OverviewTab` | 10348 | scoreChain, scores, sessions, agentsStatus, attention + prop `snapshot` | 四宫格 `stats.{assets,liveAssets,openPorts,vulns}`；五阶段 `stages[]`；累计 `summary.points`；WebShell/隧道在线数；`used/max`；`attention.items[]` | 各卡内独立空态；待办条清空时整块不渲染 |
| 资产台账 | `assets` | 资产测绘 | `AssetsTab` | 10616 | assets, domains, web, asset | `items[].{ip,primary_name,open_ports,vulns,webshells,tunnels,priority,test_status,scope,segment_cidr}`；`snapshot.stats.*`；`tests.*` | `没有匹配的资产` |
| 协同进度 | `agents` | 智能体 | `AgentsTab` | 15421 | prompts, agentsStatus, setAgentsMax + `SessionMap` | 并发 `used/max/parked`；6 张角色卡；`ConcurrencyCard`；`SessionMap`；内嵌 `PromptsTab` | 无（角色卡是硬编码常量） |
| 成果与报告 | `findings` | 漏洞战果 | `FindingsTab` | 11546 | vulns, attackFiles, updateVuln | `items[]`、`total`、`stats`；分组视图 | `暂无漏洞记录` |
| 成果与报告 | `chain` | 攻击链 | `ChainTab` | 11817 | scoreChain | `stages[]`、`items[].{point_name,points,counted,capped,target,nth_of_point}` | `还没有得分记录。…` |
| 成果与报告 | `scores` | 得分目标 | `ScoreTab` | 13524 | scores, saveScorePoint, deleteScorePoint | `summary.{achievedPoints,pointCount,countedHits,selfCreatedHits,serviceCappedHits,hitPointCount}`、`items[]` | `暂无得分点，点右上角「新增得分点」` |
| 成果与报告 | `report` | 报告 | `ReportTab`→`ReportV2` | 12148 / 12029 | scoreReport (+scoreChain 兜底) | 见 §3.8 | `还没有可交付的成果。…` |
| 资源中心 | `sessions` | 会话隧道 | `SessionTab` | 14057 | sessions, probeSessions, updateTunnel, updateWebshell | `webshells[]`、`tunnels[]`、`totals` | 三条 hint 条 + 各段空态 |
| 资源中心 | `artifacts` | 凭据与文件 | `ArtifactsTab` | 11502 | attackFiles, credentials, access (+内嵌 AttackFilesTab) | 三段折叠 | 各段内独立空态 |
| 资源中心 | `knowledge` | 知识库 | `KnowledgeTab` | 12470 | pocSearch, pocGet, pocUse | `items[]`、`tpl.*` | 5 套（见 §3.9.8） |
| 资源中心 | `skills` | 技能库 | `SkillsTab` | 11229 | skillCatalog, skillRead | `items[].{name,description,library,fromPlugin,provider,modelInvocable,problems,availability}`、`meta.{note,libraries,availability,byDir,fromPlugin}` | 分组为空即不渲染该组 |
| 环境与设置 | `env` | 环境适配 | `EnvTab` | 13188 | platformConfigGet, platformConfigSave, platformAssignToolkit, intelStatus, intelRefresh | `config.*`、`egress.*`、`tools`、`env` | `加载中…` |

### 5.2 子视图 / 抽屉 / 弹窗（19 个可切换视图）

| # | 所属页签 | 子视图 | 切换控件 | 行 |
|---|---|---|---|---|
| 1 | assets | 列表/主机视图 | 「列表 / 主机视图」tab | 10841 |
| 2 | assets | 发现时间 | 「发现时间」tab → `DiscoveryView` | 10842, 11064 |
| 3 | assets | 域名 | 「域名」tab | 10843 |
| 4 | assets | Web/网站与服务 | 「Web / 网站与服务」tab | 10844 |
| 5 | assets | 当前测试 | 网段视图侧栏「当前测试」→ `TestingTab` | 10712, 11060 |
| 6 | assets | 网段视图侧栏 | 「网段视图 / 隐藏网段视图」 | 10835 |
| 7 | assets | 资产详情抽屉 | 点资产行 → `openId`/`detail` | 10958–11000 |
| 8 | findings | 按目标聚合 / 平铺列表 | 右下按钮 | 11790 |
| 9 | findings | 单条漏洞展开 | 点行 | 11696 |
| 10 | chain | 链路 A / 链路 B | 两个按钮 | 11983–11984 |
| 11 | chain | 单条命中详情 | 点命中行 | 11845 |
| 12 | scores | 已得分 / 高分缺口 / 全部 | 三个按钮 | 13740–13755 |
| 13 | overview | 当前得分 / 下一步得分 | 两个 tab | 10557–10574 |
| 14 | report | V2 三段式 / legacy 平铺卡片 | 由 `data.report` 是否存在决定，**用户不可切** | 12204 |
| 15 | knowledge | POC 详情抽屉 | 点条目 | 12580 |
| 16 | skills | 技能详情面板 | 点技能卡 | 11260 |
| 17 | env | 运行概况 / 配置表单 / 高级诊断 | 三个 tab | 13356 |
| 18 | agents | SessionMap 全屏地图 | 「全屏地图 / 退出全屏」 | 15180 |
| 19 | artifacts | 三段 `<details>` 折叠 | 点 summary | 11531–11543 |

> 任务书里提到"safe 有 8 个子视图"，在本文件中找不到与之对应的 8 项硬编码列表。上面 19 项是**逐条数出来的全部可切换视图**，按此为准。

### 5.3 组件清单（本文件内定义的全部 React 组件）

| 组件 | 行 | 类型 | 说明 |
|---|---|---|---|
| `SecretText` | 592 | function | 脱敏显示 |
| `Markdown` | 629 | function | 块级 Markdown 渲染 |
| `ProvTag` | 10323 | function | 端口来源徽章 |
| `PriTag` | 10332 | function | 易打性徽章 |
| `TestTag` | 10338 | function | 测试状态徽章 |
| `OverviewTab` | 10348 | function | 态势 |
| `AssetsTab` | 10616 | function | 资产测绘 |
| `DiscoveryView` | 11084 | function | 发现时间 |
| `PromptsTab` | 11137 | function | 提示词 |
| `SkillsTab` | 11229 | function | 技能库 |
| `HttpBlock` | 11405 | function | HTTP 报文块 |
| `CredentialList` | 11463 | function | 凭据列表 |
| `AccessList` | 11488 | function | 访问会话列表 |
| `ArtifactsTab` | 11502 | function | 凭据与文件 |
| `FindingsTab` | 11546 | function | 漏洞战果 |
| `ChainTab` | 11817 | function | 攻击链 |
| `ReportV2` | 12029 | function | 报告 V2 |
| `ReportTab` | 12148 | function | 报告壳 |
| `AttackFilesTab` | 12386 | function | 攻击文件 |
| `KnowledgeTab` | 12470 | function | 知识库 |
| `ProxySettings` | 12745 | function | **死代码，无挂载点** |
| `EnvTab` | 13188 | function | 环境适配 |
| `ScoreTab` | 13524 | function | 得分目标 |
| `Section` | 13867 | function | 统一折叠头 |
| `Clip` | 13890 | function | 长文本折叠 |
| `TestingTab` | 13919 | function | 当前测试 |
| `SessionTab` | 14057 | function | 会话隧道 |
| `SessionMap` | 14798 | function | 会话关系图 |
| `RtBoundary` | 15392 | class | 页签级错误边界 |
| `AgentsTab` | 15421 | function | 智能体 |
| `ConcurrencyCard` | 15529 | function | 并发上限编辑 |
| `VersionBar` | 15590 | function | 版本徽章 |
| `Panel` | 15678 | function | 主壳 |
| `SidebarButton` | 16190 | function | **死代码**（`void`） |
| `HeaderButton` | 16199 | function | **死代码**（`void`） |
| `FullButton` | 16209 | function | **死代码**（`void`） |

---

## 6. 依赖

### 6.1 内部（同库）

| 依赖 | 用途 | 行 |
|---|---|---|
| `./redteam` 之外无 import | 本文件是**零内部 import** 的自包含 bundle | — |
| CSS 与 `productTheme` / `useWorkbenchFullscreen` 同文件内联 | 无跨文件耦合 | 12–539, 741–10081 |

### 6.2 宿主（逐个列出，标注公开性）

> 判定方法：在 `/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai/` 里找 method 注册与路由挂载。

| # | 宿主 API / RPC | 完整请求形状 | 调用位置 | 用途 | 失败处理 | 公开性判定 |
|---|---|---|---|---|---|---|
| H1 | `POST /api/session/list` | `{type:"client-request", rpcId:"rt-session-map-<b36>-<b36>", method:"session/list", payload:{args:{_request:{}}}}` | `client.js:14731`–`:14741` | 取全部可见 Session 摘要（名称/父会话/运行态/待办/子会话目录） | 6s 超时 abort → `session-list-timeout`；HTTP 非 2xx → `session-list-http-<status>`；信封不符 → `session-list-invalid`；行数 >5000 → `session-list-row-limit`；响应 >4MiB → `session-response-too-large`；有旧快照则标 `stale:true` 保留并显示告警条，无旧快照则只显示错误条 | **注册为公开 typert 端点，但无版本承诺**。注册点：`@deepseek-ai/dsh-api-session-controller@0.2.2-rc.5` `lib/typert.host.js:2168`（`'session/list': {service:'sessionController', invocation:{kind:'direct'}, sourceLocation:'packages/api/session-controller/src/index.ts:282'}`）；服务端 claim：`@deepseek-ai/dsh-api-gateway/lib/index.js:907` `claimsEndpoint` 经 `ctx.typert.local.get(endpoint)` 认领；HTTP 承载：`@deepseek-ai/dsh-client-connection/lib/index.js:888` `rpcFetchHandler`，`API_PATH='/api'`（`:14`）；准入：`admit()`（`:742`）要求 trusted host + 已认证浏览器 peer 或 API token |
| H2 | `POST /api/session/list` 的**参数 schema** | `_request` 只接受 `{cursor?: string}`，**strict 模式 `additionalProperties:false`** | 同上 | — | 传多余字段会被拒 | `typert.host.js:2181`–`:2200`（`SessionListRequest`） |
| H3 | `POST /api/session/list` 的**返回 schema** | `SessionListValue = { items: readonly SessionSummary[] }` | 同上 | — | 客户端自己校验 | `typert.host.js:3710`（声明）、`:2194`（`result.mode:'strict'`，但 `jsonSchemaError: 'typert tool schema: selected dictionaries require string keys and unconstrained JSON values'` → **没有可发布的 JSON Schema**，只能靠类型声明） |
| H4 | 浏览器模块加载器 `window.__ModuleLoader__.load({id, factory})` | — | `:8`–`:10` | 注册模块 | 宿主找不到 id 则整块 UI 静默不挂载 | **内部约定**，无文档、无版本承诺 |
| H5 | `require('react')` | — | `:542` | 唯一 npm 依赖 | 抛错则整模块失败 | **平台 seed**，宿主保证存在 |
| H6 | `window.__dshPurgeAttentionGo()` | 无参 | `:10499` | 把待办整理成一段话填进主会话输入框（**只填不发**） | `try/catch` 后回落 `onGo('agents')` | **内部全局函数，无版本承诺**；由 `safe/client.js:23005` 赋值 |
| H7 | `POST /dsh-purge-safe/status`（GET） | `GET /dsh-purge-safe/status`，6s abort | `:15596` | 取 `plugin_version` 显示 `v<version>` | `response.ok` 为假或字段非字符串 → 保持 `—`；abort 静默 | **插件自有路由**（`vendor/safe/lib/index.js:2205`），非宿主 API |
| H8 | `navigator.clipboard.writeText` | — | `:10291` | 复制 | 拒绝 → 回落 `document.execCommand('copy')`；两者皆败 → 返回 false 并如实提示 | **标准 Web API** |
| H9 | `document.execCommand('copy')` | — | `:10305` | 剪贴板兜底（非安全上下文） | 返回 false 即失败 | **已废弃 API**，无保证 |
| H10 | `element.requestFullscreen` / `document.exitFullscreen` | — | `:14841`、`:14831` | 地图全屏 | 失败静默，保留 CSS 全屏 | **标准 Web API** |
| H11 | `ResizeObserver` | — | `:15029` | 画布自适应 | `typeof ResizeObserver === 'undefined'` 时跳过（`:15028`） | **标准 Web API** |
| H12 | `localStorage` | — | 多处 | 见 §2.1 | 全部 `try/catch`，隐私模式下静默降级 | **标准 Web API** |
| H13 | CSS 变量 `--dsw-alias-*` / `--ui-*` | — | 全文 | 颜色/字号/间距 | 缺失则回落到硬编码 fallback | **宿主设计令牌，无版本承诺** |

#### H1 的完整字段契约（`SessionSummary`，`typert.host.js:3866`）

```
agentAvailable: boolean                     // 必有
formatStatus?: 'current' | 'migration-required'
sessionId: SessionId                        // 必有
updatedAt: number                           // 必有
running: boolean                            // 必有
blank: boolean                              // 必有（本文件未使用）
parentSessionId?: SessionId
origin?: 'subagent'
cwd?: string
projections?: SessionProjectionHints        // {kind:'cached'|'sequenced', asOfSeq:number, values:Partial<SessionProjectionSummaryValues>}
```

#### **关键发现：`todos` 在 summary 里被类型系统排除**

`SessionProjectionSummaryValues = Omit<SessionProjectionViewValues, SessionProjectionSummaryExcludedKey>`（`typert.host.js:3797`），而被 `SessionProjectionSummaryExcluded` 标记的键包含 `todos`：

```
todos: SessionProjectionSummaryExcluded<TodoItem[]> | null      // SessionProjectionMap，typert.host.js:3765
```

同批被排除的还有 `actionCards` / `imageLimits` / `contextPressure` / `contextBreakdown`。

**后果**（`[静态]`，依据类型声明）：`client.js:14414`–`:14428` 对 `values.todos` 的整套解析在本宿主版本上**永不命中**。于是：

- `item.todos` 恒为 `undefined` → `item.currentTask` 恒 `undefined` → `item.taskProgress` 恒 `undefined`。
- `SessionMap` 节点第三行永远落到 `未提供待办详情`（`:15300`）。
- 详情栏「任务与待办」永远显示 `宿主尚未提供待办清单，无法判断具体步骤和完成情况。`（`:15340`）。
- 搜索框的匹配文本少了 todos 一路（`:14550`）。
- 资料栏「进行中待办」「待办进度」永远 `宿主未提供`（`:15371`–`:15372`）。

`subagentCatalog` / `subagentTiming` / `title` / `subagent` **不在**排除名单里，对应解析是活的。

### 6.3 外部（网络 / 子进程 / 文件系统）

| 类别 | 目标 | 说明 |
|---|---|---|
| 网络 | `/redteam/api`（同源） | 插件 host 路由，`ui.js:859` 注册 `kind:'exact'`，自带 Origin 校验（`ui.js:869`–`:897`） |
| 网络 | `/api/session/list`（同源） | 宿主 RPC，见 H1 |
| 网络 | `/dsh-purge-safe/status`（同源） | 插件 host 路由 |
| 网络 | 无第三方域名 | 全文件无绝对 URL 请求 |
| 子进程 | 无 | — |
| 文件系统 | 无（浏览器侧无 fs 权限） | — |
| 图片 | `data:<mime>;base64,…` | 由 `op:'shotData'` 拼出，走 `shotCache`（`:10185`）缓存 |

---

## 7. 与另一版的差异

> **与 community 的差异我未查。** 本节只记录本文件自身与"本包内第二份编译产物"的差异，community 侧未做对照。

| 能力 | community 行号 | safe 行号 | 差异性质 |
|---|---|---|---|
| 与 community 的任何对照 | 未查 | 未查 | **未查** |
| 本文件（redteam 方言，`h` + `React.useState`） | — | 全文 | 基准 |
| 同包第二份产物 `vendor/safe/client.js`（panel 方言，`h2` + `import_react2.default.useState`） | — | `safe/client.js:21262` 起 | **等价重编译**：同一 UI 的两份产物，`scripts/build.mjs:118`–`:123` 明确要求"两份都要改" |
| `apply()` 是否注册 slot | — | 只注入 CSS（`:16225`） | 本文件为库；`safe/client.js:23245`/`:23270` 才注册 slot |
| `SessionMap` 节点点击 | — | 只 `setSelectedId`（`:15272`） | 只读观察，不切会话 |
| `ProxySettings` | — | 定义于 `:12745`，无挂载点 | 死代码 |

---

## 8. 风险与脆弱点

| # | 风险 | 触发条件 | 后果 | 是否可静态检出 |
|---|---|---|---|---|
| R1 | 宿主 `session/list` 是未承诺版本的内部 RPC | 宿主升级改字段名/改 summary 投影集合 | 关系图整体失效：`validateSessionListResponse` 抛 `session-list-invalid`，页面只剩错误条 | 部分（能看出依赖，但看不出何时变） |
| R2 | `todos` 已被 summary 类型排除 | 任何版本 | 待办、进度、`currentTask`、搜索按待办匹配全部失效，界面长期显示"宿主尚未提供待办清单" | **是**（对比 `SessionProjectionSummaryExcluded` 即可） |
| R3 | `sourceUpdatedAt` 在 `SessionListValue` 里不存在 | 任何版本 | 页脚「宿主元数据时间」恒为 `宿主未提供` | **是**（`SessionListValue` 只有 `items`） |
| R4 | `ProxySettings` 443 行无挂载点 | 任何版本 | 代理池/代理节点管理在 UI 上完全不可用；对应 9 个 `proxy*` op 从界面无法触发 | **是**（`grep "h(ProxySettings"` 零命中） |
| R5 | `FindingsTab` 子页签只有一个且自指 | 任何版本 | 点它无任何反应；凭据/访问会话只能滚到页面下部看 | **是**（`setSubTab` 唯一写入点传常量 `'vulns'`） |
| R6 | `st.tab` 的 `testing`/`attackfiles`/`prompts` 分支不可达 | 任何版本 | 三条 body 分支为死代码 | **是** |
| R7 | 同一 UI 有两份编译产物 | 改了一处忘另一处 | 「面板内点开」与「全屏浏览新窗口」看到不同界面 | **是**（`scripts/build.mjs:118` 已警告） |
| R8 | `ArtifactsTab` 的 `err` 从不被 set | 三个 op 全失败 | 页面显示「凭据 0 / 访问会话 0 / 攻击文件 0」，**无任何错误提示**，用户以为真的没数据 | **是**（三个 `.then(_, () => {})`） |
| R9 | `ArtifactsTab` 的 `busy` 立即置 false | 任何 | 「刷新中…」文案一闪而过或永不出现 | **是**（`:11517`） |
| R10 | `attackFiles` 被重复请求 | 打开「凭据与文件」→ 展开第 3 段 | 同一接口两次往返 | **是**（`:11514` + `:12398`） |
| R11 | `SessionMap` 5 秒轮询 × 每实例 2 个请求 | 面板常开 | 每 5 秒 2 次请求；`SessionMap` 只挂在 `AgentsTab`，切走即卸载，所以只在智能体页产生 | **是** |
| R12 | 轮询与手动刷新共用同一个 `AbortController` 槽 | 用户在轮询在途时点「手动刷新」 | `inFlightRef` 为真 → `read()` 直接 return，**手动刷新被静默丢弃**，按钮文案却已从「读取中…」恢复 | **是**（`:14870`） |
| R13 | `copyText` 失败在 `CredentialList` 里无反馈 | 剪贴板被拒 | 点「复制」看起来成功，实际剪贴板为空 | **是**（`:11475` 丢弃返回值） |
| R14 | `ReportV2` 缺「凭据汇总」段 | 任何 | HTML 报告比 Markdown 少一段，交付时两处不一致 | **是**（三段 `<section>` vs 四段 summary 文案） |
| R15 | 下载用未入 DOM 的 `<a>.click()` | 部分浏览器/Safari | 下载无反应，仅提示「下载失败」 | 否（需实测浏览器） |
| R16 | `localStorage` 键无清理 | 长期使用、频繁切靶标 | `rt-unread:*` / `rt-collapse:*` 无限增长 | **是** |
| R17 | `clampRtGeom` 只夹紧不迁移 | 显示器变小 | 面板可能落在屏幕外，只能靠 `resize` 事件重夹 | **是**（`:15640`） |
| R18 | `window.__dshPurgeAttentionGo` 是裸全局 | 外层未加载/改名 | 按钮静默退化为跳页签 | **是**（`:10499`） |
| R19 | `RtBoundary` 只包页签体 | 事件处理器抛错 | 整面板白屏（边界捕获不到） | **是**（`:15392` class 语义） |
| R20 | 4 MiB 响应上限 | 会话数极多或投影很大 | `session-response-too-large`，关系图不可用 | **是**（`:14689`） |

---

## 9. 逐条功能清单

### 9.1 壳与导航

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| SF-RTUI-001 | 模块注册（id `dsh-purge-safe`） | 8–11 | 完整 | id 仅占位，真实 id 由内联方决定 |
| SF-RTUI-002 | 只注入 CSS、不注册 slot | 16225–16241 | 完整 | `void` 掉 4 个组件 |
| SF-RTUI-003 | 6 组一级导航 | 15899–15906 | 完整 | |
| SF-RTUI-004 | 12 个页签 | 15892–15896 | 完整 | |
| SF-RTUI-005 | 二级导航（仅多页签组） | 16157–16175 | 完整 | 只 2 个组有 |
| SF-RTUI-006 | 组/页签未读红点 | 15993, 16170 | 完整 | 依赖 `consoleDigest` |
| SF-RTUI-007 | 组间键盘导航 | 16106–16116 | 完整 | Home/End/方向键 |
| SF-RTUI-008 | 页签级错误边界 | 15392–15415 | 完整 | 只捕获渲染期 |
| SF-RTUI-009 | 浮窗拖拽/三边缩放 | 15825–15870 | 完整 | 排除 button/a/input 等 |
| SF-RTUI-010 | 浮窗几何持久化 + 夹紧 | 15640, 15674, 15699 | 完整 | |
| SF-RTUI-011 | 全屏浏览（CSS + 原生双轨） | 12–301, 15914–15922 | 完整 | |
| SF-RTUI-012 | 主题订阅 | 15929–15936 | 完整 | `productTheme` |
| SF-RTUI-013 | 靶标跟随（绑定→标题→上次） | 15746–15758 | 完整 | |
| SF-RTUI-014 | 手动选靶标压过自动跟随 | 15696, 15754 | 完整 | |
| SF-RTUI-015 | 未读摘要 25s 轮询（单飞） | 15847–15866 | 完整 | |
| SF-RTUI-016 | 版本徽章 | 15590–15604 | 完整 | 6s 超时 |

### 9.2 态势（overview）

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| SF-RTUI-020 | 四宫格统计（资产/存活/端口/成果） | 10537–10543 | 完整 | 数据来自 `snapshot.stats`，本页不自己请求 |
| SF-RTUI-021 | 累计得分大卡 | 10533–10552 | 完整 | `chain.summary.points` |
| SF-RTUI-022 | 五阶段得分轨道 + 占比条 | 10553–10575 | 完整 | `current` 取逆序首个有分的阶段 |
| SF-RTUI-023 | 得分明细双视图（当前/下一步 Top5） | 10576–10602 | 完整 | |
| SF-RTUI-024 | 会话与通道卡 | 10603–10622 | 完整 | 隧道要求 `legit===true` |
| SF-RTUI-025 | 协同与待测卡 | 10623–10636 | 完整 | |
| SF-RTUI-026 | 待办条 + 5 种阶段标签 | 10454–10529 | 完整 | 清空时整块不占位 |
| SF-RTUI-027 | 「填入主会话输入框」 | 10497–10504 | 完整 | 走 `window` 钩子，失败回落跳页签 |
| SF-RTUI-028 | attention 8s 独立轮询 | 10383–10390 | 完整 | 不动其他 4 个查询 |
| SF-RTUI-029 | 5 个查询并发 + 仅 scoreChain 致命 | 10364–10378 | 完整 | 其余 4 个失败各自置 null |

### 9.3 资产测绘（assets）

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| SF-RTUI-030 | 资产台账列表（11 个筛选参数） | 10650–10670 | 完整 | `limit:400` 硬上限 |
| SF-RTUI-031 | 结论行（7 个可点数字筛选） | 10860–10890 | 完整 | 再点取消 |
| SF-RTUI-032 | 网段视图侧栏（外网/内网分组） | 10704–10765 | 完整 | 默认隐藏 |
| SF-RTUI-033 | 域名视图 | 11020–11040 | 完整 | |
| SF-RTUI-034 | Web 资产视图 | 11045–11058 | 完整 | |
| SF-RTUI-035 | 发现时间视图（DiscoveryView） | 11084–11136 | 完整 | |
| SF-RTUI-036 | 当前测试视图（TestingTab） | 10712–10717, 11060 | 完整 | 需先展开网段视图 |
| SF-RTUI-037 | 资产详情抽屉 | 10960–11000 | 完整 | `op:'asset'` |
| SF-RTUI-038 | 4 个统计卡 | 10772–10777 | 完整 | |

### 9.4 智能体（agents）

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| SF-RTUI-040 | 并发名额标签（在跑/剩余/等资源） | 15456–15464 | 完整 | |
| SF-RTUI-041 | 6 张角色卡 | 15446–15453 | 完整 | 硬编码常量 |
| SF-RTUI-042 | 并发规则文案 | 15494–15499 | 完整 | |
| SF-RTUI-043 | 执行上限编辑（ConcurrencyCard） | 15519, 15529–15589 | 完整 | `op:'setAgentsMax'` |
| SF-RTUI-044 | 内嵌角色提示词编辑器 | 15526 | 完整 | 复用 `PromptsTab` |
| SF-RTUI-045 | SessionMap 挂载点 | 15477 | 完整 | 唯一挂载点 |

### 9.5 会话关系图（SessionMap，逐条拆）

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| SF-RTUI-050 | 双请求串行取数（绑定→列表） | 14869–14930 | 完整 | 无绑定根则不发第二请求 |
| SF-RTUI-051 | 宿主 `session/list` 信封校验 | 14318–14436 | 完整 | 12 类错误码 |
| SF-RTUI-052 | 摘要投影白名单（只取 6 类字段） | 14380–14431 | 完整 | 明确不读 transcript |
| SF-RTUI-053 | **待办解析** | 14414–14428 | **部分（永不命中）** | 宿主 summary 已排除 `todos`，见 §6.2 |
| SF-RTUI-054 | 按绑定根作用域裁剪会话 | 14449–14536 | 完整 | 含 orphan 判定 |
| SF-RTUI-055 | 父环检测 | 14294–14311 | 完整 | `parent-cycle` |
| SF-RTUI-056 | 搜索 + 状态筛选（含祖先补全） | 14542–14572 | 完整 | |
| SF-RTUI-057 | 统计（total/running/idle/unknown + 子数） | 14578–14601 | 完整 | |
| SF-RTUI-058 | 确定性树布局 | 14608–14658 | 完整 | 层距 350 / 行距 158 / 节点 292×110 |
| SF-RTUI-059 | 贝塞尔连线 | 14603–14606 | 完整 | |
| SF-RTUI-060 | 手工节点位置覆盖 | 14663–14686 | 完整 | 按靶标隔离 |
| SF-RTUI-061 | 4 MiB 流式读取 + UTF-8 严格解码 | 14689–14713 | 完整 | |
| SF-RTUI-062 | rpcId 生成（时间戳+自增） | 14716–14719 | 完整 | |
| SF-RTUI-063 | 6s 超时 | 14721, 14726–14730 | 完整 | 与绑定请求共用 controller |
| SF-RTUI-064 | 单飞 + 代际守卫 + abort | 14869–14890 | 完整 | |
| SF-RTUI-065 | 切靶标全清 | 14932–14956 | 完整 | |
| SF-RTUI-066 | refreshKey 重读不清选中 | 14958–14960 | 完整 | |
| SF-RTUI-067 | 5s 自动刷新 | 14962–14966 | 完整 | |
| SF-RTUI-068 | 暂停 + 暂停态秒表 | 14968–14971, 15187–15193 | 完整 | |
| SF-RTUI-069 | 暂停超 60s 判陈旧 | 14997–14998 | 完整 | |
| SF-RTUI-070 | 陈旧即熄灭运行态视觉 | 14999–15001 | 完整 | |
| SF-RTUI-071 | 失败保留旧快照并标 stale | 14917–14924 | 完整 | |
| SF-RTUI-072 | 选中项失效回落 | 14974–14979 | 完整 | |
| SF-RTUI-073 | 适应/定位所选两种 fit | 15010–15023 | 完整 | clamp 0.08–1.6 / readable ≥0.8 |
| SF-RTUI-074 | 以光标为锚缩放（0.08–2.4） | 15035–15050 | 完整 | 直写 `cameraRef` 防连发丢帧 |
| SF-RTUI-075 | 原生非 passive wheel | 15103–15125 | 完整 | |
| SF-RTUI-076 | 节点拖动（4px 阈值 + pointer capture） | 15063–15100 | 完整 | |
| SF-RTUI-077 | 画布平移（4px 阈值） | 15179–15192 | 完整 | |
| SF-RTUI-078 | 节点键盘微调（10/Shift 50） | 15277–15288 | 完整 | |
| SF-RTUI-079 | 全屏地图 + Esc 退出 | 14830–14867 | 完整 | |
| SF-RTUI-080 | 重置布局 | 15168–15173 | 完整 | 只删本地位置 |
| SF-RTUI-081 | 运行中光点/光圈/流动线 | 15251–15265 | 完整 | 受 stale/paused 抑制 |
| SF-RTUI-082 | 节点四行文案（名称/状态+角色/任务/关系+子数） | 15284–15303 | 部分 | 第三行因 SF-RTUI-053 恒为「未提供待办详情」 |
| SF-RTUI-083 | 详情栏：状态解释 | 15313 | 完整 | |
| SF-RTUI-084 | 详情栏：执行信息 6 项 | 15315–15324 | 完整 | |
| SF-RTUI-085 | 详情栏：任务与待办 + 进度条 | 15326–15339 | 部分 | 数据源被排除 |
| SF-RTUI-086 | 详情栏：父子关系导航（只切详情） | 15340–15353 | 完整 | |
| SF-RTUI-087 | 详情栏：完整资料 16 行 | 15354–15377 | 完整 | 「交接」恒 `宿主未提供` |
| SF-RTUI-088 | 5 种空态 | 15092–15101 | 完整 | |
| SF-RTUI-089 | 错误条双分支文案 | 15195–15203 | 完整 | |
| SF-RTUI-090 | 页脚四段时间与口径声明 | 15379–15383 | 完整 | 「宿主元数据时间」恒 `宿主未提供`（R3） |
| SF-RTUI-091 | 外部 `onPick` 切会话 | — | **缺失** | 全组件无此能力；点节点只改本地选中 |

### 9.6 漏洞战果（findings）

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| SF-RTUI-100 | 漏洞列表 + 严重度/状态/搜索筛选 | 11568–11576 | 完整 | `limit:200` |
| SF-RTUI-101 | 按目标聚合 / 平铺切换 | 11790–11794 | 完整 | |
| SF-RTUI-102 | 全部展开/收起 | 11785–11789 | 完整 | |
| SF-RTUI-103 | 单条漏洞展开详情 | 11696 | 完整 | |
| SF-RTUI-104 | 凭据内联展示 | 11744 | 完整 | |
| SF-RTUI-105 | 访问会话内联展示 | 11770 | 完整 | |
| SF-RTUI-106 | 子页签（漏洞/凭据/访问会话） | 11560, 11779–11782 | **部分（单页签自指）** | 只有 `vulns` 一个按钮，点击无变化 |
| SF-RTUI-107 | 需重启提示 | 11801 | 完整 | |

### 9.7 攻击链（chain）

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| SF-RTUI-110 | 链路 A 竖向逐阶段 | 11988, 11989–11990 | 完整 | |
| SF-RTUI-111 | 链路 B 横向五阶段一屏 | 11951–11976 | 完整 | |
| SF-RTUI-112 | 单条命中展开详情 | 11845–11855 | 完整 | |
| SF-RTUI-113 | 不计分标注（`capped` / `!counted`） | 11862–11864 | 完整 | |
| SF-RTUI-114 | 推断动作标注 | 11857–11860 | 完整 | |
| SF-RTUI-115 | 空态 | 11988 | 完整 | |

### 9.8 得分目标（scores）

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| SF-RTUI-120 | 三视图（已得分/缺口/全部） | 13740–13755 | 完整 | |
| SF-RTUI-121 | 得分汇总指标 | 13718–13737 | 完整 | 含自建/服务已拿满 warn 标签 |
| SF-RTUI-122 | 新增得分点 | 13756 | 完整 | |
| SF-RTUI-123 | 编辑（内置项锁分值） | 13757–13772 | 完整 | |
| SF-RTUI-124 | 删除 | 13582 | 完整 | |
| SF-RTUI-125 | 命中记录 + 截图条 | 13696–13710 | 完整 | |

### 9.9 报告（report）

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| SF-RTUI-130 | V2/legacy 双路径 | 12203–12207 | 完整 | 由 `data.report` 决定 |
| SF-RTUI-131 | 一、资产归属证明（1.1/1.2） | 12136–12138 | 完整 | |
| SF-RTUI-132 | 二、得分汇总表 + 逐阶段分表 | 12139 | 完整 | 三种表头按 `stage_code` |
| SF-RTUI-133 | 三、得分点复现（3.1–3.4） | 12140–12146 | 完整 | 四种分组形状 |
| SF-RTUI-134 | **四、凭据汇总** | — | **缺失** | 只在 Markdown 正文里有，V2 HTML 无对应段 |
| SF-RTUI-135 | 复现缺口提示 | 12076, 12099 | 完整 | |
| SF-RTUI-136 | 复制全文 | 12178, 12131 | 完整 | 真实成功/失败反馈 |
| SF-RTUI-137 | 下载 .md | 12181–12200, 12134 | 完整 | 文件名清洗 + 80 字上限 |
| SF-RTUI-138 | Markdown 全文折叠查看 | 12368–12370 | 完整 | 4 段全在这里 |
| SF-RTUI-139 | legacy 平铺卡片（含步骤/凭据/隧道/WebShell/请求） | 12208–12380 | 完整 | |
| SF-RTUI-140 | 阶段分组兜底（scoreChain 补） | 12165–12170, 12001 | 完整 | |

### 9.10 会话隧道（sessions）

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| SF-RTUI-150 | WebShell 卡（状态/类型/权限/口令/检测） | 14142–14172 | 完整 | |
| SF-RTUI-151 | 隧道卡（入口/可达/是否跨边界/命令） | 14174–14220 | 完整 | |
| SF-RTUI-152 | 实测连通（probeSessions） | 14078–14088 | 完整 | `timeoutMs:6000` |
| SF-RTUI-153 | 手动标记失效/可用 | 14097, 14102 | 完整 | 写 `check_note:'界面手动标记'` |
| SF-RTUI-154 | 三条交付提示条 | 14130–14141 | 完整 | 非加密马 / 非跨边界 / 无 suo5 |
| SF-RTUI-155 | 复制 URL / 地址 / 命令 | 14150, 14185 | 完整 | 1.5s 后清标记 |
| SF-RTUI-156 | 内网工具命令生成（gogo/fscan） | 14176–14177 | 完整 | 模板字符串 |

### 9.11 凭据与文件（artifacts）

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| SF-RTUI-160 | 三段折叠（凭据/访问会话/攻击文件） | 11531–11543 | 完整 | 原生 `<details>`，默认全折叠 |
| SF-RTUI-161 | 顶部三计数 | 11523–11525 | 完整 | |
| SF-RTUI-162 | SecretText 脱敏 + 显隐切换 | 592–607 | 完整 | 默认 8 个 `•` |
| SF-RTUI-163 | 凭据卡（主机/用户/类型/权限/来源/工具/证据/发现者/时间/备注） | 11463–11483 | 完整 | |
| SF-RTUI-164 | 凭据一键复制原值 | 11475 | 完整 | 失败无反馈（R13） |
| SF-RTUI-165 | 访问会话列表 | 11488–11500 | 完整 | |
| SF-RTUI-166 | 攻击文件内嵌（分组折叠 + 正文预览） | 11543, 12386–12469 | 完整 | 重复请求（R10） |
| SF-RTUI-167 | 加载失败提示 | 11528 | **缺失** | `err` 从不被 set（R8） |

### 9.12 知识库（knowledge）

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| SF-RTUI-170 | 检索（q/kind/category/engagement/asset_target/verified） | 12489–12500 | 完整 | 显式触发 |
| SF-RTUI-171 | 按分类分组 + 折叠 | 12684–12690 | 完整 | |
| SF-RTUI-172 | POC 详情抽屉 | 12580–12600 | 完整 | |
| SF-RTUI-173 | 本机 nuclei 模板分页（40/页） | 12700–12718 | 完整 | |
| SF-RTUI-174 | 模板命令一键复制 | 12708 | 完整 | |
| SF-RTUI-175 | 5 套空态 | 12720–12733 | 完整 | |

### 9.13 技能库（skills）

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| SF-RTUI-180 | 目录概况 4 个统计 | 11325–11329 | 完整 | |
| SF-RTUI-181 | 红队/官方两组 | 11311–11314 | 完整 | |
| SF-RTUI-182 | 搜索 + 只看本插件 + 只看异常 | 11250–11260 | 完整 | |
| SF-RTUI-183 | 技能详情（正文 Markdown） | 11260–11290 | 完整 | `op:'skillRead'` |
| SF-RTUI-184 | 目录来源与检查信息 | 11315–11322 | 完整 | |

### 9.14 环境与设置（env）

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| SF-RTUI-190 | 三章节（运行概况/配置表单/高级诊断） | 13356–13362 | 完整 | |
| SF-RTUI-191 | 配置读写（platform/toolkitDir/binDirs/tools/env/notes） | 13231–13240, 13262 | 完整 | |
| SF-RTUI-192 | 整包目录自动分配工具 | 13275 | 完整 | |
| SF-RTUI-193 | 情报保鲜（模板年龄 + KEV） | 13204–13228 | 完整 | |
| SF-RTUI-194 | 出口代理环境变量展示 | 13489–13492 | 完整 | 只读展示 |
| SF-RTUI-195 | **代理池/代理节点管理（ProxySettings）** | 12745–13187 | **缺失（无挂载点）** | 443 行死代码，9 个 `proxy*` op 无法从界面触发 |

### 9.15 子视图

| 编号 | 功能 | 代码位置 | 状态 |
|---|---|---|---|
| SF-RTUI-200 | assets 列表/主机视图 | 10841 | 完整 |
| SF-RTUI-201 | assets 发现时间视图 | 10842, 11084 | 完整 |
| SF-RTUI-202 | assets 域名视图 | 10843, 11020 | 完整 |
| SF-RTUI-203 | assets Web 视图 | 10844, 11045 | 完整 |
| SF-RTUI-204 | assets 当前测试视图 | 10712, 13919 | 完整 |
| SF-RTUI-205 | assets 网段侧栏开合 | 10835 | 完整 |
| SF-RTUI-206 | assets 资产详情 | 10960 | 完整 |
| SF-RTUI-207 | findings 聚合/平铺 | 11790 | 完整 |
| SF-RTUI-208 | findings 单条展开 | 11696 | 完整 |
| SF-RTUI-209 | chain 链路 A/B | 11983 | 完整 |
| SF-RTUI-210 | chain 命中详情 | 11845 | 完整 |
| SF-RTUI-211 | scores 三视图 | 13740 | 完整 |
| SF-RTUI-212 | overview 得分双视图 | 10557 | 完整 |
| SF-RTUI-213 | report V2/legacy | 12204 | 完整（不可用户切换） |
| SF-RTUI-214 | knowledge POC 抽屉 | 12580 | 完整 |
| SF-RTUI-215 | skills 详情面板 | 11260 | 完整 |
| SF-RTUI-216 | env 三章节 | 13356 | 完整 |
| SF-RTUI-217 | agents 地图全屏 | 15185 | 完整 |
| SF-RTUI-218 | artifacts 三段折叠 | 11531 | 完整 |

---

## 10. 未验证项

| # | 未验证 | 缺什么才能验证 |
|---|---|---|
| U1 | `❓未验证：` 宿主 `session/list` 返回的 `projections.values` 里 `todos` 是否**实测**缺失 | 需要一次真实请求的响应体（`[静态]` 已由类型声明判定为排除，但没抓到实际报文）。方法：面板打开智能体页签时抓 `/api/session/list` 的 `server-response`，检查 `result.value.items[*].projections.values` 是否含 `todos` |
| U2 | `❓未验证：` `sourceUpdatedAt` 是否可能由宿主未来版本提供 | 需要宿主更新日志或实测响应；当前 `SessionListValue` 声明只有 `items` |
| U3 | `❓未验证：` `SessionMap` 在真实多子会话场景下的布局观感（节点重叠/连线交叉） | 需要 ≥10 个会话且有 3 层以上父子关系的真实数据截图 |
| U4 | `❓未验证：` `SessionMap` 5 秒轮询对宿主 `session/list` 的实际负载 | 需要宿主侧请求日志或 CPU 采样 |
| U5 | `❓未验证：` `ReportV2` 下载在 Safari / 内嵌 WebView 里是否成功 | 需要在该浏览器实测（未入 DOM 的 `<a>.click()` 兼容性） |
| U6 | `❓未验证：` `navigator.clipboard` 在 DSH 桌面端（`app://` 或 `file://` 源）是否可用 | 需要在桌面端实测；`copyText` 有 `execCommand` 兜底，但兜底在 Electron 新版本里也可能被禁 |
| U7 | `❓未验证：` `ProxySettings` 是有意下线还是移植遗漏 | 需要 safe 2.0.0 上游原文或作者说明；本仓库内无注释解释 |
| U8 | `❓未验证：` `FindingsTab` 的 `subTab` 是否曾有多个页签后被裁掉 | 需要上游历史版本对照 |
| U9 | `❓未验证：` 与 community 1.7.20 的逐项差异 | 任务书要求本节标注"未查"，本轮未做 community 侧对照 |
| U10 | `❓未验证：` 本文件与 `safe/client.js` 内联副本是否**逐字节**一致 | 需要 `diff <(sed -n '5591,21815p' vendor/safe/client.js) vendor/safe/lib/redteam/client.js` 级别的比对（缩进不同，需先归一）。本轮只做了结构对照（`Panel`/`SessionMap`/`ArtifactsTab` 均存在且行内相对位置一致） |
| U11 | `❓未验证：` `readSessionMapJson` 的 4 MiB 上限在多少会话数下会被触发 | 需要构造大响应实测；纯静态无法估算，因为 `projections.values` 大小取决于标题/待办/目录 |
| U12 | `❓未验证：` `window.__dshPurgeAttentionGo` 的 `fillAttentionPrompt` 在无当前会话时的行为 | `safe/client.js:22973` 里 `if (!sid) return false`，但本文件 `:10499` 不检查返回值，所以按钮会"看起来点了但没反应"。需要实测确认 |
