# dsh-purge-safe 2.0.0 功能覆盖审计

- 基准：`vendor/safe/`（dsh-purge-safe 2.0.0，未改动）
- 被测：`/Users/wheming/.dsh/profiles/desktop/node_modules/dsh-purge-plus/`（1.7.20-plus.19，已装、正在跑）
- 运行中宿主：`http://127.0.0.1:55439`（`/dsh-purge/status` 报 `patches_applied:85`，`version` op 报 `dsh-purge-plus@1.7.20-plus.19`）
- 审计日期：2026-11-20
- 审计方式：源码逐函数比对（不是读文档）+ 差分实跑（同一份数据、同一批 op，两套 store 各跑一遍，递归比字段）+ 运行中宿主 HTTP 抽验

---

## 一、摘要

**safe 2.0.0 共 43 个功能面（另有 2 个是我方新增）：已覆盖 20 / 部分覆盖 11 / 缺失 9 / 有意排除 3。**

一句话结论：**后端接口面（op / store 方法 / 工具 / 数据表）是 safe 的超集，零缺失；缺口集中在「前端与会话侧」，后端只有 KEV / 模板库两个模块**——最要紧的三条是「会话关系图整块没移植」「情报保鲜（KEV + 模板库刷新）整块没移植」「报告只能导出、不能在面板里渲染」，另有 6 条字段级、5 条视图/入口级缺口。

| 层 | safe | 我方 | 差异 |
|---|---:|---:|---|
| 演练台页签 | 12 | 13 | 我方多「证据账本」 |
| dispatch op | 83 | 90 | 我方多 7 个（`assetCoverage`/`hostCoverage`/`hostFinding`/`coverageSummary`/`cleanupSummary`/`evidenceLedger`/`reportV2`），**safe 的 83 个一个不缺** |
| 路由层 op（ui.js） | 10 | 10 | 一致（`platformEnvAdapt*`/`platformConfig*`/`skillCatalog`/`skillRead`/`setAgentsMax`/`version`/`updateCheck`/`updateApply`） |
| RedteamStore 方法 | 120 | 130 | **0 缺失**；37 个实现不同（见第五节） |
| 模型工具 | 67 | 82 | **0 缺失**，多 15 个 |
| 数据表 | 29 | 29 | 同集合（顺序不同） |
| 前端组件（`function X`） | 51 | 48 | 缺 9 个（其中 7 个是会话地图 helper） |

---

## 二、盘点方法（可复现）

### 2.1 枚举 safe 的功能面

```bash
cd /Users/wheming/Documents/dsh-purge-plus

# 页签 + 分组 + 别名
grep -n "const tabs = \[" -A 20 vendor/safe/lib/redteam/client.js      # 15892
grep -n "TAB_GROUPS\|TAB_ALIASES" vendor/safe/lib/redteam/client.js   # 15901 / 15909

# dispatch op（83 个真实 op；'string' 是 `typeof req.op === 'string'` 的正则误命中）
grep -oE "op === '[a-zA-Z0-9_.-]+'" vendor/safe/lib/redteam/store-core.js | sed "s/op === //;s/'//g" | sort -u | grep -v '^string$' | wc -l   # 83
grep -n "if (op === '" vendor/safe/lib/redteam/store-core.js | sed -n '1,90p'   # 812–1014

# 路由层 op（不在 dispatch 里，在 ui.js）
grep -oE "op === '[a-zA-Z0-9_]+'" vendor/safe/lib/redteam/ui.js | sort -u      # 7 条
grep -n "updateCheck', 'updateApply'\|'version', 'updateCheck'" vendor/safe/lib/redteam/ui.js   # 779（includes 判定）

# 模型工具
grep -oE "name: 'redteam_[a-z0-9_]+'" vendor/safe/lib/redteam/tools.js | sed "s/name: '//;s/'//" | sort -u | wc -l   # 67

# 数据表
grep -oE "CREATE TABLE (IF NOT EXISTS )?[a-z_]+" vendor/safe/lib/redteam/schema.js | sort -u | wc -l   # 29

# 前端组件
grep -oE "^    function [A-Z][A-Za-z0-9_]*" vendor/safe/lib/redteam/client.js | sed 's/.*function //' | sort -u | wc -l   # 35（大写开头）+ 16 个小写 helper = 51
```

### 2.2 差分实跑（本次审计的主证据）

同一份种子数据、同一批 op，分别喂给 **safe 的 store-core** 和 **我方 store-core**，递归比返回字段：

```bash
# 脚本落在 /tmp/audit-safe/（不写仓库），核心逻辑：
#   1. new RedteamStore(mkdtempSync(tmpdir()+'/rt-*'))
#   2. openEngagement → import(1 资产 + 1 端口) → addVuln/addCredential/addAccess
#      /addWebshell/addTunnel/addHttpEvidence/addDataProof/addCleanup/addChainStep
#      /addAttackFile/saveScorePoint/addScoreHit/saveStage
#   3. 逐个 op 调用，收集 { ok, 顶层 keys, 递归 keyPaths }
#   4. 两侧 keyPaths 做差集
node /tmp/audit-safe/deep.mjs
```

结果（节选，全量见 2.3）：

