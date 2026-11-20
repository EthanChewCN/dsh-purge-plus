# safe 独有 UI 功能与移植判定

> 对照对象：`vendor/safe/`（dsh-purge-safe 2.0.0）vs `vendor/community/`（dsh-purge-community 1.7.20）
> 口径：**只看浏览器半侧**（`client.js` / `lib/redteam/client.js` / `lib/ui-*.js`）+ 它们直接依赖的 op 与表结构。
> 所有行号均为该文件当前内容的一次性快照，改动前请以符号名重新定位。

---

## 0. 口径与总量

| 维度 | safe 2.0.0 | community 1.7.20 | 备注 |
|---|---|---|---|
| 插件主面板 `client.js` | 23,299 行 | 15,601 行 | 两者都是「主面板 + 内嵌演练台」的合并产物，行数不可直接比 |
| 演练台源码 `lib/redteam/client.js` | **16,247 行** | **4,218 行** | 3.85× |
| 演练台内联 CSS（`const CSS`） | `client.js:741` 起 | `client.js:26` 起 | 样式内联，13 个 `.css` 源文件全死，见 §3 末两行 |
| **顶层 tab 数**（`tabs` 数组） | **12** | **10** | `safe:15892-15899` / `comm:4008-4014` |
| tab 别名（`TAB_ALIASES`） | 3（testing / attackfiles / prompts） | 3（内联处理，无常量） | `safe:15908` / `comm:4042,4058,4063` |
| **导航分组 `TAB_GROUPS`** | **6** | **0**（平铺一行页签） | `safe:15900-15907` |
| 演练台视图组件（`*Tab`） | **15 个定义** / 12 个直达（另 3 个经别名或内嵌） | **13 个定义** / 10 个直达 | 见 2.1 |
| 视图内子视图（非 tab） | **8**（其中 4 个 safe 独有：CredentialList / AccessList / SessionMap / ReportV2） | **4**（DiscoveryView / HttpBlock / detailEvidence / ShotStrip） | 见 2.1 |
| 独立模块文件 | **21 个 `.js`**（+13 个 `.css`，全死） | **18 个 `.js`** | 目录条目 34 vs 19 |
| 注册工具数 | 67 | 64 | safe 独有 11，community 独有 8 |
| DB 表（去重） | **29** | **23** | safe 独有 6：`agent_report` / `asset_coverage` / `host_coverage` / `host_finding` / `cleanup_item` / `data_proof` |

**一句话结论**：safe 的 UI 厚度主要来自三块 —— ① 多两个 tab（`overview` / `artifacts`）；② 导航重构成「6 分组 + 二级页签 + 图标 + 键盘漫游」的工作台壳；③ 两个高成本交互件（`SessionMap` 会话地图 623 行、`ReportV2` 四段式报告 119 行 + 全套 `.rt-r2-*` 样式 121 处）。

---

## 1. 顶层面板差异

> 「顶层面板」= 演练台外壳（`Panel`）+ 插件主面板（`SettingsRoot` / `PurgeDock`）两层。

### 1.1 演练台外壳

| safe 有 | community 对应 | 判定 | 证据 |
|---|---|---|---|
| `TAB_GROUPS` 6 分组导航（工作总览 / 资产台账 / 协同进度 / 成果与报告 / 资源中心 / 环境与设置），带 SVG 图标、`rt-nav-section-break` 分隔、分组级未读红点 | 无。10 个页签平铺成一行 `rt-tabs` | **移植**（纯前端，价值高） | `safe/lib/redteam/client.js:15900-15907`（定义）、`16129-16145`（渲染）；`community/lib/redteam/client.js:4119-4135`（平铺） |
| 分组键盘漫游：`role="tablist"` + roving `tabIndex` + ArrowUp/Down/Left/Right + Home/End | 只有 `clickable()` 提供的 Enter/Space | **移植** | `safe:16106-16121`（`navigateGroupKey`）vs `comm:4119-4135` |
| 二级页签 `rt-subnav`：分组内 tab 数 > 1 时出现（如「成果与报告」= 漏洞战果/攻击链/得分目标/报告） | 无二级层 | **移植** | `safe:16158-16174` |
| 面包屑 `项目空间 / 项目名 / 页名` + `rt-workspace-pagehead`（eyebrow + h1 + 说明句） | 无 | **移植**（观感） | `safe:16148`（面包屑）、`16176-16181`（pagehead） |
| `studioProjectCard` 项目卡（右侧常驻当前项目）+ `projectSelector` 下拉切换 | 只有 `<select>` 切靶标，无卡片 | **移植** | `safe:16080`（卡片）、`16034-16067`（下拉） |
| **会话跟随三态 chip**：`跟随` / `手选` / `未绑`，点「手选」可切回绑定靶标 | 无（切换即全局改当前靶标） | **移植**（需 `sessionBindings` op） | `safe:15994-16033` |
| `bindSessionEngagement`：手动切项目时把绑定写回服务端 | 无 | **需后端** | `safe:16049`（`api({op:'bindSessionEngagement'})`）；后端 `store-core.js:857-862` |
| `useWorkbenchFullscreen` 站内全屏（CSS 扩展 + 原生 Fullscreen API + `FULL_REQUEST_EVENT` 事件） | `window.open('#redteam-full')` 开新窗口，`isFullWindow()` 读 hash | **移植**（体验明显更好，社区版在桌面端会丢上下文） | `safe/lib/ui-fullscreen.js:56-288`；`safe:15913-15927`；vs `comm:4015-4018` |
| 主题皮肤 `data-theme`（`dusk` / `white` / `system`）+ `productTheme` 订阅 | 无主题层 | **移植**（连带 `__DSH_PRODUCT_SKIN` token 层） | `safe:15929-15936`；`lib/ui-theme.js`；skin 块 `safe:1765-10080` |
| `compactNavigation` 响应式紧凑导航（`data-nav-layout=compact`） | 无 | **移植**（CSS 已备） | `safe:16099`、`16129`；CSS `9955-9999` |
| `RtBoundary` 单页错误边界 | 有 | 已有 | `safe:15392`；`comm` 内 `RtBoundary` |
| 面板避让桌面标题栏 `desktopChromeTop()` | `clampRtGeom` 只夹到视口 | **移植**（小改） | `safe:15639-15651` vs `comm:8308-8322` |

