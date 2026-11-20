# 07 · safe 2.0.0 演练台后端全量审计

> 快照：`vendor/safe/lib/redteam/`，审计时间 2026-11-20。
> 只读审计，未修改任何代码。唯一写入物是本文件与 `07-safe-redteam-tables.json`。
> 标记：`[静态]` = 读源码得出；`[实测]` = 在本机 `node v26.13.1` 里实际 import / 调用 / 请求验证过（临时目录 `/tmp/rt*-*`，未触碰仓库）。

---

## 0. 读前须知：任务书里有两个前提不成立

| 任务书前提 | 实际 | 证据 |
|---|---|---|
| 「`vendor/safe/lib/redteam/` 下全部 24 个文件」 | 该目录共 **34 个文件**：21 个 `.js` + 13 个 `.css`。后端范围是 21 个 `.js`（含浏览器半侧 `client.js`），服务端只有 20 个 | `ls vendor/safe/lib/redteam/` `[实测]` |
| 「`atomic-write.js` + `evidence-ledger.mjs` 等」 | **这两个文件不在 safe 里**，只存在于 `vendor/community/lib/redteam/` 与 `dist/build/package/lib/redteam/`。safe 把落盘改成了直接 `writeFileSync`，没有原子写层，也没有证据账本 | `find . -name 'atomic-write*' -o -name 'evidence-ledger*'` 命中 4 处，全部在 community/dist `[实测]`；safe 侧 `grep -rn atomic-write vendor/safe` 零命中 `[静态]` |

**这条差异有实质后果**：safe 的 `sessions.json`、`settings.json`、`config.json`、`engagement.yaml` 全部是「读全文 → 改内存 → 整文件覆写」，进程崩在写一半就是半个 JSON。第 8 节按风险单列。

另外，safe 比 community **多 4 个文件**：`bootstrap-runtime.js`、`kev.js`、`slot-state.js`、`team-mode.js`。

---

## 1. 模块清单

行数以 `wc -l` 为准。加载方式分三层，由 `vendor/safe/cordis.patch.yml` 与 `vendor/safe/presets/redteam/agent.cordis.yml` 决定：

- **host 平面**（`cordis.patch.yml:72-83`）：`redteam`（= `lib/redteam/index.js`）、`redteam/store`、`redteam/ui`
- **preset 平面**（`presets/redteam/agent.cordis.yml:183-184`）：`redteam/tools`
- **被 import 的库模块**：其余全部

| 文件 | 行数 | 一句话职责 | 是否被 index.js 加载 |
|---|---|---|---|
| `index.js` | 1128 | host 插件入口：铺预设、铺技能、铺 `setup.sh`、把 `redteam` 预设注册进 `agentPresets`、装 team-mode、异步拉起 bootstrap | 自身 |
| `store.js` | 88 | Cordis 插件壳：解析数据根（`config.root` → `REDTEAM_HOME` → `$DSH_HOME/redteam`），`ctx.provide('redteam', store)` | 否（独立 host 插件行） |
| `store-core.js` | 7296 | 全部业务：`dispatch` 分发、`RedteamStore` 类（约 130 个方法）、默认提示词、得分规则正文 | 否（被 store.js import） |
| `tools.js` | 2579 | 67 个 agent 工具 + 进程内绑定表 `bindings` + 并发预留 `reservations` + `subagent/end` 钩子 | 否（独立 preset 插件行） |
| `ui.js` | 949 | `POST /redteam/api` HTTP 桥；另挂 `agent/pre-step` 环境门禁；转发 9 个 UI 私有 op | 否（独立 host 插件行） |
| `schema.js` | 782 | 全部 DDL（靶标库 / 知识库 / FTS5）+ 增量迁移 + FTS5 能力探测 + POC 归类表 | 否（被 store-core / bootstrap-runtime import） |
| `score-rules.js` | 936 | 计分判定唯一实现：去重口径、规则封顶、倍率、25 条默认得分点、得分确认清单 | 否（被 store-core / schema import） |
| `validate.js` | 67 | 写库前校验：马类型/状态枚举、`assertPathWithin` 目录穿越防护 | 否（被 store-core import） |
| `platform-config.js` | 633 | 环境适配：`config.json` 读写、工具 PATH 探测、工具箱文件夹扫描与分配、`envAdaptStatus` | 否（被 store-core / bootstrap-runtime / role-section import） |
| `bootstrap-runtime.js` | 666 | 启动期铺数据目录：建 knowledge.db、找/下载/刷新 nuclei 模板、写 config、kick KEV | **是**（`index.js:962` 动态 `import()`） |
| `kev.js` | 178 | CISA KEV 公告层：拉取、落盘、TTL 24h、按 CVE 查 | 否（被 bootstrap-runtime / store-core 动态 import） |
| `slot-state.js` | 46 | 进程内「挂起」集合：`rootId → Set<childId>`，让等资源的智能体让出并发名额 | 否（被 tools.js / ui.js import） |
| `team-mode.js` | 258 | 给红队根会话补写 `team/mode {enabled:true}`，让官方四个 `team_task_*` 工具出现 | **是**（`index.js:15`） |
| `preset-composition.js` | 403 | 一个手写 YAML 子集解析器 + `readPresetDefinition`，把 `agent.cordis.yml` 读成 registry 能吃的结构 | **是**（`index.js:14`） |
| `skill-fixes.js` | 539 | 随包技能的可用性修补（路径/前置条件改写） | 否（被 skill-availability import） |
| `skill-availability.js` | 372 | 技能「本机能不能真用」判定：展开 `~`、按平台筛路径、抽 frontmatter | 否（被 ui.js import） |
| `role-section.js` | 177 | 子智能体角色提示词注入：从 `agent/inbox/claimed` 抓 `redteamRole:` 标记，回读 `<靶标>/agents/<role>.md` | 否（被 index.js 之外的 host 侧 import） |
| `report-replay.js` | 209 | 报告里的「可复现」生成：`parseCurl`/`buildHttpRequest`/`buildCurlCommand`/`fillTemplate` | 否（被 store-core import） |
| `ip-utils.js` | 140 | IP 工具：`ipToInt`/`cidrOf`/`isIpv6`/`expandIpv6`/`scopeOfIp`/`slugify`/`slugTarget`/`slugPoc`/`nowIso` | 否（被 store-core / score-rules import） |
| `settings.js` | 77 | 唯一一项插件设置：并发执行智能体上限（`settings.json` → env → 默认 3） | 否（被 tools.js / ui.js import） |
| `client.js` | 16247 | 浏览器半侧（`__ModuleLoader__` 手写 bundle），只在本审计的「UI 触点」一节引用 | 否（浏览器加载） |

**关键结构判断**：`store-core.js` 一个文件承担了「数据层 + 业务层 + 提示词正文 + 分发表」四件事。其中 `store-core.js:503-793`（约 290 行）是 `DEFAULT_PROMPTS` 的六段中文提示词正文（行内是长字符串，实际字节占比更高），不是逻辑。

---

## 2. 数据模型

### 2.0 目录树（全部路径都在 `$DSH_HOME/redteam` 下，除非另注）

```
$DSH_HOME/redteam/                       ← store.root（store.js:29-34）
├── current                              ← 全局「当前靶标」指针，纯文本，内容是靶标 id
├── sessions.json                        ← 会话→靶标绑定表（v1）
├── settings.json                        ← { maxAgents }
├── config.json                          ← 环境适配（platform-config.js:54-81）
├── preset-declare.json                  ← index.js 写预设注册进度（index.js:976-985）
├── bootstrap.log                        ← bootstrap-runtime 的追加日志（bootstrap-runtime.js:56-61）
├── cors-reject.log                      ← /redteam/api 403 记录（ui.js:398-408）
├── setup.sh                             ← installSetupScript 落地（index.js:71-113）
├── knowledge.db                         ← 跨靶标共享知识库（store-core.js:5300）
├── kb/cve-kev.json                      ← KEV 公告缓存（kev.js:29-31）
├── pocs/                                ← POC 正文落盘（store-core.js:5436）
│   └── .nuclei-index.json               ← nuclei 模板索引缓存（store-core.js:5343）
├── toolkit/                             ← 工具箱根（platform-config.js:27）
│   ├── .nuclei-templates.lock           ← 刷新互斥锁（bootstrap-runtime.js:567）
│   └── nuclei-templates/                ← 模板库
├── skills/                              ← 随包技能同步目标（index.js:189-）
└── engagements/<slug>/                  ← 每个靶标一个目录（store-core.js:1180）
    ├── engagement.yaml                  ← 靶标元数据（store-core.js:1181）
    ├── assets.db                        ← 该靶标的 SQLite 事实库（store-core.js:1182）
    ├── agents/                          ← 角色提示词
    │   ├── <role>.md                    ← plan/recon/assess/vuln-scan/exploit/internal
    │   └── .defaults.json               ← 默认提示词指纹清单（store-core.js:6128）
    ├── runs/                            ← 证据文件（智能体按约定写；store 只在此存档 legacy-score）
    ├── reports/                         ← 报告落盘（只建目录，store 不写）
    ├── shots/                           ← 截图（store-core.js:5029）
    └── attack-files/                    ← 生效的攻击脚本（store-core.js:5219）
```

`openEngagement` 会一次性建 `agents`/`runs`/`reports` 三个子目录（`store-core.js:1250`），`shots`/`attack-files` 是首次写入时才建（`store-core.js:5043`、`5226`）。

> 本节所有实体的机器可读版本见同目录 `07-safe-redteam-tables.json`（45 个实体 / 443 个字段，含 `writer`/`reader`/`constraints`/`retention`）。

### 2.1 `assets.db` —— 每个靶标一个库（`schema.js:67-448`）

`[实测]` 建库后实际存在的表：`access_session, agent_report, asset, asset_coverage, asset_fts(+4 个 FTS 影子表), asset_name, attack_file, attack_step, cleanup_item, credential, data_proof, edge, fingerprint, host_coverage, host_finding, http_evidence, observation, port, scan_run, score_hit, score_point, segment, service, shot, stage, tag, tunnel, vuln, webshell`；视图：`v_asset_summary`、`v_asset_service`。