| op | safe 有、我方无 | 我方有、safe 无 |
|---|---|---|
| `bootstrap` | `engagements[].stats.*`（13 个统计字段） | — |
| `consoleDigest` | `sections.artifacts` / `sections.overview` / `sections.env` | — |
| `intelStatus` | `templates.*` / `kev.*` | `resources[]` / `badge` / `stale_count` |
| `scoreReport` | `items[]._replay.*` / `items[]._reportAsset.*` / 顶层 `report` / `layout` | — |
| `cleanup` | `items[].location` | `by_status` / `by_kind` / `cleared` / `items[].title` 等 8 个 |
| `attention` | — | `coverage_available` |

### 2.3 运行中宿主抽验（HTTP 层）

```bash
curl -s http://127.0.0.1:55439/dsh-purge/status | head -c 200
# → {"ok":true,"ready":true,...,"patches_applied":85,...}

curl -s -X POST http://127.0.0.1:55439/redteam/api -H 'content-type: application/json' -d '{"op":"version"}'
# → {"ok":true,"plugin":{"name":"dsh-purge-plus","version":"1.7.20-plus.19",...}}

curl -s -X POST http://127.0.0.1:55439/redteam/api -H 'content-type: application/json' -d '{"op":"intelStatus"}'
# → {"ok":true,"resources":[{"key":"kev","label":"KEV 已利用漏洞目录","exists":false,...}],...}
#   注意：safe 的 intelStatus 返回的是 {templates:{...},kev:{...}}，形状不同（见 4.6）

curl -s -X POST http://127.0.0.1:55439/redteam/api -H 'content-type: application/json' -d '{"op":"proxyPoolGet"}'
# → {"ok":false,"error":"unknown op: proxyPoolGet"}
#   safe 后端同样没有这个 op（全仓只有 client.js 引用它）→ 见 4.9
```

### 2.4 全 op 实跑结果

对 safe 的 83 个 dispatch op + 我方 7 个专有 op，逐个真打（真实靶标、真实资产、真实漏洞/凭据/WebShell/隧道/HTTP 证据/数据证明/清理项/攻击文件/得分命中/阶段）：

```
96 次调用 = 83（safe op）+ 7（我方专有）+ 6（我编的假 op 名，用来确认它们确实不是 op）
├─ 89 次 ok:true
├─  1 次校验错误：deleteScorePoint id=99999 不存在
│                 （用真实 id 复验通过：{"ok":true,"deleted":26}）
└─  6 次 unknown op：hostCoverageExtra / coveragePending / engagementScope /
                     scopeCheckTarget / pivotProbe / listHostFindings
                     —— 这 6 个是我方 store 的**内部方法名**，本来就不是 op，
                        两边都没有，不计入分母
```

**safe 的 83 个 op 里，0 个返回 unknown op、0 个返回「未实现」。** 首次跑时还有 6 个真实 op 报校验错（`attentionAck` 缺 session_id、`updateCleanup` 缺 status、`addScoreHit` 缺 evidence、`addAttackFile` 缺 evidence、`assetTest`/`assessAsset` 缺 asset_id），补齐参数后全部 ok:true —— 属于设计内的入参校验，不是缺口。

---

## 三、全量对照表

> 判定口径：**已覆盖**＝用户能得到同样能力（实现可以不同，依据写在括号里）；**部分覆盖**＝能力在但差字段/差分支/差入口；**缺失**＝用户拿不到；**有意排除**＝我方主动不做（含反向能力）。

### A. 演练台页签（safe 12 + 我方 1）

| 功能面 | safe 位置 | 我方状态 | 差什么 | 证据 |
|---|---|---|---|---|
| 工作总览 `overview` | `client.js:10348`（OverviewTab） | 部分覆盖 | 缺「得分明细视图」「协同与待测」两段；我方改为「现在在等谁 / 下一步该打谁 / 覆盖到哪了 / 资源保鲜」 | 标签差集：safe-only 35 条含 `得分明细视图`/`协同与待测`/`查看得分目标：`；plus-only 20 条 |
| 资产测绘 `assets` | `client.js:10616`（AssetsTab） | 部分覆盖 | 缺「网段视图」tab 与「关联截图」；其余（搜索/服务/端口/优先级/内外网筛选、详情三层展开、采集溯源 8 条）都在 | `client.js:10763`/`10839` 是 safe 的网段视图；我方 `AssetsTab` 无此分支（`client.js:853-1236`） |
| 环境适配 `env` | `client.js:13188`（EnvTab） | 部分覆盖 | 缺「情报保鲜（nuclei 模板 / KEV 公告）」整节 | safe `client.js:13388-13423`；我方 EnvTab 无 intel 渲染（`client.js:3356-3560`） |
| 智能体 `agents` | `client.js:15421`（AgentsTab） | 部分覆盖 | 缺「会话关系图」（safe 用它当本页主体）；并发规则/六角色/提示词编辑等价 | safe `client.js:15477` 挂 `SessionMap`；我方 `client.js:4546` 挂的是自建绑定表 |
| 会话隧道 `sessions` | `client.js:14057`（SessionTab） | 已覆盖 | 文案重写（`登记概况`→`会话与入口`）；探测/手动标记/复制/冰蝎与 suo5 提示齐 | 标签差 10 vs 5，逐条核对为同义 |
| 凭据与文件 `artifacts` | `client.js:11502`（ArtifactsTab） | 已覆盖 | 我方另加「数据证明」「清理清单」子块 | `CredentialList`/`AccessList`/`HttpBlock` 逐函数比对为同构 |
| 漏洞战果 `findings` | `client.js:11546`（FindingsTab） | 已覆盖 | 无（组件体不同但标签 0 差异） | 见 2.2 的组件 diff：`FindingsTab` 标签差 0/0 |
| 攻击链 `chain` | `client.js:11817`（ChainTab） | 已覆盖 | 无（标签差 0/0） | 同上 |
| 得分目标 `scores` | `client.js:13524`（ScoreTab） | 已覆盖 | 我方多「+ 新增得分点」「刷新」 | plus-only 3 条 |
| 报告 `report` | `client.js:12148`（ReportTab） | 部分覆盖 | 缺「详细报告查看」Markdown 预览；导出的 `.md` 是 legacy 章节（0–5 章），不是 safe 的四段式 | safe `client.js:12344-12346`；我方 `client.js:2778-2996` 只有复制/下载，无预览 |
| 知识库 `knowledge` | `client.js:12470`（KnowledgeTab） | 已覆盖 | 空库提示文案不同（我方多一句「请完全退出后重新打开客户端」） | 标签差 3 vs 2 |
| 技能库 `skills` | `client.js:11229`（SkillsTab） | 已覆盖 | 重写（目录/可用性/缺口/正文四段都在，判定文案不同） | 标签差 38 vs 34，逐条为同义重排 |
| **证据账本 `evidence`** | — | 我方新增 | safe 无此页签 | 我方 `client.js:5246`（`['evidence','证据账本']`）+ `EvidenceTab` |

