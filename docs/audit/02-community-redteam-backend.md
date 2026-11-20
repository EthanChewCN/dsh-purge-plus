# community 1.7.20 · 演练台后端全量审计

> 范围：`vendor/community/lib/redteam/` 下 19 个文件（不含浏览器半侧 `client.js`）。
> 行号一律相对 `vendor/community/lib/redteam/`，除非显式写成 `lib/xxx`（相对 `vendor/community/lib/`）或 `cordis.patch.yml`（相对包根）。
> 标记：`[静态]` = 只读源码得出；`[实测]` = 本机实跑过（Node v26.13.1，`node:sqlite` 带 FTS5，临时目录 `/tmp/rt_probe/*`，未改动仓库内任何文件）。
> 本次审计不覆盖 safe 2.0.0（见 §7）。

---

## 1. 模块清单

挂载方式来自 `cordis.patch.yml:57-74` 与 `presets/redteam/agent.cordis.yml:127-128`：host 平面挂 `redteam`(index.js) / `redteam/store`(store.js) / `redteam/ui`(ui.js) 三行，preset 平面挂 `redteam/tools`(tools.js) 一行。`index.js` 只 `import` 了 `preset-composition.js`；`role-section.js` 的引用方是**上一层**的 `lib/index.js:34`，不是本目录的 `index.js`。

| 文件 | 行数 | 一句话职责 | 是否被 `redteam/index.js` 加载 |
| --- | --- | --- | --- |
| `store-core.js` | 5414 | `RedteamStore`（SQLite 事实库全部读写）+ `dispatch`/`dispatchAsync`（71 个 op 的分发表）+ 六个角色的默认提示词 | 否（被 `store.js`、`ui.js`、`tools.js` 引） |
| `store.js` | 80 | Cordis host 壳：建 `RedteamStore` 并 `ctx.provide('redteam')`，把包身份挂到 `store.plugin` | 否（自身是插件入口，`cordis.patch.yml:66`） |
| `ui.js` | 1156 | HTTP 桥 `POST /redteam/api`；另有 12 个 UI 私有 op（平台配置/并发/版本更新/技能目录）与 `agent/pre-step` 环境门禁 | 否（自身是插件入口，`cordis.patch.yml:72`） |
| `tools.js` | 2256 | 64 个模型可见工具 `redteam_*`，注册到 preset 平面的 `ctx.tools` | 否（`presets/redteam/agent.cordis.yml:128`） |
| `index.js` | 624 | 预设落地（`$DSH_HOME/.agent-presets/redteam`）、随包技能同步、`setup.sh` 落盘、向 `agentPresets` 声明预设、写 `preset-declare.json` | 自身是入口 |
| `schema.js` | 630 | 靶标库 DDL（22 张表 + 2 视图 + 39 个索引）、`migrate()`、知识库 DDL 与 `migrateKnowledge()`、FTS5 能力探测 | 否 |
| `score-rules.js` | 936 | 计分口径唯一实现（`applyScoreCaps` / `evaluateScoreBoard` / `scoreMultiplierOf` / `scoreStageOf` 依赖的键函数）、25 个默认得分点、`SCORE_CONFIRM` 交付口径表 | 否 |
| `validate.js` | 60 | 马类型/马状态规范化（非法即抛）、`assertPathWithin` | 否 |
| `settings.js` | 78 | `$DSH_HOME/redteam/settings.json`：并发上限读写与钳制（1–10） | 否 |
| `platform-config.js` | 612 | `$DSH_HOME/redteam/config.json`：15 个工具的可执行路径解析、Kali 探测、整包文件夹扫描、发送前环境门禁 `envAdaptStatus` | 否 |
| `skill-availability.js` | 354 | 技能可用性判定唯一实现（正文/环境变量/本机路径/占位符/同名遮蔽） | 否 |
| `skill-fixes.js` | 517 | 把可用性判定翻译成中文修复步骤（`TOOL_FIXES` / `SKILL_FIXES` / `fixesForIssue`） | 否 |
| `preset-composition.js` | 404 | 自带的 YAML 子集解析器：`agent.cordis.yml` → registry 声明，`preset.yml` → 元数据 | **是**（`index.js:14`） |
| `role-section.js` | 178 | 子会话角色稿：从任务首行 `redteamRole: <code>` 记角色，按角色读 `agents/<code>.md` | 否（被 `lib/index.js:34` 引） |
| `report-replay.js` | 209 | 纯函数：`parseTarget` / `parseCurl` / `buildHttpRequest` / `buildCurlCommand` / `fillTemplate` | 否 |
| `evidence-ledger.mjs` | 516 | `evidence` / `evidence_verification` / `residual_unknown` 三表 + `EvidenceLedger` / `UnknownRegistry`（内容寻址证据） | 否 |
| `ip-utils.js` | 140 | IP↔int、IPv6 判定与展开、CIDR 归并、slug、POC 文件名、`nowIso` | 否 |
| `atomic-write.js` | 28 | tmp 文件 + `fsync` + `rename` 的原子写 | 否 |
| （对照）`client.js` | 4218 | 浏览器半侧控制台（**不在本次范围**，仅在 §5 用于定位调用方） | — |

---

## 2. 数据模型

### 2.1 磁盘布局

| 载体 | 内容 | 谁创建 | 谁清理 |
| --- | --- | --- | --- |
| `<root>/`（默认 `$DSH_HOME/redteam`，可用 `REDTEAM_HOME` 覆盖） | 数据根 | `store.js:23-32` `resolveRoot` | 无 |
| `<root>/current` | 纯文本「当前靶标」指针（一行 id） | `setActiveEngagement` `store-core.js:963-968` | 从不删除 |
| `<root>/knowledge.db` | 全局 POC 知识库（跨靶标共享） | `kb()` `store-core.js:4620-4630`（惰性） | 无 |
| `<root>/settings.json` | 并发上限 | `saveMaxAgents` `settings.js:65-68` | 无 |
| `<root>/config.json` | 平台适配（工具路径/FOFA/VPS/跳过门禁） | `savePlatformConfig` `platform-config.js:120-151` | 无 |
| `<root>/preset-declare.json` | 预设注册阶段状态（调试用） | `index.js:484-493` `writeStatus` | 无 |
| `<root>/setup.sh` | 随包安装脚本副本（0755） | `index.js:71-99` | 无 |
| `<root>/skills/*.md` | 随包技能同步副本 | `index.js:176-195` | 无 |
| `<root>/toolkit/` | 工具二进制目录（外部脚本下载，插件不写） | 用户/`setup.sh` | 无 |
| `<root>/pocs/<code>/<file>` | POC 正文落盘 | `savePoc` `store-core.js:4657-4673` | `deletePoc` 整目录删（`4860` `removeTreeNoFollowSync`） |
| `<root>/pocs/.nuclei-index.json` | nuclei 模板索引缓存（7 天） | `#nucleiIndex` `store-core.js:4583-4586` | 过期即重建，不主动删 |
| `<root>/update.log`、`<root>/restart-dsh-web.sh` | 自更新重启脚本与日志 | `ui.js:575-577` | 无 |
| `<root>/engagements/<id>/engagement.yaml` | 靶标元数据 | `openEngagement` `store-core.js:1048-1067` | 无 |
| `…/<id>/assets.db` | 靶标事实库（SQLite，WAL） | `db()` `store-core.js:983-1003` | 无 |
| `…/<id>/agents/<role>.md` + `agents/.defaults.json` | 六个角色提示词 + 默认指纹清单 | `savePrompt` / `writePromptManifest` `store-core.js:5319-5324, 5401-5412` | 覆盖前留 `.bak-<ms>`（`5363`），**永不清理** |
| `…/<id>/runs/` | 证据/存档目录（`legacy-score-<ts>.json` 落这里） | `openEngagement` `1051` | 无 |
| `…/<id>/reports/` | 预留目录（代码中无写入点） | `openEngagement` `1051` | 无 |
| `…/<id>/shots/<file>` | 截图文件（库里只存文件名） | `addShot` `store-core.js:4269-4331` | `deleteShot` `4360-4368` |
| `…/<id>/attack-files/<slugTarget>/<name>` | 攻击文件 | `addAttackFile` `store-core.js:4450-4485` | 无（`ON CONFLICT` 覆盖同名） |

`<id>` 由 `slugify(name)` 生成（`ip-utils.js:87-92`）：保留 Unicode 字母/数字，其余转 `-`，空串退化为 `engagement-<ms>`。**因此中文单位名会直接成为目录名**（`[实测]` `openEngagement('示例科技有限公司')` → `id = '示例科技有限公司'`）。拼接路径前统一过 `pathComponent()`（`store-core.js:932-941`）与 `assertNoLinkedDescendants()`（`lib/path-boundary.js:45`）。

### 2.2 `engagement.yaml`（`readMeta`/`writeMeta`，`store-core.js:166-189`）

| 字段 | 类型 | 谁写 | 谁读 | 生命周期 |
| --- | --- | --- | --- | --- |
| `target_name` | string | `openEngagement` `1054` | `listEngagements` `1031`、`snapshot` `1186`、`report` `5066` | 每次 open 覆盖 |
| `scope_cidrs` | string[]（`[a, b]` 一行） | `openEngagement` `1055`（`scope \|\| 旧值 \|\| []`） | 同上 | 传空则保留旧值 |
| `status` | string，恒 `active` | `openEngagement` `1056` | `listEngagements` `1032` | 无状态机，永不改 |
| `created_at` | ISO | `openEngagement` `1057`（已存在则保留） | 排序键 `1037` | 不刷新 |
| `updated_at` | ISO | `openEngagement` `1058` | 无读取点 | 每次 open 刷新 |

解析器只认 `^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$`（`170`），数组只认 `[a, b]` 单行形态（`173-174`）。**不支持多行 YAML**。

### 2.3 `assets.db` 表结构（`schema.js:67-360`）

PRAGMA：`journal_mode=WAL`、`foreign_keys=ON`、`busy_timeout=5000`（`68-70`）。注意 DDL 里**没有任何 `FOREIGN KEY` 约束**，`foreign_keys=ON` 实际不生效。

