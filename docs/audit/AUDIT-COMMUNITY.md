# 审计：dsh-purge-plus 是否完整覆盖 dsh-purge-community

审计时刻：2026-11-20 22:41 (+08:00)

| 角色 | 路径 | 标识 |
|---|---|---|
| 基准（社区版） | `vendor/community/`（下称 `COMM/`） | `dsh-purge-community@1.7.20` |
| 我方（构建产物，已装到宿主） | `~/.dsh/profiles/desktop/node_modules/dsh-purge-plus/`（下称 `PLUS/`） | `dsh-purge-plus@1.7.20-plus.23` |
| 运行中的宿主后端 | `http://127.0.0.1:55439` | 进程内模块仍是 `1.7.20-plus.19` |

审计对象文件的 sha256（写入时刻）：

```
77891b1de4137188359cdef053cc3103cb7aaf4e2bf42ae5ecf0321e460f861d  PLUS/client.js
2e02a7278690dc67c2d0e6ef5934bb335febbf86683c6d15817d2a6bd782680d  PLUS/lib/redteam/store-core.js
485881ef3ae165a0f57bfd62186dd8ef4d7e4ce98ce9694a9fbb5043e86d8216  PLUS/lib/redteam/tools.js
7f17cef3f0db7979d6e68927370f063dcdaafb27779f15c33a787d9dc04ac9a7  PLUS/lib/redteam/schema.js
2c97e612647e6dc87daef37d840c4128c1701dca0effa1d8e1fb8a5ad2bfe548  PLUS/lib/redteam/client.js
99e1b1a5075ee1587313654de2a0bca3023c1bc8c39fafece60b95873de99412  PLUS/lib/update.js
```

> **审计期间该包被连续重建（.19 → .21 → .23）**，实机后端进程内仍是 `.19`。
> 因此：**接口级实机结论代表 .19，文件级结论代表 .23**。凡两处不一致处本文分别标注。
> `.19` 的源码已被覆盖（`~/.dsh/dsh-purge/backups` 里只有 plus.2 的备份），无法逐行比对，见「未验证」。

---

## 摘要

| 项 | 数量 |
|---|---|
| **缺失（社区有、我方无）** | **0** |
| 可疑 bug（我方引入） | **4**（高 1 / 中 1 / 低 2） |
| 确认无问题（成组核验） | **9 组** |
| 顺带发现社区版自身 bug（我方已修） | 5 处 |

一句话：**功能覆盖是完整的——五类标识符（后端 op / 模型工具 / 前端 op 字面量 / 页签 / HTTP 路由）双向差集里社区侧无一丢失；问题不在"少做了功能"，而在新加的清理清单接口会静默清空字段、离线时版本历史被过滤光、以及一处兼容性声明与自身声明矛盾。**

---

## 方法

抽集合脚本对两棵树分别全量扫描 `*.js / *.mjs`（`COMM` 171 文件，`PLUS` 173 文件），正则同时接受单/双引号：

| 类别 | 抽取式 |
|---|---|
| 后端分支 | `op === 'x'` / `op === "x"` / `body.op==="x"` / `request.op === 'x'` / `case 'x':` |
| 前端 op 字面量 | `op: 'x'` / `op: "x"` |
| 模型工具名 | `name: 'redteam_*'` / `name: "redteam_*"` |
| 页签 | `var TABS` / `const tabs = [` / `TAB_GROUPS` |
| 路由 | `path: '/dsh-purge*'` |

`client.js` 中文以 `\uXXXX` 转义，先整体解码到 `/tmp/audit/*.client.js` 再检索（面板 17013 行、演练台 5561 行）。

---

## 表 1 缺失清单

**0 条。** 社区侧五类标识符全部在我方存在。

| 功能 | 社区版位置(file:line) | 我方状态 | 影响 |
|---|---|---|---|
| —（无缺失） | — | — | — |

### 表 1-附 覆盖核验矩阵（支撑上表）

| # | 组 | 社区版 | 我方 | 差集 |
|---|---|---|---|---|
| 1 | 后端 op 词表 | 155 | 174 | 缺 0，新增 19 |
| 2 | 模型工具 `redteam_*` | 64 | 82 | 缺 0，新增 18，重名 0 |
| 3 | 前端 op 字面量 | 50 | 61 | 缺 0，新增 11 |
| 4 | 面板页签 | 6（`COMM/client.js:13805` `var TABS`） | 6（`PLUS/client.js:15216`） | 完全一致 |
| 5 | 演练台页签 | 10（`COMM/client.js:8583`、`COMM/lib/redteam/client.js:4008`） | 13（`PLUS/client.js:9835`、`PLUS/lib/redteam/client.js:5241`） | 缺 0，新增 overview/artifacts/evidence |
| 6 | HTTP 路由 | 22 条（`COMM/lib/index.js:1543`…`:2957`） | 22 条（`PLUS/lib/index.js:1547`…`:2961`） | 逐条同名同 kind |
| 7 | 宿主补丁 id | 83 个数字 id | 88 | 缺 0，新增 201/202/203/205/206 |
| 8 | i18n 键 | 433 | 438 | 丢失 0 |
| 9 | `presets/` `skills/` `locale/` | — | — | `diff -rq` 无输出，逐字节一致 |