| 表 | 字段（名:类型 默认） | 谁写 | 谁读 | 生命周期 |
|---|---|---|---|---|
| `scan_run` | `id` PK、`agent_session_id`、`tool`、`argv`、`started_at`、`finished_at`、`status`='running' | `importBundle`（`store-core.js:6045`） | `report` | 每次 `import` 一行，永不清理 |
| `segment` | `cidr` PK、`ip_start`、`ip_end`、`org`、`asn`、`country`、`city`、`source`、`first_seen`、`last_seen` | `#upsertSegment`（`5982`） | `graph`、`listSegments`（`1408`） | 按 cidr upsert |
| `asset` | `id` PK、`segment_cidr` NOT NULL、`ip` NOT NULL、`ip_int`、`state`='unknown'、`primary_name`、`confidence` REAL、`first_seen`、`last_seen`、`discovered_at`、`test_status`='untested'、`test_notes`、`test_surface`、`test_updated_at`、`test_updated_by`、`blocked_count`=0、`priority`、`potential`、`assess_reason`、`assessed_at`、`assessed_by`、`scope`；UNIQUE(`segment_cidr`,`ip`) | `#upsertAsset`（`5982`）、`updateAssetTest`（`2810`）、`assessAsset`（`2786`） | 几乎全部查询 | upsert；`discovered_at` 首次写入后不再刷新（`schema.js:586-588`） |
| `asset_name` | `id`、`asset_id` NOT NULL、`name` NOT NULL、`kind`、`provenance`、`tool`、`first_seen`、`last_seen`；UNIQUE(`asset_id`,`name`,`kind`) | `#upsertAsset` | `assetRow`（`1469`） | upsert |
| `port` | `id`、`asset_id` NOT NULL、`proto`='tcp'、`port` NOT NULL、`state`='open'、`provenance`、`tool`、`banner`、`url`、`title`、`first_seen`、`last_seen`；UNIQUE(`asset_id`,`proto`,`port`) | `#upsertAsset` | `hostNextActions`、`graph` | upsert |
| `service` | `id`、`port_id` NOT NULL、`name`、`product`、`version`、`cpe`、`provenance`、`tool`、`first_seen`、`last_seen` | `#upsertAsset` | `v_asset_service` | 每次 import 追加 |
| `fingerprint` | `id`、`asset_id` NOT NULL、`port_id`、`category`、`vendor`、`product`、`version`、`evidence`、`confidence` REAL、`provenance`、`tool`、`first_seen`、`last_seen` | `#upsertAsset`（`6085`） | `assetRow` | 每次 import 追加 |
| `observation` | `id`、`entity_kind` NOT NULL、`entity_id` NOT NULL、`attr`、`value`、`provenance`、`tool`、`scan_run_id`、`collected_at`、`raw_ref` | `#observe`（`6002`） | `v_asset_summary` 的 passive/active 计数 | 追加，无上限 |
| `edge` | `id`、`src_kind`、`src_id`、`dst_kind`、`dst_id`、`relation`、`confidence` REAL、`scan_run_id`、`first_seen`、`last_seen`；UNIQUE 五元组 | `#edge`（`6010`） | `graph` | upsert |
| `tag` | `entity_kind`+`entity_id`+`tag` 复合 PK、`note`、`created_by`、`created_at` | 无 store 方法写（只有 DDL） | 无 | — |
| `vuln` | `id`、`asset_id`、`port_id`、`cve`、`title`、`severity`、`source`、`confidence` REAL、`status`、`evidence`、`target`、`found_by_agent`、`found_at`、`gained`、`agent` | `addVuln`（`2866`）、`updateVuln`（`2935`） | `vulnStats`、`report`、`attackGraph` | 带 cve 时按 (`asset_id`,`cve`,`target`) 幂等更新 |
| `score_point` | `id`、`code` UNIQUE、`name` NOT NULL、`category`、`points`=0、`max_hits`=1、`description`、`enabled`=1、`sort_order`=0、`created_at`、`updated_at`、`src`、`rule`、`tier`、`cap`=0、`dedup_scope`='service'、`legacy`=0、`builtin`=0 | `seedScorePoints`（`2200`）、`saveScorePoint`（`2555`）、`deleteScorePoint`（`2613`） | `listScorePoints`（`2311`） | 首次读/记分时播种 25 条内置点（`[实测]` 新建靶标 25 行，`builtin=1` 25 行） |
| `stage` | `code` PK、`name` NOT NULL、`subtitle`、`color`、`goal`、`sections`（JSON 文本）、`tools`、`transition`、`sort_order`=0、`updated_at` | `seedStages`（`2144`）、`saveStage`（`2176`） | `listStages`（`2162`） | **懒播种**：`openEngagement` 不建，首次 `listStages`/`listScorePoints` 才建（`[实测]` open 后 `stage` 0 行，调 `listStages` 后 5 行：`recon/internet/boundary/internal/target`） |
| `score_hit` | `id`、`point_id` NOT NULL、`asset_id`、`vuln_id`、`step_id`、`target`、`evidence`、`note`、`self_created`=0、`port`、`recorded_by`、`recorded_at`、`points`、`multiplier`=1、`stage_code` | `addScoreHit`（`2649`） | `scoreReport`、`scoreChain`、`listScorePoints` | 追加；封顶只影响计分不改行 |
| `credential` | `id`、`asset_id`、`host`、`username`、`secret_type`、`secret_value`（**明文**）、`secret_ref`、`privilege`、`source`、`tool`、`note`、`found_by_agent`、`found_at`、`agent`；UNIQUE(`host`,`username`,`secret_type`) | `addCredential`（`2968`） | `listCredentials`、`consoleDigest` | upsert |
| `access_session` | `id`、`asset_id`、`host`、`username`、`method`、`privilege`、`session_ref`、`note`、`found_by_agent`、`obtained_at` | `addAccess`（`3005`） | `listAccess` | 追加 |
| `webshell` | `id`、`asset_id`、`url` NOT NULL、`shell_type`、`pass_key`、`secret_ref`、`privilege`、`status`='unknown'、`last_check`、`check_note`、`latency_ms`、`note`、`found_by_agent`、`created_at`、`updated_at`、`agent`；UNIQUE(`url`,`pass_key`) | `addWebshell`（`3035`）、`updateWebshell`（`3071`）、`probeSessions`（`4725`） | `listWebshells` | upsert + 探测回写状态 |
| `tunnel` | `id`、`asset_id`、`webshell_id`、`kind`、`listen`、`entry`、`reach`、`entry_kind`、`status`='unknown'、`last_check`、`check_note`、`latency_ms`、`pid`、`command`、`note`、`found_by_agent`、`created_at`、`updated_at`、`agent` | `addTunnel`（`3102`）、`updateTunnel`（`3150`）、`probeSessions`（`4762`） | `listTunnels` | 同上 |
| `http_evidence` | `id`、`vuln_id`、`asset_id`、`label`、`method`='GET'、`url`、`status` INTEGER、`request`、`response`、`note`、`captured_by`、`captured_at` | `addHttpEvidence`（`4860`） | `listHttpEvidence`（`4942`）、`scoreReport` 的兜底归因 | 追加 |
| **`data_proof`** | `id`、`asset_id`、`vuln_id`、`target`、`source`、`interface`、`fields`（逗号串）、`row_count` INTEGER、`sample`、`query`、`evidence_ref`、`pii_type`='pii'、`note`、`created_by`、`created_at` | `addDataProof`（`4873`） | `listDataProofs`（`4888`）；**面板无调用方**（第 5 节） | 追加 |
| `cleanup_item` | `id`、`kind`、`target`、`location`、`detail`、`status`='open'、`created_by`、`created_at`、`updated_at` | `addCleanup`（`4906`）、`updateCleanup`（`4931`） | `listCleanup`（`4917`） | 追加 + 状态更新 |
| `attack_file` | `id`、`target` NOT NULL、`target_kind`、`name` NOT NULL、`kind`、`path` NOT NULL、`description`、`evidence`、`asset_id`、`vuln_id`、`created_by`、`created_at`；UNIQUE(`target`,`name`) | `addAttackFile`（`5226`） | `listAttackFiles`（`5262`）、`attackFileTree`（`5273`） | upsert |
| `attack_step` | `id`、`seq`、`stage`、`title`、`detail`、`asset_id`、`vuln_id`、`access_id`、`point_id`、`evidence_ref`、`tool`、`agent`、`result`、`recorded_by`、`recorded_at`、`stage_code` | `addChainStep`（`4959`） | `listChain`（`5017`）、`consoleDigest` | 追加 |
| `shot` | `id`、`point_id`、`hit_id`、`asset_id`、`vuln_id`、`target`、`label`、`note`、`file` NOT NULL、`kind`='screenshot'、`mime`、`bytes`、`width`、`height`、`sha256`、`source_ref`、`captured_at`、`found_by_agent`、`agent`、`created_at`；UNIQUE(`file`) | `addShot`（`5043`）、`deleteShot`（`5134`） | `listShots`（`5108`）、`readShot`（`5151`） | 文件落 `shots/`，库里只存文件名与元数据 |
| `asset_coverage` | `id`、`asset_id` NOT NULL UNIQUE、`surface`='untested'、`web`、`auth`、`cve`、`app`、`status`='open'、`blocked_reason`、`note`、`updated_by`、`updated_at` | `#ensureAssetCoverage`（`1797`）、`updateAssetCoverage`（`1820`）、`closeAssetCoverage`（`1835`） | `assetNextActions`（`1854`） | 首次读即建行（`INSERT OR IGNORE`） |
| `host_coverage` | `id`、`asset_id` NOT NULL UNIQUE、`access`='none'、`files`='untested'、`credentials`=0、`privesc`、`web`、`db`、`lateral`、`status`='open'、`blocked_reason`、`updated_by`、`updated_at` | `#ensureCoverage`（`1629`）、`updateHostCoverage`（`1675`）、`closeHostCoverage`（`1720`） | `hostNextActions`（`1738`） | 同上 |
| `host_finding` | `id`、`asset_id` NOT NULL、`kind` NOT NULL、`title`、`detail`、`evidence_ref`、`created_by`、`created_at` | `addHostFinding`（`1697`） | `getHostCoverage` | 追加 |
| **`agent_report`** | `id`、`session_id` NOT NULL、`parent_session`、`role`、`label`、`status` NOT NULL、`blocked_reason`、`needs`（JSON 文本）、`summary`、`created_at`、`acknowledged_at` | `recordAgentReport`（`1970`） | `attentionQueue`（`2058`）、`latestAgentReports`（`2035`） | **每会话只留最近 20 条**（`1991` 的 DELETE）；`acknowledged_at` 一旦写上不再清 |

**哪些列不在 `DDL` 里**：上表中带「迁移列」性质的字段全部由 `migrate()` 补（`schema.js:554-749`，先 `PRAGMA table_info` 再 `ALTER TABLE ADD COLUMN`，可重复执行）。重实现时若只照 `DDL` 建表，会缺这些列：

| 表 | 迁移补的列 | 行号 |
|---|---|---|
| `vuln` | `target`、`found_by_agent`、`found_at`、`gained`、`agent` | `schema.js:570-572`、`591`、`602` |
| `port` | `url`、`title` | `573-574` |
| `asset` | `test_status`、`test_notes`、`test_surface`、`test_updated_at`、`test_updated_by`、`blocked_count`、`priority`、`potential`、`assess_reason`、`assessed_at`、`assessed_by`、`discovered_at`、`scope` | `575-585`、`588`、`600` |
| `credential` | `secret_value`、`agent` | `592`、`604` |
| `webshell` / `tunnel` | `agent`；`tunnel` 另有 `entry_kind` | `593-594`、`673` |
| `attack_step` | `tool`、`agent`、`result`、`stage_code`、`point_id` | `596-598`、`629`、`674` |
| `agent_report` | `acknowledged_at` | `607` |
| `score_point` | `src`、`rule`、`tier`、`cap`、`dedup_scope`、`legacy`、`builtin` | `612-620` |
| `score_hit` | `multiplier`、`points`、`vuln_id`、`step_id`、`stage_code`、`self_created`、`port` | `622-628`、`656-661` |

`migrate()` 还有两段**数据修复**而非加列：① 删掉已作废的旧阶段行（`schema.js:631-636`），② 给 `score_hit.port` 为空的命中按 `target` 回填端口（`662-671`）。

索引共 41 条在 `schema.js:389-435` 这一段里；全文件 49 条 `CREATE INDEX`，其余 8 条分别在知识库 DDL（`ix_poc_cve`/`ix_poc_component`/`ix_poc_kind`，`483-485`）、`migrate()` 里的 `ix_agent_report_*`（`738-739`）、`migrateKnowledge()` 里的 `ix_poc_category`/`ix_poc_engagement`（`772-773`）。与本节强相关的：
`ix_agent_report_session(session_id)`、`ix_agent_report_parent(parent_session,id)`、`ix_score_hit_point`、`ix_score_hit_time(recorded_at,id)`、`ix_http_url`。

**FTS5 降级**：`asset_fts` 与 `poc_fts` 单独导出（`schema.js:53-63`），只有 `HAS_FTS5` 为真时才拼进 DDL（`store-core.js:1202`、`bootstrap-runtime.js:502`）。探测方式是 `:memory:` 库上试建 `fts5(x)`（`schema.js:31-44`），并留 `REDTEAM_NO_FTS5=1` 强制降级。`[实测]` 本机 `HAS_FTS5=true`。

### 2.2 `knowledge.db` —— 跨靶标共享（`schema.js:452-489`）

| 表 | 字段 | 谁写 | 谁读 |
|---|---|---|---|
| `poc` | `id`、`code` NOT NULL（UNIQUE）、`title` NOT NULL、`kind`(poc/exp/script/template/payload)、`category`(14 类，`schema.js:499-514`)、`cve`、`component`、`versions`、`severity`、`language`、`source`、`source_url`、`description`、`usage`、`content`、`path`、`verified`=0、`verified_note`、`hit_count`=0、`used_on`、`engagement_id`、`engagement_name`、`asset_target`、`found_by_agent`、`tags`、`created_by`、`created_at`、`updated_at` | `savePoc`（`5465`）、`updatePoc`（`5620`）、`markPocUsed`（`5610`）、`deletePoc`（`5667`）、`migrateKnowledge`（`757`） | `searchPocs`（`5538`）、`getPoc`（`5590`）、`pocStats`（`5686`） |
| `poc_fts` | `poc_id` UNINDEXED、`title`、`cve`、`component`、`versions`、`tags`、`description`、`content` | `#reindexPoc`（`5451`） | `searchPocs` 的 FTS 分支 |

注意 `schema.js:486-488` 的注释：`category`/`engagement_id` 两个索引**不能**写进 `KNOWLEDGE_DDL`，否则老库在 `exec(DDL)` 阶段就抛 `no such column`，连补列都跑不到；它们在 `migrateKnowledge` 补完列后才建（`772-773`）。

### 2.3 `sessions.json` —— 会话→靶标绑定（`store-core.js:1117`）

```json
{ "v": 1,
  "agents": { "<根会话 id>": { "engagement": "<靶标 id>", "name": "<展示名>", "at": "<ISO>" } } }
```

| 项 | 值 |
|---|---|
| 路径 | `join(root, 'sessions.json')`（`store-core.js:1117`） |
| 只记根会话 | `store-core.js:1122-1123` 注释；写入方 `recordSessionBinding` 用 `rootId || sessionId` 作键（`tools.js:294-299`） |
| 读容错 | 文件缺失 / 半截 JSON / `agents` 不是对象 → 一律当 `{}`（`1127-1128`）；单条缺 `engagement` 直接跳过（`1132-1133`） |
| 写策略 | 先 `sessionBindings()` 读全量 → 内存 merge 一条 → 按 `at` 倒序取前 **200** 条 → 再剔掉指向已删靶标的条目 → 整文件覆写（`1166-1174`） |
| 写失败 | `writeFileSync` 抛错 → `return false`，不抛给调用方（`1173-1176`） |
| 校验 | `sessionId` 非空字符串、`engagement` 非空字符串、且 `dbPathOf(engagement)` 必须存在（`1163-1165`）——**绑定不存在的靶标会被静默拒绝** `[实测]` `setSessionBinding('S3','nope') === false` |
| 并发 | 无锁、无原子写。两个进程同时写会后者覆盖前者（第 8 节 R-03） |

### 2.4 `current` —— 全局指针

纯文本一行，内容就是靶标 id（目录名）。写：`setActiveEngagement`（`store-core.js:1107-1112`，先校验 `dbPathOf(id)` 存在，否则 `return false` 不写）。读：`activeEngagementId`（`1097-1104`，读不到或指向的库不存在时**回落到 `listEngagements()[0].id`**，而 `listEngagements` 按 `created_at` 倒序，即「最近创建的」）。

### 2.5 `engagement.yaml` —— 靶标元数据

不是真 YAML，是「`key: value` 一行一条」的扁平文本（`store-core.js:189-212`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `target_name` | string | 用户给的单位名 |
| `scope_cidrs` | string[] | 写成 `[a, b, c]`，读时按逗号切并去引号（`196-197`） |
| `status` | string | 恒为 `'active'`（`openEngagement` 只写这个值） |
| `created_at` | ISO string | 首次创建后不再变（`1256`） |
| `updated_at` | ISO string | 每次 open 刷新 |

**靶标 id ≠ 靶标名**：`id = slugify(name)`（`1248`），`slugify` 会 `toLowerCase()`（`ip-utils.js:87-93`）。`[实测]` `openEngagement('A单位')` 返回 `{ id: 'a单位', name: 'A单位' }`。

### 2.6 `settings.json`

`{ "maxAgents": <1..10 的整数> }`（`settings.js:35-40`、`64-68`）。生效顺序：文件 → `REDTEAM_MAX_AGENTS` → 默认 3（`settings.js:55-61`）。`[实测]` `saveMaxAgents(root,7)` 后 `maxAgentsSourceOf === 'settings'`，`clampMaxAgents(99) === 10`、`(-3) === 1`、`('x') === 3`。

### 2.7 `config.json` —— 环境适配（`platform-config.js:54-81`）

| 字段 | 类型 | 默认 |
|---|---|---|
| `version` | number | 1 |
| `platform` | `auto\|windows\|linux` | `auto` |
| `toolkitDir` | string | `''` |
| `nucleiTemplatesDir` | string | `''` |
| `binDirs` | string[] | `[]` |
| `tools` | `{[toolId]: 绝对路径}` | 目录里 30 个 id 全空串（`TOOL_CATALOG`，`platform-config.js:35-53`） |
| `env` | `{FOFA_KEY, REDTEAM_VPS_HOST, REDTEAM_VPS_KEY}` | 全空串 |
| `notes` | string | `''` |
| `envAdaptSkip` | boolean | false |
| `templatesRefreshedAt` | number(ms) | 0 |
| `templatesCommit` | string | `''` |
| `templatesCount` | number | 0 |
| `templatesLastError` | string | `''` |
| `envAdaptConfigured` | boolean | false |
| `updated_at` | ISO string | null |

