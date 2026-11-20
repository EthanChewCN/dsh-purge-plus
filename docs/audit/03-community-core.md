# community 1.7.20 —— 补丁引擎与宿主集成（只读审计）

> 范围：`vendor/community/lib/core.js`、`vendor/community/lib/index.js`、`vendor/community/lib/patches/*.mjs`、`vendor/community/lib/core/*.mjs`、`vendor/community/cordis.patch.yml`；按任务要求另覆盖 `lib/selfcheck.js` 与宿主文件定位链（`lib/host-layout.js` / `lib/runtime-layout.js` / `lib/extract-asar.js`）。
> 标注约定：`[静态]` = 只读源码读出；`[实测]` = 本次实际执行 / 请求验证过（验证方法见 §10）。
> 本文件不修改任何代码；唯一写入物是本文件与 `docs/audit/03-community-patches.json`。

---

## 1. 模块清单

| 文件 | 行数 | 一句话职责 | 是否被 index.js 加载 |
|---|---:|---|---|
| `lib/index.js` | 3,016 | 插件入口：Cordis `apply()`、`/dsh-purge/*` HTTP 路由、3 个 agent 工具、3 个 slash 命令、`llm/stream` 钩子 | 自身即入口（`export default plugin` `lib/index.js:3010-3016`） |
| `lib/core.js` | 4,760 | 补丁引擎本体：目标文件表、备份/回滚、apply/回读/漂移、宿主定位、asar 解包、shim 注入、override 文件、`gatherState` | 是，`import * as core from "./core.js"`（`lib/index.js:14`） |
| `lib/patches/index.mjs` | 23 | 汇总 6 个补丁模块为 `ALL_PATCHES`，并定义 `PATCH_DISPLAY_GROUPS` | 间接（`lib/core.js:2388`） |
| `lib/patches/shared.mjs` | 89 | 补丁表共用的提示词常量与替换构造函数（`STRONG_INTRO*`、`replacementPrecedenceRewrites` 等） | 间接（`lib/core.js:2389`） |
| `lib/patches/prompt.mjs` | 264 | 提示词层补丁 #1–#5、#43、#70、#71、#73、#76（10 条） | 间接（`lib/patches/index.mjs:2`） |
| `lib/patches/code.mjs` | 48 | 沙箱/审批默认值补丁 #6、#7、#8（3 条，全部 `patterns[]` + `marker` 形态） | 间接（`lib/patches/index.mjs:3`） |
| `lib/patches/engine.mjs` | 352 | 引擎级审批/沙箱/升级补丁 #9–#16、#91–#94（12 条） | 间接（`lib/patches/index.mjs:4`） |
| `lib/patches/new-tools.mjs` | 2,480 | 工具面、预设、桌面宿主、回退、模型网关等 #17…#89 共 58 条 | 间接（`lib/patches/index.mjs:5`） |
| `lib/patches/opt-in.mjs` | 76 | 默认关闭的可选补丁 #18、#19（`disabledByDefault` + `optIn`） | 间接（`lib/patches/index.mjs:6`） |
| `lib/patches/stability.mjs` | 47 | 用工厂 `treeBudgetPatch()` 生成 #95、#96（inspector 帧预算） | 间接（`lib/patches/index.mjs:7`） |
| `lib/core/shared.mjs` | 298 | 文本归一化（`asLf`/YAML 注释改写）、补丁结构（`patchReplacements`/`patchApplied`/`patchHasRemainingWork`）、anchor-override 缓存 | 间接（`lib/core.js:2392`） |
| `lib/core/verify.mjs` | 205 | 单文件应用（`applyReplacementsToText`）、状态折叠（`rollupPatchStatus`）、soft-ok、展示分组与计数 | 间接（`lib/core.js:2393`） |
| `lib/steering.js` | 80 | `STEERING_RESTORE_PATCH`（#90）的定义与 `nativeSteeringRestored()` 校验器 | 间接（`lib/patches/new-tools.mjs:2`） |
| `lib/selfcheck.js` | 301 | 分层自检：`BYPASS_LAYERS` → `rollupLayers` → `selfCheck` | 是（`lib/index.js:39`） |
| `cordis.patch.yml` | 73 | bundle 声明：关旧红队包、改 `system-prompt` 配置、insert 5 个插件行 | 由宿主 bundle 加载器读，非 JS import |

补丁条数实测：`ALL_PATCHES.length === 88`，其中 `optional: true` **49** 条、必需 **39** 条 `[实测]`（`node -e` 直接 import `lib/patches/index.mjs` 统计）。

---

## 2. 数据模型

### 2.1 一条 patch 对象的全部字段

`ALL_PATCHES` 是 88 个普通对象，字段由 `lib/patches/*.mjs` 与 `lib/steering.js` 静态声明。下表列出**实测出现过的全部 30 个字段**，语义与消费点逐条给出。

| 字段 | 类型 | 语义 | 消费点（文件:行） | 出现条数 |
|---|---|---|---|---|
| `id` | number | 补丁编号；`patch_status` 的键、展示分组键 | `lib/core.js:3848-3945`（回读）、`lib/core/verify.mjs:160`（分组） | 88 |
| `name` | string | 常量名，进报告与 UI | `lib/core.js:3598`、`lib/index.js:2041` | 88 |
| `layer` / `layer_en` | string | 中/英分组标签，**纯展示** | `lib/core/verify.mjs:175`、`lib/index.js:171` | 88 |
| `desc` | string | 人类可读说明 | **引擎零消费者**，且 `/dsh-purge/status` 的 `patch_rows`/`patches` 只带 `id`/`layer`/`name`/`status`（`lib/index.js:2064-2077`），`desc` 不进任何载荷 | 88 |
| `file` | string \| string[] | `targetFiles()` 的键（一个键可展开为多个物理文件） | `lib/core/shared.mjs:209-211` `fileKeysOf` | 88 |
| `rel` | string[] | 「相对包路径」注释性字段 | **零消费者**（`grep 'p\.rel\|patch\.rel'` 无命中） | 29 |
| `replacements` | `{pattern, replace, expect?}[]` | 主形态：逐条按序应用 | `lib/core/shared.mjs:230-234`、`lib/core/verify.mjs:31-71` | 81 |
| `patterns` + `replace` | `string[]` + `string` | 旧形态：多个 pattern 共用同一个 replace；被 `patchReplacements` 归一成 `replacements` | `lib/core/shared.mjs:230-234` | 7（#5,6,7,8,10,15,16） |
| `pattern`（在 `replacements` 内） | string \| RegExp | string = 精确子串（**全部出现处**都替换）；RegExp = 用 `g` 克隆后 `String.replace` | `lib/core/verify.mjs:38-56`、`lib/core/shared.mjs:178-190` | — |
| `expect`（在 `replacements` 内） | number | 命中数契约：实际命中数必须**完全等于**它，否则整条该文件拒写 | `lib/core/verify.mjs:40-45`、`60-65` | 2 处（#93 两条） |
| `marker` | string | 单数幂等标记：文件里含它即判完成 | `lib/core/shared.mjs:171` | 多 |
| `markers` + `markersAny` | `string[]` + boolean | 多标记：默认 `every`（全中），`markersAny:true` 时 `some`（任一） | `lib/core/shared.mjs:166-170` | 多 |
| `forbid` | string[] | 反向标记：任一命中即判**未完成**，且**优先于** `markers` | `lib/core/shared.mjs:165` | 10（#40,45,60,61,67,69,87,89,90,18） |
| `skipIfMarked` | boolean | apply 前若 `patchApplied()` 为真则直接返回，不再 replaceAll（防重复插入） | `lib/core/verify.mjs:24-26` | 33 |
| `optional` | boolean | 可选补丁：`pattern_not_found` 视为软成功；漂移归 `optionalDrift`；无文件时状态 `na` 而非 `missing_file` | `lib/core/verify.mjs:116`、`lib/core.js:3778`、`3939`、`lib/selfcheck.js:107` | 49 |
| `strictFiles` | boolean | 硬失败语义：`lastError` / `notFound` 直接冒泡成 `pattern_not_found`；回读时未命中记 `unmatched` | `lib/core/verify.mjs:90-91,115`、`lib/core.js:3541,3586,3916` | 4（#43,70,71,90） |
| `requireAllTargets` | boolean | 多目标必须全部落地，任一 missing/unmatched/drifted → `partial` | `lib/core/verify.mjs:92`、`lib/core.js:3888,3934` | 1（#90） |
| `fileAllRequired` | boolean | 逐目标核算：`applied>0` 且某个必需目标未 settled → `partial` | `lib/core.js:3928-3930` | 1（#57） |
| `fileOptional` | string[] | 声明的目标键不参与判定（逻辑已在新版宿主搬走） | `lib/core.js:3902,3928` | 3（#32,36,62） |
| `settleWhenAbsent` | boolean | 撤销型补丁：`skipped` 视为已到位，漂移扫描跳过、自检不计入分母 | `lib/core.js:3735`、`lib/selfcheck.js:108` | 3（#35,80,82） |
| `silentWhenMissing` | boolean | 「找不到」本身就是正确状态 → `skipped` 而不是 `drifted` | `lib/core.js:3341` | 6（#35,54,76,82,95,96） |
| `softSettle` | boolean | 强制把该补丁当「布局软补丁」：`isLayoutSoftPatch` = `id∈{4,25,26}`（identity 布局）或 `id∈{5,11,12}`（审批句）或 `softSettle`；软补丁只要没有残留 pattern 就算完成 | `lib/core/shared.mjs:205-207`、`lib/core.js:3324` | 3（#21,48,71） |
| `verifyRemovedFromBackup` | boolean | 删除型补丁：拿 `.dshpurge.bak` 回放 apply，比对结果与当前文件 | `lib/core.js:3305-3318,3321,3335,3579` | 1（#54） |
| `chainedAfter` | number | 级联补丁：前置补丁未 `applied/already` 时，本条的锚点缺失不算漂移 | `lib/core.js:3737-3740` | 1（#88 → `chainedAfter: 87`） |
| `surfaces` | string[] | 只在这些端生效（`"desktop"` / `"web"`）；不匹配 → 状态 `na` | `lib/core/verify.mjs:104-109`、`lib/core.js:3486,3856` | 7（#45,46,82,83,84,91,92） |
| `permissionOverride` | boolean | 受 `tuning.json.permissionPatches` 总开关控制；关掉时走 permission 回滚迁移 | `lib/core.js:3813,3818,3841` | 14 |
| `disabledByDefault` | boolean | 默认关闭，只有 `tuning.extraPatches` 列出才启用 | `lib/core.js:3813,3819` | 2（#18,19） |
| `optIn` | boolean | 默认关闭且受 `tuning.contextManagement` 总开关 | `lib/core.js:3820` | 2（#18,19） |
| `multiHit` | boolean | **零消费者**（`grep -rn multiHit lib/` 只命中定义处 `lib/patches/engine.mjs:305`） | 无 | 1（#93） |

**`patchApplied(text, patch)` 的判定顺序**（`lib/core/shared.mjs:157-176`，这是「这条补丁在这个文件里算不算完成」的唯一权威实现，重新实现时必须逐行照抄）：

1. `id === 61 || id === 93` → `sandboxPolicyApplied`（`lib/core/shared.mjs:138-155`）：先剥掉 `/* */` 注释，用正则定位**唯一**的 `function renderPolicyContext(policy)`，按 `case "mode":` 切块，每块必须**恰好一条** `return "…";`；`#61` 要求 `read-only` 分支的返回值等于某条 `replace`；`#93` 要求三个 mode 的返回值都以 `Current file policy: <mode>. ` 开头，且原文 pattern 一条都不在。
2. `id === 17` → `observationPolicyApplied`（`113-134`）：定位唯一的 `var ObservedStateGate = class {`，用「`\n\t` + 方法签名」的出现次数 == 2 判断方法唯一，再比对 `writeIntent` / `editIntent` / `deleteIntent` / `requirePresent` 四种形态。
3. `id === 90` → `nativeSteeringRestored`（`lib/steering.js:63-76`）。
4. `id === 42 && modernSettingsApi(hay)` → 必须含 `MODERN_SETTINGS_MARKER` 且不含 `legacyRegistrations`（`162`）。
5. `id === 42` 且 `legacyApplyPathStarts(hay) > 1` → `false`；含 `STALE_LEGACY_APPLY_CALL` → `false`（`163-164`）。
6. `forbid` 任一命中 → `false`（`165`，**先于** markers）。
7. `markers` 非空 → `markersAny ? some : every`（`166-170`）。
8. `marker` → `hay.includes(marker)`（`171`）。
9. `replace` 是非空字符串 → `hay.includes(replace 首行前 60 字符)`（`172-174`）。
10. 其余 → `false`（`175`）。

注意第 9 步是**弱判定**：`replace` 首行短于 60 字符时，判定实际退化成「文件里有没有这个短串」，见 §8 R8。


### 2.2 持久化对象