### 1.2 插件主面板

| safe 有 | community 对应 | 判定 | 证据 |
|---|---|---|---|
| `SettingsRoot` 主题感知根（`MutationObserver` 跟随宿主明暗） | 无根组件，直接挂 `PurgifySection` | 已有等价能力（`detectHostTheme`），无需搬 | `safe/client.js:4859-4903` vs `comm:14029-14052` |
| `AttentionToast` 悬浮胶囊（见 3.1） | 无 | **移植**（需 `attention` op） | `safe/client.js:23050-23244`、挂载 `23274` |
| `NativeChipMount` 原生界面注入入口（见 3.2） | 无 | 可选 | `safe/client.js:22813-22899` |
| `PurgeDock` 外层浮动面板 | community 用 `PanelOverlays` | 各有各的，不互搬 | `safe:22503`、`22690-22710` vs `comm:15506` |
| 侧栏入口 `sidebar.panellist` | **community 有**（`PurgeGlyphIcon`），safe 主动退役 | 反向差异，不搬 | `comm:15556-15569`；safe 注释 `23275-23276` |
| 主面板分页（`status` / `prompt` / `more`） | **community 有**（`PurgifySection({page})`），safe 是单页 | 反向差异，不搬 | `comm:11217`、`14029-14052`；`safe:3551`（无 page 参数） |
| `HooksDenySection` / `PatchHealth` / `PatchApplySteps` / `RewindSetting` / `HelpTip` | **community 有**，safe 无 | 反向差异，不搬 | `comm:10425`、`10804`、`10928`、`10213`、`10866` |

---

## 2. 演练台视图差异（重点）

### 2.1 safe 的完整视图清单

枚举方式：`tabs` 数组（`safe/lib/redteam/client.js:15892-15899`）+ `TAB_ALIASES`（`15908`）+ `body` 分派链（`15937-15955`）+ 组件定义扫描（`grep -nE "^    function [A-Za-z]+Tab"`）。

#### A. 12 个正式 tab

| # | 视图 key | 标题 | 归到哪个 TAB_GROUP | community 有无 | 依赖的后端 action |
|---|---|---|---|---|---|
| 1 | `overview` | 态势 | `overview` 工作总览 | **无** | `attention`、`scoreChain`、`scores`、`sessions`、`agentsStatus` |
| 2 | `assets` | 资产测绘 | `assets` 资产台账 | 有 | `assets`、`asset`、`domains`、`web` |
| 3 | `env` | 环境适配 | `settings` 环境与设置 | 有 | `platformConfigGet`、`platformConfigSave`、`platformAssignToolkit`、**`intelStatus`**、**`intelRefresh`** |
| 4 | `agents` | 智能体 | `collaboration` 协同进度 | 有 | `prompts` / `bootstrap`、`agentsStatus` |
| 5 | `sessions` | 会话隧道 | `resources` 资源中心 | 有 | `sessions`、`probeSessions`、`updateTunnel`、`updateWebshell` |
| 6 | `artifacts` | 凭据与文件 | `resources` 资源中心 | **无** | `attackFiles`、`credentials`、`access` |
| 7 | `findings` | 漏洞战果 | `results` 成果与报告 | 有 | `vulns`、`updateVuln`、`attackFiles` |
| 8 | `chain` | 攻击链 | `results` 成果与报告 | 有 | `scoreChain` |
| 9 | `scores` | 得分目标 | `results` 成果与报告 | 有 | `scores`、`saveScorePoint`、`deleteScorePoint` |
| 10 | `report` | 报告 | `results` 成果与报告 | 有 | `scoreReport`、`scoreChain` |
| 11 | `knowledge` | 知识库 | `resources` 资源中心 | 有 | `pocSearch`、`pocGet`、`pocUse` |
| 12 | `skills` | 技能库 | `resources` 资源中心 | 有 | `skillCatalog`、`skillRead` |

#### B. 3 个别名（不进 `tabs`，但能被 `st.tab` 命中）

| 别名 key | 分组归到 | 实际渲染 | community 有无 | 备注 |
|---|---|---|---|---|
| `testing` | `assets` | `AssetsTab`（`safe:15965`） | 有 | 历史名，与 `assets` 同一组件 |
| `attackfiles` | `artifacts`（`TAB_ALIASES`） | **`FindingsTab`**（`safe:15970`） | 有 | ⚠️ **别名与分派不一致**：分组高亮「资源中心」，正文却是「漏洞战果」。社区版同样有此问题（`comm:4063`），移植时可顺手修掉 |
| `prompts` | `agents` | `AgentsTab`（`safe:15944`），其内部再嵌 `PromptsTab`（`safe:15526`） | 有 | 提示词编辑器已并入智能体页 |

#### C. 8 个视图内子视图（非 tab，随父视图渲染）

| 子视图 | 定义 | 宿主视图 | community 有无 | 说明 |
|---|---|---|---|---|
| `DiscoveryView` | `safe:11084`（53 行） | `AssetsTab` | 有（`comm:1155`） | 完全同源 |
| `HttpBlock` | `safe:11405`（58 行） | `FindingsTab` / `ReportV2` | 有（`comm:1503`） | 原始 HTTP 报文高亮 |
| `detailEvidence` | `safe:11423` | `FindingsTab` | 有（`comm:1521`） | 证据摘要 + HTTP 证据分块 |
| `ShotStrip` | `safe:10229` | `FindingsTab` / `ReportTab` / `ReportV2` | 有（`comm:657`） | 截图横条 |
| `CredentialList` | `safe:11463`（25 行） | `ArtifactsTab` | **无** | 见 2.3.5 |
| `AccessList` | `safe:11488`（14 行） | `ArtifactsTab` | **无** | 见 2.3.5 |
| **`SessionMap`** | `safe:14798`（**623 行**） | `AgentsTab`（`safe:15477`） | **无** | 见 2.3.3 |
| **`ReportV2`** | `safe:12029`（**119 行**，配套 `.rt-r2-*` 121 处） | `ReportTab`（`safe:12205`） | **无** | 见 2.3.4 |