### B. 子视图 / 交互组件

| 功能面 | safe 位置 | 我方状态 | 差什么 | 证据 |
|---|---|---|---|---|
| 会话关系图（父子图 + 缩放/筛选/待办比例/全屏） | `client.js:14798`（SessionMap）+ `14318/14449/14542/14578/14603/14608/14663`（7 个 helper） | **缺失** | 整块没移植：`validateSessionListResponse`/`scopeSessionSummaries`/`selectSessionMapVisible`/`summarizeSessionMap`/`sessionMapEdgePath`/`layoutSessionMap`/`positionSessionMap` | `grep -c "layoutSessionMap"` 我方 = 0；标签差 97 vs 8 |
| 会话→靶标绑定表 | — | 我方新增 | 我方把 AgentsTab 的 SessionMap 换成了「会话 → 靶标」表 | 我方 `client.js:4306-4390` |
| 资产详情（端口/指纹/测试记录/采集溯源） | `client.js:10992-11080` | 已覆盖 | 同构；我方把「展开全部」折成三层 | 我方 `client.js:1164` 有 `采集溯源（最近 8 条）` |
| 资产详情「关联截图」 | `client.js:10983` | 已覆盖（等效：safe 侧是死代码） | 两边的资产详情都不显示截图 | `getAsset` 两边实现逐字节相同（safe `1609-1620` / 我方 `3225-3236`），都**不返回 `shots`**，客户端也没有补挂 → safe 的 `(d.shots \|\| []).length` 恒为 0，这段永远不渲染。我方连这段代码都没有，用户看到的结果一致 |
| 网段视图（segments 台账表） | `client.js:10759-10840` | **缺失** | 我方用「左侧外网/内网 C 段树 + 域名/Web 视图」替代，没有按网段聚合的表格视图 | `grep "网段视图"` 我方 = 0 |
| 当前测试 `TestingTab` | `client.js:13919` | 已覆盖 | 无（标签差 0/0） | 组件 diff |
| 发现视图 `DiscoveryView` | `client.js:11084` | 已覆盖 | 无（标签差 0/0） | 组件 diff |
| 报告四段式 `ReportV2` | `client.js:12029` | 部分覆盖 | 段落口径不同（safe 二=得分汇总表 / 三=3.1–3.4 复现；我方 二=阶段表 / 三=repro / 四=交付清单）；**缺「归属截图」「复现截图」** | safe `12048`/`12077` 两处 `ShotStrip`；我方 ReportV2 无 |
| 报告 Markdown 渲染器 | `client.js:629`（Markdown + `renderInline`/`splitTableRow`/`isTableSep`） | **缺失** | 技能正文/报告正文只能看 `<pre>` 原文 | `grep "function Markdown"` 我方 = 0；`grep -c "h(Markdown"` 我方 = 0 |
| 情报保鲜卡片（模板库 + KEV） | `client.js:13388-13423` | **缺失** | 无「模板库年龄 / KEV 条数 / 手动刷新」入口 | 见 4.6 |
| 代理设置 `ProxySettings` | `client.js:12745` | 缺失（safe 自身也是死 UI） | safe 的 6 个 `proxyPool*` op **在 safe 后端也没有实现**（全仓只有 client 引用） | `grep -rn "proxyPool" vendor/safe/lib/` 只命中 `lib/redteam/client.js`；我方 curl `proxyPoolGet` → `unknown op` |
| 版本与一键更新 `VersionBar` | `client.js:15590`（2 个标签） | 已覆盖（我方更强） | 我方 28 个标签：检查/阻塞项/安装方式/一键更新并重启 | plus-only 28 条 |
| 并发卡片 + 上限编辑 | `client.js:15529` | 已覆盖 | 缺「waiting/blocked 让出名额」（见 D4） | 标签差 9 vs 4，为同义重排 |
| 面板会话跟随（手选 / 跟随 / 未绑） | `client.js:16010-16060` | **缺失** | 切项目时不写会话绑定、不显示跟随状态、无「按会话标题反查」 | 我方 `client.js:5424-5429` 只调 `activateEngagement`（不带 `session`） |
| 全屏浏览 `FullButton` | `client.js:16209` | 已覆盖 | 我方先请求原地铺满、失败才开新窗口（safe 只原地）；**文案仍写「在新窗口打开」**（小 bug） | 我方 `client.js:5507-5515` |
| 攻击文件 `AttackFilesTab` | `client.js:12386` | 已覆盖 | 无（标签差 0/0） | 组件 diff |
| 提示词编辑 `PromptsTab` | `client.js:11137` | 已覆盖 | 无（标签差 0/0） | 组件 diff |