| 载体（文件/表） | 字段 | 类型 | 谁写 | 谁读 | 生命周期 |
|---|---|---|---|---|---|
| `<宿主文件>.dshpurge.bak` | 原始字节 | bytes | `backupAll`（`lib/core.js:2700-2735`，`openSync(bak,"wx")` 先占位再 `atomicCopyFile`）；`patchWatchedClientBundlesSync`（`lib/core.js:3649-3650`） | `revertAll`（`2746`）、`deletionStatus`（`3305`）、`patchedTargetStillPatched`（`2624`） | 首次 apply 创建；`revertAll` 成功后 `unlink`（`2781`）；**永不覆盖**（`EEXIST` 直接 continue，`2719`） |
| `$DSH_HOME/dsh-purge/tuning.json` | `permissionPatches` / `contextManagement` / `extraPatches` / `rewind` / `refusalRetry` / `refusalDecompose` / `refusalSeed` / `boost` / `injectPosition` | JSON | `writeTuning`（`lib/tuning.js`）、`POST /dsh-purge/boost`（`lib/index.js:2173,2186`） | `readPatchGate`（`lib/core.js:3790-3804`）、`patchEnabled`（`3812`） | 常驻；缺文件 = 全默认（`lib/tuning.js:15-27`） |
| `$DSH_HOME/dsh-purge/anchor-overrides.json` | `{ "<patchId>": { "<replacementIndex>": {pattern, at, host} } }` | JSON | `writeOverride`（`lib/anchors.js:38`） | `readOverrides` → `overridesSnapshot`（`lib/core/shared.mjs:215-224`）→ `applyOverrides`（`lib/anchors.js:67-84`） | 常驻；进程内缓存，`refreshAnchorOverrides()` 清缓存（`lib/core/shared.mjs:226`） |
| `$DSH_HOME/dsh-purge/override-state.json` | `customized` / `hash` / `seedHash` / `updatedAt` | JSON | `writeOverrideStateSync`（`lib/core.js:4506`） | `isUserCustomizedOverrideSync`（`4472`） | 常驻；决定「用户改过就不覆盖」 |
| `$DSH_HOME/prompt-inject.md` | 注入正文 | text | `syncPromptInjectOnDiskSync`（`lib/core.js:4516`）、`installOverride`（`4579`）、`saveOverrideContent`（`4614`） | `readPromptInjectFileSync`（`2347`）、`readOverrideForUi`（`4486`） | 常驻；内容来自加密槽 `openSlot()`（`lib/core.js:4389-4394`） |
| `$DSH_HOME/dsh-purge/boost-order.json` | `{ order: number }` | JSON | 用户手写 | `boostPromptOrder`（`lib/index.js:96-104`） | 每次注册 section 时重读 |
| `$DSH_HOME/dsh-purge/probe.json` | `nonce` / 时间戳 | JSON | `createProbe`（`lib/probe.js:41`） | `readProbe`（`lib/probe.js:20`） | `POST /dsh-purge/probe` 生成 |
| `$DSH_HOME/dsh-purge-community/audit.jsonl`（+`.1`/`.2`） | `at` / `event` / `pid` / 事件字段 | JSONL | `logAudit`（`lib/audit.js:97`） | `readAudit`（`lib/audit.js:124`）、`GET /dsh-purge/audit` | 1 MB 轮转、保留 2 份（`lib/audit.js:10-12`） |
| `$DSH_HOME/dsh-purge/unpacked-asar.json` | `size` / `mtimeMs` | JSON | `writeUnpackedAsarStamp`（`lib/core.js:1999`） | `readUnpackedAsarStamp`（`1987`） | 解包成功后写；asar 身份变化即失效 |
| `<resources>/app.dshpurge-next[-*]` / `app.dshpurge-prev[-*]` / `app.dshpurge-recover.json` | 解包暂存目录 / 恢复记录 | 目录 + JSON | `extractAsarToSide`（`lib/extract-asar.js:417`）、`commitExtractedDir`（`456`） | `newestPreservedDir`（`509`）、`restoreExtractedDir`（`531`） | commit 成功即删 `recover.json`（`lib/extract-asar.js:498`） |
| `$DSH_HOME/.hung-disabled` | 空标记文件 | file | 用户/旧版本 | `apply()` 启动时删除（`lib/index.js:1598-1602`） | 一次性 |
| profile 快照 | `Maintenance.backup("before-host-patches")` 产物 | 目录 | `applyPatches` 每次整份写入前（`lib/core.js:3467-3476`） | `Maintenance.list/rollback` | 失败不阻断 apply，仅记 `snapshot=error:...` |

### 2.3 报告行（非持久化，但跨层传递）

`applyPatches` 每补丁产出一行：`{patch_id, name, status, path, applied, already, missing}`（`lib/core.js:3596-3604`）；`status` 取值来自 `rollupPatchStatus`：`failed` / `pattern_not_found` / `partial` / `applied` / `already` / `missing_file` / `skipped` / `na` / `disabled` / `read_error` / `write_error:*` / `hit_mismatch:*`（`lib/core/verify.mjs:89-100`，`lib/core.js:3548,3575`）。

### 2.4 补丁全量表（88 条，可机读副本见 `docs/audit/03-community-patches.json`）

排序 = `ALL_PATCHES` 实际顺序（`lib/patches/index.mjs:9`：prompt → code → engine → new-tools → opt-in → stability，再叠加 `lib/patches/new-tools.mjs:2449` 引入的 #90）。
`目标文件` 列写的是 `targetFiles()` 的键（`lib/core.js:2859`）与其**首选**物理路径；一个键在 `allExisting(...)` 下可能展开成多个文件，`firstExisting(...)` 只取第一个存在且通过 `allowTargetForPatch` 的（`lib/core.js:2454-2457`）。
`锚点类型` 列取值：`prefix` = 字符串精确子串（`lib/core/verify.mjs:57`）；`regex` = RegExp 克隆后全串替换（`lib/core/verify.mjs:38`）；`patterns[]` = 旧形态多 pattern 共用一个 replace（`lib/core/shared.mjs:230-234`）；`mixed` = 同一补丁内既有字符串也有正则；后缀 `marker` / `markers` / `markersAny` / `forbid` 表示幂等标记与反向标记（`lib/core/shared.mjs:165-171`）。