补充：社区 `lib/redteam/ui.js`（`/redteam/api` 路由 + 平台/技能/智能体/更新四组二级分发）在我方**逐字节未改**；因此社区那 4 组二级 op（`platformEnvAdaptStatus`、`platformEnvAdaptSkip`、`platformConfigGet/Save`、`skillCatalog`、`skillRead`、`agentsStatus`、`setAgentsMax`、`version`、`updateCheck`、`updateApply`）天然覆盖。已实机逐个打点，见 表 3.1。

`/dsh-purge/community` 维护通道的 6 个 op（`preferences/backup/rollback/prune/check/update`）两边一致（`COMM/lib/index.js:1556-1565` vs `PLUS/lib/index.js:1560-1569`）。

### 顺带：社区版自身的 5 个 bug，我方已修（不是缺失，记录备查）

| # | 社区版问题 | 证据 | 我方修法 |
|---|---|---|---|
| 1 | `schema.js` 引用 `SCOPE_SQL`/`LEGACY_STAGE_MAP` 但从未导入 → `migrate()` 里两处迁移静默 no-op | `COMM/lib/redteam/schema.js:586`、`:591` 引用；定义在 `COMM/lib/redteam/store-core.js:157`、`:358`，`schema.js` 只 import 了 `parseTargetPort`（`:4`） | 常量搬到 `PLUS/lib/redteam/schema.js:15`、`:22`，store-core 原样再导出（`:40`、`:46`） |
| 2 | 无靶标时写操作判定用前缀正则，漏 `shotAdd/shotDelete/assetTest/resetPrompts` → 这 4 个写 op 在无靶标时返回 `ok:true` 空结果 | `COMM/lib/redteam/store-core.js:805` | 改显式集合 `WRITE_OPS`/`READ_OPS`（`PLUS/lib/redteam/store-core.js:742`、`:749`），未知 op 抛错（`:1177`） |
| 3 | 未知 op 被兜底吞成 `{ok:true, items:[]}`，任何拼错都看不见 | `COMM/lib/redteam/store-core.js:807` | 同上，`unknown op` 显式报错 |
| 4 | 面板 dock 默认页签写 `"clean"`，而 `TABS` 里没有这个 id → 关掉授权弹窗后落在空白页 | `COMM/client.js:9046`、`:10121` | 改为 `"status"`（`PLUS/client.js:10412`、`:11500`） |
| 5 | `searchTemplates` 签名只有 `(q, limit)`，但工具一直传 4 个参数 → `category` 被静默丢弃 | `COMM/lib/redteam/tools.js:2075` vs `COMM/lib/redteam/store-core.js` 的 `searchTemplates(q, limit = 40)` | 签名补 `offset, category`（`PLUS/lib/redteam/store-core.js:6449`） |

---

## 表 2 死按钮

**0 条。** 前端调用、后端无分支的 op：无。

核验口径（不只看字面量集合，还看调用点）：

1. 两个前端共 **124 处** `api({ op: ... })` 调用（面板 63、演练台 61），逐处取 op（含跨行写法，如 `PLUS/client.js:8747` 的 `op: eng ? "prompts" : "bootstrap"`）。
2. 与后端分支集合（`store-core.js` 全量 op + `ui.js` 的 `request.op` + `update.js` 的 `handleUpdateOp` + `index.js` 的 `body.op`）求差集。
3. 结果：**死按钮 0，无法静态解析的 1 处（三目）两个分支都合法**。

| op | 前端位置(file:line) | 后端状态 |
|---|---|---|
| —（无死按钮） | — | — |

另外 3 个"看起来像死 op"的已逐个确认属于别的端点，不是死按钮：

| 字面量 | 实际去向 | 证据 |
|---|---|---|
| `agentsStatus` | `ui.js` 二级分发 | `COMM/lib/redteam/ui.js:906`（`request.op !== 'agentsStatus'` 提前返回） |
| `updateApply` / `channel` / `switch` / `apply` | `POST /dsh-purge/update` → `handleUpdateOp` | `PLUS/lib/update.js:1382-1397`（`apply` 是兜底分支） |
| `preferences` | `POST /dsh-purge/community` | `PLUS/lib/index.js:1560` |

