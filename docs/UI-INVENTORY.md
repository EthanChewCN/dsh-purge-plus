# plus / community 全 UI 功能清单

## 0. 口径

### 0.1 读了什么

| 文件 | 行数 | 角色 |
|---|---|---|
| `dist/build/package/client.js` | 15,601 | 顶层面板（浏览器半侧）。含 6 个 tab、补丁面板、规则、技能、维护、回退按钮、授权门、欢迎页；并内联了整份演练台（`// src/vendor/drill.js`，第 271–8957 行） |
| `dist/build/package/lib/redteam/client.js` | 4,218 | 演练台独立打包版（与上面内联那份同源） |
| `dist/build/package/lib/redteam/ui.js` | 1,156 | `/redteam/api` 路由 + 前置 op 处理（platform / agents / update / skill） |
| `dist/build/package/lib/redteam/store-core.js` | 5,414 | `dispatch()` / `dispatchAsync()`：`/redteam/api` 的 op 总表 |
| `dist/build/package/lib/index.js` | 3,020 | `/dsh-purge/*` 全部路由、`/dsh-purge/community` 维护路由、rules/skills 的 op 分发 |
| `dist/build/package/lib/update.js` | 1,700+ | `/dsh-purge/update` 的 POST op 分支（`handleUpdateOp`） |
| `dist/build/package/lib/community.js` / `desktop.js` | 968 / 1,540 | 维护对象、桌面端换包 |
| `dist/build/package/lib/redteam/tools.js` | 2,256 | 智能体工具面（解释了"后端有、面板无"的 op 从哪来） |

合计机械扫描 **39,000+ 行**。

### 0.2 怎么读的

1. **op 集合抽取是机械的**，不是人工归纳：
   - 前端：`grep -oE '\bop: *"[A-Za-z0-9_]+"' client.js` 与 `\bop: *'[A-Za-z0-9_]+' lib/redteam/client.js`（`\b` 用来排除 CSS 的 `borderTop:` / `top:` 误命中）。
   - 后端：`op === 'x'`、`op !== 'x'`、以及唯一的数组式 `['version','updateCheck','updateApply'].includes(request.op)`（`ui.js:957`）。
   - 双向差集用 Python 求，结果见第 5 节。
2. 四个 op 值（`apply` / `channel` / `switch` / `preferences`）虽然写作 `op: "…"`，但发往 `/dsh-purge/update` 与 `/dsh-purge/community`，**不计入** `/redteam/api` 集合。
3. 路由方法（GET/POST）取自每个 handler 内部的 `request.method !== "X"` 判定，不是靠命名猜。
4. 本文只列事实，不评价实现好坏。

### 0.3 三个入口面

- 设置页 / 侧栏面板 → `PurgePage`（`client.js:13950`）
- 插件详情页 / 插件行 → `DetailSettings`（`client.js:15501`）
- 覆盖层 → `PanelOverlays`（`client.js:15506`）

---

## 1. 顶层六个 tab

tab 表定义在 `client.js:13805-13812`（`TABS`），渲染在 `PurgePage`（`client.js:13950`），各 tab 的 body 在 `client.js:14027-14072`。

| # | key | 标题 | 副标题（tab 下方那行） | 源码 |
|---|---|---|---|---|
| 1 | `status` | 状态 | 宿主兼容、补丁、破甲自检 | `client.js:13806` |
| 2 | `prompt` | 提示词 | 注入正文与破甲强化段 | `client.js:13807` |
| 3 | `rules` | 规则 | 规则集与工作区策略 | `client.js:13808` |
| 4 | `skills` | 技能 | DSH 技能目录 | `client.js:13809` |
| 5 | `drill` | 演练台 | 红队演练与环境适配 | `client.js:13810` |
| 6 | `more` | 更多 | 会话外观与服务器设置 | `client.js:13811` |

惰性挂载：`prompt` / `rules` / `skills` / `more` 只有 `visited[id]` 为真才渲染（`client.js:14035`、`14040`、`14045`、`14050`）；`drill` 每次切到就挂（`client.js:14054`）。

### 1.1 状态（`status`）

body：`StatusStrip` → `PurgifySection page="status"` → `StatusExtras` → `CommunityMaintenance`（`client.js:14028-14033`）

| 区块 | 显示什么 | 可点的动作 | 后端接口 | 源码 |
|---|---|---|---|---|
| 顶部状态条 | DSH 版本、兼容级别（qualified/unverified/…）、`磁盘写入计数 applied/total · N 条本机不适用`、插件版本 | 无（纯展示，每个指标带 `HelpTip` 问号） | `GET /dsh-purge/status` | `client.js:13829`；调用 `client.js:13959` |
| 标题行 | `状态` + 右侧操作组 + 扫描时间 | 应用（带待应用条数）、回退、卸载、刷新（显示上次扫描时间） | `POST /dsh-purge/apply`、`POST /dsh-purge/revert`、`POST /dsh-purge/uninstall`、`GET /dsh-purge/status` | `client.js:11529` 起 `doAction`；fetch 在 `client.js:11539`；卸载 `client.js:11762` |
| 换包/布局提示 | `app.asar` 是否仍封、换包阶段（starting/ready/waiting_for_quit/…）、失败详情与 win32 code | 无（`details` 可展开） | `GET /dsh-purge/status`（`host_layout` / `asar_handoff` 字段） | `client.js:13885` |
| 版本不一致提示 | 官方版本 ≠ `1.7.20-plus.3` 时告警 | 无 | 同上（`plugin_version`） | `client.js:13934` |
| 健康度 | 大数字 `applied / denom`、判定语、三段进度条、四个格子（已应用/待应用/未生效/不适用） | 无 | `GET /dsh-purge/status`（`patch_rows`） | `client.js:10425` |
| 补丁组开关 | 「权限补丁组」「上下文管理」两个开关，各带 chip（已写入/待应用条数） | 拨动开关（写 tuning，需再点「应用」才落宿主） | `GET/POST /dsh-purge/boost`（`permissionPatches` / `contextManagement`） | `client.js:10533`；POST `client.js:10568` |
| 补丁明细 | 按组折叠的补丁表：编号、名称、英文标识、状态胶囊；顶部筛选（全部/待应用/未生效/不适用）与每组计数 | 展开/收起组、切换筛选（纯前端） | `GET /dsh-purge/status` | `client.js:10633`（`FILTERS` 在 `10632`） |
| 写入流程 | 三步说明（写补丁→清缓存→重启） | 无 | 无（静态） | `client.js:10804` |
| 高级选项（折叠） | hooks 拒绝旁路复选框 | 勾选即保存 | `GET/POST /dsh-purge/hooks-deny` | `client.js:10928`；GET `10934`、POST `10943` |
| 卸载确认弹窗 | 标题/正文/取消/确认 | 取消、确认卸载 | `POST /dsh-purge/uninstall` | `client.js:12013-12022`（弹窗）、`11762`（请求） |
| 破甲自检 | 逐层状态（N 层未生效 / N 条待应用 / N 层需确认 / N 层全部在位）、逐层明细（应用数/必需数/待应用编号/note） | 重测、探针 | `GET /dsh-purge/selfcheck`、`POST /dsh-purge/probe` | `client.js:13102`；`13108`、`13130`、`13209` |
| 破甲强化段 | 已开启/已关闭 + 提示 | 开启/关闭（提示"重启后生效"） | `GET/POST /dsh-purge/boost`（`enabled`） | `client.js:13116`（POST） |
| 维护：更新与本机备份 | 本机版本徽章、更新通道摘要（代理/直连、GitHub 密钥是否已配，密钥不回显）、更新偏好表单、检查更新/最近动作/发行记录链接、发行版下拉 + 安装所选版本 | 检查更新、最近动作（读审计）、打开 GitHub releases、安装所选版本、刷新备份列表、立即备份、选备份、回滚插件、打开更新通道对话框 | `GET/POST /dsh-purge/community`（`check`/`update`/`backup`/`rollback`/`preferences`）、`GET /dsh-purge/audit?limit=10` | `client.js:13571`；GET `13584`、POST `13631`、审计 `13696` |
| 更新偏好表单 | 自动检查更新开关、镜像/代理/密钥入口 | 保存（`op:"preferences"`）、打开通道对话框 | `POST /dsh-purge/community` | `client.js:13276`；POST `13295` |
| 更新通道对话框 | 镜像 URL、代理 URL、GitHub Token（可清除） | 保存、取消 | `POST /dsh-purge/community` | `client.js:13389`；POST `13430` |
| 重启提示卡 | 「需要完整退出」/「正在重启」 | 稍后、立即重启 | `POST /dsh-purge/restart` | `client.js:11000`（`RestartAsk`）、`11071`（`restartDsh`，fetch `11091`） |