| 表 | 关键字段（类型/默认） | 唯一约束 | 谁写 | 谁读 |
| --- | --- | --- | --- | --- |
| `scan_run` | `agent_session_id, tool, argv, started_at, finished_at, status DEFAULT 'running'` | — | `importBundle` `5231-5236`（`status` 直接写 `completed`） | 无读取点（`stats()` 不计） |
| `segment` | `cidr PK, ip_start, ip_end, org, asn, country, city, source, first_seen, last_seen` | `cidr` | `#upsertSegment` `5149-5161` | `listSegments` `1195-1206`、`graph` |
| `asset` | `id PK, segment_cidr NOT NULL, ip NOT NULL, ip_int, state DEFAULT 'unknown', primary_name, confidence, first_seen, last_seen, discovered_at, test_status DEFAULT 'untested', test_notes, test_surface, test_updated_at, test_updated_by, blocked_count DEFAULT 0, priority, potential, assess_reason, assessed_at, assessed_by`，另有迁移补的 `scope` | `UNIQUE(segment_cidr, ip)` | `#upsertAsset` `5163-5181`、`updateAssetTest` `2137`、`assessAsset` `2096`、`migrate` `591` | 几乎全部查询 |
| `asset_name` | `asset_id, name, kind, provenance, tool, first_seen, last_seen` | `UNIQUE(asset_id, name, kind)` | `importBundle` `5247-5249` | `assetChildren` `1240`、`domainIndex` |
| `port` | `asset_id, proto DEFAULT 'tcp', port, state DEFAULT 'open', provenance, tool, banner, url, title, first_seen, last_seen` | `UNIQUE(asset_id, proto, port)` | `importBundle` `5257-5266` | `assetChildren`、`listWeb`、`#servicePortOf` `1944` |
| `service` | `port_id, name, product, version, cpe, provenance, tool, …` | —（**无唯一约束，重复导入会产生多行**） | `importBundle` `5272-5276`（每次 import 都 INSERT，不 upsert） | `assetChildren`（`LEFT JOIN`，多行会让端口行重复） |
| `fingerprint` | `asset_id, port_id, category, vendor, product, version, evidence, confidence, provenance, tool, …` | —（同样每次 INSERT） | `importBundle` `5281-5285` | `assetChildren` |
| `observation` | `entity_kind, entity_id, attr, value, provenance, tool, scan_run_id, collected_at, raw_ref` | — | `#observe` `5183-5189`（被 assess/test/vuln/access/webshell/tunnel/importBundle 调用） | `getAsset` `1403`（限 200 条）、`stats` |
| `edge` | `src_kind, src_id, dst_kind, dst_id, relation, confidence, scan_run_id, first_seen, last_seen` | `UNIQUE(src_kind, src_id, dst_kind, dst_id, relation)` | `#edge` `5191-5197` | `getAsset` `1405`、`graph` |
| `tag` | `entity_kind, entity_id, tag, note, created_by, created_at` | PK(entity_kind, entity_id, tag) | **无写入点**（死表） | 无 |
| `vuln` | `asset_id, port_id, cve, title, severity, source, confidence, status, evidence, target, found_by_agent, found_at, gained, agent` | —（幂等靠应用层 SELECT，见 §3.4） | `addVuln` `2168-2202`、`updateVuln` `2241-2253` | `listVulns`、`vulnStats`、`attackGraph`、报告 |
| `score_point` | `code UNIQUE, name NOT NULL, category, points DEFAULT 0, max_hits DEFAULT 1（保留不用）, description, enabled DEFAULT 1, sort_order, created_at, updated_at, src, rule, tier, cap DEFAULT 0, dedup_scope DEFAULT 'service', legacy DEFAULT 0, builtin DEFAULT 0` | `code` | `seedScorePoints` `1502-1611`、`saveScorePoint` `1857-1912` | `listScorePoints`、`scoreReport`、`scoreChain`、`loadScoreMeta` |
| `stage` | `code PK, name NOT NULL, subtitle, color, goal, sections(JSON), tools, transition, sort_order, updated_at` | `code` | `seedStages` `1446-1462`、`saveStage` `1478-1500` | `listStages`、`scoreReport`、`scoreChain` |
| `score_hit` | `point_id NOT NULL, asset_id, vuln_id, step_id, target, evidence, note, self_created DEFAULT 0, port, recorded_by, recorded_at, points, multiplier DEFAULT 1`，迁移补 `stage_code` | — | `addScoreHit` `1951-2085` | 面板/报告/攻击链 |
| `credential` | `asset_id, host, username, secret_type, secret_value(明文), secret_ref, privilege, source, tool, note, found_by_agent, found_at, agent` | `UNIQUE(host, username, secret_type)` | `addCredential` `2274-2296`（`ON CONFLICT DO UPDATE`） | `listCredentials`、报告、`#hitTrace` |
| `access_session` | `asset_id, host, username, method, privilege, session_ref, note, found_by_agent, obtained_at` | — | `addAccess` `2311-2323` | `listAccess`、`attackGraph`（`owned`） |
| `webshell` | `asset_id, url NOT NULL, shell_type, pass_key, secret_ref, privilege, status DEFAULT 'unknown', last_check, check_note, latency_ms, note, found_by_agent, created_at, updated_at, agent` | `UNIQUE(url, pass_key)` | `addWebshell` `2341-2363`、`updateWebshell` `2377-2396`、`probeSessions` `4022` | `listWebshells`、`sessionSummary` |
| `tunnel` | `asset_id, webshell_id, kind, listen, entry, reach, entry_kind, status DEFAULT 'unknown', last_check, check_note, latency_ms, pid, command, note, found_by_agent, created_at, updated_at, agent` | — | `addTunnel` `2408-2440`、`updateTunnel` `2456-2489`、`probeSessions` `4059` | `listTunnels`、`sessionSummary`、`scoreChain` |
| `http_evidence` | `vuln_id, asset_id, label, method, url, status, request, response, note, captured_by, captured_at` | — | `addHttpEvidence` `4157-4166` | `listHttpEvidence`、`listVulns`（内联）、`scoreReport` |
| `attack_file` | `target NOT NULL, target_kind, name NOT NULL, kind, path NOT NULL, description, evidence, asset_id, vuln_id, created_by, created_at` | `UNIQUE(target, name)` | `addAttackFile` `4450-4485` | `listAttackFiles`、`attackFileTree`、`readAttackFile` |
| `attack_step` | `seq, stage, title, detail, asset_id, vuln_id, access_id, point_id, evidence_ref, tool, agent, result, recorded_by, recorded_at`，迁移补 `stage_code` | — | `addChainStep` `4185-4241` | `listChain`、`#hitTrace`、`scoreChain`、报告 |
| `shot` | `point_id, hit_id, asset_id, vuln_id, target, label, note, file NOT NULL, kind DEFAULT 'screenshot', mime, bytes, width, height, sha256, source_ref, captured_at, found_by_agent, agent, created_at` | `UNIQUE(file)` | `addShot` `4269-4331` | `listShots`、`#representativeShots` |
| `asset_fts`（FTS5 虚拟表） | `asset_id UNINDEXED, ip, names, banners, titles, fingerprints` | — | `#reindex` `5200-5217` | `listAssets` 的 `q` 分支 |
| `v_asset_summary` / `v_asset_service`（视图） | 见 `349-359` | — | **无读取点**（死视图） | — |

**无 TTL、无定期清理**：全库没有任何定时删除逻辑。唯一的自动清理是 `seedScorePoints` 清旧口径得分点（见 §3.9）与 `migrate()` 删旧 `stage` 行。

### 2.4 `knowledge.db`（`schema.js:364-401`）

| 表 | 字段 | 唯一 | 谁写 | 谁读 |
| --- | --- | --- | --- | --- |
| `poc` | `id PK, code NOT NULL, title NOT NULL, kind, category, cve, component, versions, severity, language, source, source_url, description, usage, content, path, verified DEFAULT 0, verified_note, hit_count DEFAULT 0, used_on, engagement_id, engagement_name, asset_target, found_by_agent, tags, created_by, created_at, updated_at` | `UNIQUE(code)` | `savePoc` `4646-4713`、`updatePoc` `4801-4846`、`markPocUsed` `4791-4798` | `searchPocs`、`getPoc`、`pocStats` |
| `poc_fts`（FTS5） | `poc_id UNINDEXED, title, cve, component, versions, tags, description, content` | — | `#reindexPoc` `4632-4639` | `searchPocs` 的 `MATCH` 分支 |

`category` 归一化：只接受 `POC_CATEGORIES`（`schema.js:411-426`）里的 14 个 code，其余一律 `other`（`store-core.js:4680-4683`）。

### 2.5 证据账本三表（`evidence-ledger.mjs:59-107`，`initializeLedger` 惰性建表 `443-450`）

| 表 | 字段 | 约束 |
| --- | --- | --- |
| `evidence` | `ev_id PK, confidence CHECK(claimed\|observed\|derived\|inferred), authority NOT NULL, operation NOT NULL, parameters NOT NULL DEFAULT '{}', result NOT NULL, raw_ref, limitations DEFAULT '[]', supporting_ev_ids DEFAULT '[]', recorded_by, recorded_at, source_agent, engagement_id` | `ev_id = 'ev_' + sha256(规范化语义)`，`parseEvidenceRow` 重算哈希不符即抛 `evidence integrity mismatch`（`479-487`） |
| `evidence_verification` | `claim_id PK REFERENCES evidence(ev_id), observation_id NOT NULL REFERENCES evidence(ev_id)` | 只在 `upgrade()` 里 `INSERT OR REPLACE`（`270`） |
| `residual_unknown` | `unk_id PK, revision DEFAULT 1, question NOT NULL, status CHECK(open\|investigating\|blocked\|contradicted\|resolved\|withdrawn), severity CHECK(low\|medium\|high\|critical), domain DEFAULT 'general', scope_digest, supporting_ev_ids, contradicting_ev_ids, required_authority, required_confidence, recommended_probe, resolution, recorded_by, recorded_at, resolved_at, engagement_id` | `unk_id = 'unk_' + sha256({question, domain})`；旧库由 `migrateUnknownStatus` 重建表补 `withdrawn`（`452-472`） |

`countUnresolvedClaims` 是**全表扫描 + 一致性断言**：只要表里出现属于别的 `engagement_id` 的行就抛 `evidence engagement mismatch`（`317`，`[实测]` 已复现）。

### 2.6 实体关系（重实现时最关键的一张图）

```
segment(cidr) 1─n asset(segment_cidr, ip)
asset 1─n port(asset_id) 1─n service(port_id)          # service 无唯一约束，可多行
asset 1─n asset_name / fingerprint / observation(entity_kind='asset') / edge
asset 1─n vuln(asset_id) 1─n http_evidence(vuln_id)
asset 1─n credential(asset_id) / access_session / webshell / tunnel / shot / attack_file
score_point(code) 1─n score_hit(point_id)
score_hit ──(vuln_id / step_id / asset_id)──> vuln / attack_step / asset   # 弱关联，无外键
attack_step ──(point_id / vuln_id / asset_id / access_id)──> score_point / vuln / asset / access_session
shot ──(point_id / hit_id / asset_id / vuln_id)──> 四处均可空挂
poc（知识库，跨靶标）──(engagement_id 文本)──> engagement   # 仅溯源标注，无外键
```

---

## 3. 业务逻辑

### 3.0 分发表 `dispatch` / `dispatchAsync`（`store-core.js:742-874` / `876-903`）

入口签名：`dispatch(store, req)`，`req.op` 先 `trim()`（`743`）。

1. **无 op** → `{ ok:false, error:'missing op' }`（`745`）。
2. **全局 op（不需要靶标）**：`bootstrap`、`openEngagement`、`activateEngagement`、`pocSearch`/`pocList`/`templateSearch`/`templateStats`/`pocGet`/`pocSave`/`pocUpdate`/`pocDelete`/`pocUse`/`pocStats`、`platformConfigGet`/`platformConfigSave`/`platformAssignToolkit`（`746-787`）。
3. **解析靶标 id**：`req.engagement` → 否则 `store.activeEngagementId()`（`789-790`）。
4. **无 id 时的降级**（`791-808`）：
   - `prompts` → 返回内置默认（`builtin:true`，`updated_at:null`，`792-804`）；
   - `op` 命中 `/^(add|save|update|delete|import|assess|open)/`（`805`）→ `{ ok:false, error:'请先在顶部选择或创建一个靶标' }`（`806`）；
   - 其余 → `{ ok:true, items:[], total:0, stats:null, segments:[], stages:[], roles:[] }`（`807`）。
   `[实测]`：`shotAdd`、`shotDelete`、`assetTest` **不匹配**这个前缀正则，因此在没有靶标时返回**成功形状的空结果**（`{"ok":true,"items":[],...}`），调用方无法与"真的写成功了"区分。
5. **有 id 后**：71 个 op 逐条 `if (op === ...)` 转调 `store` 方法，每个都 `Object.assign({ok:true}, 结果)`。
6. **未知 op** → `throw new Error('unknown op: '+op)`（`871`）。
7. **统一异常收敛**：`catch` 返回 `{ ok:false, error: error.message }`（`872-874`）。**所有 store 层抛错都变成 `ok:false`，HTTP 状态仍是 200**（`ui.js:1150`）。

`dispatchAsync` 只多一条 `probeSessions`（`877-889`，需要真实网络），其余原样转 `dispatch`（`890`）。

### 3.1 靶标生命周期

- **`bootstrap`**（`746-754`）：`listEngagements({includeStats:false})` + `current = req.engagement || activeEngagementId() || 首个靶标 id || null`。返回 `{ok, root, engagements, current}`。
- **`openEngagement(name, scope, options)`**（`1048-1067`）：`slugify(name)` → 建目录 + `agents/runs/reports` 三子目录 → 写 `engagement.yaml` → `db(id,{create:true})` 建库建表 → `seedScorePoints(id)` → 对六个角色逐个 `listPrompts` 后补空文件 → `options.bindCurrent !== false` 时写 `current` 指针。工具层固定传 `bindCurrent:false`（`tools.js:456`）。
- **`activateEngagement`**（`758-761`）：`setActiveEngagement` 只在该 id 的 `assets.db` 存在时才写指针（`964`），返回 `{ok: activated, current}`。
- **`activeEngagementId`**（`953-960`）：先读 `current` 且校验库文件存在，否则退回「按 `created_at` 倒序的第一个靶标」。
- **`listEngagements`**（`1017-1038`）：遍历 `engagements/` 目录，`includeStats!==false` 时对每个靶标跑一次 `stats()`（= 10 条 `COUNT`）；单个靶标抛错时挂 `stats_error` 而不断整个列表（`1028, 1034`）。

### 3.2 资产测绘

- **`importBundle(id, bundle)`**（`5226-5304`）——**唯一的资产写入入口**（`redteam_asset_add` 也走它，`tools.js:891`）。
  - 判据：`bundle.scan` 存在则先插一条 `scan_run`（`5230-5237`）。
  - 事务：`BEGIN` … `COMMIT`，异常 `ROLLBACK` 后重抛（`5238, 5298-5302`）。
  - `#upsertAsset`（`5163-5181`）：`segment_cidr` 缺省 `cidrOf(ip)`；`ON CONFLICT(segment_cidr,ip)` 只更新 `state/primary_name/last_seen`，`scope` 用 `COALESCE(NULLIF(asset.scope,''), excluded.scope)`（已有值不覆盖），`discovered_at` 同样只补空（`5174-5175`）。
  - 端口：`ON CONFLICT(asset_id,proto,port)` 更新 `state/banner/url/title/last_seen`（`5259-5264`）。
  - **`service` 与 `fingerprint` 是裸 `INSERT`**（`5272, 5281`），重复导入同一资产会累积重复行 —— `assetChildren` 的 `LEFT JOIN service` 因此会让同一端口出现多行（`1226-1229`）。
  - 返回 `{ scan_run_id, counts, stats }`。