---

## 表 3 实机 op 结果

### 3.1 实机 HTTP 打点（后端 = `.19`，宿主当前无靶标）

命令模板：`curl -s -X POST http://127.0.0.1:55439/redteam/api -H 'content-type: application/json' -d '{"op":"<name>"}'`

只读 op 全量 57 条，逐条真打。`ok` 列原样取自返回体。

| op | ok | 关键字段 | 备注 |
|---|---|---|---|
| `bootstrap` | true | current,engagements,ok,root | 无靶标 → `engagements:[]` |
| `sessionBinding` | true | bound,current,name,ok,root_session,session | |
| `sessionBindings` | true | agents,bound,current,name,ok,root_session,session | |
| `attention` | true | awaiting_person,coverage_available,items,note,ok,pending_coverage,total | note「还没有靶标」 |
| `evidenceLedger` | false | error,ok | 需靶标 |
| `dataProofs` | false | error,ok | 需靶标 |
| `reportV2` | false | error,ok | 需靶标 |
| `intelStatus` | true | badge,missing_count,ok,resources,stale_count | 全局，无需靶标 |
| `cleanup` | false | error,ok | 需靶标 |
| `cleanupSummary` | false | error,ok | 需靶标 |
| `assetCoverage` | false | error,ok | 需靶标 |
| `hostCoverage` | false | error,ok | 需靶标 |
| `hostFinding` | false | error,ok | 需靶标 |
| `coverageSummary` | false | error,ok | 需靶标 |
| `pocSearch` | true | dbPath,items,ok,root,stats,templates | |
| `pocList` | true | dbPath,items,ok,root,stats | |
| `templateSearch` | true | dir,items,matched,offset,ok,total | 新签名生效（有 `matched`/`offset`） |
| `templateStats` | true | ok,stats | |
| `pocGet` | true | ok | 无 id → 无 poc 字段 |
| `platformConfigGet` | true | adapt,config,egress,hint,nucleiTemplatesDir,ok,runtime,toolkitDir,toolkitExists,tools | |
| `platformEnvAdaptStatus` | true | configured,found,foundIds,kali,kaliDetail,kaliSource,message,missing,missingIds,ok,ready,reason,skipped,total | |
| `snapshot` | true | items,ok,roles,segments,stages,stats,total | |
| `assets` | true | items,ok,roles,segments,stages,stats,total | |
| `asset` | true | items,ok,roles,segments,stages,stats,total | |
| `graph` | true | items,ok,roles,segments,stages,stats,total | |
| `attackGraph` | true | items,ok,roles,segments,stages,stats,total | |
| `stats` | true | items,ok,roles,segments,stages,stats,total | |
| `vulns` | true | items,ok,roles,segments,stages,stats,total | |
| `vulnStats` | true | items,ok,roles,segments,stages,stats,total | |
| `credentials` | true | items,ok,roles,segments,stages,stats,total | |
| `access` | true | items,ok,roles,segments,stages,stats,total | |
| `sessions` | true | items,ok,roles,segments,stages,stats,total | |
| `webshells` | true | items,ok,roles,segments,stages,stats,total | |
| `tunnels` | true | items,ok,roles,segments,stages,stats,total | |
| `shots` | true | items,ok,roles,segments,stages,stats,total | |
| `shotData` | true | items,ok,roles,segments,stages,stats,total | 无 id 时走空兜底（有靶标时才是 `shot not found`） |
| `domains` | true | items,ok,roles,segments,stages,stats,total | |
| `web` | true | items,ok,roles,segments,stages,stats,total | |
| `httpEvidence` | true | items,ok,roles,segments,stages,stats,total | |
| `chain` | true | items,ok,roles,segments,stages,stats,total | |
| `report` | true | items,ok,roles,segments,stages,stats,total | |
| `scores` | true | items,ok,roles,segments,stages,stats,total | |
| `scoreChain` | true | items,ok,roles,segments,stages,stats,total | |
| `scoreReport` | true | items,ok,roles,segments,stages,stats,total | |
| `activeTests` | true | items,ok,roles,segments,stages,stats,total | |
| `testStats` | true | items,ok,roles,segments,stages,stats,total | |
| `consoleDigest` | true | items,ok,roles,segments,stages,stats,total | |
| `stages` | true | items,ok,roles,segments,stages,stats,total | |
| `reportTargets` | true | items,ok,roles,segments,stages,stats,total | |
| `discoveryTimeline` | true | items,ok,roles,segments,stages,stats,total | |
| `attackFiles` | true | items,ok,roles,segments,stages,stats,total | |
| `readAttackFile` | true | items,ok,roles,segments,stages,stats,total | |
| `prompts` | true | builtin,ok,roles | roles=6 |
| `skillCatalog` | true | ok,total,fromPlugin,availability,bySource,byDir,items | total=23，23 可用 |
| `skillRead`（不存在的名字） | false | ok,error | `skill not found: __nope__` |
| `agentsStatus` | true | ok,max,used,free,running,total_children,source,limit,default_max | max=3 |
| `version` | true | ok,plugin,install,latest,updateAvailable,localAhead,blockers,notes | plugin=1.7.20-plus.19 |
| `updateCheck` | true | ok,current,latest,updateAvailable,install,blockers,notes | current=.19 / latest=plus.4 |
| `bogusOpXyz`（负例） | false | ok,error | `unknown op: bogusOpXyz`（社区版这里返回 ok:true） |