### 1.2 提示词（`prompt`）

body：`PurgifySection page="prompt"`（`client.js:14035`）

| 区块 | 显示什么 | 可点的动作 | 后端接口 | 源码 |
|---|---|---|---|---|
| 标题 + 操作 | `override.title` + 两个按钮 | 保存注入、恢复默认注入 | `POST /dsh-purge/override`（body `{content}`） | `client.js:12104-12127`（标题与按钮）、`11634`（保存）、`11698`（恢复） |
| 编辑区 | 全屏 textarea（`min-height 220px`），值来自 `GET /dsh-purge/override` | 输入 | `GET /dsh-purge/override` | `client.js:12129`；GET `11489` |
| 空内容告警 | 内容为空时红字「需要提示词」 | 无 | 无 | `client.js:12143-12152` |
| 保存结果提示 | 已保存 / 已保存提交的版本（当前修改未保存）/ 错误 | 无 | 同上 | `client.js:12142` |

### 1.3 规则（`rules`）

body：`RulesSection`（`client.js:12278`）

| 区块 | 显示什么 | 可点的动作 | 后端接口 | 源码 |
|---|---|---|---|---|
| 标题行 | `规则` + 提示 + 「重置」 | 重置（确认后 `reset`） | `POST /dsh-purge/rules {op:"reset"}` | `client.js:12462-12484` |
| 工作区策略 | 下拉：fallback / strict / always | 切换即保存 | `POST /dsh-purge/rules {op:"set-policy"}` | `client.js:12486-12507` |
| 工作区扫描 | 当前 cwd 路径、候选规则文件列表（名称、作用域徽章、大小、完整路径、预览）、复选框 | 重新扫描、勾选/取消单个文件 | `POST /dsh-purge/rules {op:"scan-cwd"}` / `{op:"toggle-cwd"}` | `client.js:12520-12580`；调用 `12529`、`12550` |
| 规则列表 | 每条：别名、`target · 大小`、当前标记 | 点整行打开编辑；「使用」（activate）；「删除」（confirm） | `{op:"read"}` / `{op:"activate"}` / `{op:"delete"}` | `client.js:12387-12456` |
| 新建行 | id 输入、别名输入、target 下拉（AGENTS.md / CLAUDE.md）、创建 | 创建（空内容） | `{op:"save"}` | `client.js:12593-12645` |
| 编辑器 | 别名、target 下拉、正文 textarea、保存 | 保存 | `{op:"save"}` | `client.js:12651-12703` |

`TARGETS = ["AGENTS.md","CLAUDE.md"]`（`client.js:12272`）。

### 1.4 技能（`skills`）

body：`SkillsSection`（`client.js:12720`）。**整个 tab 受版本闸门控制**：`skillUiAllowed(plugin_version)` 为假时组件直接 `return null`（`client.js:12896`），tab 内容区变空白。

| 区块 | 显示什么 | 可点的动作 | 后端接口 | 源码 |
|---|---|---|---|---|
| 标题行 | `技能` + 提示 + notice | 无 | — | `client.js:12966-12976` |
| 说明 | 按 surface 取文案（web / desktop） | 无 | — | `client.js:12978-12985` |
| 技能列表 | 每条：id、描述或「无效」、大小、`/id` 斜杠调用与模型可调用标记 | 点整行打开；「删除」（confirm） | `{op:"status"}` / `{op:"read"}` / `{op:"delete"}` | `client.js:12906-12960` |
| 导入行 | 隐藏 file input ×2 | 「导入压缩包」（.zip/.tgz/.tar.gz/.tar/.skill）、「导入文件夹」（webkitdirectory，过滤 node_modules/.git/__MACOSX/._/.DS_Store） | `{op:"import"}`（base64 `data` 或 `files[]`） | `client.js:12994-13044`；`importZip` `12829`、`importFolder` `12861` |
| 编辑器 | 描述输入、正文 textarea、保存 | 保存 | `{op:"save"}` | `client.js:13050-13090` |

### 1.5 演练台（`drill`）

body：`client.js:14054-14072`。先判授权：

- 已授权 → `__dshPurgeDrill.Panel`（`embedded: true`），并注入演练台自带 CSS；
- 未授权 → 一张卡：「演练台需要先完成一次授权。」+「去授权」按钮 → `setDock({tab:"drill", authOpen:true})` + `requestDrill("auth")`。