- **`listAssets(id, f)`**（`1291-1396`）：过滤维度 `cidr / state / ip / port / service(LIKE name|product) / fingerprint(LIKE product|vendor|category) / provenance(EXISTS port) / priority / test_status(支持逗号多值) / scope / q`。
  - `q` 走 FTS5 `MATCH`（每词加 `"…"*` 前缀查询）**并额外 `OR a.primary_name LIKE ?`**（`1339-1341`，因为 `asset_fts` 不含主域名）；FTS5 缺席时退化为 4 组 `EXISTS ... LIKE` 子查询（`1348-1362`）。
  - 排序：默认 `priority`；`ports`（开放端口数倒序）、`discovered`（发现时间倒序）、`todo`（未测→已测→放弃，再按 priority）、`ip`（`ip_int`）。
  - 分页：`limit` 默认 200、上限 2000；`offset` 默认 0（`1368-1369`）。
  - 子表批量预取 `assetChildren`（`1219-1247`）：3 条 `IN (...)` 查询替代 3N。
- **`getAsset`**（`1398-1408`）：`assetRow` 单资产 + 最近 200 条 `observation` + 全部 `edge`。
- **`graph`**（`1411-1440`）：`segment → asset → port` 三层节点 + `domain → asset` 的 `resolves` 边；节点 id 形如 `seg:<cidr>` / `asset:<id>` / `port:<id>` / `name:<primary_name>`。
- **`attackGraph`**（`4071-4101`）：在 `graph` 上叠加 `vuln` 节点（只取 `confirmed/exploited`，上限 200）与 `meta.owned`（来自 `access_session` 有 `asset_id` 的资产）。
- **`stats`**（`1097-1115`）：10 个计数（segments/assets/liveAssets/openPorts/services/fingerprints/passiveSignals/activeSignals/vulns/credentials/accesses/untestedAssets/blockedAssets）。
- **`listSegments`**（`1195-1206`）：每段附带 assets/live/open_ports/passive_ports/active_ports，并按段起始地址算 `scope`。
- **`discoveryTimeline`**（`1075-1094`）：按 `substr(COALESCE(discovered_at, first_seen,''),1,10)` 分天聚合（内外网分开计数）+ 最近 N 条 + `span{first,last,total}`；`limit` 默认 50、上限 500。

### 3.3 资产测试状态

- **`updateAssetTest(id, t)`**（`2112-2154`）
  - 定位：`t.asset_id` → 否则 `t.ip`；找不到抛 `asset not found（请传 asset_id 或 ip）`（`2120`）。
  - `status` 白名单 `untested/testing/tested/blocked/abandoned/no_surface`，非法则**保留原值不报错**（`2121-2123`）。
  - `test` 与 `notes` 都收，用 `；` 拼成一段，**追加**到 `test_notes`，前缀 `[<ISO>] `（`2127-2134`）。
  - `surface` 覆盖式（`2135`）。
  - `blocked===true` 时 `blocked_count += 1`（`2136`）。
  - 副作用：写 `asset` 六列 + 追加 `observation(attr='test'/'blocked')`（`2137-2146`）。
  - 返回 `blocked_count >= 3` 时附 `hint` 提示置 `abandoned`（`2150-2152`）。
- **`assessAsset`**（`2088-2100`）：`priority` 白名单 `high/medium/low`，非法回落原值或 `medium`；写 `priority/potential/assess_reason/assessed_at/assessed_by` + 一条 `observation(attr='assess')`。
- **`testStats`**（`2157-2163`）：六个状态计数，缺省归 `untested`。
- **`activeTests`**（`2495-2522`）：三组查询 —— `testing`（按 `test_updated_at` 倒序）、`recent`（非 testing 但有更新时间）、`queue`（untested，按 priority + 端口数），各 `limit` 默认 8、上限 50；附 `stats` 与 `untested` 总数。

### 3.4 漏洞

- **`addVuln(id, v)`**（`2168-2202`）
  - `severity` 非法 → `info`；`status` 非法 → `candidate`（`2170-2171`）。
  - 幂等键：有 `cve` 时 `(asset_id, cve, COALESCE(target,''))`；无 `cve` 时 `(asset_id, 空cve, title, COALESCE(target,''))`（`2172-2176`）。
  - 命中已有 → `UPDATE ... COALESCE(?, 原值)`，返回 `{id, updated:true}`；否则 `INSERT`，返回 `{id, updated:false}`（`2177-2201`）。
  - `gained` 经 `normGained()`：数组或 `[,;，；]` 分隔 → `A、B`（`146-151`）。
  - 新插入且有 `asset_id` 时追加一条 `observation(attr='vuln')`（`2198-2200`）。
- **`listVulns`**（`2204-2239`）：过滤 `severity/status/cve(LIKE)/asset_id/cidr/q(四列 LIKE)`；排序按 severity 权重再 `id DESC`；`limit` 默认 200、上限 1000；每条内联其 `http_evidence`（按 200 一批 `IN` 查询，`request` 截 60000 字符，`2226-2236`）。
- **`updateVuln`**（`2241-2253`）：找不到返回 `{updated:false}`（**不抛错**）；`status`/`severity` 非法则保留原值；`evidence/confidence/gained/title` 用 `COALESCE` 只覆盖非空。
- **`vulnStats`**（`2255-2271`）：按 severity/status 分组计数 + `withGained` + `withEvidence`（有 evidence 或有 http_evidence）+ `targetGroups`（按 `targetKey` 归并的站点数）。

### 3.5 凭据与访问会话

- **`addCredential`**（`2274-2296`）：`host` 必填（否则抛 `credential.host required`）；明文取值顺序 `secret_value → secret → password → value`；`ON CONFLICT(host,username,secret_type) DO UPDATE` 只覆盖非空字段；`found_at` 每次刷新。返回 `{id}`（回查 `host+username+secret_type`）。
- **`listCredentials`**（`2298-2308`）：过滤 `host/username/withValue`；`limit` 默认 200、上限 1000；**返回明文 `secret_value`**。
- **`addAccess`**（`2311-2323`）：`host` 必填；有 `asset_id` 时追加 `observation(attr='access')`。
- **`listAccess`**（`2325-2333`）：只支持 `host` 过滤。

### 3.6 WebShell / 隧道 / 连通性探测

- **`addWebshell`**（`2341-2363`）：`url` 必填；`shell_type` 过 `normalizeShellType`（`validate.js:20-32`：`behinder|冰蝎`、`godzilla|哥斯拉`、`antsword|蚁剑`、`custom|自定义|自研`，其余**抛错**）；`status` 过 `normalizeShellStatus`（`validate.js:34-46`：`up/alive→online`、`down/failed→offline`、`removed→dead`，空值→`online`，其余抛错）。同 `(url, pass_key)` 视为同一条，走 UPDATE 分支返回 `{id, updated:true}`。
- **`updateWebshell`**（`2377-2396`）：可写 `status/check_note/latency_ms/last_check/privilege/note/secret_ref/shell_type`，同样过规范化；无字段可写抛 `nothing to update`；`changes===0` 抛 `webshell not found`。
- **`addTunnel`**（`2408-2440`）：`entry_kind` 非空且不在 `TUNNEL_ENTRY_KINDS`（`score-rules.js:29-34`：`target-outbound|target-http|target-agent|self-only`）→ **抛错**；空则写 `NULL`。返回 `legit = tunnelIsLegit(entry_kind)`（`score-rules.js:38-42`：空→`null`，`self-only`→`false`，其余→`true`）+ 对应 warning 文案。
- **`updateTunnel`**（`2456-2489`）：`entry_kind` 同样校验；`status` 只接受 `active/down/closed/unknown`，非法抛错（`2463-2481`）。
- **`probeSessions`**（`4002-4064`，host 侧、异步）
  - WebShell：`fetch(url, {method:'GET', redirect:'manual'})`，`status < 500` 判 `online`，超时/异常判 `offline`，写回 `status/last_check/latency_ms/check_note`（`4006-4025`）。
  - 隧道：从 `listen` 剥掉 `socks5://`/`http(s)://`，取最后一个冒号分 host/port，`net.connect` 成功→`active`，超时/错误→`down`，写回（`4027-4062`）。
  - `timeoutMs` 钳制在 1000–20000，默认 6000（`4003`）。
  - **这是唯一会从 host 侧主动发起连接的地方**（`tools.js:1450` 与 `client.js:3345` 都会触发）。

### 3.7 证据截图

- **`addShot`**（`4269-4331`）
  - 文件名：显式 `file` 优先（`/`、`\` 替换成 `-`），否则 `<YYYYMMDDHHmmss>-<point_code>-NN.<ext>`，冲突自增（`4282-4287`）。
  - 内容来源二选一：`data_base64`（剥 `data:` 前缀）或 `path`；`path` 必须落在**靶标目录内**（`assertSourcePath` = `assertPathWithin(resolve(root, path), [root])`，`927-929`）——`[实测]` 传 `/etc/hosts` 抛 `path outside allowed roots`。
  - 空文件抛 `shot file is empty`（`4299`）。
  - MIME 由魔数判定（PNG/JPEG/RIFF→webp，其余 `application/octet-stream`，`4301-4303`）；尺寸由 `pngSize` 读（PNG/JPEG/WebP，读不出为 `null`，`901-925`）。
  - `kind` 只认 `card`，其余一律 `screenshot`（`4273`）。
  - `point_code` → 查 `score_point.id`（查不到写 `null`，`4305-4310`）。
  - 落库 19 列，含 `sha256`。
- **`deleteShot`**（`4360-4368`）：先删文件（`rmSync force`）再删行；`file` 过 `pathComponent`。
- **`readShot`**（`4375-4383`）：返回 `base64`（设计上刻意不开静态路由，见 `4370-4374` 注释）。
- **`#representativeShots`**（`4395-4440`）：每个得分点最多 3 张；候选池分层「命中 → 目标/资产 → 得分点」，层内 `card` 排后、再按时间；返回 `Map<point_id, rows[]>`。

### 3.8 HTTP 证据 / 攻击链 / 攻击文件

- **`addHttpEvidence`**（`4157-4166`）：`method` 默认 `GET`，`captured_at` 自动；无任何必填校验（`request` 为空也入库）。
- **`listHttpEvidence`**（`4168-4177`）：过滤 `vuln_id/asset_id`，`limit` 默认 100、上限 500。
- **`addChainStep`**（`4185-4241`）
  - `seq` 缺省 = `MAX(seq)+1`（`4187`）。
  - `point_id`：显式 → `point_code` 查表（`4188-4192`）。
  - `stage_code`：`VALID_STAGE_CODES`（`recon/internet/boundary/internal/target`，`368`）内直接用；否则回落 `LEGACY_STAGE_MAP[stage] ?? 'recon'` 并给 `stage_hint` 告警（`4197-4210`）。
  - **顺手记分**：`point_id` 非空且 `evidence` 非空 → `addScoreHit({..., step_id})`，把 `hit.warning` 塞进 `score_hint`；记分抛错则 `score_hint = '步骤已入库，但记分失败：…'`（`4222-4236`）。带了 `point_code` 但没 `evidence` → `score_hint` 明确说明"没有记分"（`4237-4239`）。
- **`listChain`**（`4243-4249`）：`attack_step` LEFT JOIN asset/vuln，按 `seq,id`。
- **`addAttackFile`**（`4450-4485`）：`target`、`name`、`evidence` 三者必填（缺则分别抛 `attack file target required` / `name required` / `evidence required`）；目录 `attack-files/<slugTarget(target)>/`；`content` 或 `path` 二选一（`path` 必须在本靶标目录内）；`kind` 白名单 `poc/exp/script/wordlist/other`，缺省 `script`；`ON CONFLICT(target,name)` 覆盖。
- **`readAttackFile`**（`4509-4521`）：`path` 列是不可信输入，读前 `assertPathWithin(row.path, [dirOf(id)])`，越界返回 `（拒绝或读取失败：…）` 而不是抛错。
- **`attackFileTree`**（`4498-4507`）：按 `target` 分组，`count` 倒序。

### 3.9 得分点与记分（本模块最核心）

#### 3.9.1 播种 `seedScorePoints(id)`（`1502-1611`）

每次 `openEngagement`、`listScorePoints`、`addScoreHit` 都会调用（幂等）。四步：

