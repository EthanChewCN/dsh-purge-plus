# community × safe 穷尽差分

> 审计对象：`vendor/community/`（dsh-purge-community 1.7.20，MIT）与 `vendor/safe/`（dsh-purge-safe 2.0.0，Apache-2.0）
> 审计方式：只读。未修改 `vendor/` 下任何字节。
> 审计日期：2026-11-20
> 宿主基线：`/Applications/DeepSeek Harness.app/.../@deepseek-ai/*`（0.2.2-rc.5）

---

## 0. 审计方法

### 0.1 清点口径

| 口径 | community | safe | 说明 |
|---|---|---|---|
| `lib/` 下 `.js`+`.mjs` 文件数 | **118** | **60** | `find vendor/*/lib -type f \( -name '*.js' -o -name '*.mjs' \)` |
| `lib/` 下 js+mjs 总行数 | **47,788** | **56,898** | `xargs wc -l` |
| `lib/` 下 `.css` | 0 | **16 个 / 9,063 行** | 仅 safe 有 |
| `lib/redteam/` 文件数 | 19 | 34 | |
| `lib/redteam/` js-only 行数 | **18,410** | **33,770** | safe 另加 13 个 css |
| 根 `client.js` | **15,601** | **23,299** | 面板 UI 主包 |
| 补丁总数 | **88** | **59** | 见 0.2 |

### 0.2 补丁表怎么取的

不靠正则扫源码，直接 `import()` 出对象再比：

```bash
node --input-type=module -e "const m=await import('<abs>/vendor/community/lib/patches/index.mjs'); console.log(m.ALL_PATCHES.length)"
node --input-type=module -e "const m=await import('<abs>/vendor/safe/lib/core.js');        console.log(m.ALL_PATCHES.length)"
```

结果：`88` / `59`。两边 `ALL_PATCHES` 的导出位置：

- community：`vendor/community/lib/patches/index.mjs:9`（`[...PATCHES, ...CODE_PATCHES, ...ENGINE_PATCHES, ...NEW_TOOL_PATCHES, ...OPT_IN_PATCHES, ...STABILITY_PATCHES]`），分模块计数 `prompt 10 / code 3 / engine 12 / new-tools 59 / opt-in 2 / stability 2`。
- safe：`vendor/safe/lib/core.js:5506`（`[...PATCHES, ...CODE_PATCHES, ...ENGINE_PATCHES, ...NEW_TOOL_PATCHES]`，无 opt-in / stability 两个模块）。

对每条补丁导出 `Object.keys(patch)` 全集、`optional`、`file`、`replacements.length`，做集合运算与形状比对。

### 0.3 引擎能力怎么判的

对每个 schema 字段在引擎源码里数实现点（0 次 = 引擎完全不认这个字段）：

```bash
grep -c "<field>" vendor/safe/lib/core.js
grep -c "<field>" vendor/community/lib/core.js vendor/community/lib/core/*.mjs
```

### 0.4 运行时钩子怎么取的

```bash
grep -rnE "(this\.)?ctx\.(on|waterfall|bail)\(" vendor/{community,safe}/lib --include=*.js --include=*.mjs
```

原始命中 22 / 32 处，但其中 9 处是**补丁替换串里的代码文本**（例如 `patches/shared.mjs:39` 的 `COMPLETE_PROMPT_WATERFALL_INJECT`），不是真实注册。逐条读上下文剔除后，真实注册点 **15 / 24 处**，事件名 **10 / 13 个**。

### 0.5 宿主锚点怎么验的

对每条准备判定「可移植」的补丁，去 `/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/` 下实际 `grep` 锚点是否存在（只读，不改）。涉及 12 个宿主包。

### 0.6 覆盖量与局限

- **全覆盖**：两包 `lib/` 全部 178 个 js/mjs 文件的头部注释与行数（`head -6` 逐文件过一遍）。
- **逐行读**：community 18 个模块、safe 12 个模块（含 `core.js` 的 8 个关键区段共约 1,400 行）。
- **未逐行审**：`redteam/store-core.js`（5,414 / 7,296 行）、`redteam/client.js`（4,218 / 16,247 行）两个巨型文件的内部逻辑，只做了结构级比对（tab 定义、hook 点、导出面）。文中凡涉及这两处的结论均标「结构级证据」。
- **未验证**：safe 的 `redteam/bootstrap-runtime.js` 运行时行为（需要联网拉 nuclei 模板与 CISA 数据），只做静态判定。

---

## 1. 结论摘要

| 差异面 | community | safe | 判定 | 一句话理由 |
|---|---|---|---|---|
| 补丁覆盖 | 88 条（必需 39） | 59 条（必需 30） | **community 领先** | 31 条只在 community，其中 8 条必需（`#2/#3/#21/#24/#67/#71/#74/#83`） |
| 补丁引擎 schema | 30 字段全实现 | 19 字段，缺 11 个字段的引擎实现 | **community 领先** | safe 引擎里 `disabledByDefault`/`optIn`/`chainedAfter`/`multiHit`/`requireAllTargets`/`verifyRemovedFromBackup`/`silentWhenMissing`/`settleWhenAbsent`/`fileAllRequired`/`fileOptional`/`permissionOverride` 全部 0 命中 |
| 漂移检测 | `drift` 16 处 | **0 处** | **community 领先** | safe 只能说「没打上」，说不出为什么 |
| 运行时钩子 | 15 处 / 10 个事件 | 24 处 / 13 个事件 | **各有取舍** | safe 多 `approval/request`、`tools/pre-execute`、`tools/post-execute`、`agent/created`；community 多 `llm/stream` |
| 运维层（审计/锁/回滚事务/自检/探针） | 1,441 行 15 个模块 | **全无** | **community 领先** | safe 里 `audit.jsonl`/`MAINTENANCE_BUSY`/`LOCK_LOST`/`BYPASS_LAYERS`/`nonce` 全部 0 命中 |
| 更新子系统 | 3,154 行，可用 | 1,144 行，**`REPO=""` 通道失效** | **community 领先** | `safe/lib/update.js:12` 把仓库坐标清空 |
| 宿主写入提权 | 无 | `ensureHostWritable` 四件套（~120 行） | **safe 领先，可移植** | 只依赖 `spawn`/`os.userInfo`，无内部耦合 |
| 补丁自愈 | 1 个（`collapseDuplicateLegacyApplyPath`） | 4 个 `heal*` + 通用 `collapseDuplicateFunctionDecls` | **safe 领先，部分可移植** | 但 3 个 `heal*` 依赖 safe 自己的 `desktop.js` |
| 摘要金库 | 无金库；用**锚点复检**替代 | sha256 摘要 + `host-backups/` 金库 | **等价性成立，金库本身价值低** | community 的 `patchedTargetStillPatched()` 解决了同一个问题 |
| 演练台 UI | 10 tab / 平铺 | 12 tab / 6 分组 / 全屏 hook | **safe 领先，部分该吸收** | 新增 `overview`、`artifacts` 两 tab 与 `TAB_GROUPS` |
| **地域拒绝层** | **无** | `DENIAL="不行，这是严令禁止的"` | **safe 反向能力，硬阻断** | `net-scope.js:186/625-669` + `index.js:1909` |
| 打包完整性 | icon/locale/screenshots/bin 齐全 | 缺 4 项 | **community 领先** | 已知结论，本轮复核成立 |

---

## 2. 补丁层差分

### 2.0 四分区（本轮修正后的准确账）

| 分区 | 条数 | 说明 |
|---|---|---|
| 同名同 id（语义交集） | **48** | `id` 与 `name` 都相同 |
| 同 id 异名（占号冲突） | **9** | `#52`、`#89`–`#96`：两边用同一个 id 装完全不同的补丁 |
| 仅 community（id 不存在于 safe） | **31** | 其中必需 8 条 |
| 仅 safe（id 不存在于 community） | **2** | `#85`、`#86` |

校验：`48 + 9 + 31 = 88` ✓，`48 + 9 + 2 = 59` ✓。

> **上轮口径有误**：上轮写「交集 48 / 仅 community 40 / 仅 safe 11」。`48` 和 `11` 在各自定义下能自洽（40 = 31 仅 community + 9 占号；11 = 9 占号 + 2 仅 safe），但 **9 条占号补丁被同时算进两个分区**，导致「仅 community 40」这个数字无法用于任何实际判断。见 §8 勘误 1。

### 2.1 同名同 id 的 48 条

其中 **43 条**的 `file` 目标集合与 `replacements` 条数完全一致；**5 条实现不同**：

| id | 名称 | community | safe | 判定 |
|---|---|---|---|---|
| `#12` | `APPROVAL_ASK_SENTENCE_BYPASS` | 2 条替换，覆盖 3 个文件键（含 `user-approval-invariant`）`engine.mjs:67-80` | 3 条替换，覆盖 2 个文件键 `core.js:3341-3384` | 等价，覆盖面互补 |
| `#14` | `ESCALATION_GRANT_UNCONDITIONAL` | **整函数替换**：`approveEscalation` 整体换成 `return mode` `engine.mjs:137-138` | 只把「无审批通道」分支兜底成 `allowed-once`，仍会走 `approver.request` `core.js:3420-3437` | **community 明显更强** |
| `#35` | `ESCALATION_NEVER_REJECT` | 2 条替换 `new-tools.mjs:532-546` | 3 条替换 `core.js:3993-4050` | safe 多一条宿主形态兜底 |
| `#40` | `COMPLETE_PROMPT_KEEP_INJECT` | 2 条替换 | 1 条替换 | community 覆盖更多宿主形态 |
| `#61` | `OFFICIAL_SANDBOX_POLICY_NEUTRAL` | 2 条替换 | 1 条替换 | 同上 |