授权态来源：`readDrillAuth()`（`client.js:8963`，先看 `drill-grant` 结果，回退 `localStorage["dsh-purge-drill-auth"]`），同步走 `GET/POST /dsh-purge/drill-grant`（`client.js:8986`、`9016`）。

### 1.6 更多（`more`）

body：`RewindSetting` + `PurgifySection page="more"`（`client.js:14049-14052`）

| 区块 | 显示什么 | 可点的动作 | 后端接口 | 源码 |
|---|---|---|---|---|
| 回退按钮设置 | 标题「回退按钮」+ 开关 | 开关（写 tuning，立即生效） | `GET/POST /dsh-purge/boost`（`rewind`） | `client.js:10213`；读写封装 `10193`、`10202` |
| 读取失败 | 错误 + 「重新读取」 | 重试 | 同上 | `client.js:10266-10281` |
| 自有服务器名单 | 标题 + 「保存」+ 4 行 textarea + 说明 | 保存（提示被丢弃条数） | `GET/POST /dsh-purge/own-servers` | `client.js:12162-12200`；GET `11510`、POST `11668` |

---

## 2. 演练台内部视图

### 2.1 顶层 tab（10 个 + 3 个隐藏）

`tabs` 数组在 `client.js:8583-8594`（独立版 `lib/redteam/client.js:4008-4015`）。body 分发在 `client.js:8630-8712`。

| 视图 key | 标题 | 内容 | 动作 | 接口 | 源码 |
|---|---|---|---|---|---|
| `assets` | 资产测绘 | 靶标概览、C 段/网段分组、资产表（端口、指纹、采集溯源、测试记录）、`展开全部`、搜索框、C 段筛选、当前测试（正在跑的扫描与探测） | 搜索、刷新、展开资产详情、切 C 段、看测试记录 | `assets`、`asset`、`domains`、`web`、`discoveryTimeline`、`shotData` | `client.js:1094`；调用 `1130`、`1190`、`1198`、`1211`、`2128`、`910` |
| `env` | 环境适配 | 平台摘要、工具清单（工具名/路径/是否存在）、整包文件夹自动分配 | 刷新、保存、选文件夹、自动分配 | `platformConfigGet`、`platformConfigSave`、`platformAssignToolkit` | `client.js:5853`；`5880`、`5913`、`5942` |
| `agents` | 智能体 | 作战智能体（在跑/剩余/占用未知）、并发规则（硬约束）、并发上限输入、六个角色说明、靶标切换与新建 | 刷新、保存并发上限、切换/新建靶标 | `agentsStatus`、`setAgentsMax`、`bootstrap`、`openEngagement`、`activateEngagement`、`snapshot`、`consoleDigest`、`version`、`updateCheck`、`updateApply` | `client.js:7815`；`7842`、`7951`、`8389-8440`、`8782`、`8064-8101` |
| `sessions` | 会话隧道 | 会话摘要、webshell/隧道分组、连接口令、所在资产、权限、凭据引用、`怎么做（点击展开）` | 刷新、连通性探测、复制 URL、标记失效、更新隧道/webshell | `sessions`、`probeSessions`、`updateTunnel`、`updateWebshell` | `client.js:7323`；`7333`、`7349`、`7385`、`7397` |
| `findings` | 漏洞战果 | 四个子页签：漏洞 / 攻击文件 / 凭据 / 访问会话；按等级/状态筛选、确认与利用标记 | 切子页签、筛选、改状态 | `vulns`、`updateVuln`、`attackFiles`、`credentials`、`access` | `client.js:3111`；`3136`、`3190`、`3170`、`3175`、`3180` |
| `chain` | 攻击链 | 竖向攻击链逐阶段细节、同类第 N 分、结果与证据、本阶段命中/未命中 | 展开阶段 | `scoreChain` | `client.js:3856`；`3867` |
| `scores` | 得分目标 | 得分点列表（已计入/未命中/上限/未指定资产）、新增得分点 | 新增、保存、删除、复制这一条 | `scores`、`saveScorePoint`、`deleteScorePoint` | `client.js:6333`；`6345`、`6393`、`6423` |
| `report` | 报告 | 报告正文、证据截图、复现步骤（点击展开）、请求块（可粘进 Burp Repeater）、下载 | 生成/刷新、复制请求、下载报告 | `scoreReport`、`scoreChain` | `client.js:4405`；`4417`、`4425` |
| `knowledge` | 知识库 | POC/EXP 检索结果、归类、影响版本、来源靶标、来源链接、正文 | 搜索、打开、复制正文、复制来源、记一次复用 | `pocSearch`、`pocGet`、`pocUse` | `client.js:5249`；`5289`、`5324`、`5343` |
| `skills` | 技能库 | 技能目录：来源（本插件自带/红队/官方）、可用性（可用/不可用/未知）、仅人工标记、过滤器 | 刷新、过滤、查看技能正文 | `skillCatalog`、`skillRead` | `client.js:2469`；`2482`、`2511` |

隐藏 tab（在 `tabs` 数组里没有按钮，但 body 分支存在）：

| 视图 key | 标题 | 内容 | 动作 | 接口 | 源码 |
|---|---|---|---|---|---|
| `testing` | （无按钮） | 测试面：内网/外网、开放端口、已确认漏洞、隧道、易打、被封、预期得分 | 展开最近动过与待测队列 | `activeTests` | `client.js:7032`；`7046`；body 分支 `8689` |
| `attackfiles` | （无按钮） | 直接复用 `FindingsTab` | 同 findings | `attackFiles` | body 分支 `8705` |
| `prompts` | （无按钮） | 直接复用 `AgentsTab` | 同 agents | `prompts` 等 | body 分支 `8635` |

`prompts` tab 组件本身（`client.js:2262`）也可独立渲染，但当前没有 tab 按钮指向它。

### 2.2 子页签（subTab）

只有一处：`FindingsTab`（`client.js:3130` `useState("vulns")`）。

| subTab key | 标题 | 内容 | 接口 | 源码 |
|---|---|---|---|---|
| `vulns` | 漏洞（带计数） | 漏洞表 | `vulns`、`updateVuln` | `client.js:3771` |
| `files` | 攻击文件（带计数） | 攻击文件表 | `attackFiles` | `client.js:3772`、`3821` |
| `creds` | 凭据（带计数） | 凭据表 | `credentials` | `client.js:3773`、`3830` |
| `access` | 访问会话（带计数） | 访问会话表 | `access` | `client.js:3774`、`3834` |

### 2.3 演练台外壳形态