| id | 标题 | 目标文件（key → 路径） | 锚点类型 | optional | 作用 | 行号 |
|---:|---|---|---|---|---|---|
| 1 | `WORKSPACE_CONTEXT_INTRO` | agent-instructions → dsh-agent-instructions/lib/index.js | `prefix+markersAny` | 否 | 全局免责声明 / global disclaimer | `lib/patches/prompt.mjs:5` |
| 2 | `REPLACEMENT_WORKSPACE_CONTEXT_INTRO` | agent-instructions → dsh-agent-instructions/lib/index.js | `prefix+markers` | 否 | 替换稿不压过 system / replacement does not override system | `lib/patches/prompt.mjs:78` |
| 3 | `SCOPE_INTRO` | agent-instructions → dsh-agent-instructions/lib/index.js | `regex+markers` | 否 | 作用域不压过 system / scope does not override system | `lib/patches/prompt.mjs:91` |
| 4 | `SYSTEM_PROMPT_PERSONA` | agent-preset → $DSH_HOME/.agent-presets/unrestricted/agent.cordis.yml（回落 dsh-web-app/presets/standard.patch.yml） ; web-app → dsh-web-app/cordis.patch.yml ; headless → dsh-headless/cordis.patch.yml ; preset-acp-app → dsh-acp-app/cordis.patch.yml ; preset-sdk-app → dsh-sdk-app/cordis.patch.yml | `prefix+markers` | 否 | persona：去掉官方默认身份，不另写人设 / strip official identity only | `lib/patches/prompt.mjs:107` |
| 43 | `WEB_PRESET_IDENTITY_STRIP` | preset-standard → dsh-web-app/presets/standard.patch.yml \| dsh-agent-presets/presets/standard/agent.cordis.yml（shippedPresetYml 候选） ; preset-ptc → dsh-web-app/presets/ptc.patch.yml \| dsh-agent-presets/presets/ptc/agent.cordis.yml（shippedPresetYml 候选） ; preset-cordis → dsh-web-app/presets/cordis.patch.yml \| dsh-agent-presets/presets/cordis/agent.cordis.yml（shippedPresetYml 候选） ; preset-minimal → dsh-web-app/presets/minimal.patch.yml \| dsh-agent-presets/presets/minimal/agent.cordis.yml（shippedPresetYml 候选） | `prefix+markers` | 否 | Web 四个内置预设只去掉身份句 / strip web preset identity only | `lib/patches/prompt.mjs:123` |
| 76 | `PRESET_UNRESTRICTED_IDENTITY_STRIP` | preset-unrestricted → $DSH_HOME/.agent-presets/unrestricted/agent.cordis.yml | `prefix+markers` | 是 | 用户自造 unrestricted 预设只去掉身份句（软补丁）/ soft strip for a user-made unrestricted preset | `lib/patches/prompt.mjs:152` |
| 70 | `PRESET_SHELL_NETWORK` | preset-minimal → dsh-web-app/presets/minimal.patch.yml \| dsh-agent-presets/presets/minimal/agent.cordis.yml（shippedPresetYml 候选） ; preset-sdk-minimal → dsh-sdk-minimal/cordis.patch.yml | `prefix+markers` | 否 | 极简模式终端不再写没有网络 / minimal shell drops no-network ban | `lib/patches/prompt.mjs:179` |
| 73 | `PRESET_BASH_MIRROR_LINE` | preset-minimal → dsh-web-app/presets/minimal.patch.yml \| dsh-agent-presets/presets/minimal/agent.cordis.yml（shippedPresetYml 候选） ; preset-sdk-minimal → dsh-sdk-minimal/cordis.patch.yml | `regex+markers` | 是 | 极简 bash 去掉误留的镜像说明 / drop the extra mirror sentence | `lib/patches/prompt.mjs:194` |
| 71 | `LIANGSHEN_IDENTITY_LINE` | preset-liangshen → $DSH_HOME/.agent-presets/liangshen/agent.cordis.yml ; preset-liangshen-pkg → liangshenRoots(dshHome)[1..] 下的 agent.cordis.yml | `prefix+markers` | 否 | 梁神去掉官方身份句，留下本模式的工作纪律 / strip liangshen stock identity line | `lib/patches/prompt.mjs:213` |
| 5 | `APPROVAL_NEVER_SENTENCE` | user-approval → dsh-user-approval/lib/types/index.js ; user-approval-invariant → dsh-user-approval/lib/invariant.js | `patterns[]+markersAny` | 否 | 审批提示句限制 / approval sentence | `lib/patches/prompt.mjs:242` |
| 6 | `SANDBOX_DENY_FILE_WRITE` | sandbox-local → dsh-sandbox-local/lib/index.js | `patterns[]+marker` | 否 | 沙箱 deny file-write / sandbox deny | `lib/patches/code.mjs:4` |
| 7 | `SANDBOX_MODE_DEFAULT` | base → dsh-base/cordis.patch.yml | `patterns[]+marker` | 否 | 沙箱默认 danger-full-access（可被 UI 切换，不写死 env） / soft default only | `lib/patches/code.mjs:16` |
| 8 | `APPROVAL_POLICY_DEFAULT` | base → dsh-base/cordis.patch.yml | `patterns[]+marker` | 否 | 审批：danger-full-access → never（与 mode 组合合法） / compose with mode | `lib/patches/code.mjs:30` |
| 9 | `APPROVAL_AUTO_GRANT` | user-approval-code → dsh-user-approval/lib/index.js ; user-approval-invariant → dsh-user-approval/lib/invariant.js ; user-approval → dsh-user-approval/lib/types/index.js | `prefix+markersAny` | 否 | 审批门自动放行 / approval auto-grant | `lib/patches/engine.mjs:4` |
| 10 | `APPROVAL_CONFIG_DEFAULT_NEVER` | user-approval-code → dsh-user-approval/lib/index.js | `patterns[]+marker` | 否 | 审批配置默认 never / approval config default | `lib/patches/engine.mjs:33` |
| 11 | `APPROVAL_NEVER_SENTENCE_BYPASS` | user-approval-code → dsh-user-approval/lib/index.js | `prefix+markersAny` | 否 | never 提示句 → 自动放行 / never sentence bypass | `lib/patches/engine.mjs:44` |
| 12 | `APPROVAL_ASK_SENTENCE_BYPASS` | user-approval-code → dsh-user-approval/lib/index.js ; user-approval → dsh-user-approval/lib/types/index.js ; user-approval-invariant → dsh-user-approval/lib/invariant.js | `prefix+markersAny` | 否 | ask 提示句 → 自动放行 / ask sentence bypass | `lib/patches/engine.mjs:67` |
| 13 | `ESCALATION_WIDENING_EXEMPT` | escalation → dsh-sandbox/lib/index.js | `prefix+markers` | 否 | 豁免严格升级阶梯 / escalation widening exempt | `lib/patches/engine.mjs:96` |
| 14 | `ESCALATION_GRANT_UNCONDITIONAL` | escalation → dsh-sandbox/lib/index.js | `regex+markers` | 否 | 升级请求无条件授信 / escalation grant unconditional | `lib/patches/engine.mjs:129` |
| 15 | `SANDBOX_CONFINE_PASSTHROUGH` | sandbox-local → dsh-sandbox-local/lib/index.js | `patterns[]+marker` | 否 | 沙箱 confine 直通 / sandbox confine passthrough | `lib/patches/engine.mjs:144` |
| 16 | `FS_FENCE_DISABLED` | fs-sandbox → dsh-fs-sandbox/lib/index.js | `patterns[]+marker` | 否 | 文件系统围栏取消 / fs fence disabled | `lib/patches/engine.mjs:224` |
| 91 | `BROWSER_COOKIE_NAME_IGNORE_PORT` | client-connection → dsh-client-connection/lib/index.js | `prefix+marker` | 否 | 仅桌面端：会话 cookie 名忽略端口，避免随机端口累积 cookie 撑爆请求头（431）/ cookie name ignores port | `lib/patches/engine.mjs:262` |
| 92 | `HOST_MAX_HTTP_HEADER_SIZE` | desktop-shell → <Resources>/app 的 Electron 主入口（desktopShellEntry → resolveDesktopEntry） | `regex+marker` | 是 | 放宽 host 进程 HTTP 请求头上限到 256KB，兜住历史 cookie 累积 / raise host max-http-header-size | `lib/patches/engine.mjs:280` |
| 93 | `SANDBOX_POLICY_BRAND_NEUTRAL` | sandbox-policy → dsh-sandbox-policy/lib/index.js | `prefix+markers` | 是 | 三条沙箱策略文案去掉 DSH 品牌词 / drop DSH branding from every file-policy line | `lib/patches/engine.mjs:300` |
| 94 | `SKILL_BADGE_DESCRIPTION_NEUTRAL` | skill-badge → dsh-skill-badge/lib/index.js | `prefix+markers` | 是 | 技能徽章描述去掉官方品牌要求 / neutralize skill-badge branding requirement | `lib/patches/engine.mjs:330` |
| 17 | `FS_OBSERVATION_INTENT_FREE` | fs-observation-policy → dsh-fs-observation-policy/lib/index.js | `prefix+markers` | 否 | 观察策略读写意图放行 / observation write/edit intent bypass | `lib/patches/new-tools.mjs:9` |
| 21 | `BASH_TIMEOUT_RESTORE` | base → dsh-base/cordis.patch.yml | `regex` | 否 | 恢复插件延长的 bash 等待 / restore plugin-raised bash wait | `lib/patches/new-tools.mjs:30` |
| 22 | `READ_CAPS_RAISED` | tool-fs → dsh-tool-fs/lib/index.js | `prefix+markers` | 否 | read 上限放宽 / read caps raised | `lib/patches/new-tools.mjs:49` |
| 23 | `SUBAGENT_MAXDEPTH_RAISED` | subagent → dsh-subagent/lib/index.js ; tool-subagent → dsh-tool-subagent/lib/index.js | `prefix+markersAny` | 否 | 子代理深度默认 3 → 10 / subagent maxDepth raised | `lib/patches/new-tools.mjs:70` |
| 24 | `PRESET_FETCH_ENABLED` | preset-unrestricted → $DSH_HOME/.agent-presets/unrestricted/agent.cordis.yml ; preset-standard → dsh-web-app/presets/standard.patch.yml \| dsh-agent-presets/presets/standard/agent.cordis.yml（shippedPresetYml 候选） ; preset-cordis → dsh-web-app/presets/cordis.patch.yml \| dsh-agent-presets/presets/cordis/agent.cordis.yml（shippedPresetYml 候选） ; preset-ptc → dsh-web-app/presets/ptc.patch.yml \| dsh-agent-presets/presets/ptc/agent.cordis.yml（shippedPresetYml 候选） ; preset-liangshen → $DSH_HOME/.agent-presets/liangshen/agent.cordis.yml ; preset-liangshen-pkg → liangshenRoots(dshHome)[1..] 下的 agent.cordis.yml | `prefix+markersAny` | 否 | preset tool-web fetch 打开 / preset fetch enabled | `lib/patches/new-tools.mjs:106` |
| 25 | `HARNESS_IDENTITY_STRIP` | system-prompt → dsh-system-prompt/lib/index.js | `prefix+markers` | 否 | 去掉官方默认身份，保留官方功能提示词 / strip default identity only | `lib/patches/new-tools.mjs:131` |
| 26 | `MINIMAL_PERSONA_PURGE` | preset-minimal → dsh-web-app/presets/minimal.patch.yml \| dsh-agent-presets/presets/minimal/agent.cordis.yml（shippedPresetYml 候选） ; preset-sdk-minimal → dsh-sdk-minimal/cordis.patch.yml | `prefix+markersAny` | 否 | 内置 minimal：去掉默认身份并打开 complete，让 inject 能进 / strip identity, open inject | `lib/patches/new-tools.mjs:152` |
| 80 | `MINIMAL_OFFICIAL_TOOLSET` | preset-minimal → dsh-web-app/presets/minimal.patch.yml \| dsh-agent-presets/presets/minimal/agent.cordis.yml（shippedPresetYml 候选） ; preset-sdk-minimal → dsh-sdk-minimal/cordis.patch.yml | `prefix+markers` | 是 | 撤掉曾追加的 fs/web，恢复官方极简工具表 / restore official minimal tool plugins | `lib/patches/new-tools.mjs:210` |
| 28 | `LIANGSHEN_PHASE1_KEEP_INJECT` | liangshen-tool-bootstrap → listLiangshenBootstrapFiles(dshHome)（梁神 bootstrap 脚本清单） | `prefix+markers` | 是 | 插件 dsh-liangshen（梁神）：phase-1 保留注入段（可选） / @linxin666/dsh-liangshen | `lib/patches/new-tools.mjs:282` |
| 32 | `WEB_SURFACE_IDENTITY_NEUTRAL` | harness-dev-context → dsh/node_modules/@deepseek-ai/dsh-harness-dev-context/lib/index.js ; web-app-lib → dsh-web-app/lib/index.js | `prefix+markersAny` | 是 | Web 面：去掉 DeepSeek Harness 自称 / neutralize web GUI identity branding | `lib/patches/new-tools.mjs:306` |
| 29 | `TOOL_WEB_UNTRUSTED_NEUTRAL` | tool-web → dsh-tool-web/lib/index.js ; tool-web-nested → dsh/node_modules/@deepseek-ai/dsh-tool-web/lib/index.js | `prefix+markers` | 是 | dsh-tool-web：外部内容 untrusted 拦截→可执行数据 / neutralize web untrusted framing | `lib/patches/new-tools.mjs:352` |
| 30 | `HOOKS_CLAUDE_DENY_ALLOW` | hooks-claude-code → dsh-hooks-claude-code/lib/index.js ; hooks-claude-code-nested → dsh/node_modules/@deepseek-ai/dsh-hooks-claude-code/lib/index.js | `prefix+markersAny` | 是 | dsh-hooks-claude-code：deny→allow（可选） / hooks deny bypass | `lib/patches/new-tools.mjs:396` |
| 31 | `HOOKS_CODEX_DENY_ALLOW` | hooks-codex → dsh-hooks-codex/lib/index.js ; hooks-codex-nested → dsh/node_modules/@deepseek-ai/dsh-hooks-codex/lib/index.js | `prefix+markers` | 是 | dsh-hooks-codex：deny→allow（可选） / hooks deny bypass | `lib/patches/new-tools.mjs:418` |
| 33 | `TOOL_SHELL_DENIAL_PROMPT` | tool-bash → dsh-tool-bash/lib/index.js ; tool-pwsh → dsh-tool-pwsh/lib/index.js | `prefix+markersAny` | 是 | bash/pwsh 工具描述：沙箱拒绝话术→可继续 / neutralize sandbox-denial tool text | `lib/patches/new-tools.mjs:432` |
| 34 | `SANDBOX_HINT_NEUTRAL` | escalation → dsh-sandbox/lib/index.js | `prefix+markersAny` | 否 | 沙箱拒绝/升级 hint 不再要求用户审批 / neutralize sandbox hint to model | `lib/patches/new-tools.mjs:507` |
| 35 | `ESCALATION_NEVER_REJECT` | escalation → dsh-sandbox/lib/index.js | `prefix+markers` | 否 | 升级结果 rejected/cancelled/unavailable 仍授信 / escalation never throws | `lib/patches/new-tools.mjs:532` |
| 36 | `TOOL_FS_ESCALATION_SCHEMA` | tool-fs → dsh-tool-fs/lib/index.js ; escalation → dsh-sandbox/lib/index.js | `prefix+markers` | 是 | fs 升级字段：去掉 user approval 拦截描述 / neutralize fs escalation schema | `lib/patches/new-tools.mjs:575` |
| 37 | `SUBAGENT_SCOPE_LOCK_NEUTRAL` | subagent → dsh-subagent/lib/index.js ; subagent-types → dsh-subagent/lib/types/child-agent.js | `prefix+markers` | 是 | 子代理权限锁→可继续 / neutralize subagent scope-lock prompt | `lib/patches/new-tools.mjs:608` |
| 38 | `PERSONA_TEXT_PREFIX_ALIAS` | persona → dsh-persona/lib/index.js | `prefix+markers` | 是 | dsh-persona：兼容 0.1.2 text 字段，否则梁神会话起不来 / accept legacy text as prefix | `lib/patches/new-tools.mjs:633` |
| 39 | `SESSION_V0_PLUGIN_SUMMARY_ALIAS` | session-format-v0 → dsh-session-format-v0-to-v1/lib/index.js | `prefix+markers` | 否 | v0 会话：mnemon summary 可挂在 instructions/recall 上 / allow plugin summary off notice | `lib/patches/new-tools.mjs:664` |
| 40 | `COMPLETE_PROMPT_KEEP_INJECT` | system-prompt → dsh-system-prompt/lib/index.js ; system-prompt-nested → dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js | `prefix+markersAny+forbid` | 否 | complete 预设仍保留 dsh-purge 注入 / keep inject after complete prompt | `lib/patches/new-tools.mjs:681` |
| 42 | `SETTINGS_LEGACY_API` | settings → dsh-settings/lib/index.js | `prefix+markers` | 否 | 按宿主接口适配设置事件；仅旧宿主保留 legacy register/get / native settings API compatibility | `lib/patches/new-tools.mjs:705` |
| 45 | `OFFICIAL_DESKTOP_UPDATE_HANDOFF` | desktop-shell → <Resources>/app 的 Electron 主入口（desktopShellEntry → resolveDesktopEntry） | `regex+markers+forbid` | 是 | 官方桌面升级安装已下载的新版本，不再重新打开旧的解开目录 | `lib/patches/new-tools.mjs:935` |
| 46 | `OFFICIAL_DESKTOP_UPDATE_ASCII` | desktop-shell → <Resources>/app 的 Electron 主入口（desktopShellEntry → resolveDesktopEntry） | `prefix+markersAny` | 是 | 已接管的官方桌面更新改为 ASCII 脚本，中文 Windows 不再吞掉换行 | `lib/patches/new-tools.mjs:971` |
| 47 | `ANTHROPIC_OAUTH_NO_CLAUDE_IDENTITY` | pi-ai-anthropic-messages → listPiAiApiFiles(..., anthropic-messages.js) | `prefix+markers` | 是 | Anthropic OAuth 不再强插 Claude Code 首段系统提示 / drop Claude Code OAuth system prefix | `lib/patches/new-tools.mjs:1012` |
| 48 | `TOOL_SHELL_DELETE_MOVE_NEUTRAL` | tool-bash → dsh-tool-bash/lib/index.js ; tool-pwsh → dsh-tool-pwsh/lib/index.js | `prefix+markers` | 是 | bash/pwsh 去掉 delete/move 过度谨慎描述 / drop delete-move caution in shell tools | `lib/patches/new-tools.mjs:1108` |
| 49 | `ANTHROPIC_OAUTH_CLI_NEUTRAL` | pi-ai-anthropic-messages → listPiAiApiFiles(..., anthropic-messages.js) | `prefix+markersAny` | 是 | OAuth 不再伪装 claude-cli / stop Claude CLI OAuth mimicry | `lib/patches/new-tools.mjs:1127` |
| 50 | `SESSION_REFERENCE_FRAMING_NEUTRAL` | session-reference → dsh-session-reference/lib/index.js | `prefix+markersAny` | 是 | 跨会话引用与 0.1.7 一样标 untrusted / session-reference framing matches 0.1.7 | `lib/patches/new-tools.mjs:1155` |
| 51 | `FRESH_SESSION_FULL_ACCESS` | permission-presets → dsh-permission-presets/lib/index.js ; permission-presets-types → dsh-permission-presets/lib/types/index.js | `prefix+markersAny` | 是 | 新会话在部署已是 danger-full-access 时不再钉回 workspace-write / keep fresh sessions on full access | `lib/patches/new-tools.mjs:1185` |
| 52 | `SESSION_LOG_UPLOAD_DEFAULT_OFF` | session-log-deepseek → dsh-session-log-deepseek/lib/index.js ; session-log-deepseek-types → dsh-session-log-deepseek/lib/types/index.js | `prefix+markers` | 是 | 官方模型 API 默认不上传 Session Log / session log upload off by default | `lib/patches/new-tools.mjs:1211` |
| 53 | `WEB_SURFACE_PROHIBITION` | harness-dev-context → dsh/node_modules/@deepseek-ai/dsh-harness-dev-context/lib/index.js ; web-app-lib → dsh-web-app/lib/index.js | `mixed+markersAny` | 是 | 网页端提示词去掉身份句和禁止另开服务器 / drop web identity and do-not-start | `lib/patches/new-tools.mjs:1232` |
| 54 | `DELIVERABLE_DO_NOT` | deliverable-file-references → dsh-deliverable-file-references/lib/index.js | `prefix` | 是 | 交付物提示词去掉 Do not call present / drop deliverable prohibition | `lib/patches/new-tools.mjs:1265` |
| 55 | `SYSTEM_PROMPT_REPLACE_HEAD` | agent-loop → dsh-agent-loop/lib/index.js | `prefix+markers` | 否 | 每一步用当前整段系统提示替换第一条，避免旧提示被钉住 / replace the first system prompt every step | `lib/patches/new-tools.mjs:1282` |
| 74 | `ASSEMBLE_BEFORE_PRESTEP` | agent-loop → dsh-agent-loop/lib/index.js | `prefix+markers` | 否 | 每个模式的第一次发送前先挂上默认提示词 / hang the default prompt before the first assemble | `lib/patches/new-tools.mjs:1297` |
| 66 | `SYSTEM_PROMPT_RENDER_GUARD` | system-prompt → dsh-system-prompt/lib/index.js ; system-prompt-nested → dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js | `prefix+markers` | 否 | renderPrompt 对 undefined section.text 兜底，避免第二轮 gateway/internal / guard undefined section text in renderPrompt | `lib/patches/new-tools.mjs:1335` |
| 83 | `DESKTOP_HOST_CLOSE_NO_FATAL` | desktop-shell → <Resources>/app 的 Electron 主入口（desktopShellEntry → resolveDesktopEntry） | `prefix+markers` | 否 | host 被信号杀 (重启密封包) 时不报错,不弹 crash dialog / don't fail on signal kill | `lib/patches/new-tools.mjs:1367` |
| 84 | `DESKTOP_HOST_CLOSE_CODE0_NO_FAIL` | desktop-shell → <Resources>/app 的 Electron 主入口（desktopShellEntry → resolveDesktopEntry） | `prefix+markers` | 是 | host code=0 正常退出不报错 (消除 stopped 对话框) / don't fail on code=0 clean exit | `lib/patches/new-tools.mjs:1401` |
| 67 | `AGENT_LOOP_MESSAGES_GUARD` | agent-loop → dsh-agent-loop/lib/index.js | `regex+markers+forbid` | 否 | decision.messages 缺省时按空数组处理，避免第二轮 gateway/internal / treat missing decision.messages as empty | `lib/patches/new-tools.mjs:1426` |
| 68 | `SYSTEM_NODES_CONTENT_GUARD` | agent-loop → dsh-agent-loop/lib/index.js ; session → dsh-session/lib/index.js | `prefix+markers` | 否 | systemNodes/derive 对缺 content 兜底，避免回退后第二轮 gateway/internal / guard missing message content | `lib/patches/new-tools.mjs:1448` |
| 69 | `MODEL_STREAM_RELEASE` | llm-deepseek → dsh-llm-deepseek/lib/index.js | `prefix+markers+forbid` | 是 | deepseek-flash 恢复官方 in-history，并撤掉会打成 TRANSPORT 的独立连接补丁 / restore official in-history and remove the transport-breaking socket patch | `lib/patches/new-tools.mjs:1488` |
| 72 | `MESSAGES_SYSTEM_CURRENT` | llm-deepseek → dsh-llm-deepseek/lib/index.js | `prefix+markers` | 是 | Messages 的 system 字段用当前系统提示，不再把后出现的系统提示降成中途消息 / messages system field keeps the current prompt | `lib/patches/new-tools.mjs:1626` |
| 56 | `REWIND_HIDE_CUT_ONLY` | conversation-client → dsh-client-ui-conversation/lib/client.js | `prefix+markers` | 是 | 回退只藏被撤掉的那一轮 / rewind hides only the cut range | `lib/patches/new-tools.mjs:1654` |
| 77 | `REWIND_DROP_SENT_ON_APPEND` | conversation-client → dsh-client-ui-conversation/lib/client.js | `prefix+markers` | 是 | 回退标记到达时立刻从当前对话拿掉已发送的消息 / drop sent messages when the rewind marker appends | `lib/patches/new-tools.mjs:1862` |
| 75 | `REWIND_RESET_TODOS` | tool-todo → dsh-tool-todo/lib/index.js | `prefix+markers` | 是 | 回退把已完成任务收回成未开始 / rewind resets completed todos to pending | `lib/patches/new-tools.mjs:1916` |
| 57 | `DEEPSEEK_SYSTEM_ROLE` | pi-ai-completions → listPiAiApiFiles(..., openai-completions.js) ; pi-ai-responses-shared → listPiAiApiFiles(..., openai-responses-shared.js) | `prefix+markers` | 是 | developer role 仅限 openai.com/azure 原生，第三方代理 (deepseek/glm/recoverystar/中转) 全回退 system / allowlist openai+azure for developer role, all third-party gateways fall back to system | `lib/patches/new-tools.mjs:1945` |
| 58 | `REWIND_SKIP_DERIVE` | session → dsh-session/lib/index.js | `prefix+markers` | 是 | 回退空标记不进模型请求 / rewind markers stay off the model transcript | `lib/patches/new-tools.mjs:1996` |
| 59 | `OFFICIAL_AUTO_REVIEW_PASSTHROUGH` | auto-review → dsh-experimental-auto-review/lib/index.js | `prefix+markers` | 是 | 官方 Auto Review 不再拦工具 / official auto-review no longer denies tools | `lib/patches/new-tools.mjs:2013` |
| 60 | `OFFICIAL_RUN_CODE_APPROVAL_NEUTRAL` | ptc-tool → dsh-tool-executor-ptc/lib/index.js | `prefix+markersAny+forbid` | 是 | PTC / run_code：沙箱加宽句改为自动放行 / run_code sandbox escalation auto-granted | `lib/patches/new-tools.mjs:2036` |
| 61 | `OFFICIAL_SANDBOX_POLICY_NEUTRAL` | sandbox-policy → dsh-sandbox-policy/lib/index.js | `prefix+markers+forbid` | 是 | 沙箱只读策略不拦任务；加宽自动放行 / sandbox policy auto-grant escalation | `lib/patches/new-tools.mjs:2071` |
| 62 | `OFFICIAL_TOOL_ASK_FAILOPEN` | dsh-tools-pipeline → dsh-tools/lib/pipeline.js ; dsh-tools-pipeline-types → dsh-tools/lib/types/pipeline.js | `prefix+markersAny` | 是 | 无审批通道时放行；用户点拒绝仍 deny / fail-open only without UI channel | `lib/patches/new-tools.mjs:2091` |
| 63 | `OFFICIAL_PLAN_MODE_NEUTRAL` | base → dsh-base/cordis.patch.yml ; preset-ptc → dsh-web-app/presets/ptc.patch.yml \| dsh-agent-presets/presets/ptc/agent.cordis.yml（shippedPresetYml 候选） ; preset-standard → dsh-web-app/presets/standard.patch.yml \| dsh-agent-presets/presets/standard/agent.cordis.yml（shippedPresetYml 候选） ; preset-cordis → dsh-web-app/presets/cordis.patch.yml \| dsh-agent-presets/presets/cordis/agent.cordis.yml（shippedPresetYml 候选） | `prefix+markersAny` | 是 | 计划模式：操作者要求实施时不硬拦 / plan mode allows operator-directed execution | `lib/patches/new-tools.mjs:2116` |
| 64 | `HOOKS_STOP_STEER_NEUTRAL` | hooks-claude-code → dsh-hooks-claude-code/lib/index.js ; hooks-claude-code-nested → dsh/node_modules/@deepseek-ai/dsh-hooks-claude-code/lib/index.js ; hooks-codex → dsh-hooks-codex/lib/index.js ; hooks-codex-nested → dsh/node_modules/@deepseek-ai/dsh-hooks-codex/lib/index.js | `prefix+markers` | 是 | Stop hook 不再 steer 假用户话 / Stop hook no longer steers fake user text | `lib/patches/new-tools.mjs:2147` |
| 65 | `HOOKS_PRESTEP_REJECT_NEUTRAL` | hooks-claude-code → dsh-hooks-claude-code/lib/index.js ; hooks-claude-code-nested → dsh/node_modules/@deepseek-ai/dsh-hooks-claude-code/lib/index.js ; hooks-codex → dsh-hooks-codex/lib/index.js ; hooks-codex-nested → dsh/node_modules/@deepseek-ai/dsh-hooks-codex/lib/index.js | `prefix+markers` | 是 | UserPromptSubmit deny 不再 reject 整轮 / pre-step hook deny no longer rejects turn | `lib/patches/new-tools.mjs:2181` |
| 78 | `OVERLAY_RESTORE_FROM_BAK` | app-boot → dsh-app-boot/lib/index.js | `prefix+markers` | 是 | 声明过的补丁文件不见时，从 .dshpurge.bak 拷回再加载 / restore a missing declared overlay from its bak | `lib/patches/new-tools.mjs:2205` |
| 82 | `DESKTOP_SHELL_PROFILE_FALLBACK` | desktop-shell → <Resources>/app 的 Electron 主入口（desktopShellEntry → resolveDesktopEntry） | `prefix+markers` | 是 | 主进程兜底 DSH_PROFILE=desktop：双击 exe 从 explorer 继承 env 常缺 DSH_PROFILE → host 'cannot determine the boot profile' → dsh-purge 插件没 activate → inject 全断 | `lib/patches/new-tools.mjs:2246` |
| 87 | `HUNG_PROMPT_LF_NEEDLE` | agent-loop → dsh-agent-loop/lib/index.js | `prefix+markers+forbid` | 是 | 空白宿主先挂全文，再用 LF 比对头尾，避免 CRLF 误判再糊一份 | `lib/patches/new-tools.mjs:2266` |
| 88 | `HUNG_PROMPT_STRICT_NEEDLE` | agent-loop → dsh-agent-loop/lib/index.js | `prefix+markers` | 是 | ChatML 头和正文尾都在才算挂住，只剩头或只剩尾都重新置顶 | `lib/patches/new-tools.mjs:2394` |
| 90 | `RESTORE_NATIVE_STEERING` | api-session-controller → dsh-api-session-controller/lib/index.js ; agent-loop → dsh-agent-loop/lib/index.js | `prefix+forbid` | 否 | 恢复原生插话与队列顺序，迁移旧 #85/#86/#90 / restore native steering and queue order | `lib/steering.js:35` |
| 89 | `ASK_USER_WAIT_CAPPED` | tool-ask-user → dsh/node_modules/@deepseek-ai/dsh-tool-ask-user/lib/index.js | `prefix+markers+forbid` | 是 | 尊重模型给的等待时间，只把「无限等待(-1)」收成 5 分钟 / honor requested timeout, cap -1 | `lib/patches/new-tools.mjs:2451` |
| 18 | `REPEAT_TOOL_REMINDER_DISABLED` | repeat-tool-reminder → dsh-repeat-tool-reminder/lib/index.js | `prefix+markers+forbid` | 是 | 重复调用守卫禁用 / repeat-tool-reminder disabled（可选，默认关闭；开启会取消上下文保护） | `lib/patches/opt-in.mjs:29` |
| 19 | `TOOL_RESULT_PRUNER_DISABLED` | compaction-tool-result-pruner → dsh-compaction-tool-result-pruner/lib/index.js | `prefix+markers` | 是 | 工具结果修剪禁用 / tool-result pruner disabled（可选，默认关闭；开启会取消上下文保护） | `lib/patches/opt-in.mjs:52` |
| 95 | `INSPECTOR_FRAME_BUDGET_RECORD_OVERHEAD` | experimental-inspector → dsh-experimental-inspector/lib/index.js | `prefix+markersAny` | 是 | Cordis 树预留记录开销，超限时保留上一帧 | `lib/patches/stability.mjs:45` |
| 96 | `INSPECTOR_FRAME_BUDGET_RECORD_OVERHEAD_CLIENT` | experimental-inspector-client → dsh-experimental-inspector/lib/client.js | `prefix+markersAny` | 是 | Cordis 树预留记录开销，超限时保留上一帧 | `lib/patches/stability.mjs:46` |

