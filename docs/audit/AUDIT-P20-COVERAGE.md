# P20 功能覆盖面审计：本包 vs community 1.7.20 vs safe 2.0.0

审计对象：`dsh-purge-plus` 1.7.20-plus.31（构建产物 `dist/build/package/`，已确认与安装目录逐字节一致）
基线：`vendor/community`（1.7.20）、`vendor/safe`（2.0.0）
方式：只读静态抽取 + 对运行中宿主做只读探测；未修改任何源码，未重启宿主。

标记约定：`[静态]` 静态读出；`[实测]` 实际跑过命令 / 发过请求。

---

## 0. 先看这一条：新功能在面板上现在是不生效的（不是代码问题）

`[实测]` 运行中的宿主进程启动于 **22:19:40**，而包文件被替换于 **23:05:06**：

```
$ ps -o pid,lstart -p <host pid>
56259 Fri Nov 20 22:19:40 2026       53:32

$ stat -f "%Sm %N" ~/.dsh/profiles/desktop/node_modules/dsh-purge-plus/lib/redteam/store-core.js
Nov 20 23:05:06 2026
```

于是 `/redteam/api` 打到的是**内存里 22:19 那一版模块**：

```
$ curl -s -X POST http://127.0.0.1:55439/redteam/api -d '{"op":"sessionGraph"}'
{"ok":false,"error":"unknown op: sessionGraph"}      ← 旧模块没有这个分支

$ curl -s ... -d '{"op":"intelStatus"}'
{"ok":true,"resources":[{"key":"kev",...,"stale":true,"missing":true}, ...]}   ← 旧模块已有
```

而磁盘上同一文件里分支是存在的（`store-core.js:825`），且安装副本与构建产物 hash 相同：

```
$ shasum -a256 dist/build/package/lib/redteam/store-core.js ~/.dsh/.../store-core.js
b2f59dee...f5a  dist/build/package/lib/redteam/store-core.js
b2f59dee...f5a  ~/.dsh/profiles/desktop/node_modules/dsh-purge-plus/lib/redteam/store-core.js
```

**结论**：会话关系图、报告文档视图、情报真下载这三项在**当前进程**里全部不可用（面板会显示「读取失败」）。重启宿主即恢复。这不是覆盖缺口，但会让人误判成「没接上」，所以放在最前面。

同时 `[实测]` 确认 `{"op":"__nope__"}` 返回 `unknown op`（不是 `ok:true`），说明 P0 的「未知 op 兜底吞错」修复在旧模块里也已生效：

```
$ curl -s ... -d '{"op":"__nope__"}'
{"ok":false,"error":"unknown op: __nope__"}
```

---

## 1. 总表

| 面 | 本包 | community | safe | 差 | 结论 |
|---|---|---|---|---|---|
| 后端 op（`dispatch` 同步分支，去重） | **91** | 71 | 81 | 两边上游均 **缺 0** | 严格超集 |
| 后端 op（`dispatchAsync` 异步分支） | **2** | 1 | 3 | 两边上游均 **缺 0** | 严格超集 |
| 后端 op 合计 | **93** | 72 | 84 | 缺 0 / 多 21（vs community）、多 9（vs safe） | 严格超集 |
| agent 工具 `redteam_*` | **82** | 64 | 67 | 缺 0 / 多 18、多 15 | 严格超集 |
| HTTP 路由 `/dsh-purge/*`（`index.js` 注册） | **22** | 22 | 14（`/dsh-purge-safe/*`） | 缺 0 | 与 community 全等；safe 14 条全部有对应 |
| `/redteam/api` 桥接 | 1 | 1 | 1 | 0 | 相同 |
| 演练台页签 | **13** | 4 | 12 | 缺 0（多 1：`evidence`） | 超集 |
| 一级分组 `TAB_GROUPS` | **6** | 无此概念 | 6 | 0 | 同构 |
| React 组件（`client.js` 内 `function Xxx(`） | **42** | 26 | 35 | 缺 2（均等价 / 上游死代码） | 等价覆盖 |
| 补丁 id（`ALL_PATCHES` 实测长度） | **93** | **88** | **59** | community 缺 0；safe 按 id 缺 2（#85/#86，已被 #90 取代）；按语义另有 4 条 optional 补丁无落点（§6.3b） | 超集（4 条 optional 见 §10） |
| safe 独有 `lib/` 模块 | 缺 27 个文件 | — | — | 11 个 JS + 16 个 CSS | **真缺口见 §10** |

「缺 0」是硬结论：两侧上游**没有任何一个 op / 工具 / 路由 / 页签 / 补丁 id 在本包里找不到**。

但「id 在」不等于「语义在」。真正的缺口分两类：

1. **接线缺口**（本包自己写的功能没接通）：`cleanup.location` 全链断（§7.4c）、`scoreReport layout='simple'` 无调用方（§7.4a）、`bootstrap stats` 无消费（§7.4b）；
2. **未移植缺口**（safe 有、本包完全没有）：4 条 optional 宿主适配补丁（§6.3b）、safe 的 11 个运行时模块与 16 个 CSS（§9）。

全部按严重度排在 §10。

---

## 2. 后端 op 差集

### 2.1 抽取方法

`[实测]` 用括号配对定位 `dispatch` / `dispatchAsync` 函数体（不是全文件 grep），只在体内抽 `op === '...'` 与 `req.op === '...'`，避免把注释、文档字符串、别的函数里的同名串算进来。

```
pkg       dispatch@L758: 97 处 / 91 uniq ; dispatchAsync@L1289: 2 / 2 uniq
community dispatch@L742: 72 处 / 71 uniq ; dispatchAsync@L876: 1 / 1 uniq
safe      dispatch@L808: 83 处 / 81 uniq ; dispatchAsync@L1025: 3 / 3 uniq
```

### 2.2 双向差集

| 方向 | 结果 |
|---|---|
| community 有、本包无 | **（空）** |
| safe 有、本包无 | **（空）** |
| 本包有、community 无（21 个） | `sessionBinding` `sessionBindings` `bindSessionEngagement` `sessionGraph` `attention` `attentionAck` `evidenceLedger` `dataProofs` `addDataProof` `reportV2` `intelStatus` `intelRefresh` `intelUpdate` `cleanup` `addCleanup` `updateCleanup` `cleanupSummary` `assetCoverage` `hostCoverage` `hostFinding` `coverageSummary` |
| 本包有、safe 无（9 个） | `evidenceLedger` `dataProofs`* `reportV2` `intelUpdate` `cleanupSummary`* `assetCoverage` `hostCoverage` `hostFinding` `coverageSummary` `sessionGraph`（*`dataProofs`/`cleanupSummary` 在 safe 里存在但只作为别 op 的别名分支） |