三种 shell（`client.js:8710-8725`）：

| 形态 | 触发 | 类名 | 源码 |
|---|---|---|---|
| 全窗口 | `location.hash === "#redteam-full"` | `rt-full` | `client.js:821`、`8710` |
| 内嵌（面板内） | `embedded` prop | `rt-dock rt-embedded` | `client.js:8711` |
| 浮动 dock | 默认 | `rt-dock`，带左右拖拽把手 | `client.js:8716`；把手 `8731`、`8736` |

未读数红点：`consoleDigest` + `localStorage` 已读指针（`client.js:8539`、`8541-8578`）。

---

## 3. HTTP 接口全表

### 3.1 `/redteam/api`（POST only，`lib/redteam/ui.js:1081` 注册）

来源校验：回环地址直接放行；非回环要求 Origin 与 Host 同源（`ui.js:1091-1115`）。分发顺序：`handlePlatformOp` → `handleAgentsOp` → `handleUpdateOp` → `handleSkillOp` → `dispatchAsync`（`ui.js:1118-1150`）。

**A. ui.js 前置处理（12 个 op）**

| action | 作用 | 参数 | 返回 | 实现位置 |
|---|---|---|---|---|
| `platformConfigGet` | 读环境适配摘要 | — | `{ok, …platformSummary}` | `ui.js:288` |
| `platformConfigSave` | 写环境适配配置 | `config` | 摘要 | `ui.js:289-292` |
| `platformAssignToolkit` | 由整包文件夹自动分配工具 | `dir` | 分配结果 | `ui.js:293` |
| `platformEnvAdaptStatus` | 环境是否就绪（发送前门禁用） | — | `{ok, ready, …}` | `ui.js:284` |
| `platformEnvAdaptSkip` | 记「暂不配置」 | `skip` | `{ok, …}` | `ui.js:285-287` |
| `agentsStatus` | 并发占用（在跑/剩余/上限/来源） | — | `{ok, max, used, free, running, …}` | `ui.js:906`、`916-940` |
| `setAgentsMax` | 保存并发上限 | `max` | `{ok, max, source, limit, note}` | `ui.js:910-916` |
| `version` | 插件版本 + 安装形态 + 最新版对比 | — | `{ok, plugin, install, latest, updateAvailable, localAhead, blockers}` | `ui.js:961-988` |
| `updateCheck` | 查 registry 最新版 | — | `{ok, current, latest, updateAvailable, localAhead, install}` | `ui.js:989-1006` |
| `updateApply` | 安装指定版本 | `target`（只接受纯 semver） | `{ok, current, latest, note}` | `ui.js:1007-1022` |
| `skillCatalog` | 技能目录（含可用性判定） | `refresh` | `{ok, items, …}` | `ui.js:715-800` |
| `skillRead` | 读技能正文 | `id` | `{ok, …}` | `ui.js:821` 起 |

`platformConfigGet/Save/AssignToolkit` 在 `store-core.js:782-788` **也有分支**，但被前置拦截，永不执行。

**B. `store-core.js` dispatch（68 个 op，仅此处有）**