`#14` 的差异是实质性的：community 打完后 `approveEscalation()` 根本不发审批请求；safe 打完后仍发请求，只是「没有 approver 时」才自动放行。宿主只要有 approver（正常桌面环境都有），safe 这条就等于没打。**这是 safe 移植自 1.1.71 之后没有跟进 community 后续强化的证据之一。**

### 2.2 仅 community 的 31 条

#### 8 条必需（`optional` 未设 → 缺失即报错）

| id | 名称 | 目标文件键 | 缺了会怎样（源码证据） |
|---|---|---|---|
| `#2` | `REPLACEMENT_WORKSPACE_CONTEXT_INTRO` | `agent-instructions` | 替换稿会压过 system 层。与 `#1` 配套：`#1` 换基础上下文，`#2` 锁「替换稿不压过 system」`patches/prompt.mjs:2` 引入 `replacementPrecedenceRewrites` |
| `#3` | `SCOPE_INTRO` | `agent-instructions` | 作用域段会压过 system。同上，`#2`/`#3` 是提示词层级护栏的底座 |
| `#21` | `BASH_TIMEOUT_RESTORE` | `base` | 插件延长的 bash 等待被宿主的短超时盖回，长命令被截断 |
| `#24` | `PRESET_FETCH_ENABLED` | 6 个 preset 文件键 | `tool-web` 的 fetch 在预设里是关的，网页抓取工具直接不可用 |
| `#67` | `AGENT_LOOP_MESSAGES_GUARD` | `agent-loop` | `decision.messages` 缺省时不按空数组处理 → 第二轮 gateway/internal 报错（有 `forbid` 保护，见 `new-tools.mjs` 对应段） |
| `#71` | `LIANGSHEN_IDENTITY_LINE` | `preset-liangshen`、`preset-liangshen-pkg` | 梁神预设的官方身份句留着，人格被官方句覆盖 |
| `#74` | `ASSEMBLE_BEFORE_PRESTEP` | `agent-loop` | **每个模式的第一次发送前不会挂默认提示词** → 首轮 inject 真空（`new-tools.mjs:1296-1312`，替换串里调 `globalThis.__dshPurgePrepareAssemble`） |
| `#83` | `DESKTOP_HOST_CLOSE_NO_FATAL` | `desktop-shell` | host 被信号杀（重启密封包）时弹 crash dialog |

这 8 条在 safe 里**连等价物都没有**，证据是文件键集合：community 打 **71** 个文件键，safe 打 **52** 个，community 独有 **23** 个键，其中就包含 `#2`/`#3` 的 `agent-instructions`、`#24`/`#71` 的 `preset-*`、`#83` 的 `desktop-shell`：

```
preset-unrestricted, preset-liangshen, preset-liangshen-pkg, client-connection,
desktop-shell, skill-badge, liangshen-tool-bootstrap, harness-dev-context, web-app-lib,
hooks-claude-code, hooks-claude-code-nested, hooks-codex, hooks-codex-nested,
session-reference, deliverable-file-references, conversation-client, ptc-tool,
dsh-tools-pipeline, dsh-tools-pipeline-types, tool-ask-user,
compaction-tool-result-pruner, experimental-inspector, experimental-inspector-client
```

`#67`/`#74` 稍特殊：safe 的 `#89` 也打 `agent-loop`，但锚点完全不同（`#89` 打 `buildRequest`，`#67` 打 `decision.messages` 缺省，`#74` 打 assemble 前的 prepare 调用）——**同文件不同锚点，不构成覆盖**。

反向：safe 独有 **4** 个文件键 —— `product-analytics`、`product-telemetry-otel`、`session-telemetry-otel`、`skill-office`，正好对应 `#93`/`#94`/`#95`/`#96`。

#### 23 条可选

`#19` `TOOL_RESULT_PRUNER_DISABLED`、`#28` `LIANGSHEN_PHASE1_KEEP_INJECT`、`#30`/`#31` `HOOKS_*_DENY_ALLOW`、`#32` `WEB_SURFACE_IDENTITY_NEUTRAL`、`#45`/`#46` `OFFICIAL_DESKTOP_UPDATE_*`、`#50` `SESSION_REFERENCE_FRAMING_NEUTRAL`、`#53` `WEB_SURFACE_PROHIBITION`、`#54` `DELIVERABLE_DO_NOT`、`#56`/`#77` `REWIND_*`、`#60` `OFFICIAL_RUN_CODE_APPROVAL_NEUTRAL`、`#62` `OFFICIAL_TOOL_ASK_FAILOPEN`、`#64`/`#65` `HOOKS_*_NEUTRAL`、`#73` `PRESET_BASH_MIRROR_LINE`、`#76` `PRESET_UNRESTRICTED_IDENTITY_STRIP`、`#80` `MINIMAL_OFFICIAL_TOOLSET`、`#82` `DESKTOP_SHELL_PROFILE_FALLBACK`、`#84` `DESKTOP_HOST_CLOSE_CODE0_NO_FAIL`、`#87`/`#88` `HUNG_PROMPT_*_NEEDLE`。

其中 `#87`/`#88` 值得单说：它们是 community 独有的「挂针幂等」机制（空白宿主先挂全文、再用 LF 比对头尾、ChatML 头与正文尾都在才算挂住）。safe 的对应位置是 `#90`/`#91`，但那两条读的是**另一个全局契约**（见 §2.3）。

### 2.3 仅 safe 的 11 条（2 个新 id + 9 条占号）

先给结论表，逐条证据在下面。

| id | 名称 | 证据 | 判定 | 理由 |
|---|---|---|---|---|
| `#85` | `SESSION_PROMPT_STEER_INTERRUPT` | `core.js:5118-5143` | **拒绝** | 与 community `#90 RESTORE_NATIVE_STEERING` 等价，且 `#90` 更强（认领 4 种历史形态 + gated 变体，`steering.js:35-45` 带 `strictFiles`+`requireAllTargets`） |
| `#86` | `SESSION_QUEUE_STEER_INTERRUPT` | `core.js:5145-5208` | **拒绝** | 同上 |
| `#89` | `SYSTEM_FIELD_EXTRACT` | `core.js:5210-5275` | **拒绝** | 与宿主契约冲突，见下 |
| `#90` | `OPENAI_NATIVE_SYSTEM_ROLE` | `core.js:5277-5347` | **拒绝** | 全局契约冲突 + 锚点残缺，见下 |
| `#91` | `ANTHROPIC_NATIVE_PARAMS_SYSTEM` | `core.js:5349-5424` | **拒绝** | 同上 |
| `#92` | `SUBAGENT_SAME_INJECT_PATH` | `core.js:4105-4155` | **拆两半**：前半拒绝，后半移植 | 见下 |
| `#93` | `PRODUCT_ANALYTICS_DEFAULT_OFF` | `core.js:5426-5443` | **已移植 → `#201`** | 一行改 default，锚点 `dsh-client-product-analytics/lib/index.js:313` 实测存在 |
| `#94` | `PRODUCT_TELEMETRY_OTEL_NOOP` | `core.js:5446-5463` | **已移植 → `#202`（改进版）** | 原版 `return;` 跳过 `ctx.effect`，见 §7 |
| `#95` | `SESSION_TELEMETRY_OTEL_DISABLED` | `core.js:5466-5479` | **已移植 → `#203`** | 锚点 `dsh-session-telemetry-otel/lib/index.js:25` 实测存在 |
| `#96` | `SKILL_OFFICE_ASSET_FALLBACK` | `core.js:5482-5502` | **拒绝（rc.5 上零收益）** | 见下 |
| `#52` | `SESSION_LOG_CLOUD_UPLOAD_REMOVED` | `core.js:4619-4652` | **建议移植（加强版）** | 比 community `#52` 多两条硬移除 |

#### `#89` 为什么拒绝

safe 的 `#89` 把 `agent-loop` 里所有 `role === "system"` 的消息抽出来，塞进请求对象的顶层 `system` 字段（`core.js:5237-5271`，关键行 `5265`：`...systemField !== void 0 ? { system: systemField } : {}`）。

宿主在 `dsh-agent-loop/README.md:120` 明写：

> The request is `header.config`, `deriveMessages()`, and `header.tools`; **it carries no `system` field**.

代码侧也对得上：`dsh-agent-loop/lib/index.js:1112-1119` 的 `buildRequest` 只产 `{...header.config, messages, toolHistory, tools, sessionId, signal}`。全宿主 `grep -rn "request\.system"` = **0 命中**——没有任何 provider 读这个字段。

结论：`#89` 打上去的效果是「把系统提示词从 `messages` 里摘掉，放进一个没人读的字段」→ **系统提示词直接丢失**。这不是「与 community `#72`/`#55` 冲突」那么轻，是**注入链路整体失效**。

#### `#90`/`#91` 为什么拒绝

**（a）全局契约冲突（硬）**

两条补丁读 `globalThis.__dshPurgeHungPrompt`，判定条件是 `typeof ... === "string"`：