#### D. 定义了但从未渲染的组件（死代码，不算功能）

| 组件 | 定义 | 渲染处 | 结论 |
|---|---|---|---|
| `ProxySettings` | `safe:12745-13187`（**443 行**） | **0 处**（`grep -c "h(ProxySettings"` = 0） | 死代码 + 无后端，见 §6 |
| `SidebarButton` / `HeaderButton` / `FullButton` | `safe:16190-16214` | 仅 `void` 引用（`safe:16240-16243`） | 入口已改由外层 `client.js` 提供 |

### 2.2 safe 的 TAB_GROUPS 分组方案

原文照抄（`safe/lib/redteam/client.js:15900-15909`）：

```js
      const TAB_GROUPS = [
        { key: 'overview', label: '工作总览', tabs: ['overview'] },
        { key: 'assets', label: '资产台账', tabs: ['assets'] },
        { key: 'collaboration', label: '协同进度', tabs: ['agents'] },
        { key: 'results', label: '成果与报告', tabs: ['findings', 'chain', 'scores', 'report'] },
        { key: 'resources', label: '资源中心', tabs: ['sessions', 'artifacts', 'knowledge', 'skills'] },
        { key: 'settings', label: '环境与设置', tabs: ['env'] },
      ]
      const TAB_ALIASES = { testing: 'assets', attackfiles: 'artifacts', prompts: 'agents' }
      const groupOf = (tab) => TAB_GROUPS.find((g) => g.tabs.indexOf(TAB_ALIASES[tab] || tab) !== -1) || TAB_GROUPS[0]
```

分组语义（`safe:16177` 的 eyebrow 映射）：

| key | label | eyebrow | 含视图 | tab 数 |
|---|---|---|---|---|
| `overview` | 工作总览 | 项目空间 | overview | 1 |
| `assets` | 资产台账 | 资产管理 | assets | 1 |
| `collaboration` | 协同进度 | 协作空间 | agents | 1 |
| `results` | 成果与报告 | 成果记录 | findings / chain / scores / report | 4 |
| `resources` | 资源中心 | 资源与配置 | sessions / artifacts / knowledge / skills | 4 |
| `settings` | 环境与设置 | 运行配置 | env | 1 |

配套：`rt-nav-section-break` 在 `resources` 前插入「资源与配置」分隔（`safe:16130`）；分组图标走 `navIconPaths`（`safe:16070-16078`，6 条 SVG path）。

### 2.3 safe 独有的视图逐个展开

#### 2.3.1 `overview` — 态势（OverviewTab，`safe:10348-10615`，268 行）

**干什么**：操作员打开面板的第一屏。回答四件事 —— 打到哪、下一步打什么、手上有什么入口、哪里卡住。

四个区块：

| 区块 | 内容 | 数据源 |
|---|---|---|
| **待办条** `rt-ov-attn`（`10464-10512`） | 「现在需要你决定 N 条」；每条列 `stage`（等你解答 / 等你验收 / 卡住了 / 失败了 / 在跑）+ 谁 + 原因 + `needs[]` 徽章；空时降级为「该派下一个智能体了 + N 个覆盖度缺口」；底部三键：**填入主会话输入框** / 看智能体 / 看下一步得分 | `op:'attention'`，8s 轮询（`10382-10391`） |
| **四宫格事实条** `rt-ov-facts` | 资产对象 / 存活资产 / 开放端口 / 成果记录，每个可点跳 tab | `snapshot.stats` |
| **得分主卡 + 五阶段轨道** `rt-ov-hero` | 累计得分、当前阶段 chip、五阶段（信息收集→互联网权限→边界突破→内网权限→靶标权限）逐段得分/累计/占比条 | `op:'scoreChain'` |
| **三张详情卡** | ① 得分明细（「当前得分」/「下一步得分」双 tab：已得分 Top5 + 高分缺口 Top5，带 `cap_used/cap` 进度条）② 会话与通道（WebShell 在线/总数、隧道可用/总数、前 3 条隧道地址）③ 协同与待测（未评资产、服务已拿满、执行智能体 used/max） | `op:'scores'`、`op:'sessions'`、`op:'agentsStatus'`、`snapshot.tests` |

**数据从哪来**：`Promise.all([scoreChain, scores, sessions, agentsStatus, attention])`（`10354-10364`）+ 单独一条 8s 的 `attention` 轮询（`10382-10391`）。

**依赖哪些 store 方法**：

| store 方法 | safe 行号 | community |
|---|---|---|
| `attentionQueue(id, opts)` | `store-core.js:2058` | **无** |
| `acknowledgeAgentReports(id, opts)` | `store-core.js:2008` | **无** |
| `hostNextActions(id, opts)` | `store-core.js:1738` | **无** |
| `assetNextActions(id, opts)` | `store-core.js:1854` | **无** |
| `sessionBinding(sessionId)` | `store-core.js:1144` | **无** |
| `latestAgentReports(id, parent, opts)` | `store-core.js:2035` | **无** |
| `scoreChain` / `scores` / `sessions` / `agentsStatus` | — | 有 |

**能不能在 community 的 store 上跑**：**不能，一行都跑不了。**
`overview` 的五个数据源里，`scoreChain`/`scores`/`sessions`/`agentsStatus` 四个 community 都有，但 `attention` 不存在 → `10354` 的 `Promise.all` 直接 reject → `setErr('读取战况失败')`，整页只剩错误条。要跑起来必须整套搬 `agent_report` 事实表 + 覆盖度引擎（详见 §4.1）。

#### 2.3.2 `artifacts` — 凭据与文件（ArtifactsTab，`safe:11502-11545`，44 行 + 2 个子组件）

**干什么**：把原先塞在「漏洞战果」里的**凭据**、**已获得访问会话**、**攻击文件**三块拆出来独立成页，三块都用 `<details>` 默认折叠，各自带计数徽章与独立滚动区（`role="region" tabIndex=0`）。顶部工具条给四个计数：凭据 N / 访问会话 N / 攻击文件 N。

**数据从哪来**：三个 op 并行（`11514-11516`）：