| action | 作用 | 参数 | 返回 | 实现位置 |
|---|---|---|---|---|
| `bootstrap` | 靶标列表 + 当前指针 | `engagement?` | `{ok, root, engagements, current}` | `store-core.js:746` |
| `openEngagement` | 新建靶标 | `name`, `scope` | `{ok, engagement}` | `store-core.js:755` |
| `activateEngagement` | 切换当前靶标 | `engagement` | `{ok, current}` | `store-core.js:758` |
| `snapshot` | 单靶标总览 | `engagement` | `{ok, …snapshot}` | `store-core.js:810` |
| `assets` | 资产列表 | `engagement`, 过滤参数 | `{ok, items, total}` | `store-core.js:811` |
| `asset` | 单资产详情 | `id` | `{ok, asset}` | `store-core.js:812` |
| `graph` | 资产关系图 | `engagement` | `{ok, …}` | `store-core.js:813` |
| `attackGraph` | 攻击图 | `engagement` | `{ok, …}` | `store-core.js:814` |
| `stats` | 汇总统计 | `engagement` | `{ok, stats}` | `store-core.js:815` |
| `vulns` | 漏洞列表 + 统计 | `engagement` | `{ok, stats, items}` | `store-core.js:816` |
| `addVuln` | 新增漏洞 | `vuln` | `{ok, …}` | `store-core.js:817` |
| `updateVuln` | 改漏洞状态 | `id`, `patch` | `{ok, …}` | `store-core.js:818` |
| `vulnStats` | 漏洞统计 | `engagement` | `{ok, stats}` | `store-core.js:819` |
| `credentials` | 凭据列表 | `engagement` | `{ok, items}` | `store-core.js:820` |
| `addCredential` | 新增凭据 | `credential` | `{ok, …}` | `store-core.js:821` |
| `access` | 访问会话列表 | `engagement` | `{ok, items}` | `store-core.js:822` |
| `addAccess` | 新增访问会话 | `access` | `{ok, …}` | `store-core.js:823` |
| `sessions` | 会话/隧道/webshell 摘要 | `engagement` | `{ok, …}` | `store-core.js:824` |
| `webshells` | webshell 列表 | `engagement` | `{ok, items}` | `store-core.js:825` |
| `addWebshell` | 新增 webshell | `webshell` | `{ok, …}` | `store-core.js:826` |
| `updateWebshell` | 改 webshell | `id`, `patch` | `{ok, …}` | `store-core.js:827` |
| `tunnels` | 隧道列表 | `engagement` | `{ok, items}` | `store-core.js:828` |
| `shots` | 截图/证据列表 | `engagement` | `{ok, …}` | `store-core.js:829` |
| `shotAdd` | 新增截图 | `shot` | `{ok, …}` | `store-core.js:830` |
| `shotDelete` | 删截图 | `id` | `{ok, …}` | `store-core.js:831` |
| `shotData` | 读截图 base64 | `id` | `{ok, base64, mime}` | `store-core.js:832` |
| `addTunnel` | 新增隧道 | `tunnel` | `{ok, …}` | `store-core.js:833` |
| `updateTunnel` | 改隧道 | `id`, `patch` | `{ok, …}` | `store-core.js:834` |
| `domains` | 域名索引（可按 cidr） | `cidr?` | `{ok, items}` | `store-core.js:835` |
| `web` | Web 资产 | `cidr?` | `{ok, …}` | `store-core.js:836` |
| `httpEvidence` | HTTP 证据列表 | `engagement` | `{ok, items}` | `store-core.js:837` |
| `addHttpEvidence` | 新增 HTTP 证据 | `evidence` | `{ok, …}` | `store-core.js:838` |
| `chain` | 攻击链步骤 | `engagement` | `{ok, items}` | `store-core.js:839` |
| `addChainStep` | 新增链路步骤 | `step` | `{ok, …}` | `store-core.js:840` |
| `report` | 生成报告数据 | `engagement` | `{ok, …}` | `store-core.js:841` |
| `assetTest` | 写资产测试记录 | `test` | `{ok, …}` | `store-core.js:842` |
| `assessAsset` | 资产评估 | `assess` | `{ok, …}` | `store-core.js:843` |
| `scores` | 得分点列表 | `engagement` | `{ok, …}` | `store-core.js:844` |
| `saveScorePoint` | 保存得分点 | `point` | `{ok, …}` | `store-core.js:845` |
| `deleteScorePoint` | 删得分点 | `id` | `{ok, …}` | `store-core.js:846` |
| `addScoreHit` | 记一次命中 | `hit` | `{ok, …}` | `store-core.js:847` |
| `scoreChain` | 攻击链计分 | `engagement` | `{ok, …}` | `store-core.js:848` |
| `scoreReport` | 计分报告 | `engagement` | `{ok, …}` | `store-core.js:849` |
| `activeTests` | 测试记录 | `engagement` | `{ok, …}` | `store-core.js:850` |
| `testStats` | 测试统计 | `engagement` | `{ok, stats}` | `store-core.js:851` |
| `consoleDigest` | 各 tab 未读计数 | `engagement` | `{ok, …digest}` | `store-core.js:853` |
| `stages` | 阶段列表 | `engagement` | `{ok, items}` | `store-core.js:854` |
| `saveStage` | 保存阶段 | `stage` | `{ok, …}` | `store-core.js:855` |
| `reportTargets` | 报告目标清单 | `engagement` | `{ok, …}` | `store-core.js:856` |
| `discoveryTimeline` | 资产发现时间线 | `limit` | `{ok, …}` | `store-core.js:858` |
| `attackFiles` | 攻击文件树 | `engagement` | `{ok, items}` | `store-core.js:859` |
| `addAttackFile` | 新增攻击文件 | `file` | `{ok, …}` | `store-core.js:860` |
| `readAttackFile` | 读攻击文件正文 | `id` | `{ok, …}` | `store-core.js:861` |
| `import` | 导入整包 | `…` | `{ok, …}` | `store-core.js:862` |
| `prompts` | 六角色提示词（无靶标时回内置默认） | `engagement?` | `{ok, roles}` | `store-core.js:792`、`863` |
| `savePrompt` | 保存角色提示词 | `role`, `content` | `{ok, …}` | `store-core.js:864` |
| `resetPrompts` | 恢复默认提示词 | `role?` | `{ok, …}` | `store-core.js:865` |
| `pocSearch` | 知识库检索（POC + nuclei 模板） | `q`/`cve`/`component` | `{ok, items, stats, templates, dbPath}` | `store-core.js:763` |
| `pocList` | POC 全量列表 | — | `{ok, items, stats}` | `store-core.js:772` |
| `templateSearch` | nuclei 模板检索 | `q`, `limit` | `{ok, …}` | `store-core.js:773` |
| `templateStats` | 模板统计 | — | `{ok, stats}` | `store-core.js:774` |
| `pocGet` | 读单条 POC | `id`/`code` | `{ok, …}` | `store-core.js:775` |
| `pocSave` | 新增 POC | `poc` | `{ok, …}` | `store-core.js:776` |
| `pocUpdate` | 改 POC | `id`, `patch` | `{ok, poc}` | `store-core.js:777` |
| `pocDelete` | 删 POC | `id` | `{ok, …}` | `store-core.js:778` |
| `pocUse` | 标记复用 | `id`, `used_on` | `{ok, …}` | `store-core.js:779` |
| `pocStats` | POC 统计 | — | `{ok, stats}` | `store-core.js:780` |
| `probeSessions` | 真实 TCP/HTTP 连通性探测（异步） | `engagement` | `{ok, …}` | `store-core.js:877`（`dispatchAsync`） |

**C. 未知 op 的兜底**：`throw new Error("unknown op: …")` → 400 `{ok:false,error}`（`store-core.js:866`）。

### 3.2 `/dsh-purge/*` 路由（`lib/index.js`）