1. **内置标记回填**：`UPDATE score_point SET builtin=1 WHERE code IN (25 个默认 code)`（`1529-1534`）。
2. **旧体系清理**：`legacy=1 或 builtin=1 且 code 不在默认名单` 的行 → 先把其 `score_hit` 与得分点本身导出到 `runs/legacy-score-<ts>.json`（`1546-1556`），再 `DELETE score_hit` + `DELETE score_point`（`1558-1559`）。
3. **规则元数据同步**：对已存在的默认 code，强制覆盖 `name/category/points/description/src/rule/tier/cap/dedup_scope/builtin=1`（`1582-1594`）——**分值由代码锁定，用户改不动**。
4. **缺哪补哪**：`DEFAULT_SCORE_POINTS` 里不在库中的 code 逐条 INSERT（`1598-1602`）。

返回 `{seeded, purgedLegacyPoints, purgedLegacyHits, purged}`；三者都为 0 时 `{seeded:0}`。

`[实测]` 新库首次 open 后：`score_point = 25 行，builtin = 25 行`；`stage = 0 行`（阶段表由 `listStages` 惰性播种，见 §3.13）。

#### 3.9.2 默认得分点 `DEFAULT_SCORE_POINTS`（`score-rules.js:769-924`）

25 条 = 获取权限 21 条（含 4 条"加成/合并"拆分项）+ 突破网络边界 4 条。每条字段 `src, rule, tier, code, name, category, points, cap, dedup_scope, description`。

| rule | code | 分值 | cap | dedup_scope | category |
| --- | --- | --- | --- | --- | --- |
| 1 | `domain-control` | 50（二级 20） | 400 | system | GENERAL |
| 2 | `terminal-access` | 10（打印机/wifi 5） | 600 | system | GENERAL |
| 3 | `server-host` | 50（普通 10） | 600 | system | GENERAL |
| 4 | `db-credential` | 50（普通/未授权 10） | 400 | system | GENERAL |
| 5 | `web-app` | 100（普通 50） | 2000 | system | WEB |
| 6 | `central-system` | 500（普通 50） | 4000 | system | CENTRAL |
| 7 | `bigdata-system` | 1000（普通 100） | 4000 | system | BIGDATA |
| 8 | `netdev` | 200（普通 100） | 2000 | service | NETINFRA |
| 9 | `iiot` | 200（设备 10） | 2000 | system | NETINFRA |
| 10 | `cloud-platform` | 500（节点 10） | 2000 | system | NETINFRA |
| 11 | `iot-platform` | 200（连接点 10） | 2000 | system | NETINFRA |
| 12 | `secdev` | 200 | 1000 | service | NETINFRA |
| 13 | `file-storage` | 50（普通 10） | 500 | system | STORAGE |
| 14 | `ai-agent` | 100–500 | 4000 | service | MODEL |
| 15 | `model-compute` | 500 | 4000 | system | MODEL |
| 16 | `model-data` | 500 | 4000 | system | MODEL |
| 17 | `computepower-admin` | 500 | 2000 | system | MODEL |
| 18 | `computepower-cards` | 10 | 2000 | none | MODEL |
| 19 | `boundary-logical` | 1000 | 0 | target | BOUNDARY |
| 20 | `boundary-strong` | 10000 | 0 | target | BOUNDARY |
| 21 | `boundary-physical` | 30000 | 0 | target | BOUNDARY |
| 22 | `boundary-supply` | 1000 | 3000 | service | BOUNDARY |
| 23 | `netdev-redirect` | 200 | 2000 | none | NETINFRA |
| 24 | `netdev-implant` | 1000 | 2000 | none | NETINFRA |
| 25 | `iot-corenet` | 5000 | 5000 | none | NETINFRA |

`rule` 是**上限分组键**（必须唯一，见 `score-rules.js:708-720` 注释），不是文档原序号；原序号在 `src`。

#### 3.9.3 记分 `addScoreHit(id, hit)`（`1951-2085`）

判据顺序（每条都是硬校验，失败抛错）：

1. `seedScorePoints(id)`（`1955`）。
2. 定位得分点：`point_id` → `code` → `point_name`；都找不到抛 `score point not found：… 旧 code（web-account-*、webshell、rce…）已作废 …`（`1961-1973`）。
3. `evidence` 去空后必填，否则抛 `score hit evidence required`（`1974-1975`）。
4. `self_created`：`true/1/'1'` → 1（`1977`）。
5. 端口解析 `#servicePortOf`（`1936-1948`）：显式 `port` → `target` 里的端口 → 该资产只登记了一个端口时用那个 → `null`（**不猜 80/443**）。
6. **档位分值边界**（`1988-2006`）：`pointsMax = max(cap, 默认 points × 100, 1000)`；`points` 必须有限、`>0`、`<= pointsMax`，否则抛错并打印三段数值。`[实测]` `points=999999999` → `超出该得分点的合理上限 10000（= max(规则上限 2000, 默认分值 100 × 100)）`。
7. **倍率** `scoreMultiplierOf(hit)`（`score-rules.js:407-420`）：`ip_version===6` 或 `target` 是 IPv6 字面量 → ×3（G6）；`data_scale==='large'` → ×2；`'knowledge-base'|'kb'` → ×2；可叠乘。IPv6 判定用 `isIpv6()` 而不是粗糙正则，并要求裸写 IPv6 至少 2 个冒号（`411-414`）。
8. `INSERT score_hit(... points, multiplier)`（`2009-2014`）。
9. **回读整块看板** `listScorePoints(id)`，从中取本条与它压住/被压住的条目（`2017-2032`）。
10. 生成 warning：`self_created` 提示不计分；G5 但 `evidence` 解析不出数据量 → 提示补量级；G5 且 `< 1,000,000` → 提示核对；`cappedByService` → 附 `serviceCapReason` 与被压条目证据；`demoted` 非空 → 说明本次没加分（`2033-2059`）。
11. 返回 `{id, point_id, point, base_points, multiplier, multiplier_reasons, points(已乘倍率并四舍五入), port, service, volume, self_created, counted, capped_by_service, capped_by, demoted_hits, warning, summary}`（`2060-2084`）。

#### 3.9.4 计分口径 `applyScoreCaps`（`score-rules.js:162-255`）

两阶段，纯函数，三处（面板/报告/攻击链）共用：

- **阶段 ①：口径去重**（`184-221`）。按 `dedup_scope` 建桶：
  - `none`/空 → 不参与；
  - `target` → 全表一个键；
  - `system` → `'sys:' + systemKeyOf(...)`；
  - `service` → `'svc:' + scoreServiceKey(...)`，**服务键取不到就跳过**（`199-201`，注释说明曾因 `svc:#hit7` 把 62 条终端命中吃掉 61 条）。
  - 桶内 `pickBestHit`（`311-317`：分高者胜，同分取 `id` 小者），其余标 `capped=true, capped_by_id, capped_reason_kind='dedup'`。
- **阶段 ②：规则上限**（`223-253`）。按 `cap_group`（`rule:N` 或 `code:xxx`）分组，按分值降序累计，`used + pts > cap` 的标 `capped, capped_reason_kind='cap'`；`cap<=0` 不设上限。
- 返回 `{capped, items, caps: Map<group,{rule,cap,used,capped}>}`。

**`systemKeyOf`**（`267-308`）：① 显式 `system_key`（必须包含服务键才采信）→ ② `资产 primary_name + '|' + 服务键`（主力路径）→ ③ 服务键 → ④ `'#hit<id>'`（互不相同）。`evaluateScoreBoard` 在 `451` 预造 `system_key = [primary_name, port ?? parseTargetPort(target) ?? ''].join('|')`。

**`scoreServiceKey`**（`121-128`）：`target` 能解析出 `host[:port]` → `'t'+authority`（无端口时按 `http→80 / https→443` 补，`94-110`）；否则 `'a<assetId>:<port|0>'`；都没有 → `null`。

#### 3.9.5 面板数据 `listScorePoints(id, f)`（`1613-1843`）

- 先 `seedScorePoints`（`1618`）。
- 读全部 `score_point`（按 `points` 升序）+ 全部 `score_hit`（按时间倒序）。
- 对每条命中算 `hitPointsOf`（档位分 × 倍率，`score-rules.js:362-375`），再整体过 `evaluateScoreBoard`（`1653-1655`）。
- 每个得分点输出 `counted / earned / self_created / capped / capped_hits / cap_used / cap_capped / scope_label / service_summary / hits[]`；每条命中附 `service / capped / capped_by / capped_reason / capped_reason_kind / shot_count`（`1664-1752`）。
- 每个得分点挂最多 3 张代表图（`1728-1752`）。
- 排序：已得分优先 → 分值升序 → `sort_order`（`1756-1763`）。
- 按 `SCORE_GROUPS` 的 8 类分组（`1769-1801`），`legacy` 条目单独折叠。
- `summary`：`achievedPoints / pointCount / hitPointCount / hitCount / countedHits / selfCreatedHits / serviceCappedHits / cappedByDedup / cappedByRuleLimit / legacyPointCount / legacyHitCount / latestCapped`（`1811-1842`）。

#### 3.9.6 得分点编辑

- **`saveScorePoint`**（`1857-1912`）
  - 带 `id`：行不存在抛 `score point not found`；`builtin=1 或 legacy=1` 时**只写 `enabled`/`sort_order`**，返回 `{builtin:true, overridden: <提交分值是否等于现值>, locked_fields:[…], note:'…分值由规则锁定…'}`（`1869-1883`）；自建点则全字段可改，`name` 空抛 `score point name required`。
  - 不带 `id`：`name` 必填；`code` 与已有冲突时自动加 `-custom-<base36>` 后缀（`1897-1902`）；`builtin` 恒 0。
- **`deleteScorePoint`**（`1915-1928`）：`builtin=1` → 抛错（附"改用停用"的说明）；否则删该点的全部 `score_hit` 再删点。
- **`saveStage`**（`1478-1500`）：`code` 必填；`ON CONFLICT(code) DO UPDATE`，未传字段沿用原值。

### 3.10 报告三兄弟

- **`scoreChain(id, f)`**（`3788-3969`）——攻击链页/`redteam_attack_chain`。
  - 拉 `score_hit`（`limit` 默认 500、上限 2000），按 `recorded_at,id`。
  - 动作归因：`step_id` 精确 → 同 `point_id+asset_id` 的步骤 → 同资产中 `recorded_at` 不晚于命中的最近一步（标 `action_inferred`）（`3809-3821`）。
  - 计分标记走 `evaluateScoreBoard(enabledOnly:true)`；`counted = 非自建 && 未封顶 && 未被停用`（`3861`）。
  - 阶段推导 `scoreStageOf({stage_code, code, target}, asset.scope)`（`345-355`：显式 → `POINT_STAGE_OVERRIDE` → 资产 scope → target 里的 IP 归属 → `internet`）。
  - 每阶段给 `points/cumulative/counted/hits/assets/tunnels(仅 boundary)/steps`；`tunnels` 按 `legit` 分真隧道与 `self-only`（`3910-3911, 3941-3942`）。
  - `summary.points` 取 `listScorePoints().summary.achievedPoints`，保证与面板同源（`3956`）。
- **`scoreReport(id, options)`**（`2703-3782`）——交付报告（`redteam_score_report`）。
  - 拉全量 `score_hit` + 关联 `score_point/asset/vuln`（`limit` 默认 500、上限 2000）。
  - 排除三类：`self_created=1`、`capped=true`、`point.enabled!==1`（`2764-2771`）。
  - 每条构造 `#hitTrace`（`2533-2690`）：步骤（四档归因 `linked>vuln>point>asset`）、漏洞、凭据/会话/马/隧道（**只有 `target` 与该资产对得上才挂**，`2600-2654`）、`gaps`（无步骤/无命令/无 `vuln_id`/账号类无凭据/突破类无隧道，`2656-2667`）、`how` 一句话。
  - 复现入口优先级（`2896-2972`）：真实抓包合成 curl（`synthesized`）→ 本条显式关联步骤的真实命令（`real`/`linked`）→ 真实 curl（`real`）→ 得分点模板填充（`template`，未填占位符原样保留并列出）→ 步骤里其它命令（`from_step`）。
  - `replay_http`：真实抓包 → 由 curl 合成 → 仅当 `target` 是 http(s) 时合成（`2974-2989`）。
  - 条目合并：同 `point_id + step_id` 且成员数 `>= max(2, options.groupMin||5)` 时合并成一条，代表条目取"证据文本数字归一化后的众数"，`order_at` 取组内最早时间（`3091-3140`）。
  - 依赖推导 `deps`：强线索（本条认领的凭据其 `tool`/`note` 里的第一个 IP）+ 弱线索（本条证据里出现的其它条目目标 IP），最多 3 条，互相指认的成对剔除（`3215-3313`）。
  - 复现分类 `repro_kind`：`http`（有抓包，或 target 是 http(s) 且有报文）/ `cli`（命令可用；`template` 类必须占位符全填）/ `method`（只有动作说明）（`3319-3337`）。
  - 输出 `{items, stages, summary, markdown, target}`；markdown 五节结构（摘要对账 / 前置条件 / 攻击链 / 逐条明细 / 得分点说明 / 附录）见 `3387-3781`。