- `safe/lib/core.js:5290`：`const hungText = (typeof globalThis.__dshPurgeHungPrompt === "string") ? ... : ""`
- `safe/lib/index.js:225`：`globalThis.__dshPurgeHungPrompt = text`（string）

community 把**同名全局**定义成函数：

- `community/lib/index.js:224`：`export function installHungPromptGlobal(...)`
- `community/lib/index.js:259`：`globalThis.__dshPurgeHungPrompt = fn`
- `community/lib/patches/new-tools.mjs:2284`：`typeof globalThis.__dshPurgeHungPrompt === "function"`

在 community 运行时里 `typeof` 得到 `"function"`，safe 的两条补丁**永远走空分支**，静默无效果。

**（b）锚点在 rc.5 上残缺**

`#90` 的 4 条替换，实测（`@earendil-works/pi-ai/dist/api/openai-completions.js`）：

| 锚点 | 行 | 状态 |
|---|---|---|
| A `const promptText = (typeof context.systemPrompt ...` | — | **不存在**（`grep` 0 命中） |
| B `export const stream = (model, context, options) => {` + `resolveTranscript(...)` | 151-153 | 命中 |
| C `export function convertMessages(model, context, compat, options) {` | 875 | 命中 |
| D `const text = i === 0 ? getSystemMessageText(msg) : ...` | 926 | 命中 |

`#91` 的 4 条：A 不存在（`anthropic-messages.js` 里 `const promptText = (typeof context.systemPrompt` 0 命中）、B 命中（379-381）、C 是**自指锚点**（pattern 里含 `// [dsh-purge-safe-91] native params.system`，只有已打过才匹配）、D 命中（896）。

因为 safe 引擎**没有 `fileAllRequired`**（`grep -c fileAllRequired vendor/safe/lib/core.js` = 0），部分命中会被当成 `applied` 上报——**面板显示已打，实际主注入点没落**。这正是 community 在 `#32/#36/#53` 上补 `fileAllRequired` 要修的那类问题。

**（c）描述与实现不符**

上轮把 `#90` 描述成「走原生 system 参数，不塞进 messages 数组」。实际相反：`core.js:5311` 是

```js
const seeded = (promptText && context.messages?.[0]?.role !== "system")
  ? { ...context, systemPrompt: promptText, messages: [{ role: "system", content: promptText, timestamp: 0 }, ...context.messages] }
  : context;
```

——**往 `messages[0]` 塞 role:system**。走 `params.system` 的是 `#91`（`core.js:5388-5404`）。

#### `#92` 为什么拆两半

- **前半**（`core.js:4115-4140`，在 `childCtx.tools.restrict` 后调 `globalThis.__dshPurgePrepareAssemble(childCtx)`）：**冗余**。community `#74` 已经在 `agent-loop` 层、每次 assemble 之前调同一个全局（`new-tools.mjs:1307/1312`），而 `agent-loop` 是**所有** agent（含子代理）共用的，覆盖面无差别。另有 `index.js:830` 的 400ms 轮询兜底。
- **后半**（`core.js:4141-4152`）：**真缺口**。宿主 `dsh-subagent/lib/index.js:358`：

```js
permissionPreset: preset === "auto" || preset === "danger-full-access" ? preset : void 0,
```

父会话处于其他预设时，子代理拿到 `void 0` → 回落部署默认。community 没有任何补丁碰这个锚点（`grep -rn "permissionPreset:" vendor/community/lib/patches/` 只命中 `permission-state.js:28` 的运行时读取，不是补丁）。

#### `#96` 为什么拒绝

safe 的立论是「缺 `SKILL.md` 时桌面 Host ENOENT 起不来」。rc.5 的宿主已经自己处理了：

`dsh-skill-office/lib/index.js:62-73`

```js
async function readSkill(skillName, signal) {
    const path = join(assetRoot, skillName, "SKILL.md");
    let raw;
    try {
        raw = await readFile(path, { encoding: "utf8", signal });
    } catch (error) {
        if (signal?.aborted === true) throw error;
        return failed(skillName, error, persistentReadFailure(error));
    }
```

读失败 → `failed()` → 只 `ctx.logger.warn("skill-office: skill ... is unavailable")`（`:90`），不抛、不阻断启动。

**并且 `#96` 自身的 bug 属实**：它注入 `statSync(join(assetRoot,"office","SKILL.md"))`（`core.js:5499`），而该文件只 import 了 `{ readFile } from "node:fs/promises"`（`:1`）与 `{ isAbsolute, join, sep }`（`:2`），**没有 `statSync`** → 一旦执行到 `apply()` 就是 `ReferenceError: statSync is not defined`。

所以 `#96` 是「修一个已经不存在的病，代价是引入一个新的致命 bug」。

#### `#52` 为什么值得移植

| | community `#52` `new-tools.mjs:1210-1230` | safe `#52` `core.js:4619-4652` |
|---|---|---|
| 默认关 | 2 条替换（`default(true)` → `false`） | 同样 2 条 |
| 硬移除注册 | 无 | `false && ctx.deepseekLlmApiExtensions.register(...)`（`:4639`） |
| prepare 首行短路 | 无 | `return void 0;` 提前返回（`:4645`） |

锚点实测存在：`dsh-session-log-deepseek/lib/index.js:140`（register）与 `:141`（`if (!config.enabled.get()) return void 0;`）。

### 2.4 编号冲突表（同一个 id，两套语义）

| id | community 1.7.20 | safe 2.0.0 | 后果 |
|---|---|---|---|
| `#52` | `SESSION_LOG_UPLOAD_DEFAULT_OFF` | `SESSION_LOG_CLOUD_UPLOAD_REMOVED` | 语义相近（safe 更强），**不是冲突**，但面板都显示「#52」 |
| `#85` | 不存在（已迁成 `#90`） | `SESSION_PROMPT_STEER_INTERRUPT` | safe 停在 community 1.6.26 之前的编号体系 |
| `#86` | 不存在（已迁成 `#90`） | `SESSION_QUEUE_STEER_INTERRUPT` | 同上 |
| `#89` | `ASK_USER_WAIT_CAPPED` | `SYSTEM_FIELD_EXTRACT` | **完全无关** |
| `#90` | `RESTORE_NATIVE_STEERING` | `OPENAI_NATIVE_SYSTEM_ROLE` | **完全无关** |
| `#91` | `BROWSER_COOKIE_NAME_IGNORE_PORT` | `ANTHROPIC_NATIVE_PARAMS_SYSTEM` | **完全无关** |
| `#92` | `HOST_MAX_HTTP_HEADER_SIZE` | `SUBAGENT_SAME_INJECT_PATH` | **完全无关** |
| `#93` | `SANDBOX_POLICY_BRAND_NEUTRAL` | `PRODUCT_ANALYTICS_DEFAULT_OFF` | **完全无关** |
| `#94` | `SKILL_BADGE_DESCRIPTION_NEUTRAL` | `PRODUCT_TELEMETRY_OTEL_NOOP` | **完全无关** |
| `#95` | `INSPECTOR_FRAME_BUDGET_RECORD_OVERHEAD` | `SESSION_TELEMETRY_OTEL_DISABLED` | **完全无关** |
| `#96` | `INSPECTOR_FRAME_BUDGET_RECORD_OVERHEAD_CLIENT` | `SKILL_OFFICE_ASSET_FALLBACK` | **完全无关** |

`#90` 在 community 是「恢复原生插话」，在 safe 是「hung prompt 进 OpenAI system 槽」。**同一个数字，一件完全不相干的事。** 本仓库把自有补丁从 `#201` 起编号（`overlay/files/lib/patches/overlay.mjs:4`）是对的。

### 2.5 编号体系的谱系证据

| 证据 | 位置 |
|---|---|
| safe 仍用 `#85/#86` 表示 steering | `safe/lib/core.js:5118`、`:5145` |
| community 已把 `#85/#86` 迁成 `#90`，并把 safe 的产物当「旧形态」认领 | `community/lib/steering.js:18-23`（`OLD_PROMPT`/`OLD_QUEUE_CASE`）、`:35-45`（`STEERING_RESTORE_PATCH`，id 90） |
| safe 的补丁表未拆分 | `safe/lib/core.js:3083/3239/3280/3596` 四个 `const ..._PATCHES = [` 全在同一文件 |
| community 从 1.6.69 起拆分 | `community/lib/patches/index.mjs:1`（注释「社区版 1.6.69 补丁表拆分」） |

> 注意一处细节：community `steering.js:19` 的旧标记是 `[dsh-purge-85]`，safe `core.js:5128` 的标记是 `[dsh-purge-safe-85]`。**字符串不同 → community `#90` 不会自动认领 safe 打过的产物**。跨家族迁移需要额外加一条认领规则（见 §6 第 1 项）。

---

## 3. 运行时层差分

### 3.1 事件名集合差