写入是「先 `loadPlatformConfig` 合并再整文件覆写」（`platform-config.js:129-174`），`tools` 键会补齐 catalog 全量（`167-172`）。

### 2.8 `agents/<role>.md` + `agents/.defaults.json`

- 6 个角色文件：`plan`、`recon`、`assess`、`vuln-scan`、`exploit`、`internal`（`ROLE_ORDER` + `PLANNER_ROLE`，`store-core.js:796-797`）。`[实测]` 新建靶标后 `listPrompts` 返回 6 条，正文长度 4164/7198/4504/9649/10055/9151。
- `.defaults.json` 是 `{role: sha256(默认正文)}` 指纹清单（`store-core.js:6128-6136`），用于 `refreshDefaultPrompts`（`6156`）判断「这条还是不是原装默认」：指纹等于 manifest 或历史默认表 `LEGACY_PROMPT_HASHES` 才覆盖，否则算用户自写、保留。

### 2.9 `kb/cve-kev.json`

`slim()` 收敛后的结构（`kev.js:72-88`）：

```json
{ "fetched_at": 1795162853295, "count": 1786,
  "items": [ { "cve":"CVE-2024-10441", "vendor":"Synology", "product":"...",
               "name":"...", "added":"2026-11-18", "ransomware": false } ] }
```

`[实测]` 实际拉取得到 **1786 条 / 327654 字节**。`kev.js:9` 的注释写「约 1.6 万条」——**与实测不符**，真实量级是 1.8 千条。

### 2.10 `pocs/.nuclei-index.json`

`{ built_at, dir, sig, items:[...] }`（`store-core.js:5387`）。`sig` 是目录签名，用于判断模板库是否换过（`#nucleiDirSignature`，`5323`）。模板刷新成功后会被删掉强制重建（`bootstrap-runtime.js:428`、`bootstrap-runtime.js:542`）。

---

## 3. 业务逻辑（按入口组织）

### 3.1 `dispatch(store, req)` —— 同步分发（`store-core.js:808-1019`）

**签名**：`dispatch(store, req) → JSON 可序列化对象`；失败统一 `{ ok:false, error }`。

**判据顺序**（这是重实现时最容易做错的地方，必须按序）：

1. `op` 非字符串 → 去空白后为空 → `{ok:false,error:'missing op'}`（`811`）`[实测]`。
2. 无靶标前置分支（`812-931`，共 21 个 op）：`bootstrap`、`openEngagement`、`activateEngagement`、`sessionBinding`/`sessionBindings`、`bindSessionEngagement`、6 个 `poc*` + 2 个 `template*`、3 个 `platform*`、`attention`、`attentionAck`。
3. **靶标解析**：`id = req.engagement.trim()`，为空则 `store.activeEngagementId()`（`933-934`）。
4. **无靶标兜底**（`935-952`）：
   - `prompts` → 返回 6 条内置默认（`builtin:true`，`936-948`）
   - 写类 op（正则 `/^(add|save|update|delete|import|assess|open)/`）→ `{ok:false,error:'请先在顶部选择或创建一个靶标'}`（`949-950`）
   - 其余 → `{ok:true, items:[], total:0, stats:null, segments:[], stages:[], roles:[]}`（`951`）
5. 有靶标 → 79 个 `if (op === '...')` 顺序匹配（`954-1014`）。
6. 全不匹配 → `throw new Error('unknown op: ' + op)`（`1015`），被 `catch` 转成 `{ok:false,error}`（`1016-1018`）。

**必须注意的缺陷**：第 4 步先于第 6 步，所以**没有靶标时未知 op 会返回 `ok:true` 的空结果**。`[实测]` `dispatch(s3,{op:'zzz'})` → `{"ok":true,"items":[],...}`，而 `dispatch(s3,{})` → `{"ok":false,"error":"missing op"}`。重实现时若照抄顺序，会继承这个静默失败。

### 3.2 `dispatchAsync(store, req)`（`store-core.js:1025-1046`）

只多三条：`intelStatus`、`intelRefresh`（走 `intelOps`，`53-74`）、`probeSessions`（`1034-1044`）；其余 `return dispatch(store, req)`。`intelOps` 用动态 `import()` 拉 `bootstrap-runtime.js` 与 `kev.js`（`54-55`），理由写在 `51-52`：这两个模块会拉 `node:sqlite`，面板查询不该为它付启动成本。

### 3.3 `openEngagement(name, scope, options)`（`store-core.js:1247-1266`）

| 步骤 | 行为 | 行号 |
|---|---|---|
| 1 | `id = slugify(name)`，`mkdir -p dirOf(id)` | 1248-1249 |
| 2 | 建 `agents`/`runs`/`reports` 三个子目录 | 1250 |
| 3 | 读旧 meta；`target_name` 用新名覆盖，`scope_cidrs` 用新值或旧值，`created_at` 保留旧值 | 1251-1258 |
| 4 | `this.db(id, {create:true})` → 建库 + 跑 DDL + `migrate` | 1259 |
| 5 | `seedScorePoints(id)` | 1260 |
| 6 | 对 6 个角色，内容为空则写默认提示词 | 1261-1263 |
| 7 | `options.bindCurrent !== false` 时 `setActiveEngagement(id)` | 1264 |

**副作用的关键点**：`bindCurrent` 默认 **true**，但智能体工具 `redteam_engagement_open` 显式传 `false`（`tools.js:584`），注释在 `583`：多会话并行时改全局指针是「报告被写串」的根因。

**失败路径**：全部靠抛错冒泡；`slugify('')` 会退化成 `engagement-<Date.now()>`（`ip-utils.js:92`）而不是报错。

### 3.4 `sessionBinding` / `sessionBindings` op（`store-core.js:831-856`）

**入参**：`{ op, session, resolveRoot? }`。`resolveRoot` 是 `ui.js` 注入的函数（`ui.js:940-942`），把子会话 id 解析到根会话 id。

**判据**：
1. `root = req.session`；若 `req.resolveRoot` 是函数则试解析，抛错就按原样（`832-839`）。
2. `bound = root ? store.sessionBinding(root) : undefined`（`840`）。
3. `meta = listEngagements().find(e => e.id === bound)`，只为了拿 `name`（`841`）。

**返回**（`842-849`）：`{ ok, session, root_session, bound, name, current }`。`sessionBindings` 额外把 `agents` 过滤一遍——只留 `engagement` 仍存在的条目（`851-855`）。

`[实测]`：`sessionBinding` 返回 `{"ok":true,"session":"ROOT1","root_session":"ROOT1","bound":"a单位","name":"A单位","current":"b单位"}`。

### 3.5 `bindSessionEngagement` op（`store-core.js:857-862`）

`session` 空 → `{ok:false,error:'session required'}`（`858-859`）。否则 `store.setSessionBinding(sid, req.engagement, req.name)`，返回 `{ok: written, session, bound: written ? req.engagement : null}`。注意 `ok` 直接等于写入结果，**靶标不存在时 `ok:false` 且不带 error 字段**。

### 3.6 `attention` op —— 「现在在等谁」（`store-core.js:899-917` + `attentionQueue` 2058-2107）

这是四个出口（侧栏角标、悬浮提醒、态势页第一屏、`redteam_attention` 工具）共用的唯一实现，注释明写「谁都不许自己再写一套排序」（`891-898`）。

#### 3.6.1 靶标解析三档（`900-914`）

| 档 | 判据 | 行号 | `[实测]` 结果 |
|---|---|---|---|
| ① 显式 `req.engagement` | 非空字符串，`trim()` 后非空 | 900 | `engagement=B` → 队列是 B 的 `['cB']` |
| ② 会话绑定 | 无①且 `req.session` 非空 → 先过 `resolveRoot` → `store.sessionBinding(root)` | 901-913 | `session=ROOT1`（绑 A）而全局指针是 B → 队列是 A 的 `['cA']` |
| ③ 全局指针 | 无①② → `activeEngagementId()` | 914 | 无 session → `['cB']` |
| 全空 | 三档都拿不到 | 915 | `{ok:true,total:0,awaiting_person:0,items:[],pending_coverage:0,note:'还没有靶标'}` |

`[实测]` 还验证了两条：`resolveRoot` 把 `CHILD9` 映射到 `ROOT1` 后返回 A 的队列；未知 session `NOPE` 落到指针 B。

**为什么绑定排在指针前面**（`896-897` 注释）：侧栏角标永远拿到的是「我这个会话」的靶标；多会话并行时指针只有一个，用它会把别人的等待算到自己头上。

#### 3.6.2 `attentionQueue(id, opts)` 的排序算法（`2058-2107`）

```
1. reports = SELECT * FROM agent_report ORDER BY session_id, id DESC   (2062)
2. latest = 每个 session_id 的第一条（即该会话最新一条）              (2066-2067)
3. ranked = { waiting:0, ready:1, blocked:2, failed:3, progress:4, dropped:5 }  (2068)
4. 遍历 latest：
     rank === undefined 或 status === 'dropped' → 跳过                (2071-2072)
     acknowledged_at 非空 → 跳过                                      (2073)
     needs = JSON.parse(r.needs) 失败则 []                            (2074-2075)
     stage 映射：waiting→person/answer, ready→person/review,
                blocked→person/blocked, failed→person/failed, 其余→working  (2076-2080)
5. sort: a.rank - b.rank || b.at.localeCompare(a.at)                   (2086)
6. pending_coverage = hostNextActions(limit:1).total + assetNextActions(limit:1).total  (2088-2094)
7. limit 夹到 [1,100]，默认 20                                        (2095)
```

**返回**：`{ total, awaiting_person, items, pending_coverage, note }`。`total` 是**未截断**的条目数，`items` 才按 limit 截。`awaiting_person` = `stage` 以 `person/` 开头的条数。

**`note` 三态**（`2101-2105`）：
- 队列空 + `pending_coverage>0` → 「没有智能体在等人，但还有 N 个覆盖度缺口 —— 该派下一个智能体了」
- 队列空 + 无缺口 → 「没有人等、也没有队列缺口：这一轮打完了。」
- 队列非空 → 「按"最需要人"排序；连带 needs 一次性列给用户」

`[实测]`：塞 4 条回报（waiting/progress/blocked/dropped），得 `total=3, awaiting_person=2`，排序 `[c1 waiting rank0, c3 blocked rank2, c2 progress rank4]`，`dropped` 的 c4 不在队列里。

#### 3.6.3 `parked`（等资源）不占名额的判定

`parked` **不是** `agent_report` 的字段，是 `slot-state.js` 里的进程内 `Map`（`slot-state.js:11`）。写入点两处：

| 触发 | 位置 | 说明 |
|---|---|---|
| 子智能体结束、`lastAssistantMessage` 解析出 `blocked`/`waiting` | `tools.js:554` | 模型忘了调 release 也兜住 |
| 子智能体自己调 `redteam_agent_slot` 且 `status` 是 `blocked`/`waiting` | `tools.js:924-925` | 主动让位 |
| `progress`/`ready` → `unparkAgent` | `tools.js:926-928` | 解除挂起 |
| `subagent/end` → 无条件 `unparkAgent` | `tools.js:532` | 会话结束即清 |

消费点两处，口径必须一致：
- `redteam_agent_slot` 的 `used = max(注册表 running 数, 预留数)`（`tools.js:934`），`parked` 只报数不扣减 `used` —— 因为挂起的子会话在注册表里已经是 `running`，但 `liveRunningChildren` 里会把它单列（`ui.js:751-758` 同口径）。
- `ui.js` 的 `agentsStatus`：`used = runningRows.length`，`parked` 单列（`ui.js:752-762`）。

`[实测]` `parkAgent('R','C1') → true`、`isParked → true`、`unpark → true`、再 `unpark → false`、`parkAgent(undefined,'C') → false`。

**容量保护**：`parked` 上限 500，靠改写 `Map.set` 在超限时淘汰最老的键（`slot-state.js:14-26`）。

### 3.7 `attentionAck` op（`store-core.js:922-931`）

| 判据 | 行为 | 行号 |
|---|---|---|
| `id` 空（不看 `session`，只看 `engagement` 与指针） | `{ok:false,error:'请先在顶部选择或创建一个靶标'}` | 924-925 `[实测]` |
| 调 `acknowledgeAgentReports(id, {session_id, ids, all})` | 见下 | 926-928 |
| 返回带 `error` | `{ok:false, engagement, ...out}` | 929 |
| 成功 | `{ok:true, engagement, ...out, ...attentionQueue(id)}` —— **ack 后直接回新队列** | 930 |

`acknowledgeAgentReports`（`2008-2032`）三种用法，**优先级固定**：

1. `ids` 是非空数组 → 逐个 `UPDATE ... SET acknowledged_at=? WHERE id=? AND acknowledged_at IS NULL`（`2014-2019`）；`ids` 里非正整数被过滤掉（`2011-2013`）。
2. `session_id` 非空 → 取该会话**最新一条** `id`（`ORDER BY id DESC LIMIT 1`），只摘它（`2020-2025`）。
3. `all === true` → 全表未确认的一次性摘（`2027-2030`）。
4. 三者都没有 → `{acknowledged:0, at, error:'需要 session_id / ids / all 之一'}`（`2031`）。

`[实测]` `attentionAck` 不带三者 → `{"ok":false,"engagement":"t","acknowledged":0,"at":"...","error":"需要 session_id / ids / all 之一"}`。

**为什么必须有这个 op**（`1996-2007` 注释）：没有它，一条 `waiting` 回报永远算「有人在等」，同一段提示词每轮被重新生成、重新发进对话。

### 3.8 `recordAgentReport` / `parseAgentReport`（`1970-1994` / `1894-1967`）

**`parseAgentReport(text)`** —— 从子智能体最后一条消息里抠结构化回报，抠不出就返回 `null`（**不猜**）：

| 步骤 | 判据 | 行号 |
|---|---|---|
| 1 | 先试整体 `JSON.parse`；失败则找第一个 `{` 到最后一个 `}` 的切片 | 1894-1920 区间 |
| 2 | `needs` 可能是数组字面量：按括号配平抠出 `[...]` 再 parse；失败则当整句字符串 | 1931-1947 |
| 3 | `status` 必须在 `progress/waiting/ready/blocked/failed/dropped` 里，否则 `null` | 1952-1954 |
| 4 | `needs` 归一化成 `[{kind, detail}]`：字符串 → `{kind:'other'}`；对象取 `kind`/`detail`/`value` | 1955-1961 |