---

## 3. 业务逻辑

### 3.1 入口 `applyPatches(aiBase, patches = ALL_PATCHES, options)`

`lib/core.js:3464`。这是唯一真正写宿主源码的函数。

**时序（逐行）**

1. `findDshHome()` 存在时先做 profile 快照 `new Maintenance({home, aiBase}).backup("before-host-patches")`；异常只写 `snapshot = error:*` 并 `console.warn`，**不中断**（`3467-3476`）。
2. `restoreMissingOriginalsFromBak(aiBase)`（`3477` → `2540`）：目标文件被删、但 `.dshpurge.bak` 还在时先还原。
3. `refreshStaleBaksForUpgrade(aiBase)`（`3478` → `2658`）：宿主升级后旧 bak 已不是原厂字节时刷新 bak，避免 revert 把新版本盖回旧版。
4. `targetFiles(aiBase)`（`3479` → `2859`）：解析「键 → 物理路径」表，`filterTargetFiles` 去掉不存在的键（`2818-2839`）。
5. `permissionMigration(...)`（`3482` → `3840`）：先跑权限回滚迁移，返回 `Map<patchId, row[]>`。
6. `repairPluginCordisYaml()`（`3484`）。
7. 逐补丁循环（`3485`）：
   - `!patchAppliesHere(p, options.surface)` → `na`；**特例** `#91` 在非桌面端仍跑 `legacyWebCookieStatus(...,true)` 做回滚修复（`3487-3494`）。
   - `!patchEnabled(p, gate)` → `disabled`（带上迁移恢复的文件列表，`3513`）。
   - 逐 `key` → `pathsOf(files, key)`；空 → `missing += 1`（`3524-3528`）。
   - 逐文件：`loadText` 失败 → `lastError = "read_error"`（`3532-3537`）。
   - `preserveClientBundles && isWatchedClientBundle(fp)` → **不写**，只统计（`3539-3543`）。
   - `applyReplacementsToText(text, p, fp)`（`3544`）；返回 `hitMismatch` → `notFound += 1`、`lastError = hit_mismatch:E!=A`，**该文件不写**（`3545-3550`）。
   - YAML 文件额外跑 `sanitizeYamlPersonaScalars`（`3553-3559`）。
   - 写入前二次校验：`#18` 变更后必须 `filePatchSettled`，否则 `incomplete_repeat_tool_hooks` 且不写（`3560-3563`）；`#17/#61/#93` 同理，失败计 `notFound`（`3564-3568`）。
   - `changed` → `saveText(fp, textOut)`；返回 `true` 计 `applied`，`false`（字节相同）计 `already`；抛错 → `write_error:*`（`3569-3578`）。
   - 未变更 → 判定 `deletionStatus`（仅 `verifyRemovedFromBackup`）/ `filePatchSettled` → `already`；否则若 `#17/#61/#93`、`patchHasRemainingWork` 或 `strictFiles` → `notFound += 1`（`3579-3588`）。
8. `rollupPatchStatus({...})` 折叠成单条状态（`3591-3595`）。
9. `summarizeApplyReport(report)` + `logAudit("apply", {...})`（`3606-3623`）。

**幂等保证（三层，缺一不可）**

| 机制 | 位置 | 作用 |
|---|---|---|
| `skipIfMarked` + `patchApplied()` | `lib/core/verify.mjs:24-26` | 插入型补丁（如 #1，pattern 是 V1/V2 的前缀，自匹配会每次叠一层 +841 字符）在已完成后直接短路 `[静态]` |
| 替换结果自吸收 | `lib/patches/engine.mjs:290-292` | #92 的 regex 写成 `("--expose-internals",)(?: ... )*`，重复 apply 只保留一份参数 `[静态]` |
| `saveText` 字节比较 | `lib/core.js:3382-3394` | 内容相同则返回 `false`（不写盘、不改 mtime），报告里算 `already` |

**失败路径**：正常情况下不 throw。唯一例外是 `saveText` 的 `expected` 校验：当 `expected` 已给出、且磁盘字节与它不同时，会报 `permission target changed during migration`（`lib/core.js:3387`）。其余失败一律降级成报告行。

### 3.2 入口 `applyPatchesAllHosts(patches, options)`

`lib/core.js:1854`。多宿主外层壳。