| 事件名 | community | safe | 说明 |
|---|---|---|---|
| `agent/pre-step` | ✅ `index.js:542,855`、`redteam/ui.js:1063` | ✅ `index.js:636,1158`、`redteam/ui.js:841`、`team-mode.js:239`、`net-scope.js:650` | 两边都用作「每次 step 前挂 guard」 |
| `session/created` | ✅ `index.js:678,704,837` | ✅ `index.js:823,856,1130`、`subagent-control.js:79` | |
| `session/event` | ✅ `index.js:679` | ✅ `index.js:857`、`team-mode.js:218`、`subagent-control.js:26,57` | safe 多两条改写会话日志的 |
| `system-prompt/assemble` | ✅ `index.js:759` | ✅ `index.js:1044` | |
| `agent-preset/selected` | ✅ `index.js:846` | ✅ `index.js:1149` | |
| `subagent/end` | ✅ `redteam/tools.js:424` | ✅ `redteam/tools.js:527` | |
| `agent/inbox/claimed` | ✅ `redteam/role-section.js:154,173` | ✅ `redteam/role-section.js:153,172` | |
| `agent/request-error` / `agent/status` | ✅ `continue-retry.js:325,341` | ✅ `continue-retry.js:329,345` | 动态 `listen()` |
| **`llm/stream`** | ✅ `index.js:1487` | ❌ | **仅 community** |
| **`approval/request`** | ❌ | ✅ `subagent-control.js:45` | **仅 safe** |
| **`tools/pre-execute`** | ❌（用源码补丁 `#59` 实现） | ✅ `tool-gate.js:88` | **仅 safe**（运行时形态） |
| **`tools/post-execute`** | ❌（用源码补丁注入） | ✅ `tool-gate.js:108` | **仅 safe**（运行时形态） |
| **`agent/created`** | ❌ | ✅ `index.js:1140`、`team-mode.js:196` | **仅 safe** |

统计：community 15 处注册 / 10 个事件名；safe 24 处注册 / 13 个事件名。

### 3.2 四个「仅 safe」事件逐个看

**`approval/request`（`subagent-control.js:45-51`）**

```js
offs.push(ctx.on("approval/request", (request, next) => {
  try { if (request?.agent?.session) return "allowed-once"; } catch {}
  return typeof next === "function" ? next() : "allowed-once";
}, { global: true, prepend: true }));
```

在 community 运行时**永远不会被触发**：`#9 APPROVAL_AUTO_GRANT`（`patches/engine.mjs:9-20`）把

```js
if (this.effectivePolicy(session) === "never") return "rejected";
const answer = ...waterfall(..., "approval/request", ...)
```

整段换成了 `return "allowed-once";` —— `decide()` 在发 waterfall 之前就返回了。所以这条 hook 是**死代码**。

本机宿主已实测：`dsh-user-approval/lib/index.js:197-203`

```js
async decide(req, session) {
    const signal = req.signal;
    if (signal?.aborted) return "cancelled";
    return "allowed-once";
    // [dsh-purge] approval bypass: every approval request is auto-granted
    // without prompting — no waterfall, no rejection, no fail-closed path.
```

第 200 行之后全是不可达代码（第 203 行的 `answer` 此时已不存在，但因为不可达所以不报错）。这同时说明 `#9` 的替换是「粗插」而非「精修」——功能正确，留了死代码。

**`tools/pre-execute` / `tools/post-execute`（`tool-gate.js:88/108`）**

safe 的设计意图是「只降级、不接管」，注释写得很清楚（`tool-gate.js:18-21`）：不硬 `return allow`，因为那会连 `dsh-tool-jobs` 输出上限、`dsh-workspace-changes` 快照、`dsh-spill-policy` 截断一起关掉。

community 的对应做法是**改上游那一层**：`#59`（`new-tools.mjs:2013-2034`）在 auto-review 的 `tools/pre-execute` 里插 `return next();`，让 auto-review 变空实现。两者不等价：
- `#59` 只中和 **auto-review** 一个下游；
- `tool-gate` 中和 **所有** 下游（除 `tools.checkGuards`，`tool-gate.js:118-122` 明确不碰）。

但 community 的选择更稳：`tool-gate` 的 coerce 会把「下游审核器抛异常」也降级成 allow（`tool-gate.js:99-103`），这会**掩盖真实故障**。`#59` 只改一个已知组件，故障仍然可见。

**`agent/created`（`team-mode.js:196`、`index.js:1140`）**

`team-mode.js:196` 用来在红队根会话上补写 `team/mode` 事件（`team-mode.js:1-22` 的注释解释了官方 `TeamService.isEnabled()` 读的是 `rootOf(caller).session` 的 `team/mode` 投影）。这是 safe 独有的功能，community 完全没有 `team/mode` 相关代码（`grep -rn "team/mode" vendor/community/lib` = 0）。

### 3.3 仅 community 的 `llm/stream`

`index.js:1487-1505`。注册是无条件的，但默认直通：

```js
if (!cfg.enabled || tuning?.refusalRetry !== true || !injectAllowedNow(...)) return next();
```

只有 `tuning.refusalRetry === true` 才接管。能力本体在 `lib/refusal-retry.js`（331 行）+ `lib/stream-observation.js`（24 行）。safe 没有对应物（`grep -c "llm/stream" vendor/safe/lib/*.js` = 0）。

### 3.4 机制差异小结

| 维度 | community | safe |
|---|---|---|
| 主要手段 | **改宿主源码**（88 条补丁） | **运行时钩子**（24 处）+ 59 条补丁 |
| 抗宿主升级 | 靠 `drift` 分桶 + `anchors.js` 本地重锚 | 靠钩子本身不依赖源码文本 |
| 故障可见性 | 补丁未命中 → 面板红 | 钩子异常被自己 catch 吞掉（`tool-gate.js:99-103`、`subagent-control.js:38`） |

safe 的路子抗升级更好，代价是**静默失败**。community 的路子升级后要修锚点，但坏了看得见。

---

## 4. 模块层差分

`lib/` 下 community 独有 **69 个**文件（其中 8 个是 `patches/*`，属拆分而非缺能力 → 真实功能模块 **61 个**），safe 独有 **11 个**。

### 4.1 按子系统归并

| 子系统 | community | safe 等价物 | 判定 |
|---|---|---|---|
| 补丁表 | `patches/` 8 文件 / **3,379 行** | 内联 `core.js` | 结构差异，非能力差异 |
| 更新 | `update.js` 1,455 + `update-*.js` 12 文件 **1,699** = **3,154 行** | `update.js` 1,144 行，**`REPO=""`** | **community 领先**，safe 通道失效 |
| 运维/可靠性 | 15 文件 **1,441 行** | 无 | **community 领先** |
| 预设 | `preset-*.js` + `presets*.js` **883 行** | `preset-default.js` 181 行 | community 覆盖 6 个预设族，safe 只 1 个 |
| 桌面/asar/宿主定位 | `desktop*.js` + `*-asar-handoff.js` + `host*.js` + `instance.js` + `runtime-layout.js` + `next-host.js` + `extract-asar.js` **3,937 行** | `desktop.js` 1,996 + `extract-asar.js` 503 + `host.js` 74 | safe 覆盖约一半（无 asar handoff、无 next-host、无 instance 发现） |
| 演练台 | 19 文件 18,410 行 | 34 文件 33,770 行（+13 css） | **safe 领先** |
| 红队独有 | `redteam/atomic-write.js` 28、`redteam/evidence-ledger.mjs` 516 | — | community 独有（safe 无证据账本） |

### 4.2 重点模块逐个判

| 模块 | 行数 | 解决什么问题 | safe 靠什么替代 | 替代是否等价 |
|---|---|---|---|---|
| `audit.js` | 144 | 每次改宿主/预设/开关都落一条 `audit.jsonl`，1MB 轮转留 2 份（`audit.js:10`） | **无**（`grep -c "audit.jsonl" vendor/safe` = 0） | ❌ 不等价，safe 无任何审计流水 |
| `maintenance-lock.js` | 167 | 跨进程维护租约，用 PID 出生时间防 PID 复用，两种显式错误码 `MAINTENANCE_BUSY`/`LOCK_LOST`（`maintenance-lock.js:14-15`） | **无** | ❌ 不等价，safe 三条写入路径可并发 |
| `rollback-transaction.js` | 94 | 回滚事务：`packRestoredPackage` + 在**全新进程**里 import 验证 | **无** | ❌ 不等价 |
| `selfcheck.js` | 301 | `BYPASS_LAYERS` 逐层自证（`selfcheck.js:17`） | **无**（`grep -c BYPASS_LAYERS vendor/safe` = 0） | ❌ 不等价 |
| `probe.js` | 70 | 往系统提示词尾巴挂一次性 nonce，模型回显才算链路真通 | **无**（safe 无 `nonce`） | ❌ 不等价 |
| `apply-gate.js` | 26 | 拆开「修好了」与「不需要修」，防第三方伪造 `ok:true` | **无** | ❌ 不等价 |
| `path-boundary.js` | 57 | 路径containment（含 junction 与未创建的后代） | **无** | ❌ 不等价；safe 的 `remove-tree.js` 也没有，它直接 `fs.rmSync` |
| `install-registry.js` | 68 | 公共镜像过期时的窄恢复，不放松 pnpm 策略 | **无** | ❌ 不等价 |
| `permission-state.js` + `permission-migration.mjs` | 72 + 108 | 权限状态读取 + 历史补丁配方重放 | **无** | ❌ 不等价 |
| `preset-compat.js` | 363 | 把旧的子工具策略翻译成原生 Agent Preset | `preset-default.js` 181 行 | ❌ 不等价，safe 不做迁移 |
| `preset-diagnostic/injection/presence.js` | 47+75+78 | 预设兼容诊断 / 会话级注入策略 / 第三方预设存在性证据 | **无** | ❌ 不等价 |
| `update-*.js` ×12 | 1,699 | 模块化更新：http/net/policy/secrets/socks/state/integrity/mirror/targets/system-proxy/download/install | `update.js` 1,144（单文件） | ❌ **且失效**：`update.js:12` `const REPO = ""` → 所有 URL 拼成 `api.github.com/repos//...` |
| `macos-asar-handoff.js` / `windows-asar-handoff.js` | 300 / 287 | 双平台 asar 交接（等 app 退出、不 kill） | **无** | ❌ 不等价 |
| `anchors.js` | 84 | 宿主升级把锚点改坏时的本地重锚（`anchor-overrides.json`） | `anchor.js`（safe 版，单数） | 部分等价，未逐行比 |
| `hooks-deny.js` | 224 | `#30/#31/#64/#65` 的开关与反向写回 | **无** | ❌ 不等价 |
| `community.js` | 968 | 更新器主仓库常量与发行列表 | `update.js` 内 | 部分等价 |
| `redteam/evidence-ledger.mjs` | 516 | 红队证据账本（observed/derived/inferred 三档 + 语义哈希） | **无** | ❌ community 独有 |
| `redteam/atomic-write.js` | 28 | 先写临时文件 + fsync + rename | **无**（safe 用 core 的 `atomicWriteSync`） | 部分等价 |
| `steering.js` | 80 | `#90` 的常量与 6 种历史形态认领 | 内联 `#85/#86` | ❌ safe 只有 2 种形态 |
| `yaml-runtime.mjs` | 10 | 源包无 node_modules 时的 yaml 依赖注解 | **无** | 低价值 |