### 2.3 语义位置核对（不是「有这个名字」而是「在正确的位置」）

| op | 本包行号 | 上游 | 说明 |
|---|---|---|---|
| `bootstrap` | 762 | community 同 | 本包加了 `includeStats: true`（`store-core.js:766`），比 community 多返回每个靶标的 `stats` |
| `sessionBinding` / `sessionBindings` | 788 | safe 同（safe 在 `dispatch` 内） | 全局段，不依赖当前靶标 |
| `bindSessionEngagement` | 814 | safe 同 | 空 `engagement` = 解绑 |
| `sessionGraph` | 825 | **safe 无**（safe 的会话图走宿主 `/api/session/list`） | 本包改成只读本机 `sessions.json` |
| `attention` / `attentionAck` | 857 / 880 | safe 同 | 靶标解析顺序：显式 > 会话绑定 > 指针 |
| `evidenceLedger` | 899 | **safe 无**（safe 的账本在 `bootstrap-runtime`/工具层） | 带 `degraded` 降级：哈希校验失败时退回原始列 |
| `reportV2` | 980 | safe 无（safe 由 `scoreReport` 内部拼） | 独立 op，避免三个时刻拼一份报告 |
| `intelStatus` / `intelRefresh` | 994 / 1001 | safe 在 `dispatchAsync`（`safe:1025` 起） | **本包改成同步、不联网**；只有 `intelUpdate` 才联网 |
| `intelUpdate` | `dispatchAsync:1297` | safe 无 | 唯一联网 op |
| `cleanup` / `addCleanup` / `updateCleanup` / `cleanupSummary` | 1011 | safe 同（safe `dispatch:986` 等） | 见 §7.4c，`location` 在这里丢了 |
| `assetCoverage` / `hostCoverage` / `hostFinding` / `coverageSummary` | 1074 / 1099 / 1124 / 1149 | safe 同 | 统一靶标解析 `covEngagementId()` |
| `probeSessions` | `dispatchAsync:1290` | community 876 / safe 1025 | 唯一三边都有的异步 op |

### 2.4 等价替代判断

`[静态]` 没有「上游有、我们缺」的 op，所以本节无需替代判断。反过来有三处**同名不同实现**，需要知道：

| op | community | 本包 | 差异 |
|---|---|---|---|
| `intelStatus` / `intelRefresh` | 同步，只读 | 同步，只读 | 相同 |
| `intelStatus` / `intelRefresh` | — | — | safe 是 `async`（可能联网），本包拆成「只读」+`intelUpdate`（联网）。这是**语义收紧**，不是缺失 |
| `report` | legacy markdown | legacy + `layout:'simple'` 分支（`store-core.js:5964`） | 见 §7.4a |

---

## 3. agent 工具差集

`[实测]` 抽取 `name: 'redteam_*'`：

```
pkg 82 / community 64 / safe 67
community 有、pkg 无：（空）
safe 有、pkg 无：（空）
```

本包独有的 18 个（相对 community）：`redteam_asset` `redteam_asset_coverage` `redteam_asset_next` `redteam_attention` `redteam_batch` `redteam_cleanup` `redteam_coverage_gaps` `redteam_coverage_summary` `redteam_data_proof` `redteam_host` `redteam_host_coverage` `redteam_host_finding` `redteam_host_findings` `redteam_intel` `redteam_next_action` `redteam_pivot_probe` `redteam_scope_check` `redteam_template_refresh`

本包独有的 15 个（相对 safe）：`redteam_asset_coverage` `redteam_coverage_gaps` `redteam_coverage_summary` `redteam_evidence_list` `redteam_evidence_record` `redteam_evidence_upgrade` `redteam_evidence_verify` `redteam_host_coverage` `redteam_host_finding` `redteam_host_findings` `redteam_intel` `redteam_unknown_list` `redteam_unknown_record` `redteam_unknown_resolve` `redteam_unverified_count`

`[静态]` 注意：`redteam_cleanup` 与 safe 同名但**参数表不同** —— safe 有 `location`（`vendor/safe/lib/redteam/tools.js:2539`），本包没有（`dist/build/package/lib/redteam/tools.js:786-793` 把「具体位置」折进 `target` 的描述里）。这是 §7.4c 那条缺口的工具侧证据。

---

## 4. HTTP 路由差集

### 4.1 `/dsh-purge/*`（`lib/index.js` 注册）

`[实测]` 抽取 `path:` 字面量：

| 包 | 数量 | 集合 |
|---|---|---|
| 本包 | 22 | apply, audit, boost, community, diagnose, drill-grant, hooks-deny, last-user, override, own-servers, probe, restart, revert, rewind, rewind/options, rules, selfcheck, skill, skills, status, uninstall, update |
| community | 22 | **完全相同**（行号整体偏移 +4） |

本包注册行号：`index.js:2034` status、`2107` diagnose、`2140` selfcheck、`2156` boost、`2213` probe、`2234` audit、`2247` hooks-deny、`2278` last-user、`2296` rewind/options、`2314` rewind、`2354` update、`2381` apply、`2523` revert、`2547` uninstall、`2576` drill-grant、`2593` override、`2649` own-servers、`2679` restart、`2945` skills(prefix)、`2948` skill(prefix)、`2961` rules(prefix)、`1547` community。

### 4.2 safe 的 14 条路由

safe 用另一套前缀 `/dsh-purge-safe/*`（`vendor/safe/lib/index.js:2205`–`2904`）：status, rewind/options, rewind, last-user, apply, revert, uninstall, drill-grant, override, own-servers, restart, skills(prefix), skill(prefix), rules(prefix)。

**14 条全部有对应物**（换前缀后与本包 §4.1 的集合重合）。safe 另有三个客户端引用的路径在本包里没有，但它们在 **safe 自己那边也没注册**：

```
vendor/safe/client.js:3430,3442  /dsh-purge-safe/continue/settings
vendor/safe/client.js:5262,5293,5312  /dsh-purge-safe/continue
vendor/safe/lib/core.js:5832     /dsh-purge-safe/host-backups（仅注释）
```