**注意**：上表 32 个需靶标的读 op 在"无靶标"下返回的是同一个空壳 `{items:[],roles:[],segments:[],stages:[],stats:null,total:0}` —— 这是 `.19` 的实测结果，也是社区版语义（`COMM/lib/redteam/store-core.js:807`）。它只能证明"分支到达"，证明不了"查询正确"，带数据的验证见 3.2。

**但 `.23` 已改掉这条语义**（审计过程中重建），见下表。

### 3.1-附 `.23` 的无靶标行为（与 `.19`/社区版不同）

`PLUS/lib/redteam/store-core.js:1181`：

```js
return { ok: false, no_target: true, error: '请先在顶部选择或创建一个靶标', items: [], total: 0 }
```

在空 root 上逐条打 32 个 scoped 读 op（`/tmp/audit/nogate.mjs`）：

```
ok=false count: 31 / 32
all have no_target: false          ← prompts 仍走内置默认
sample: {"ok":false,"no_target":true,"error":"请先在顶部选择或创建一个靶标","items":[],"total":0}
prompts still ok: {"ok":true,"builtin":true,"roles":[...]}
```

| 对比项 | 社区版 / `.19` | `.23` |
|---|---|---|
| 无靶标时的 scoped 读 op | `ok:true` + 空壳 | `ok:false, no_target:true` + `items:[]`（保留 `items/total` 供旧调用方读数组） |
| `prompts` | `ok:true` 内置默认 | 同左，未变 |

这是**接口契约变化**（社区版语义更宽松），不属于"功能缺失"：前端 13 个页签都在 `!engagement` 时提前返回，不会因此报错（`PLUS/client.js:3295-3298`、`:3322`；`PLUS/lib/redteam/client.js` 同形）。但对直接调 `/redteam/api` 的外部脚本是行为差异，记录在此。

### 3.2 带数据打点（文件 = `.23`，临时 root，不碰用户数据）

做法：`new RedteamStore('/tmp/audit/rtroot')` → `openEngagement` → 灌入 2 资产 / 1 漏洞 / 1 凭据 / 1 入口 / 1 webshell / 1 隧道 / 1 HTTP 证据 / 1 链步 / 1 得分 / 1 攻击文件 / 1 子智能体回报 / 1 覆盖度 / 1 主机发现 / 1 清理项 / 1 数据证明，然后逐 op `dispatch()`。