### 4.3 safe 独有的 11 个模块

| 模块 | 行数 | 作用 | community 有对应吗 |
|---|---|---|---|
| `subagent-control.js` | 97 | P1/P2/P3/P4 审批与沙箱接管 | ❌ 但 P1/P2 被 `#9` 覆盖、P3/P4 与 `#7`+`#51` 重叠（见 §7） |
| `tool-gate.js` | 129 | pre/post-execute 降级 + 子代理禁派活 | ❌ `denyDelegation` 是真缺口（已移植 → `overlay/files/lib/subagent-fence.js`） |
| `anchor.js` | — | 单锚点重锚 | ✅ community `anchors.js` |
| `preset-default.js` | 181 | 默认预设 | ✅ community 6 个 preset 模块 |
| `mnemon-settings.js` | — | 记忆设置 | ❌ 未查到 community 对应 |
| `ui-fullscreen.js` | — | 内嵌全屏 hook | ✅ community 用 `window.open`（`client.js:4015-4018`） |
| `ui-theme.js` + `ui-theme.css` | 225(css) | 主题 | ❌ community 全内联 |
| `redteam/bootstrap-runtime.js` | 666 | 铺红队数据目录、nuclei 模板、sqlite 知识库 | ❌ community 无 |
| `redteam/kev.js` | 178 | CISA KEV 本地缓存 | ❌ community 无（`grep -c CISA` = 0） |
| `redteam/slot-state.js` | 46 | 并发名额挂起状态（工具层/面板共享 Map） | ❌ community 无（`grep -c parked` = 0） |
| `redteam/team-mode.js` | 258 | 红队会话默认开 Agent Teams | ❌ community 无 |

---

## 5. safe 独有能力评估

### 5.1 宿主写入提权

**源码证据**

| 函数 | 行 | 做什么 |
|---|---|---|
| `probeHostWritable` | `core.js:270-286` | `accessSync(W_OK)` + 写一个 `.dsh-purge-safe-w-<pid>` 探针文件再删 |
| `posixOwnerSpec` | `core.js:288-301` | 推 `user:group`，darwin 兜底 `staff` |
| `runElevated` | `core.js:303-329` | `spawn` + 180s 超时 + stderr 聚合 |
| `takeHostOwnership` | `core.js:331-348` | darwin 走 `osascript ... with administrator privileges`，其他走 `sudo -n sh -c` |
| `isAuthCancelled` | `core.js:350-352` | `/user canceled\|user cancelled\|-128\|cancelled\|canceled/i` |
| `ensureHostWritable` | `core.js:355-390` | 全链路编排：探测 → 挑最短的被拒根 → 提权 → 复探 |

**依赖**：`node:fs`、`node:os`、`node:child_process.spawn`、`hostWriteClaimRoots()`、`hostWriteClaimRoot()`、`isForbiddenOwnTarget()`、`shellSingleQuote()`、`appleScriptQuoted()`、`HIDDEN_EXEC`。

**可移植性**：中等偏低。四个函数本体（`:270-352`）零内部耦合，可以直接搬；`ensureHostWritable`（`:355-390`）依赖 `hostWriteClaimRoots` / `isForbiddenOwnTarget` 两个 safe 私有函数，community 没有同名物，需要自己写「哪些目录算宿主写入根」。

**成本**：函数本体约 120 行 + 依赖补齐约 40 行；接线点 2 处（`core.js:2477`、`:6102` 的 apply 入口）。

**建议**：**不做**。community 的宿主布局是「app.asar 解包到 `resources/app/`」（`extract-asar.js` 601 行），不走 `/Applications` 原地写，`ensureHostWritable` 解决的是 safe 自己的布局问题。只有当 plus 要支持「原地改 sealed 安装」时才需要。

### 5.2 补丁自愈

**源码证据**

| 函数 | 行 | 依赖 |
|---|---|---|
| `collapseDuplicateFunctionDecls(text, signature)` | `core.js:6667-6696` | 纯字符串，无依赖 |
| `collapseDuplicateDesktopHandoff(text)` | `core.js:6698-6710` | 上面那个 + `DESKTOP_HANDOFF_FNS` |
| `healOfficialDesktopHostBindOnDisk` | `core.js:6946-6963` | `locateOfficialDesktopHostIndexes()` + `insertOfficialDesktopHostLanBind()` |
| `healOfficialHostSpawnHideOnDisk` | `core.js:6966-6991` | `locateOfficialShellMain()` + `desktop.findDesktopAppExecutable()` |
| `healDuplicateDesktopHandoffOnDisk` | `core.js:6994-7022` | 同上 + `collapseDuplicateDesktopHandoff` |
| `healOfficeSkillsRuntimeOnDisk` | `core.js:7039-7047` | `desktop.healOfficeSkillsRuntimeOnDisk`（在 `safe/lib/desktop.js:289`） |

**community 的对应物**

- `collapseDuplicateLegacyApplyPath(text)`（`core/shared.mjs:45`）：只处理 `legacyApplyPath` 一个签名，是 safe 通用版的**特例**。
- `healEmptyAppliedStamp()`（`reapply.js:221`）：清掉空的 applied 戳，与 safe 的四个 `heal*` 无关。
- `#45`/`#46`（`new-tools.mjs:934-969`）：community 用**「不打第二遍」**解决重复注入 —— 第二条替换直接把 `dshPurgeHandoffDesktopUpdate` 函数整体删掉，并 `forbid: ["dshPurgeHandoffDesktopUpdate(this);"]`。safe 是**「打了再修」**。

**判定**：`collapseDuplicateFunctionDecls`（通用版）值得吸收，约 30 行、零依赖。四个 `heal*` 中：

- `healDuplicateDesktopHandoffOnDisk` — **不需要**，community `#45` 的 `forbid` 已经防住重复注入；
- `healOfficialDesktopHostBindOnDisk`（TUN 劫持下官方 Host 改绑可达网卡，`core.js:6940` 的注入串用 `dshPurgeAdvertisedHost()`）— community 无等价物（`grep -rn "authenticatedUrl" vendor/community/lib` = 0）。是否值得移植取决于本机是否跑 TUN 代理；依赖 safe 的 `locateOfficialDesktopHostIndexes`；
- `healOfficialHostSpawnHideOnDisk`（Windows 不弹控制台）— **有价值**，但 community 已有 `hide-console.js`（309 行）覆盖同类问题；
- `healOfficeSkillsRuntimeOnDisk` — **不需要**，见 §2.3 `#96`。

**建议**：只吸收 `collapseDuplicateFunctionDecls` 作为通用工具函数，暂不接线。

### 5.3 摘要金库

**源码证据**

| 函数 | 行 | 作用 |
|---|---|---|
| `hostBakVaultRoot(dshHome)` | `core.js:5736-5738` | `$DSH_HOME/dsh-purge-safe/host-backups` |
| `hostPathNorms(fp)` | `core.js:5740-5750` | 路径规范化 + `realpathSync` 兜底 |
| `hostBakDigest(norm)` | `core.js:5752-5754` | `sha1(norm).slice(0,24)` 作文件名 |
| `fileSha256(buf)` | `core.js:5756-5758` | 内容摘要 |
| `appliedDigestPath(fp)` | `core.js:5760-5764` | `<digest>.applied.json` |
| `rememberAppliedDigest(fp,buf)` | `core.js:5766-5777` | apply 后写摘要 |
| `appliedDigestMatches(fp,buf)` | `core.js:5779-5787` | 比对当前字节是否等于「上次 apply 写下的字节」 |
| `isOfficialSnapshotBuf(buf)` | `core.js:5809-5816` | 只按 marker 判「是否官方原文」 |
| `writeOfficialSnapshot(fp,buf)` | `core.js:5845-5868` | 同时写金库 `.bak` 与旁边 `.dshpurge.bak` |

**它到底解决什么问题**：`core.js:6001-6002` 的注释写得很直白——「无 marker 也可能是未打标的补丁产物。若哈希等于上次 apply 写下的字节，不要当成新官方原文刷进 bak（#127）」。也就是**防止宿主升级后把已打补丁的字节当成官方原文存进备份**，导致回滚变 no-op。