`[实测]` safe `index.js` 里只有 14 处 `kind:` 注册，`continue*` 与 `host-backups` 均不在其中 → 这是 **safe 侧的死路由**，不构成本包缺口。

### 4.3 `/redteam/api`

`[静态]` 三边都是单点注册：本包 `lib/redteam/ui.js:1081`、community `lib/redteam/ui.js:1081`、safe `lib/redteam/ui.js:859`。同一个桥接，无差异。

---

## 5. 演练台页签 / 子视图

### 5.1 页签（13 vs 12）

`[静态]` 本包 `client.js:5805-5816`：

```
overview 工作总览 | assets 资产测绘 | env 环境适配 | agents 智能体 | sessions 会话隧道
findings 漏洞战果 | artifacts 凭据与文件 | evidence 证据账本 | chain 攻击链
scores 得分目标 | report 报告 | knowledge 知识库 | skills 技能库
```

safe `client.js:15888-15899` 是同样 12 项（无 `evidence`，且 `artifacts` 在 `resources` 组）。**12/12 全覆盖 + 1 新增**。

### 5.2 一级分组（6 vs 6）

本包 `client.js:5819-5826`：

| 组 | 页签 |
|---|---|
| 工作总览 | overview |
| 资产台账 | assets |
| 协同进度 | agents |
| 成果与报告 | findings, **artifacts**, **evidence**, chain, scores, report |
| 资源中心 | sessions, knowledge, skills |
| 环境与设置 | env |

与 safe 的唯一结构差异：`artifacts` 从「资源中心」移到「成果与报告」，`evidence` 新增。`TAB_ALIASES`（`client.js:5829`）保住历史深链：`testing→assets`、`attackfiles→artifacts`、`prompts→agents`。

### 5.3 body 分发分支

`[静态]` 本包 `client.js:5912-5949` 共 15 个分支，覆盖 safe `client.js:15941-15971` 的全部 13 个分支，并多出 `evidence`：

```
5912 knowledge | 5913 env | 5914 skills | 5915 agents|prompts | 5923 overview
5940 assets | 5941 testing(别名) | 5942 sessions | 5943 findings | 5944 chain
5945 report→ReportTabPlus | 5946 attackfiles(别名) | 5947 artifacts | 5948 evidence | 5949 scores
```

`testing` / `attackfiles` 两个别名分支是 safe 遗留的死分支（`st.tab` 永不为这两个值，因为 `TAB_ALIASES` 在写状态前就归一了），本包照搬，无害。

### 5.4 子视图（对照 safe 的 19 项，逐条）

| # | safe 子视图 | 本包 | 证据 |
|---|---|---|---|
| 1 | assets 列表 / 主机视图 | ✅ | `client.js:1084`「列表」（safe 的「主机视图」只是同一 view 的合并标签，safe:10841） |
| 2 | assets 发现时间 → DiscoveryView | ✅ | `client.js:1085` + `DiscoveryView` |
| 3 | assets 域名 | ✅ | `client.js:1086` |
| 4 | assets Web / 网站与服务 | ✅ | `client.js:1087`「Web」 |
| 5 | assets 当前测试 TestingTab | ✅ | `client.js:1002` `setView('testing')` |
| 6 | assets 网段视图侧栏 | ✅ | `client.js:996,1016,1030`（C 段侧栏 + 折叠） |
| 7 | 资产详情抽屉 | ✅ | `client.js:1163` `d.ports` / 行展开 `openId` |
| 8 | findings 按目标聚合 / 平铺 | ✅ | `client.js:2612` `grouped` |
| 9 | findings 单条漏洞展开 | ✅ | `client.js:2607` `openId` |
| 10 | chain 链路 A / B | ✅ | `client.js:3048-3049` |
| 11 | chain 单条命中详情 | ✅ | `client.js:2882` 起 |
| 12 | scores 已得分 / 高分缺口 / 全部 | ⚠️ 合并 | 本包 `ScoreTab`（`client.js:3866`）无三视图，改为单表 + 「已得分」列（`client.js:4124`）。数据未丢，切分丢了 |
| 13 | overview 当前得分 / 下一步得分 | ⚠️ 重做 | 本包 `OverviewTab`（`client.js:2035`）是四宫格 + 待办，不再用 safe 的双 tab |
| 14 | report V2 / legacy 平铺 | ✅+ | `client.js:3087` `ReportTab`（legacy）+ `2448` `ReportTabPlus`（条目式/卡片/文档三选一，见 §6.1） |
| 15 | knowledge POC 详情抽屉 | ✅ | `client.js:3394` |
| 16 | skills 技能详情面板 | ✅ | `client.js:1443` |
| 17 | env 运行概况 / 配置 / 高级诊断 | ❌ | 本包 `EnvTab`（`client.js:3665`）是**单页配置表单**（platform/toolkitDir/nucleiTemplatesDir/tools/env），没有 safe 的三段 `settingsSection`（safe:13196,13352） |
| 18 | agents SessionMap 全屏地图 | ⚠️ 换形态 | 本包 `SessionMap`（`client.js:4732`）常驻在 agents 页，无「全屏地图」按钮；全屏能力改为整个面板级（`client.js:5421` `useWorkbenchFullscreen`） |
| 19 | artifacts 三段 `<details>` 折叠 | ✅ | `client.js:1757`（凭据 / 访问会话 / 攻击文件三段） |

**子视图判定：19 项里 15 项完整、3 项形态变化但能力在（#12/#13/#18）、1 项真缺（#17 env 三分页）。**

另：本包多出 4 个 findings 子页签（`client.js:2834-2838`）：`vulns / files / creds / access` —— safe 只有 `vulns`。这是本包比 safe 更细，不是缺口。

### 5.5 组件清单

`[实测]` `function Xxx(` 抽取：本包 42 / safe 35 / community 26。

| 方向 | 组件 | 判定 |
|---|---|---|
| safe 有、本包无 | `Markdown`（safe:629） | **等价替代**：本包 `MarkdownDoc`（`client.js:1925`）带目录、分块加载、代码折叠，safe 只在 report 用过一次（safe:12346） |
| safe 有、本包无 | `ProxySettings`（safe:12745） | **上游死代码**：safe 内 `h(ProxySettings` 出现 0 次，从未挂载 |
| 本包有、safe 无（9） | `AttentionCard` `EvidenceRow` `EvidenceTab` `IntelUpdateButton` `MarkdownDoc` `R2ProofCard` `R2ReproCard` `R2ReproList` `ReportTabPlus` | 本包新增 |
| community 有、本包无 | （空） | — |