- 判据：`hooksDeny.selectPatches`（`lib/hooks-deny.js:220-224`）——`settings.hooksDenyBypass === false` 时**从清单里剔除 #30/#31/#64/#65**（`lib/hooks-deny.js:7`）。
- 遍历 `enumeratePatchAiBases({discover: options.forApply===true})`（`1862` → `1783`）：有 `resolveInstance().host` 或 `DSH_BASE` / `PURGE_DSH_CLI` 时**只打这一份**并立即返回（`1800-1803`）；否则只有显式 `discover` 才枚举桌面安装（`1804-1811`）。
- 每个宿主先 `backupAll`；**任一备份失败即 throw**，整批写入取消（`1868-1875`，含只读 Linux 专用提示）。
- `hooksDenyBypass === false` 时 `restoreHookDenyForBases` 先还原（`1876-1880`）。
- `applyPatches` → 收集 `{aiBase, report, summary, hostWritten: hostCleanMarkersPresent(aiBase), flash}`（`1881-1888`）。
- 返回 `{hosts, report: mergeApplyReports(...), hookDenyRestoreFailed, hookDenyRestoreChanged}`；合并取**最差状态**（`lib/core.js:1814-1837` 的 `APPLY_STATUS_RANK`：`failed` < `pattern_not_found` < `read_error` < `missing_file` < `applied` < `already` < `na` < `skipped`）。

### 3.3 入口 `applyReplacementsToText(text, patch, fp)`

`lib/core/verify.mjs:7`。纯函数，单文件单补丁。这是「重新实现引擎」必须逐条对齐的部分。

判据顺序：

1. `patch.id === 42 && modernSettingsApi(source)` → 走 `modernSettingsPatch` 专用分支并**立即返回**（`10`，实现见 `lib/core/shared.mjs:88-109`）。
2. `patch.id === 42` → 先 `collapseDuplicateLegacyApplyPath` 与 `rewriteStaleLegacyApplyCall` 预处理，`preChanged` 记录（`11-22`）。
3. `patch.skipIfMarked && patchApplied(source, patch)` → 返回 `{text: source, changed: preChanged}`，**不替换**（`24-26`）。
4. 记录 `crlf = source.includes("\r\n")`、`yaml = isYamlPath(fp)`，随后全文转 LF（`27-29`）。
5. 逐 `patchReplacements(patch)`（`31`）：
   - `!pattern || typeof replace !== "string"` → 跳过（`33`）。
   - YAML 且 `isBareIdentityNeedle(pattern)`（无缩进且以 `You are a coding agent powered by` 开头）→ 跳过（`35`，`lib/core/shared.mjs:236-241`）。
   - `replace` 在 YAML 里先做 `//` → `#` 注释改写（`36`，`lib/core/shared.mjs:243-272`）。
   - **RegExp 分支**（`38-56`）：有 `expect` 时用 `cloneRegExp(pattern,true)` 数命中数，不等即 `return {text: source, changed: preChanged, hitMismatch}`；相等则 `out.replace(re, written)`（字符串形态调用以保留 `$1..$9`）。
   - **字符串分支**（`57-70`）：有 `expect` 时用 `out.split(needle).length - 1` 数命中数，不等同上；否则 `out.split(needle).join(written)` —— **所有出现处都替换**。
6. `patch.id === 90 && changed && !nativeSteeringRestored(out)` → `console.warn` 并 `return {text, changed:false}`（**部分迁移整体放弃**，`72-79`）。
7. `patch.id === 90 && changed` → 文件头插 `// [dsh-purge] native steering restored (#90)`（`82-84`）。
8. `crlf` 时把 `\n` 还原成 `\r\n`（`85`）。

**实测语义**（`[实测]`，用构造的 patch 对象直接调用本函数）：

| 输入 | patch | 结果 |
|---|---|---|
| `"AAA\|AAA\|AAA"` | `{pattern:"AAA", replace:"BBB"}` | `"BBB\|BBB\|BBB"`，`changed:true` —— 多处命中**全量替换** |
| `"AAA\|AAA\|AAA"` | 同上 + `expect:2` | 原文不变，`hitMismatch:{expected:2,actual:3}` |
| `"AAA\|AAA\|AAA"` | 同上 + `expect:3` | 正常替换 |
| `"AAA BBB"`，patch 两条替换，第 2 条 `expect:5` | — | 原文不变 —— **第一条已成功的替换也被回退**（返回的是循环前的 `source`） |
| `"AAA BBB"`，`skipIfMarked:true` + `markers:["BBB"]` | — | 原文不变，`changed:false` |
| `"v1 v2"` | `{pattern:/v(\d+)/g, replace:"V$1"}` | `"V1 V2"` |
| `"x\r\na\nb\r\ny"` | `{pattern:"a\nb", replace:"A\nB"}` | `"x\r\nA\r\nB\r\ny"` —— CRLF 保留 |
| `"k: v\n"`（`.yml`） | `{pattern:"k: v", replace:"k: w // c"}` | `"k: w # c\n"` —— YAML 注释改写 |
| `"persona: You are a coding agent powered by X\n"`（`.yml`） | 同上 pattern | 不替换（bare identity 跳过） |
| 同一 `.js` 内容 | 同上 pattern | 正常替换 |
| `"abc"` | `{pattern:"", replace:"x"}` 与 `{pattern:"a", replace:null}` | 都不生效 |

### 3.4 入口 `patchStatus` / `patchStatusDetail` / `readPatchReport`

`lib/core.js:3831` / `3836` / `3848`。回读路径，**与 apply 的口径不同**（见 §8 风险 R6）。

逐补丁判据（`3848-3945`）：

1. `!patchAppliesHere` → `#91` 走 `legacyWebCookieStatus(...,false)`：有 legacy 痕迹 → `pending`，报错 → `unmatched`，无痕迹 → `na`（`3856-3861`）。
2. `!patchEnabled` → 有迁移错误 `unmatched`，有迁移行 `pending`，否则 `disabled`（`3862-3866`）。
3. 逐 key 逐文件：
   - `loadText` 失败 → 记 `unreadable`；`#71` 或 `requireAllTargets` 计入 `unreadable` 计数，否则计 `pending`（`3882-3891`）。
   - `#71` 额外用 `import("yaml").parseDocument(text).errors.length` 校验 YAML；解析失败 `unmatched`（`3893-3899`）。
   - `filePatchOutcome(text,p,fp)`；`drifted` 且该 key 在 `fileOptional` → 降级成 `skipped`（`3900-3902`）。
   - 分桶累加 `applied/pending/unreadable/drifted/unmatched/skipped`；`strictFiles` 下 `skipped` 改记 `unmatched`（`3903-3922`）。
4. 折叠优先级（`3931-3944`）：
   `unreadable>0 → unknown` → `#71 且 unmatched>0 → unmatched` → `pending>0 → pending` → `partial(逐目标或 requireAllTargets)` → `applied>0 → applied` → `drifted>0 → drifted` → `unmatched>0 → unmatched` → `skipped>0 → skipped` → `optional ? "na" : "missing_file"`。
5. `#71` 且落到 `missing_file` 时按 `liangshenPresence()` 改判 `na` / `unknown`（`3940-3944`）。
6. 最后 `hooksDeny.annotateHookDenyStatus(status, ...)` 可能改写 #30/#31/#64/#65 的状态（`3946`）。

### 3.5 入口 `patchDrift(aiBase, patches, options)`

`lib/core.js:3721`。四个桶：`drifted` / `optionalDrift` / `chained` / `missing`。

- 跳过条件：状态已是 `applied/already/na/disabled`（`3733`）；`settleWhenAbsent && skipped`（`3735`）；`chainedAfter` 前置未落地 → 进 `chained` 桶（`3737-3740`）。
- 逐文件：`filePatchSettled` 为真则跳过该文件（`3754`）；否则逐条 `replacement` 检查 `pattern` 是否还在文本里（`3755-3769`），不在的记 `{file, index, overridden, reason:"anchor_not_found", head:anchorHead(pattern), suggestion:locateAnchor(text,pattern)}`。
- `head`：`anchorHead`（`3663-3669`）取 pattern 第一条非空行、Tab 转两空格、截 200 字符；RegExp 则去 `[ \t]*`、`\n` 换 `⏎`。
- `suggestion`：`locateAnchor`（`3696-3719`）用 `signatureTokens`（`3683-3689`：≥6 字符标识符、去 19 个停用词、按长度降序取 8 个）在全文找命中行，取命中最多的一行 ±2 行作为片段。
- 分桶：无文件且非 optional → `missing`（`3773-3774`）；`status==="partial"` → `partial_drift`（`3775-3778`）；`!hitAny && anchors.length` → `anchor_drift`（`3779-3781`）。

### 3.6 入口 `patchEnabled(patch, gate)` 与开关

`lib/core.js:3812-3822`。

- 既非 `disabledByDefault` 也非 `permissionOverride` → 恒 `true`（`3813`）。
- `gate` 是数组 → 旧口径，只看 id 是否在清单里（`3814`）。
- `gate` 是对象 / 缺省读 `readPatchGate()`：`permissionOverride` → `t.permissionPatches !== false`；`optIn` → `t.contextManagement === true || listed`；其余 → `listed`（`3818-3821`）。
- `readPatchGate`（`3790-3804`）读 `$DSH_HOME/dsh-purge/tuning.json`，默认 `{permissionPatches:true, contextManagement:false, extraPatches:[]}`；`contextManagement` 还会被 `extraPatches` 里出现 18/19 打开（`3799`）。

### 3.7 入口 `gatherState(options)`（面板唯一数据源）

`lib/core.js:4665` → `readGatherState`（`4668`）。

- `aiBase` 用 `Object.hasOwn(options,"aiBase")` 判定，**显式空值不会去发现别的安装**（`4672`）。
- `patchStatusDetail` 取 `status` 与逐文件 `files`（`4676`）。
- 计数循环（`4685-4701`）：`aiBase` 为空时全部计 `na` 且不进分母（`4687-4690`）；`s === "na"` 或 `!patchAppliesHere` → `patches_na++`（`4692-4695`）；否则进分母，按状态累加 `applied/pending/skipped`，`patchStatusReady` 累加 `ready`。
- 展示层另算一套：`groupPatchesForDisplay`（`4702`）+ `tallyDisplayPatches`（`4703`），输出 `display_applied/pending/skipped/ready/total`。
- `asar_still_sealed`：显式 `aiBase` 时读 `host_layout.disk.archive_exists`，否则 `desktopAsarStillSealed()`（`4754-4756`）。

### 3.8 入口 `backupAll(aiBase)` / `revertAll(aiBase, options)`

`lib/core.js:2700` / `2746`。

`backupAll`：
- 遍历 `flattenTargetPaths(targetFiles(aiBase))`；`isUserProfilePatchFile` 的文件**永不建 bak**（`2708-2711`，`#43` 教训）。
- `openSync(bak,"wx")` 独占占位；`EEXIST` 直接跳过（已有 bak 不重建）；成功后 `atomicCopyFile`；失败则 `unlink` 占位（`2715-2731`）。
- 末尾 `dropStaleUserProfilePatchBackups()`（`2733`）。

`revertAll`：
- 先 `restoreMissingOriginalsFromBak`（`2748`）。
- `preserveClientBundles` 时跳过 `isWatchedClientBundle` 文件（copy 也会改 mtime → `#63`，`2758-2761`）。
- 用户 patch 层：只删 bak、**绝不 copy 回去**（`2763-2773`）。
- 有 bak：`sameFileBytes` 相等则跳过；否则 `restoreBackupFile(fp,bak)` + `unlink(bak)`（`2774-2786`）。
- 无 bak 且目标存在：**只跳过、绝不删除**（`2788-2789`，`#41` 教训）。
- `logAudit("revert", {...})`（`2792-2797`）。

### 3.9 入口 插件 `apply(ctx, config)`

`lib/index.js:1484`。

1. `cfg = {...DEFAULTS, ...config}`（`1485`，`DEFAULTS` 见 `lib/index.js:70-89`）。
2. 注册 `ctx.on("llm/stream", ...)`（`1487-1521`）：只有 `tuning.refusalRetry === true` 且 `cfg.enabled` 且 `injectAllowedNow(...)` 才接管；`RETRY_MARK` 防递归（`1490-1494`）；重试经 `ctx.reflect.get("llm",false)` 拿服务，取不到则 fail-open（`1508-1517`）。
3. `createUpdateController(...)`（`1524-1537`）。
4. `ctx.inject(["webServer"], ...)` 注册 `/dsh-purge/community`（`1542-1571`）。
5. `compatibility` 探测与日志（`1572-1580`）；`cfg.enabled === false` 时直接 `return`（`1581-1584`）。
6. `setHooksDenyConfigValue(cfg.hooksDenyBypass)` + `refreshHooksDenySettings()`（`1591-1592`）。
7. `pinDshHome()`、删 `.hung-disabled`、`installHungPromptGlobal`、`seedPromptInjectAtBoot`（`1594-1620`）。
8. `watchContextLife(ctx)`；`!life.alive` 直接返回（`1622-1626`）。
9. `installWebServer(ctx,cfg,diagnostics)`（`1628`）→ 注册全部 HTTP 路由。
10. `updates.start()`（`1630-1633`）、`applyRuntimeEnv()`（`1634`）。
11. `setTimeout(settleDelayMs(surface))` 后跑 `settleInstalledPatches` 与 `rules.ensureInitialState`（`1640-1657`）。
12. `applyHostHooks(ctx,cfg,diagnostics)`（`1670` → `1680`）：身份覆盖、rewind 过滤、cwd 捕获、mnemon 剥离、`registerPromptSections`、continue-retry、`installCommands`、3 个 `ctx.tools.register`。

### 3.10 入口 `settleInstalledPatches(config, ctx, life)`（启动自愈）

`lib/index.js:901`。

- `config.autoApplyOnStart !== true`（默认）时**启动不写宿主**：只要 `patchesMatchInstallStrict()` 或 `hostCleanEnoughToKeep()` 就刷新戳并返回 `"boot:host-untouched"`，否则 `"skip:boot-no-host-write"`（`915-925`）。
- 开启自动应用时：密封桌面端 `settleMayReapply(scope)` 为假 → `"skip:sealed-wait-apply"`（`929-932`）；宿主已干净 → `"already-clean"`（`933-937`）；有官方升级标记 → `reapplyInstalled({scheduleSwap:false, upgrade:true})`（`938-963`）；否则 `reapplyInstalled({scheduleSwap:false})`（`966`），按 `needsFullQuit` / `settleMayRestart` / `shouldSkipSettleRestart` 决定是否 `hostctl.scheduleRestart(null,ctx,{openBrowser:false})`。
- 每个 `await` 之后都重新检查 `life.alive`，避免对已 dispose 的 ctx 发起重启（`940,947,954-955,967,994-995`）。