| op | ok | 关键字段 | 备注 |
|---|---|---|---|
| `snapshot` | true | engagement,ok,segments,stats,tests | stats 13 键 |
| `assets` | true | items,ok,sort,total | total=2 |
| `asset` | true | asset,ok | 单资产 27 字段 |
| `graph` | true | edges,nodes,ok | |
| `attackGraph` | true | edges,nodes,ok,summary | |
| `stats` | true | ok,stats | |
| `vulns` | true | items,ok,stats,total | total=1 |
| `vulnStats` | true | ok,stats | |
| `credentials` | true | items,ok | items=1 |
| `access` | true | items,ok | items=1 |
| `sessions` | true | ok,totals,tunnels,webshells | |
| `webshells` | true | items,ok | items=1 |
| `tunnels` | true | items,ok | items=1 |
| `shots` | true | items,ok,total | total=0（未灌截图） |
| `shotData`（无 id） | false | error,ok | `shot not found: undefined` |
| `domains` | true | items,ok | items=3（primary_name 也进域名索引） |
| `web` | true | items,ok,total | total=2（只收 http/https 面） |
| `httpEvidence` | true | items,ok | items=1 |
| `chain` | true | items,ok | items=1 |
| `report` | true | generated_at,markdown,ok,stats | markdown 非空 |
| `scores` | true | items,ok,ruleGroups,summary | items=26（内置得分点） |
| `scoreChain` | true | achieved,items,missing,ok,stages,summary | |
| `scoreReport` | true | items,markdown,ok,stages,summary,target | |
| `activeTests` | true | at,ok,queue,recent,stats,testing,untested | |
| `testStats` | true | ok,stats | |
| `consoleDigest` | true | at,engagement,errors,ok,sections | `.23` 新增 `errors` 字段 |
| `stages` | true | items,ok | items=5 |
| `reportTargets` | true | engagement,generated_at,groups,ok,targets,totals | |
| `discoveryTimeline` | true | days,ok,recent,span | |
| `attackFiles` | true | items,ok | 按 target 分组，items=1 |
| `readAttackFile`（数字 id） | true | ok,id,target,name,kind,path,evidence,content… | 正文可读 |
| `prompts` | true | ok,roles | roles=6 |
| `attention` | true | awaiting_person,coverage_available,engagement,items,note,ok,pending_coverage,total | total=1，rank 排序生效 |
| `attentionAck`（all） | true | acknowledged,at,total,awaiting_person,items,note | acknowledged=1，再查 total=0 |
| `evidenceLedger` | true | empty,engagement,errors,items,ok,total,unknown_total,unknowns | 空库 → `empty:true`（不当绿灯） |
| `dataProofs` | true | engagement,items,ok,total | items=1，含 `meets_threshold` |
| `reportV2` | true | asset_proof,cleanup,engagement,generated_at,markdown,ok,repro,stage_su… | 四段齐全 |
| `cleanup` | true | by_kind,by_status,cleared,engagement,items,ok,total | |
| `cleanupSummary` | true | by_kind,cleared,done,engagement,ok,open,total,wontfix | |
| `assetCoverage`（默认 action） | false | error,ok | `get 需要 asset_id`（默认 action=get） |
| `assetCoverage`（action=next） | true | actions,engagement,ok,total | |
| `hostCoverage`（默认 action） | false | error,ok | `get 需要 asset_id` |
| `hostCoverage`（action=next） | true | actions,engagement,ok,total | |
| `hostFinding` | true | engagement,findings,ok,total | findings=1 |
| `coverageSummary` | true | assets,engagement,external,findings,internal,ok,pending | assets=2 / internal 1 / external 1 |
| `sessionBinding` | true | bound,current,name,ok,root_session,session | 落盘 `sessions.json` |
| `sessionBindings` | true | agents,bound,current,name,ok,root_session,session | agents 里有 sess-A |
| `intelStatus` | true | badge,missing_count,ok,resources,stale_count | |
| `intelRefresh` | true | checked_at,resources,ok | 不联网，只重探 |

筛选器与聚合另测（3 资产：内网 2 + 外网 1）：`q=web`→1、`scope=internal`→2、`scope=external`→1、`cidr=10.0.0.0/24`→2、`state=down`→0、`port=3306`→1，全部符合预期。

### 3.3 页签 → 后端数据源对照（每个页签都有源）

| 页签 | 组件 | 调用的 op | 3.1/3.2 是否 ok |
|---|---|---|---|
| 工作总览 `overview` | `OverviewTab` | snapshot, coverageSummary, attention, assetCoverage(next), hostCoverage(next), intelStatus, reportV2 | 全部 ok |
| 资产测绘 `assets` | `AssetsTab` | assets, asset, domains, web, discoveryTimeline | 全部 ok |
| 环境适配 `env` | `EnvTab` | platformConfigGet, platformConfigSave, platformAssignToolkit | get ok；两个写未打（见未验证） |
| 智能体 `agents` | `AgentsTab` | agentsStatus, snapshot, consoleDigest, bootstrap, openEngagement, activateEngagement, sessionBinding, bindSessionEngagement, attention, attentionAck, version, updateCheck, platformEnvAdaptStatus, preferences | 只读项全 ok |
| 会话隧道 `sessions` | `SessionTab` | sessions, probeSessions, updateTunnel, updateWebshell, sessionBindings, attention, attentionAck | 只读项全 ok |
| 漏洞战果 `findings` | `FindingsTab` | vulns, credentials, access, attackFiles, updateVuln | 只读项全 ok |
| 凭据与文件 `artifacts`（新增） | `ArtifactsTab` | attackFiles, credentials, access | 全 ok |
| 证据账本 `evidence`（新增） | `EvidenceTab` | evidenceLedger | ok |
| 攻击链 `chain` | `ChainTab` | scoreChain | ok |
| 得分目标 `scores` | `ScoreTab` | scores, saveScorePoint, deleteScorePoint | 读 ok |
| 报告 `report` | `ReportTab` / `ReportTabPlus` | scoreReport, scoreChain / reportV2 | 全 ok |
| 知识库 `knowledge` | `KnowledgeTab` | pocSearch, pocGet, pocUse | 读 ok |
| 技能库 `skills` | `SkillsTab` | skillCatalog, skillRead | 全 ok |