---

## 6. 补丁表

### 6.1 数量（`[实测]`：直接 import 构建产物的 `ALL_PATCHES`，不是正则数）

```
$ node -e 'import("./lib/patches/index.mjs").then(m=>console.log(m.ALL_PATCHES.length))'
93
$ cd vendor/community && node -e '...'
88
```

| 包 | `ALL_PATCHES` 长度 | id 段 |
|---|---|---|
| community | **88** | 1–96（缺 20,27,41,44,79,81,85,86） |
| 本包 | **93** | community 88 + `overlay.mjs` 5 条（201,202,203,205,206） |
| safe | **59** | 1–96 的另一套语义 |

### 6.2 community 独有 → 必须保住：**0 条缺口**

`[实测]` 本包的 93 个 id 完全包含 community 的 88 个 id，且同名同义（`dup ids: []`）。这是「基座不能被覆盖」的硬证据。

### 6.3 safe 独有：按 **id** 缺 2 条，按 **语义** 另有 4 条无对应实现

先给结论口径，再给证据 —— 这两件事必须分开数，否则会把「id 撞车」误读成「已覆盖」。

**(a) 按 id 比：59 个 safe id 里只有 2 个在本包不存在**

| safe id | 名称 | 本包 | 判定 |
|---|---|---|---|
| #85 | `SESSION_PROMPT_STEER_INTERRUPT` | 无 | **被 #90 取代**：`patches/index.mjs:19` 注释写明，`lib/steering.js:37` 的 `RESTORE_NATIVE_STEERING` 就是 #90（本包 `ALL_PATCHES` 实测含 id 90） |
| #86 | `SESSION_QUEUE_STEER_INTERRUPT` | 无 | 同上 |

其余 57 个 safe id 在本包都存在（含 #6/#7/#8/#9/#10/#13/#14/#15/#16/#18/#35/#51/#59 这批审批与沙箱补丁 —— 它们**不是**缺口。我第一次用「4 空格缩进 + 紧邻 name」的正则漏掉了带 `permissionOverride: true` 前缀的条目，改用 `ALL_PATCHES` 实测后修正）。

**(b) 按语义比：9 条「撞 id 不同物」里有 5 条另有归属，4 条真的没有**

`[实测]` 拿 safe 那 9 个名字去本包 93 条里按 name 查：

| safe id | safe 名称 | 本包对应 | 判定 |
|---|---|---|---|
| 52 | `SESSION_LOG_CLOUD_UPLOAD_REMOVED` | **#205** `SESSION_LOG_CLOUD_UPLOAD_UNREGISTER`（同文件 `session-log-deepseek`，注册点短路） | ✅ 等价，本包更彻底 |
| 93 | `PRODUCT_ANALYTICS_DEFAULT_OFF` | **#201**（同名） | ✅ 等价 |
| 94 | `PRODUCT_TELEMETRY_OTEL_NOOP` | **#202**（同名） | ✅ 等价 |
| 95 | `SESSION_TELEMETRY_OTEL_DISABLED` | **#203**（同名） | ✅ 等价 |
| 92 | `SUBAGENT_SAME_INJECT_PATH` | **#206** `SUBAGENT_INHERIT_PARENT_ACCESS`（注释直写 "from safe #92"） | ⚠️ **半覆盖**：权限继承那一半搬了，子会话 spawn 时立刻挂 assemble 注入那一半没有 |
| 89 | `SYSTEM_FIELD_EXTRACT` | **无** | ❌ 无对应 |
| 90 | `OPENAI_NATIVE_SYSTEM_ROLE` | **无**（`pi-ai-completions` 上只有 #57，那是 developer→system 角色回退，不是挂针） | ❌ 无对应 |
| 91 | `ANTHROPIC_NATIVE_PARAMS_SYSTEM` | **无**（`pi-ai-anthropic-messages` 上只有 #47/#49 两条 OAuth 补丁） | ❌ 无对应 |
| 96 | `SKILL_OFFICE_ASSET_FALLBACK` | **无**（`skill-office` 目标上本包 0 条补丁） | ❌ 无对应 |

`[实测]` 按 `file:` 目标核对（`ALL_PATCHES` 里 `JSON.stringify(p.file).includes(...)`）：

```
pi-ai-completions:        #57 DEEPSEEK_SYSTEM_ROLE
pi-ai-anthropic-messages: #47 ANTHROPIC_OAUTH_NO_CLAUDE_IDENTITY, #49 ANTHROPIC_OAUTH_CLI_NEUTRAL
skill-office:             （空）
subagent:                 #23, #37, #206
agent-loop:               #55, #67, #68, #74, #87, #88, #90
```

**这 4 条的共同点**：`optional: true` + `skipIfMarked: true`（safe 里都是「宿主没这个行为才打，打了也会被 marker 跳过」）。也就是说它们**不是功能**，是宿主版本适配补丁；缺了不会让某个功能消失，只会让某类宿主在特定路径上少一层兜底。§10 把它们单列成一条 P2，理由见那里。

### 6.4 撞 id 不同物（本包 vs safe，9 条）

同一 id 在两包里是**不同补丁**。两包不同时装不冲突（各自 `already`/marker 判定），但**跨包对照时不能按 id 认**：

| id | 本包 / community | safe |
|---|---|---|
| 52 | `SESSION_LOG_UPLOAD_DEFAULT_OFF` | `SESSION_LOG_CLOUD_UPLOAD_REMOVED` |
| 89 | `ASK_USER_WAIT_CAPPED` | `SYSTEM_FIELD_EXTRACT` |
| 90 | `RESTORE_NATIVE_STEERING` | `OPENAI_NATIVE_SYSTEM_ROLE` |
| 91 | `BROWSER_COOKIE_NAME_IGNORE_PORT` | `ANTHROPIC_NATIVE_PARAMS_SYSTEM` |
| 92 | `HOST_MAX_HTTP_HEADER_SIZE` | `SUBAGENT_SAME_INJECT_PATH` |
| 93 | `SANDBOX_POLICY_BRAND_NEUTRAL` | `PRODUCT_ANALYTICS_DEFAULT_OFF` |
| 94 | `SKILL_BADGE_DESCRIPTION_NEUTRAL` | `PRODUCT_TELEMETRY_OTEL_NOOP` |
| 95 | `INSPECTOR_FRAME_BUDGET_RECORD_OVERHEAD` | `SESSION_TELEMETRY_OTEL_DISABLED` |
| 96 | `INSPECTOR_FRAME_BUDGET_RECORD_OVERHEAD_CLIENT` | `SKILL_OFFICE_ASSET_FALLBACK` |