- **`report(id, options)`**（`5045-5146`）——旧版成果报告（`redteam_report`，已标弃用）：只收 `confirmed/exploited` 且 `critical/high/medium` 的漏洞 + 攻击链 + 权限凭据 + 修复建议。
- **`reportTargets(id, options)`**（`4912-5029`）——按目标分组的报告（`redteam_report_targets`，已标弃用）：目标键 = `asset_ip || slugTarget(target) || '未归属目标'`，分组按 C 段。

### 3.11 知识库

- **`kb()`**（`4620-4630`）：惰性打开 `knowledge.db`，`exec(KNOWLEDGE_DDL + POC_FTS_DDL)`（有 FTS5 时）+ `migrateKnowledge`。
- **`savePoc`**（`4646-4713`）：`title` 必填；`code` 未给则 `slugPoc(title,cve)`，给了则净化 `[^\w.\u4e00-\u9fa5-] → '-'` 并去前导 `.`/`-`（`4654-4656`）；目录与文件名都过 `assertPathWithin(…, [pocsDirOf()])`；`verified` 缺省沿用旧值；`category` 不在内置表 → `other`；`ON CONFLICT(code)` 更新，`content` 只在非空时覆盖（`4695`）。
- **`searchPocs`**（`4719-4768`）：`q` 先 FTS5 `MATCH`（每词加引号，`AND` 连接），无命中退化 7 列 `LIKE`；再叠加 `cve/component/kind/category(多值)/engagement(engagement_id 或 name LIKE)/asset_target/language/source/tag/verified`；排序 `verified DESC, hit_count DESC, updated_at DESC, id DESC`；`limit` 默认 200、上限 1000；**不返回 `content`**，只给 `content_bytes` 与 `has_content`。
- **`getPoc`**（`4771-4788`）：`key` 纯数字按 `id`，否则按 `code`；`content` 为空时从 `path` 读（限定在 `pocs/`）。
- **`updatePoc`**（`4801-4846`）：`content` 变了就重写文件（沿用原文件名或 `poc.txt`）并 `#reindexPoc`。
- **`deletePoc`**（`4848-4864`）：删行 + 删 FTS 行 + 删 `pocs/<code>/` 整目录（`startsWith` 防护）。
- **`pocStats`**（`4867-4906`）：总数/已验证/有正文/复用次数/未归类/最早/最新 + 按 kind/source/category/engagement/asset 聚合。
- **`templateStats` / `searchTemplates`**（`4591-4614`）：扫 `nucleiTemplatesDir()` 下 `.ya?ml`，只抽 `path/name/severity/tags` 前 2000 字符；索引缓存 7 天（`4550-4588`）。**`searchTemplates` 只接受 `(q, limit)` 两个参数**（`[实测]` `searchTemplates.length === 1`），`templateStats()` 只返回 `{dir,total,cve}`（`[实测]`）。

### 3.12 提示词

- **`listPrompts(id)`**（`5372-5388`）：先 `refreshDefaultPrompts`，再按 `ROLE_TITLES` 六角色返回 `{role,title,planner,dispatcher,content,updated_at}`。
- **`refreshDefaultPrompts(id, {force})`**（`5337-5370`）：文件不存在 → 写默认（计 `created`）；指纹等于当前默认 → 只更新 manifest；否则只有 `force` 或"manifest 记录的旧默认指纹"或 `LEGACY_PROMPT_HASHES`（**空对象**，`387`）命中才覆盖，且覆盖前 `copyFileSync(p, p+'.bak-'+Date.now())`（`5363`）。其余判为"用户自写"进 `kept`。
- **`savePrompt`**（`5401-5412`）：角色白名单，未知抛 `unknown role: x`；写入后按指纹是否等于当前默认决定 manifest 记录或删除。
- **`resetPrompts`**（`5391-5399`）：给 `role` 就重置一个，否则六个全重置。

### 3.13 阶段

- **`seedStages(id)`**（`1446-1462`）：缺哪个补哪个，`sort_order` 接在 `MAX+1` 后。`[实测]` 首次 `openEngagement` 后 `stage` 表仍为 0 行，**首次 `listStages` 才播种**。
- **`listStages`**（`1464-1475`）：先播种，返回带 `ordinal`（链路真实位置）与 `sections`（JSON 解析）的行。
- `migrate()` 会删 `code NOT IN ('recon','internet','boundary','internal','target')` 的行与旧 `target` 行（`schema.js:542-544`）。

### 3.14 控制台摘要

- **`consoleDigest(id)`**（`1123-1180`）：11 个页签各给 `{count, at}`；`sessions` 是 webshell+tunnel 的合计与最大时间，`agents`/`chain` 都取 `attack_step`，`knowledge` 取全局库；`prompts`/`skills` 恒 `{0,null}`（静态内容，永不点红点）。全部 `COUNT/MAX` 都包在 `try/catch` 里，表缺失当 0。

### 3.15 导入与并发隔离

- **`importBundle`** 是唯一带事务的写入路径（`5238, 5298-5302`）；其余方法都是单条 SQL，**没有跨方法事务**。
- **数据库句柄**：`this.handles: Map<engagementId, DatabaseSync>`（`945, 984-1002`），`close()` 统一释放（`1005-1014`）。
- **跨进程/跨会话互斥：没有**。只有 SQLite WAL + `busy_timeout=5000`。同进程内多个调用并发写同一 `assets.db` 依赖 `node:sqlite` 的串行化。
- **会话→靶标绑定**在 `tools.js` 模块级 `bindings: Map`（`125`），键是**根会话 id**；`capMap` 把容量限制到 500 并 FIFO 淘汰（`131-144`）。
- **`resolveEngagement(store, exec, explicit)`**（`tools.js:220-249`）三档解析：① `explicit` → ② `bindings` 里 `[rootId, sessionId, ...chain]` 任一命中 → ③ 全局 `activeEngagementId()`；第 ③ 档若该靶标已被**别的会话**占用则**抛错**而不是静默串写（`231-238`）；只有一个靶标时自动绑定（`243-247`）；否则抛 `尚未绑定靶标…`。
- **`resolveRootSession`**（`178-200`）：沿 `session.header.parentSession` 上溯，最多 64 跳；父会话不在内存时把父 id 当作稳定根键。
- **并发闸门 `reservations: Map<rootId, Map<key, ts>>`**（`128`）：`used = max(注册表 running 数, 预留数)`（`782`），上限由 `maxAgentsOf`（settings.json → `REDTEAM_MAX_AGENTS` → 3，`settings.js:56-62`）决定；`subagent/end` 自动释放（`421-440`），释放无 key 时只放最早一条（`339-348`）。
- **进程重启即丢绑定**：`bindings`/`reservations`/`roleBySession`（`role-section.js:16`）都是进程内 Map，`redteam_session_info` 的返回文案里也明说这一点（`tools.js:515`）。

---

## 4. 对外接口

### 4.1 HTTP op（`POST /redteam/api`，`ui.js:1079-1155`）

| 类型 | 名称 | 入参 | 出参 | 调用方 |
| --- | --- | --- | --- | --- |
| HTTP op | `dispatch` 的 71 个 op（§3.0、§9.1） | `{op, engagement, ...}` | `{ok, ...}`；失败 `{ok:false,error}` 且 HTTP 200 | `client.js`、`bin/cli.mjs`（本仓库另有 CLI 壳） |
| HTTP op | `probeSessions` | `{op, engagement?, timeoutMs?}` | `{ok, webshells[], tunnels[], checkedAt}` | `client.js:3345` |
| HTTP op（UI 私有） | `platformConfigGet` / `platformConfigSave` / `platformAssignToolkit` / `platformEnvAdaptStatus` / `platformEnvAdaptSkip` | `{op, config?, dir?, skip?}` | `platformSummary()` / `envAdaptStatus()` | `client.js:2653, 2676, 2689` |
| HTTP op（UI 私有） | `agentsStatus` / `setAgentsMax` | `{op, max?}` | `{ok, max, used, free, running[], source}` | `client.js:3583, 3643` |
| HTTP op（UI 私有） | `version` / `updateCheck` / `updateApply` | `{op, target?}` | 版本与安装态；`updateApply` 会 `npm/pnpm install` 并重启宿主 | `client.js:3689-3710` |
| HTTP op（UI 私有） | `skillCatalog` / `skillRead` | `{op, refresh?, name?, library?}` | 技能目录/正文（红队库 + 官方库） | `client.js:1315, 1331` |

路由注册：`ctx.webServer.register({kind:'exact', path:'/redteam/api', handler})`（`ui.js:1079-1081`）。方法必须 `POST`，否则 405（`1083-1086`）。请求体上限 8 MiB（`158`），超限 `destroy`（`599-604`）。来源校验（`1090-1114`）：回环地址直接放行；非回环要求 `Origin` 与 `Host` 同源，`app:` 协议在 `Host` 为本地时放行。

### 4.2 agent 工具（64 个，`tools.js`，全部 `output.schema.type='string'`）

见 §9.2 全表。统一约定：`withStructuredErrors` 包一层（`376-398`），抛错转成 `{ok:false, error, error_kind:'bad_input'|'failed', hint}`。

### 4.3 事件 / hook

| 类型 | 名称 | 位置 | 作用 |
| --- | --- | --- | --- |
| 事件 | `agent/pre-step`（`{global:true, prepend:true}`） | `ui.js:1063` | redteam 预设首轮首步若 `envAdaptStatus().ready===false` → `{kind:'reject'}` 拦下发送 |
| 事件 | `agent/inbox/claimed`（`{global:true, prepend:true}`） | `role-section.js:154` | 从子会话第一条消息解析 `redteamRole:` 记角色 |
| 事件 | `subagent/end` | `tools.js:424` | 自动释放并发名额 |
| 服务 | `ctx.provide('redteam', store)` | `store.js:70` | 进程级事实库 |
| 服务 | `ctx.provide('redteamMode', {paths, preset, setup})` | `index.js:617` | 只读自举结果 |
| registry | `agentPresets.register(definition)` | `index.js:550` | 把 `redteam` 预设挂进模式下拉 |

### 4.4 slot / CLI

本模块**不注册任何 UI slot**（slot 由 `client.js` 侧消费）。CLI 壳 `bin/cli.mjs` 与 HTTP 桥共用 `dispatch`，但不在本次 19 文件范围内。

---

## 5. UI 触点

> 只列「这个 op 被哪个前端组件调用」，前端实现不在范围。组件名取自 `client.js` 的函数定义行。