**`recordAgentReport(id, f)`**：
- `session_id` 必填，否则抛 `recordAgentReport: session_id 必填`（`1972`）。
- `status` 必须命中 6 值枚举，否则抛 `agent report status 必须是 ...`（`1974-1976`）。
- `needs` 只在是非空数组时 `JSON.stringify`，否则存 NULL（`1985`）。
- `summary` 截断到 2000 字符（`1986`）。
- 插完立刻删同会话的历史，只留最近 **20** 条（`1991`）。

### 3.9 `addDataProof` / `listDataProofs`（`4873-4902`）

| 判据 | 行为 | 行号 |
|---|---|---|
| `row_count` 不是有限数或 `< 0` | 抛 `data_proof.row_count 必须是非负数字` | 4875-4876 `[实测]` |
| `fields` 空（数组 join 后或字符串 trim 后为空） | 抛 `data_proof.fields required：写清泄露字段（如 姓名/身份证号/手机号）` | 4877-4878 `[实测]` |
| `fields` 是数组 | `join(',')` 存成逗号串 | 4877 |
| `pii_type` 缺省 | `'pii'` | 4883 |
| 返回 | `{id, row_count, meets_threshold: row_count >= 10000, fields}` | 4885 |

`listDataProofs` 把 `fields` 再 `split(',')` 成数组，并重算 `meets_threshold`（`4898-4900`）。`limit` 默认 100、上限 500（`4895`）。`[实测]` `addDataProof({fields:['姓名','身份证号'],row_count:12000})` → `meets_threshold:true`。

**门槛口径不一致**：`data_proof` 用 `>= 10000`（`4885`），而 `score-rules.js:494` 的 `SENSITIVE_DATA_MIN_ROWS = 1000000`。两个「敏感数据够不够」的阈值差 100 倍，见第 8 节 R-07。

### 3.10 计分链路

| 入口 | 判据与副作用 | 行号 |
|---|---|---|
| `seedScorePoints(id)` | 内置 25 条（`DEFAULT_SCORE_POINTS`，`score-rules.js:769`）。缺哪条补哪条；把内置 code 的 `builtin` 置 1；把 `legacy=1` 或 `builtin=1` 但不在名单里的旧点**连同命中一起删**，删前把点与命中存档到 `runs/legacy-score-<时间>.json` | 2200-2310，存档 2243-2252，删除 2255-2260 |
| `addScoreHit(id, hit)` | ① 先 `seedScorePoints` 幂等播种（`2653`）② `point_id` → `code` → `point_name` 三级解析，全空抛「score point not found」并列出已作废的旧 code（`2667-2671`）③ `evidence` 必填（`2672-2673`）④ `self_created` 归一成 0/1（`2675`）⑤ `#servicePortOf` 解析端口（`2676`）⑥ `points` 边界校验：非有限数抛错、`<=0` 抛错、`> max(规则cap, 默认分×100, 1000)` 抛错（`2689-2704`）⑦ `scoreMultiplierOf` 算倍率（`2706`）⑧ INSERT（`2707-2712`）⑨ 回读 `listScorePoints` 判断本条是否被服务级封顶、是否顶掉了别人（`2715-2730`） | 2649-2785 |
| `applyScoreCaps(rows, pointsByCode, nameByAsset)` | ① `self_created=1` 不参与去重也不参与封顶（`189`、`251`）② `dedup_scope=none` 跳过 ③ `target` → 全局一个桶；`system` → `sys:<系统键>`；`service` → `svc:<服务键>`，**服务键拿不到时跳过（宁可不封顶也不错封）**（`207-215`）④ 桶内 `pickBestHit` 留一条，其余标 `capped`/`capped_reason_kind='dedup'`（`216-233`）⑤ 同 `rule` 组按分值降序累计，超 `cap` 的标 `capped_reason_kind='cap'`（`235-260`） | `score-rules.js:162-263` |
| `scoreChain(id, f)` | 返回 `{items, stages, achieved, missing, summary}` `[实测]` | 4491- |
| `scoreReport(id, opts)` | 逐条命中追证据：`#hitTrace` 反查 vuln/step/http_evidence（`3227-3396`），再渲染 | 3397-4490 |
| `report(id, opts)` | 返回 `{markdown, generated_at, stats}` `[实测]`；`rpAttackPath` 把 `evidence_ref` 渲染成可点路径（`6289-6300`） | 5864- |

### 3.11 `probeSessions(id, opts)`（`4705-4767`，async）

**为什么在 host 侧**（`4700-4703` 注释）：智能体跑在沙箱里连不出去，只有这里能真实发起连接。

| 对象 | 探测方式 | 判 online/active 的条件 | 回写 | 行号 |
|---|---|---|---|---|
| webshell | `fetch(url, {method:'GET', redirect:'manual', signal})` | `res.status < 500` → `online`，否则 `offline` | `status`/`last_check`/`latency_ms`/`check_note` | 4709-4728 |
| tunnel | 去掉 `socks5://`、`http(s)://` 前缀后按最后一个 `:` 切 host/port，`tcpConnect` | `connect` 事件 → `active`，否则 `down` | 同上 | 4730-4765 |

`timeoutMs` 夹到 `[1000, 20000]`，默认 6000（`4706`）。超时文案 `超时 >Nms`（`4721`、`4755`）。`listen` 为空或端口解析不出只写 note 不改状态（`4735-4742`）。

### 3.12 tools 层（`tools.js`）

#### 3.12.1 靶标解析 `resolveEngagement(store, exec, explicit)`（`211-240`）

顺序：① 显式 → ② 本会话/父链绑定 → ③ 全局指针（**仅当没被别的会话占用**）→ ④ 唯一靶标自动绑定 → ⑤ 抛错。

| 分支 | 判据 | 行为 | 行号 |
|---|---|---|---|
| ① | `explicit` 非空字符串 | 直接返回，不校验存在性 | 212 |
| ② | 沿 `[rootId, sessionId, ...chain]` 找 `bindings` 命中 | 返回 | 214-218 |
| ③a | 指针指向的靶标**已被别的会话绑定** | **抛错**，提示显式绑定 | 222-229 |
| ③b | 指针可用 | 把指针写进本会话所有键的 `bindings`，返回 | 230-231 |
| ④ | `listEngagements().length === 1` | 自动绑唯一靶标 | 234-238 |
| ⑤ | 其余 | 抛 `尚未绑定靶标：请先调用 redteam_engagement_open` | 239 |

**③a 抛错而不是「随便挑一个」是刻意的**（`208-210` 注释）：挑错靶标 = 把 A 单位的成果写进 B 单位的库。

#### 3.12.2 绑定键 `bindingKeyOf(exec)`（`194-200`）+ `resolveRootSession`（`169-191`）

沿 `header.parentSession` 一路向上，最多 64 层；父会话不在内存里（被回收/冷启动）时**直接把父 id 当根键返回**（`183-186`）。绑定键集合 = `{rootId, sessionId, ...chain}` 去重（`289-292`）。

`bindings` 是进程内 `Map`，上限 500（FIFO 淘汰，`tools.js:117-135`）。**重启即失**（`redteam_session_info` 的 note 明写，`645`）。

#### 3.12.3 `redteam_attention`（`tools.js:1387-1408`）

参数：`engagement`、`limit`、`action`(`list`|`ack`)、`session_id`、`ids`、`all`。

- `action==='ack'` → `acknowledgeAgentReports` → 有 `error` 返回 `{ok:false, engagement, error}`（`1403`）→ 否则 `{ok:true, engagement, ack, ...attentionQueue}`
- 默认 → `{ok:true, engagement, ...attentionQueue}`
- 返回给模型的形状：**JSON 字符串**（`JSON.stringify(..., null, 2)`），经 `output.render = text` 包成 `[{type:'text',text}]`（`tools.js:284`）

#### 3.12.4 `redteam_session_bind`（`tools.js:600-632`）

| 判据 | 行为 | 行号 |
|---|---|---|
| `engagement` 空 | `{ok:false, candidates:[{id,name,created_at,stats}], note}` —— **不抛错，列候选** | 610-616 |
| 精确 id 命中 → 精确名 → `name.includes(wanted)` | 三级模糊匹配 | 617-619 |
| 全不中 | `{ok:false, error:'靶标不存在：X', candidates:[id...]}` | 620-622 |
| 命中 | 写进程内 `bindings`（所有键）+ `recordSessionBinding`（落 `sessions.json`） | 623-625 |
| 返回 | `{ok:true, engagement:{id,name}, session:bindingViewOf(exec), note}` | 626-630 |

#### 3.12.5 `redteam_engagement_open`（`tools.js:570-598`）

`store.openEngagement(target, scope, {bindCurrent:false})` → 写 `bindings` → `recordSessionBinding` → 返回 `{ok, engagement, stats, session, note}`。子智能体调用时 note 追加「本会话是子智能体，通常不需要再 open」（`594-595`）。

#### 3.12.6 `redteam_agent_slot`（`tools.js:901-988`）

并发闸门，`used = max(注册表 running 数, 预留数)`（`934`），`cap = maxAgentsNow(ctx)`（`138-141`）。

| action | 判据 | 行为 |
|---|---|---|
| `status` | — | 只读，返回 `{max,used,free,running_from_registry,running_labels,parked,parked_labels,reservations,registry_available,hint}` |
| `acquire` | `free <= 0` | `{ok:false, error:'并发已满（最多 N 个）…'}`（`955-959`） |
| `acquire` | 有名额 | `key = label + '#' + Date.now()`，`addReservation`，返回 `slot` |
| `release` | 有 `key` / 是子会话 / 都不是 | 依次 `dropReservation(owner,key)` → `(owner,selfChild)` → `(owner,undefined)`（`969-973`） |
| `status` 参数 | 只有子会话能填 | 主会话填 → `{ok:false, error:'status 只由执行子智能体填写…'}`（`921-923`） |
| `status=blocked/waiting` | 子会话 | `parkAgent` + 本次 release **不摘自己**（`975-976`） |

#### 3.12.7 `subagent/end` 钩子（`tools.js:524-568`）

子智能体结束时一次做三件事：① `unparkAgent` ② 解析 `info.lastAssistantMessage` 落 `agent_report`（只在 `bound !== undefined` 时写，`540-552`）③ 释放预留（`dropReservation`，失败则按时间淘汰最早的一个，`557-564`）。整段包 `try/catch`，解析/落库失败不影响名额释放（`556`）。

### 3.13 HTTP 桥 `POST /redteam/api`（`ui.js:857-948`）

**注册**：`ctx.webServer.register({kind:'exact', path:'/redteam/api', handler})`（`857-860`）。`inject = ['redteam','webServer']`（`199`）。

**请求管线（顺序即判据）**：

| # | 判据 | 失败行为 | 行号 |
|---|---|---|---|
| 1 | `req.method !== 'POST'` | 405 `{ok:false,error:'POST only'}` | 861-864 |
| 2 | 来源校验（见下） | 403 `{ok:false,error:'cross-origin request rejected'}` + 追加 `cors-reject.log` | 897-904 |
| 3 | `readBody` 超 `MAX_BODY_BYTES` | 400，并 `req.destroy(err)` | 356-377 |
| 4 | body 空 → `{}`；否则 `JSON.parse` | parse 失败 → 400 | 906-907 |
| 5 | `handlePlatformOp` | 命中则返回 | 908-912 |
| 6 | `handleAgentsOp` | 命中则返回 | 913-917 |
| 7 | `handleUpdateOp` | 命中则返回 | 918-922 |
| 8 | `handleSkillOp` | 命中则返回；抛错且是 `skillCatalog`/`skillRead` → 走文件兜底 | 923-939 |
| 9 | 有 `request.session` 时注入 `resolveRoot` | — | 940-942 |
| 10 | `dispatchAsync(store, withRoot)` | — | 943 |
| 11 | 任何异常 | 400 `{ok:false, error}` | 944-946 |

**来源校验（`870-896`）**——这是全模块唯一的安全边界，逐条：

```
loopback  = remote ∈ {127.0.0.1, ::1, ::ffff:127.0.0.1}            (871)
hostLocal = Host 头匹配 /^(localhost|127.0.0.1|\[::1\])(:\d+)?$/    (873)
selfConn  = loopback || selfAddressSet().has(remote)               (879)
放行条件（或）：
  a) loopback                                                      (881)
  b) selfConn && (无 Origin || Origin 命中 APP_ORIGIN_RE)          (883)
  c) hostLocal && (Origin === 'null' || APP_ORIGIN_RE || Origin.host === Host || Origin.host === '')  (885-891)
  d) Origin.host === Host（最后兜底）                              (892-895)
否则 403。
```

`APP_ORIGIN_RE = /^(app|file|blob|data|about|chrome-extension|moz-extension|ms-browser-extension|tauri|capacitor|ionic):/i`（`395`）。

**UI 私有 op（不在 store 的 dispatch 里）**：

| 处理器 | op | 行号 |
|---|---|---|
| `handlePlatformOp` | `platformEnvAdaptStatus`、`platformEnvAdaptSkip`、`platformConfigGet`、`platformConfigSave`、`platformAssignToolkit` | `320-338` |
| `handleAgentsOp` | `agentsStatus`、`setAgentsMax` | `708-769` |
| `handleUpdateOp` | `version`、`updateCheck`、`updateApply` —— **全部返回 `sealed:true` + `ok:false`**，私有固定版本，不查 npm 不安装 | `778-796` |
| `handleSkillOp` | `skillCatalog`、`skillRead` | `486-` |

注意 `platformConfigGet/Save/AssignToolkit` 在 `ui.js:332-337` 与 `store-core.js:885-890` **各有一份**；`ui.js` 先执行，所以走 UI 时永远是 ui.js 那份（`store-core.js` 的只对 CLI/工具生效）。

### 3.14 `team-mode.js` —— 团队模式

**要解决的问题**（`team-mode.js:1-19`）：官方 `dsh-agent-team` 把「用不用团队任务板」做成**会话级开关**，`TeamService.isEnabled(caller)` 读 `ctx.subagents.rootOf(caller).session` 上的 `team/mode` 事件投影，`defaultEnabled:false`，四个 `team_task_*` 工具注册时带 `when: enabled(agent)`。不写这条事件，工具根本不进目录。

**做法**：给红队**根**会话补一条 `team/mode {enabled:true}`。三条边界（`14-19`）：只写根会话、只写一次、只对红队会话写。