`overlay.mjs:4` 的注释「id 从 201 起，永不复用 1..96 —— 上游 community 与 safe 在那一段的语义冲突」正是针对这件事，做法正确。**但 §6.3(b) 说明：光「不复用」不够，还要逐条按 name 核对 safe 那 9 个语义有没有落点 —— 其中 4 个没有。**

### 6.5 文档口径已经过期（低）

| 位置 | 写的 | 实际 |
|---|---|---|
| `README.md:94` | 「补丁覆盖 \| 88 条 \| 59 条」 | 本包 **93** 条 |
| `docs/COMPAT.md:493` | 「plus = 社区 88 条 + 201–204」 | 实为 88 + **201/202/203/205/206**（无 204，多 205/206） |

---

## 7. 本轮四项新功能：逐环验证

### 7.1 报告文档视图（ReportV2 → MarkdownDoc）

链路完整，五环齐：

| 环 | 证据 |
|---|---|
| 按钮 | `client.js:2419-2422` `onClick: () => setDoc(!doc)`，文案 `doc ? '卡片视图' : '文档视图'` |
| 状态 + 正文 | `client.js:2311-2312` `const [doc,setDoc]=…`；`const mdText = d.markdown \|\| ''` |
| 渲染 | `client.js:2428` `doc ? h(MarkdownDoc, { text: mdText }) : …`；组件 `client.js:1925` |
| 复制/下载 | `client.js:2313-2330`（`Blob` + `a.download`，文件名按 target 净化） |
| 后端 | op `reportV2` `store-core.js:980`；store 方法返回值带 `markdown`（`store-core.js:3049-3050` 注释「原始 markdown 一并带上：ReportV2 的『下载 .md』用它」） |

`[静态]` 渲染器是自写的（零依赖）：`MD_CHUNK = 400`（首屏只渲 400 块）、`MD_CODE_CLIP = 4000`（代码块折叠）、`mdParseBlocks`/`mdOutline`/`mdInline`。空态文案在 `client.js:1978`。

**结论：接上了，且比 safe 的 `Markdown`（无分块、无目录）更强。**

### 7.2 会话关系图（SessionMap → op sessionGraph → store.sessionGraph）

链路完整，六环齐：

| 环 | 证据 |
|---|---|
| 组件 | `client.js:4732` `SessionMap`，挂载 `client.js:5110`（AgentsTab 内） |
| 取数 | `client.js:4753` `api({ op: 'sessionGraph', session: props.sessionId \|\| '' })` |
| 后端分支 | `store-core.js:825`（全局段，不需靶标；带 `resolveRoot` 解析与 `current` 标记） |
| store 方法 | `store-core.js:3067` `sessionGraph()`（源码 `overlay/snippets/store-session-graph.js:1-40`） |
| 数据源 | 本机 `sessions.json`（绑定）+ `listEngagements()` + `attentionQueue()`（在等谁）。**刻意不直打宿主 `/api/session/list`**（snippet 头注释） |
| 点击切靶标 | `client.js:4807` / `4942` `props.onPick(node.engagement)` → `client.js:5919` `onPick: (id) => { setEng(id); loadSnapshot(id) }` |

`[静态]` 本包还修了 safe 的一个缺陷：**自动刷新与手动刷新分两个序号槽**（`client.js:4743-4745` `autoSeq`/`manualSeq`），safe 共用一个 `AbortController`，轮询在途时点刷新会被静默丢弃。布局算法 `sessionGraphLayout`（`client.js:4639`）。

**结论：接上了。** `[实测]` 但当前进程里返回 `unknown op`（见 §0）。

### 7.3 情报真下载（op intelUpdate → dispatchAsync → store.intelUpdate → 工具 + UI）

链路完整，四环齐：

| 环 | 证据 |
|---|---|
| UI 按钮 | `client.js:2002` `IntelUpdateButton`，`client.js:2008` `api({op:'intelUpdate', target})`，挂载 `client.js:2186`（OverviewTab 情报卡内） |
| 异步分派 | `store-core.js:1297` `if (req.op === 'intelUpdate')` → `store.intelUpdate(...)` |
| store | `store-core.js:2565` `async intelUpdate(target, options)`；`#updateKev` / `#updateNuclei`（`store-core.js:2579` 起） |
| 工具 | `tools.js:838` `redteam_intel`，`action=update` 分支 |

`[静态]` 实现质量（源码 `overlay/snippets/store-intel-net.js`）：大小上限 `max_bytes`（KEV 48MB / nuclei 256MB）+ 超时（120s / 300s）、先落临时文件再 rename、形状校验（`vulnerabilities` 必须是数组且非空且每条有 `cveID`）、`update-log.jsonl` 记版本。`wordlists` 显式拒绝自动下载（「没有权威上游」）。

`[实测]` `intelStatus` 在运行宿主上返回真实探针结果（`kev.json`/nuclei 目录都不存在，`missing:true, stale:true`），说明只读路径不联网、且如实报缺失。

**结论：接上了。**

### 7.4 字段级四项

| # | 字段 | 后端 | 消费者 | 判定 |
|---|---|---|---|---|
| a | `scoreReport layout='simple'` | ✅ `store-core.js:5964-5970`（`delete report.markdown`，`layout:'simple'`，防递归降 `legacy`） | **无** | ❌ **死路径**：本包 `client.js` 无 `layout:'simple'`（`layout` 只出现在 sessionGraph 布局）、`tools.js` 无（只有 `layout` 注释） |
| b | `bootstrap stats` | ✅ `store-core.js:766` `listEngagements({ includeStats: true })` | ⚠️ 半 | 前端拿到 `engagements[]`（`client.js:5677,5684,5707`）但只渲染 `x.name`（`client.js:5996`），`stats` 从不显示 |
| c | `cleanup.location` | ✅ 列存在、INSERT 支持（`store-core.js:2171-2177`） | ❌ **链断** | 见下 |
| d | `getAssetCoverage asset.ports` | ✅ `store-core.js:1777,1790-1795`（按 `asset_id` 现查 port 表） | ✅ 工具 | `tools.js:588`、`tools.js:956`（`redteam_asset_coverage`）取 `store.getAssetCoverage`；UI 只用 `action:'next'`（`client.js:2057`），不读 per-asset ports → **工具可见、面板不可见** |