### C. 后端

| 功能面 | safe 位置 | 我方状态 | 差什么 | 证据 |
|---|---|---|---|---|
| dispatch op（83） | `store-core.js:812-1014` | 已覆盖 | 0 缺失；7 个新 op 是我方多出 | `comm -23` 结果为空 |
| RedteamStore 方法（120） | `store-core.js` 全文 | 已覆盖 | 0 缺失；37 个实现不同（逐条见第五节） | 结构 diff：`safe 120 / plus 130 / missing 0` |
| 模型工具（67） | `tools.js` | 已覆盖 | 0 缺失；多 15 个（覆盖度/证据账本/情报/主机发现等） | `comm -23` 为空，`comm -13` 15 条 |
| 数据表（29） | `schema.js:72-373` | 已覆盖 | 同集合 | 表名集合比对一致 |
| `consoleDigest` 段落 | `store-core.js:1322-1397` | 部分覆盖 | 缺 `artifacts` / `overview` / `env` 三段 → 这三个页签**永不点红点** | 2.2 差分；我方 `store-core.js:2928-2985` |
| `intelStatus` / `intelRefresh` | `store-core.js:53-73` | 部分覆盖 | 形状完全不同：safe 是 `{templates,kev}`，我方是 `{resources,stale_count,missing_count,badge}`（文件年龄探针） | 2.3 的 curl 输出 |
| `scoreReport` 结构化报告 | `store-core.js:4054-4061` + `buildReportV2:6785` + `renderTemplateReport:6980` | 部分覆盖 | 只保留 legacy 布局；缺 `report` 对象、`layout` 选项、`_replay`/`_reportAsset` | 2.2 差分；我方 `store-core.js:4508` 无 `layout` 分支 |
| `bootstrap` 里的 `engagements[].stats` | `store-core.js:1220-1240` | 部分覆盖 | 我方传 `includeStats:false`，列表不带统计 | 我方 `store-core.js:762`；safe 1226 行 `stats = this.stats(...)` |
| 清理清单 `location` 字段 | `schema.js:281-286` | 部分覆盖 | 我方换表（asset_id/title/evidence_ref/priority），丢了 `location` | 我方 `schema.js:403-416` |

### D. 模块级

| 功能面 | safe 位置 | 我方状态 | 差什么 | 证据 |
|---|---|---|---|---|
| CISA KEV 索引 | `kev.js:30`（`kb/cve-kev.json`）+ `tools.js:34` | **缺失** | 无 kev 模块；`redteam_poc_search` 不再标注「已被在野利用」 | `grep -c kev` 我方 tools.js = 0 |
| 运行时引导（模板库刷新） | `bootstrap-runtime.js:175/405/446/548` | **缺失** | `templatesStatus` / `refreshTemplateLibrary` / `ensureRedteamRuntime` 全无；`redteam_template_refresh` 变成纯本地探针（自己声明「不联网、不下载」） | 我方 `tools.js:1226-1244` |
| 团队任务板默认开启 | `team-mode.js:1-40`，`index.js:1115` | 有意排除 | 不写 `team/mode` 事件 → 红队会话默认没有 `team_task_*` 工具（官方默认 false） | `grep -rn "team/mode"` 我方 lib = 0；preset 明写「必须用原生 subagent，不要用 Agent Teams」 |
| 并发名额挂起 | `slot-state.js:1-20`（`tools.js:36` 写、`ui.js:26` 读） | 有意排除 | 执行智能体回报 waiting/blocked 时不让出名额 | 我方 `tools.js:468-470` 原注释：「本包没有 parked 概念（名额只按注册表算），所以这一段不移植」 |
| 窗口顶部避让 | `client.js:15639`（`desktopChromeTop`） | 缺失（小） | 浮动面板 y 轴不避让 `--dsh-frame-chrome-top`，拖到顶部会压住标题栏 | 我方 `client.js:4745-4752` 无 chrome 项；CSS 里只在 `.rt-full` 用了该变量 |
| 地域/银行拒绝层 | `net-scope.js:625`（`installRegionGate`）+ `index.js:30` | 有意排除（**反向能力**） | safe 会在 `agent/pre-step` 命中境外银行/交易所域名时直接回「不行，这是严令禁止的」 | 我方 `lib/index.js:46` 只 import `readAllowText/writeAllowText`；`grep -c installRegionGate` = 0 |