| 方法 路径 | 作用 | 参数 | 返回 | 实现位置 |
|---|---|---|---|---|
| `GET /dsh-purge/status` | 宿主状态、补丁计数、skills、更新状态、换包状态 | — | `{ok, ready, surface, ai_base, patches_applied/pending/skipped/ready/total/total_all/na, compatibility, skills, channel, update, …}` | `lib/index.js:2034` |
| `GET /dsh-purge/diagnose` | 补丁漂移诊断（anchors / optionalDrift / missing） | — | `{ok, checked, drifted, optionalDrift, missing, chained, …}` | `lib/index.js:2107` |
| `GET /dsh-purge/selfcheck` | 逐层破甲自检 | — | `{ok, layers[], broken, pending}` | `lib/index.js:2140` |
| `GET/POST /dsh-purge/boost` | 破甲强化段开关；同端点兼管 `rewind`、`permissionPatches`、`contextManagement` | GET 无参；POST `{enabled}` / `{rewind}` / `{permissionPatches}` / `{contextManagement}` | `{ok, enabled|rewind|permissionPatches|contextManagement, restart_required, apply_required}` | `lib/index.js:2156` |
| `GET/POST /dsh-purge/probe` | GET 查探针是否在位；POST 生成一次性探针标记 | POST `{}` | GET `{ok, active, nonce}`；POST `{ok, nonce, at, message}` | `lib/index.js:2213` |
| `GET /dsh-purge/audit?limit=N` | 动作审计 | `limit` | `{ok, entries[]}` | `lib/index.js:2234` |
| `GET/POST /dsh-purge/hooks-deny` | hooks 拒绝旁路开关 | POST `{hooksDenyBypass}` | `{ok, hooksDenyBypass}` | `lib/index.js:2247` |
| `GET /dsh-purge/last-user?sessionId=` | 取该会话最后一条用户消息 | `sessionId` | `{ok, text, at}` | `lib/index.js:2278` |
| `GET /dsh-purge/rewind/options` | 回退模式可选项 | — | `{ok, modes[]}` | `lib/index.js:2296` |
| `GET/POST /dsh-purge/rewind` | 执行回退（清掉上次发送内容并回填输入框） | `{sessionId, mode}` | `{ok, sessionId, text, at, cleared}` | `lib/index.js:2314` |
| `GET/POST /dsh-purge/update` | 版本检查 / 应用 / 切通道 / 切版本 | GET 无参；POST `handleUpdateOp` 的 op | 见 §3.3 | `lib/index.js:2354` |
| `POST /dsh-purge/apply` | 写补丁到宿主（含换包/重启编排） | `{content}` | `{ok, complete, manualQuit, restarting, needs_full_quit, defaultContent, override_content, cli_repair}` | `lib/index.js:2381` |
| `POST /dsh-purge/revert` | 回滚宿主补丁 | `{}` | `{ok, …}` | `lib/index.js:2523` |
| `POST /dsh-purge/uninstall` | 卸载插件 | `{}` | `{ok, surface, fullApp, note}` | `lib/index.js:2547` |
| `GET/POST /dsh-purge/drill-grant` | 演练台授权态读写 | POST `{}` | `{ok, granted}` | `lib/index.js:2576` |
| `GET/POST /dsh-purge/override` | 注入提示词读写 | GET 无参；POST `{content}` | `{ok, content, defaultContent}` | `lib/index.js:2593` |
| `GET/POST /dsh-purge/own-servers` | 自有服务器名单读写 | POST `{content}` | `{ok, content, dropped}` | `lib/index.js:2649` |
| `POST /dsh-purge/restart` | 重启 DSH | `{}` | `{ok, restarting, manualQuit, …}` | `lib/index.js:2679` |
| `GET/POST /dsh-purge/skills[/op]` | 技能目录 CRUD（prefix） | 见 §3.4 | 见 §3.4 | `lib/index.js:2945`（handler `2905`） |
| `GET/POST /dsh-purge/skill[/op]` | 同上（旧路径别名） | 同上 | 同上 | `lib/index.js:2948` |
| `GET/POST /dsh-purge/rules[/op]` | 规则集 CRUD（prefix） | 见 §3.4 | 见 §3.4 | `lib/index.js:2961`（handler `2843`） |
| `GET/POST /dsh-purge/community` | 维护：备份 / 回滚 / 检查更新 / 安装 / 偏好 | POST `{op, id, ref, value, keepLast, keepDays, maxTotalBytes}` | `{ok, name, version, profile, backups, backup_usage, update_preferences, update_status, …}` | `lib/index.js:1547` |

op 解析顺序（rules / skills 都是）：`forcedOp` → `body.op` → URL tail → `?op=` → 默认 `status`（`lib/index.js:2853`、`2929`）。

### 3.3 `/dsh-purge/update` 的 POST op（`lib/update.js:1379`）

| op | 作用 | 前端是否用 |
|---|---|---|
| `check` / `status` / `versions` | 查最新版 | 否 |
| `channel` | 切 stable/beta | **是**（`client.js:11407`） |
| `switch` / `rollback` | 切到指定 ref | **是**（`switch`，`client.js:11436`） |
| `auto` | 自动更新 | 否 |
| `plan` / `sites` / `inspect` | 打印计划/源站 | 否 |
| `upstream` | 装 beta 上游 | 否 |
| 默认（无 op / `apply`） | 装当前通道最新 | **是**（`client.js:11382`） |

### 3.4 rules / skills / community 的 op

| 端点 | op | 前端是否用 | 后端位置 |
|---|---|---|---|
| rules | `status` | 是（`client.js:12297`） | `lib/index.js:2762` |
| rules | `scan-cwd` | 是（`12544`） | `lib/index.js:2765` |
| rules | `scan`（别名） | 否 | `lib/index.js:2765` |
| rules | `toggle-cwd` | 是（`12586`） | `lib/index.js:2776` |
| rules | `set-policy` | 是（`12503`） | `lib/index.js:2783` |
| rules | `workspace-policy`（别名） | 否 | `lib/index.js:2783` |
| rules | `read` | 是（`12349`） | `lib/index.js:2791` |
| rules | `save` | 是（`12640`、`12694`） | `lib/index.js:2798` |
| rules | `activate` | 是（`12431`） | `lib/index.js:2815` |
| rules | `delete` | 是（`12445`） | `lib/index.js:2829` |
| rules | `reset` | 是（`12483`） | `lib/index.js:2835` |
| skills | `status` | 是（`12812`） | `lib/index.js:2867` |
| skills | `read` | 是（`12802`） | `lib/index.js:2870` |
| skills | `save` | 是（`13084`） | `lib/index.js:2876` |
| skills | `delete` | 是（`12948`） | `lib/index.js:2883` |
| skills | `import` | 是（`12840`、`12892`） | `lib/index.js:2888` |
| community | `preferences` | 是（`13295`、`13430`） | `lib/index.js:1560` |
| community | `backup` | 是（`13631`，`run("backup")`） | `lib/index.js:1565` |
| community | `rollback` | 是（`run("rollback")`） | `lib/index.js:1566` |
| community | `prune` | **否** | `lib/index.js:1567` |
| community | `check` | 是（`run("check")`） | `lib/index.js:1568` |
| community | `update` | 是（`run("update")`） | `lib/index.js:1569` |

---

## 4. 侧栏与快捷入口

注册全部在 `client.js` 的 `apply(ctx)`（`client.js:15521` 起）。

| slot | id / key | order | 注册的组件 | 内容 | 源码 |
|---|---|---|---|---|---|
| `sidebar.panellist` | `dsh-purge` | 30 | `PurgeGlyphIcon` | 侧栏图标（`label: "Purge"`，用 `sidebar-glyph.png` 做 mask） | `client.js:15552-15564`；图标 `15484` |
| `main` | key `dsh-purge` | — | `PurgePage` | 六 tab 主面板 | `client.js:15565-15575` |
| `plugins.bundle.config` | key `dsh-purge-plus` | — | `DetailSettings` | 插件详情页：`view==="summary"` 时只显示 `Purge · 1.7.20-plus.3`，否则整块 `PurgePage` | `client.js:15576-15586`；`15501` |
| `plugins.row.config` | key `dsh-purge-plus#dsh-purge` | — | `DetailSettings` | 插件行内的配置入口（同上） | `client.js:15587-15597` |
| `shell.overlay` | `dsh-purge-panel-overlays` | 60 | `PanelOverlays` | `WelcomeNotice`（首启免责声明，读 `WELCOME_KEY` ack）+ `EnvAdaptSendGate`（红队发送前环境门禁对话框）+ `AuthGate`（演练台授权弹窗） | `client.js:15541-15551`；`15506` |
| `conversation.input.right` | `dsh-purge-rewind` | 20 | `RewindSafe`（→ `RewindButton`） | 输入框右侧「回退」按钮：POST `/dsh-purge/rewind`，把上次发送内容清掉并回填输入框 | `client.js:14955-14968`；`14828` |