页签 → 组件映射：`PLUS/client.js:9936-10033`、`PLUS/lib/redteam/client.js:5348-5385`；13 个页签在两个客户端里都有 body 分支，无"点了空白"的页签。

---

## 表 4 可疑 bug

### B1（高）`updateCleanup` 会把 target/title/detail/priority 全部写成 NULL；只改说明则直接报错

**位置**：`PLUS/lib/redteam/store-core.js:996-1001`（op 分发）+ `:2170-2197`（`updateCleanup`）+ `PLUS/lib/redteam/tools.js:806-812`（工具 `redteam_cleanup` 的 update 分支，同一写法）

**根因**：分发与工具都把 6 个字段**无条件**放进 patch 对象；`updateCleanup` 用 `hasOwnProperty(patch, f)` 判"要改这个字段"（`:2188`），于是没传的字段 `undefined` 也命中，被写成 `null`。而 `status` 键存在但值为 `undefined` 时又会被状态校验拦住（`:2176`）——同一个写法导致两个相反的错误。

对比：同一批新增的 `assetCoverage` / `hostCoverage` 分发是**过滤 undefined 后**才组 patch（`:1049-1053`、`:1074-1078`），所以只有 `updateCleanup` 有这个缺陷。

**复现**：

```bash
cat > /tmp/repro-b1.mjs <<'EOF'
const P='/Users/wheming/.dsh/profiles/desktop/node_modules/dsh-purge-plus/lib/redteam/store-core.js'
const {RedteamStore,dispatch}=await import(P)
const s=new RedteamStore('/tmp/repro-b1-root'); const e=s.openEngagement('b1',[])
const a=s.addCleanup(e.id,{target:'http://10.0.0.9/shell.php',kind:'webshell',title:'删掉 shell.php',detail:'密码 x',priority:'high'})
console.log('before:',JSON.stringify(s.listCleanup(e.id,{}).items[0]))
console.log('update:',JSON.stringify(dispatch(s,{op:'updateCleanup',engagement:e.id,id:a.cleanup_id,status:'done'})).slice(0,160))
console.log('after :',JSON.stringify(s.listCleanup(e.id,{}).items[0]))
console.log('dedupe:',JSON.stringify(s.addCleanup(e.id,{target:'http://10.0.0.9/shell.php',kind:'webshell',title:'删掉 shell.php'})))
console.log('detail-only:',JSON.stringify(dispatch(s,{op:'updateCleanup',engagement:e.id,id:a.cleanup_id,detail:'只改说明'})))
EOF
rm -rf /tmp/repro-b1-root && node /tmp/repro-b1.mjs
```

**实际输出**：

```
before: {"id":1,...,"target":"http://10.0.0.9/shell.php","kind":"webshell","title":"删掉 shell.php","detail":"密码 x",...,"status":"open","priority":"high",...}
update: {"ok":true,"engagement":"b1","cleanup":{"id":1,...,"target":null,"kind":"webshell","title":null,"detail":null,...,"status":"done","priority":null,...}}
after : {"id":1,"asset_id":null,"target":null,"kind":"webshell","title":null,"detail":null,"evidence_ref":null,"status":"done","priority":null,...}
dedupe: {"cleanup_id":2,"deduped":false}
detail-only: {"ok":false,"error":"status 只能是 open/done/wontfix，收到 undefined"}
```

**期望**：只改 `status` 时其余字段保持原值（`target`/`title`/`detail`/`priority` 不变）；只改 `detail` 时成功且不动 `status`。

**连带影响（实测）**：`target` 被清成 NULL 后 `addCleanup` 的去重键失效——同一 `target+kind` 再登记会新建一条（上面 `dedupe` 行的 `cleanup_id:2` 就是重复项）。

清理清单是报告收尾段的唯一数据源（`reportV2.cleanup`），字段被清空等于交付物里"我们留下了什么、清没清"变成一串 null。**智能体按工具描述用 `action=update` 收口时必然触发**。

---

### B2（中）离线 / GitHub 限流时，「版本历史」被过滤光，只剩本地一条

**位置**：`PLUS/lib/update.js:666-669`

```js
const forkRefs = new Set(fork.rows.map((row) => row.ref));
for (const item of readHistory()) {
  if (!item || !item.ref || withdrawnVersion(item)) continue;
  if (!forkRefs.has(item.ref)) continue;   // ← 离线时 fork.rows 为空，全部被丢弃
```

**根因**：用"当前能列出的发行"去过滤"本地装过的历史"。断网/限流时 `fork.rows` 为空，`forkRefs` 为空，历史条目全灭；而历史是**本地事实**，不该依赖远端可达性。