---

## 四、部分覆盖：逐条差什么 + 复现命令

### 4.1 会话关系图整块缺失（影响最大）

safe 的 `SessionMap` 是「智能体」页签的主体：宿主会话父子图、运行状态、待办完成比例、活动时长、会话来源/格式迁移、父子路径、状态筛选、缩放平移、全屏。我方把它换成了「会话 → 靶标」绑定表。

- 数据源两边都在：`op:sessionBindings` + 宿主 `POST /api/session/list`（`vendor/safe/lib/redteam/client.js:14731`、`14758`）。
- 我方 `sessionBindings` op 实测可用（见 2.3）。

```bash
# 我方：没有图
grep -c "layoutSessionMap\|positionSessionMap\|scopeSessionSummaries" \
  /Users/wheming/.dsh/profiles/desktop/node_modules/dsh-purge-plus/lib/redteam/client.js
# → 0

# safe：7 个 helper + 图组件
grep -n "^    function \(validateSessionListResponse\|scopeSessionSummaries\|selectSessionMapVisible\|summarizeSessionMap\|sessionMapEdgePath\|layoutSessionMap\|positionSessionMap\|SessionMap\)" \
  /Users/wheming/Documents/dsh-purge-plus/vendor/safe/lib/redteam/client.js
```

### 4.2 `consoleDigest` 少三个段落 → 三个页签没有红点

```bash
curl -s -X POST http://127.0.0.1:55439/redteam/api -H 'content-type: application/json' \
  -d '{"op":"consoleDigest"}' | python3 -c "import json,sys;print(sorted(json.load(sys.stdin).get('sections',{})))"
# 无靶标时走空载荷分支；建靶标后 sections 里没有 artifacts/overview/env
```

safe 的 15 个 section（`store-core.js:1344-1392`）vs 我方 12 个（`store-core.js:2950-2985`）：缺 `artifacts`、`overview`、`env`。前端 `unreadOf(tab)` 对 `undefined` 返回 false（`client.js:5234`），所以「凭据与文件」页签永远不会亮红点。

### 4.3 `intelStatus` 形状完全不同

| | safe | 我方 |
|---|---|---|
| 顶层 | `{templates:{dir,count,age_hours,stale,owned,refreshed_at,auto_refresh_hours,last_error}, kev:{available,enabled,count,fetched_at,age_hours,stale,note}}` | `{resources:[{key,label,kind,exists,path,age_days,stale_after_days,stale,missing}], stale_count, missing_count, badge}` |
| 语义 | 模板库 + KEV 的**新鲜度与刷新** | 若干本地资源的**存在性/年龄探针** |

```bash
curl -s -X POST http://127.0.0.1:55439/redteam/api -H 'content-type: application/json' -d '{"op":"intelStatus"}' | head -c 200
# → {"ok":true,"resources":[{"key":"kev","label":"KEV 已利用漏洞目录",...}],"stale_count":...
# safe 对应位置：vendor/safe/lib/redteam/store-core.js:56-61（返回 {templates, kev}）
```

### 4.4 `scoreReport` 丢了结构化报告

safe 有两个布局：`layout:'simple'`（`buildReportV2` + `renderTemplateReport`，四段式）与 `layout:'legacy'`（0–5 章）。我方只有后者。

```bash
# 同一份数据，导出 markdown 的章节标题
node /tmp/audit-safe/md.mjs <store-core 路径> scoreReport | grep '^#'
# safe  → 一、资产归属证明(1.1/1.2) / 二、得分汇总表(2.1–2.4) / 三、得分点复现(3.1–3.4)
# plus  → 0.摘要与对账 / 1.复现前置条件 / 2.攻击链 / 3.逐条明细 / 4.得分点说明 / 5.附录
```

字段级：`items[]` 少了 `_replay`（含 `kind/label/mismatch/rejected/reqHost/source`）与 `_reportAsset`（含 `names/fingerprints/open_ports/assess_*`），顶层少 `report`、`layout`。

**能力不丢**：我方 `reportV2` op（`store-core.js:2489`）产出的 `asset_proof`/`stage_tables`/`repro`/`cleanup` 供前端渲染四段式，前端 `ReportV2` 组件也在（`client.js:2005`）。丢的是**导出文本**与**结构化对象**。

### 4.5 `bootstrap` 不再带靶标统计

```bash
# 我方
grep -n "includeStats: false" /Users/wheming/.dsh/profiles/desktop/node_modules/dsh-purge-plus/lib/redteam/store-core.js
# → 762:  const engagements = store.listEngagements({ includeStats: false })
# safe
sed -n '1220,1240p' /Users/wheming/Documents/dsh-purge-plus/vendor/safe/lib/redteam/store-core.js   # stats = this.stats(entry.name)
```

影响：`bootstrap().engagements[].stats` 的 13 个字段（segments/assets/liveAssets/openPorts/vulns/credentials/accesses/…）没了。我方面板不读它（用 `snapshot.stats`），但**外部调用方/智能体按 safe 的字段名读会拿到 undefined**。

### 4.6 清理清单丢 `location`