### 3.11 入口 `selfCheck(aiBase, dshHome, options)`（分层自检）

`lib/selfcheck.js:198-301`。核心思想：**不相信「插件装上了」，逐层证明破甲在这台机器上真实存在**（`lib/selfcheck.js:3-4`）。

**层级模型**：`BYPASS_LAYERS` 是 **22 个静态层，`kind` 全部为 `host`**（`lib/selfcheck.js:17-62`，实测 22 条 `{ ids: ... }` + 22 个 `kind: "host"`），每层 `{ids, title, kind, why, optionalIds?}`。最终 `layers` 数组 = 22 个 host 层 + 最多 1 个「其他必需目标文件」补录层 + runtime + config + layout，最多 26 层：

| kind | 层数 | 来源 | 判据 |
|---|---:|---|---|
| `host` | 22 | `BYPASS_LAYERS` 全部项（`17-62`） | 该层 `ids` 的 `patchStatus` 折叠结果 |
| `host`（补录） | 1 | 「其他必需目标文件」（`214-220`）：未归入任何层、非 optional、状态 `missing_file` 的补丁 | 有则整层 `broken` |
| `runtime` | 1 | `runtimeLayer(dshHome)`（`84-101`） | `$DSH_HOME/prompt-inject.md` 字节数 > 0 → `ok`，否则 `broken` |
| `config` | 1 | `configLayer`（`73-82`）→ `permissionState(profileCordisText, ctx)` | 当前 profile 的预设/审批组合是否已不弹审批 |
| `layout` | 1 | `hostLayoutLayer`（`184-196`） | 只看目标实例的 `<resources>/app.asar` 是否还存在；`web` 端返回 `na`、`unknown` 端返回 `unknown` |

**逐层判据**（`rollupLayers`，`lib/selfcheck.js:126-172`）：

- `notApplicable(patch,status)`（`104-109`）决定「能否从分母剔除」：`na` / `off` / `disabled` / （`not_needed` 且 `#76`）/（`missing_file` 且 `optional`）/（`skipped` 且 `settleWhenAbsent`）。
- `required` = 未被剔除的行；`applied` = 状态为 `applied`/`already` 的行；`pending` = `required` 中 `pending`；`broken` = `required` 中**不在** `["applied","already","pending","unlocated","unknown"]` 的行（`144`）。
- `unknown` = `statusError` 为真，或任一行是 `unlocated`/`unknown`（`146`）。
- 折叠顺序：`broken.length ? "broken" : unknown ? "unknown" : pending.length ? "pending" : "ok"`（`147`）。

**总判定**（`268-283`）：`ok = failed.length === 0`；`state` 依次取 `broken > pending > unknown > inferred > ok`；`needsApply = broken 为 0 且 pending > 0`；`summary` 按 kind 分别 `{ok, passed, total}`，另给 `pending/uncertain/broken` 计数；`hints` 逐失败层给出可执行建议（`284-299`）。

**与面板口径的差异**：自检用 `tallyPatchStatus`（`111-124`，分母剔除 `notApplicable`），面板用 `gatherState` 的 `patches_total`/`patchStatusReady`（`lib/core.js:4685-4701`）；两者对 `skipped`/`missing_file`/`optional` 的处理不同，同一状态下数字可能不一致。

### 3.12 HTTP 入口 `POST /dsh-purge/apply`

`lib/index.js:2375-2516`。判据链：

1. 非 POST → 405（`2379-2383`）。
2. `readJsonBody`；`content` 非字符串则视为 `null`（`2385-2386`）。
3. `applyRuntimeEnv()` + `clearDesktopLocateCache()` + `pinDshHome()` + `sanitizeDesktopCommandRuntimes()`（`2387-2390`）。
4. `resolveOfficialAiBase(state.ai_base,{forApply:true})`；抛错 → 500；`located.aiBase` 为空 → 500 + `missingAiBaseMessage()`（`2394-2403`）。
5. 解包过则 `writeUnpackedAsarStamp(arch)`（`2405-2408`）。
6. `rejectIfNeedPrompt(dsh_home, incoming)` 命中 → 400 + `needPrompt:true` + `defaultContent`（`2410-2421`）。
7. `commitOverrideOnApply`（失败只 warn，`2422-2426`）。
8. `applyPatchesAllHosts(ALL_PATCHES, {preserveClientBundles:false, forApply:true})`（`2427-2430`）。
9. `patchAllShims()`、`repairOfficialCliAfterUnpack()`、`silenceCmdFlash()`（`2432-2439`）。
10. `complete = summary.failed.length===0 && flash.ok===true && hostWritten && !hookDenyRestoreFailed`（`2441-2444`）。
11. `cliRepairBlocksApply({handoff, sealed, cliRepair})` → 500 并保留原归档（`2446-2449`）。
12. `flash.ok && (complete || promptReady) && hostWritten` → `reapply.markPatchesApplied()`（`2451-2453`）。
13. `applyShouldRestart({...})` → `scheduleDesktopHandoff` / `bootFullQuit` / `markSettleRestart`（`2455-2465`）。
14. `seedPromptInjectAtBoot`（`2467-2476`）、`refreshHungOperator`、`readOverrideForUi`，返回 200 大对象（`2479-2511`）。

### 3.13 入口 宿主文件定位（surface → aiBase → resources → asar）

这一条链决定「往哪写」，是整份补丁引擎的前置条件。顺序与判据：

1. **判端** `detectSurface()`（`lib/surface.js:77`）→ `adapterFor(kind)`（`lib/surface.js:86`）。`patchAppliesHere` 只认这两个值（`lib/core/verify.mjs:104-109`）。
2. **解析当前实例** `resolveInstance()`（`lib/instance.js:261`）：只认 `DSH_BASE` / `PURGE_DSH_CLI` / 已选实例，**不扫 PATH 与全局安装**；目标目录存在但组件不全时仍交出去（让上层报「缺件」），只有完全不可读才返回 `host:""` + `reason`（`lib/instance.js:280-300`）。
3. **判端二道** `hostSurface(host)`（`lib/instance.js:196`）：`desktopResourcesForHost(host)` 命中 `.../resources/(app|app.asar|app.asar.unpacked)/(dsh/)?node_modules/@deepseek-ai` 即 `desktop`（`188-193`）；否则看 `dsh` / `dsh-agent-loop` / `dsh-system-prompt` 的 `package.json` → `web`；都不中 → `unknown`。
4. **aiBase 发现**（`lib/core.js`）：`findAiBase()`（`2278`）→ `findAiBaseDesktop()`（`1747`）/ `findAiBaseWeb()`（`1775`）/ `findAiBaseRecursive()`（`2285`）；判定 `isAiBase(p)`（`175`）要求目录里有 `@deepseek-ai` 特征包；结果按 `remember()`（`125`）做进程内记忆，`resetPathMemo()`（`134`）清。
5. **桌面 resources** `desktopResourcesForHost(host)`（`lib/instance.js:188`）+ `resolveDesktopEntry(appDir)`（`lib/desktop-entry.js:12`）得到 Electron 主入口文件，即 `desktopShellEntry(aiBase).file`（`lib/core.js:2439-2452`）。#45/#46/#82/#83/#84/#92 打的就是这个文件。
6. **密封 asar 交接** `sealedAsarHandoff(input)`（`lib/core.js:1952-1981`）：只有 `adapterFor(surface)==="desktop"`、能定位 exe、`appAsarPath(exe)` 或 `process.resourcesPath/app.asar` 是真文件、且 exe 是官方 harness 可执行文件时才返回 `{exe, asar, swapAsar:true}`；否则 `null`。
7. **要不要解包** `shouldExtractAsar({usable, identity, recorded, upgrade})`（`lib/extract-asar.js:247-253`）：`identity` 为 `{size, mtimeMs}`（`224-232`）；无 identity → 不解；目录不可用 → 解；`upgrade` 且身份不同 → 解；有记录且身份不同 → 解；否则不解。点「应用」时额外强制：`forApply && asarStill && (!aiBase || !sameAsarIdentity(archive, recorded))` → 解（`lib/core.js:2041-2043`）。
8. **解包 → 校验 → 提交**：`extractAsarToSide`（`lib/extract-asar.js:417`，解到 `<app>.dshpurge-next[-随机]`）→ `overlayAsarUnpacked`（`327`）→ `verifyStagedAsar`（`372`，逐文件 sha256）→ 必须能在暂存目录里找到 `@deepseek-ai`（`lib/core.js:2053-2057`）→ `commitExtractedDir`（`lib/extract-asar.js:456`：旧目录改名 `.dshpurge-prev`，新目录 rename 上去，失败回滚并写 `recover.json`）。
9. **写回 stamp** `writeUnpackedAsarStamp({size,mtimeMs})`（`lib/core.js:1999`）到 `$DSH_HOME/dsh-purge/unpacked-asar.json`。
10. **只读诊断** `hostLayoutEvidence(host)`（`lib/host-layout.js:25`）单独回答「磁盘布局是什么」，并在注释里明确**磁盘状态不等于进程加载来源**（`lib/host-layout.js:2`）。它支持 `managed_archive_entry` / `cli_unverified` / `archive_missing` / `different_instance` / `unreadable` 等状态（`lib/host-layout.js:74-80`）。

关键判据：`allowTargetPath` / `allowTargetPathForAiBase` / `allowTargetForPatch`（`lib/core.js:936,946,956`）与 `pathZone`（`926`）构成写入白名单，`filterTargetFiles` 与 `firstExisting` 都用它过滤（`2822-2825`、`2456`）。

---

## 4. 对外接口

### 4.1 HTTP op（全部挂宿主 `webServer.register`，`lib/index.js:2009-2740`）

| 类型 | 名称 | 入参 | 出参 | 调用方 |
|---|---|---|---|---|
| HTTP GET | `/dsh-purge/status` | — | `{ok, ready, surface, ai_base, host_layout, patches_applied/pending/skipped/ready/na/total/total_all, patch_status, patch_files, patches[](分组), patch_rows[](逐条), patch_names, shim_*, has_backup, override_*, dsh_home, plugin_version, commands, compatibility, update, hooks_deny_bypass, skills}`（`2042-2095`） | 面板状态页（`client.js:11045,11445,12748,13959`） |
| HTTP GET | `/dsh-purge/diagnose` | — | `{ok, ai_base, compatibility, checked, drifted, optionalDrift, chained, missing}`（`2128`） | 面板诊断页 |
| HTTP GET | `/dsh-purge/selfcheck` | — | `{ok, ...selfCheck()}`（`2144`） | `client.js:13108,13130` |
| HTTP GET/POST | `/dsh-purge/boost` | GET —；POST `{rewind?}` 或 `{permissionPatches?,contextManagement?}` 或 `{enabled}` | `{ok, enabled, rewind, permissionPatches, contextManagement, restart_required, apply_required}`（`2154-2205`） | `client.js:10193,10540,13109` |
| HTTP GET/POST | `/dsh-purge/probe` | POST — | GET `{ok,active,nonce}`；POST `{ok,...createProbe()}`（`2212-2225`） | `client.js:13209` |
| HTTP GET | `/dsh-purge/audit` | `?limit=20` | `{ok, entries[]}`（`2237-2238`） | `client.js:13696` |
| HTTP GET/POST | `/dsh-purge/hooks-deny` | POST `{hooksDenyBypass:boolean}` | `{ok, hooksDenyBypass}`（`2245-2269`） | `client.js:10934` |
| HTTP GET | `/dsh-purge/last-user` | `?sessionId=` | `rewind.readLastUserText()`（`2284`） | `client.js:14468` |
| HTTP GET | `/dsh-purge/rewind/options` | `?sessionId=` | `rewind.analyzeRewind()`（`2302`） | 回退 UI |
| HTTP GET/POST | `/dsh-purge/rewind` | GET `?sessionId=`；POST `{sessionId, mode:"once"\|"round"}` | GET draft/pending；POST `rewind.applyRewind()`，失败 409（`2311-2346`） | `client.js:14721,14856,14933` |
| HTTP GET/POST | `/dsh-purge/update` | POST `handleUpdateOp` body | `checkUpdate()` / `handleUpdateOp()`（`2351-2373`） | `client.js:11317,11339,11482` |
| HTTP POST | `/dsh-purge/apply` | `{content?:string}` | 见 §3.12 第 14 步 | `client.js:11539` |
| HTTP POST | `/dsh-purge/revert` | — | `{ok, reverted, errors, shim, note}`（`2530-2535`） | `client.js:11539` |
| HTTP POST | `/dsh-purge/uninstall` | — | `{...uninstallPurge(), surface, fullApp, note}`（`2551-2564`） | `client.js:11762` |
| HTTP GET/POST | `/dsh-purge/drill-grant` | — | `readDrillGrant` / `writeDrillGrant`（`2575-2582`） | `client.js:8986,9016` |
| HTTP GET/POST | `/dsh-purge/override` | POST `{content:string}` | GET `{ok,...readOverrideForUi(),...injectSnapshot()}`；POST `{ok, content, defaultContent, customized, usingDefault, path}`（`2591-2641`） | `client.js:11489,11634,11698` |
| HTTP GET/POST | `/dsh-purge/own-servers` | POST `{content:string}` | GET `{ok,content}`；POST `{ok,content,dropped}`（`2648-2669`） | `client.js:11510,11668` |
| HTTP POST | `/dsh-purge/restart` | — | `{ok, surface, fullApp, restarting, already, manualQuit, handoff, needsFullQuit, asar_still_sealed, error, note}`（`2714-2726`） | `client.js:11091` |
| HTTP GET/POST | `/dsh-purge/community` | POST `{op:"preferences"\|"backup"\|"rollback"\|"prune"\|"check"\|"update", ...}` | GET 维护信息；POST 对应结果（`1543-1571`） | `client.js:13292,13427,13584,13631` |
| HTTP prefix | `/dsh-purge/rules` | tail 或 `body.op`；`?id=&cwd=` | `handleRulesOp`（`2749-2843`） | `client.js:250` |
| HTTP prefix | `/dsh-purge/skills` 与 `/dsh-purge/skill` | tail 或 `body.op`；POST body 上限 14 MB | `handleSkillsOp`（`2902-2929`） | `client.js:265-267` |