**复现**（用临时 `DSH_HOME`，不碰真实状态）：

```bash
rm -rf /tmp/h && mkdir -p /tmp/h/dsh-purge
printf '[{"ref":"v1.6.67","version":"1.6.67","channel":"stable"}]' > /tmp/h/dsh-purge/version-history.json
P=~/.dsh/profiles/desktop/node_modules/dsh-purge-plus
C=~/Documents/dsh-purge-plus/vendor/community
# 我方（断网）
DSH_HOME=/tmp/h HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 \
  node -e "import('$P/lib/update.js').then(async m=>console.log(JSON.stringify((await m.listRemoteVersions()).versions.map(v=>v.ref||v.version))))"
# 社区版（同样断网）
DSH_HOME=/tmp/h HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 \
  node -e "import('$C/lib/update.js').then(async m=>console.log(JSON.stringify((await m.listRemoteVersions()).versions.map(v=>v.ref||v.version))))"
```

**实际输出**：

```
我方  : ["local-1.7.20-plus.23"]
社区版: ["local-1.7.20","v1.6.67"]
```

联网时我方列表正常（8 条），说明只有离线分支被影响。

**期望**：断网时历史条目仍应出现在列表里（`kind:"history"`），只是不可下载；至少不能比社区版更少。可选做法：只在 `fork.rows.length > 0` 时启用该过滤。

**影响**：面板「版本 / 历史」在断网、代理故障、GitHub 60 次/小时限流（`update-http.js` 匿名访问）时只剩一行本地版本，用户回不到自己装过的版本。

---

### B3（低）兼容性声明自相矛盾：`dshTarget` 说 0.2.2-rc.5 已验证，`dshReleases` 里没有 rc.5 → 面板报"未在已验证清单内"

**位置**：`PLUS/package.json:137`（`"dshTarget": "0.2.2-rc.5 (runtime injection + host patches verified)"`）vs `:115-124`（`dshReleases` 最后一项是 `"0.2.2-rc.3": "compatible"`）

**复现**：

```bash
curl -s http://127.0.0.1:55439/dsh-purge/status \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['compatibility']['host_version'],d['compatibility']['level']);print(d['compatibility']['message'])"
node -e "const p=require(process.env.HOME+'/.dsh/profiles/desktop/node_modules/dsh-purge-plus/package.json');console.log(p.dshTarget);console.log(Object.keys(p.dsh.compatibility.dshReleases).slice(-3))"
```

**实际输出**：

```
0.2.2-rc.5 unverified
DSH 0.2.2-rc.5 未在已验证清单内：仍可应用，写入前备份，应用后请看逐条诊断确认锚点是否漂移。
0.2.2-rc.5 (runtime injection + host patches verified)
[ '0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3' ]
```

**期望**：`dshReleases` 里补上 `"0.2.2-rc.5": "compatible"`（这正是构建与实测所用的宿主），`level` 应为已验证档，面板不再对目标宿主报未验证。

**来源**：`dshReleases` 表是社区版原样（`COMM/package.json` 同表，最后一项也是 rc.3），但社区版的 `dshTarget` 写的是 `0.2.1-rc.1`——在表内，所以社区版自洽；我方把 `dshTarget` 改到 rc.5 却没同步表，**这是我方引入的不一致**。

**影响**：仅提示层。功能不受影响（实测 `patches_applied 85 / pending 0`），但会让用户每次打开面板都看到一条"未验证"警告，训练人忽略这条警告。

---

### B4（低）`LEGACY_STAGE_MAP` 回填只在"新建列"时执行，社区版升上来的库永远不回填

**位置**：`PLUS/lib/redteam/schema.js:779-784`

```js
if (ensure('attack_step', 'stage_code', 'TEXT')) {   // 只有本次真的加了列才回填
  ... LEGACY_STAGE_MAP 回填 ...
}
```

**复现**（先用社区版建库并造一条老数据，再用我方打开）：