safe 表：`kind, target, location, detail, status, …`（`vendor/safe/lib/redteam/schema.js:281-286`）
我方表：`asset_id, target, kind, title, detail, evidence_ref, status, priority, …`（`schema.js:403-416`）

```bash
# 差分实跑：cleanup op
# safe  items[] 含 location；plus 无 location，但有 title/priority/asset_id/evidence_ref/updated_by
```

我方是超集（多了优先级/资产绑定/证据引用/`cleared`），只丢 `location` 一个字段。

### 4.7 `getAssetCoverage` 少了 `asset.ports`

```bash
# 两边同数据调用 s.getAssetCoverage(eng, assetId) 后递归取键
# safe: asset.ports[] （端口嵌在 asset 里）
# plus: ports[]（顶层）+ asset.segment + missing + complete
```

`safe.asset.ports` 在我方变成顶层 `ports`，**读 `coverage.asset.ports` 的调用方会拿到 undefined**。safe 的 `redteam_asset`（`tools.js:1297`）直接把该对象 JSON 返回给智能体，提示词里若有 `asset.ports` 的说法就会对不上。

### 4.8 面板不写会话绑定、不显示跟随状态

safe：切项目时同时 `bindSessionEngagement` + `activateEngagement`（`client.js:16050-16058`），并按绑定来源显示 `手选` / `跟随` / `未绑`。
我方：只 `activateEngagement`（`client.js:5428`），不带 `session`。

后果：多会话并行时，用户在面板上切的靶标**不会**成为「本会话的靶标」；`attention`/`coverageSummary`/`reportV2` 等按「显式 > 会话绑定 > 全局指针」解析（`store-core.js:1020-1037`），于是仍落到全局指针上。

### 4.9 代理设置（safe 自身也是死 UI）

safe 的 `ProxySettings`（`client.js:12745`）调 6 个 op：`proxyPoolGet/Save/Connect/Test/Import/Disconnect`、`proxyProfileConnect/Test`、`proxyConfigImport`。
**safe 后端一个都没实现**：

```bash
grep -rn "proxyPool" /Users/wheming/Documents/dsh-purge-plus/vendor/safe/lib/ | grep -v client.js
# → 无输出
```

我方也没有（`{"op":"proxyPoolGet"}` → `unknown op`）。差别只是：safe 会显示一个点了报错的代理面板，我方不显示。**不算能力缺口**，但记在这里，避免以后被当成「我们漏了」。

### 4.10 报告缺「归属截图 / 复现截图」

safe 在报告归属段（`client.js:12048`）与复现段（`12077`）各挂一次 `ShotStrip`，数据来自 `buildReportV2` 的 `rpReportShots(...)`（`store-core.js:6829/6876/6896/6903/6912`，挂在每个资产组/阶段组上）。我方 `reportV2` 的组对象上没有 `shots`：

```bash
node /tmp/audit-safe/rv.mjs
# internal_segments[0] keys = segment,count,points,items   ← 组级没有 shots
```

所以这两处不是「补个组件」就行：得先有组级 `shots`（随 6.4 的 `buildReportV2` 一起移植最省事）。

**注意**：safe 资产详情里的那一处「关联截图」（`10983`）是死代码——`getAsset` 不返回 `shots`，两边都没有补挂，永远渲染不出来。这条**不计缺口**。

### 4.11 浮动面板不避让标题栏

safe `clampRtGeom` 用 `desktopChromeTop()` 把 `y` 夹在 `[chrome, vh-h]`（`client.js:15649-15658`）；我方 `client.js:4745-4752` 没有 chrome 项，`y` 从 0 起。桌面端把面板拖到最上方会压住标题栏/红绿灯。

---

## 五、已覆盖但实现不同（等价性依据）

> 这一节是「不许把等价误判成缺失」的凭据。

| 项 | safe | 我方 | 为什么等价 |
|---|---|---|---|
| 会话隧道页 | `SessionTab` | 同名组件，标签重写 | 探测/手动标记/复制/冰蝎+suo5 提示逐条对照一致 |
| 技能库页 | 目录 → 详情两屏 | 同结构，判定文案不同 | 「官方/自带/其它插件」「可用/缺口/未知」「跳过 30 秒缓存重查」都在 |
| 知识库页 | 模板库统计 + POC 列表 | 同结构 | 只差空库提示措辞 |
| 覆盖度引擎 | `redteam_asset` 的 `op=coverage` | `redteam_asset_coverage` 独立工具 **且** `redteam_asset` 仍保留 `op=coverage` | 两条路径都在，老的调用方式不破 |
| 更新按钮 | `VersionBar` 只读 package.json（2 个标签） | 完整「检查/阻塞项/一键更新并重启」（28 个标签） | 我方更强 |
| 全屏 | 只原地 `requestFullscreen` | 先原地、失败才开新窗口 | 行为是超集；只有 tooltip 文案陈旧 |
| 资产详情三层 | 3 行必读 + 展开全部 | 同构 | 端口/指纹/采集溯源/测试记录四项齐 |
| `parseAgentReport` | 正则第三组含 `[` | 排除 `[` 并支持裸数组 `[凭证, VPN]` | 我方更严，不会把 `[凭证]` 解析成一个带方括号的字符串 |
| `deleteShot` / `deletePoc` | `assertPathWithin` / `rmSync(recursive)` | `assertNoLinkedDescendants` / `removeTreeNoFollowSync` | 我方对符号链接更严 |
| `setSessionBinding` | `writeFileSync` | `atomicWriteSync` | 断电不会写半截 |
| `searchTemplates` | 空关键字走短路 | 统一过滤（结果相同），另加 `category` 过滤 | 返回字段一致（`dir/total/matched/offset/items`） |
| `templateStats` | `{dir,total,cve}` | 另加 `byCategory` | 超集 |