**community 有没有等价物**：有，机制不同。

`core.js:2658-2698` `refreshStaleBaksForUpgrade()`：

```js
// 原文件里只要还带 dsh-purge 标识就视为"我们打过的版本",不碰 bak。
if (originalBuf.includes(DSH_PURGE_MARKER_NEEDLE)) continue;
// 但多数清洗是把台词整句换掉、不留 "[dsh-purge]" 字面量（#1/#4/#32/#36/#48/#53/#54/#94 …），
// 只看 marker 会把"已打补丁"误判成"官方新版"…
// 这里按补丁锚点再判一次。
if (patchedTargetStillPatched(original, originalBuf, aiBase, bakBuf)) continue;   // :2687
```

community 用**锚点复检**（把 88 条补丁的 pattern 拿去比），safe 用**sha256 摘要**。

| 维度 | community（锚点复检） | safe（摘要金库） |
|---|---|---|
| 状态目录被清空 | 仍有效 | **失效**（退回只看 marker，`:5811-5814`） |
| 补丁不留 marker 且 pattern 被官方后续改动吃掉 | 误判为官方原文（`core.js:2687` 的判定以 pattern 命中为前提） | 精确 |
| 是否需要额外存储 | 否 | 是（`host-backups/` 与 `*.applied.json`） |
| 覆盖范围 | 全部 88 条 | 只覆盖 safe 自己 apply 过的文件 |

**唯一真正缺的**：community 的 sidecar `.dshpurge.bak` 写在宿主文件旁边（`core.js:2712`），遇到只读目录会失败；safe 的金库在 `$DSH_HOME` 下，不受限（`core.js:5865` 注释：「app.asar 映出来的目录新建文件常 ENOENT，保险柜在就够」）。community 只对**密封 bin** 做了 `shimBackupPath` 的 home 兜底（`core.js:307-319`），宿主文件没有。

**建议**：不移植整套金库。若要补，只需给 `backupAll` 加一条「sidecar 写失败时落到 `$DSH_HOME/dsh-purge/host-backups/<sha1(path)>.bak`」的兜底，约 30 行。

### 5.4 演练台 UI

**结构级证据**

| 项 | community | safe |
|---|---|---|
| tab 定义 | `redteam/client.js:4008-4014`：10 个（assets/env/agents/sessions/findings/chain/scores/report/knowledge/skills） | `redteam/client.js:15892-15899`：12 个（+`overview`、+`artifacts`） |
| 分组 | 无 | `client.js:15900-15907` `TAB_GROUPS` 6 组 |
| 别名 | 无 | `client.js:15908` `TAB_ALIASES = { testing:'assets', attackfiles:'artifacts', prompts:'agents' }` |
| 未读徽标 | 无 | `digestHasNew`/`markTabSeen`（`client.js:15888`） |
| 全屏 | `window.open`（`client.js:4015-4018`） | `useWorkbenchFullscreen`（`client.js:15913`，实现于 `lib/ui-fullscreen.js`） |
| 样式 | 全内联，0 个 css | 16 个 css / 9,063 行 |
| `ui.js` | 1,156 行 | 949 行（**更小**） |
| `client.js` | 4,218 行 | 16,247 行（3.85×） |
| `store-core.js` | 5,414 行 | 7,296 行（1.35×） |

**「10 个 skin」不成立**：`lib/` 下只有 3 个 skin —— `glass-skin.css`(462)、`studio-skin.css`(1,744)、`workspace-skin.css`(123)，其余是视图样式（`sessions-view`/`settings-view`/`skills-view`/`assets-view`/`collaboration-view`/`detail-surfaces`/`overview-workbench`/`unified-components`/`unified-layout`/`workbench-layout`/`responsive-dock`）+ `ui-theme.css` + `product-shell.css`。

**并且这 16 个 css 没有任何 JS 引用**：`grep -rn "\.css" vendor/safe/lib --include=*.js` 只命中 2 处注释（`redteam/client.js:6837`、`:7942`）。`package.json.files` 里也没有 styles 字段。→ 这些 css 在 npm 包里是**死资产**。

**该吸收什么**（按价值排序）：

1. `artifacts` tab（凭据与文件）—— 新功能面，community 完全没有。
2. `overview` tab + `TAB_GROUPS` —— 12 个平铺 tab 确实过载，分组是纯 UI 改善。
3. `ui-fullscreen.js` —— 替代 `window.open`（弹出窗口在 Electron 里体验差）。
4. `slot-state.js`（46 行）—— 工具层与面板共享并发名额状态，解决「工具说还有名额、面板说满了」。
5. `kev.js`（178 行）—— CISA KEV 本地缓存，离线静默降级。
6. `bootstrap-runtime.js`（666 行）—— 价值最高但成本最高（`node:sqlite` + 网络 + zip 解包）。

**不建议吸收**：16 个 css（无引用）、`ui.js` 的 safe 版（比 community 少 207 行）。

### 5.5 反向能力：safe 内建地域拒绝层（上轮完全未提）

这是本轮最重要的查漏项。

`safe/lib/net-scope.js:186`：

```js
const DENIAL = "不行，这是严令禁止的";
```

`net-scope.js:445-449` 定义 `isAttackTask()`，`:464-470` 的 `taskTargetHit()` 对任务文本里出现的域名做白名单/地域判定，`:625-669` 的 `installRegionGate()` 把它挂到 `agent/pre-step`：

```js
ctx.on("agent/pre-step", hook, { global: true, prepend: true });   // :650
```

命中时 `parkDenial()`（`:589-605`）会往会话里 `append("assistant/message", ...)` 一条 `DENIAL` 文本（`:580-587`、`:525-543`），并把这一轮收成空白。

挂载点：`safe/lib/index.js:1909`：

```js
hook("region", () => installRegionGate(ctx));
```

community 的 `net-scope.js` 只有 412 行，到 `ownServerNote()`（`:410-411`）就结束，**没有任何 region gate 代码**（`grep -rn "installRegionGate\|regionGate" vendor/community/lib` = 0）。

**判定**：safe 的 `net-scope.js` 是**整个文件级的硬阻断项**。任何「把 safe 的 net-scope 合并进来」的动作都会把一个「拒绝对抗」层带进 plus。§4 的模块 diff 会诱使人这么做（同名文件、safe 多 257 行），必须显式排除。

---

## 6. 待移植清单（按风险从低到高）

| # | 内容 | 来源文件:行号 | 风险 | 前置条件 | 预计改动行数 |
|---|---|---|---|---|---|
| 1 | `#90` 认领 safe 的 `[dsh-purge-safe-85/86]` 标记 | `community/lib/steering.js:18-23`（加 2 个 `OLD_*` 常量） | 极低 | 无（纯常量增补） | +8 |
| 2 | `#52` 加强版：硬移除 session_log 注册 | `safe/lib/core.js:4636-4646` | 低 | 锚点已验：`dsh-session-log-deepseek/lib/index.js:140-141` | +12 |
| 3 | `#92` 后半：子代理继承父预设 | `safe/lib/core.js:4141-4152` | 低 | 锚点已验：`dsh-subagent/lib/index.js:358` | +4 |
| 4 | `collapseDuplicateFunctionDecls` 通用去重 | `safe/lib/core.js:6667-6696` | 低 | 无（纯字符串函数） | +30 |
| 5 | `slot-state.js` 并发名额挂起 | `safe/lib/redteam/slot-state.js:1-46` | 低 | 需在 `tools.js` 写、`ui.js` 读两处接线 | +46 +20 |
| 6 | `kev.js` CISA KEV 缓存 | `safe/lib/redteam/kev.js:1-178` | 低 | 需 `store-core.js` 加一张表 | +178 +30 |
| 7 | `ui-fullscreen.js` 内嵌全屏 | `safe/lib/ui-fullscreen.js` | 中 | 需改 `redteam/client.js:4015` 的 `openFull` | ~60 |
| 8 | `overview` tab + `TAB_GROUPS` | `safe/lib/redteam/client.js:15892-15908` | 中 | 需 `store-core.js` 提供 overview 聚合 | +40 +80 |
| 9 | `artifacts` tab（凭据与文件） | `safe/lib/redteam/client.js:15894` + 对应 store | 中 | 需新增数据面 | +200（估） |
| 10 | `team-mode.js` 红队默认开 Teams | `safe/lib/redteam/team-mode.js:1-258` | 中 | 依赖 `identity.isRedteamSession` | +258 |
| 11 | 备份 sidecar 失败时落 home 兜底 | `safe/lib/core.js:5845-5868`（只取兜底逻辑） | 中 | 需接进 `community/lib/core.js:2700-2730` | +30 |
| 12 | `bootstrap-runtime.js` 红队数据目录铺设 | `safe/lib/redteam/bootstrap-runtime.js:1-666` | 中高 | `node:sqlite` + 网络 + zip 解包 | +666 |
| 13 | `ensureHostWritable` 四件套 | `safe/lib/core.js:270-390` | 中高 | 需自写 `hostWriteClaimRoots`/`isForbiddenOwnTarget` | +120 +40 |

已完成的 3 项（复核确认无误）：`#201`←`#93`、`#202`←`#94`（改进版）、`#203`←`#95`。