```js
api({ op: 'attackFiles', engagement: eng }).then((r) => setFiles((r && r.items) || []), () => {})
api({ op: 'credentials', engagement: eng }).then((r) => setCreds((r && r.items) || []), () => {})
api({ op: 'access', engagement: eng }).then((r) => setAccesses((r && r.items) || []), () => {})
```

**依赖哪些 store 方法**：

| store 方法 | safe 行号 | community 行号 |
|---|---|---|
| `listCredentials(id, f)` | `store-core.js:2992` | `store-core.js:2298` ✅ |
| `listAccess(id, f)` | `store-core.js:3019` | `store-core.js:2325` ✅ |
| `listAttackFiles(id, f)` | `store-core.js:5262` | `store-core.js:4487` ✅ |

对应 op 分派也在两边都有：`store-core.js:964/966` vs `community:820/822`。

**能不能在 community 的 store 上跑**：**能，零后端改动。** 三个 op、三个 store 方法、三张表（`credential` / `access_session` / `attack_file`）community 全都有。唯一缺的是 `SecretText`（`safe:592-611`，默认掩码 + 显示/隐藏切换）和 `CredentialList` / `AccessList` 两个展示组件 —— 纯前端。

#### 2.3.3 `SessionMap` — 会话关系图（`safe:14798-15420`，623 行）

**干什么**：把「当前项目绑定的宿主会话 + 其子会话」画成一张可交互的父子关系 SVG 图。

功能点：

| 能力 | 实现位置 |
|---|---|
| 5s 自动刷新 + 暂停（`paused`），暂停超 60s 标 `已暂停，可能已过时` | `14961-14966`（5s 定时器）、`14988-15007`（陈旧判定） |
| 搜索（名称/待办/编号/工作目录）+ 活动度筛选（all / running 等） | `14542-14577`（`selectSessionMapVisible`）、`14985` |
| 自动树形布局 + 手拖节点（`pointerCapture`）+ 布局按项目缓存在 `nodePositions` | `14608-14683`（`layoutSessionMap`）、`15030-15058` |
| 缩放（滚轮 + 按钮 0.08–2.4，锚点缩放）+ 平移 + `fit('readable'/'all')` + `ResizeObserver` 自适应 | `15014-15029`、`15060-15075` |
| 全屏（原生 `requestFullscreen` + Esc 退出 + `fullscreenchange` 同步） | `14840-14866` |
| 右侧详情：会话名、模式（`subagentMode`）、计时（`subagentTiming`）、**待办清单与完成比例**（`todos` / `taskProgress`）、`childCatalog`、父会话上下文（`summarizeSessionMap`） | `14992-15002`、`14578-14607` |
| 陈旧保护：`stale` / `pausedStale` / 三档文案「读取失败，保留上次快照；不会宣称当前在线」 | `15003-15004`、`15257` 区 |

**数据从哪来**（两条完全不同的通道，这点必须注意）：

| 数据 | 通道 | 代码 |
|---|---|---|
| 项目→会话绑定 | `POST /redteam/api` `{op:'sessionBindings'}` | `14752-14776` |
| 宿主会话摘要 | **直打宿主 RPC** `POST /api/session/list`，`{type:'client-request', rpcId, method:'session/list', payload:{args:{_request:{}}}}` | `14724-14750` |
| 超时 | `SESSION_MAP_REQUEST_TIMEOUT_MS`，AbortController | `14286` 区常量 |

**能不能在 community 的 store 上跑**：**不能。** 两个前置都缺：
① `sessionBindings` op 与 `sessionBindings()` / `setSessionBinding()` store 方法（`store-core.js:1117-1176`）community 完全没有，`sessions.json` 落盘也没有；
② 直打宿主 `/api/session/list` 这条路虽然与 store 无关，但缺 ① 就没有「哪些会话属于这个项目」的过滤依据 —— `scopeSessionSummaries`（`14449`）会把空数组交给布局函数，整图空白。

#### 2.3.4 `ReportV2` — 四段式得分报告（`safe:12029-12147`，119 行）

**干什么**：`scoreReport` 返回 `report` 字段时，`ReportTab` 切到 V2 渲染（`safe:12204-12208`），把报告从「平铺卡片」改成四段式交付文档：

| 段 | 内容 | 关键实现 |
|---|---|---|
| 一、资产归属证明 | 1.1 互联网资产 / 1.2 内网入口资产，每条一张「归属证明卡」：IP + 类型 + 证明强度（强/弱徽章）+ 归属证据 + **归属截图** | `12039-12049`（proofCard）、`12050-12053`（proofSection） |
| 二、得分汇总表 | 阶段 × 计分项 × 得分总表，再按阶段拆子表（internet 5 列 / boundary 4 列 / 其余 5 列，列头按阶段变） | `12136-12147` |
| 三、得分点复现 | 3.1 互联网 / 3.2 边界突破 / 3.3 内网 / 3.4 靶标权限。每条：漏洞说明、结果、**`replay_cmd` 可复制命令块**、前 3 条 **Yakit/HTTP 原始报文**、攻击文件路径、证据文件、复现截图、`gaps[]` 缺口提示 | `12067-12090`、`12126-12135` |
| 顶部工具条 | 合计分 / 计分项 / **可复现 x/y**（`summary.incomplete`）/ 复制全文 / 下载 .md / 重新生成 | `12116-12135` |

**数据从哪来**：单一 `op:'scoreReport'` 的 `report` 字段（`safe:12161`），无额外请求。

**依赖**：`report.asset_proof` / `report.repro` / `report.stage_tables` / `report.stage_summary` 这套 model 由 host 侧生成（`store-core.js` 里 `asset_proof` 出现 2 次）。`ShotStrip`（`safe:10229-10238`）在 community 也有（3 处引用），可直接复用。

**能不能在 community 的 store 上跑**：**半能**。渲染层不依赖新 op，只要 community 的 `scoreReport` 也吐 `report` 字段就能直接渲染。但 community 的 `scoreReport` 是否产出 `report` 需要实测；`asset_proof`（归属证明）依赖 safe 独有的 `data_proof` 表与归属判定，社区版拿不到数据 → 第一段会是「未采集到对应资产证据」。建议**先搬渲染层，再补 `asset_proof` 后端**。