| 组件 | 文件:行 | 依赖的 op | 展示字段 | 交互 |
| --- | --- | --- | --- | --- |
| `AssetsTab` | `client.js:772` | `assets`(805) / `domains`(827) / `web`(834) / `asset`(843) / `discoveryTimeline`(1164) / `shotData`(618) | `total`、`items[].ip/ports/fingerprints/scope/test_status/priority` | 改 C 段/关键词/排序即重查；点资产拉详情；点图拉 base64 |
| `PromptsTab` | `client.js:1208` | `prompts`(1219) / `savePrompt`(1236) / `resetPrompts`(1250) | `roles[].role/title/content/updated_at` | 编辑正文 → 保存；「恢复默认」按角色重置 |
| `SkillsTab` | `client.js:1300` | `skillCatalog`(1315) / `skillRead`(1331) | `items[].availability/problems/needs_user/library` | 点技能看正文；`refresh:true` 跳过 30s 缓存 |
| `FindingsTab` | `client.js:1559` | `vulns`(1581) / `credentials`(1590) / `access`(1591) / `attackFiles`(1592) / `updateVuln`(1598) | 漏洞 severity/status/evidence/http_evidence、凭据明文 | 改漏洞状态（confirmed/exploited/false-positive） |
| `ChainTab` | `client.js:1845` | `scoreChain`(1857) / `activeTests`(3204 同页) | `stages[].points/cumulative/assets/tunnels` | 只读；用于看"打到第几阶段" |
| `ReportTab` | `client.js:2050` | `scoreReport`(2063) + `scoreChain`(2068) | `summary`、`markdown` | 生成/复制/下载报告 |
| `AttackFilesTab` | `client.js:2273` | `attackFiles`(2285) / `readAttackFile`(2297) | 目录树 + 文件正文 | 点文件读正文（越界返回拒绝文案） |
| `KnowledgeTab` | `client.js:2357` | `pocSearch`(2391) / `pocGet`(2403) / `pocUse`(2415) | `items[].category/verified/hit_count`、模板命中 | 检索、看正文、标记复用 |
| `EnvTab` | `client.js:2628` | `platformConfigGet`(2653) / `platformConfigSave`(2676) / `platformAssignToolkit`(2689) | `config`、`tools.items[].path/source`、`adapt` | 填路径/选文件夹自动分配；保存即生效 |
| `ScoreTab` | `client.js:2829` | `scores`(2842) / `saveScorePoint`(2866) / `deleteScorePoint`(2886) | `items[].points/earned/capped/cap_used/scope_label/hits[]/shots` | 启用/停用；内置点分值输入框置灰（`overridden:false` 时给原因） |
| `TestingTab` | `client.js:3186` | `activeTests`(3204) | `testing/recent/queue/stats/untested` | 轮询刷新"当前正在测" |
| `SessionTab` | `client.js:3324` | `sessions`(3335) / `probeSessions`(3345) / `updateTunnel`(3364) / `updateWebshell`(3369) | webshell/tunnel 状态、`legit`、`entry_kind_label` | 「实测连通性」按钮；手动标 down |
| `AgentsTab` | `client.js:3566` | `agentsStatus`(3583) / `setAgentsMax`(3643) | `max/used/free/running[]/source` | 改并发上限（立即生效） |
| 顶栏版本区 | `client.js:3689-3710` | `version` / `updateCheck` / `updateApply` | `current/latest/updateAvailable/localAhead/blockers` | 「检查更新」「更新并重启」 |
| 外壳（切靶标/红点） | `client.js:3872-4102` | `bootstrap`(3880) / `snapshot`(3872) / `openEngagement`(3899) / `activateEngagement`(4102) / `consoleDigest`(3971) | `engagements[]`、`current`、各页签未读 | 新建/切换靶标；点红点 |

---

## 6. 依赖

### 6.1 内部（本目录内）

`store-core.js` → `ip-utils.js`、`report-replay.js`、`schema.js`、`validate.js`、`score-rules.js`、`platform-config.js`（`26-53`），并把它们再导出一遍（`56-69`）。
`tools.js` → `store-core.js`(角色常量)、`skill-availability.js`、`platform-config.js`、`settings.js`、`evidence-ledger.mjs`（`21-31`）。
`ui.js` → `store-core.js`(dispatch)、`skill-availability.js`、`settings.js`、`platform-config.js`（`21-28`）。
`schema.js` → `score-rules.js`（只 `parseTargetPort`，`4`）。
`score-rules.js` → `ip-utils.js`（只 `isIpv6`，`15`）。
`skill-availability.js` → `skill-fixes.js`（`28`）。
`settings.js` / `platform-config.js` → `atomic-write.js`。
`index.js` → `preset-composition.js`（`14`）+ `lib/preset-compat.js`（`13`）。

### 6.2 上级 `lib/`（跨目录）

| 模块 | 引用点 | 用途 |
| --- | --- | --- |
| `lib/path-boundary.js` | `store-core.js:1`（`assertNoLinkedDescendants`）、`validate.js:7`（`assertWithinRoots`）、`tools.js:20`（`within`） | 路径包含性判定（含 junction / 未创建的后代） |
| `lib/remove-tree.js` | `store-core.js:2` | `deletePoc` 的不跟随符号链接删目录 |
| `lib/identity.js` | `role-section.js:11` | `isRedteamSession()` 判定是否红队会话 |
| `lib/preset-compat.js` | `index.js:13` | 预设迁移/兼容（`migratePresetDefinition` 等） |
| `lib/index.js` | 反向引用 `role-section.js:34` | 组装系统提示词时插入角色稿（`lib/index.js:595`） |

### 6.3 宿主 API（逐个标注是否公开）

| API | 位置 | 用途 | 公开性 |
| --- | --- | --- | --- |
| `ctx.provide(name, value)` | `store.js:70`、`index.js:617` | 发布服务 | Cordis 公开 |
| `ctx.get(name)` | `tools.js:305, 529, 641, 916`；`ui.js:634`；`index.js:502, 518` | 软取 `subagents`/`sessions`/`skills`/`agentPresets`/`profileContext` | Cordis 公开（未 inject 时会抛，故全部包 `try`） |
| `ctx.on(event, fn, opts)` | `ui.js:1063`、`role-section.js:154`、`tools.js:424` | 事件钩子 | Cordis 公开 |
| `ctx.effect(fn)` | `store.js:69`、`ui.js:421, 1057, 1079`、`role-section.js:146`、`index.js:576` | 生命周期绑定 | Cordis 公开 |
| `ctx.webServer.register({kind,path,handler})` | `ui.js:1079` | 注册 `/redteam/api` | **插件私有接缝**（作者注释明说是最小稳定接缝，`ui.js:11-13`） |
| `ctx.tools.register(defineTool({...}))` | `tools.js:442` 起 64 处 | 注册工具 | `@deepseek-ai/dsh-tools` 的 `defineTool`（动态解析，`tools.js:38-116`） |
| `ctx.agentPresets.register(definition)` | `index.js:550` | 声明预设 | 宿主 registry |
| `ctx.agentPresets.standingKeyFor(presetId)` | `ui.js:703`、`tools.js:643` | 取 preset 的 standing scope | 宿主 API |
| `ctx.agentPresets.list()` | `index.js:552` | 校验是否登记成功 | 宿主 API |
| `subagents.listChildren(rootSessionId)` | `tools.js:310`、`ui.js:342, 929` | 真实运行中的子会话 | 宿主 API |
| `sessions.list()` | `ui.js:336, 923` | 根会话枚举 | 宿主 API |
| `skills.list({scope})` / `skills.get(name,{scope})` | `ui.js:718, 777`、`tools.js:647, 673` | 技能目录与正文 | 宿主 API |
| `ctx.logger.info/warn/error` | 多处 | 日志 | 宿主 API |
| `ctx.baseUrl` | `ui.js:266` | 取 profile 目录（`file://` URL，必须 `fileURLToPath`） | 宿主属性 |
| `ctx.redteam` | `ui.js:1025`、`tools.js:403` | 直取事实库实例 | 本插件自建 |

### 6.4 外部（网络 / 子进程 / 文件系统）

| 类型 | 目标 | 位置 |
| --- | --- | --- |
| 网络 | `fetch(webshell.url)` 真实 HTTP GET | `store-core.js:4013` |
| 网络 | `net.connect({host, port})` 探测隧道 | `store-core.js:4043` |
| 网络 | `https.request` 访问 `api.github.com/repos/<repo>/tags` | `ui.js:364-409, 419` |
| 子进程 | `spawn(pm, ['view', name, 'version'])`、`spawn(pm, ['add'/'install', spec])` | `ui.js:163-244, 556-586` |
| 子进程 | `spawn(process.execPath, [restartScript])`，脚本内再 `spawn` 重启 dsh | `ui.js:578`、`487-553` |
| 子进程 | `execFileSync('taskkill', ['/T','/F','/PID', pid])`（Windows 杀进程树） | `ui.js:204` |
| 文件 | `$DSH_HOME/.env` 解析（`FOFA_KEY` 等） | `tools.js:533-552` |
| 文件 | `/etc/os-release`、`/usr/share/kali-menu` 等 | `platform-config.js:372-384` |
| 文件 | `~/.local/nuclei-templates`、`/usr/share/nuclei-templates`、`<root>/toolkit/nuclei-templates` | `store-core.js:4534-4541` |
| 文件 | `$DSH_HOME/.agent-presets/redteam/*`（预设落地）、`$DSH_HOME/redteam/skills`（技能同步） | `index.js:374-448, 176-195` |

---

## 7. 与另一版的差异

**与 safe 2.0.0 的差异我未查。** 本文档只覆盖 community 1.7.20 的快照；§1–§6、§8–§10 的每条结论都只对 community 成立。若要做双版本对照，需要另起一份审计，在 `vendor/safe/lib/redteam/` 上重跑同样的 10 节结构并逐条补行号。

| 能力 | community 行号 | safe 行号 | 差异性质 |
| --- | --- | --- | --- |
| （全部） | 见 §1–§6 | 未查 | 未查 |

---

## 8. 风险与脆弱点

| 风险 | 触发条件 | 后果 | 是否可静态检出 |
| --- | --- | --- | --- |
| **`migrate()` 里两个未定义标识符**：`LEGACY_STAGE_MAP`（`schema.js:586`）与 `SCOPE_SQL`（`schema.js:591`）在 `schema.js` 内既未定义也未导入（模块级 `const` 定义在 `store-core.js:157, 358`，不可见）。两处都在 `try/catch` 内，`ReferenceError` 被吞。 | 每次打开靶标都会执行 `migrate()` | ① 老库 `asset.scope` **永远不回填**（`[实测]` 插入 10.0.0.5 与 8.8.8.8 后 `scope` 仍为 `NULL`）；② `attack_step.stage_code` 的 legacy 映射**永不执行**（`[实测]` `stage='exploit'` 的步骤 `stage_code` 仍为 `NULL`）。两者都静默，无日志 | 是（读代码 + 一次 `migrate()` 实跑即可） |
| 无靶标时写操作静默成功 | `dispatch` 的前缀正则 `/^(add\|save\|update\|delete\|import\|assess\|open)/`（`store-core.js:805`）不匹配 `shotAdd`/`shotDelete`/`assetTest` | 前端拿到 `{ok:true, items:[]}`，**看起来像成功但什么都没写**（`[实测]`） | 是 |
| 模板分类筛选与统计字段失效 | `tools.js:2075` 给 `searchTemplates` 传 4 个参数，实现只接 `(q, limit)`；`tools.js:2076/2088` 读 `tplStats.byCategory`，`templateStats()` 只返回 `{dir,total,cve}` | 模板 `category` 过滤永远不生效；`by_category` 字段在 JSON 里被丢掉（`[实测]`） | 是 |
| `service`/`fingerprint` 无唯一约束 + 裸 INSERT | 同一资产重复 `importBundle`（信息收集角色天然会重跑） | 端口行在 `LEFT JOIN service` 下**重复出现**（`assetChildren` `1226-1229`），端口计数虚高 | 是 |
| 明文凭据入库 | `addCredential` 把口令写进 `secret_value`（`2279-2289`），`listCredentials` 原样返回（`2307`） | `assets.db` 本身就是高价值文件；任何能读 `$DSH_HOME` 的进程都能拿到全部口令 | 是（设计如此，需在交付文档里显式声明） |
| 库内路径列不可信 | `attack_file.path`、`poc.path` 由智能体写入，`readAttackFile`/`getPoc` 读之前才校验 | 校验已补（`4515`、`4784`），但**写入侧只校验了根目录**，没有对 `file`/`filename` 的扩展名做限制 → 可写入 `.html`/`.svg` 并被外部打开 | 是 |
| 截图来源路径限制在靶标目录内 | `assertSourcePath(this.dirOf(id), shot.path)`（`4293`） | 智能体无法把 `/etc/passwd` 当"图片"登记进库（`[实测]` 抛 `path outside allowed roots`） | 是（已是防护） |
| `probeSessions` 是 host 侧任意 HTTP/TCP 探测 | WebShell `url` 由智能体填写，无白名单/无内网地址过滤（`4013`）；隧道 `listen` 同样（`4043`） | 可被用作内网探活/端口扫描的通道（有 6s 超时与 20s 上限，但**并发与目标数无限制**） | 是 |
| `updateApply` 会执行包管理器并重启宿主 | `ui.js:556-586` | 目标版本被 semver 白名单约束（`1006`），但仍会 `npm install <pkg>@<ver>` 并 `process.exit(0)`；中断所有在跑会话 | 是（已有 `blockers` 拦截在跑智能体，`350-352`） |
| `.bak-<ms>` 提示词备份无上限 | `refreshDefaultPrompts` 每次覆盖都 `copyFileSync`（`5363`） | `agents/` 目录无限增长 | 是 |
| 证据账本跨靶标记录会让计数直接抛错 | `countUnresolvedClaims` 遇到 `engagement_id` 不符的行就抛（`317`） | `redteam_unverified_count` 变成 `ok:false`，而不是给出数字（`[实测]`） | 是 |
| 无跨进程维护锁 | 全模块无锁文件；只有 WAL + `busy_timeout` | 面板点"应用"、CLI、启动自愈三条路径可同时写同一 `assets.db`；`score_hit` 的"读整块看板→判封顶"不是事务，并发记分可能双计 | 是 |
| 中文靶标名直接做目录名 | `slugify` 保留 `\p{L}`（`ip-utils.js:88-91`） | 大小写不敏感文件系统（macOS 默认）上 `ACME` 与 `acme` 会落到同一目录；跨机器拷贝可能出编码问题 | 是（`[实测]` id = `示例科技有限公司`） |
| FTS5 缺席时降级 | `HAS_FTS5`（`schema.js:31-44`） | 检索退化为 `LIKE`（`listAssets` `1348-1362`、`searchPocs` `4731-4736`），`asset_fts`/`poc_fts` 不建表；本机 Node v26.13.1 带 FTS5（`[实测]`） | 是 |
| `dispatch` 把所有异常压成 `ok:false` + HTTP 200 | `872-874`、`ui.js:1150` | 前端无法用状态码区分"参数错"与"服务端崩"；只能读 `error` 文本 | 是 |