另有两个非 slot 的全局挂载：

| 机制 | 作用 | 源码 |
|---|---|---|
| `installLegacyVisibility()` | 折叠历史 `unrestricted-child-*` 别名（注入 CSS + `data-purge-collapsed-alias`） | `client.js:14193`；调用 `15522` |
| `installRewindUi(host)` | 绑定 rewind host + 注册 `conversation.input.right` + 监听会话切换 | `client.js:14953` |
| `bindPresetMenu` | 预设菜单别名（`ctx.remote.agentPresets.list()`） | `client.js:14092`；调用 `15529` |

---

## 5. 每个动作的真实可用性

### 5.1 `/redteam/api` 双向差集（本次核心产出）

抽取口径见 §0.2，集合如下：

- **前端（`client.js` + `lib/redteam/client.js` 去重后）**：45 个
- **后端（`ui.js` 前置 12 + `store-core.js` 68）**：80 个

**前端有、后端无：0 个。**

```
FE-only = ∅
```

**后端有、前端无：35 个。**

```
addAccess addAttackFile addChainStep addCredential addHttpEvidence addScoreHit
addTunnel addVuln addWebshell assessAsset assetTest attackGraph chain graph
httpEvidence import pocDelete pocList pocSave pocStats pocUpdate report
reportTargets saveStage shotAdd shotDelete shots stages stats templateSearch
templateStats testStats tunnels vulnStats webshells
```

这 35 个不是"忘了接"，而是**智能体工具面**在用：`lib/redteam/tools.js` 里以 `store.<method>()` 直接调用同一批 store 方法（`store.addVuln(` / `store.addCredential(` / `store.stats(` / `store.reportTargets(` 等，各 1–3 处）。也就是说面板只读，写入侧走 `redteam_*` 工具。

### 5.2 逐 tab 动作可用性

| tab | 动作 | 前端调用 | 后端实现 | 结论 |
|---|---|---|---|---|
| 状态 | 应用 | `POST /dsh-purge/apply` | `lib/index.js:2381` | 通 |
| 状态 | 回退 | `POST /dsh-purge/revert` | `lib/index.js:2523` | 通 |
| 状态 | 卸载 | `POST /dsh-purge/uninstall` | `lib/index.js:2547` | 通 |
| 状态 | 刷新 | `GET /dsh-purge/status` | `lib/index.js:2034` | 通 |
| 状态 | 权限组/上下文组开关 | `POST /dsh-purge/boost` | `lib/index.js:2156` | 通（返回 `apply_required`） |
| 状态 | hooks 拒绝旁路 | `GET/POST /dsh-purge/hooks-deny` | `lib/index.js:2247` | 通 |
| 状态 | 重测自检 | `GET /dsh-purge/selfcheck` | `lib/index.js:2140` | 通 |
| 状态 | 探针 | `POST /dsh-purge/probe` | `lib/index.js:2213` | 通 |
| 状态 | 强化段开关 | `POST /dsh-purge/boost {enabled}` | `lib/index.js:2200` 段 | 通 |
| 状态 | 检查更新 | `POST /dsh-purge/community {op:"check"}` | `lib/index.js:1568` | 通 |
| 状态 | 最近动作 | `GET /dsh-purge/audit?limit=10` | `lib/index.js:2234` | 通 |
| 状态 | 立即备份 | `POST … {op:"backup"}` | `lib/index.js:1565` | 通 |
| 状态 | 回滚插件 | `POST … {op:"rollback"}` | `lib/index.js:1566` | 通 |
| 状态 | 安装所选版本 | `POST … {op:"update"}` | `lib/index.js:1569` | 通 |
| 状态 | 保存更新偏好 | `POST … {op:"preferences"}` | `lib/index.js:1560` | 通 |
| 状态 | 重启 | `POST /dsh-purge/restart` | `lib/index.js:2679` | 通 |
| 提示词 | 保存注入 | `POST /dsh-purge/override` | `lib/index.js:2593` | 通 |
| 提示词 | 恢复默认 | `POST /dsh-purge/override` | 同上 | 通 |
| 规则 | 9 个动作 | `POST /dsh-purge/rules {op}` | `lib/index.js:2762-2841` | 通 |
| 技能 | 5 个动作 | `POST /dsh-purge/skills {op}`（404/405 时回退 `/skill`） | `lib/index.js:2867-2901` | 通 |
| 演练台 | 授权 | `GET/POST /dsh-purge/drill-grant` | `lib/index.js:2576` | 通 |
| 更多 | 回退按钮开关 | `POST /dsh-purge/boost {rewind}` | `lib/index.js:2176` | 通 |
| 更多 | 自有服务器保存 | `POST /dsh-purge/own-servers` | `lib/index.js:2649` | 通 |
| 输入框 | 回退 | `POST /dsh-purge/rewind` | `lib/index.js:2314` | 通 |
| 演练台·资产 | 5 个 op | `/redteam/api` | `store-core.js:811-836`、`858` | 通 |
| 演练台·环境 | 3 个 op | `/redteam/api` | `ui.js:288-293` | 通 |
| 演练台·智能体 | 10 个 op | `/redteam/api` | `ui.js:906-1022`、`store-core.js:746-758` | 通 |
| 演练台·会话 | 4 个 op | `/redteam/api` | `store-core.js:824`、`877`、`833-834` | 通 |
| 演练台·战果 | 5 个 op | `/redteam/api` | `store-core.js:816-823`、`859` | 通 |
| 演练台·攻击链 | `scoreChain` | `/redteam/api` | `store-core.js:848` | 通 |
| 演练台·得分 | 3 个 op | `/redteam/api` | `store-core.js:844-846` | 通 |
| 演练台·报告 | 2 个 op | `/redteam/api` | `store-core.js:848-849` | 通 |
| 演练台·知识库 | 3 个 op | `/redteam/api` | `store-core.js:763-779` | 通 |
| 演练台·技能库 | 2 个 op | `/redteam/api` | `ui.js:715-821` | 通 |

**结论：面板发出的每一个 action 名都能在后端找到实现分支，命名 100% 对齐。**

### 5.3 端点级差集