#### c 项为什么算「链断」而不是「已对齐」

三处都不转发 `location`：

1. **op 不转发**（`store-core.js:1021-1025`）：
   ```js
   store.addCleanup(cid, {
     asset_id: req.asset_id, target: req.target, kind: req.kind, title: req.title,
     detail: req.detail, evidence_ref: req.evidence_ref, priority: req.priority,
     created_by: req.actor,
   })          // ← 没有 location
   ```
2. **工具不转发**（`tools.js:799-803`）：参数表 `tools.js:786-793` 里根本没有 `location`，`target` 的描述是「具体位置（URL / 主机:端口 / 账号名 / 文件路径）」—— 概念被折进 `target` 了。
3. **改也不能改**：`updateCleanup` 的字段白名单 `store-core.js:2241` 是 `['detail','evidence_ref','priority','target','title']`，没有 `location`。

对照 safe：`vendor/safe/lib/redteam/store-core.js:986` 是 `store.addCleanup(id, req.item || req)` —— **整包透传**，所以 safe 能写进去。

后果：`cleanup_item.location` 永远是 `NULL`；ReportV2 第四段「交付清单」的「位置」列（`client.js:2395`）渲染的是 `c.target`，不是 `c.location`。字段加了、表改了、注释写了（`store-core.js:2171`「target 只写『哪台机器』，说不清『删哪个东西』」），但**没有任何一条入口能写**。

---

## 8. 死代码与死按钮

### 8.1 前端 op → 后端分支

`[实测]` 前端 `op: '...'` 去重 55 个；后端 `dispatch` 91 + `dispatchAsync` 2 + `ui.js` 桥接 7（`skillCatalog` `skillRead` `agentsStatus` `setAgentsMax` `version` `updateCheck` `updateApply`）。

**前端调了、后端没有：0 个。** 没有死按钮。

（`ui.js` 的 7 个 op 不走 `store-core`：`skillCatalog/skillRead` 在 `ui.js:691-821`，`agentsStatus/setAgentsMax` 在 `ui.js:906`，`version/updateCheck/updateApply` 在 `ui.js:957`。）

### 8.2 后端有、前端无（46 个）→ 绝大多数是 agent 工具专用

`[实测]` 用「分支内的 `store.X()` 方法是否被 `tools.js` 调用」判定：

| 类别 | op | 结论 |
|---|---|---|
| 写操作（工具专用，设计如此） | `addVuln` `updateVuln` `addCredential` `addAccess` `addWebshell` `updateWebshell` `addTunnel` `updateTunnel` `addHttpEvidence` `addChainStep` `assetTest` `assessAsset` `saveScorePoint` `addScoreHit` `saveStage` `addAttackFile` `import` `savePrompt` `resetPrompts` `shotAdd` `shotDelete` `addCleanup` `updateCleanup` `addDataProof` | ✅ 工具有对应工具（`redteam_vuln_add` 等） |
| 读操作，工具专用 | `graph` `attackGraph` `chain` `report` `reportTargets` `shots` `tunnels` `webshells` `vulnStats` `pocStats` `pocSave` `pocUpdate` `templateStats` `intelRefresh` `cleanup` `dataProofs` `stats` `stages` | ✅ 工具在调（`store.attackGraph` / `store.scoreChain` / `store.listShots` …） |
| **两边都没人调（7 个）** | `pocDelete` `saveStage` `stages` `testStats` `httpEvidence` `cleanupSummary` `string` | ⚠️ **继承的死 op** |

`[实测]` 这 7 个在 community 与 safe 的 `client.js` 里出现次数同样是 **0**（`grep -c "op: '<name>'"` 三边全 0），`tools.js` 也没调 → 不是本包引入的，是上游遗留。危害：`dispatch` 里多 7 个永不可达分支，`READ_OPS`/`WRITE_OPS` 分类表也多维护项。

### 8.3 两个「接了但没消费」的字段

- `bootstrap` 的 `engagements[].stats`（§7.4-b）
- `scoreReport` 的 `layout='simple'`（§7.4-a）

---

## 9. safe 独有模块：逐个定性

`[实测]` 文件级差集（`find lib -type f`）：safe 有 27 个本包没有的文件（11 JS + 16 CSS）；本包多 2 个（`lib/patches/overlay.mjs`、`lib/subagent-fence.js`）。

| safe 模块 | 行数 | 本包 | 判定 |
|---|---|---|---|
| `lib/ui-fullscreen.js` | 288 | `client.js:5421` `useWorkbenchFullscreen`（注释「移植自 safe 2.0.0 的 lib/ui-fullscreen.js」） | ✅ 等价替代 |
| `lib/redteam/kev.js` | 178 | `store-intel-net.js`（KEV + nuclei，带校验与日志） | ✅ 更强 |
| `lib/tool-gate.js` | 129 | `lib/subagent-fence.js`（只搬 `denyDelegation`）；降级部分由补丁 #9/#59 承担（`subagent-fence.js:1-20` 注释） | ✅ 部分替代，理由成立 |
| `lib/subagent-control.js` | 97 | 补丁 #8 `APPROVAL_POLICY_DEFAULT` + #9 `APPROVAL_AUTO_GRANT` | ✅ 等价替代 |
| `lib/redteam/bootstrap-runtime.js` | 666 | schema 由 `store-core.js:6837-6838` 懒建；工具扫描 `platform-config.js` 全量存在（18 个 export 与 safe 逐一对应）；模板下载由 `intelUpdate` 承担 | ⚠️ 部分：**没有「点应用时一次性铺设」入口** |
| `lib/redteam/slot-state.js` | 46 | **无** | ❌ 真缺（有意）：`tools.js:470` 注释「本包没有 parked 概念（名额只按注册表算），所以这一段不移植」 |
| `lib/redteam/team-mode.js` | 258 | **无** | ❌ 真缺：红队根会话不再自动写 `team/mode`，团队任务板回到「用户手动开」 |
| `lib/anchor.js` | 116 | **无**（`ANCHOR_SECTION` 全库 0 命中） | ❌ 真缺：system prompt 尾部没有重锚段 |
| `lib/preset-default.js` | 181 | **无**（`selectedDefault` 全库 0 命中） | ❌ 真缺：停用/卸载后指向本插件预设的 `selectedDefault` 不会被清 |
| `lib/mnemon-settings.js` | 55 | **无**（`keepMnemon` 全库 0 命中） | ❌ 真缺：`keepMnemon` 开关没有落盘实现 |
| `lib/ui-theme.js` + 16 个 CSS | 234 + ~400KB | **无** | ❌ 真缺：safe 的产品皮肤 / 工作台布局 / 主题切换整套没搬 |