```bash
cat > /tmp/repro-b4.mjs <<'EOF'
import { rmSync, mkdirSync } from 'node:fs'
const C='/Users/wheming/Documents/dsh-purge-plus/vendor/community/lib/redteam/store-core.js'
const P='/Users/wheming/.dsh/profiles/desktop/node_modules/dsh-purge-plus/lib/redteam/store-core.js'
rmSync('/tmp/repro-b4-root',{recursive:true,force:true}); mkdirSync('/tmp/repro-b4-root',{recursive:true})
const c=await import(C); const cs=new c.RedteamStore('/tmp/repro-b4-root')
const e=cs.openEngagement('legacy',['10.0.0.0/24'])
const db=cs.db(e.id)
cs.importBundle(e.id,{assets:[{ip:'10.1.2.3',primary_name:'old'}]})
db.prepare("UPDATE asset SET scope='' WHERE ip='10.1.2.3'").run()
db.prepare("INSERT INTO attack_step(stage,title) VALUES('vuln','legacy step')").run()
console.log('before:',JSON.stringify({scope:db.prepare("SELECT scope FROM asset WHERE ip='10.1.2.3'").get(),stage:db.prepare("SELECT stage,stage_code FROM attack_step").get()}))
const p=await import(P); const ps=new p.RedteamStore('/tmp/repro-b4-root')
const pdb=ps.db(e.id)
console.log('after :',JSON.stringify({scope:pdb.prepare("SELECT scope FROM asset WHERE ip='10.1.2.3'").get(),stage:pdb.prepare("SELECT stage,stage_code FROM attack_step").get()}))
console.log('new tables:',pdb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('asset_coverage','cleanup_item','data_proof','host_finding','agent_report')").all().map(r=>r.name).join(','))
EOF
node /tmp/repro-b4.mjs
```

**实际输出**：

```
before: {"scope":{"scope":""},"stage":{"stage":"vuln","stage_code":null}}
after : {"scope":{"scope":"internal"},"stage":{"stage":"vuln","stage_code":null}}
new tables: agent_report,asset_coverage,host_finding,data_proof,cleanup_item
```

即：新表全部补齐、`asset.scope` 回填成功（`""` → `"internal"`，因为那条 UPDATE 没包在 `if (ensure(...))` 里），**只有 `attack_step.stage_code` 仍是 NULL**。

**期望**：从社区版升上来的库也应把老 `attack_step` 的 `stage_code` 补齐（社区版这段迁移因 ReferenceError 从未生效，见 表 1-附 第 1 条，所以老库里 `stage_code` 普遍是 NULL）。

**影响**：低。所有读路径都有兜底（`store-core.js:5726`、`:6031`、`:6036` 用 `row.stage_code || LEGACY_STAGE_MAP[row.stage]`，`scoreStageOf` 也兜底），面板与报告显示正常；只是库里那一列一直是 NULL，任何直接查库的脚本会看到空值。

---

## 结论

**覆盖是完整的：社区版 1.7.20 的现行功能在我方 1.7.20-plus.23 里一项不缺**——后端 op（155→174）、模型工具（64→82）、前端 op 字面量（50→61）、面板页签（6→6）、演练台页签（10→13）、HTTP 路由（22→22）、宿主补丁 id（83→88）、i18n 键（433→438）、`presets/skills/locale`（逐字节一致）九组双向差集里，社区侧零丢失，死按钮零条。

**不完整的地方不在"功能覆盖"，在"新加的那部分自己带病"**：`updateCleanup`（B1）会静默把清理项的目标/标题/说明/优先级清成 NULL 并让去重失效——这是数据丢失，且落在交付报告收尾段的唯一数据源上；离线时版本历史被过滤光（B2）使回滚能力弱于社区版；兼容性声明与自身 `dshTarget` 矛盾（B3）会在目标宿主上常年挂一条未验证警告；老库 `stage_code` 回填不生效（B4）属清洁度问题、无用户可见影响。

---

## 未验证

| 项 | 原因 |
|---|---|
| `.19` 后端与 `.23` 文件的逐行差异 | `.19` 源码已被安装覆盖，`~/.dsh/dsh-purge/backups` 只保留 plus.2；本文的实机结论标注为 `.19`，文件结论标注为 `.23` |
| B1 在实机 HTTP 上的复现 | 实机靶标数为 0；要在实机走到该分支必须新建靶标并留下数据，超出"只写一个文件"的约束。已在同版本文件上用独立进程复现（命令见 B1） |
| UI 渲染与点击 | 只做静态解析 + 接口级打点，未做浏览器级点击验证；`fullscreen-hook`、`nav-groups` 等新 UI 只核对了组件与 op 存在性 |
| 写类 op（`addVuln`/`savePrompt`/`platformConfigSave`/`platformAssignToolkit`/`probeSessions` 等） | 会改数据或发起网络连接，按只读约束未打；其底层 store 方法在 3.2 的灌数阶段已被间接调用 |
| `probeSessions` / `pivotProbe` 对真实靶标的连通性 | 无靶标；只对关闭端口验证了返回结构（`pivotProbe` 3 ms 返回 `ECONNREFUSED` 矩阵，不挂起） |
| 宿主补丁锚点漂移 | 属 patches 域，不在本次"社区功能覆盖"范围；实机 `patches_applied 85 / pending 0 / skipped 2` |