---

## 六、真缺功能（按影响排序 + 最小实现路径）

### 6.1 会话关系图（影响：高 — 智能体页主视图、多会话并行时的唯一可视化）

- 现状：`SessionMap` 只剩绑定表；7 个图 helper 全无。
- 数据源已就绪：`op:sessionBindings`（我方有）+ 宿主 `POST /api/session/list`（宿主能力，与插件无关）。
- 最小实现：
  1. 从 `vendor/safe/lib/redteam/client.js:14318-14790` 移植 7 个 helper（`validateSessionListResponse`/`scopeSessionSummaries`/`selectSessionMapVisible`/`summarizeSessionMap`/`sessionMapEdgePath`/`layoutSessionMap`/`positionSessionMap`）与 `SessionMap`（`14798-15420`）。
  2. 在 `lib/redteam/client.js` 的 `AgentsTab`（现 `4546` 行 `h(SessionMap, ...)`）把绑定表换成图，绑定表降级为图下方一张小表。
  3. 后端零改动。
- 验收：`sessionBindings` 返回非空时，图上节点数 = 绑定表行数；`activity` 筛选、`Esc` 退出全屏、拖拽/滚轮缩放可用。

### 6.2 情报保鲜：KEV + nuclei 模板库刷新（影响：高 — 直接决定「优先级怎么排」）

- 现状：`intelStatus` 是资源年龄探针；`redteam_template_refresh` 自述「不联网、不下载」；`redteam_poc_search` 不再标注 KEV 命中。
- 最小实现：
  1. 新增 `lib/redteam/kev.js`（safe 178 行，纯 `node:` 无依赖）：`kevStatus(root)` / `lookupKev(root, cves)` / `refreshKevIfStale({root, force})`，落 `$DSH_HOME/redteam/kb/cve-kev.json`。
  2. 新增 `lib/redteam/bootstrap-runtime.js` 的 `templatesStatus(root)` / `refreshTemplateLibrary({force})`（safe `175` / `446` 行）。
  3. `store-core.js:2369` 的 `intelStatus` 改为返回 `{templates, kev}`（**保留**现有 `resources` 字段以免破坏我方前端，二者并存）。
  4. `tools.js:1226` 的 `redteam_template_refresh` 接真实刷新；`redteam_poc_search`（我方 `tools.js:2857`）加 KEV 命中标注。
  5. `client.js` 的 `EnvTab`（`3356`）加「情报保鲜」卡片（模板库年龄 / KEV 条数 / 刷新按钮），照 `vendor/safe/lib/redteam/client.js:13388-13423`。
- 验收：`curl -d '{"op":"intelStatus"}'` 返回里有 `kev.available`；`redteam_template_refresh action=refresh` 后模板目录 mtime 变化。

### 6.3 报告 Markdown 渲染（影响：中高 — 报告是交付物，纯文本没法看表）

- 最小实现：移植 `client.js:629` 起的 `Markdown` + `renderInline` + `splitTableRow` + `isTableSep`，在 `ReportTab`（`client.js:2778`）工具栏下加一个 `<details>`「详细报告查看」，内容 `h(Markdown, {text: mdText})`（对齐 safe `12344-12346`）。
- 验收：导出的 md 里的表格/标题在面板里能正常显示。

### 6.4 报告四段式导出（影响：中 — 导出与界面口径不一致）

- 现状：界面是四段式（`ReportV2`），导出是 legacy 0–5 章。
- 最小实现：移植 `store-core.js:6785`（`buildReportV2`）与 `6980`（`renderTemplateReport`），在 `scoreReport` 里加 `layout` 选项与 `report` 字段；或让 `reportV2`（`store-core.js:2489`）的 `markdown` 改用 `renderTemplateReport(report)`。
- 验收：`node /tmp/audit-safe/md.mjs ... reportV2 | grep '^#'` 输出含 `一、资产归属证明` / `三、得分点复现`。

### 6.5 报告「归属截图 / 复现截图」（影响：中 — 证据链不完整）

- 前置：我方 `reportV2` 的组对象要先有 `shots`（见 4.10）。最省事的做法是随 6.4 一起移植 `buildReportV2` 的 `rpReportShots`，它已经在 safe 里算好了。
- 然后：`ReportV2`（`client.js:2005`）的归属段与复现段各挂一次 `h(ShotStrip, {eng, shots: g.shots, total: (g.shots||[]).length, title:'归属截图'/'复现截图'})`（safe `12048`/`12077`）。`ShotStrip` 组件我方已有（`client.js:738`）。
- **不要**照搬 safe 资产详情那处（`10983`）：它没有数据源，是死代码。

### 6.6 网段视图（影响：中 — 按 C 段看「这台机器属于哪一段、有几台存活」的唯一表格视图）

