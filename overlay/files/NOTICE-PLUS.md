# dsh-purge-plus 的来源、许可与署名

本仓库**不是从零写的插件**，也**不是任何一个上游的官方发行版**。
它是两个上游的合并层，是一个**独立的变体（independent variant）**，与两个上游的作者均无隶属关系，
也未获得他们的背书。

本文件是 Apache-2.0 §4(d) 与 MIT「保留版权声明」条款的履行文件。修改或再分发时必须原样保留。

---

## 1. 基座：dsh-purge-community 1.7.20

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/kingcharleslzy-ai/dsh-purge`（公开） |
| 许可 | **MIT**，Copyright (c) 2026 小杨 |
| 本仓库位置 | `vendor/community/` — 发行物原样副本，未改动一个字节 |
| 原始许可全文 | `vendor/community/LICENSE`（随发行物一并分发） |
| 原始 NOTICE | `vendor/community/NOTICE.md`（随发行物一并分发） |

它自身又是 `YuJunZhiXue/dsh-purge` **1.1.71** 的独立维护分支（原作者 小杨）。
该仓库的 `NOTICE.md` 与 `docs/upstream/` 保留了这条上游链，本仓库随副本一并继承。

## 2. 移植来源：dsh-purge-safe 2.0.0（基线）/ 2.0.1 / 2.0.2

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/CallMeGuLab/dsh-purge-safe`（公开），tag `v2.0.0`、`v2.0.1`、`v2.0.2` |
| 许可 | **Apache License 2.0**，Copyright 2026 CallMeGuLab |
| 本仓库位置 | `vendor/safe/` — 原样副本，仅用于比对与升级追踪 |
| 原始许可全文 | `LICENSE-SAFE-APACHE-2.0.txt`（随发行物分发） |
| 原始 NOTICE | `NOTICE-SAFE.txt`（随发行物分发） |

按 Apache-2.0 要求履行的义务：

- **§4(a)** 随发行物提供许可副本 → `LICENSE-SAFE-APACHE-2.0.txt`
- **§4(b)** 修改过的文件注明改动 → 见下表，每个文件顶部另有 `[dsh-purge-plus]` 标记
- **§4(c)** 保留所有版权、专利、商标、归属声明 → `NOTICE-SAFE.txt` 原样保留
- **§4(d)** 若原作品含 NOTICE，衍生作品须在 NOTICE 中携带其归属文字 → 即本文件第 2 节
- **§4(e)** 不得使用上游名称暗示背书 → 本文件开头已声明
- **§6** 商标：未使用 CallMeGuLab 的名称、标识作为本项目的标识

实际进入发行物的 safe 代码共六处（`#204` 已按审计结论回退，见下）：

| 文件 | 来源 | 改动 |
|---|---|---|
| `lib/patches/overlay.mjs` #201 | safe `core.js` #93 | 语义相同，marker 前缀改为 `dsh-purge-plus` |
| `lib/patches/overlay.mjs` #202 | safe `core.js` #94 | **改写**：safe 用 `return;` 提前返回会跳过 `ctx.effect(shutdown)` 注册；本仓库改为把工厂调用挪进不会被调用的 `const`，保留控制流 |
| `lib/patches/overlay.mjs` #203 | safe `core.js` #95 | 语义相同 |
| `lib/patches/overlay.mjs` #205 | safe `core.js` #52 的硬移除部分 | **裁剪**：只取「注册点短路 + prepare 首行返回」，默认值部分由 community `#52` 负责，不重复 |
| `lib/patches/overlay.mjs` #206 | safe `core.js` #92 的第 3、4 条替换 | **裁剪**：只取「子代理继承父权限档」；前半段（spawn 时挂 assemble）由 community `#74` 覆盖，不重复 |
| `lib/patches/overlay.mjs` #207 | safe **2.0.1** `core.js` #97 | 语义相同（冷路径沿用 recorded 预设），marker 前缀改为 `dsh-purge-plus`，注释改写 |
| `lib/patches/overlay.mjs` #208 | safe **2.0.1** `core.js` #98 | 语义相同（活路径沿用 recorded 预设） |
| `overlay/snippets/artifacts-tab.js` | safe `lib/redteam/client.js:592-605, 11463-11545` | **改写**：`SecretText` / `CredentialList` / `AccessList` / `ArtifactsTab` 四个组件，只复用本基座已有的 CSS 类，不引入 safe 的 16 个零引用 css |
| `lib/subagent-fence.js` | safe `lib/tool-gate.js` 的 `denyDelegation` | **裁剪**：只保留「子代理禁再派活」，去掉与 community `#9`/`#59` 重复的降级逻辑 |