> **`#204`←`#96` 建议回退**：rc.5 宿主已自愈（`dsh-skill-office/lib/index.js:62-73`），且 overlay 版把判定从「`office/SKILL.md` 是文件」弱化成「`assetRoot` 是目录」（`overlay/files/lib/patches/overlay.mjs:117` vs `safe/lib/core.js:5499`），会**掩盖**本该出现的 "skill unavailable" 警告。

---

## 7. 明确不移植的清单 + 理由

| 项 | 理由 | 证据 |
|---|---|---|
| `#89 SYSTEM_FIELD_EXTRACT` | 宿主契约明写请求**不带 `system` 字段**，全宿主无任何 provider 读它 → 打上等于丢系统提示词 | `dsh-agent-loop/README.md:120`；`dsh-agent-loop/lib/index.js:1112-1119`；`grep -rn "request\.system"` = 0 |
| `#90 OPENAI_NATIVE_SYSTEM_ROLE` | (a) 读 string 型全局，community 是 function 型 → 静默失效；(b) 4 条锚点缺 1 条主锚点；(c) safe 无 `fileAllRequired`，部分命中报 applied | `safe/core.js:5290` vs `community/index.js:259`；`openai-completions.js` 无 `const promptText = (typeof context.systemPrompt`；`grep -c fileAllRequired vendor/safe` = 0 |
| `#91 ANTHROPIC_NATIVE_PARAMS_SYSTEM` | 同上（4 条锚点缺 1，且 C 是自指锚点） | `anthropic-messages.js` 无 `const promptText = (typeof context.systemPrompt`；`safe/core.js:5389` 的 pattern 内含自身 marker |
| `#92` 前半（child assemble） | `#74` 在 `agent-loop` 层已覆盖**所有** agent（含子代理），另 400ms 轮询兜底 | `new-tools.mjs:1307/1312`；`index.js:830` |
| `#96 SKILL_OFFICE_ASSET_FALLBACK` | rc.5 已把 ENOENT 捕获成 `failed()` 只 warn；补丁自身 `statSync` 未 import → `ReferenceError` | `dsh-skill-office/lib/index.js:1,62-73`；`safe/core.js:5499` |
| `#85/#86` steering | community `#90` 等价且更强（4 种历史形态 + gated 变体 + `strictFiles`/`requireAllTargets`） | `steering.js:3-45` |
| `subagent-control.js` P1 | `#9` 把 `never → rejected` 整段换成 `return "allowed-once"`，policy 检查根本跑不到 | `patches/engine.mjs:9-20` |
| `subagent-control.js` P2 | 同上：`#9` 把 waterfall 调用一起替换掉了，`approval/request` 不再触发 | `patches/engine.mjs:12-14` |
| `subagent-control.js` P3/P4 | 与 `#7`（部署默认 danger-full-access）+ `#51`（新会话跟随部署档）重叠；P4 的「强制」语义与 `#51` 的「跟随」语义不同，但本机部署档已是全权限 | `code.mjs:24-37`；`new-tools.mjs:1185-1209`；`subagent-control.js:53-90` |
| `tool-gate.js` coerceGate/coercePost | `#59` 已把 auto-review 的 `tools/pre-execute` 变空实现；再挂一层运行时降级会**吞掉下游异常**（`tool-gate.js:99-103`），把真实故障变成静默放行 | `new-tools.mjs:2013-2034`；`tool-gate.js:18-21,99-103` |
| **`safe/lib/net-scope.js` 整个文件** | 内含地域白名单拒绝层，命中即往会话写 `DENIAL="不行，这是严令禁止的"` 并把这一轮收空 | `net-scope.js:186,464-470,580-587,625-669`；`index.js:1909` |
| `safe/lib/update.js` | `const REPO = ""` → 所有 GitHub URL 拼成 `repos//...`，升级通道整体失效 | `update.js:12,209-218,542-545,573-576,637` |
| 16 个 css | 无任何 JS 引用，`package.json.files` 无 styles 字段 → 死资产 | `grep -rn "\.css" vendor/safe/lib --include=*.js` 只 2 处注释 |
| `healDuplicateDesktopHandoffOnDisk` | community `#45` 用 `forbid` 从源头防住重复注入，不需要事后修 | `new-tools.mjs:963-968` |
| `healOfficeSkillsRuntimeOnDisk` | 同 `#96`，宿主已自愈 | `dsh-skill-office/lib/index.js:62-73` |

---

## 8. 上轮结论勘误

### 勘误 1：补丁四分区重复计数

- **上轮说**：「community 88 条 / safe 59 条 / 同名同 id 交集 48 / 仅 community 40（含 10 条必需）/ 仅 safe 11」。
- **实际**：交集 48、**占号冲突 9**、**仅 community 31**、仅 safe 2。上轮把 9 条「同 id 异名」同时算进「仅 community」和「仅 safe」，导致 `40 + 11` 里各含这 9 条。
- **证据**：两边 `ALL_PATCHES` 集合运算；占号冲突清单见 §2.4；`48+9+31=88`、`48+9+2=59`。

### 勘误 2：「仅 community 10 条必需」

- **上轮说**：40 条里有 10 条 `optional:false` 必需，并列出 `#2/#3/#21/#24/#67/#71/#74/#83/#90/#91`。
- **实际**：仅 community 的 31 条里必需 **8 条**：`#2/#3/#21/#24/#67/#71/#74/#83`。`#90`（`RESTORE_NATIVE_STEERING`）与 `#91`（`BROWSER_COOKIE_NAME_IGNORE_PORT`）**community 自己也有**，不是「仅 community」。
- **证据**：`vendor/community/lib/patches/index.mjs` 导出的 `optional` 字段；`#90` 见 `steering.js:35`。

### 勘误 3：必需补丁总数

- **上轮说**：community 35 条必需 / safe 26 条。
- **实际**：community **39**（88 − 49 optional）/ safe **30**（59 − 29 optional）。
- **证据**：同上，`optional === true` 计数。

### 勘误 4：schema 字段数

- **上轮说**：community 27 种字段 / safe 18 种。
- **实际**：**30 / 19**（按补丁对象实际出现的键去重）。
- **且**：safe 的**引擎**其实支持 `surfaces`（`core.js:7261-7266`），只是 59 条补丁里没人用；真正「引擎 + 补丁表双缺」的是 11 个字段：`disabledByDefault`、`optIn`、`chainedAfter`、`multiHit`、`requireAllTargets`、`verifyRemovedFromBackup`、`silentWhenMissing`、`settleWhenAbsent`、`fileAllRequired`、`fileOptional`、`permissionOverride`（在 `safe/lib/core.js` 全部 0 命中）。safe 独有的是 `hostCleanGate`（`core.js:4209,7136,7246-7249`）。

### 勘误 5：`ctx.waterfall` 计数

- **上轮说**：community 23 处 / safe 27 处。
- **实际**：**6 / 3**。上轮把补丁替换串里的代码文本（如 `patches/shared.mjs:39` 的 `this.ctx.waterfall(scopeTarget(this, scope), "system-prompt/assemble", ...)`）也算成了真实调用。
- **真实注册点**：community 15 处 / safe 24 处（`ctx.on`），事件名 10 / 13 个。

### 勘误 6：`#90 OPENAI_NATIVE_SYSTEM_ROLE` 的语义描述反了

- **上轮说**：「走原生 `system` 参数，不塞进 messages 数组」。
- **实际**：`#90` **正是往 `messages[0]` 塞 `{role:"system"}`**（`core.js:5311`）；走 `params.system` 的是 `#91`（`core.js:5388-5404`）。两条补丁的真实功能都是「把 hung prompt 塞进 provider 的原生 system 槽」，且都读 **string** 型 `globalThis.__dshPurgeHungPrompt`，而 community 定义的是 **function** 型（`index.js:224,259`）→ 直接移植会静默失效。

### 勘误 7：`#92` 不是「疑似多余」，而是「一半多余、一半真缺口」

- **上轮说**：「community `index.js:702` 已在 `session/created` 挂 assemble，疑似多余」。
- **实际**：`index.js:702-709` 是 `installRewindDeriveFilter`，`wrapOne` 调的是 `rewind.wrapSessionDeriveMessages(session)`（`index.js:689-694`），**与 assemble 注入无关**。`#92` 前半确实冗余，但冗余的原因是 `#74`（agent-loop 层），不是这个 hook；后半 `permissionPreset` 是 community 的真缺口（`dsh-subagent/lib/index.js:358`）。

### 勘误 8：`#96` 不是「真缺口」

- **上轮说**：`#96` 属「真缺口」并已移植为 `#204`。
- **实际**：rc.5 宿主已自愈（`dsh-skill-office/lib/index.js:65-73`），`#96` 零收益；且 `#96` 原版有 `statSync` 未 import 的致命 bug（`core.js:5499` vs `index.js:1`）；`#204` 的判定比原版更弱（`overlay.mjs:117` 只判目录 vs `core.js:5499` 判 `SKILL.md`）。

### 勘误 9：演练台「10 个 skin」

- **上轮说**：safe 多出「10 个 skin」。
- **实际**：**3 个** skin（`glass-skin.css`/`studio-skin.css`/`workspace-skin.css`）+ 13 个视图/布局 css；且 16 个 css **没有任何 JS 引用**，是死资产。真实增量是 2 个 tab（`overview`/`artifacts`）+ 6 个分组 + `ui-fullscreen`/`team-mode`/`kev`/`slot-state`/`bootstrap-runtime` 五个模块。