---

## 10. 真缺口清单（按严重度）

### P1 — `cleanup.location` 整条链断（功能写了但用不了）

- **缺什么**：`cleanup_item.location` 列存在、INSERT 支持、注释齐全，但 `addCleanup` op（`store-core.js:1021`）、`redteam_cleanup` 工具（`tools.js:786-803`）、`updateCleanup` 白名单（`store-core.js:2241`）三处都不转发它。
- **影响**：交付报告第四段「我们留下了什么」的「位置」列永远是 `target`（机器），说不清「删哪个东西」。safe 侧原本可用（`safe:986` 整包透传）。
- **要碰哪几层**：① op 参数（`store-core.js:1021`）② 工具参数表 + 调用（`tools.js:786-793, 799-803`）③ `updateCleanup` 白名单（`store-core.js:2241`）④ 报告渲染列（`client.js:2395`，把 `c.location || c.target` 显示出来）。**4 层，改动极小（每处 1-3 行）。**

### P1 — 运行中的宿主是旧模块，三项新功能当前不可用（运维，不是代码）

- **缺什么**：进程 22:19:40 启动，包 23:05:06 替换。
- **影响**：会话关系图 / 报告文档视图 / 情报真下载在面板上全部报「读取失败」，容易被误判成没接上。
- **要碰哪一层**：重启宿主。**无需改代码。**

### P2 — 4 条 safe optional 补丁没有落点（宿主适配层，不是功能）

- **缺什么**（§6.3b 的四个「无对应」）：
  - `#89 SYSTEM_FIELD_EXTRACT`（`agent-loop`）：`buildRequest` 把 `role:system` 消息提取到独立 `system` 字段，避免 0.2.0 把系统提示词当对话历史；
  - `#90 OPENAI_NATIVE_SYSTEM_ROLE`（`pi-ai-completions`）+ `#91 ANTHROPIC_NATIVE_PARAMS_SYSTEM`（`pi-ai-anthropic-messages`）：把「挂起提示词」挂进 provider 原生 `messages[0].role=system` / `params.system`。本包有 #87/#88（`agent-loop` 侧的挂针），但 provider 侧这两个落点没有；
  - `#96 SKILL_OFFICE_ASSET_FALLBACK`（`skill-office`）：office-skills 缺 `SKILL.md` 时回退包内 assets，避免桌面 Host ENOENT 起不来。本包在 `skill-office` 上 0 条补丁。
- **影响**：这 4 条都是 `optional:true + skipIfMarked:true`，缺了不会让功能消失，但会在特定宿主版本 / 特定 provider 路径上少一层兜底：#89 影响系统提示词是否被当历史、#90/#91 影响挂针在 OpenAI/Anthropic 通道是否生效、#96 影响装了 office 技能且资产缺失时 Host 能否起来。
- **为什么不是 P1**：无法在不读宿主 `Resources/app` 源码的前提下判定「当前宿主是否真的走这些路径」；它们的设计前提就是「宿主没这个行为才打」。
- **要碰哪几层**：① `lib/patches/new-tools.mjs` 或新建 `overlay.mjs` 条目（4 条 pattern 可从 `vendor/safe/lib/core.js` 对应 id 逐字搬）② `ALL_PATCHES` 编号（需避开已占用的 1–96 与 201–206，建议 207–210）③ 每条都要在真实宿主上跑一次 `patchStatus` 确认 `drifted`/`already`，否则会变成「打了但没生效」。**3 层，风险在于锚点漂移。**

### P2 — safe 的 `preset-default.js` 没搬（卸载后预设悬空）

- **缺什么**：`selectedDefault` 指向 `redteam` 时，停用/卸载不清理。宿主 `resolve()` 对未知预设是硬抛、不回退 `config.default`（safe 注释 #108）。
- **影响**：卸载或停用本插件后，宿主可能起不来 / 预设解析直接抛错，用户得手改配置。
- **要碰哪几层**：① 新增 `lib/preset-default.js`（181 行，可整文件搬）② `lib/uninstall.js` / `lib/presets-plugin.js` 挂调用点 ③ 停用路径（`apply` 的 dispose）。**3 层。**

### P2 — `slot-state.js`（并发名额「让出」）没搬

- **缺什么**：子智能体回报 `waiting`/`blocked` 时主动 park，主会话不算它占名额。
- **影响**：3 个名额上限下，一个在等用户给 key/VPS 的子智能体继续占位，主会话派不出新活。safe 的 `ui.js:753-767` 还会在面板上标「另有 N 个在等人给资源，已让出名额」，本包没有这个提示。
- **要碰哪几层**：① 新增 `lib/redteam/slot-state.js`（46 行）② `tools.js` 的 `redteam_agent_slot`（acquire/release 分支 + `subagent/end` 处 park/unpark）③ `client.js` 的 agents 页计数与文案。**3 层。**（注：`tools.js:470` 已写明是有意不搬，若要补需同步改那段注释。）

### P2 — `anchor.js`（尾部重锚）没搬

- **缺什么**：system prompt 末尾的 `dsh-purge-*:anchor` section + 子会话 context 锚点。
- **影响**：注入正文（~22k 字符）落在 system prompt 最前，宿主后面还有工具描述与运行上下文，模型最后读到的不是我们；子会话还会读到宿主 `subagent:delegation` 那句「需要审批的操作会被自动拒绝」而没有被对消。
- **要碰哪几层**：① 新增 `lib/anchor.js`（116 行）② `apply` 里注册 section/context（注意 scope 要 global）③ 与现有 prompt 补丁的顺序（order）。**3 层，风险中等（动 system prompt 拼装）。**