| 函数 | 职责 | 判据 | 行号 |
|---|---|---|---|
| `ensureRedteamTeamMode(session, check)` | 幂等补写 | ① 无 session 或无 `append` → `skip-no-session` ② 已有 `team/mode` 事件 → `skip-already` ③ `checked` 里有 → `skip-already` ④ `check()` 判非红队：预设未知 → `skip-unknown-preset`（**不钉死**），预设明确非红队 → `skip-not-redteam`（**也不钉**）⑤ 非根 → `skip-not-root` ⑥ 写成功 → `enabled` | 94-127 |
| `isRootSession(session)` | 判根 | `origin ∈ {subagent,teammate,delegate}` → false；否则 `delegationDepth <= 0` | 70-76 |
| `hostUsesTeamGate(ctx)` | 判宿主版本 | 读不到 `agentTeams` → 按新版（写事件是安全侧）；有 `isEnabled` → rc.2+ | 150-159 |
| `installTeamMode(ctx, config)` | 挂三个入口 | `agent/created`（同步写，`prepend:true`）、`session/event` 上的 `agent-preset/selected`（推微任务，因为 append 链里再 append 会被拒）、`agent/pre-step`（兜底，每步重判） | 180-258 |

`config.redteamTeamMode === false` 直接不装（`181`）。返回 `dispose` 函数，逐个 `off()`（`253-257`）。

**与普通模式的差异**：普通模式不写这条事件 → 四个 `team_task_*` 工具缺席；红队根会话有这条事件 → 工具在场。**不是删代码，是靠条件缺席**（`11-12`）。

### 3.15 `bootstrap-runtime.js` —— 启动铺路（`ensureRedteamRuntime`，548-666）

| 步骤 | 行为 | 失败降级 | 行号 |
|---|---|---|---|
| 0 | `homes = collectHomes()`：`DSH_HOME` → macOS 的 `~/Library/Application Support/DeepSeek Harness/dsh-home` → `~/.dsh`（后两个只在存在时保留） | 至少保留一个 | 40-54 |
| 1 | `mkdir primaryRoot`，写 `bootstrap.log` | 日志失败不挡 | 555-556 |
| 2 | `seedKnowledge(primaryRoot)`：建 `knowledge.db` + `KNOWLEDGE_DDL`(+`POC_FTS_DDL`) + `migrateKnowledge` | `try/catch` 只记日志，`pocs` 保持 0 | 496-508、559-561 |
| 3 | `discoverTemplates(homes)` 找现成模板库 | 找不到就用 `toolkit/nuclei-templates` | 89-111、563-566 |
| 4 | 模板不像模板且 `download!==false` → 拉取 | 见下 | 569-606 |
| 5 | 对每个 home：建 `redteam/toolkit/pocs`，非主 home 也 `seedKnowledge`，`writeConfig` | `writeConfig` 失败只记日志 | 608-619 |
| 6 | 首次装好记 `templatesRefreshedAt` | 写不进不挡 | 621-632 |
| 7 | `background && download` 时 kick 模板按龄刷新 + KEV 刷新 | 各自吞错 | 636-648 |
| 8 | 返回 `{root, knowledgePath, pocs, templatesDir, templates, templatesDownloaded, templatesError, templatesStatus, kev}` | — | 649-665 |

**模板拉取的三条路**（`334-404`）：`git clone`（`GIT_URLS`，含 ghproxy 镜像）→ `tar.gz` 解包（`TAR_URLS`）→ `zip` 解包（`ZIP_URLS`）。互斥靠 `toolkit/.nuclei-templates.lock`（`210-231`）。`background` 时直接返回并在后台跑（`575-586`）；抢不到锁则 `waitForTemplates` 等别人下完（`587-593`）。

**`refreshTemplatesIfStale(options)`**（`405-441`）判据链：
`REDTEAM_TEMPLATE_REFRESH_HOURS` 为 0 → `disabled`；无模板目录 → `no-templates`；不是自己那份（`ownsTemplatesDir`）→ `not-owned`；年龄 < 阈值 → `fresh`；抢不到锁 → `locked`；否则拉取并写 `templatesRefreshedAt/Count/Commit`，删 `.nuclei-index.json`。全程 `try/catch`，**从不抛给调用方**。

**`node:sqlite` 依赖**：`bootstrap-runtime.js:14` 顶层 `import { DatabaseSync } from 'node:sqlite'`。**没有「没有 sqlite 时」的降级**——这个 import 失败会让整个模块加载失败。唯一的降级是 FTS5（`HAS_FTS5`，`schema.js:31-44`），而 `node:sqlite` 本身是硬依赖。`[实测]` `node v26.13.1` 上 `require('node:sqlite')` 正常。

### 3.16 `kev.js` —— 公告层

| 项 | 值 | 行号 |
|---|---|---|
| 数据源 | `https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json`（两个 URL 变体） | 17-20 |
| 开关 | `REDTEAM_KEV=0` 关闭 | 25-27 |
| 缓存路径 | `<root>/kb/cve-kev.json` | 29-31 |
| TTL | 24 小时（`KEV_TTL_HOURS`），超龄只标 `stale` 不删 | 23、110-111 |
| 进程内缓存 | `Map<root, {mtimeMs, data}>`，按 mtime 判失效 | 33-34、100-102 |
| 单文件上限 | 64MB，超了 `req.destroy()` + reject | 57-59 |
| 重定向 | 手动跟，最多 5 跳 | 41-51 |
| 超时 | 默认 60000ms | 157 |
| 失败 | **一律静默**：`refreshKevIfStale` 返回 `{action:'failed', error}` 从不抛；`lookupKev` 返回 `[]` | 172、140 |
| 依赖 sqlite | **零**。`kev.js` 只 import `node:fs/http/https/path` | 12-15 |

`[实测]`（本机联网）：
- 无缓存时 `kevStatus` → `{available:false, enabled:true, count:0, note:'还没有公告数据…'}`
- `refreshKevIfStale({force:true})` → `{action:'refreshed', count:1786}`
- 落盘 327654 字节，`items[0] = {cve:'CVE-2024-10441', vendor:'Synology', …}`
- `lookupKev(root, ['log4j CVE-2021-44228'])` → 命中 1 条（`ransomware:true`）
- 再跑不 force → `{action:'skipped', reason:'fresh', age_hours:0}`
- `REDTEAM_KEV=0` → `{available:false, enabled:false, note:'公告层已关闭（REDTEAM_KEV=0）'}`

### 3.17 `slot-state.js` —— 46 行为什么够

**它只维护一个东西**：`Map<rootId, Set<childId>>`（`slot-state.js:11`）+ 500 上限保护（`14-26`）+ 三个函数 `parkAgent`/`unparkAgent`/`isParked`（`28-46`）。

**给谁用**：`tools.js` 写（`532`、`554`、`925-928`、`976`），`ui.js` 读（`756`）。注释写得很直白（`5-7`）：工具层写、面板层读，两边共用一个 Map 才不会出现「工具说还有名额、面板说满了」。

**为什么能这么短**：状态**不落盘**（重启即清，这是设计而非缺陷——挂起是瞬态）、不含任何 host 依赖、不需要过期时间（`subagent/end` 会无条件清，`tools.js:532`）。唯一需要额外代码的是上限保护，因为长开进程里子会话 id 会一直涨（`13`）。

### 3.18 `schema.js` / `validate.js` / `score-rules.js` 三者分工

| 模块 | 管什么 | 不管什么 | 证据 |
|---|---|---|---|
| `schema.js` | **数据形状**：DDL、索引、视图、FTS5 探测、增量迁移（`migrate`/`migrateKnowledge`）、POC 归类表与关键词推测 | 任何业务判定；它连 `parseTargetPort` 都从 `score-rules.js` 借（`schema.js:4`） | `schema.js:6-16` 的注释明写「DDL 与迁移是数据形状的唯一定义处」 |
| `validate.js` | **什么值允许进库**：马类型/状态枚举、`assertPathWithin` 目录穿越防护 | 具体业务规则（得分口径、覆盖度状态机） | `validate.js:1-6`：「这些函数决定什么值允许进库，是安全边界所在」 |
| `score-rules.js` | **怎么算分**：去重口径、规则封顶、倍率、25 条默认得分点、得分确认清单、`parseTargetPort` | 任何 SQL DDL；它只接受 rows 数组做纯函数运算（`applyScoreCaps`） | `score-rules.js:2`（在 `schema.js` 里）：「计分/判定规则的唯一实现在 score-rules.js」 |

**一条纪律**：`score-rules.js` 里的 `applyScoreCaps` 是**纯函数**（入参 rows + 两个查找表，出参新数组），不碰 db。这让它可单测、也能被 `listScorePoints` 与 `addScoreHit` 两处复用而不产生两套口径。

### 3.19 `ui.js` / `index.js` / `store-core.js` 的分工

| 模块 | 平面 | 干什么 | 不干什么 |
|---|---|---|---|
| `index.js` | host 插件 `dsh-purge-safe-redteam` | 铺预设（`installPreset`）、铺技能（`installBundledSkills`）、铺 `setup.sh`、把 `redteam` 注册进 `agentPresets`（`registerOnce`，1015-1060）、装 team-mode（`index.js:1115`）、异步拉起 bootstrap（`index.js:962`）、`ctx.provide('redteamMode', ...)` | 不注册任何 HTTP 路由，不碰 SQLite |
| `ui.js` | host 插件 `...-ui` | 注册唯一路由 `POST /redteam/api`（857）；挂 `agent/pre-step` 环境门禁（806-855）；实现 9 个 UI 私有 op；把其余全部转发 `dispatchAsync` | 不实现业务逻辑 |
| `store-core.js` | 库 | 全部业务 + `dispatch` | 不知道 HTTP 存在 |

**HTTP 端点只有一个**，`kind:'exact'`，路径 `/redteam/api`。所有 op 都走 POST body 里的 `op` 字段区分——**没有 REST 风格的多端点**。

**环境门禁**（`ui.js:806-855`）：红队预设（`header.agentPreset === 'redteam'`）的 `turn<=1 && step<=1` 时，若 `envAdaptStatus(root).ready` 为假，直接 `return {kind:'reject', reason, messages:[]}`，阻止首轮开干。`ctx.effect` 包住，`installed` 标志防重复注册（`835-853`）。

---

## 4. 对外接口

### 4.1 HTTP op（全部走 `POST /redteam/api`）

**A. 无靶标前置分支（`store-core.js:812-931`）**

| op | 入参 | 出参 | 行号 |
|---|---|---|---|
| `bootstrap` | `engagement?` | `{ok, root, engagements, current}`；`current` 优先级 `req.engagement` > 指针 > 最近创建 | 812-820 |
| `openEngagement` | `name`, `scope?` | `{ok, engagement:{id,name,scope}}` | 821-823 |
| `activateEngagement` | `engagement`, `session?` | `{ok:boolean, current}`；`session` 非空时顺带 `setSessionBinding` | 824-830 |
| `sessionBinding` | `session`, `resolveRoot?` | `{ok, session, root_session, bound, name, current}` | 831-850 |
| `sessionBindings` | 同上 | 上者 + `agents`（已过滤失效靶标） | 851-855 |
| `bindSessionEngagement` | `session`(必), `engagement`, `name?` | `{ok, session, bound}` | 857-862 |
| `pocSearch` | `q`/`query`/`cve`/`component`, `templateLimit`, `templateOffset` | `{ok, items, stats, templates, dbPath, root}` | 864-874 |
| `pocList` | 同 `searchPocs` 的过滤字段 | `{ok, items, stats, dbPath, root}` | 875 |
| `templateSearch` | `q`, `limit`(≤200) | `{ok, ...}` | 876 |
| `templateStats` | — | `{ok, stats}` | 877 |
| `pocGet` | `id` 或 `code` | `{ok, ...}` | 878 |
| `pocSave` | `poc` 或平铺字段 | `{ok, ...}` | 879 |
| `pocUpdate` | `id`/`code`, `patch` | `{ok, poc}` | 880 |
| `pocDelete` | `id`/`code` | `{ok, ...}` | 881 |
| `pocUse` | `id`/`code`, `used_on` | `{ok, ...}` | 882 |
| `pocStats` | — | `{ok, stats}` | 883 |
| `platformConfigGet` | — | `platformSummary(root)` | 885 |
| `platformConfigSave` | `config` | `platformSummary(root)` | 886-889 |
| `platformAssignToolkit` | `dir` | `assignToolkitFolder` | 890 |
| `attention` | `engagement?`, `session?`, `resolveRoot?`, `limit?` | `{ok, engagement?, total, awaiting_person, items, pending_coverage, note}` | 899-917 |
| `attentionAck` | `engagement?`, `session_id`/`ids`/`all`, `limit?` | `{ok, engagement, acknowledged, at, ...attentionQueue}` | 922-931 |

**B. 需要靶标（`store-core.js:954-1014`，按源码顺序）**