---

## 9. 逐条功能清单

### 9.1 op 分支（71 条，`store-core.js`）

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
| --- | --- | --- | --- | --- |
| CM-RT-001 | `bootstrap` 取靶标列表与当前指针 | `746-754` | 完整 | 优先 `current` 指针，其次最近创建 |
| CM-RT-002 | `openEngagement` 建/开靶标 | `755-757` → `1048-1067` | 完整 | 建目录+库+播种+六个角色提示词 |
| CM-RT-003 | `activateEngagement` 切当前指针 | `758-761` → `963-968` | 完整 | 库不存在返回 `ok:false` |
| CM-RT-004 | `pocSearch` 知识库+nuclei 模板双层检索 | `763-771` | 完整 | 无 q 时只给模板统计 |
| CM-RT-005 | `pocList` 列表 + 统计 | `772` | 完整 | 与 `pocSearch` 差别只在无模板层 |
| CM-RT-006 | `templateSearch` 模板检索 | `773` | **部分** | 只接 `(q, limit)`；`tools.js` 传 4 参被忽略 |
| CM-RT-007 | `templateStats` 模板统计 | `774` | **部分** | 无 `byCategory` 字段 |
| CM-RT-008 | `pocGet` 取正文 | `775` → `4771-4788` | 完整 | 数字按 id、其余按 code |
| CM-RT-009 | `pocSave` 落库 | `776` → `4646-4713` | 完整 | code 净化 + 路径边界 |
| CM-RT-010 | `pocUpdate` 更新 | `777` → `4801-4846` | 完整 | 正文变更重写文件 |
| CM-RT-011 | `pocDelete` 删除（含目录） | `778` → `4848-4864` | 完整 | 返回 `removed_files` |
| CM-RT-012 | `pocUse` 记复用 | `779` → `4791-4798` | 完整 | `hit_count+1` |
| CM-RT-013 | `pocStats` 概览 | `780` → `4867-4906` | 完整 | 按 8 个维度聚合 |
| CM-RT-014 | `platformConfigGet` | `782` → `platformSummary` | 完整 | 与 `ui.js` 的 `platformConfigGet` 同名同实现 |
| CM-RT-015 | `platformConfigSave` | `783-786` | 完整 | 原子写 config.json |
| CM-RT-016 | `platformAssignToolkit` 整包分配 | `787` → `assignToolkitFolder` | 完整 | 递归扫 4 层、最多 8000 文件 |
| CM-RT-017 | 无靶标时 `prompts` 回内置默认 | `792-806` | 完整 | `builtin:true`、`updated_at:null` |
| CM-RT-018 | 无靶标时写 op 报错 | `800-801` | **部分** | 前缀正则漏 `shotAdd/shotDelete/assetTest` |
| CM-RT-019 | 无靶标时读 op 回空结果 | `802` | 完整 | 统一形状 `{ok,items,total,stats,segments,stages,roles}` |
| CM-RT-020 | `snapshot` 概览 | `810` → `1182-1193` | 完整 | meta + stats + testStats + segments |
| CM-RT-021 | `assets` 资产列表 | `811` → `1291-1396` | 完整 | 10 个过滤维度 + 5 种排序 |
| CM-RT-022 | `asset` 单资产详情 | `812` → `1398-1408` | 完整 | 附 200 条 observation + 全部 edge |
| CM-RT-023 | `graph` 拓扑 | `813` → `1411-1440` | 完整 | 段→资产→端口 + 域名边 |
| CM-RT-024 | `attackGraph` 攻击图谱 | `814` → `4071-4101` | 完整 | 叠漏洞节点（上限 200）与 owned |
| CM-RT-025 | `stats` 计数 | `815` → `1097-1115` | 完整 | 10 个 COUNT |
| CM-RT-026 | `vulns` 列表 + 统计 | `816` → `2204-2239` | 完整 | 内联 http_evidence（request 截 60000） |
| CM-RT-027 | `addVuln` 幂等写入 | `817` → `2168-2202` | 完整 | cve 或 (title,target) 二选一作键 |
| CM-RT-028 | `updateVuln` | `818` → `2241-2253` | 完整 | 找不到返回 `updated:false` 不抛 |
| CM-RT-029 | `vulnStats` | `819` → `2255-2271` | 完整 | 含 `targetGroups` |
| CM-RT-030 | `credentials` 列表 | `820` → `2298-2308` | 完整 | 返回明文 |
| CM-RT-031 | `addCredential` | `821` → `2274-2296` | 完整 | `UNIQUE(host,username,secret_type)` upsert |
| CM-RT-032 | `access` 列表 | `822` → `2325-2333` | 完整 | 只支持 host 过滤 |
| CM-RT-033 | `addAccess` | `823` → `2311-2323` | 完整 | host 必填 |
| CM-RT-034 | `sessions` 会话总览 | `824` → `3972-3995` | 完整 | 含 legit 统计 |
| CM-RT-035 | `webshells` 列表 | `825` → `2365-2375` | 完整 | LEFT JOIN asset 取 ip |
| CM-RT-036 | `addWebshell` | `826` → `2341-2363` | 完整 | 类型/状态规范化，非法即抛 |
| CM-RT-037 | `updateWebshell` | `827` → `2377-2396` | 完整 | 白名单 8 字段 |
| CM-RT-038 | `tunnels` 列表 | `828` → `2442-2454` | 完整 | 附 `legit` 与 `entry_kind_label` |
| CM-RT-039 | `shots` 列表 | `829` → `4334-4354` | 完整 | 按 point/hit/asset/vuln 过滤 |
| CM-RT-040 | `shotAdd` 登记截图 | `830` → `4269-4331` | 完整 | 路径限靶标目录；空文件拒收 |
| CM-RT-041 | `shotDelete` | `831` → `4360-4368` | 完整 | 删文件+删行 |
| CM-RT-042 | `shotData` 取 base64 | `832` → `4375-4383` | 完整 | 刻意不开静态路由 |
| CM-RT-043 | `addTunnel` | `833` → `2408-2440` | 完整 | `entry_kind` 白名单 + legit 判定 |
| CM-RT-044 | `updateTunnel` | `834` → `2456-2489` | 完整 | `status` 四值白名单 |
| CM-RT-045 | `domains` 域名索引 | `835` → `4109-4134` | 完整 | 无域名归 `(未关联域名)` |
| CM-RT-046 | `web` Web 资产 | `836` → `4137-4153` | 完整 | 15 个常见 Web 端口白名单 |
| CM-RT-047 | `httpEvidence` 列表 | `837` → `4168-4177` | 完整 | limit 上限 500 |
| CM-RT-048 | `addHttpEvidence` | `838` → `4157-4166` | **部分** | 无必填校验，空 request 也入库 |
| CM-RT-049 | `chain` 攻击链列表 | `839` → `4243-4249` | 完整 | LEFT JOIN asset/vuln |
| CM-RT-050 | `addChainStep` | `840` → `4185-4241` | 完整 | 带 `point_code`+`evidence` 自动记分 |
| CM-RT-051 | `report` 旧版报告 | `841` → `5045-5146` | 完整（已弃用） | 只收 confirmed/exploited 且 ≥medium |
| CM-RT-052 | `assetTest` 测试状态 | `842` → `2112-2154` | 完整 | test 追加、surface 覆盖、blocked 计数 |
| CM-RT-053 | `assessAsset` 易打性评估 | `843` → `2088-2100` | 完整 | priority 三值 |
| CM-RT-054 | `scores` 得分面板 | `844` → `1613-1843` | 完整 | 含 8 类分组与代表图 |
| CM-RT-055 | `saveScorePoint` | `845` → `1857-1912` | 完整 | 内置点只落 enabled/sort_order |
| CM-RT-056 | `deleteScorePoint` | `846` → `1915-1928` | 完整 | 内置点拒删 |
| CM-RT-057 | `addScoreHit` 记分 | `847` → `1951-2085` | 完整 | 六道硬校验 + 封顶回读 |
| CM-RT-058 | `scoreChain` 攻击链 | `848` → `3788-3969` | 完整 | 五阶段 + 累计分 |
| CM-RT-059 | `scoreReport` 交付报告 | `849` → `2703-3782` | 完整 | 含复现入口与依赖推导 |
| CM-RT-060 | `activeTests` 当前测试 | `850` → `2495-2522` | 完整 | testing/recent/queue 三组 |
| CM-RT-061 | `testStats` | `851` → `2157-2163` | 完整 | 六状态计数 |
| CM-RT-062 | `consoleDigest` 未读指针 | `853` → `1123-1180` | 完整 | 11 个页签，缺表按 0 |
| CM-RT-063 | `stages` 阶段列表 | `854` → `1464-1475` | 完整 | 惰性播种 |
| CM-RT-064 | `saveStage` | `855` → `1478-1500` | 完整 | upsert，未传字段沿用 |
| CM-RT-065 | `reportTargets` 按目标报告 | `856` → `4912-5029` | 完整（已弃用） | 按 C 段再分组 |
| CM-RT-066 | `discoveryTimeline` 发现时间线 | `858` → `1075-1094` | 完整 | 按天聚合 + 最近 N 条 |
| CM-RT-067 | `attackFiles` 目录树 | `859` → `4498-4507` | 完整 | 按 target 分组 |
| CM-RT-068 | `addAttackFile` | `860` → `4450-4485` | 完整 | 三必填 + evidence 强制 |
| CM-RT-069 | `readAttackFile` | `861` → `4509-4521` | 完整 | 越界返回拒绝文案 |
| CM-RT-070 | `import` 采集入库 | `862` → `5226-5304` | 完整 | 唯一带事务的写入路径 |
| CM-RT-071 | `prompts` / `savePrompt` / `resetPrompts` | `863-865` → `5372-5412` | 完整 | 指纹决定"是否跟随新版默认" |
| CM-RT-072 | `probeSessions` 实测连通性（异步） | `877-889` → `4002-4064` | 完整 | host 侧真实 HTTP/TCP |

### 9.2 agent 工具（64 个，`tools.js`）