#### 2.3.5 `CredentialList` / `AccessList` / `SecretText`（`safe:11463` / `11488` / `592`）

- `CredentialList`：凭据卡（host / username / secret_type / privilege / 复制 / 掩码值 / 来源·工具·证据·by·时间 / 备注）。
- `AccessList`：访问会话行（host / username / method / privilege / session_ref）。
- `SecretText`：默认 `••••••••`，点「显示」才展开，`wordBreak: break-all`；空值走 `props.empty` 文案。

community 在 `FindingsTab` 里也渲染凭据，但是内联写法、无掩码切换。属于**纯前端增量**。

---

## 3. safe 独有的独立模块

| 模块 | 行数 / 大小 | 作用 | 依赖 | 能否独立移植 | 证据 |
|---|---|---|---|---|---|
| **`lib/ui-fullscreen.js`** | 288 行 | `useWorkbenchFullscreen(React, ref, opts)`：CSS 扩展态 + 原生 Fullscreen API 的机会式使用，处理 Shadow DOM 重定向、`webkit` 前缀、取消竞态；导出 `FULL_REQUEST_EVENT` 让外部按钮可请求全屏 | 仅 React | **能，零依赖** | `safe/lib/ui-fullscreen.js:1-288`；内联进 `client.js:2-291` 与 `5586-5885`、`lib/redteam/client.js:2-301`（`__DSH_PURGE_FULLSCREEN_BEGIN__` / `_END_`） |
| **`AttentionToast` 悬浮胶囊**（在 `client.js` 内） | ≈ 195 行 + CSS 2363-2400 | 右下角可拖拽胶囊：只显示「有人在等」的人数；悬停/聚焦展开成卡片；「稍后」10 分钟（卡住/失败 3 分钟）收成小圆点而非消失；位置存 `localStorage`；拖拽用 `pointerCapture` + 坐标判离（不信 `pointerleave`）；`suppressRef` 挡掉抬手后补发的 click | `attention` op + i18n `attn.toast.*` | **能，但需 `attention` op** | `safe/client.js:23050-23244`（组件）、`21918-21985`（`attentionState` + `useAttention` + 8s 轮询）、`23019-23035`（位置持久化）、`2363-2400`（CSS）、`719-725`/`1069-1075`（i18n） |
| **`NativeChipMount` 原生界面注入** | ≈ 90 行 | 用 `MutationObserver` + 轮询找到官方「新会话」hero 行和 tab 行，`createPortal` 注入一枚「演练台」按钮；用 `findControlByLabels` 按可见文案定位锚点，避免硬编码 class | `react-dom`（宿主 seed） | **能**，但**依赖宿主 DOM 结构**，宿主升级即失效，需随版本维护 | `safe/client.js:22813-22899`、`22719-22812`（`findHeroAnchor` / `findControlByLabels` / `TAB_ROW_LABELS`） |
| **`lib/redteam/kev.js`** | 7,283 B | CISA KEV 本地缓存：拉 1.6 万条静态 JSON，TTL 24h，落 `kb/cve-kev.json`，进程内 memo，失败静默返回 `unavailable` | `node:fs` / `node:http(s)` | **能，零依赖** | `safe/lib/redteam/kev.js:1-40`；UI 出口 `lib/redteam/client.js:13416-13423`（环境适配页「情报保鲜」块） |
| **`lib/redteam/bootstrap-runtime.js`** | 25,910 B | 模板库保鲜（nuclei-templates 状态/刷新）+ 建库引导；`templatesStatus` / `refreshTemplateLibrary` | `node:sqlite`（动态 import） | 能（含 sqlite 初始化，较重） | `safe/lib/redteam/store-core.js:52-56`（动态 import 注释）；`tools.js:31-32` |
| **`lib/redteam/slot-state.js`** | 1,507 B | 子智能体「停车」状态（`isParked` / `parkAgent` / `unparkAgent`）—— 名额满时不拒绝而是登记排队 | 无 | 能 | `safe/lib/redteam/tools.js:36`、`ui.js:26`；UI 出口 `lib/redteam/client.js:15461-15463`（`等资源 N` 徽章） |
| **`lib/redteam/team-mode.js`** | 11,722 B | **非 UI**：给红队根会话补写一条 `team/mode` 事件，让官方 Agent Teams 任务板默认开启。三条边界：只写根会话、只写一次、只对红队预设写 | `identity.js` | 能（服务端） | `safe/lib/redteam/team-mode.js:1-45`；`index.js` 17 处引用 |
| **`ProxySettings` 代理池 UI** | 443 行 | 代理配置（direct/http/socks5/mihomo）、YAML 导入预览分页、节点批量检测、连接/断开、切换日志、密码管理 | `proxyPoolGet` / `proxyPoolDisconnect` / `proxyConfigImport` | **不能**：① 从未被渲染；② 三个 op **全仓无后端实现** | `safe:12745-13187`；`grep -c "h(ProxySettings"` = 0；`grep -rln "proxyPool" safe/lib/` 只命中 `client.js`；`grep -rln "mihomo" safe/` 只命中 `client.js` |
| **13 个 `.css` 文件** | 合计 ≈ 470 KB | 设计源文件（studio-skin / overview-workbench / collaboration-view / skills-view / …） | — | **不移植**：全部 0 引用，实际样式内联在 `const CSS`（`safe:741` 起） | 逐个 `grep -c "<basename>" client.js` 全为 0（`skills-view.css` 唯一 1 处命中是注释 `7942`） |
| **`__DSH_PRODUCT_SKIN` token 层** | `safe:1765-10080`（≈ 8,300 行 CSS） | 一整套 `--ui-*` 设计令牌（canvas/surface/text/space/glass/water…）× 明暗两套 × studio 皮肤 | — | **必须随任何 safe 组件一起搬**，否则 `--ui-text` / `--ui-glass-edge` 等 600+ 处引用全部失效 | `safe:1765`（BEGIN）→ `10080`（END）；`--ui-text` 在 safe 内 614 处引用，community **0 处** |

---

## 4. 依赖分析：移植一个视图要动几处

### 4.1 `overview`（态势）—— 11 处改动，其中 5 处在后端