所有路由统一经 `registerPluginRoute` / `registerRoute` 包一层 `allowPluginRequest(request,response,trustedHostnames(...))`（`2021-2027`、`2985-2996`，判定实现 `lib/index.js:1977`），并且 `host.effect` 返回的 cleanup 会**逆序**注销全部 disposer（`2732-2737`）。

### 4.2 agent 工具（`ctx.tools.register`，仅 `ctx.tools` 存在时注册）

| 名称 | 入参 | 出参 | 行为 |
|---|---|---|---|
| `purge_status` | `{}` | `{text}` | `core.gatherState()` → `renderStatus(state)`（`lib/index.js:1711-1731`） |
| `purge_apply` | `{}` | `{text}` | `applyRuntimeEnv` → `sanitizeDesktopCommandRuntimes` → `gatherState` → `rejectIfNeedPrompt` → `applyPatchesAllHosts` → `patchAllShims` → `silenceCmdFlash`；返回 `applied/already` 计数（`1732-1767`） |
| `purge_revert` | `{}` | `{text}` | `revertAll(ai_base)` + `revertAllShims()`（`1768-1795`） |

### 4.3 slash 命令（`ctx.inject(["commands"])`，`lib/index.js:1800-1823`）

| 名称 | hint | handler |
|---|---|---|
| `purge` | `status \| apply \| revert \| uninstall \| edit \| help` | `handlePurgeCommand`（`1116`） |
| `rules` | `list \| use <id> \| create <id> [别名] [目标] \| delete <id> \| reset \| help` | `handleRulesCommand` |
| `skills` | `list \| import <路径> \| create <id> [说明] \| delete <id> \| help` | `handleSkillsCommand` |

### 4.4 事件（Cordis）

| 事件 | 位置 | 作用 |
|---|---|---|
| `llm/stream` | `lib/index.js:1487` | 拒绝检测 + 单次重试（`streamWithRefusalRetry`） |
| `system-prompt/assemble` | `lib/index.js:759` | 注入段排序（`COMPLETE_PROMPT_WATERFALL_INJECT`，`lib/patches/shared.mjs:38-51`） |
| `agent/pre-step` | `lib/index.js:542`、`855` | 每步重贴注入 / 队列处理 |
| `session/created`、`session/event` | `lib/index.js:678-679`、`702`、`837` | 会话级挂载与 flush |
| `agent-preset/selected` | `lib/index.js:846` | 预设切换后重建 section |

### 4.5 CLI（`bin/dsh-purge.js`）

`--status` / `--apply` / `--revert` / `--uninstall` / `--edit` / `--help`（`bin/dsh-purge.js:42,45-55`）。`--apply` 会拒绝在提示词与规则集都为空时执行（`bin/dsh-purge.js:64-69`）。

### 4.6 slot（客户端 bundle）

`conversation.input.right`（`client.js:14956`）、`shell.overlay`（`15542`）、`sidebar.panellist`（`15553`）、`plugins.bundle.config`（`15577`）、`plugins.row.config`（`15588`）。

---

## 5. UI 触点

`client.js` 是预构建产物（702 KB），以下为实际引用点。

| 组件名 | 文件:行 | 依赖的 op | 展示字段 | 交互 |
|---|---|---|---|---|
| 侧栏面板入口 | `client.js:15553`（`sidebar.panellist`） | — | 图标 + 标题 | 点开打开 purge 面板 |
| 插件详情页配置 | `client.js:15577`（`plugins.bundle.config`） | `/dsh-purge/status` | `plugin_version`、`hooks_deny_bypass` | 改配置 → `POST /dsh-purge/hooks-deny` |
| 插件列表行配置 | `client.js:15588`（`plugins.row.config`） | 同上 | 同上 | 同上 |
| 状态页 | `client.js:11045,11445,12748,13959` | `GET /dsh-purge/status` | `patch_rows`、`patches_*` 计数、`shim_*`、`has_backup` | 「应用」→ `POST /dsh-purge/apply`；「回滚」→ `POST /dsh-purge/revert`；「重启」→ `POST /dsh-purge/restart` |
| 自检页 | `client.js:13108,13130` | `GET /dsh-purge/selfcheck` | `layers[].{title,state,note}`、`summary` | 只读刷新 |
| 探针按钮 | `client.js:13209` | `POST /dsh-purge/probe` | `nonce` | 生成一次性 nonce |
| 审计列表 | `client.js:13696` | `GET /dsh-purge/audit?limit=10` | `entries[].{at,event,...}` | 只读 |
| 维护/更新卡片 | `client.js:13292,13427,13584,13631` | `GET/POST /dsh-purge/community` | `backups`、`update_status`、`update_preferences` | `op:"backup"/"rollback"/"prune"/"check"/"update"` |
| 注入稿编辑框 | `client.js:11489,11634,11698` | `GET/POST /dsh-purge/override` | `content`、`defaultContent`、`customized` | 保存 → `POST`；`needPrompt` 时先填稿再 apply |
| 规则/技能面板 | `client.js:250`、`265-267` | `/dsh-purge/rules`、`/dsh-purge/skills` | `rules`/`skills` 列表 | list/use/create/delete/import |
| 回退按钮 | `client.js:14956`（`conversation.input.right`） | `/dsh-purge/rewind*` | draft/pending | 点回退 → `POST /dsh-purge/rewind` |
| 欢迎覆盖层 | `client.js:15542`（`shell.overlay`） | `GET /dsh-purge/status` | `missing_ai_base`、`asar_handoff` | 只读提示 |

请求超时按路径分档（`client.js:155-165`）：`apply` 24 s、`revert` 12 s、`status`/`restart` 6 s、`community` 9 s、`skill*` 默认档。`GET /dsh-purge/status` 另有 in-flight 去重：并发调用共用同一个 Promise，任意非 GET 请求会清空该去重状态（`client.js:177-186`）。

---

## 6. 依赖

### 6.1 内部

- `lib/index.js` → `core.js`、`selfcheck.js`、`update*.js`、`reapply.js`、`host.js`、`rules.js`、`skills.js`、`identity.js`、`rewind.js`、`uninstall.js`、`tuning.js`、`boost.js`、`probe.js`、`audit.js`、`drill-grant.js`、`net-scope.js`、`settle-policy.js`、`instance.js`、`preset-injection.js`、`command-registration.js`、`capability-protocol.js`、`refusal-retry.js`、`continue-retry.js`、`apply-gate.js`、`desktop-handoff.js`（`lib/index.js:1-60`）。
- `core.js` → `patches/index.mjs`、`patches/shared.mjs`、`core/shared.mjs`、`core/verify.mjs`（`2388-2394`）；`permission-migration.mjs`、`restore-backup.js`、`desktop-read-scope.js`、`desktop-entry.js`、`remove-tree.js`、`instance.js`、`preset-presence.js`、`desktop-handoff.js`、`steering.js`、`host-layout.js`、`community.js`（`Maintenance`）、`anchors.js`、`audit.js`、`hide-console.js`、`desktop.js`、`extract-asar.js`、`surface.js`、`host-clean.js`、`phase1-keep.js`、`table-read.js`、`hooks-deny.js`、`atomic-files.js`（`lib/core.js:1-62`）。
- 环依赖刻意规避：`lib/anchors.js:11` 注释明确「不 import core，core 会 import 本模块」；`lib/core.js:3786-3789` 注释明确 `patchGate` 直接读文件而不走 `tuning.js`。

### 6.2 宿主 API

| API | 是否公开 | 位置 |
|---|---|---|
| `ctx.inject(["webServer"])` + `webServer.register({kind:"exact"\|"prefix", path, handler})` | 公开插件 API | `lib/index.js:1542`、`2012-2021` |
| `ctx.inject(["commands"])` + `commands` 服务 | 公开 | `lib/index.js:1801-1805` |
| `ctx.tools.register({name, description, parameters, output, execute})` | 公开 | `lib/index.js:1710-1795` |
| `ctx.on(event, handler, opts?)`（`{global:true, prepend:true}`） | 公开 | `lib/index.js:542` |
| `ctx.waterfall(scopeTarget(...), "system-prompt/assemble", ...)` | 公开（注入字符串形式写入宿主源码） | `lib/patches/shared.mjs:39` |
| `ctx.effect(cleanup)` | 公开 | `lib/index.js:386,555,676,702,1607,1630,1703` |
| `ctx.reflect.get("llm", false)` | 半公开（未声明 inject 时的非严格取法） | `lib/index.js:1513` |
| `host.webServer.host` | 公开（用于绑定地址白名单） | `lib/index.js:2024` |
| `inject = ["systemPrompt", "tools"]` | 公开契约；**刻意不含 `pluginPackages`** | `lib/index.js:64-66`（注释说明原因） |

### 6.3 外部

- **文件系统**：`$DSH_HOME`（`~/.dsh` 或 `DSH_HOME`）、`<Resources>/app`、`<Resources>/app.asar`、`<Resources>/runtime`、各 `node_modules/@deepseek-ai/*`、PATH 上的 shim 目录（`dsh.cmd`/`dsh.ps1`/`dsh`）。
- **子进程**：`execFileSync`/`spawn`（`lib/core.js:18`）；`npmQuery` 走 `npm` CLI（`lib/core.js:100-111`）；`openSealedDesktopHost` 后调用 `desktop.repairOfficialCliAfterUnpack`。
- **网络**：更新器请求 GitHub API / releases.atom（`lib/update*.js`，不在本次范围）；本模块自身无出网。
- **无外部 npm 运行时依赖**（除 `#71` 动态 `import("yaml")`，`lib/core.js:3896`）。

---

## 7. 与另一版的差异

**与 safe 的差异我未查。** 本节只登记 community 侧的可对照锚点，safe 列一律留空，等 `04-safe-*.md` 产出后再对齐。

| 能力 | community 行号 | safe 行号 | 差异性质 |
|---|---|---|---|
| 补丁总数 88（必需 39 / 可选 49） | `lib/patches/index.mjs:9` | 未查 | 未查 |
| 补丁表按 6 模块拆分 | `lib/patches/index.mjs:2-7` | 未查 | 未查 |
| 展示分组（同一条清洗的升级链合一行） | `lib/patches/index.mjs:12-23` | 未查 | 未查 |
| 命中数契约 `expect` | `lib/core/verify.mjs:40-45,60-65` | 未查 | 未查 |
| `forbid` 反向标记 | `lib/core/shared.mjs:165` | 未查 | 未查 |
| `skipIfMarked` 防重复插入 | `lib/core/verify.mjs:24-26` | 未查 | 未查 |
| 漂移分桶 + 重锚建议 | `lib/core.js:3721-3784` | 未查 | 未查 |
| 分层自检 `BYPASS_LAYERS` | `lib/selfcheck.js:17-62` | 未查 | 未查 |
| 本地重锚覆盖文件 | `lib/anchors.js:67-84` | 未查 | 未查 |
| asar 解包 / 提交 / 回滚 | `lib/core.js:2026-2085`、`lib/extract-asar.js:417-509` | 未查 | 未查 |
| 跨进程维护锁 | `lib/maintenance-lock.js`（`lib/core.js:3471` 的 `Maintenance.backup` 内部使用） | 未查 | 未查 |

---

## 8. 风险与脆弱点

| 风险 | 触发条件 | 后果 | 是否可静态检出 |
|---|---|---|---|
| **R1 死字段 `multiHit`** | #93 声明 `multiHit: true`（`lib/patches/engine.mjs:305`），引擎与客户端全无消费者 | 读者会误以为它影响「多处命中」行为，实际无任何效果 | 是（`grep -rn multiHit lib/ client.js` 只命中定义处） |
| **R2 死字段 `rel`** | 29 条补丁声明 `rel` | 无任何代码读取；重构时易被误当作目标路径来源 | 是 |
| **R3 `expect` 不符导致整条该文件回退** | 宿主复制了同一段代码使命中数变化 | 该补丁在该文件的所有替换一起丢失（实测 `"AAA BBB"` + `expect:5` → 原文不变），报 `hit_mismatch:E!=A` | 是（`lib/core/verify.mjs:43,63` 返回的是循环前的 `source`） |
| **R4 字符串锚点全量替换无上限** | 官方把同一句复制成 N 份 | `split/join` 把 N 处一起改；只有显式 `expect` 能拦住 | 是 |
| **R5 非 `skipIfMarked` 的插入型补丁会重复插入** | 补丁的 `replace` 包含原 `pattern` 且未声明 `skipIfMarked` | 每次 apply 叠一层（#1 的注释记录了 +841 字符/次的历史事故，`lib/patches/prompt.mjs:8-11`） | 需人工判断 pattern/replace 是否自包含 |
| **R6 apply 与回读口径不一致** | 同一份文件 | apply 用 `rollupPatchStatus`（无 `drifted`/`unmatched`/`partial` 概念）；回读用 `readPatchReport`（有）。同一状态可能一次报 `skipped`、一次报 `drifted` | 是（对比 `lib/core/verify.mjs:89-100` 与 `lib/core.js:3931-3944`） |
| **R7 `drifted` 判定依赖 `selfMarkedPatch`** | 锚点里不含字面量 `[dsh-purge]` 且宿主改版 | `filePatchOutcome` 返回 `drifted`（`lib/core.js:3342`），宿主小版本升级即大面积报红 | 是 |
| **R8 `patchApplied` 的 `replace` 首行判定很弱** | 补丁只有 `patterns`+`replace`、无 `marker`/`markers` | 判定只看 `replace` 首行前 60 字符是否出现在文件里（`lib/core/shared.mjs:172-174`），因此：(a) 首行极短时几乎任何文件都判「已完成」——实测 `replace="a\nlong tail…"` 对 `"abc"` 返回 `true`；(b) 两条不同替换若前 60 字符相同会互相误判——实测 `"A"×60+"B"×30` 对 `"A"×60+"X"×10` 返回 `true` | 是 |
| **R9 #90 部分命中整体放弃** | 宿主 steering 实现只被认出部分 | 该文件一个字节都不写，面板长期 `pending`，只在 stderr 留一行 warn（`lib/core/verify.mjs:72-79`） | 是 |
| **R10 无跨进程互斥** | 面板「应用」、CLI `--apply`、启动自愈三路并发 | 只靠 `atomicWriteFile` 保证单文件原子；bak 用 `wx` 占位避免竞态（`lib/core.js:2713-2723`），但两份 apply 仍可能交错写同一文件 | 是（`applyPatches` 内无锁） |
| **R11 asar 解包非事务** | commit 时 rename 失败 | 旧目录改名到 `.dshpurge-prev`，失败回滚；再失败写 `recover.json` 并 `err.keepStage = true`（`lib/extract-asar.js:456-507`） | 是 |
| **R12 审计写入失败静默** | 目录属主/权限异常 | `logAudit` 返回 `false`，只 `console.error` 一次（`lib/audit.js:113-121`） | 是 |
| **R13 `#71` 依赖动态 `import("yaml")`** | 运行环境缺 `yaml` 包 | `unreadable`，该补丁状态变 `unknown`（`lib/core.js:3896-3898`） | 是 |
| **R14 用户 patch 层被误纳入会毁用户内容** | 有人把 `profiles/*/cordis.patch.yml` 加进 `targetFiles` | `revertAll` 会覆盖用户后来追加的 insert（`#43`）；现由 `isUserProfilePatchFile` 三重保护（`lib/core.js:2491,2708,2763`） | 是（`lib/core.js:2893-2895` 有明确注释） |
| **R15 `#92` 依赖 host 子进程参数形态** | 官方改了 Electron 启动参数 | regex 不命中 → `optional` 使其静默，431 问题复发且面板全绿 | 是（`lib/patches/engine.mjs:288-292`） |