### 版本口径（2026-11-23 复核）

| 版本 | 文件数 | 补丁条数 | 性质 |
| :--- | ---: | ---: | :--- |
| v2.0.0（本仓库 vendor 基线） | 153 | **59** | — |
| v2.0.1 | 160 | **62**（+97/98/99） | 功能版：7 个新模块 + 25 个修改 |
| v2.0.2 | 160 | **64**（+100/101） | **仅兼容版**：把 `dshTarget` 从 `0.2.2-rc.3` 改成 `rc.5`，真逻辑改动只落在 `core.js` / `net-scope.js` 两处 |

本仓库**有意停在 2.0.0 基线**：`vendor/safe` 不参与构建（`scripts/build.mjs` 全文不引用它），
它只是比对与署名的来源。上游新版与基线的差异可用
`node scripts/check-vendor-drift.mjs safe <safe 源码目录>` 随时复核
（2026-11-23 实测 2.0.0 → 2.0.2：漂移 32 / 新增 7 / 缺失 0）。

### 未移植：safe 2.0.1 `#99`（`lib/types/agent.js` 那份 `claim()`）

实测该文件在本机**不可达**：`package.json` 的 `exports` 里 `./types` 指向 `lib/types/types.js`（只有几个常量），
没有任何 `exports` 或运行时代码指向 `lib/types/agent.js`；它只是打包时留下的源文件副本，
而真正被加载的 `lib/index.js` 已经把同一份代码以 `//#region lib/types/agent.js` 内联在第 28 行起。
也就是说补它零收益，且要往 `targetFiles()` 里新加一个文件键才做得到。
若将来宿主把 `./types` 指回 `lib/types/index.js`，这条才需要补 —— 届时锚点也要重新核对。

### 已回退：`#204`（原 safe `#96`）

审计确认 rc.5 宿主已自愈（`dsh-skill-office/lib/index.js:62-73` 把 ENOENT 捕获成 `failed()` 只 warn），
该补丁零收益；且 safe 原版 `statSync` 未 import（`core.js:5499` vs `index.js:1`），打上即 `ReferenceError`。
本仓库的移植版判定还比原版弱，会掩盖本该出现的 skill-unavailable 警告。故整条删除。

### 明确未移植的 safe 代码

| 项 | 原因 |
|---|---|
| `lib/net-scope.js` 的 `installRegionGate`（`net-scope.js:625-669`） | 反向能力：命中地域/银行判定就往会话写 `DENIAL` 并吞掉整轮，与本项目目的相反 |
| `lib/update.js` | `const REPO = ""`（`update.js:12`），升级通道整体失效；本仓库用 community 的更新子系统 |
| 16 个 `.css` | **不是死资产**：`scripts/build-client.mjs:62-66` 把它们逐个读进 `PURGE_CSS` 常量并嵌入 safe 的 client.js。不移植的真实原因是样式体系与 DOM 结构不同（community 面板没有对应的类名与层级），搬过来是零命中的样式表 |
| `#89/#90/#91` | 与宿主契约冲突：`#89` 把系统提示词塞进无人读取的 `request.system` 字段；`#90/#91` 读 string 型 `globalThis.__dshPurgeHungPrompt`，而本基座定义的是 function 型，打上即静默失效 |

## 3. 上游的第三方内容（随 community 继承）

community 的 redteam 模块派生自第三方，本仓库随副本一并继承其声明，不得删除：