| # | 层 | 位置 | 改什么 |
|---|---|---|---|
| 1 | **schema 表结构** | `safe/lib/redteam/schema.js:373-390` | 新增 `agent_report` 表（`session_id / parent_session / role / label / status / blocked_reason / needs / summary / created_at / acknowledged_at`）+ 两个索引 |
| 2 | schema 迁移 | `schema.js:605-607`（`ensure('agent_report','acknowledged_at','TEXT')`）、`721-739`（老库补建表） | 老库补列 + 补建 |
| 3 | schema 覆盖度表 | `schema.js:270`（`data_proof`）、`281`（`cleanup_item`）、`324`（`asset_coverage`）、`341`（`host_coverage`）、`358`（`host_finding`） | `attentionQueue` 的 `pending_coverage` 来自 `hostNextActions` + `assetNextActions`，这两个函数读 `host_coverage` / `asset_coverage` |
| 4 | **store 聚合** | `store-core.js:1970`（`recordAgentReport`）、`2035`（`latestAgentReports`）、`2008`（`acknowledgeAgentReports`）、`2058`（`attentionQueue`）、`1738`（`hostNextActions`）、`1854`（`assetNextActions`） | 6 个方法，约 400 行 |
| 5 | **op 分派** | `store-core.js:899`（`attention`）、`925`（`attentionAck`） | 2 个 op；`attention` 还需 `sessionBinding` 兜底（`910`） |
| 6 | store 绑定表 | `store-core.js:1117`（`sessionBindingsPath`）、`1125`（`sessionBindings`）、`1144`（`sessionBinding`）、`1166`（`setSessionBinding`）、`857-862`（`bindSessionEngagement` op） | `sessions.json` 落盘 + 3 个方法 |
| 7 | **工具面** | `tools.js:1388`（`redteam_attention`）、`1372`（`redteam_next_action`）、`1312`（`redteam_asset_next`）、`1328`（`redteam_host`）、`542`（`recordAgentReport` 唯一写入点） | 4 个工具；没有写入点，队列永远是空的 |
| 8 | **client 组件** | `lib/redteam/client.js:10348-10615`（`OverviewTab` 268 行） | 整组件 |
| 9 | client 挂载 | `15893`（`tabs` 加 `['overview','态势']`）、`15900-15907`（`TAB_GROUPS` 第 1 组）、`15941`（`body` 分派）、`16033`（`pageName` 映射）、`16056`（`genericDescriptions`）、`16177`（eyebrow） | 6 处 |
| 10 | 外层壳 | `client.js:21918`（`attentionState`）、`21956`（`useAttention`）、`23005`（`window.__dshPurgeAttentionGo`）、`22936`（`attentionPrompt`）、`22972`（`fillAttentionPrompt`）、`22995`（`handleAttention`） | 若不做悬浮胶囊，至少要有 `__dshPurgeAttentionGo`，否则「填入主会话输入框」按钮会退化成跳转 |
| 11 | CSS | `safe:1765-10080`（token）+ `rt-ov-*` 规则（`overview-workbench.css` 内容已在 inline CSS 内） | 依赖 token 层 |

**结论**：`overview` 是**全仓最贵的一项**。真正的工作量不在 268 行的组件，而在 `agent_report` 事实表 + 覆盖度引擎 + 4 个工具。**建议最后做，或者先做一个降级版**（去掉待办条，只留四宫格 + 得分轨道 + 三张卡，此时只需 `scoreChain`/`scores`/`sessions`/`agentsStatus`，community 全都有 → 成本骤降到 ~1 天）。

### 4.2 `artifacts`（凭据与文件）—— 6 项核对，其中 3 处需改动、**零后端**

| # | 层 | 位置 | 改什么 |
|---|---|---|---|
| 1 | client 组件 | `lib/redteam/client.js:11502-11545`（`ArtifactsTab` 44 行）+ `11463-11487`（`CredentialList` 25 行）+ `11488-11501`（`AccessList` 14 行）+ `592-611`（`SecretText` 20 行） | 约 103 行 |
| 2 | client 挂载 | `15894`（`tabs` 加 `['artifacts','凭据与文件']`）、`15900-15907`（`TAB_GROUPS` resources 组）、`15945`（`body` 分派）、`15908`（`TAB_ALIASES.attackfiles → artifacts` 已有） | 3 处 |
| 3 | store 聚合 | **无**。`listCredentials`（`store-core.js:2992`）/`listAccess`（`3019`）/`listAttackFiles`（`5262`）community 全有（`community:2298/2325/4487`） | 0 |
| 4 | op 分派 | **无**。`credentials`/`access`/`attackFiles` community 全有（`community:820/822`） | 0 |
| 5 | schema | **无**。`credential` / `access_session` / `attack_file` community 全有 | 0 |
| 6 | CSS | `.rt-artifacts-*` / `.rt-credential-*` / `.rt-access-*` / `.rt-secret*` 规则 | 若不做 token 层，需把这些规则里的 `--ui-*` 引用替换为 community 现有变量 |

**结论**：`artifacts` 是**投入产出比最高的一项** —— 103 行前端、0 后端、0 表结构。

### 4.3 成本对比

| 视图 | client 行数 | 新 op | 新 store 方法 | 新表 | 新工具 | 合计改动点 |
|---|---|---|---|---|---|---|
| `artifacts` | ~103 | 0 | 0 | 0 | 0 | **3** |
| `overview`（降级版） | 268 | 0 | 0 | 0 | 0 | **5** |
| `overview`（完整） | 268 + 195 | 2 | 9 | 6 | 4 | **11** |
| `SessionMap` | 623 | 1 | 4 | 0 | 0 | **5**（但含宿主 RPC 直连） |
| `ReportV2` | 119 + 121 处 CSS | 0 | 0 | 1（`data_proof`，仅归属证明段） | 1 | **4** |

---

## 5. 移植清单（按「用户可感知价值 / 移植成本」排序）