### P2 — `team-mode.js`（红队会话默认开团队任务板）没搬

- **缺什么**：根会话不写 `team/mode`，`TeamService.isEnabled()` 默认 false，四个 `team_task_*` 工具因 `when` 条件不成立而不进工具目录。
- **影响**：红队会话里团队任务板默认关闭（本会话能见到 `team_task_*` 说明是别的路径开的，不是这个机制）。
- **要碰哪几层**：① 新增 `lib/redteam/team-mode.js`（258 行）② `redteam/index.js` 的 apply 挂一次写入（只写根会话、只写一次）。**2 层。**

### P3 — safe 的皮肤 / 工作台布局整套没搬（16 CSS + `ui-theme.js`）

- **缺什么**：`studio-skin.css` `workspace-skin.css` `product-shell.css` `glass-skin.css` `unified-layout.css` `unified-components.css` `workbench-layout.css` `responsive-dock.css` `overview-workbench.css` `assets-view.css` `collaboration-view.css` `sessions-view.css` `settings-view.css` `skills-view.css` `detail-surfaces.css` `ui-theme.css` + `ui-theme.js`（234 行，三档主题 dusk/white/system）。
- **影响**：纯视觉与布局。本包 `client.js` 自带 530 行内联 CSS，功能不受影响，但 safe 的「产品级外壳」观感没有。
- **要碰哪几层**：① 16 个 CSS 进构建 ② `ui-theme.js` 注入 ③ `client.js` 的 `apply` 挂 `<style>` ④ 类名对齐（safe 用 `dshp-*`，本包 0 命中，等于要重写选择器）。**4 层，工作量最大的一项。**

### P3 — `bootstrap-runtime.js` 的「一次性铺设」入口没有

- **缺什么**：schema 已懒建（`store-core.js:6837`）、工具扫描已全量（`platform-config.js` 18 export 与 safe 一致）、模板下载已由 `intelUpdate` 承担；缺的是 safe 那种「点应用就把知识库目录/工具箱/nuclei 模板一次性铺好」的编排。
- **影响**：首次使用时目录要等第一次 `db()` / 第一次 `intelUpdate` 才出现；离线机器上模板库为空且没有提示。
- **要碰哪几层**：① 新增编排模块（可从 safe 裁剪掉 `node:sqlite` 依赖部分）② `redteam/index.js` 的 apply 或「环境适配」页按钮。**2 层。**

### P3 — `mnemon-settings.js`（`keepMnemon`）没搬

- **影响**：safe 的「保留 mnemon 记忆」开关在本包没有落盘实现（全库 `keepMnemon` 0 命中）。
- **要碰哪几层**：① 新增 55 行模块 ② `core.js` 读取处 ③ 设置页勾选。**3 层，收益低。**

### P3 — `scoreReport layout='simple'` 无调用方

- **缺什么**：后端分支在（`store-core.js:5964-5970`），前端与工具都不传 `layout`。
- **影响**：这条「字段级对齐」目前是死路径。`[实测]` 无靶标时 `{"op":"scoreReport","layout":"simple"}` 直接落到通用空壳 `{ok:true,items:[],total:0,stats:null,…}`（连 `layout` 都不回显）。
- **要碰哪几层**：① 工具 `redteam_report`（`tools.js:2655` 附近）加 `layout` 参数 ② 或前端 ReportTab 传 `layout:'simple'`。**1 层。**

### P3 — `bootstrap stats` 无消费

- **缺什么**：`includeStats:true` 白算（`store-core.js:766`），前端只用 `x.name`（`client.js:5996`）。
- **影响**：靶标下拉框看不到「资产 12 / 漏洞 3」，用户仍要切进去才知道规模。
- **要碰哪几层**：① `client.js:5996` 的 `<option>` 文案（1 行）。**1 层。**

### P3 — 7 个继承的死 op

- **清单**：`pocDelete` `saveStage` `stages` `testStats` `httpEvidence` `cleanupSummary` `string`。
- **影响**：`dispatch` 多 7 个不可达分支；`READ_OPS`/`WRITE_OPS` 多维护项；未来改签名时容易漏。
- **要碰哪几层**：① `store-core.js` 的 dispatch 分支 ② `READ_OPS`/`WRITE_OPS` 集合 ③ `store.js` 里对应方法（若无调用可一并删）。**1-3 层，纯清理。**

### P3 — 文档口径过期

- `README.md:94`「88 条」→ 实为 **93**。
- `docs/COMPAT.md:493`「201–204」→ 实为 **201/202/203/205/206**。

---

## 11. 我没能验证的

1. **本包的 93 个 op 在「有靶标」时的实际返回** —— 宿主里 `engagements: []`，所有需要靶标的 op 都停在守卫错误上。`cleanup.location` 的「永远 NULL」是**静态推导**（三处都不转发），没有实建一条记录来证明。要闭合得建靶标（写操作），按只读纪律没做。
2. **safe 的 19 个子视图我是按本仓库既有审计 `docs/audit/06-safe-redteam-ui.md:917-941` 的清单对照的**，没有重新逐条读 safe 的 16,247 行。若那份清单有遗漏，本节的对照也会跟着漏。
3. **safe 的 `ALL_PATCHES` 是用正则从 `vendor/safe/lib/core.js` 抽的（59 个 id）**，没有 import（safe 的 core.js 依赖宿主包，import 会拉一堆东西）。id 数 59 与任务书给的 59 一致，可信。**但 safe 侧的 `name` 与 `replacement` 内容我只读了 §6.3b 那 6 个（52/89/90/91/92/96）的正文，其余 53 个只比了 name。** 如果某个同名补丁的 pattern 与 community 版不同（例如 safe 改了锚点），本报告会判成「等价」而实际不等价 —— 这一层没查。
4. **`bootstrap-runtime.js` 与 `kev.js` 的「等价」判定是基于导出符号与调用点比对**，没有逐行读 666 行实现。可能有细节行为差异。
5. **皮肤层（16 CSS）没有评估「本包内联 CSS 是否已覆盖同等视觉」**，只确认了 `dshp-*` 类名在包内 0 命中。
6. **没有验证 `dist/build/package` 与 `vendor/*` 的构建可复现性**（即「跑一次 build 是否得到同一份 dist」），那是另一条线。