| op | 入参要点 | 出参 | 行号 |
|---|---|---|---|
| `snapshot` | — | `{ok, engagement, ...}` | 954 |
| `assets` | `searchPocs` 式过滤（`f.q`/`cidr`/`limit`） | `{ok, items, total, ...}` | 955 |
| `asset` | `id` | `{ok, asset}` | 956 |
| `graph` | `cidr?` | `{ok, nodes, edges}` | 957 |
| `attackGraph` | `cidr?` | `{ok, nodes, edges}`（含 vuln 节点与 `has_vuln` 边） | 958 |
| `stats` | — | `{ok, stats}`（14 个计数） | 959 |
| `vulns` | 过滤 | `{ok, stats, items, total}` | 960 |
| `addVuln` | `vuln` 或平铺 | `{ok, ...}` | 961 |
| `updateVuln` | `id`, `patch` | `{ok, ...}` | 962 |
| `vulnStats` | — | `{ok, stats}` | 963 |
| `credentials` / `addCredential` | — / `credential` | `{ok, items}` / `{ok, ...}` | 964-965 |
| `access` / `addAccess` | — / `access` | 同上 | 966-967 |
| `sessions` | — | `{ok, ...sessionSummary}` | 968 |
| `webshells` / `addWebshell` / `updateWebshell` | — / `webshell` / `id`+`patch` | 同 | 969-971 |
| `tunnels` / `addTunnel` / `updateTunnel` | — / `tunnel` / `id`+`patch` | 同 | 972、977-978 |
| `shots` / `shotAdd` / `shotDelete` / `shotData` | — / `shot` / `id`\|`shot_id` | `{ok, items}` / … / `{ok, ...}` | 973-976 |
| `domains` | `cidr?` | `{ok, items}` | 979 |
| `web` | `cidr?` | `{ok, ...}` | 980 |
| `httpEvidence` / `addHttpEvidence` | — / `evidence` | `{ok, items}` / `{ok, id}` | 981-982 |
| `dataProofs` / `addDataProof` | `target`/`asset_id`/`limit` / `proof` | `{ok, total, items}` / `{ok, id, row_count, meets_threshold, fields}` | 983-984 |
| `cleanup` / `addCleanup` / `updateCleanup` | — / `item` | 同 | 985-987 |
| `chain` / `addChainStep` | — / `step` | `{ok, items}` / `{ok, ...}` | 988-989 |
| `report` | `options?` | `{ok, markdown, generated_at, stats}` | 990 |
| `assetTest` / `assessAsset` | `test`/`assess` | `{ok, ...}` | 991-992 |
| `scores` / `saveScorePoint` / `deleteScorePoint` / `addScoreHit` | 过滤 / `point` / `id` / `hit` | `{ok, ...}` | 993-996 |
| `scoreChain` / `scoreReport` | `f` / `options` | `{ok, ...}` | 997-998 |
| `activeTests` / `testStats` | 过滤 | `{ok, ...}` / `{ok, stats}` | 999-1000 |
| `consoleDigest` | — | `{ok, engagement, at, sections}`（16 个页签各自的 `{count, at}`） | 1002 |
| `stages` / `saveStage` | — / `stage` | `{ok, items}` / `{ok, ...}` | 1003-1004 |
| `reportTargets` | `options` | `{ok, ...}` | 1005 |
| `discoveryTimeline` | `limit` | `{ok, days, recent, span}` | 1007 |
| `attackFiles` / `addAttackFile` / `readAttackFile` | — / `file` / `id` | `{ok, items}` / … / `{ok, ...}` | 1008-1010 |
| `import` | `bundle` | `{ok, scan_run_id, counts, stats}` | 1011 |
| `prompts` / `savePrompt` / `resetPrompts` | — / `role`+`content` / `role?` | `{ok, roles}` / `{ok, ...}` | 1012-1014 |

**C. async 专属（`store-core.js:1026-1044`）**

| op | 入参 | 出参 |
|---|---|---|
| `intelStatus` | — | `{ok, templates, kev}` |
| `intelRefresh` | `force?` | `{ok, templates, kev}` |
| `probeSessions` | `engagement?`, `timeoutMs?` | `{ok, webshells[], tunnels[], checkedAt}` |

**「调用方」列的口径**（为免 80 行表格重复同一个值，这里一次性说明）：

| 调用方 | 覆盖的 op | 证据 |
|---|---|---|
| **面板**（`client.js` 的 `api()`，`client.js:10115`） | `attention`、`sessions`、`agentsStatus`、`scoreChain`、`scores`、`saveScorePoint`、`deleteScorePoint`、`scoreReport`、`snapshot`、`sessionBinding`、`sessionBindings`、`bindSessionEngagement`、`activateEngagement`、`consoleDigest`、`prompts`、`savePrompt`、`resetPrompts`、`skillCatalog`、`skillRead`、`attackFiles`、`readAttackFile`、`credentials`、`access`、`vulns`、`assets`、`asset`、`domains`、`web`、`discoveryTimeline`、`activeTests`、`probeSessions`、`setAgentsMax`、`platformConfigGet`、`platformConfigSave`、`platformEnvAdaptStatus`、`platformEnvAdaptSkip`、`platformAssignToolkit`、`version`、`updateCheck`、`updateApply` | 第 5 节逐条 |
| **agent 工具**（`tools.js`） | 与 §4.2 的 67 个工具一一对应；一个工具可能调多个 op（如 `redteam_asset` 调 `getAssetCoverage`/`updateAssetCoverage`/`closeAssetCoverage`） | §4.2 |
| **两者都调** | `attention`（工具 `redteam_attention` + 面板 `OverviewTab`）、`sessions`（工具 `redteam_sessions` + 面板 `OverviewTab`/`SessionTab`）、`probeSessions`（工具 `redteam_session_check` + 面板 `SessionTab`）、`prompts`（工具 `redteam_role_prompt` + 面板 `PromptsTab`）、`scoreReport`（工具 `redteam_score_report` + 面板 `ReportTab`） | 同上 |
| **无调用方**（只有 op，没人发） | `attentionAck`、`dataProofs`、`addDataProof`、`cleanup`/`addCleanup`/`updateCleanup`、`chain`/`addChainStep`、`report`、`reportTargets`、`import`、`graph`、`attackGraph`、`httpEvidence`/`addHttpEvidence`、`webshells`、`tunnels`、`shots`、`addScoreHit`、`stages`、`testStats`、`addAttackFile` | `[实测]` 逐个 grep `client.js` 零命中，且无对应工具 |

注意「无调用方」不等于死代码，要分清**op 没人发**与**能力没人用**两件事：

| 情形 | op | 说明 |
|---|---|---|
| op 无调用方，但能力有工具出口 | `attentionAck`（`redteam_attention action=ack`，`tools.js:1401`）、`dataProofs`/`addDataProof`（`redteam_data_proof`，`2503`）、`chain`（`redteam_chain`，`2053`）、`cleanup`（`redteam_cleanup`，`2531`）、`report`（`redteam_report`，`2172`）、`addScoreHit`（`redteam_score_hit`，`1906`）、`graph`（`redteam_asset_graph` 直接调 `store.graph`，`tools.js:1172`）、`shots`（`redteam_shot_list` 直接调 `store.listShots`，`tools.js:1546`）、`httpEvidence`（`redteam_http_evidence_add` 写、无 list 工具） | 工具绕过 op 直调 store 方法 |
| op 无调用方，工具也没有 | **`testStats`**（`store-core.js:1000` → `testStats()` 无任何工具或面板引用）、`stages`（`redteam_score_list` 间接读到阶段，但不发 `stages` op）、`reportTargets`（`redteam_report_targets` 调的是 `store.reportTargets` 而非 op） | 只有 op 这一层，属于可删/待接 |

`[实测]` `grep -c "op: 'testStats'" client.js` = 0；`grep -n "store.testStats" tools.js` 零命中。

**D. `ui.js` 私有 op**

| op | 入参 | 出参 | 行号 |
|---|---|---|---|
| `platformEnvAdaptStatus` | — | `{ok, ...envAdaptStatus}` | `ui.js:328` |
| `platformEnvAdaptSkip` | `skip?` | `{ok, ...markEnvAdaptSkip}` | `ui.js:329-331` |
| `agentsStatus` | — | `{ok, max, used, free, running[], total_children, parked, parked_labels, source, limit, default_max, note}` | `ui.js:759-768` |
| `setAgentsMax` | `max` | `{ok, max, source, limit, note}` | `ui.js:711-717` |
| `skillCatalog` | `refresh?` | `{ok, items, note}` 等 | `ui.js:511-` |
| `skillRead` | `name`, `library` | `{ok, ...}` | `ui.js:620-` |
| `version` / `updateCheck` / `updateApply` | `target?` | 恒 `{ok:false, sealed:true, current, updateAvailable:false, error:'私有固定版本，更新已关闭'}` | `ui.js:778-796` |

### 4.2 agent 工具（`tools.js`，共 67 个，全部 `output.schema = {type:'string'}`）

工具名前缀全部 `redteam_`。按角色分区：

| 区 | 工具（行号为首行 `ctx.tools.register`） |
|---|---|
| 会话/靶标 | `engagement_open`(570) `session_bind`(600) `session_info`(634) `preflight`(650) `agent_slot`(901) |
| 资产 | `asset_add`(990) `asset_link`(1075) `asset_query`(1101) `asset_get`(1133) `asset_stats`(1149) `asset_graph`(1160) `asset_test`(1219) `asset`(1277) `asset_next`(1311) `asset_assess`(1971) `asset_timeline`(2556) |
| 覆盖度/下一步 | `host`(1327) `next_action`(1371) `attention`(1387) |
| 漏洞/凭据/会话 | `vuln_add`(1412) `vuln_query`(1438) `vuln_update`(1459) `credential_add`(1482) `credential_list`(1566) `access_add`(1581) `access_list`(1603) `sessions`(1637) `webshell_add`(1662) `webshell_list`(1685) `webshell_update`(1700) `tunnel_add`(1719) `tunnel_list`(1745) `tunnel_update`(1759) `session_check`(1781) `pivot_probe`(2483) |
| 证据 | `shot_add`(1508) `shot_list`(1534) `shot_delete`(1552) `http_evidence_add`(1993) `data_proof`(2503) `cleanup`(2531) |
| 攻击链/报告 | `attack_path`(1802) `chain_add`(2017) `chain`(2053) `attack_chain`(2122) `score_report`(2151) `report`(2172) `report_targets`(2103) |
| 计分 | `score_list`(1870) `score_hit`(1906) `score_point_save`(1950) |
| 知识库 | `poc_search`(2189) `poc_get`(2279) `poc_add`(2294) `poc_list`(2345) `poc_update`(2363) `poc_use`(2386) `template_refresh`(1246) |
| 攻击文件 | `attack_file_add`(2064) `attack_file_list`(2088) |
| 提示词/角色 | `role_prompt`(1184) `roles`(1206) `role_prompt_reset`(1617) |
| 其它 | `web_list`(1833) `domain_index`(1857) `scope_check`(2403) `batch`(2419) |

**统一返回形状**：`JSON.stringify(result, null, 2)` 字符串 → `output.render` 包成 `[{type:'text', text}]`（`tools.js:284`）。工具内部一律先 `resolveEngagement(store, exec, args.engagement)` 拿靶标 id（40+ 处，见 `1053`/`1089`/`1119`/…）。

**错误包装**：每个工具都过 `withStructuredErrors(defineTool({...}))`，把抛错转成结构化文本而不是异常。

### 4.3 事件

| 事件 | 方向 | 处理 | 行号 |
|---|---|---|---|
| `agent/created` | 监听（global, prepend） | 非根直接 return；否则 `ensureRedteamTeamMode`（同步写，保证 `createAgent` 返回前落盘） | `team-mode.js:196-205` |
| `session/event` | 监听（global） | 只在 `type === 'agent-preset/selected'` 时：清 `checked`、`forgetTeamModeCheck`，红队+根 → `queueMicrotask` 写 | `team-mode.js:218-235` |
| `agent/pre-step` | 监听（global, prepend） | ① team-mode 兜底重判（`team-mode.js:239-250`）② 环境门禁 reject（`ui.js:841`） | — |
| `subagent/end` | 监听 | `unparkAgent` + 解析回报落 `agent_report` + 释放预留 | `tools.js:527-565` |
| `agent/inbox/claimed` | 监听（global, prepend） | 抓 `redteamRole:` 标记记角色 | `role-section.js:136-176` |
| `team/mode` | **发出** | `session.append('team/mode', {enabled:true})` | `team-mode.js:122` |

### 4.4 slot / 服务

| 类型 | 名称 | 内容 | 行号 |
|---|---|---|---|
| Cordis 服务 | `redteam` | `RedteamStore` 实例 | `store.js:85` |
| Cordis 服务 | `redteamMode` | `Object.freeze({paths, preset, setup})` | `index.js:1121` |
| inject | `store.js` | `[]` | `store.js:23` |
| inject | `ui.js` | `['redteam','webServer']` | `ui.js:199` |
| inject | `index.js` | `[]` | `index.js:22` |

### 4.5 CLI

**没有独立 CLI**。`store-core.js` 的注释说「CLI、HTTP 桥接、智能体工具共用同一套 op 词汇」（`801-803`），但 safe 包里没有任何 bin 脚本；`dispatch` 只能被 `ui.js`、`tools.js` 或外部 import 调用。

---

## 5. UI 触点

只列**这个 op 被哪个前端组件调用**（`client.js`）。`api(req)` 是统一的 `POST /redteam/api` 包装（`client.js:10115-10119`）。

| 组件 | 文件:行 | 依赖的 op | 展示字段 | 交互 |
|---|---|---|---|---|
| `OverviewTab` | `client.js:10348`（调用 `10366-10370`、`10386`） | `scoreChain`、`scores`、`sessions`、`agentsStatus`、`attention` | `attention.items[].{session_id,status,stage,reason,needs,at}`、`total`、`awaiting_person`、`pending_coverage`、`note` | 「刷新」按钮重跑 `load()`；`attention` 单独再拉一次做二次比对（`10386`） |
| `ChainTab` | `client.js:11817`（`11829`） | `scoreChain` | 阶段达成/缺口 | 切 `scoreView`（`current`） |
| `ReportTab` | `client.js:12161` | `scoreReport`、`scoreChain` | 报告正文 + 命中溯源 | 生成/复制报告 |
| `ScoreTab` | `client.js:13524`（`13538`、`13562`、`13582`） | `scores`、`saveScorePoint`、`deleteScorePoint` | 25 条得分点、命中、封顶原因 | 编辑分值/上限/启用；删除自建点 |
| `TestingTab` | `client.js:13937` | `activeTests` | 待测资产队列 | 刷新 |
| `SessionTab` | `client.js:14057`（`14068`、`14078`） | `sessions`、`probeSessions` | 马/隧道列表、`status`/`latency_ms`/`check_note` | 「实测连通」按钮 → `probeSessions` |
| `DiscoveryView` | `client.js:11093` | `discoveryTimeline` | `days[]`、`recent[]`、`span` | 切时间线视图 |
| `PromptsTab` | `client.js:11148`（`11148`、`11165`、`11179`、`11183`） | `prompts`、`savePrompt`、`resetPrompts` | 6 个角色的正文与 `updated_at` | 编辑保存；单角色/全部重置 |
| `SkillsTab` | `client.js:11245`（`11245`、`11271`） | `skillCatalog`、`skillRead` | 技能目录与可用性 | 刷新；点开读正文 |
| `ArtifactsTab` | `client.js:11514`（`11514-11516`） | `attackFiles`、`credentials`、`access` | 攻击文件树、明文凭据、访问会话 | 点开读文件 |
| `FindingsTab` | `client.js:11577` | `vulns` | 漏洞列表与统计 | 过滤 |
| `AttackFilesTab` | `client.js:12398` | `attackFiles`、`readAttackFile` | 文件树与正文 | 点开读 |
| `AgentsTab` | `client.js:15421`（`15438`） | `agentsStatus` | `max/used/free/running/parked/parked_labels` | 刷新（5 秒轮询，`15477` 注释） |
| `ConcurrencyCard` | `client.js:15529`（`15545`） | `setAgentsMax` | 当前上限与来源 | 改数字立即生效 |
| `SessionMap` | `client.js:14798` | **不走 op**：`POST /api/session/list`（宿主内部 RPC，`14719-14748`）+ `sessionBindings`（`14761`） | 会话树、父子关系、绑定靶标 | 只读；6 秒超时；失败保留上次快照 |
| `Panel` | `client.js:15678`（`15714`、`15744`、`15855`、`16049`、`16051`） | `snapshot`、`sessionBinding`、`consoleDigest`、`bindSessionEngagement`、`activateEngagement` | 靶标下拉、红点、当前绑定 | 切靶标：先 `activateEngagement`（改全局指针），有 `sessionId` 时**同时** `bindSessionEngagement` |
| `OverviewTab`/`Panel` | `10367`/`15855` | `scores`、`consoleDigest` | 页签红点 | 进入页签即清 |