| 优先级 | 功能 | 移植后用户能看到什么 | 改动点（文件:行号） | 预估行数 | 风险 | 前置条件 |
|---|---|---|---|---|---|---|
| **P0** | **「凭据与文件」独立页** | 演练台多一个「凭据与文件」页：凭据/访问会话/攻击文件三块分栏折叠，密码默认打码、点「显示」才露，每条都能一键复制 | `lib/redteam/client.js:11502-11545`（ArtifactsTab）、`11463-11487`（CredentialList）、`11488-11501`（AccessList）、`592-611`（SecretText）；挂载 `15894`、`15900-15907`、`15945` | 103 | **低**（0 后端，op 与方法两边都有） | 无 |
| **P1** | **6 分组导航 + 二级页签 + 图标 + 键盘漫游** | 侧栏从「一行 10 个平铺页签」变成 6 个带图标的功能区，点进去再选具体页；方向键/Home/End 可切组；有未读内容的分组亮红点 | `15900-15907`（TAB_GROUPS）、`16106-16121`（navigateGroupKey）、`16129-16145`（分组渲染）、`16158-16174`（subnav）、`16070-16078`（navIconPaths）；CSS `9923-9999` | ~180 + CSS | 中（`data-nav-layout` CSS 与 community 现有 `.rt-dock` 网格冲突，需重排） | token 层（或做变量替换） |
| **P2** | **站内全屏** | 点「全屏浏览」当前窗口直接铺满，Esc 退出；不再弹一个新浏览器窗口丢上下文 | `lib/ui-fullscreen.js:1-288`；`15913-15927`（接入 Panel）；`16155`（按钮） | 288 | 低（独立 hook，可整体替换 `openFull`/`exitFull`） | 无 |
| **P3** | **四段式得分报告（ReportV2）** | 报告页从「一列平铺卡片」变成带编号的交付文档：一、资产归属证明（含截图）→ 二、得分汇总表 → 三、得分点复现（命令块 + Yakit 报文 + 截图 + 缺口提示），顶部显示「可复现 x/y」并能下载 .md | `12029-12147`（ReportV2）、`12204-12208`（ReportTab 分流）；`.rt-r2-*` 121 处 | 119 + CSS | 中（依赖 host 侧 `report` 字段；`asset_proof` 段需 `data_proof` 表） | `scoreReport` 吐 `report`（需实测 community） |
| **P4** | **态势首页（降级版）** | 打开演练台第一屏就是：资产/存活/端口/成果四宫格 + 累计得分大数字 + 五阶段得分轨道（每段占比条）+ 得分明细双 tab（当前得分 Top5 / 下一步得分 Top5）+ 会话与通道 + 协同与待测，所有数字可点跳对应页 | `10348-10615`（OverviewTab，删掉 `10464-10512` 的待办条）；挂载 `15893`、`15900-15907`、`15941` | ~200 | 低-中（只用 community 已有的 4 个 op） | 无 |
| **P5** | **会话地图（SessionMap）** | 「智能体」页多一张可拖拽缩放的父子会话关系图：节点显示会话名与运行状态，点节点右侧看它的待办清单与完成比例、子智能体模式与计时；可暂停刷新、可全屏 | `14798-15420`（SessionMap 623 行）、`14286-14797`（常量 + `scopeSessionSummaries` + `selectSessionMapVisible` + `summarizeSessionMap` + `layoutSessionMap` + 两个 request 函数）、`15477`（挂载） | ~1,200 | **高**（直打宿主 `/api/session/list` RPC，宿主升级即碎；需要 `sessionBindings` 绑定表才有过滤依据） | `sessionBindings` op + `sessions.json` |
| **P6** | **待办悬浮胶囊 + 一键填入输入框** | 右下角常驻一枚可拖到任意位置的小胶囊，写着「N 个智能体在等你」；悬停展开谁卡在哪、缺什么；点「填入输入框」把待办整理成一段可直接发的话塞进当前会话输入框（只填不发）；「稍后」10 分钟后自己回来 | `client.js:23050-23244`（AttentionToast）、`21918-21985`（state + useAttention + 8s 轮询）、`22910-23005`（stage 文案 + attentionPrompt + fillAttentionPrompt + window 钩子）、`2363-2400`（CSS）、`719-725`/`1069-1075`（i18n） | ~350 | 中（依赖 `attention` op；`fillAttentionPrompt` 依赖宿主的 `conversation.input.right` 草稿 API） | `attention` op + `agent_report` 表 |
| **P7** | **环境适配页三分页 + 情报保鲜** | 「环境与设置」页顶部出现「运行概况 / 配置表单 / 高级诊断」三个分页；新增「情报保鲜」块：nuclei 模板库条数与年龄、CISA KEV 公告条数与是否过期，带「按保鲜窗口刷新」「强制重下」按钮 | `13188-13524`（EnvTab）、`store-core.js:52-72`（`intelOps`）、`store-core.js:1026`（分派）；`kev.js:1-40`、`bootstrap-runtime.js` | ~140 + 2 模块 | 中（`bootstrap-runtime` 会拉 `node:sqlite`，需动态 import 避免启动成本） | 无（可选装 `kev.js`） |
| **P8** | **原生界面注入入口（hero / tab 行按钮）** | 官方「新会话」空白页和 tab 行里多出一枚「演练台」按钮，不打开插件面板也能一键唤起 | `client.js:22719-22899` | ~90 | **高**（靠 DOM 文案定位 `findHeroAnchor` / `findControlByLabels`，宿主改版即失效） | 无，但需长期维护 |
| **P9** | **主题皮肤（dusk/white/system）** | 演练台可切深色/浅色/跟随系统，配色与官方外壳一致 | `lib/ui-theme.js`；`15929-15936`（Panel 接入）；`1765-10080`（token） | 8,300 CSS | **高**（整块 token 层，与 community 现有 `.rt-*` 规则大面积重叠） | 建议只搬 token 定义，不搬组件规则 |
| **P10** | **子智能体「等资源」徽章** | 「智能体」页并发条上多一个「等资源 N」徽章，hover 显示是哪几个在排队 | `lib/redteam/client.js:15461-15463`；`slot-state.js:1-40`；`tools.js:36`、`ui.js:26` | ~50 | 低 | 无 |

---

## 6. 明确不移植