| 内容 | 来源 | 许可 | 文件 |
|---|---|---|---|
| `dsh-redteam-mode` | `https://github.com/Jueze-2019/dsh-redteam-mode`（公开） | **MIT**，Copyright (c) 2026 Jueze-2019 | `vendor/community/docs/redteam-upstream-LICENSE` |
| dual-use 声明 | 同上 | — | `vendor/community/docs/redteam-upstream-DISCLOSURE` |
| agent-loop 测试夹具 | `@deepseek-ai/dsh-agent-loop` 0.2.2-rc.1 | MIT | `vendor/community/test/fixtures/agent-loop-022-LICENSE` |

## 4. 宿主：DeepSeek Harness

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/deepseek-ai/deepseek-harness`（公开） |
| 许可 | **MIT** |

本仓库**不包含**宿主代码。所有补丁在安装时作用于宿主文件，并在状态目录留 `.dshpurge.bak` 原件；
宿主文件本身不被复制进本仓库或发行物。

## 5. 未移植的部分及原因

移植判定逐条留档在开发期维护文档里（不随本发行物分发）。简言之：safe 的 `subagent-control.js`（审批接管）与 `tool-gate.js` 主体（审核降级），
在 community 里已由**源码补丁** `#9` / `#59` 以更彻底的方式实现，重复移植会互相覆盖。
这不是取舍，是重复。

### safe 独有面全量对照（2026-11-23 实测，非估计）

`safe` 相对 `community` 独有 **27 个 lib 文件 + 17 个技能**（community 独有技能 0 个）。
逐组定性如下 —— 每一行的「已移植 / 不移植」都带判据，否则下一个人会以为漏了：