**面板没有调用方的 op**（后端有、前端零调用，`[实测]` 逐个 grep）：

`attentionAck`、`dataProofs`、`addDataProof`、`cleanup`、`addCleanup`、`updateCleanup`、`chain`、`addChainStep`、`report`、`reportTargets`、`import`、`graph`、`attackGraph`、`httpEvidence`、`addHttpEvidence`、`webshells`、`tunnels`、`shots`、`addScoreHit`、`stages`、`testStats`、`addAttackFile`。

其中两条值得单独记：

1. **`attentionAck` 没有面板出口**。态势页能看见「谁在等我」，但**点不掉**——只有 `redteam_attention action=ack` 工具能摘。这正是 `attentionQueue` 注释里担心的「同一条 waiting 每轮重新算」的成因之一。
2. **`data_proof` 没有面板出口**。`ReportV2` 第一段「归属证明」要读这张表，但前端连 `dataProofs` 都没调过一次——表在、op 在、UI 不在。

---

## 6. 依赖

### 6.1 内部（同库模块）

| 模块 | 依赖 |
|---|---|
| `store-core.js` | `ip-utils`、`report-replay`、`schema`、`validate`、`score-rules`、`platform-config`；动态 import `bootstrap-runtime`、`kev`（`53-55`） |
| `schema.js` | `score-rules`（只借 `parseTargetPort`） |
| `score-rules.js` | `ip-utils` |
| `bootstrap-runtime.js` | `../zip-extract.js`、`schema`、`platform-config`、`kev` |
| `store.js` | `store-core` |
| `tools.js` | `store-core`（`ROLE_TITLES`/`PLANNER_ROLE`/`ROLE_ORDER`）、`skill-availability`、`platform-config`、`settings`、`bootstrap-runtime`（`templatesStatus`/`refreshTemplateLibrary`）、`kev`、`slot-state` |
| `ui.js` | `store-core`（`dispatch`/`dispatchAsync`）、`skill-availability`、`settings`、`slot-state`、`platform-config` |
| `index.js` | `preset-composition`、`team-mode`、`../preset-default` |
| `role-section.js` | `../identity`、`platform-config` |
| `team-mode.js` | `../identity` |

### 6.2 宿主 API / RPC / slot（逐个标注是否公开）

| 能力 | 用法 | 位置 | 公开性 |
|---|---|---|---|
| `ctx.tools.register` + `defineTool` | 注册 67 个工具 | `tools.js` 全文 | 公开 |
| `ctx.on('agent/created' \| 'session/event' \| 'agent/pre-step' \| 'subagent/end' \| 'agent/inbox/claimed')` | 5 个事件钩子 | 见 4.3 | 公开 |
| `ctx.effect(fn)` | 卸载清理（关库、解绑、删定时器） | `store.js:81`、`tools.js:524`、`ui.js:835`、`index.js:1066` | 公开 |
| `ctx.provide(name, value)` | `redteam`、`redteamMode` | `store.js:85`、`index.js:1121` | 公开 |
| `ctx.get(name)` | `agentPresets`（`index.js:992`）、`subagents`+`sessions`（`ui.js:719-720`）、`skills`（`ui.js:490`，经 `softService` `ui.js:427-435`）、`agentTeams`（`team-mode.js:152`）、`ptcRuntime`（`index.js:579`） | 同左 | 公开 |
| `ctx.webServer.register({kind:'exact', path, handler})` | 唯一 HTTP 路由 | `ui.js:857` | 公开 |
| `ctx.baseUrl` | profile 目录（需 `fileURLToPath` 转换，`ui.js:302-314` 有踩坑注释） | `ui.js:308-314` | 公开但语义易错 |
| `agentPresets.register(definition)` / `.list()` | 把 redteam 预设注册进模式下拉 | `index.js:1041-1047` | 公开 |
| `subagents.listChildren(rootId)` | 并发占用统计 | `ui.js:742` | 公开 |
| `sessions.list()` | 列根会话 | `ui.js:733` | 公开 |
| `session.append(type, data)` | 写 `team/mode` | `team-mode.js:122` | 公开 |
| `session.snapshotEvents()` / `session.events` | 读事件表判 `team/mode` 是否已存在 | `team-mode.js:29-41` | **两个来源都试**，字段随版本变 |
| `header.origin` / `header.delegationDepth` / `header.agentPreset` / `header.parentSession` | 判根会话/判预设 | `team-mode.js:54-76`、`ui.js:733-739`、`tools.js:150-156` | 公开但**语义有坑**：注释明写不能拿 `parentSession` 判根（`team-mode.js:63-68`） |
| **`POST /api/session/list`（`method:'session/list'`, `rpcId`, `payload.args._request`）** | 会话树数据 | `client.js:14719-14748` | **内部 RPC，无版本承诺** |
| slot | 本模块**不注册任何 slot** | — | — |

### 6.3 外部

| 类型 | 目标 | 用途 | 失败行为 |
|---|---|---|---|
| HTTPS | `www.cisa.gov/.../known_exploited_vulnerabilities.json` | KEV 公告 | 静默，返回 `{action:'failed'}` |
| git/https | `github.com/projectdiscovery/nuclei-templates.git`（+ ghproxy 镜像） | 模板库 | 换下一个 URL，全失败只记 `bootstrap.log` |
| https | `codeload.github.com`、`mirror.ghproxy.com` | 同上（tar/zip 兜底） | 同上 |
| 子进程 | `git`、`tar`、`unzip`（`runHidden`，`bootstrap-runtime.js:271-280`） | 解包/拉取 | 抛错被上层吞 |
| 子进程 | `pnpm`/`npm`（`ui.js:207-290` 的 `run`） | **仅 `handleUpdateOp` 用，而它已恒返回 sealed，实际不会执行** | — |
| 网络（出站） | 任意 webshell `url`（GET）、任意 `host:port`（TCP） | `probeSessions` | 记 `offline`/`down` + note |
| 文件系统 | `$DSH_HOME/redteam/**`（见 2.0） | 全部持久化 | 见各节 |
| 文件系统（读） | `~/.dsh/.agent-presets/redteam`、`<包>/presets/redteam`、`<包>/skills` | 预设/技能落地 | `installPreset` 失败只记日志并返回 `action:'failed'` |
| 环境变量 | `DSH_HOME`、`REDTEAM_HOME`、`REDTEAM_MAX_AGENTS`、`REDTEAM_KEV`、`REDTEAM_NO_FTS5`、`REDTEAM_TEMPLATE_REFRESH_HOURS`、`REDTEAM_PRESET_REFRESH` | 见各节 | 缺省即默认 |
| Node 内置 | `node:sqlite`（**硬依赖**）、`node:fs`、`node:path`、`node:os`、`node:net`、`node:crypto`、`node:http`、`node:https`、`node:child_process`、`node:module`、`node:url` | — | `node:sqlite` 缺失则模块加载即失败 |

**零外部 npm 依赖**：`store.js:12` 明写「零外部依赖：只用 node: 内置模块，避免 profile 下解析不到 node_modules」。

---

## 7. 与另一版的差异

> **本节口径限制**：本次任务未提供 community 1.7.20 的对照结论，本节只做了「community 目录里有没有同名文件」这一层结构对比，**未逐函数读 community 源码**。同目录下 `02-community-redteam-backend.md` 是同批审计的另一份产物，**本文件没有读取它的结论**，需要跨版本行号对照时请以那份为准。行号只列 safe 侧；community 侧只标「文件存在/不存在」。

| 能力 | community 文件 | safe 行号 | 差异性质 |
|---|---|---|---|
| `agent_report` 表 | `schema.js` 存在 | `schema.js:373-390` | **community 是否有对应实现我未查** |
| `attention` / `attentionQueue` | `store-core.js` 存在 | `store-core.js:899-917`、`2058-2107` | **community 是否有对应实现我未查** |
| `attentionAck` / `acknowledged_at` | `store-core.js` 存在 | `2008-2032`、`schema.js:607` | **community 是否有对应实现我未查** |
| `sessions.json` 会话绑定 | `store-core.js` 存在 | `1117-1177` | **community 是否有对应实现我未查** |
| `data_proof` 表 | `schema.js` 存在 | `schema.js:270-277` | **community 是否有对应实现我未查** |
| `slot-state.js`（挂起让位） | **文件不存在** | `slot-state.js:1-46` | **新增**（community 目录无此文件）`[实测]` `ls` |
| `kev.js`（KEV 公告层） | **文件不存在** | `kev.js:1-178` | **新增** |
| `bootstrap-runtime.js`（启动铺路） | **文件不存在** | `bootstrap-runtime.js:1-666` | **新增** |
| `team-mode.js`（团队模式默认开） | **文件不存在** | `team-mode.js:1-258` | **新增** |
| `atomic-write.js`（原子写） | **文件存在** | **safe 无此文件** | **删除**：safe 全部改直写 `writeFileSync` |
| `evidence-ledger.mjs`（证据账本） | **文件存在** | **safe 无此文件** | **删除** |
| 13 个 `.css` | 无 | `assets-view.css` 等 | **新增**（safe 独有，community 目录只有 js） |

---

## 8. 风险与脆弱点

| # | 风险 | 触发条件 | 后果 | 可静态检出 |
|---|---|---|---|---|
| R-01 | **无靶标时未知 op 返回成功** | 新装/删光靶标后，前端或工具发任何拼错的 op | 调用方拿到 `{ok:true, items:[]}`，误判为「查了但没有」 | 是（`store-core.js:951` 在 `1015` 之前）`[实测]` |
| R-02 | **`sessions.json` 无原子写** | 两个 dsh 进程同时写、或写到一半被杀 | 文件截断 → 下次 `JSON.parse` 失败 → **全部绑定丢失**（`1127` 的 `catch` 把它当「还没绑过」） | 是（`1174` 直写） |
| R-03 | **`sessions.json` 无锁** | 多进程/多窗口 | 后写者覆盖先写者，静默丢绑定 | 是（`1166-1174` 读-改-写） |
| R-04 | **`settings.json` / `config.json` 同样无原子写** | 同上 | 半个 JSON → 设置全丢回默认 | 是（`settings.js:38`、`platform-config.js:173`） |
| R-05 | **`SessionMap` 依赖宿主内部 RPC** | 宿主升级改了 `/api/session/list` 的 `rpcId`/`method`/`payload` 形状 | 会话树**静默空白**，不报错（超时后走「保留上次快照」文案） | 是（`client.js:14731-14745`） |
| R-06 | **`attention` 队列可无限增长** | 子智能体反复写 `waiting` 而没人 ack；面板**没有 ack 出口** | 侧栏角标永远非空，提示词每轮重复生成同一段 | 是（`2058` 只读 `acknowledged_at`；`attentionAck` 无前端调用方） |
| R-07 | **敏感数据门槛两套口径** | `data_proof` 用 10000，`score-rules` 用 1000000 | 面板标「达标」而计分不给分（或反之），报告与得分对不上 | 是（`store-core.js:4885` vs `score-rules.js:494`） |
| R-08 | **`agent_report` 每会话只留 20 条** | 长会话高频回报 | 第 21 条起**静默删除最老的**（`1991`），被删的若是唯一未 ack 的 `waiting`，该等待**永久消失** | 是（`1991`） |
| R-09 | **`node:sqlite` 是硬依赖** | Node 构建不带 sqlite / 被裁剪 | 整个 `store-core`、`schema`、`bootstrap-runtime` 加载失败 → 插件完全不可用，无降级 | 是（`schema.js:1`、`store-core.js:1`、`bootstrap-runtime.js:14`） |
| R-10 | **`probeSessions` 出站任意地址** | 有人往 `webshell.url` 或 `tunnel.listen` 写内网/元数据地址 | host 侧替调用方发起 GET/TCP，可做内网探测 | 是（`4716`、`4746`，无白名单/无 scheme 校验） |
| R-11 | **`/redteam/api` 来源校验可被 `Host` 头绕过** | 攻击者能控制发往本机的 `Host` 头为 `localhost` | 条件 (c) 放行 `Origin:null`/`app:`，等于放开跨站（`885-891`） | 是 |
| R-12 | **`addAttackFile` 的 `f.path` 是任意文件读取源** | 智能体传 `f.path`（绝对路径或相对靶标目录）且不传 `f.content` | `copyFileSync` 把该文件复制进 `attack-files/`（`5243-5245`），随后 `readAttackFile` 正常返回其内容（`5290` 只校验**目标**路径在本靶标目录内）→ 等价于「任意文件读 + 落盘持久化」 | 是（写入目标路径**有**校验 `5239`，读取源路径**无**校验 `5243`） |
| R-13 | **`bindings` / `parked` / `reservations` 全在进程内** | 重启 | 绑定、挂起、预留全丢；`redteam_session_info` 的 note 明写要重新绑（`645`） | 是 |
| R-14 | **`team-mode` 可能给不认识的宿主塞事件** | `hostUsesTeamGate` 读不到 `agentTeams` 时**默认按新版**（`153`） | 往老宿主日志写一条它不认识的 `team/mode` | 是（`150-159`） |
| R-15 | **`config.json` 里存明文密钥** | 用户填了 `FOFA_KEY` / `REDTEAM_VPS_KEY` | 明文落盘（`platform-config.js:68-72`） | 是 |
| R-16 | **`credential.secret_value` 明文** | 设计如此（`schema.js:221-222` 注释「面板直接显示」） | 库文件泄露即凭据泄露 | 是 |
| R-17 | **`stage` 懒播种与 `openEngagement` 不一致** | 建了靶标但没读过 `listStages` 就导出 | `stage` 表为空，`scoreChain` 的阶段分组缺内容 | 是（`1260` 只 `seedScorePoints`） |
| R-18 | **`kev.js:9` 注释量级错** | 维护者按注释估缓存大小 | 实际 1786 条 / 328KB，不是 1.6 万条 | 是 `[实测]` |
| R-19 | **`ui.js` 与 `store-core.js` 各有一份 `platformConfigGet/Save`** | 改了一处忘另一处 | CLI/工具与面板行为分叉 | 是（`ui.js:332-337` vs `store-core.js:885-890`） |
| R-20 | **`updateApply` 恒失败但保留代码路径** | 有人以为能自动更新 | `handleUpdateOp` 直接返回 sealed（`782-795`），`run()`/`packageManagerOf` 全是死代码 | 是 |