| 端点 | 前端 op 数 | 后端 op 数 | 前端有后端无 | 后端有前端无 |
|---|---|---|---|---|
| `/redteam/api` | 45 | 80 | 0 | 35（见 5.1） |
| `/dsh-purge/rules` | 9 | 11 | 0 | `scan`、`workspace-policy`（别名） |
| `/dsh-purge/skills` | 5 | 5 | 0 | 0 |
| `/dsh-purge/community`（POST） | 5 | 6 | 0 | `prune` |
| `/dsh-purge/update`（POST） | 3 | 12 | 0 | `check`、`status`、`versions`、`rollback`、`auto`、`plan`、`sites`、`inspect`、`upstream` |
| `/dsh-purge/*` 路由 | 20 | 22 | 0 | `GET /dsh-purge/diagnose`、`GET /dsh-purge/rewind/options` |

### 5.4 契约细节核对

| 项 | 前端 | 后端 | 是否一致 |
|---|---|---|---|
| `apply` 只收 POST | POST（`client.js:11539`） | `request.method !== "POST"` → 405（`lib/index.js:2384`） | 一致 |
| `restart` 只收 POST | POST（`client.js:11091`） | 405 否则（`lib/index.js:2681`） | 一致 |
| `status` 只收 GET | GET | 405 否则（`lib/index.js:2036`） | 一致 |
| `selfcheck` / `audit` / `last-user` 只收 GET | GET | 同 | 一致 |
| `boost` 一端点四语义 | `enabled` / `rewind` / `permissionPatches` / `contextManagement` | 分支顺序 rewind → 组开关 → enabled（`lib/index.js:2176-2205`） | 一致 |
| `skills` 路径回退 | 先 `/dsh-purge/skills`，404/405 再 `/dsh-purge/skill`（`client.js:265-268`） | 两条 prefix 都注册（`lib/index.js:2945`、`2948`） | 一致 |
| `pocUse` 的 `used_on` | 固定文案「控制台手动标记」（`client.js:5343`） | 透传 `req.used_on`（`store-core.js:779`） | 一致 |
| 无靶标时的写操作 | 部分 tab 不判断 | 返回 `请先在顶部选择或创建一个靶标`（`store-core.js:806`） | 一致（前端按 `ok:false` 展示） |
| `updateApply` 的 target 校验 | 只在 UI 层传版本号 | 后端强制 `/^v?\d+\.\d+\.\d+/`（`ui.js:1006`） | 一致 |

---

## 6. 死按钮 / 断链

### 6.1 前端有 UI、后端无实现

**0 个。** 45 个 `/redteam/api` op、9 个 rules op、5 个 skills op、5 个 community op、3 个 update op、20 条 `/dsh-purge/*` 路由调用，全部命中后端分支。

### 6.2 后端有实现、前端无入口

| 类别 | 条目 | 后端位置 | 说明 |
|---|---|---|---|
| `/redteam/api` op | 35 个（见 §5.1） | `store-core.js:817-861` 等 | 由 `lib/redteam/tools.js` 的智能体工具调用，面板不提供按钮 |
| rules 别名 | `scan`、`workspace-policy` | `lib/index.js:2765`、`2783` | 与 `scan-cwd`、`set-policy` 同分支，前端只用后者 |
| community | `prune` | `lib/index.js:1567` | 清理旧备份；面板只有「立即备份 / 回滚」，没有「清理」按钮 |
| update | 9 个 op（`check`/`status`/`versions`/`rollback`/`auto`/`plan`/`sites`/`inspect`/`upstream`） | `lib/update.js:1382-1396` | 面板只发 `apply` / `channel` / `switch` |
| 路由 | `GET /dsh-purge/diagnose` | `lib/index.js:2107` | 前端零调用（漂移诊断只能手动 curl） |
| 路由 | `GET /dsh-purge/rewind/options` | `lib/index.js:2296` | 前端零调用，回退模式由前端硬编码 |
| store 分支 | `platformConfigGet` / `platformConfigSave` / `platformAssignToolkit` | `store-core.js:782-788` | 被 `ui.js:275-294` 前置拦截，**永不执行**（三份死分支） |

### 6.3 有界面但点了没效果

| 项 | 现象 | 源码 |
|---|---|---|
| Beta 通道「暂无 beta」按钮 | 无 beta 版本时 `actionClick` 被赋成空函数，同时 `disabled`（点不到，点了也没事） | `client.js:11852-11855` |
| 授权弹窗「不同意」 | `setDock({tab:"clean"})` —— `clean` 不在 `TABS` 里，也不在任何 `st.tab ===` 分支里，是个无效状态值；弹窗本身会关，页面停在原 tab | `client.js:10121`；`TABS` 见 `13805` |
| dock 初始态 | `tab: "clean"` 作为默认值存在，但 `PurgePage` 用自己的 `useState("status")`，dock 的 `tab` 只被「去授权」按钮写过一次 | `client.js:9046`、`14071` |

### 6.4 有界面但被闸门挡住

| 项 | 闸门 | 结果 | 源码 |
|---|---|---|---|
| 技能 tab 整块 | `skillUiAllowed(plugin_version)`：`1.1.11*` 或 `<1.1.12` 为假 | 组件 `return null`，tab 空白（无空态文案） | `client.js:12707`、`12896` |
| 演练台 | `readDrillAuth()` 为假 | 显示「需要先完成一次授权」+ 去授权按钮 | `client.js:14057-14071` |
| 演练台首步 | 环境适配未就绪时 `agent/pre-step` 直接 reject | 发送被拦，提示「环境未适配」 | `ui.js:1031-1057` |
| 面板自身 | `/dsh-purge/status` 读失败 | `VersionNotice` 显示「状态读取失败」，其余区块按 `state=null` 降级 | `client.js:13934`、`13959` |

### 6.5 计数汇总

| 指标 | 数量 |
|---|---|
| 顶层 tab | 6 |
| 演练台 tab（有按钮） | 10 |
| 演练台隐藏 tab（有 body 无按钮） | 3 |
| 演练台 subTab | 4 |
| `/redteam/api` 后端 op | 80 |
| `/redteam/api` 前端 op | 45 |
| `/dsh-purge/*` 路由 | 22 |
| 真·死按钮（前端调用无后端） | **0** |
| 后端孤儿 op（无前端入口） | 35（`/redteam/api`）+ 2（rules 别名）+ 1（community `prune`）+ 9（update）= **47** |
| 后端孤儿路由 | **2**（`diagnose`、`rewind/options`） |
| 永不执行的后端分支 | **3**（`store-core.js:782-788`） |
| 无效状态值 | **1**（`tab: "clean"`） |