| 组 | 文件 | 处理与理由 |
| :--- | :--- | :--- |
| **技能** | 17 个 `skills/redteam/*.md` | **已移植**（v0.1.50）。文本层，不依赖宿主接口。落地后技能库 23 → 40，`redteam_*` 引用逐个核对已注册工具（38 个全部命中）。另修掉上游一处错名：`passive-recon.md` 让智能体调 `redteam_asset_upsert`，实际工具名是 `redteam_asset_add`。`lateral-movement.md` 取的是 community 版本（safe 版要求向目标机写入长期有效 SSH 密钥且无回收要求，本项目不采用该节） |
| **预设默认** | `lib/preset-default.js` | **已移植**（v0.1.50）。上一版判断「装配包内 selectedDefault 零引用，没有可修的路径」是错的：宿主 `agent-preset-registry` 自己就有 `selectedDefault`，用户把「红队模式」设为默认后停用插件，宿主 `resolve()` 对未知预设硬抛（上游 #108）。这条与「包内有没有引用」无关 |
| **团队任务板** | `team-mode.js`、`ticket-stage.js`、`team-board.js`、`orchestrator-clock.js`、`slot-state.js` | **已移植并接线**（v0.1.50 移植 / v0.1.70 接线）。`team-mode` 接进 apply（红队根会话默认开任务板，三条边界由模块自守）；`slot-state` 接进名额闸门（挂起不占并发）；`team-board` + `orchestrator-clock` 接进任务板数据面（stall 判定 + 按 root/engagement 作用域合并回报）；`ticket-stage` 作为退回路径 |
| **情报数据层** | `kev.js`、`cve-db.js`、`intel-sync.js` | **已移植并接线**（v0.1.50 移植 / v0.1.70 接线）。`kev` 是 CISA 公告层缓存（`redteam_cve` 的 `in_kev` 与 `kev_hits` 来自它）；`cve-db` 是 `kb/cve.db` 只读访问层（`node:sqlite`，宿主 Node 24 可用）；`intel-sync` 按 `REDTEAM_INTEL_BASE` 拉 `cve.db.gz`（清单 → sha256 → 解压 → SQLite 结构校验 → 原子顶替），挂进 `intelUpdate` 的 `cve` 目标，**未配置数据源时按关闭处理**（上游同款语义）。`intelStatus` 只读状态文件、永不联网。数据不随包分发 |
| 样式 | 16 个 `.css` | **部分移植**（v0.1.98）：只搬了 `ui-theme.css` + `redteam/workspace-skin.css` + `redteam/unified-components.css` 三个 —— 它们是一条完整 token 链（`--ui-*` → `--rt-*` → 组件），作用域正是 `.rt-dock` / `.rt-full`（本包演练台窗口的根类），不改 DOM 就生效。其余 13 个页面皮肤**不移植**：逐类比对后类名在本包 DOM 里命中率只有 6%–30%，搬过来是整片零命中（`docs/audit/AUDIT-3WAY-2026-11-25-R9.md` 有逐文件数字）。`ui-theme.js`（明暗模式状态机）没有直接搬，而是按同一套语义**自研**了 `overlay/snippets/theme-toggle.js`（v0.1.101）：三档 dusk / white / system、localStorage 持久化、跟随系统变化、只在 `.rt-dock` / `.rt-full` 上写 `data-theme`（不碰 `<html>` / `<body>`，不替宿主做全局明暗决定）。皮肤层装好之后 `ui-theme.css` 里的亮色变体才有消费者，所以这两件事必须成对存在 |
| 行为锚点 | `lib/anchor.js` | **已移植、默认只装一半**（v0.1.93）。它注册两段：system prompt 尾部的 `section`（order 10150）与只给子会话的 `context`（order 235，排在宿主 `subagent:delegation` 120 之后）。基座已经用「注入正文落在尾部」占住了 10150，所以本包默认只装子会话那条（`anchorMode: "child"`），要两段都装设 `anchorSection: true` |
| 子代理/工具门 | `lib/subagent-control.js`、`lib/tool-gate.js` | **部分移植**（v0.1.79）。`subagent-control` 的 P1/P2（把 `approval/policy` 从 never 翻成 ask、在 `approval/request` 里恒放行）**不移植** —— 源码补丁 `#9 APPROVAL_AUTO_GRANT` 已把 `decide()` 整段换成 `return "allowed-once"`，waterfall 根本不会被调用，装了是一段永不执行的代码；P3/P4（沙箱模式跟随）**已移植**为 `lib/sandbox-follow.js`，接进能力层。`tool-gate` 主体仍不移植（`#9`/`#59` 覆盖），只保留基座没有的「子代理禁再派活」（`lib/subagent-fence.js`） |
| 预设自愈 | `lib/redteam/index.js` 的 6 段修复 | **已移植并接线**（v0.1.85）。宿主每次升级都会让已部署的红队预设半失效：toolFilter 废弃 / list_agents 子路径没了 / workflow 行指向不存在的包（模式下拉被抽空）/ 子代理不许选模型 / 缺 tool-schedule 行 / 任务板与等待文案过时。这六段修复来自 safe 2.0.2；本包原先的 `apply` 在预设已存在时直接 `kept`，**自愈代码存在但永远走不到**，现已去掉捷径。顺带修掉两处：基座的 `repairToolFilter` 会留下 `allow:` 子键（与 safe 的按缩进跳过规则冲突），工具包名映射目标写的是 `dsh-purge-community/redteam/tools`（本包里解析不到） |
| 保险库 / 自愈 | `lib/core.js` 的 vault 与 heal 两族 | **不移植**（v0.1.95 核实）。基座 `lib/core.js` 已有等价的一套：`backupAll` 建 `.dshpurge.bak`（wx 独占创建，避免竞态）、`restoreMissingOriginalsFromBak` 还原、`refreshStaleBaksForUpgrade` 跟宿主升级刷新、`applyPatches` 前做 profile 级快照、`collapseDuplicateLegacyApplyPath` 折叠重复声明；还原函数对空备份与符号链接目标一律拒绝。safe 的 `ensureOfficialSnapshot` / `writeVaultMeta` / `listVaultEntries` 是同一件事的第二套实现，搬进来只会互相盖。`probeHostWritable` / `runElevated` 与 `takeHostOwnership` 也不移植：本包只写自己所有权内的目录，且是唯一写方 |
| 区域出网闸 | `lib/net-scope.js` | **已移植、默认关闭**（v0.1.79）。放进独立文件 `lib/net-scope-gate.js`：基座也有同名 `net-scope.js`（412 行纯数据层），`identity.js` / `index.js` 依赖它的 `ownServerNote` 与读写函数，覆盖会让基座 import 直接失败。上游在 apply 里无条件装闸（攻击类任务 + 目标不在允许清单 → 整轮 park）；本包默认不装，理由是本仓库其余能力都在减少阻断。数据层（区域判定 / 允许清单解析 / 目标抽取）全部可用，要启用设 `netScopeGate: true` 或 `DSH_PURGE_NET_SCOPE_GATE=1` |
| 代理池 | 无（本仓库自有） | **不是移植**。safe 2.0.2 的代理池只有前端：12 个 op 在它的服务端 dispatch 里一条都不存在，调用只会得到 `unknown op`（`docs/audit/AUDIT-3WAY-2026-11-25-R3.md` §1 有复现）。本包的 `store-proxy.js` 与 `proxy-parse.js` 是自有实现，不涉及 Apache-2.0 署名义务；字段名对齐 safe 前端以便将来复用其界面 |
| 运行时引导 | `bootstrap-runtime.js` | **已移植、按本包口径接线**（v0.1.89）。它铺的是红队数据目录：知识库 DDL、`pocs/`、`toolkit/`、平台配置，以及 nuclei 模板下载（git/tar/zip 三种协议 + 多镜像回退）。上游在 apply 里 `download:true, background:true`，启动就可能在后台拉 100MB+ 模板并刷 KEV；本包启动**只做本地那半**，下载必须显式触发（op `runtimeEnsure` 带 `download:true`，或 `redteam_intel action=runtime`）。**注意区分**：`intel-sync.js` 同步的是 `cve.db` 整库，与 KEV/nuclei 不重叠，也已接线 |
| 主题 / 全屏 | `ui-theme.js`、`ui-theme.css`、`ui-fullscreen.js` | **部分自研**。站内全屏在本仓库 overlay 里独立实现（`fullscreen-hook.js`），不依赖 safe 的 288 行 hook；主题是纯视觉皮肤，与基座 CSS 体系不同 |
| 设置 | `mnemon-settings.js` | **已移植并接线**（v0.1.93）。基座 `identity.js` 的 prompt 改写会**无条件**把宿主 mnemon（记忆层）那一段摘掉；safe 给了 `keepMnemon` 开关。本包把开关接进 `normalizeRewriteOptions` 的两处 `dropMnemon`，并加了 op `mnemonSettings` 读写，不用手改 JSON。设置落 `$DSH_HOME/dsh-purge-plus/mnemon.json` |