---

## 9. 逐条功能清单

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| SF-RT-001 | op 统一分发（同步） | `store-core.js:808-1019` | 完整 | 82 个 op 分支；`unknown op` 在无靶标时被吞（R-01） |
| SF-RT-002 | 异步分发（intel + probe） | `store-core.js:1025-1046` | 完整 | 只多 3 个 op |
| SF-RT-003 | 靶标库 DDL + 迁移 | `schema.js:67-448`、`554-749` | 完整 | 先 PRAGMA 再 ADD COLUMN，可重复执行 |
| SF-RT-004 | 知识库 DDL + 迁移 | `schema.js:452-489`、`757-782` | 完整 | 两个索引必须延后建 |
| SF-RT-005 | FTS5 能力探测与降级 | `schema.js:31-44`、`store-core.js:1202` | 完整 | `REDTEAM_NO_FTS5=1` 可强制降级 |
| SF-RT-006 | 靶标生命周期（open/list/activate） | `store-core.js:1220-1266`、`1107-1112` | 完整 | id = slugify(name)，**小写化** |
| SF-RT-007 | `current` 指针 + 回落 | `store-core.js:1094-1104` | 完整 | 指针失效 → 回落最近创建 |
| SF-RT-008 | 会话绑定读写 | `store-core.js:1117-1177` | 完整 | 200 条上限、失效靶标剔除、写失败静默 |
| SF-RT-009 | `sessionBinding` op | `store-core.js:831-850` | 完整 | 支持 `resolveRoot` 注入 |
| SF-RT-010 | `sessionBindings` op + 过滤 | `store-core.js:851-855` | 完整 | 只留靶标仍存在的条目 |
| SF-RT-011 | `bindSessionEngagement` op | `store-core.js:857-862` | 完整 | 失败不带 error 字段 |
| SF-RT-012 | `attention` 三档靶标解析 | `store-core.js:899-917` | 完整 | 显式 > 会话绑定 > 指针 |
| SF-RT-013 | `attentionQueue` 排序 | `store-core.js:2058-2107` | 完整 | 6 档 rank；`dropped` 剔除；按 `created_at` 倒序同档 |
| SF-RT-014 | `attention` 的 `pending_coverage` | `store-core.js:2088-2094` | 完整 | = hostNextActions.total + assetNextActions.total |
| SF-RT-015 | `attentionAck` 三用法 | `store-core.js:922-931`、`2008-2032` | 完整 | **面板无出口** |
| SF-RT-016 | `agent_report` 落库 | `store-core.js:1970-1994` | 完整 | 20 条/会话上限（R-08） |
| SF-RT-017 | 回报解析 | `store-core.js:1894-1967` | 完整 | 6 值 status；`needs` 括号配平 |
| SF-RT-018 | `latestAgentReports` | `store-core.js:2035-2046` | 完整 | 每子会话最新一条，limit ≤200 |
| SF-RT-019 | `data_proof` 写入 + 校验 | `store-core.js:4873-4886` | 完整 | 门槛 10000（与计分口径冲突，R-07） |
| SF-RT-020 | `data_proof` 查询 | `store-core.js:4888-4902` | 完整 | `fields` 回读拆数组 |
| SF-RT-021 | 得分点播种（25 条） | `store-core.js:2200-2310` | 完整 | 旧点+命中先存档再删 |
| SF-RT-022 | 得分点 CRUD | `store-core.js:2555-2633` | 完整 | 内置点分值锁定 |
| SF-RT-023 | 得分命中写入 + 边界校验 | `store-core.js:2649-2785` | 完整 | points 上限 = max(cap, 默认×100, 1000) |
| SF-RT-024 | 去重口径 + 规则封顶 | `score-rules.js:162-263` | 完整 | 服务键拿不到就不封顶 |
| SF-RT-025 | 倍率（G5 数据翻倍 / G6 IPv6） | `score-rules.js:407-434` | 完整 | 乘在权限分上 |
| SF-RT-026 | 得分报告（命中溯源） | `store-core.js:3397-4490`、`#hitTrace:3227` | 完整 | 反查 vuln/step/http_evidence |
| SF-RT-027 | 攻击链（scoreChain） | `store-core.js:4491-` | 完整 | 返回 items/stages/achieved/missing/summary |
| SF-RT-028 | 报告生成 | `store-core.js:5864-` | 完整 | 返回 markdown |
| SF-RT-029 | 资产导入（importBundle） | `store-core.js:6045-6127` | 完整 | 单事务，失败 ROLLBACK |
| SF-RT-030 | 资产/端口/服务/指纹 upsert | `store-core.js:5968-6044` | 完整 | 附 `#observe`/`#edge`/`#reindex` |
| SF-RT-031 | 图谱投影 | `store-core.js:2110-2138` | 完整 | segment→asset→port→domain |
| SF-RT-032 | 攻击图谱（叠加漏洞） | `store-core.js:4774-4811` | 完整 | `has_vuln` 边 |
| SF-RT-033 | 主机覆盖度 + 下一步 | `store-core.js:1629-1793` | 完整 | 7 维覆盖度 + 优先级排序 |
| SF-RT-034 | 资产覆盖度 + 下一步 | `store-core.js:1797-1893` | 完整 | surface/web/auth/cve/app 五维 |
| SF-RT-035 | 连通性实测 | `store-core.js:4705-4767` | 完整 | host 侧专属；无白名单（R-10） |
| SF-RT-036 | 截图（元数据 + 尺寸嗅探） | `store-core.js:5043-5170`、`pngSize:1058-1082` | 完整 | 自解析 PNG/JPEG/WebP，零依赖 |
| SF-RT-037 | 攻击文件树 + 读 | `store-core.js:5219-5299` | 完整 | `assertPathWithin` 保护读 |
| SF-RT-038 | POC 知识库 CRUD + FTS 检索 | `store-core.js:5436-5730` | 完整 | FTS5 缺席走 LIKE |
| SF-RT-039 | nuclei 模板索引 | `store-core.js:5323-5434` | 完整 | 目录签名 + 缓存失效 |
| SF-RT-040 | 提示词 6 角色 + 默认刷新 | `store-core.js:6128-6230` | 完整 | 指纹判定「是否原装默认」 |
| SF-RT-041 | 作战阶段（5 阶段懒播种） | `store-core.js:2144-2199` | 完整 | open 时不建（R-17） |
| SF-RT-042 | 控制台未读摘要（16 页签） | `store-core.js:1322-1393` | 完整 | 知识库单列，拿不到当 0 |
| SF-RT-043 | 发现时间线 | `store-core.js:1274-1293` | 完整 | 按天聚合 + 内外网拆分 |
| SF-RT-044 | 环境适配配置 | `platform-config.js:90-174`、`343-387` | 完整 | 明文密钥（R-15） |
| SF-RT-045 | 工具 PATH/文件夹探测 | `platform-config.js:191-330`、`409-553` | 完整 | 30 个工具 id |
| SF-RT-046 | 环境就绪门禁 | `platform-config.js:554-633`、`ui.js:806-855` | 完整 | 首轮首步 reject |
| SF-RT-047 | 启动铺路（ensureRedteamRuntime） | `bootstrap-runtime.js:548-666` | 完整 | 失败全部只记日志 |
| SF-RT-048 | 模板库拉取（git/tar/zip 三路） | `bootstrap-runtime.js:271-404` | 完整 | 互斥锁 + 镜像兜底 |
| SF-RT-049 | 模板按龄刷新 | `bootstrap-runtime.js:405-479` | 完整 | 6 种 skip reason |
| SF-RT-050 | KEV 公告层 | `kev.js:1-178` | 完整 | 24h TTL，失败静默，零 sqlite |
| SF-RT-051 | 情报 op 出口 | `store-core.js:53-74` | 完整 | 动态 import 省启动成本 |
| SF-RT-052 | 并发闸门（agent_slot） | `tools.js:901-988`、`settings.js` | 完整 | used = max(注册表, 预留) |
| SF-RT-053 | 挂起让位（parked） | `slot-state.js:1-46` | 完整 | 进程内，500 上限 |
| SF-RT-054 | 子智能体结束自动收尾 | `tools.js:524-568` | 完整 | unpark + 落回报 + 释放预留 |
| SF-RT-055 | 靶标解析（防串写） | `tools.js:211-240` | 完整 | 指针被占时**抛错** |
| SF-RT-056 | 根会话解析（父链回溯） | `tools.js:169-200` | 完整 | 64 层保护；父不在内存用父 id 当根 |
| SF-RT-057 | 67 个 agent 工具 | `tools.js` 全文 | 完整 | 统一 `withStructuredErrors` |
| SF-RT-058 | HTTP 桥 `/redteam/api` | `ui.js:857-948` | 完整 | 单端点，op 区分 |
| SF-RT-059 | 来源校验（CORS 等价） | `ui.js:870-904` | 完整 | 可被 Host 头绕过（R-11） |
| SF-RT-060 | 请求体大小限制 | `ui.js:356-377` | 完整 | 超限 destroy socket |
| SF-RT-061 | 403 审计日志 | `ui.js:398-408` | 完整 | 不记 body/cookie |
| SF-RT-062 | 智能体并发状态（面板） | `ui.js:708-769` | 完整 | 与工具同口径 |
| SF-RT-063 | 并发上限持久化 | `ui.js:711-717`、`settings.js:64-68` | 完整 | 立即生效 |
| SF-RT-064 | 技能目录/正文 | `ui.js:486-707`、`skill-availability.js` | 完整 | 宿主 skills 不可用时走包内文件兜底 |
| SF-RT-065 | 版本/更新 op | `ui.js:778-796` | **部分** | 恒 sealed，`run()`/`packageManagerOf` 是死代码（R-20） |
| SF-RT-066 | 预设安装 | `index.js:869-939` | 完整 | `REDTEAM_PRESET_REFRESH=1` 强制重铺 |
| SF-RT-067 | 预设注册进模式下拉 | `index.js:1015-1090` | 完整 | 2 轮自愈 + broken 检测 + 45s 超时 |
| SF-RT-068 | 随包技能同步 | `index.js:189-` | 完整 | 多目标复制 |
| SF-RT-069 | `setup.sh` 落地 | `index.js:71-113` | 完整 | 内容变化才写 |
| SF-RT-070 | 团队模式默认开 | `team-mode.js:94-258` | 完整 | 三入口 + 幂等 + 版本探测 |
| SF-RT-071 | 子智能体角色注入 | `role-section.js:116-176` | 完整 | 从 `agent/inbox/claimed` 抓标记 |
| SF-RT-072 | 预设 YAML 解析 | `preset-composition.js:42-402` | 完整 | 手写子集：block scalar、flow seq、absolutize |
| SF-RT-073 | 报告可复现片段 | `report-replay.js:1-209` | 完整 | curl 解析/重建 + 模板填充 |
| SF-RT-074 | 路径穿越防护（读写两处） | `validate.js:58-67`；写入侧 `store-core.js:5239`，读取侧 `store-core.js:5290` | 完整 | 两处都校验**目标**路径；`addAttackFile` 的**源**路径不校验（R-12） |
| SF-RT-075 | 马类型/状态枚举校验 | `validate.js:20-43` | 完整 | 非法值**抛错**不静默存 |
| SF-RT-076 | 会话→靶标绑定落盘 | `store-core.js:1162-1177` | 完整 | 但无原子写/无锁（R-02/R-03） |
| SF-RT-077 | `SessionMap` 会话树（前端） | `client.js:14719-14800` | 完整 | 依赖宿主内部 RPC（R-05） |
| SF-RT-078 | 原子写层 | — | **缺失** | safe 删除 community 的 `atomic-write.js` |
| SF-RT-079 | 证据账本 | — | **缺失** | safe 删除 community 的 `evidence-ledger.mjs` |
| SF-RT-080 | CLI 入口 | — | **缺失** | 注释声称支持 CLI（`801-803`），包里无 bin |

---

## 10. 未验证项

| # | 未验证 | 缺什么才能验证 |
|---|---|---|
| U-01 | ❓未验证：`team-mode` 在宿主 0.2.1-rc.5 上是否真的让 `team_task_*` 出现 | 需要在运行中的红队会话里数工具目录（`ctx.tools` 可见项），本审计只读代码 |
| U-02 | ❓未验证：`agent/pre-step` 环境门禁是否真能 reject 首步 | 需要一次真实红队会话的首轮首步 |
| U-03 | ❓未验证：`addAttackFile` 的 `f.path` 分支在真实调用中是否被智能体用来读过靶标外的文件 | 代码路径已读完（`5226-5259`）；缺一次真实工具调用日志来确认是否被触发 |
| U-04 | ❓未验证：`/redteam/api` 的 Host 头绕过在真实部署下是否可利用 | 需要一次带自定义 `Host` 头的实测请求（本审计未发请求到宿主端口） |
| U-05 | ❓未验证：community 各能力的对应实现与行号 | 需要逐函数读 `vendor/community/lib/redteam/store-core.js`（本审计只做文件存在性对比） |
| U-06 | ❓未验证：`node:sqlite` 缺失时的真实表现 | 需要在不带 sqlite 的 Node 构建上 import（本机 v26.13.1 自带） |
| U-07 | ❓未验证：`preset-composition` 手写 YAML 解析器对真实 `agent.cordis.yml` 的覆盖度 | 需要跑 `readPresetDefinition('redteam', dir)` 并比对 `plugins` 数量与文件实际条目 |
| U-08 | ❓未验证：`scoreReport` 的 `#hitTrace` 在「只有 target 没有显式关联」时的归因准确率 | 需要构造一组只填 `target` 的命中，比对 `http_evidence` 的 LIKE 兜底结果 |
| U-09 | ❓未验证：`report` 生成的 markdown 在 500+ 命中时的耗时 | 需要压测 |
| U-10 | ❓未验证：`role-section` 的角色注入在「父会话已回收」时能否读到 `runs/` 之外的角色文件 | 需要一次冷启动子会话 |