---

## 9. 逐条功能清单

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| CM-CORE-001 | 补丁表汇总为 `ALL_PATCHES`（6 模块拼接） | `lib/patches/index.mjs:9` | 完整 | 88 条 `[实测]` |
| CM-CORE-002 | 展示分组 `PATCH_DISPLAY_GROUPS` → `DISPLAY_GROUP_BY_ID` | `lib/patches/index.mjs:12-23`、`lib/core.js:2397-2399` | 完整 | 只影响 UI 折叠 |
| CM-CORE-003 | 补丁结构归一（`replacements` / `patterns+replace`） | `lib/core/shared.mjs:230-234` | 完整 | `[实测]` 两种形态等价 |
| CM-CORE-004 | 本地重锚覆盖叠加 | `lib/anchors.js:67-84`、`lib/core/shared.mjs:215-228` | 完整 | 进程内缓存，`refreshAnchorOverrides()` 清 |
| CM-CORE-005 | 精确子串锚点全量替换 | `lib/core/verify.mjs:57-70` | 完整 | `[实测]` 3 处命中 → 3 处替换 |
| CM-CORE-006 | RegExp 锚点替换（保留 `$1..$9`） | `lib/core/verify.mjs:38-56` | 完整 | `[实测]` |
| CM-CORE-007 | 命中数契约 `expect` | `lib/core/verify.mjs:40-45,60-65` | 完整 | `[实测]` 不符则整条该文件拒写 |
| CM-CORE-008 | `marker` 单数幂等标记 | `lib/core/shared.mjs:171` | 完整 | — |
| CM-CORE-009 | `markers` 全中 / `markersAny` 任一 | `lib/core/shared.mjs:166-170` | 完整 | `[实测]` |
| CM-CORE-010 | `forbid` 反向标记（优先于 markers） | `lib/core/shared.mjs:165` | 完整 | `[实测]` |
| CM-CORE-011 | `skipIfMarked` 短路 | `lib/core/verify.mjs:24-26` | 完整 | `[实测]` |
| CM-CORE-012 | CRLF 保留 | `lib/core/verify.mjs:27,85` | 完整 | `[实测]` |
| CM-CORE-013 | YAML `//` → `#` 注释改写 | `lib/core/shared.mjs:243-272` | 完整 | `[实测]` |
| CM-CORE-014 | YAML 无缩进 identity 锚点跳过 | `lib/core/shared.mjs:236-241`、`lib/core/verify.mjs:35` | 完整 | `[实测]` |
| CM-CORE-015 | `#42` 现代设置 API 专用分支 | `lib/core/shared.mjs:84-109`、`lib/core/verify.mjs:10` | 完整 | 含 `SETTINGS_LEGACY_API` 抛错 |
| CM-CORE-016 | `#90` steering 迁移守卫 + 头注释 | `lib/core/verify.mjs:72-84`、`lib/steering.js:35-76` | 完整 | 部分命中整体放弃 |
| CM-CORE-017 | 目标文件表（74 个键 → 物理路径） | `lib/core.js:2859-3126` | 完整 | `[实测]` 74 键 |
| CM-CORE-018 | 目标文件过滤（不存在的键不登记） | `lib/core.js:2818-2839` | 完整 | — |
| CM-CORE-019 | npm 嵌套布局重复副本登记 | `lib/core.js:2847-2857` | 完整 | 4 个 `*-nested` 键 |
| CM-CORE-020 | 逐补丁 apply 主循环 | `lib/core.js:3485-3605` | 完整 | — |
| CM-CORE-021 | 写前 profile 快照（失败不阻断） | `lib/core.js:3467-3476` | 完整 | — |
| CM-CORE-022 | 缺失原件从 bak 还原 | `lib/core.js:3477` → `2540-2587` | 完整 | — |
| CM-CORE-023 | 升级后刷新陈旧 bak | `lib/core.js:3478` → `2658-2699` | 完整 | — |
| CM-CORE-024 | 备份（`wx` 占位 + 原子拷贝，永不覆盖） | `lib/core.js:2700-2735` | 完整 | — |
| CM-CORE-025 | 回滚（用户 patch 层只删 bak、无 bak 不删目标） | `lib/core.js:2746-2799` | 完整 | — |
| CM-CORE-026 | 多宿主 apply + 最差状态合并 | `lib/core.js:1854-1896`、`1814-1837` | 完整 | — |
| CM-CORE-027 | 宿主枚举（显式优先，`discover` 才扫桌面安装） | `lib/core.js:1783-1812` | 完整 | — |
| CM-CORE-028 | 备份失败即整批取消 | `lib/core.js:1868-1875` | 完整 | 含只读 Linux 提示 |
| CM-CORE-029 | 状态回读（逐文件 detail） | `lib/core.js:3848-3948` | 完整 | 10 种状态 |
| CM-CORE-030 | 状态折叠优先级 | `lib/core.js:3931-3944` | 完整 | — |
| CM-CORE-031 | 漂移分桶 + 重锚建议 | `lib/core.js:3721-3784`、`3663-3719` | 完整 | — |
| CM-CORE-032 | 补丁开关（`tuning.json` 三档） | `lib/core.js:3790-3829` | 完整 | `[实测]` `rollupPatchStatus` 真值表 |
| CM-CORE-033 | soft-ok 判定 | `lib/core/verify.mjs:102-119` | 完整 | — |
| CM-CORE-034 | 展示层分组与计数 | `lib/core/verify.mjs:144-196` | 完整 | `[实测]` |
| CM-CORE-035 | `patchStatusReady` | `lib/core/verify.mjs:198-205` | 完整 | `[实测]` 7 状态 × optional |
| CM-CORE-036 | `gatherState` 全量状态聚合 | `lib/core.js:4665-4760` | 完整 | 面板唯一数据源 |
| CM-CORE-037 | 插件 `apply()` 编排 | `lib/index.js:1484-1678` | 完整 | — |
| CM-CORE-038 | `llm/stream` 拒绝重试接管 | `lib/index.js:1487-1521` | 完整 | 默认关闭 |
| CM-CORE-039 | 19 条 exact + 3 条 prefix HTTP 路由 | `lib/index.js:2028-2731`、`2930-2960` | 完整 | 全部经来源校验 |
| CM-CORE-040 | 路由 disposer 逆序注销 | `lib/index.js:2016-2020,2732-2737` | 完整 | 防 reload 叠 handler |
| CM-CORE-041 | 3 个 agent 工具 | `lib/index.js:1710-1795` | 完整 | — |
| CM-CORE-042 | 3 个 slash 命令 | `lib/index.js:1800-1823` | 完整 | — |
| CM-CORE-043 | 启动自愈 `settleInstalledPatches` | `lib/index.js:901-1005` | 完整 | 默认不写宿主 |
| CM-CORE-044 | shim 注入（`dsh.cmd`/`dsh.ps1`/`dsh`） | `lib/core.js:3959-4138`、`4307` | 完整 | 只读前 512 字节判文本 |
| CM-CORE-045 | 分层自检 `BYPASS_LAYERS`（22 层） | `lib/selfcheck.js:17-62` | 完整 | — |
| CM-CORE-046 | `rollupLayers` 折叠规则 | `lib/selfcheck.js:126-172` | 完整 | `broken > unknown > pending > ok` |
| CM-CORE-047 | 自检四类汇总 host/runtime/config/layout | `lib/selfcheck.js:252-263` | 完整 | — |
| CM-CORE-048 | `tallyPatchStatus`（自检分母口径） | `lib/selfcheck.js:104-124` | 完整 | 与面板口径**不同** |
| CM-CORE-049 | 宿主布局证据（只读诊断，不供写入目标） | `lib/host-layout.js:25-136` | 完整 | — |
| CM-CORE-050 | `app/runtime` 链接修复（pnpm 入口） | `lib/runtime-layout.js:20-113` | 完整 | 保留旧链接、失败回滚 |
| CM-CORE-051 | asar 身份识别与解包决策 | `lib/extract-asar.js:214-253` | 完整 | `size + mtimeMs` |
| CM-CORE-052 | 侧目录解包 + 校验 + 提交 | `lib/extract-asar.js:417-507`、`lib/core.js:2026-2085` | 完整 | 失败保 `keepStage` |
| CM-CORE-053 | `prompt-inject.md` seed / 用户自改保护 | `lib/core.js:4506-4620` | 完整 | — |
| CM-CORE-054 | 审计日志（1 MB × 3 份，O_NOFOLLOW） | `lib/audit.js:10-135` | 完整 | 写失败静默一次 |
| CM-CORE-055 | 探针 nonce | `lib/probe.js:17-61` | 完整 | — |
| CM-CORE-056 | CLI 6 个模式 | `bin/dsh-purge.js:39-160` | 完整 | — |
| CM-CORE-057 | `multiHit` 字段 | `lib/patches/engine.mjs:305` | **缺失**（无实现） | 见 R1 |
| CM-CORE-058 | `rel` 字段 | 29 条补丁声明 | **缺失**（无消费者） | 见 R2 |
| CM-CORE-059 | `chainedAfter` 字段 | `lib/core.js:3737-3740`、`lib/patches/new-tools.mjs:2402` | 完整 | 唯一使用者 #88（`chainedAfter: 87`） |
| CM-CORE-060 | 跨进程 apply 互斥 | — | **缺失** | 见 R10 |

---

## 10. 未验证项

**本次实际执行过的验证（`[实测]` 来源）**

1. `node -e 'import("./lib/patches/index.mjs")'` → `ALL_PATCHES.length === 88`，字段集 30 个，`optional` 49 / 必需 39。
2. 直接调用 `applyReplacementsToText` 13 组构造输入，覆盖：多处命中全量替换、`expect` 相符/不符、整条回退、`skipIfMarked`、RegExp `$1`、CRLF、YAML 注释、bare identity 跳过、空 pattern / 非字符串 replace、正则重复调用。
3. 直接调用 `patchApplied` 6 组，覆盖：`markers` 全中、`markersAny`、`forbid` 优先、`marker` 单数、`replace` 首行 60 字符边界（30 字符 → `false`，60 字符 → `true`）、首行极短（`"a"`）与首 60 字符相同但尾部不同两种假阳性。
4. 直接调用 `rollupPatchStatus` 8 组真值表、`patchStatusReady` 7 状态 × optional、`applyOverrides` 2 组、`patchReplacements` 2 组。
5. 静态解析 `targetFiles()` 提取 74 个键 → 首候选路径。

**❓未验证**

| 条目 | 缺什么才能验证 |
|---|---|
| ❓未验证：`applyPatches` 在真实宿主上的端到端行为（备份→写盘→报告） | 需要一份可写宿主 + 实际调用；本次为只读审计，未对任何宿主文件执行写入 |
| ❓未验证：`patchDrift` 的 `locateAnchor` 建议质量 | 需要一个真实漂移样本（官方升级后的文件）才能看 `snippet` 是否指向正确落点 |
| ❓未验证：`#71` 的 `import("yaml")` 在本机是否可解析 | 需运行 `node -e 'import("yaml")'` 于插件实际加载环境 |
| ❓未验证：`patchStatus` 的 `unknown` 分支在真实权限错误下的表现 | 需构造不可读目标文件 |
| ❓未验证：`settleInstalledPatches` 各返回值的实际触发（`already-clean` / `full-quit` / `reapplied`） | 需在真实桌面端重启若干次并读日志 |
| ❓未验证：`client.js` 中 12 个 UI 触点的**渲染字段**细节 | `client.js` 是压缩预构建产物，本次只按端点字符串定位行号，未逐字段追踪 props |
| ❓未验证：`selfCheck` 的 22 层在真实宿主上逐层 `state` | 需在已应用补丁的宿主上 `GET /dsh-purge/selfcheck` |
| ❓未验证：`Maintenance.backup` 的 profile 快照内容与回滚边界 | 属 `lib/community.js`，不在本次范围 |
| ❓未验证：与 safe 2.0.0 的任何差异 | 按任务要求，本节不做对比；safe 侧待 `04-safe-*.md` |