| 编号 | 工具 | 代码位置 | 调用的 store 方法 | 状态 |
| --- | --- | --- | --- | --- |
| CM-RT-101 | `redteam_engagement_open` | `442-469` | `openEngagement(..., {bindCurrent:false})` + `stats` | 完整 |
| CM-RT-102 | `redteam_session_bind` | `471-502` | `listEngagements` | 完整 |
| CM-RT-103 | `redteam_session_info` | `504-518` | `stats` | 完整 |
| CM-RT-104 | `redteam_preflight` | `520-761` | `platformSummary` + `checkSkill` + `summarizeSkills` | 完整 |
| CM-RT-105 | `redteam_agent_slot` | `763-816` | `subagents.listChildren` + 预留表 | 完整 |
| CM-RT-106 | `redteam_asset_add` | `818-901` | `importBundle` + `listAssets` | 完整 |
| CM-RT-107 | `redteam_asset_link` | `903-927` | `importBundle({edges})` | 完整 |
| CM-RT-108 | `redteam_asset_query` | `929-959` | `listAssets` | 完整 |
| CM-RT-109 | `redteam_asset_get` | `961-975` | `getAsset` | 完整 |
| CM-RT-110 | `redteam_asset_stats` | `977-986` | `stats` + `listSegments` | 完整 |
| CM-RT-111 | `redteam_asset_graph` | `988-1010` | `graph` + `listSegments` | 完整（节点超限报错） |
| CM-RT-112 | `redteam_role_prompt` | `1012-1032` | `listPrompts` | 完整 |
| CM-RT-113 | `redteam_roles` | `1034-1045` | 常量 | 完整 |
| CM-RT-114 | `redteam_asset_test` | `1047-1067` | `updateAssetTest` | 完整 |
| CM-RT-115 | `redteam_vuln_add` | `1071-1095` | `addVuln` + `vulnStats` | 完整 |
| CM-RT-116 | `redteam_vuln_query` | `1097-1116` | `listVulns` + `vulnStats` | 完整 |
| CM-RT-117 | `redteam_vuln_update` | `1118-1137` | `updateVuln` + `vulnStats` | 完整 |
| CM-RT-118 | `redteam_credential_add` | `1141-1165` | `addCredential` | 完整 |
| CM-RT-119 | `redteam_shot_add` | `1167-1191` | `addShot` | 完整 |
| CM-RT-120 | `redteam_shot_list` | `1193-1209` | `listShots` | 完整 |
| CM-RT-121 | `redteam_shot_delete` | `1211-1223` | `deleteShot` | 完整 |
| CM-RT-122 | `redteam_credential_list` | `1225-1238` | `listCredentials` | 完整 |
| CM-RT-123 | `redteam_access_add` | `1240-1260` | `addAccess` | 完整 |
| CM-RT-124 | `redteam_access_list` | `1262-1274` | `listAccess` | 完整 |
| CM-RT-125 | `redteam_role_prompt_reset` | `1276-1292` | `resetPrompts` | 完整 |
| CM-RT-126 | `redteam_sessions` | `1296-1319` | `sessionSummary` | 完整 |
| CM-RT-127 | `redteam_webshell_add` | `1321-1342` | `addWebshell(status:'online')` | 完整 |
| CM-RT-128 | `redteam_webshell_list` | `1344-1357` | `listWebshells` | 完整 |
| CM-RT-129 | `redteam_webshell_update` | `1359-1376` | `updateWebshell` | 完整 |
| CM-RT-130 | `redteam_tunnel_add` | `1378-1402` | `addTunnel(status:'active')` | 完整 |
| CM-RT-131 | `redteam_tunnel_list` | `1404-1416` | `listTunnels` | 完整 |
| CM-RT-132 | `redteam_tunnel_update` | `1418-1438` | `updateTunnel` | 完整 |
| CM-RT-133 | `redteam_session_check` | `1440-1459` | `probeSessions` | 完整 |
| CM-RT-134 | `redteam_attack_path` | `1461-1487` | `attackGraph` | 完整（节点超限报错） |
| CM-RT-135 | `redteam_web_list` | `1491-1513` | `listWeb` | 完整 |
| CM-RT-136 | `redteam_domain_index` | `1515-1524` | `domainIndex` | 完整 |
| CM-RT-137 | `redteam_score_list` | `1528-1562` | `listScorePoints` | 完整 |
| CM-RT-138 | `redteam_score_hit` | `1564-1606` | `addScoreHit` | 完整 |
| CM-RT-139 | `redteam_score_point_save` | `1608-1627` | `saveScorePoint` | 完整 |
| CM-RT-140 | `redteam_asset_assess` | `1629-1647` | `assessAsset` | 完整 |
| CM-RT-141 | `redteam_http_evidence_add` | `1651-1673` | `addHttpEvidence` | 完整 |
| CM-RT-142 | `redteam_chain_add` | `1675-1709` | `addChainStep` + hints | 完整 |
| CM-RT-143 | `redteam_chain` | `1711-1720` | `listChain` | 完整 |
| CM-RT-144 | `redteam_attack_file_add` | `1722-1744` | `addAttackFile` | 完整 |
| CM-RT-145 | `redteam_attack_file_list` | `1746-1759` | `listAttackFiles` / `attackFileTree` | 完整 |
| CM-RT-146 | `redteam_report_targets` | `1761-1778` | `reportTargets` | 完整（弃用） |
| CM-RT-147 | `redteam_attack_chain` | `1780-1806` | `scoreChain` | 完整 |
| CM-RT-148 | `redteam_score_report` | `1809-1828` | `scoreReport` | 完整 |
| CM-RT-149 | `redteam_report` | `1830-1840` | `report` | 完整（弃用） |
| CM-RT-150 | `redteam_evidence_record` | `1854-1887` | `EvidenceLedger.record` | 完整 |
| CM-RT-151 | `redteam_evidence_verify` | `1889-1916` | `EvidenceLedger.verify` | 完整 |
| CM-RT-152 | `redteam_evidence_upgrade` | `1918-1937` | `EvidenceLedger.upgrade` | 完整 |
| CM-RT-153 | `redteam_evidence_list` | `1939-1961` | `EvidenceLedger.list` | 完整 |
| CM-RT-154 | `redteam_unverified_count` | `1963-1976` | `countUnresolvedClaims` | **部分**（跨靶标记录会抛错） |
| CM-RT-155 | `redteam_unknown_record` | `1978-2003` | `UnknownRegistry.record` | 完整 |
| CM-RT-156 | `redteam_unknown_resolve` | `2005-2020` | `UnknownRegistry.resolve` | 完整 |
| CM-RT-157 | `redteam_unknown_list` | `2022-2042` | `UnknownRegistry.list` | 完整 |
| CM-RT-158 | `redteam_poc_search` | `2049-2106` | `searchPocs` + `templateStats` + `searchTemplates` | **部分**（模板分类筛选失效） |
| CM-RT-159 | `redteam_poc_get` | `2108-2121` | `getPoc` | 完整 |
| CM-RT-160 | `redteam_poc_add` | `2123-2172` | `savePoc` + `pocStats` | 完整 |
| CM-RT-161 | `redteam_poc_list` | `2174-2190` | `searchPocs` + `pocStats` | 完整 |
| CM-RT-162 | `redteam_poc_update` | `2192-2213` | `updatePoc` | 完整 |
| CM-RT-163 | `redteam_poc_use` | `2215-2228` | `markPocUsed` | 完整 |
| CM-RT-164 | `redteam_asset_timeline` | `2232-2255` | `discoveryTimeline` | 完整 |

### 9.3 引擎与辅助（`store-core.js` 之外）

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
| --- | --- | --- | --- | --- |
| CM-RT-201 | DDL 建表（22 表 + 2 视图 + 39 索引） | `schema.js:67-360` | 完整 | 无外键约束 |
| CM-RT-202 | FTS5 能力探测 + 降级 | `schema.js:31-44` | 完整 | `REDTEAM_NO_FTS5=1` 可强制降级 |
| CM-RT-203 | `migrate()` 增量补列 | `schema.js:466-597` | **部分** | `586/591` 两处 `ReferenceError` 被吞，scope 回填与 stage 映射失效 |
| CM-RT-204 | `migrateKnowledge()` | `schema.js:605-630` | 完整 | 补 5 列 + 2 索引 + 老条目归类推测 |
| CM-RT-205 | `guessPocCategory` 关键词归类 | `schema.js:441-458` | 完整 | 12 类 + `other` |
| CM-RT-206 | `applyScoreCaps` 口径去重 + 规则上限 | `score-rules.js:162-255` | 完整 | 三处共用唯一实现 |
| CM-RT-207 | `evaluateScoreBoard` 统一评估 | `score-rules.js:435-464` | 完整 | 含 `enabledOnly` 过滤 |
| CM-RT-208 | `hitPointsOf` 档位×倍率 | `score-rules.js:362-375` | 完整 | `Math.round` |
| CM-RT-209 | `scoreMultiplierOf` G5/G6 | `score-rules.js:407-420` | 完整 | ×3 / ×2 / 可叠乘 |
| CM-RT-210 | `parseRowCount` 数据量解析 | `score-rules.js:503-523` | 完整 | 只认带量词或中文量级 |
| CM-RT-211 | `SCORE_CONFIRM` 交付口径（25 条，与 25 个得分点一一对应） | `score-rules.js:547-698` | 完整 | 按 code 取 `need/proof/replay/script` |
| CM-RT-212 | 25 个默认得分点定义 | `score-rules.js:769-924` | 完整 | `rule` 为上限分组键 |
| CM-RT-213 | `tunnelIsLegit` 边界判定 | `score-rules.js:38-42` | 完整 | 空→null、self-only→false |
| CM-RT-214 | `scoreStageOf` 阶段推导 | `store-core.js:345-355` | 完整 | 四档优先级 |
| CM-RT-215 | 六角色默认提示词 | `store-core.js:475-728` | 完整 | 公共段落 6 段拼接 |
| CM-RT-216 | `refreshDefaultPrompts` 指纹升级 | `store-core.js:5337-5370` | 完整 | `.bak` 无清理 |
| CM-RT-217 | 证据账本（内容寻址） | `evidence-ledger.mjs:121-329` | 完整 | `ev_id` 哈希可防篡改 |
| CM-RT-218 | 待证未知登记表 | `evidence-ledger.mjs:333-439` | 完整 | `unk_id` 由 question+domain 哈希去重 |
| CM-RT-219 | `migrateUnknownStatus` 重建表补 `withdrawn` | `evidence-ledger.mjs:452-472` | 完整 | 依赖原 CHECK 文本精确匹配 |
| CM-RT-220 | 技能可用性判定 | `skill-availability.js:252-347` | 完整 | 五类 issue + 同名遮蔽检测 |
| CM-RT-221 | 修复文案生成 | `skill-fixes.js:450-517` | 完整 | 7 类分支 + 兜底 |
| CM-RT-222 | 平台工具解析（config→toolkit→binDirs→PATH→发行版目录） | `platform-config.js:261-298` | 完整 | httpx 排除 Python CLI（`170-185`） |
| CM-RT-223 | Kali 探测 | `platform-config.js:367-386` | 完整 | os-release + 3 个标记路径 |
| CM-RT-224 | 整包文件夹扫工具 | `platform-config.js:403-490` | 完整 | 深度≤6、文件≤20000、按 names 序择优 |
| CM-RT-225 | 发送前环境门禁 `envAdaptStatus` | `platform-config.js:533-588` | 完整 | 5 种 ready 原因 |
| CM-RT-226 | 并发上限设置 | `settings.js:56-72` | 完整 | 1–10 钳制，三级来源 |
| CM-RT-227 | YAML 子集解析（fail-closed） | `preset-composition.js:316-363` | 完整 | 越界构造抛 `CompositionError` |
| CM-RT-228 | 预设落地与自愈 | `index.js:374-448` | 完整 | 占位符/旧路径/工具包名/`toolFilter`/派活约束/锚点门 6 类修复 |
| CM-RT-229 | 随包技能同步（双 home） | `index.js:157-195` | 完整 | 内容相同不写盘 |
| CM-RT-230 | 预设 registry 声明与状态落盘 | `index.js:484-615` | 完整 | 每 400ms 重试至 45s 超时 |
| CM-RT-231 | 子会话角色稿捕获与读取 | `role-section.js:58-135` | 完整 | 角色表 FIFO 上限 400 |
| CM-RT-232 | 报告复现合成（curl/HTTP/模板填充） | `report-replay.js:27-207` | 完整 | IPv6 方括号单独处理 |
| CM-RT-233 | 原子写 | `atomic-write.js:8-28` | 完整 | tmp+fsync+rename |
| CM-RT-234 | IP/CIDR/slug 纯函数 | `ip-utils.js:16-140` | 完整 | IPv6 → /64 |

---

## 10. 未验证项

| 编号 | 未验证内容 | 缺什么才能验证 |
| --- | --- | --- |
| U-1 | `ui.js` 的自更新全链路（`updateCheck` → `updateApply` → 重启脚本 → 新进程拉起） | 需要一次真实的包安装与宿主重启；会中断当前会话，未执行 |
| U-2 | `probeSessions` 的真实网络行为（超时边界、`status<500` 判定、并发上限） | 需要一个可控的 WebShell 端点与一个可控的 TCP 监听；本次只静态读 |
| U-3 | `client.js`（4218 行）的全部交互实现与渲染字段 | 不在本次范围；§5 只按调用点反推 |
| U-4 | safe 2.0.0 的对应实现与差异 | 未查（见 §7） |
| U-5 | 25 个得分点的 `points/cap` 与《突破入侵类得分规则（合并版）》原文逐条对账 | 需要规则原文；本次只按代码里的 `src` 与 `description` 记录 |
| U-6 | 并发写同一 `assets.db` 时 `addScoreHit` 的封顶判定是否会双计 | 需要多进程/多会话并发压测；本次只做单进程串行验证 |
| U-7 | `assets.db` 在 macOS 大小写不敏感文件系统上，两个仅大小写不同的靶标名是否真的落到同一目录 | 需要真实创建 `ACME` / `acme` 两个靶标；本次只验证了中文名做目录名可行 |
| U-8 | `node:sqlite` 在不同 Node 版本上对 `ALTER TABLE ... DROP COLUMN`（`schema.js:547, 558, 562`）的支持差异 | 需要在 Node 22.x 与 26.x 上各跑一次 `migrate()` 于老库 |
| U-9 | 报告 markdown 的最终排版（表格宽度、图片路径、`shotRef:'relative'` 分支） | 需要一次含截图与分组条目的真实靶标数据；本次只构造了 1 条命中 |
| U-10 | `skill-fixes.js` 全部 517 行文案与 `TOOL_FIXES` 每条安装命令的正确性 | 需要逐工具实跑安装；本次只读了结构与 `fixesForIssue` 分支 |