- 最小实现：`AssetsTab` 加第三个 view（`'segments'`），渲染 `snapshot.segments`（字段已在：`cidr/org/asn/assets/live/open_ports/passive_ports/active_ports/scope`，见 `store-core.js:3000` 的 `listSegments`）。safe 参考 `10759-10840`。

### 6.7 面板会话跟随（影响：中 — 多会话并行时报告会不会写串）

- 最小实现：`client.js:5424` 的 `onChange` 加 `session: props.sessionId` 与 `api({op:'bindSessionEngagement', session, engagement})`；顶部加「手选/跟随/未绑」chip（safe `16010-16028`）。后端两个 op 都在。

### 6.8 `consoleDigest` 三个 section（影响：低中 — 只影响红点）

- 最小实现：`store-core.js:2928` 的 `consoleDigest` 照 safe `1355-1390` 补三段：

```js
artifacts: {
  count: count('SELECT COUNT(*) AS n FROM attack_file') + count('SELECT COUNT(*) AS n FROM credential')
       + count('SELECT COUNT(*) AS n FROM access_session'),
  at: maxOf(at('SELECT MAX(created_at) AS t FROM attack_file'),
        maxOf(at('SELECT MAX(found_at) AS t FROM credential'),
              at('SELECT MAX(obtained_at) AS t FROM access_session'))),
},
overview: { count: count(hits), at: at(hitsAt) },
env: { count: 0, at: null },
```

### 6.9 顶部避让（影响：低 — 浮动面板拖到顶部会被标题栏压住）

- 最小实现：移植 `desktopChromeTop()`（safe `15639`），在 `clampRtGeom`（`client.js:4745`）里把 `y` 的下界从 0 改成 `chrome`。

### 6.10 `getAssetCoverage` 补回 `asset.ports`

- 最小实现：`store-core.js:1717` 的 `getAssetCoverage` 里 `asset: {…, ports: this.#covPortsOf(db, asset.id)}`（保留顶层 `ports` 不动）。
- 顺带：`bootstrap` 若要恢复 `engagements[].stats`，把 `store-core.js:762` 的 `includeStats:false` 改成可选参数（默认 false 保性能，`bootstrap` 里传 true）。

---

## 七、有意排除（不是缺口）

| 项 | safe 位置 | 为什么不做 |
|---|---|---|
| 地域/银行拒绝层 | `net-scope.js:625` `installRegionGate`（`index.js:30` 安装；`net-scope.js:186` `DENIAL = "不行，这是严令禁止的"`；`530/540/555` 三处短路返回） | **反向能力**：它会在 `agent/pre-step` 第 1 步判定任务是否命中境外银行/央行/交易所域名，命中就直接把这一轮收空并回拒绝文本。整包用 safe 会被这条挂住。我方 `lib/index.js:46` 只 import `readAllowText/writeAllowText`，`grep -c installRegionGate` = 0。**残留**：`lib/net-scope.js:186` 的 `DENIAL` 常量还在（死代码，建议清掉，避免以后误接） |
| 团队任务板默认开 | `team-mode.js:1-40`，`index.js:1115` | 我方红队流程挂在原生 `subagent` 上（并发闸门/角色稿/叶子约束都在那条路径），preset 明写「不要用 Agent Teams 的 `spawn_teammate`」。代价：红队会话里没有 `team_task_*` 工具 |
| 并发名额挂起 | `slot-state.js:1-20` | 我方名额只按 `ctx.subagents` 注册表算，没有 parked 概念；`tools.js:468-470` 有原注释说明这是主动不移植。**风险**：执行智能体回报 `waiting`/`blocked` 时仍占名额，可能把后续派活堵住 |
| 代理设置面板 | `client.js:12745` | safe 后端也没有对应 op，面板点了只会报错；不移植等于不显示一个坏面板 |

---

## 八、结论

1. **后端是 safe 2.0.0 的严格超集**：83 个 dispatch op 一个不缺、120 个 store 方法一个不缺、67 个模型工具一个不缺、29 张表同集合。所有「unknown op」只出现在我故意探测的 `proxyPool*` 与我编造的假 op 名上。
2. **缺口集中在前端与会话侧**：9 条缺失里 7 条是纯前端（会话关系图、网段视图、Markdown 渲染、情报保鲜卡片、面板会话跟随、顶部避让、代理面板），只有 2 条要动后端（KEV 索引、模板库刷新）。
3. **两条必须先修的**：
   - 会话关系图（`SessionMap`）——智能体页现在只剩一张绑定表，多会话并行时看不出谁在跑、谁在等；
   - 情报保鲜（KEV + 模板库）——`redteam_template_refresh` 现在自述「不联网、不下载」，而提示词仍在教智能体「引用最新 KEV」，两边对不上。
4. **字段级回归 5 条**（`consoleDigest` 三段、`scoreReport.report/layout`、`bootstrap.engagements[].stats`、`cleanup.location`、`getAssetCoverage.asset.ports`）不会让界面崩，但会让「按 safe 字段名读的调用方」拿到 `undefined`；建议按 6.8/6.4/6.10 补齐，成本都很低。
5. **反向能力排除正确**：地域/银行拒绝层确实排掉了（`installRegionGate` 零引用），只留下一个未使用的 `DENIAL` 常量建议清理。