| 项 | 理由 | 证据 |
|---|---|---|
| **`lib/net-scope.js` 的地域/银行拒绝层** | **反向能力**：命中地域后缀或银行域名就往会话里写拒绝文本并吞掉这一轮（`parkDenial` + 返回空 messages）。这是 safe 独有的限制层，与「减少拒绝」的产品目标相反 | `safe/lib/net-scope.js:627`（`installRegionGate`）、`629-655`（`agent/pre-step` hook）、`634`（`taskTargetHit`）、`470-471`（`regionOfSuffix` / `bankHit` 命中即返回）、`464-474`（`taskTargetHit` 定义）、`253-257`（`regionOfSuffix`）、`434-436`（`taskHit`）。文件 669 行 vs community 412 行，多出的 257 行主要是这张表 |
| **`ProxySettings` 代理池 UI** | ① 定义了但**从未渲染**（`grep -c "h(ProxySettings"` = 0）；② 依赖的 `proxyPoolGet` / `proxyPoolDisconnect` / `proxyConfigImport` 三个 op **全仓无后端实现**（`grep -rln "proxyPool" safe/lib/` 只命中 `client.js`，`grep -rln "mihomo" safe/` 同样只命中 `client.js`）。搬过来就是一个永远显示「读取代理设置失败」的空壳 | `safe:12745-13187`；`12854`、`12870`（两次 `proxyPoolGet` 调用）；`safe/lib/redteam/store-core.js` 中 `proxyPool` 命中 0；`community/` 全仓 `mihomo`/`proxyPool` 命中 0 |
| **13 个 `.css` 设计源文件** | 全部 0 引用，样式实际内联在 `const CSS` 模板串里。搬文件不会产生任何视觉变化，只会制造两份真相 | `assets-view.css` / `collaboration-view.css` / `detail-surfaces.css` / `overview-workbench.css` / `responsive-dock.css` / `sessions-view.css` / `settings-view.css` / `skills-view.css` / `studio-skin.css` / `unified-components.css` / `unified-layout.css` / `workbench-layout.css` / `workspace-skin.css` —— 逐个 `grep -c "<basename>" client.js` 全为 0（`skills-view.css` 唯一 1 处命中在 `7942` 行是注释） |
| **`team-mode.js`** | **非 UI**：它是服务端给红队根会话补写 `team/mode` 事件、让官方 Agent Teams 任务板默认开启。它不产生任何 safe 独有的界面元素，只会改变官方任务板的存在与否。要搬应走「服务端能力移植」，不在本清单 | `safe/lib/redteam/team-mode.js:1-45`；`index.js` 17 处引用；community 对应能力由 `lib/steering.js` + 官方 `defaultEnabled` 承担 |
| **`__DSH_PRODUCT_SKIN` 整套 8,300 行 CSS** | 与 community 现有 `.rt-*` 规则大面积重叠（safe 把 community 的 `.rt-tab` 体系整体重写成 `.rt-tab-group` + `--ui-*` token）。整块搬进来会同时出现两套导航样式，必须先删 community 的旧规则 —— 属于「换壳」不是「加功能」 | `safe:1765`（BEGIN）→ `10080`（END）；`--ui-text` safe 614 处 / community 0 处；`rt-studio` safe 848 处 / community 0 处 |
| **`attackfiles` 别名指向 `FindingsTab` 的旧行为** | 这是**既有 bug**：`TAB_ALIASES.attackfiles = 'artifacts'`，但分派链渲染 `FindingsTab`，导致分组高亮「资源中心」而正文是「漏洞战果」。移植 `artifacts` 时顺手修正为 `ArtifactsTab`，不要照搬 | `15908`（别名）vs `15970`（分派）；`community:4063` 同样问题 |
| **`VersionBar` 的在线更新按钮** | **反向差异**：community 的 `VersionBar`（`comm:3679-3843`，165 行）带 `updateCheck`/`updateApply` 自动更新；safe 的只有 88 行、纯显示版本（`safe:15590-15677`）。这一项是 community 领先，方向反了 | `safe` 的 op 集合里没有 `updateCheck`/`updateApply`/`version`；`comm` 有（`comm` ops 列表 + `ui.js:957-1000`） |
| **community 的 `evidence-ledger` 与 `unknown` 注册表** | 同样是**反向差异**：community 独有 `redteam_evidence_record/list/verify/upgrade` + `redteam_unknown_record/list/resolve` + `redteam_unverified_count` 8 个工具和 `evidence-ledger.mjs`（21,577 B）。safe 没有。移植方向应从 community → plus，不是从 safe | `community/lib/redteam/evidence-ledger.mjs`；工具名 diff（safe 独有 11 / community 独有 8） |

---

## 附：本次核对用的枚举命令

```bash
# 12 个 tab + 3 别名 + 6 分组
sed -n '15892,15908p' vendor/safe/lib/redteam/client.js
sed -n '4008,4014p'   vendor/community/lib/redteam/client.js

# 视图组件定义（15 个 vs 13 个）
grep -nE "^\s*(var|let|const)\s+[A-Za-z]+Tab\s*=|function\s+[A-Za-z]+Tab\s*\(" vendor/safe/lib/redteam/client.js
grep -nE "^\s*(var|let|const)\s+[A-Za-z]+Tab\s*=|function\s+[A-Za-z]+Tab\s*\(" vendor/community/lib/redteam/client.js

# op 集合差（safe 独有 9 / community 独有 3）
grep -ohE "op: '[a-zA-Z]+'" vendor/safe/lib/redteam/client.js | sort -u
grep -ohE "op: '[a-zA-Z]+'" vendor/community/lib/redteam/client.js | sort -u

# 表结构差（去重后 safe 独有 6）
grep -oE "CREATE TABLE IF NOT EXISTS [a-z_]+" vendor/{safe,community}/lib/redteam/schema.js | awk '{print $NF}' | sort -u

# CSS 是否真被引用（全 0 = 死资产）
for f in vendor/safe/lib/redteam/*.css; do
  echo "$(basename $f) refs=$(grep -c "$(basename $f)" vendor/safe/lib/redteam/client.js)"
done

# ProxySettings 是否被渲染（0 = 死组件）
grep -c "h(ProxySettings" vendor/safe/lib/redteam/client.js
grep -rln "proxyPool" vendor/safe/lib/
```