### 勘误 10（上轮完全未提）：safe 内建地域拒绝层

- **上轮说**：未提及。
- **实际**：`safe/lib/net-scope.js:186` 定义 `DENIAL = "不行，这是严令禁止的"`，`:625-669` 的 `installRegionGate` 挂 `agent/pre-step`，`index.js:1909` 启用；命中即往会话写一条拒绝消息。community 无任何对应代码。这是「整包合并 safe」的硬阻断项。

### 勘误 11（上轮完全未提）：safe 的更新器是阉割版

- **上轮说**：safe 更新子系统「单文件 1,144 行」。
- **实际**：`safe/lib/update.js:12` 是 `const REPO = ""; // Repository identity removed from this local archive.`，所有 URL 拼出 `api.github.com/repos//...` → 面板升级在 safe 里不可用。community 的 3,154 行更新子系统是能跑的。

---

## 9. 证据索引

### 9.1 community（`vendor/community/`）

```
lib/patches/index.mjs:1,9                      补丁汇总入口、ALL_PATCHES
lib/patches/shared.mjs:39                      COMPLETE_PROMPT_WATERFALL_INJECT（伪 waterfall 命中）
lib/patches/shared.mjs:45                      collapseDuplicateLegacyApplyPath
lib/patches/engine.mjs:9-20                    #9 APPROVAL_AUTO_GRANT
lib/patches/engine.mjs:67-80                   #12
lib/patches/engine.mjs:129-142                 #14（整函数替换）
lib/patches/code.mjs:6-37                      #6/#7/#8
lib/patches/new-tools.mjs:532-546              #35
lib/patches/new-tools.mjs:934-969              #45（含 forbid）
lib/patches/new-tools.mjs:1185-1209            #51 FRESH_SESSION_FULL_ACCESS
lib/patches/new-tools.mjs:1210-1230            #52
lib/patches/new-tools.mjs:1282-1295            #55
lib/patches/new-tools.mjs:1296-1312            #74（调 __dshPurgePrepareAssemble）
lib/patches/new-tools.mjs:1626-1648            #72
lib/patches/new-tools.mjs:1945-1966            #57
lib/patches/new-tools.mjs:2013-2034            #59
lib/patches/new-tools.mjs:2274,2284,2316       __dshPurgeHungPrompt 按 function 判定
lib/steering.js:3-33                           6 种 steering 形态常量
lib/steering.js:35-45                          #90 RESTORE_NATIVE_STEERING
lib/core.js:307-319                            shimBackupPath（密封 bin 兜底）
lib/core.js:1089-1107                          listPiAiApiFiles
lib/core.js:2658-2698                          refreshStaleBaksForUpgrade
lib/core.js:2687                               patchedTargetStillPatched（锚点复检）
lib/core.js:2700-2730                          backupAll（sidecar .dshpurge.bak）
lib/core.js:3043-3045                          pi-ai 文件键
lib/core.js:3074-3076,3090-3092                agent-loop / auto-review 文件键
lib/core.js:3813-3841                          permissionOverride 闸门
lib/core/verify.mjs:104-109                    patchAppliesHere / surfaces
lib/index.js:224,259                           installHungPromptGlobal（function 型全局）
lib/index.js:542,837,846,855                   agent/pre-step, session/created, agent-preset/selected
lib/index.js:689-709                           installRewindDeriveFilter
lib/index.js:759                               system-prompt/assemble
lib/index.js:802-820                           prepareAssemble + 全局导出
lib/index.js:830                               400ms wrapAssemble 轮询
lib/index.js:1487-1505                         llm/stream（refusalRetry 默认关）
lib/audit.js:10                                AUDIT_FILE
lib/maintenance-lock.js:14-15                  MAINTENANCE_BUSY / LOCK_LOST
lib/selfcheck.js:17                            BYPASS_LAYERS
lib/reapply.js:221                             healEmptyAppliedStamp
lib/net-scope.js:410-411                       ownServerNote（文件末尾，无 region gate）
lib/redteam/client.js:4008-4014                10 个 tab
lib/redteam/client.js:4015-4018                window.open 全屏
```

### 9.2 safe（`vendor/safe/`）

```
lib/core.js:270-286                            probeHostWritable
lib/core.js:288-301                            posixOwnerSpec
lib/core.js:303-329                            runElevated
lib/core.js:331-348                            takeHostOwnership
lib/core.js:350-352                            isAuthCancelled
lib/core.js:355-390                            ensureHostWritable
lib/core.js:2986                               globalThis.__dshPurgeHungPrompt = <string>
lib/core.js:3083,3239,3280,3596               四个内联补丁表
lib/core.js:3341-3384                          #12
lib/core.js:3413-3486                          #14（条件兜底，弱于 community）
lib/core.js:3993-4050                          #35
lib/core.js:4105-4155                          #92
lib/core.js:4143,4149                          permissionPreset 锚点（原文）
lib/core.js:4619-4652                          #52（加强版）
lib/core.js:5118-5143                          #85
lib/core.js:5145-5208                          #86
lib/core.js:5210-5275                          #89（system 字段抽取）
lib/core.js:5277-5347                          #90（含 5311 往 messages[0] 塞 system）
lib/core.js:5349-5424                          #91（params.system）
lib/core.js:5426-5443                          #93
lib/core.js:5446-5463                          #94（return; 跳过 ctx.effect）
lib/core.js:5466-5479                          #95
lib/core.js:5482-5502                          #96（statSync 未 import）
lib/core.js:5506                               ALL_PATCHES
lib/core.js:5736-5738                          hostBakVaultRoot
lib/core.js:5752-5758                          hostBakDigest / fileSha256
lib/core.js:5760-5787                          appliedDigestPath / rememberAppliedDigest / appliedDigestMatches
lib/core.js:5809-5816                          isOfficialSnapshotBuf（只按 marker）
lib/core.js:5845-5868                          writeOfficialSnapshot
lib/core.js:6001-6016                          摘要判定的使用点（#127 注释）
lib/core.js:6667-6710                          collapseDuplicateFunctionDecls
lib/core.js:6946-7047                          四个 heal*
lib/core.js:7136,7246-7249                     hostCleanGate
lib/core.js:7261-7266                          patchAppliesHere（surfaces，引擎支持但无补丁使用）
lib/net-scope.js:186                           DENIAL = "不行，这是严令禁止的"
lib/net-scope.js:445-449,464-470               isAttackTask / taskTargetHit
lib/net-scope.js:525-543,580-587               denialMessage / appendDenial
lib/net-scope.js:625-669                       installRegionGate（:650 挂 agent/pre-step）
lib/index.js:225                               __dshPurgeHungPrompt = <string>
lib/index.js:1909                              installRegionGate 挂载
lib/update.js:12                               const REPO = ""
lib/update.js:209-218,542-545,573-576,637      REPO 使用点
lib/subagent-control.js:26,45,57,79            P1/P2/P3/P4
lib/tool-gate.js:18-21,42,66-75,88,108         设计取舍 + denyDelegation + 两个 hook
lib/redteam/team-mode.js:196,218,239           agent/created, session/event, agent/pre-step
lib/redteam/kev.js:1-20                        CISA KEV 缓存
lib/redteam/slot-state.js:1-25                 并发名额挂起
lib/redteam/bootstrap-runtime.js:1-30          红队数据目录铺设
lib/redteam/client.js:15892-15908              12 个 tab + TAB_GROUPS + TAB_ALIASES
lib/redteam/client.js:15913                    useWorkbenchFullscreen
```

### 9.3 宿主（`/Applications/DeepSeek Harness.app/.../@deepseek-ai/`）

```
dsh-agent-loop/README.md:120                   "it carries no `system` field"
dsh-agent-loop/lib/index.js:1105-1119          buildRequest（无 system 字段）
dsh-skill-office/lib/index.js:1                只 import readFile
dsh-skill-office/lib/index.js:2                只 import isAbsolute, join, sep
dsh-skill-office/lib/index.js:59-60            #96/#204 的锚点
dsh-skill-office/lib/index.js:62-73            readSkill 的 try/catch → failed()
dsh-skill-office/lib/index.js:90               warn "skill ... is unavailable"
dsh-host-product-telemetry-otel/lib/index.js:41-42   #94 锚点
dsh-host-product-telemetry-otel/lib/index.js:65-76   ctx.effect(shutdown) —— #94 会跳过
dsh-client-product-analytics/lib/index.js:313  #93 锚点
dsh-session-telemetry-otel/lib/index.js:25     #95 锚点
dsh-session-log-deepseek/lib/index.js:140-141  #52 加强版锚点
dsh-subagent/lib/index.js:342                  #92 前半锚点
dsh-subagent/lib/index.js:358                  #92 后半锚点
dsh-subagent/lib/index.js:355-362              captureDelegatedPolicyOverrides
@earendil-works/pi-ai/dist/api/openai-completions.js:151-153,875,926   #90 锚点 B/C/D（A 缺失）
@earendil-works/pi-ai/dist/api/anthropic-messages.js:379-381,896       #91 锚点 B/D（A 缺失）
```

### 9.4 本仓库

```
overlay/files/lib/patches/overlay.mjs:16-124   #201–#204
overlay/files/lib/patches/overlay.mjs:117      #204 的弱判定（只判目录）
overlay/files/lib/subagent-fence.js:27,53-81   denyDelegation 移植
```