## 6. 本仓库自身

- 本仓库原创部分：**MIT**，Copyright (c) 2026 dsh-purge-plus contributors。
- `vendor/` 下的内容**不适用**本仓库许可，各自适用其原始许可（见上）。
- 本仓库不是 `dsh-purge-community` 的官方续作，也不是 `dsh-purge-safe` 的官方续作。
  上游若发布新版本，本仓库的合并结论可能与上游不同。

## 7. 关于「公开分发」的合规结论

三份上游许可（MIT / Apache-2.0 / MIT）**均明确允许**复制、修改、合并、发布、分发、再许可：

- MIT：「Permission is hereby granted, free of charge, ... to deal in the Software without restriction,
  including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
  and/or sell copies」
- Apache-2.0 §2：「each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge,
  royalty-free, irrevocable copyright license to reproduce, prepare Derivative Works of, publicly display,
  publicly perform, sublicense, and distribute the Work and such Derivative Works in Source or Object form」

因此**公开本仓库是允许的**，前提是保留上述署名与许可全文（本文件即为此而存在）。

唯一需要注意的非许可条款：community 的 `NOTICE.md` 写着「This fork is free and not offered for paid resale」。
MIT 不允许附加限制，这句在 NOTICE 里属于**请求**而非许可条件，法律上不构成约束；
本仓库尊重该请求，不做付费转售。
