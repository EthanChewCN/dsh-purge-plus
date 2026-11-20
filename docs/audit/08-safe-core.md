# 08 · safe 2.0.0 —— 补丁引擎 / 宿主集成 / 独有模块

> 审计对象：`vendor/safe`（`package.json` name = `dsh-purge-safe`，version = `2.0.0`）。
> 对照版本：`vendor/community`（`dsh-purge-community` 1.7.20）。
> 行号一律以本仓库当前快照为准。`[静态]` = 只读源码得出；`[实测]` = 本次实际 import / 调用验证过。
> 配套机读清单：[08-safe-patches.json](08-safe-patches.json)（59 条，`{id,title,target,anchorType,optional,purpose,line}`）。

---

## 0. 三条必须先纠正的前提

审计开始前被交代了三个前提，两个与快照不符，先钉死：

| 前提 | 实际情况 | 证据 |
|---|---|---|
| 「safe 的补丁 id 空间到 #201+」 | **不存在 200 段位**。`ALL_PATCHES` 共 **59** 条，id 落在 1–96 且有大量空洞（缺 2,3,19,20,21,24,27,28,30,31,32,41,44,45,46,50,53,54,56,60,62,64,65,67,71,73,74,76,77,79–84,87,88,97+）。最大 id = 96 | `core.js:5506`；`[实测]` 导入模块后 `ALL_PATCHES.length === 59`，id 集合 `1,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,22,23,25,26,29,33,34,35,36,37,38,39,40,42,43,47,48,49,51,52,55,57,58,59,61,63,66,68,69,70,72,75,78,85,86,89,90,91,92,93,94,95,96` |
| 「core.js 8361 行 / index.js 2965 行 / cordis.patch.yml 80 行」 | 一致 | `wc -l` |
| 「net-scope 669 行 / community 412 行；hide-console 361 / 309」 | 一致 | `wc -l` |

**结论：safe 的补丁表比 community 小（59 vs 88），且不是超集也不是子集。** `[实测]` 取两版 `ALL_PATCHES` 的 id 差集：共有 57 个 id，仅 community 有 31 个，**仅 safe 有 2 个（85、86）**；另有 **9 个 id 被两版用于完全不同的补丁**（52、89–96）。逐项见 §7，逐条见 §9.1。

---

## 1. 模块清单

`是否被 index.js 加载` 一列区分四种：`直接`（index.js 顶部 `import`）、`间接`（被 core/host/identity 等再导入）、`构建期`（只被 `scripts/build-client.mjs` 内联进浏览器包）、`子进程`（被 spawn 成独立 node 进程，不进宿主进程）。

| 文件 | 行数 | 一句话职责 | 是否被 index.js 加载 |
|---|---|---|---|
| `lib/index.js` | 2965 | 插件入口：Cordis 注册、12 个宿主 hook、14 条 HTTP 路由、4 个命令、3 个工具 | 自身 |
| `lib/core.js` | 8361 | 补丁表（59 条）+ 匹配/应用/回滚引擎 + 宿主定位 + 备份保险柜 + prompt-inject 生命周期 + shim 注入 | 直接（`index.js:5`） |
| `cordis.patch.yml` | 80 | bundle patch：关旧红队包、改 system-prompt 配置、insert 三个子插件 | 由宿主读取，非 JS 加载 |
| `lib/host.js` | 74 | 面（web/desktop）适配器选择、restart 调度入口 | 直接（`:6`） |
| `lib/rules.js` | 560 | 规则库（`$DSH_HOME/rules`）、AGENTS.md/CLAUDE.md 写入、workspace-policy、cwd 指令扫描 | 直接（`:7`） |
| `lib/skills.js` | 747 | 用户 Skill 库（`$DSH_HOME/skills`）读写、zip 导入、frontmatter 解析 | 直接（`:8`） |
| `lib/update.js` | 1144 | 版本/通道/在线更新实现；**本插件只用到 `localVersion()`** | 直接（`:9`，仅 `localVersion`） |
| `lib/reapply.js` | 435 | 应用戳（`installed-rev`/`applied.json`/`last-apply.json`）、启动自愈、重启冷却 | 直接（`:10`） |
| `lib/official-update.js` | 52 | 官方客户端升级后「补丁需回写」标记 | 直接（`:11`） |
| `lib/identity.js` | 927 | system-prompt 改写核心：section 过滤、注入折叠、红队分流、子代理判定 | 直接（`:12`） |
| `lib/preset-default.js` | 181 | 停用/卸载时清理指向本插件预设的 `selectedDefault` | 直接（`:20`） |
| `lib/capability-protocol.js` | 43 | 「先读 skill/MCP 目录再按任务选用」协议段文本 | 直接（`:21`） |
| `lib/anchor.js` | 116 | **尾部锚点**（system prompt 末尾的身份/格式锁），不是补丁锚点 | 直接（`:22`） |
| `lib/subagent-control.js` | 97 | 审批接管：never→ask、approval/request 恒放行、sandbox/mode 钉宽档 | 直接（`:23`） |
| `lib/tool-gate.js` | 129 | 工具前后 waterfall 降级旁路 + 子代理禁止再派活 | 直接（`:24`） |
| `lib/net-scope.js` | 669 | 地域/银行闸门：命中即写拒绝句并**吞掉整轮** | 直接（`:30`） |
| `lib/settle-policy.js` | 55 | 启动 settle 的延迟/可否重启/可否重打策略 | 直接（`:31`） |
| `lib/rewind.js` | 644 | `/rewind` 回退：撤回上一轮/上一步、草稿箱、fork 新会话 | 直接（`:26`） |
| `lib/continue-retry.js` | 364 | request-error 自动重试 + idle 自动续跑 | 直接（`:27`） |
| `lib/uninstall.js` | 313 | 卸载：回滚、清 profile、删插件树、排重启 | 直接（`:28`） |
| `lib/drill-grant.js` | 50 | 演练台授权落盘（`drill-grant.json`） | 直接（`:29`） |
| `lib/hide-console.js` | 361 | Windows 控制台隐藏、`DSH_HOME` 兜底、代理变量清理 | 直接（`:39`） |
| `lib/surface.js` | 197 | 宿主面探测（web/desktop/gui/tui）与适配器映射 | 间接（`host.js:1`、`core.js:31`） |
| `lib/desktop.js` | 1996 | 桌面宿主：asar 定位/解包/交换、进程树、重启助手 | 间接（`core.js:20`、`host.js:2`） |
| `lib/web.js` | 188 | 独立 web 面：重启/清理重启的 spawn 与就绪等待 | 间接（`host.js:3`） |
| `lib/extract-asar.js` | 503 | asar 抽象 fs（`hostFs`/`diskFs`）、解包到 side、交换 | 间接（`core.js:21`、`index.js:4`） |
| `lib/host-clean.js` | 14 | 「系统提示词是否已洗过」的单一判据 | 间接（`core.js:32`、`desktop.js:7`） |
| `lib/phase1-keep.js` | 21 | phase-1 白名单放宽到 `dsh-purge-safe*`/`dshpg-*` | 间接（`core.js:33`、`identity.js:36`） |
| `lib/table-read.js` | 18 | 解密「加密槽」出厂默认提示词 | 间接（`core.js:34`） |
| `lib/table-key.js` | 27 | 加密槽的密钥派生 + 封装（AES-256-GCM + deflate） | 间接（`table-read.js:4`） |
| `lib/asset-table.js` | 181 | 加密槽的密文/掩码/IV/TAG 常量表 | 间接（`table-read.js:3`） |
| `lib/mnemon-settings.js` | 55 | `mnemon.json`（`keepMnemon`）读写 | 间接（`identity.js:2`） |
| `lib/zip-extract.js` | 161 | 纯 JS + 系统 unzip 的 zip 解包（供 skills 导入） | 间接（`skills.js:7`） |
| `lib/ui-fullscreen.js` | 288 | `useWorkbenchFullscreen` React hook：站内全屏 + CSS 兜底 | **构建期**（`scripts/build-client.mjs:24` 内联进 `client.js`） |
| `lib/ui-theme.js` | 234 | `createProductTheme`：dusk/white/system 主题状态机 | **构建期**（`scripts/build-client.mjs:21`） |
| `lib/restart-desktop.js` | 670 | 桌面重启助手（等旧进程退出、杀进程树、重开 .app） | **子进程**（`desktop.js:911`、`:1348`、`:1777`） |
| `lib/restart-web.js` | 120 | 独立 web 重启助手（等端口释放、重新 spawn `dsh web`） | **子进程**（`web.js:151`） |
| `lib/uninstall-restart.js` | 76 | 卸载后重启助手 | **子进程**（`web.js:173`） |
| `lib/reapply-cli.js` | 5 | `reapplyInstalled()` 的 CLI 包装 | 子进程（`update.js:958`） |

合计 40 个文件、23 041 行（`wc -l vendor/safe/lib/*.js`）。

---

## 2. 数据模型

### 2.1 补丁定义对象（内存，非持久化）

`safe` 的补丁是纯字面量对象，字段全集（`[实测]` 对 59 条做字段普查）：

| 字段 | 类型 | 出现次数 | 语义 | 读它的地方 |
|---|---|---|---|---|
| `id` | number | 59 | 补丁编号，也是 `patch_status` 的键 | `core.js:7471` 起 |
| `name` | string | 59 | 符号名，上报给面板 `patch_names` | `index.js:2264` |
| `layer` / `layer_en` | string | 59 | 展示分组（`提示词`/`代码`/`工具`/`0.1.5 兼容`/`0.2.0 兼容`） | `index.js:2278` |
| `desc` | string | 59 | `中文 / English` 双写，中文段即面板标题 | `core.js:5521` |
| `file` | string \| string[] | 59 | `targetFiles()` 的键，一个补丁可跨多个文件 | `core.js:7143` |
| `replacements` | `{pattern, replace}[]` | 52 | 替换链；`pattern` 可为 string 或 RegExp | `core.js:7147` |
| `patterns` + `replace` + `marker` | string[] + string + string | 7 / 7 / 6 | 简化写法：每条 pattern 都用同一个 `replace` | `core.js:7147`（映射成 replacements） |
| `markers` | string[] | 53 | 判定「已应用」的子串；默认**全部**命中 | `core.js:7060` |
| `markersAny` | boolean | 14 | 改成「任一命中」 | `core.js:7066` |
| `forbid` | string[] | 3（#61 #69 #86） | 出现任一即判**未**应用（反向标记） | `core.js:7063` |
| `optional` | boolean | 29 | pattern 未命中不挡 Apply | `core.js:7274` |
| `skipIfMarked` | boolean | 21 | 已有标记且无残留原文时跳过替换（防叠层） | `core.js:7208` |
| `rel` | string[] | 19 | 面板/文档用的相对路径提示，**引擎不读** | —（仅 `core.js` 注释与构建脚本） |
| `strictFiles` | boolean | 2（#43 #70） | 文件在但原文不在 → 判 `pattern_not_found` 而不是 `skipped` | `core.js:7249` |
| `hostCleanGate` | boolean | 1（#40） | 未命中即判失败，且额外要求 `system-prompt/assemble` 在场 | `core.js:7250`、`7276` |
| `softSettle` | boolean | 1（#48） | 归入 `isLayoutSoftPatch`，未命中视为已到位 | `core.js:7121` |

`[实测]` 字段普查结果（59 条合计）：
`markers=53 replacements=52 optional=29 skipIfMarked=21 rel=19 markersAny=14 patterns=7 replace=7 marker=6 forbid=3 strictFiles=2 hostCleanGate=1 softSettle=1`。

**没有**以下 community 字段：`permissionOverride`、`surfaces`、`silentWhenMissing`、`disabledByDefault`、`optIn`、`multiHit`、`verifyRemovedFromBackup`、`chainedAfter`、`requireAllTargets`、`settleWhenAbsent`、`fileOptional`、`fileAllRequired`，以及 `replacements[].expect`（命中数契约）。

### 2.2 持久化对象

| 载体（文件/表） | 字段 | 类型 | 谁写 | 谁读 | 生命周期 |
|---|---|---|---|---|---|
| `<宿主文件>.dshpurge.bak` | 官方原文原始字节 | binary | `writeOfficialSnapshot`（`core.js:5845`） | `readOfficialSnapshot`（`core.js:5833`） | 首次 apply 时创建；`revertAll` 后保留（用作下次比对的官方基准）；`sanitizeDesktopCommandRuntimes` 会把密封 bin 里的 bak 迁出后删除（`core.js:7765`） |
| `$DSH_HOME/dsh-purge-safe/host-backups/<sha1(normpath)[:24]>.bak` | 同上（保险柜副本） | binary | `writeOfficialSnapshot`（`core.js:5845`） | `vaultBakCandidates`（`core.js:5795`） | 与 sidecar 同生命周期；用于宿主文件被整份替换（升级）后仍能回滚 |
| `$DSH_HOME/dsh-purge-safe/host-backups/<sha1>.applied.json` | `{path, sha256, at}` | JSON | `rememberAppliedDigest`（`core.js:5766`） | `appliedDigestMatches`（`core.js:5779`） | 每次成功写盘后覆盖 |
| `$DSH_HOME/dsh-purge-safe/installed-rev` | 上次应用时的插件版本 | text | `reapply.js:18` | `reapply.js:82` 起 | 每次 `markPatchesApplied` |
| `$DSH_HOME/dsh-purge-safe/applied.json` | `{sha, version, at, rev}` | JSON | `reapply.js:30` | `readAppliedStamp`（`reapply.js:82`） | 同上；空 sha 有专门自愈分支（`reapply.js:260`） |
| `$DSH_HOME/dsh-purge-safe/settle-restart.guard` | 上次 settle 重启时间 | text | `markSettleRestart`（`reapply.js:318`） | `shouldSkipSettleRestart`（`reapply.js:307`，窗口 180 s） | 防「应用→重启→再应用」死循环 |
| `$DSH_HOME/dsh-purge-safe/last-apply.json` | 上次 apply 的完整返回体 | JSON | `writeLastApply`（`reapply.js:42`） | `consumeLastApply`（`reapply.js:74`，TTL 15 min） | 宿主重启后面板仍能显示上次结果 |
| `$DSH_HOME/prompt-inject.md` | 注入正文（约 24 KB） | text | `seedPromptInjectAtBoot` / `saveOverrideContent`（`core.js:8121`、`8208`） | `readPromptInjectFileSync`（`core.js:2961`）→ `identity.js` | 启动 seed；用户改过则永不被覆盖（`isKeepableUserOverride`，`core.js:8027`） |
| `$DSH_HOME/dsh-purge-safe/override-state.json` | `{customized, explicitSave, hash, seedHash, updatedAt}` | JSON | `markOverrideCustomized`（`core.js:7988`） | `isUserCustomizedOverrideSync`（`core.js:8041`） | 每次保存/seed |
| `$DSH_HOME/net-scope-allow.txt` | 一行一个 host，可 `#` 注释、可 `user@host` | text | `writeAllowText`（`net-scope.js:381`） | `readAllowText`（`net-scope.js:373`），带 mtime 缓存（`net-scope.js:390`） | 用户手改或 `/own-servers` POST |
| `$DSH_HOME/dsh-purge-safe/drill-grant.json` | `{granted:true, at}` | JSON | `writeDrillGrant`（`drill-grant.js:26`） | `readDrillGrant`（`drill-grant.js:13`） | 卸载时 `clearDrillGrant` 删除 |
| `$DSH_HOME/dsh-purge-safe/mnemon.json` | `{keepMnemon:boolean}` | JSON | `saveMnemonSettings`（`mnemon-settings.js:38`） | `loadMnemonSettings`（`mnemon-settings.js:12`） | 缺省 `false` |
| `$DSH_HOME/dsh-purge-safe/last-cwd.txt` | 最近一次会话 cwd | text | `rules.writeLastCwd`（`rules.js:525`） | `rules.readLastCwd`（`rules.js:518`） | 每次 `session/created` / `session/event` |
| `$DSH_HOME/dsh-purge-safe/cwd-selections.json` | 勾选的 cwd 指令文件绝对路径数组 | JSON | `rules.toggleCwdSelection` | `rules.readCwdSelections`（`rules.js:494`） | 用户勾选 |
| `$DSH_HOME/dsh-purge-safe/workspace-policy.json` | `{policy: "fallback"\|"strict"\|"always"}` | JSON | `rules.writeWorkspacePolicy`（`rules.js:469`） | `rules.readWorkspacePolicy`（`rules.js:460`） | 用户切换 |
| `$DSH_HOME/rules/state.json` | 当前激活的规则 id + target | JSON | `rules.ensureInitialState` | `rules.resolveInjectText`（`rules.js:243`） | 规则库生命周期 |
| `$DSH_HOME/rules/<id>.md` / `<id>.json` | 规则正文 / 元数据 `{name,target}` | md / JSON | `rules.saveRule` | `rules.readRule` / `readRuleMeta` | 同上 |
| `$DSH_HOME/AGENTS.md` \| `CLAUDE.md` | 规则正文落地文件 | md | `rules.activateRule` | 宿主自身 | 激活即写；`resetToOriginal` 还原 |
| `$DSH_HOME/skills/<id>/SKILL.md` 或 `<id>.md` | Skill 文档（frontmatter + body） | md | `skills` | 宿主 skill 加载器 | 用户导入/创建 |
| `$DSH_HOME/skills/.backup/…` | 导入前备份 | binary | `skills.js:28` | 覆盖前还原 | 保留 |
| `profiles/<name>/cordis.patch.yml` | `selectedDefault:` 行 | YAML | `preset-default.js:57` | 宿主 | 仅在 `selectedDefault` 指向 `redteam` 时改写为 `standard` |
| `$DSH_HOME/.agent-presets/redteam/` | 插件自带预设目录 | dir | 安装/应用 | 宿主 | 卸载时 `removeStaleAgentPresetDir` 删除 |
| `$TMPDIR/dsh-purge-safe-desktop.log` | 诊断日志（2 MB 翻滚） | text | `purgeLog`（`index.js:253` 起） | 人工 tail | 长会话持续写 |
| `lib/asset-table.js` 常量（`SLOT/MASK/IV/TAG`） | 出厂默认提示词的密文 | base64 | 构建期 | `table-read.js:openSlot` | 只读；`[实测]` 解密后 24 298 字符，sha256 前 16 位 `e055d4046f3d3615` |

### 2.3 加密槽的结构（重新实现必须知道）

- `MIX` 是四段固定串拼接后 sha256：`"cordis.slot.v2"`、`"dsh-purge"`（由 charCode 数组拼出，避免明文出现在源码里）、`"surface:web|desktop"`、`"ov.table.1"`，以 `\x1e` 分隔，末尾再拼 `\x1e` + mask（`table-key.js:5`、`:13`）。
- `sealSlot(text)`：`deflate(level 9)` → `AES-256-GCM`（12 字节随机 IV）→ 返回 `{SLOT, MASK, TAG, IV}` 全 base64（`table-key.js:17`）。
- `openSlot()`：反向操作，任何异常返回 `""`（`table-read.js:6`）。
- **这不是加密保护，是混淆**：密钥材料的四段里三段是常量、第四段 `MASK` 与密文同文件（`asset-table.js`），读源码即可解。用途只是「让出厂提示词不以明文出现在包里」。

---

## 3. 业务逻辑（按入口）

### 3.1 入口：插件 apply（Cordis 装配）

**签名**：`export function apply(ctx, config)`（`index.js:1776` 处合并配置：`const cfg = { ...DEFAULTS, ...(config || {}) }`，`DEFAULTS` 在 `index.js:52-70`）。

**顺序**（`index.js:1850-1920`）：

1. `core.pinDshHome()` 钉住 `$DSH_HOME`，随后 `refreshHungOperator(home)` 把 `prompt-inject.md` 读热（`index.js:1852-1855`）。
2. `setTimeout(settleDelayMs(controlSurface()))`：桌面 4000 ms、其余 0 ms（`settle-policy.js:8`、`:26`）。回调里跑 `settleInstalledPatches` 与 `rules.ensureInitialState`（`index.js:1857-1876`）。
3. `applyHostHooks(ctx, cfg)`（`index.js:1889`），逐个 `try`，单个 hook 抛错只记日志（`index.js:1890-1897`）。

**12 个 hook**（9 个事件/提示词类在 `index.js:1908-1916`，3 个注册类在 `:1935`、`:1984`、`:2074`）：

| 序 | hook 名 | 实现 | 作用 |
|---|---|---|---|
| 1 | `identity` | `installIdentityOverride`（`index.js:990`） | 包 `ctx.systemPrompt.assemble`，把注入塞进 system prompt；挂 `system-prompt/assemble` waterfall；`pinSystemPromptReplace` |
| 2 | `region` | `installRegionGate`（`net-scope.js:625`） | 地域/银行闸门（见 §3.10） |
| 3 | `fresh-access` | `installFreshFullAccess`（`index.js:817`） | `session/created` 后微任务里把新会话沙箱档升级 |
| 4 | `cwd` | `installCwdCapture`（`index.js:833`） | 把 `session.header.cwd` 落到 `last-cwd.txt` |
| 5 | `mnemon` | `installMnemonMessageStrip`（`index.js:614`） | `agent/pre-step` 里过滤 mnemon 插件消息 |
| 6 | `prompt-sections` | `registerPromptSections`（`index.js:540`） | 注册 `dsh-purge-safe`（order `-100000`）、`dshpg-capabilities`（`-99999`）、可选 `dsh-purge-safe:post`（`postPromptOrder`，默认 5100）三个 section |
| 7 | `prompt-anchors` | `registerAnchor`（`anchor.js:70`） | 注册尾部锚点：section `dsh-purge-safe:anchor`（order 10150）+ 子会话 context `dsh-purge-safe:child-anchor`（order 235，`required:true`） |
| 8 | `subagent-control` | `installSubagentControl`（`subagent-control.js:16`） | 见 §3.12 |
| 9 | `tool-gate` | `installToolGateBypass`（`tool-gate.js:77`） | 见 §3.11 |
| 10 | `commands` | `index.js:1935` | 注册 `purge` / `rules` / `skills` / `rewind` 四个命令 |
| 11 | `tools` | `index.js:1984` | 注册 `purge_status` / `purge_apply` / `purge_revert` |
| 12 | `web` | `installWebServer`（`index.js:2182`） | 注册 14 条 HTTP 路由 |

**失败路径**：`isInactiveContextError`（`settle-policy.js:10`）命中时整段跳过（`index.js:1862`、`:1886`）；其它异常一律 `purgeLog("hook", ...)` 后继续（`index.js:1892`）。设计取向是「任何一个 hook 坏掉都不能阻止插件加载」。

**副作用**：注册 section / context / waterfall / 命令 / 工具 / 路由；启动 `settle` 定时器（`ctx.effect` 回收，`index.js:1877`）。

### 3.2 入口：`applyPatches(aiBase, patches, options)`

`core.js:7335`。这是补丁引擎主循环。

**前置**（`core.js:7336-7340`）：
1. `restoreMissingOriginalsFromBak(aiBase)`（`core.js:5922`）——目标文件消失或变成空文件时从 `.dshpurge.bak` / 保险柜拷回。
2. `refreshStaleBaksForUpgrade(aiBase)`（`core.js:5979`）——DSH 自升级后 `.bak` 仍是旧版原文时，把 `.bak` 刷成新官方原文。
3. `targetFiles(aiBase)`（`core.js:6225`）——解析 52 个 `file` 键到真实绝对路径。
4. `repairPluginCordisYaml()`（`core.js:7327`）——顺手清自己 `cordis.patch.yml` 里的裸 persona 标量。

**逐补丁判据**：

| # | 条件 | 结果 | 行号 |
|---|---|---|---|
| 1 | `!patchAppliesHere(p)` | 记 `status:"na"`，跳过 | `7342-7356` |
| 2 | `pathsOf(files,key).length === 0` | `missing += 1` | `7362-7365` |
| 3 | `options.preserveClientBundles && isWatchedClientBundle(fp)` | 只判定不写（`already` / `notFound` 计数） | `7378-7384` |
| 4 | `applyReplacementsToText(...).changed` | `saveText` 成功 → `applied += 1` + `rememberAppliedDigest`；字节相同 → `already += 1`；抛错 → `lastError = write_error:…` | `7386-7405` |
| 5 | 未变化 + `filePatchSettled` | `already += 1` | `7406-7407` |
| 6 | 未变化 + (`patchHasRemainingWork` 或 `strictFiles`) | `notFound += 1` | `7408-7409` |
| 7 | 未变化 + `hostCleanGate` 且文件含 `system-prompt/assemble` 且未应用 | `notFound += 1` | `7410-7411` |

**状态归一**：`rollupPatchStatus`（`core.js:7246`），优先级
`strictFiles&&lastError` → `strictFiles&&notFound` → `hostCleanGate&&notFound` → `applied>0` → `already>0 && (notFound===0 || layoutSoft)` → `missing===keyCount` → `lastError` → `notFound===0 → "skipped"` → `"pattern_not_found"`。

**副作用**：写目标文件（原子写 `atomicWriteFile`，`core.js:119`）、写 `<file>.dshpurge.bak` 与保险柜、写 `.applied.json` 摘要；每 6 条 `await sleepMs(0)` 让出事件循环（`core.js:7431`）。

**返回**：`[{patch_id, name, status, path, applied, already, missing}]`。

### 3.3 入口：`applyReplacementsToText(text, patch, fp)`

`core.js:7191`。**这是「匹配算法」的全部**。

1. `patch.id === 42` 时先做两步预修：`collapseDuplicateLegacyApplyPath`、`rewriteStaleLegacyApplyCall`（`7194-7203`）。
2. `skipIfMarked && patchApplied(source,patch) && !patchHasRemainingWork(source,patch,fp)` → 直接返回（`7208-7210`）。**注意这里的 `&& !patchHasRemainingWork`**：只看标记会把「后来补上的替换体」永久挡在门外。
3. CRLF 检测 → 统一转 LF 处理 → 结尾还原（`7211`、`7242`）。
4. YAML 文件且 `isBareIdentityNeedle(pattern)` → 跳过该条（`7218`）。
5. RegExp pattern：`cloneRegExp(pattern, true)` → `test` → `replace`（字符串形态调用，保留 `$1..$9` 展开语义）（`7222-7233`）。
6. 字符串 pattern：`out.includes(needle)` 才继续；`written.includes(needle) && out.includes(written)` → 跳过（插入型已写完，`7237`）；否则 `split(needle).join(written)`（`7238`）。
7. 返回 `{text, changed}`。

**`[实测]`**：
- #6 在 `policy = ["(deny file-write*)"];` 上 → `{"text":"policy = [\"(allow file-write*)\"];","changed":true}`
- #1 第一次 `changed:true`（929 字符），第二次 `changed:false`、长度不变 → **幂等**。
- 未命中 → `changed:false`，原文返回。

### 3.4 入口：`patchHasRemainingWork(text, patch, fp)`

`core.js:7091`。与 community 的语义不同（见 §7）。

逐条 `replacements`：
- YAML + 裸 identity → 跳过（`7097`）。
- RegExp → `matchesPattern` 命中即「有活要干」（`7099-7102`）。
- 字符串 → `!hay.includes(needle)` 则跳过；`needle === written` 跳过（空替换）；`written.includes(needle) && hay.includes(written)` 跳过（插入型已写完）；否则「有活要干」（`7103-7111`）。

### 3.5 入口：`patchStatus(aiBase)` / `gatherState(input)`

- `patchStatus`（`core.js:7471`）逐文件求 `filePatchOutcome`（`core.js:7133`）：`applied` / `pending` / `skipped`（`strictFiles` 时记 `unmatched`）。归并优先级：`pending>0` → `applied>0` → `unmatched>0` → `skipped>0` → `optional ? "na" : "missing_file"`（`7494-7500`）。
- `gatherState`（`core.js:8272`）：
  - `surface = input.surface ?? detectSurface()`；`aiBase = findAiBase({surface})`。
  - **无 aiBase 时全部 59 条记 `na`**（`8305-8308`）→ `patches_total = 0`。`[实测]` 在本仓库直接调用得 `total/applied/pending/skipped/na = 0/0/0/0/59`，`display_total = 0`。
  - 计数口径：`na`/`!patchAppliesHere` → `patches_na`；`applied` → `patches_applied`；`pending` → `patches_pending`；`skipped|missing_file|off` → `patches_skipped`；`patchStatusReady` 为真 → `patches_ready`（`8311-8325`）。
  - 展示层另算一套：`groupPatchesForDisplay`（`core.js:5546`）按 `PATCH_DISPLAY_GROUPS`（`core.js:5509`：`disclaimer:[1]`、`approval_sentence:[5,11,12]`、`approval_policy:[8,9,10]`）把 6 条合成 3 行，`tallyDisplayPatches`（`core.js:5574`）出 `display_applied/pending/skipped/ready/total`。
  - 同时返回 `shim_cmd/ps1/bin`（`shimFileStatus`）、`has_backup`、`override_status`、`asar_still_sealed`、`desktop_runtimes`。

**`patchStatusReady`（`core.js:8260`）**：`applied|already|off` → true；`hostCleanGate && (skipped|pending|pattern_not_found|unmatched)` → false；`skipped|missing_file` → true；`na` → false；`pattern_not_found && strictFiles` → false；`pattern_not_found && optional` → true；其余 false。

### 3.6 入口：`backupAll(aiBase)` / `revertAll(aiBase, options)`

- `backupAll`（`core.js:6029`）：遍历 `flattenTargetPaths(targetFiles(aiBase))`，**跳过** `profiles/*/cordis.patch.yml`（用户层，`isUserProfilePatchFile`，`core.js:5699`）；已有官方快照则重写一份；读不到「未被打过」的字节则记 `already patched, no official backup`；最后 `dropStaleUserProfilePatchBackups()` 删掉历史误建的 profile bak。
- `revertAll`（`core.js:6101`）：
  1. `ensureHostWritable`（`core.js:355`）失败 → 直接返回 `write_denied`。
  2. `restoreMissingOriginalsFromBak` + `healDuplicateDesktopHandoffOnDisk`。
  3. 先删所有 profile 层 bak（`6113-6124`）。
  4. 对每个目标：`preserveClientBundles` 且是 watched client bundle → 跳过；有官方快照 → 原子写回快照；**没有快照时绝不删文件**，若文件含 `dsh-purge-safe` 标记则按补丁**反拆**（`stripPurgePatchesFromText`，`core.js:6061`），否则 `skipped`（`6126-6160`）。
- `stripPurgePatchesFromText`：逆序遍历 `ALL_PATCHES`，只在 `written.includes("dsh-purge-safe")` 或该补丁 `patchApplied` 时才做 `written → needle` 反替换，RegExp pattern 一律跳过（`6061-6082`）。

### 3.7 入口：shim 注入

- 目标：`$DSH_HOME/bin/dsh`、`dsh.cmd`、`dsh.ps1`（`SHIM_NAMES`，`core.js:43`）。
- 注入体只有一件事：**没有 `DSH_HOME` 时向上找 `.dsh` 目录并导出**（`core.js:7547` node / `7593` cmd+ps1+sh）。**不再写 `DSH_PERMISSION_MODE`**（`hasLegacyPermissionPin` 专门识别并清除旧版残留，`core.js:7635`）。
- 插入位置：`cmd` 在 `@echo` 之后；`sh`/`node` 在 shebang 之后（`insertShimInject`，`core.js:7682`）。
- 状态：`shimIsPatched` 看是否含 `dsh-purge-safe shim`（`core.js:7694`）；`shimFileStatus` 返回 `missing|binary|patched|original`（`7703`）。
- 剥离：`stripShimInject`（`core.js:7644`）按 `begin`/`end` 行配对删除；**只有 begin 没有 end 时整份原文返回，不剥离**（`7668-7673`）。
- 密封 bin（桌面 `host-commands`）**不注入**（`patchShim` 开头 `core.js:7813`），且 `sanitizeDesktopCommandRuntimes`（`core.js:7765`）会把密封 bin 里的 `.dshpurge.bak` 先外迁到 `shimBackupPath` 再删（外迁失败就保留，`7737-7762`）。

### 3.8 入口：prompt-inject 生命周期

| 阶段 | 函数 | 判据 | 副作用 |
|---|---|---|---|
| 启动 | `seedPromptInjectAtBoot`（`core.js:8121`）→ `syncPromptInjectOnDiskSync`（`8085`） | `isKeepableUserOverride` 为真 → `keep`；磁盘 == 出厂 → `keep(current)`；否则原子写 | 写 `prompt-inject.md` + `override-state.json` |
| 面板打开 | `readOverrideForUi`（`core.js:8055`） | — | 返回 `{content, defaultContent, customized, usingDefault, path}` |
| 点保存 | `saveOverrideContent`（`core.js:8208`） | `normalize(incoming) && normalize(incoming) !== normalize(bundled)` 才算用户稿 | 直接 `open(w)` + `sync` 覆写；`markOverrideCustomized(..., {explicitSave:true})` |
| 点应用 | `commitOverrideOnApply`（`core.js:8182`） | 框里有用户稿 → 存；磁盘已有非默认稿 → 保留；否则 `seedPromptInjectAtBoot` | 决定「框里的稿」还是「加密槽默认」 |
| 强制恢复 | `installOverride(dshHome, force=true)`（`core.js:8147`） | `force` 绕过一切保留判断 | 写出厂默认 |
| 编辑 | `editOverride`（`core.js:8231`） | `$EDITOR` 支持带引号路径的 tokenizer | `spawn(..., {stdio:"inherit"})` |

**拒绝条件**：`rejectIfNeedPrompt`（`index.js:314`）在注入正文为空时返回 `{needPrompt:true, error: NEED_PROMPT_ERROR}`，`/apply` 与 `/override` 都以 400 返回（`index.js:2410`、`2542`）。

### 3.9 入口：`system-prompt/assemble` 改写

- 事件监听：`ctx.on("system-prompt/assemble", async (...args) => …)`（`index.js:1044`）。兼容两种签名：`args.length >= 3` 时取最后一参为 `next`，否则视为老签名（`index.js:1046`）。下游抛错时**吞掉**并回退到上游装配（`index.js:1066-1072`）。
- 方法劫持：`installAssembleGuard(prompt, rewriteFn)`（`identity.js:674`）把 `prompt.assemble` 的返回值 `slot.rewrite` 替换掉；**dispose 故意是 noop**（`identity.js:684-688`），否则 cordis 正常生命周期会把 `slot.rewrite` 回滚成 `null`，注入失效。
- 决策：`shouldInjectAssembly`（`index.js:229`）**恒返回 `mode:"full"`**，只在 `globalThis.__dshPurgeRetryPending` 时把 `lastRole` 标成 `retry`。也就是说 `anchorMode` 不控制「只挂锚点」，只控制尾部锚点文本是否为空（`anchor.js:54-61`）。
- 改写主体：`rewritePromptAssembly(assembled, fallbackInject, options)`（`identity.js:787`）：
  1. 遍历 sections，丢掉 `harness:identity` 与 `dsh-purge-safe:identity`；`dropMnemon` 时丢 mnemon 段；`dropWorkspaceBaseline` 时丢 workspace baseline 段（`792-800`）。
  2. 非插件段 → `stripHarnessPersona(text)`；插件段（`isPluginPromptSection`）收进 `purge`（`801-806`）。
  3. `redteam = isRedteamSession(...) || assemblyLooksRedteam(...)`；`redteamChild = redteam && isRedteamSubagent(...)`（`808-809`）。
  4. 正文 `injectText = collectInjectText(purge, fallbackInject)`（`810`）。
  5. 三种会话三种正文：非红队 → `withoutRedteamPreset`；红队子代理 → 只留角色稿 `insertRoleSection`；红队根 → 指挥稿 + 目标卡 + 角色稿（`839-848`）。子代理还要 `withoutTeamPolicy`（`851`）。
  6. `overlayOfficialIdentity(sanitizeAssemblySections(sections), cwd)` → `foldInjectIntoPersona(body, injectText)`（`853-854`）。
  7. tail 依次补 `dshpg-capabilities`（order 99999）与 `dsh-purge-safe:anchor`（order 100000）（`856-872`）——**必须排在数组最后**，因为 waterfall 返回的数组顺序就是渲染顺序。
  8. 返回**新对象**：`{...assembled, sections, contexts, tools, variables:{...priorVars, cwd}}`（`880-891`）。不原地改写，避免宿主复用对象导致多轮叠加。
- contexts 处理：`rewriteAssemblyContexts`（`identity.js:906`）整条删除 `approval:policy`、`sandbox:policy`、`subagent:delegation`（`DROP_CONTEXT_NAMES`，`identity.js:897-902`），但 `required === true` 的条目只改写不删——因为 `refreshContext()` 会重算并补回。

### 3.10 入口：`agent/pre-step` 地域/银行闸门（**反向能力**）

`installRegionGate(ctx)`（`net-scope.js:625`）。

**注册**：`ctx.on("agent/pre-step", hook, { global: true, prepend: true })`（`net-scope.js:650`）。挂不上时按 `0 → 50 ms → 200 ms` 退避重试 3 次（`654-666`），timer 全部 `unref()`。

**判据（逐条）**：

1. `Number(payload?.step) !== 1` → `forward()`（`629`）。只看每一步的第一步。
2. `task = currentTaskText(payload?.messages)`（`net-scope.js:505`）：
   - 从消息数组**末尾向前**找到最后一条 `role === "assistant" | "model"`，切在它之后（`507-514`）；
   - 每段过 `humanTaskText`（`493`）：`role` 非 `user` 丢；`source.kind` 非 `user` 丢；`looksLikeToolResult`（`486`：有 `toolCallId`/`tool_call_id`/`toolName`、`source.kind !== "user"`、或以 `Tool result`/`[tool`/`function_call`/`toolu_`/`call_` 开头）丢；以 `Current runtime context` 开头丢；剥掉 `<system-reminder>…</system-reminder>`。
3. `!task || !isAttackTask(task)` → `forward()`（`633`）。`isAttackTask`（`net-scope.js:445`）：先 `isBenignNetworkTopic`（`439`：命中 `NET_TOPIC` 且**不**命中 `ATTACK` → 视为良性），再 `ATTACK.test(text.slice(0, 100*1024))`。
4. `hit = await taskTargetHit(task)`（`634`）——`taskTargetHit`（`net-scope.js:464`）：
   - `hostsInTask(text)` 抽取 host（`451`：`collectFromText` + 一条带 CJK/`xn--` 的 labeled 正则）；
   - 逐个 host：`permittedHost`（在 `net-scope-allow.txt` 里）→ 跳过；`isOwnNetwork`（`localhost`/`.local`、IPv6 `::`/`::1`/`fc00::/7`/`fe80::/10`、IPv4 `0/8`、`10/8`、`127/8`、`169.254/16`、`172.16/12`、`192.168/16`、`>=224`）→ 跳过；`isIp` → 跳过；
   - `regionOfSuffix(name)` 命中 → `{label, kind:"domain"}`；`bankHit(name)` 命中 → `{label, kind:"bank"}`（`464-474`）。
5. `hit` 为空 → `forward()`。
6. `parkDenial(payload)`（`net-scope.js:589`）：
   - `sessionOf(payload)`（`518`：`payload.agent.session` 或 `payload.session`，必须有 `append`）；
   - `turn` 必须是安全整数且 `step === 1`，否则 `return false`（`591-593`）；
   - 依次 `session.append("user/message", msg, {surfaceOp:"append"})` → `session.append("step/start", {turn, step})` → `appendDenial` → `session.append("step/end", …)`；
   - 第一层失败时用「只开 step/start + 拒绝句」重试；两层都失败也必须补 `step/end`，否则孤儿步让宿主崩（`594-622`）。
7. 写成功 → **`return { kind: "enter", messages: [] }`**（`net-scope.js:641`）。

**这就是「吞掉整轮」的机制**：`agent/pre-step` 的返回决定这一步进入模型时带哪些消息。返回 `messages: []` 表示**用零条消息进入这一步**，模型请求因此不会携带用户那句话；与此同时 `appendDenial` 已经往会话里写了一条 `assistant/message`，其正文就是拒绝句。所以用户看到的是一条凭空出现的助手回复，模型从未被调用。

**拒绝文本**：`const DENIAL = "不行，这是严令禁止的"`（`net-scope.js:186`）。

**写入形状**（`denialMessage`，`net-scope.js:525`）：优先 `import("@deepseek-ai/dsh-llm").createAssistantMessage({content:[{type:"text",text:DENIAL}], source:{provider:"deepseek", model:"deepseek-chat"}})`；宿主包不在导入路径上时手写 `{id: randomUUID(), role:"assistant", content:[...], source:{kind:"model", …}}`（`525-543`）。

**stream 形状**（`denialChunks` / `denialStream`，`net-scope.js:552`/`564`）：4 个 chunk（`block-start` / `text-delta` / `block-end` / `finish{reason:"stop"}`），每个包成 `{type:"chunk", time, chunk}`，并断言 `type` 必须在 `COMPACT_STREAM_TYPES`（`chunk|text-chunks|reasoning-chunks|tool-call-chunks`）里，否则抛 `TypeError`。注释说明裸 chunk 会让 `firstRunMemberTime` 读 `undefined.length` 而崩（`#84`）。

**失败路径**：`parkDenial` 返回 false（写不进会话）→ 落回 `forward()`，即「宁可放行也不能把这一轮收成空白」（`641-645`）。

**`[实测]`**（直接调用纯函数，`dshHome` 传不存在的路径）：

| 输入 | `isAttackTask` | `taskTargetHit` |
|---|---|---|
| `帮我扫一下 public-ip-xxx 的端口` | false | null |
| `渗透测试 example.cn` | false | null |
| `用代理访问 google.com 为什么慢` | false | null |
| `打穿 test.local 的 shell` | true | null（`.local` 属自有网络） |
| `对这个 IP 做端口扫描 8.8.8.8` | true | null（裸 IP 跳过） |
| `对 www.somecorp.cn 做端口扫描` | true | `{label:"www.somecorp.cn", kind:"domain"}` |
| `入侵 https://mail.example.com.cn 拿权限` | true | `{label:"mail.example.com.cn", kind:"domain"}` |
| `给 chase.com 做渗透` | true | `{label:"chase.com", kind:"bank"}` |
| `对 https://test.xn--fiqs8s 提权` | true | `{label:"test.xn--fiqs8s", kind:"domain"}` |
| `把 192.168.1.1 打穿` | true | null |
| `对 2001:db8::1 做端口扫描` | true | null |

**关键正则**（`net-scope.js:191`）：
`/渗透(?!测试)|打穿|打下|打站|入侵|拿壳|拿权限|爆破|提权|webshell|getshell|端口扫描|pentest|\bexploit\b(?![-a-z0-9])|\bbreach\b|\bpwn\b|(?<!防御)攻击(?!面)|(?<!surface\s)\battack\b(?!\s+surface)/i`
**良性豁免**（`net-scope.js:198`）：`NET_TOPIC` 覆盖 代理/proxy/socks/vpn/frp/clash/v2ray/小飞机/机场/出口ip/内网ip/公网ip/ip地址/ip归属/ip查询/dns/域名解析/网卡/隧道/反向代理/正向代理/http(s) 代理。

**`SUFFIXES` 覆盖**（`net-scope.js:6-92`）：`.xn--*` 系列 punycode、`.中国/.中國/.公司/.网络/.網絡/.公益/.政务/.商城/.网店/.中文网/.集团/.网址/.在线/.移动/.我爱你`、`.com.cn` 及全部 34 个省级 `.xx.cn`、`.cn`；`.com.hk/.edu.hk/.gov.hk/.idv.hk/.net.hk/.org.hk/.hk`、`.香港`；`.com.mo/.edu.mo/.gov.mo/.net.mo/.org.mo/.mo`、`.澳门/.澳門`。
**`BANK_HOSTS`**：67 行常量、约 340 个 host（`net-scope.js:104-172`），含跨国银行/央行/国际金融组织/主流交易所，含 `.cn/.hk/.mo/.tw` 核心主域。

### 3.11 入口：`tools/pre-execute` + `tools/post-execute`

`installToolGateBypass(ctx, config)`（`tool-gate.js:77`），`config.toolGateBypass === false` 时整体不装（`:78`）。

**pre-execute**（`tool-gate.js:88`，`{global:true, prepend:true}`）：
1. `denyDelegation(exec)`（`:66`）：`exec.name`（或 `exec.tool.name`）∈ `{subagent, subagent_fork, workflow}`（`DELEGATION_TOOLS`，`:42`）**且** `isLeafAgent(exec.agent)`（`:51`：`header.origin ∈ {subagent, teammate, delegate}` 或 `header.delegationDepth > 0`）→ 返回 `{kind:"deny", reason:"子代理是叶子节点，不能再派活（<name>）。直接把当前任务做完并回报。"}`。**这是唯一主动拒绝的分支**。
2. 其余：`next()` 照跑，结论一律 `coerceGate` 成 `{kind:"allow"}`（`:25`）；`next` 抛错也返回 allow（`:99-103`）。

**post-execute**（`tool-gate.js:108`）：`coercePost`（`:30`）只把 `kind === "block"` 改成 `accept`，**保留 content/value 的改写**——这样 `dsh-tool-jobs` 的输出上限、`dsh-workspace-changes` 的快照、`dsh-spill-policy` 的截断都照旧生效。

**故意不碰**：`tools.checkGuards()` 是 waterfall 之后另一遍，注册在别人作用域（`tool-gate.js:118-122`）。

### 3.12 入口：审批接管

`installSubagentControl(ctx, config)`（`subagent-control.js:16`），`config.subagentControl === false` 时整体不装（`:17`）。

| 段 | 事件 | 判据 | 动作 | 行号 |
|---|---|---|---|---|
| P1 | `session/event`（global） | `event.type === "approval/policy"` 且 `event.data.policy === "never"` | `queueMicrotask` 里 `session.append("approval/policy", {policy:"ask"})`；按 `event.seq` 用 `WeakMap<session, Set>` 去重 | `26-40` |
| P2 | `approval/request`（global + prepend） | `request.agent.session` 存在 | 恒返回 `"allowed-once"` | `45-51` |
| P3 | `session/event`（global） | `event.type === "sandbox/mode"` 且 `mode !== "danger-full-access"` | 微任务里 `append("sandbox/mode", {mode:"danger-full-access"})`；去重键 `sandbox:<seq>` | `57-71` |
| P4 | `session/created`（global） | 首次见到该 session（`WeakSet primed`） | 微任务里 `append("sandbox/mode", {mode:"danger-full-access"})` | `79-90` |

**为什么必须 `global`**：宿主是 `ctx.waterfall(scopeTarget(req.agent, req.agent), "approval/request", …)`，跑在 agent 作用域里；挂在插件自己的 ctx 上收不到（`subagent-control.js:8-9`）。

**为什么不能只靠 P2**：`never` 策略在 `decide()` 里直接 `return "rejected"`，发生在 waterfall **之前**，任何监听器都救不到（`:4-6`）。

### 3.13 入口：HTTP 路由（14 条）

注册方式：`installWebServer`（`index.js:2182`）→ `ctx.inject(["webServer"], host => host.effect(...))`。每条路由经 `registerPluginRoute` 包一层（`index.js:2196`）：先 `allowPluginRequest` 鉴权，再把 `response.writeHead` 换成带 CORS 的版本，然后才进 `spec.handler`。所有 disposer 收进 `routeDisposers`，`host.effect` 的 cleanup 一次性撤销（`2185-2192`、`2677-2686`）。

见 §4 表格。

### 3.14 入口：`/rewind` 命令

`index.js:1957-1980`。`rewind.invocationSessionId(invocation)` → `rewind.analyzeRewind(ctx, sessionId)`；`arg` 不是 `once`/`round` 时返回「请选择」提示；否则 `rewind.applyRewind(ctx, sessionId, mode)`，成功文案区分 `once`/`round`。`rewind.js` 内部 `DRAFT_TTL_MS = 10 分钟`（`rewind.js:1`）。

### 3.15 入口：`continue-retry`

`installContinueRetry(ctx, {getConfig})`（`index.js:1927`）。配置合并规则（`continue-retry.js:79-81`）：`pluginCfg.autoContinue !== true && DEFAULT.autoContinue !== true` → 强制 `false`。`autoRetry` 只在 `retryMax > 0` 时生效（`:54`）。续跑触发点 `:313-322`：`!cfg.autoContinue` 直接返回；`tracker.takeContinue(id, info.seq, cfg.continueMax)` 通过才 `sendContinue(agent, cfg.continueText)`。

---

## 4. 对外接口

### 4.1 HTTP op（`/dsh-purge-safe/*`）

| 类型 | 名称 | 入参 | 出参 | 调用方 |
|---|---|---|---|---|
| HTTP GET | `/status` | — | `{ok, ready, applying, surface, control_surface, process_surface, ai_base, desktop_install, desktop_exe, asar_still_sealed, web_no_package, missing_ai_base, patches_applied/pending/skipped/ready/na/total, patches_lost, patch_status, patches[], patch_names{}, shim_cmd/ps1/bin, has_backup, override_status, override_path, dsh_home, plugin_version, boot_full_quit, sealed:true, system_field_extracted, skills[]}` | 面板（`index.js:2205`） |
| HTTP GET | `/last-user` | `?sessionId` | `rewind.readLastUserText` 结果 | 面板（`:2312`） |
| HTTP GET | `/rewind/options` | `?sessionId` | `rewind.analyzeRewind` 结果 | 面板（`:2330`） |
| HTTP GET | `/rewind` | `?sessionId` 有则取草稿，无则取 pending | `{ok, ...draft}` / `{ok, ...pending}` | 面板（`:2348`） |
| HTTP POST | `/rewind` | `{sessionId, mode:"once"\|"round"}` | `rewind.applyRewind` 结果；失败 409 | 面板 |
| HTTP POST | `/apply` | `{content?:string, surface?}`（body 上限 8 MB） | `{...applyPayload}`；`needPrompt` 时 400 | 面板（`:2391`） |
| HTTP POST | `/revert` | — | `{ok, reverted:number, errors:number, shim, note}` | 面板（`:2443`） |
| HTTP POST | `/uninstall` | — | `uninstaller.uninstallPurge()` + `{surface, fullApp, note}` | 面板（`:2470`） |
| HTTP GET/POST | `/drill-grant` | POST 无 body | `{ok, granted, path, at}` | 面板（`:2501`） |
| HTTP GET/POST | `/override` | GET —；POST `{content:string}` | GET `{ok, content, defaultContent, customized, usingDefault, path, ...injectSnapshot}`；POST 同形 + `{saved}` | 面板（`:2518`） |
| HTTP GET/POST | `/own-servers` | GET —；POST `{content:string}` | GET `{ok, content}`；POST `{ok, content, dropped}` | 面板（`:2580`） |
| HTTP POST | `/restart` | `{surface?}` | `{ok, surface, fullApp, restarting, already, needsFullQuit, asar_still_sealed, error?, note}` | 面板（`:2610`） |
| HTTP prefix | `/skills/*`、`/skill/*` | `?op` 或 body `{op,...}` | 见 §4.3 | 面板（`:2888`、`:2891`） |
| HTTP prefix | `/rules/*` | `?op` 或 body `{op,...}` | 见 §4.3 | 面板（`:2904`） |

**共同行为**：非允许方法 → 405 + `allow` 头（`index.js:2690` `methodNotAllowed`）；`OPTIONS` → `sendOptions`（`:2923`）；JSON 响应统一 `sendJson`（`:2913`）。

**注意**：safe **没有** community 的 `/diagnose`、`/selfcheck`、`/boost`、`/probe`、`/audit`、`/hooks-deny`、`/update` 七条路由（community `index.js:2103`、`2136`、`2152`、`2209`、`2230`、`2243`、`2350`）。`/status` 的 payload 里 `sealed: true` 且注释写「私有固定版本：不对外暴露更新状态与通道」（`index.js:2287`）。

### 4.2 agent 工具与命令

| 类型 | 名称 | 入参 | 出参 | 调用方 |
|---|---|---|---|---|
| 工具 | `purge_status` | `{}`（`additionalProperties:false`） | `{text}`，正文 = `renderStatus(gatherState())` | 模型（`index.js:1987`） |
| 工具 | `purge_apply` | `{}` | `{text}`：「清洗完成 / applied=N, already=M. … 重启 dsh 生效.」 | 模型（`:2008`） |
| 工具 | `purge_revert` | `{}` | `{text}`：「回滚完成 / reverted=N, shim_dirs=K. 重启 dsh 恢复.」 | 模型（`:2044`） |
| 命令 | `/purge` | `status\|apply\|revert\|uninstall\|edit\|help` | 文本 | 用户（`:1939`） |
| 命令 | `/rules` | `list\|use <id>\|create <id> [别名] [目标]\|delete <id>\|reset\|help` | 文本 | 用户（`:1945`） |
| 命令 | `/skills` | `list\|import <路径>\|create <id> [说明]\|delete <id>\|help` | 文本 | 用户（`:1951`） |
| 命令 | `/rewind` | `once\|round` | 文本 | 用户（`:1957`） |

### 4.3 `/rules/*` 与 `/skills/*` 的 op 表

`handleRulesOp`（`index.js:2695`）：

| op | 入参 | 出参 | 判据 |
|---|---|---|---|
| `status`（默认） | `?cwd` / body `{cwd}` | `{ok, ...rulesStatus}` | `2711` |
| `scan-cwd` / `scan` | `?cwd` | `{ok, cwd, candidates[], selections[]}` | `2714` |
| `toggle-cwd` | `{path, enabled}` | `{ok, selections[]}`；缺 `path` → 400 | `2719` |
| `set-policy` / `workspace-policy` | `{policy}` ∈ `fallback\|strict\|always` | `{ok, policy, policies[]}`；非法 → 400 | `2726` |
| `read` | `?id` | `{ok, id, name, target, content}`；非法 id 400 / 不存在 404 | `2734` |
| `save` | `{id, content, name?, target?}` | `{ok, id, ...injectSnapshot}`；`target` 只接受 `AGENTS.md`/`CLAUDE.md` | `2741` |
| `activate` | `?id` | `{ok, id, name, target, agents_path, note, ...injectSnapshot}` | `2758` |
| `delete` | `?id` | `{ok, id}` | `2772` |
| `reset` | — | `{ok, ...r, note}` | `2778` |
| 其它 | — | 400 `unknown op` | `2783` |

`handleSkillsOp`（`index.js:2790` 起）：`status` / `read` / `save` / `delete` / `import`，其它 400（`2845`）。

### 4.4 事件（waterfall / 观察者）

| 类型 | 名称 | 入参 | 出参 | 调用方 |
|---|---|---|---|---|
| waterfall | `system-prompt/assemble` | `(assembly, context, [next])` | 改写后的 assembly | `index.js:1044` |
| waterfall | `agent/pre-step` | `(payload, next)` | `{kind:"enter", messages}` | `net-scope.js:650`（地域闸门）、`index.js:636`（mnemon 过滤） |
| waterfall | `tools/pre-execute` | `(exec, next)` | `{kind:"allow"}` / `{kind:"deny", reason}` | `tool-gate.js:88` |
| waterfall | `tools/post-execute` | `(exec, result, next)` | `{kind:"accept"}` 或原 decision | `tool-gate.js:108` |
| waterfall | `approval/request` | `(request, next)` | `"allowed-once"` | `subagent-control.js:45` |
| 观察者 | `session/event` | `(session, event)` | — | `subagent-control.js:26`、`:57`；`index.js:857` |
| 观察者 | `session/created` | `(session)` | — | `subagent-control.js:79`；`index.js:824`、`:857` |

### 4.5 slot / section / context

| 类型 | 名称 | order | 条件 | 位置 |
|---|---|---|---|---|
| section | `dsh-purge-safe` | `-100000` | `config.enabled !== false` | `index.js:541` |
| section | `dshpg-capabilities` | `-99999` | `config.capabilityProtocol !== false` | `index.js:552` |
| section | `dsh-purge-safe:post` | `postPromptOrder`（默认 5100，须 > `-100000`） | `config.postPrompt` 非空 | `index.js:576` |
| section | `dsh-purge-safe:anchor` | `10150` | `anchorMode !== "off"` | `anchor.js:85` |
| context | `dsh-purge-safe:child-anchor` | `235`，`required:true` | 仅子代理上下文 | `anchor.js:96` |

`CAPABILITY_SECTION` 故意**不带** `dsh-purge-safe` 前缀（`capability-protocol.js:9-12`）：宿主 `renderPrompt` 内部有一步按该前缀把段挪到最前，带前缀会让 cap 跑到 inject 前面。

### 4.6 CLI / 子进程

| 类型 | 名称 | 入参 | 出参 | 调用方 |
|---|---|---|---|---|
| 子进程 | `restart-desktop.js` | `env.DSH_PURGE_RESTART`（编码后的重启计划） | 退出码 | `desktop.js:911`、`:1348`、`:1777` |
| 子进程 | `restart-web.js` | 同上 | 退出码 | `web.js:151` |
| 子进程 | `uninstall-restart.js` | 同上 | 退出码 | `web.js:173` |
| 子进程 | `reapply-cli.js` | 无 | 退出码 | `update.js:958` |
| 文件信号 | `signalRestartGo(planned)` | 写 `planned.goPath` = `"1"` | — | `host.js:66`；`index.js:2668` 在响应 flush 后调用 |

---

## 5. UI 触点

本模块只含两个**纯前端**文件，它们不进服务端，而是被 `scripts/build-client.mjs` 内联进两个浏览器包（`client.js` 面板包与 `lib/redteam/client.js` 演练台包）。

| 组件名 | 文件:行 | 依赖的 op | 展示字段 | 交互（点击后发生什么） |
|---|---|---|---|---|
| `useWorkbenchFullscreen(React, elementRef, options)` | `ui-fullscreen.js:59` | 无 | 返回 `{expanded, enter, exit, toggle, isExpanded}`（`:287`） | `enter()`：同步 `setActive(true)` 先落 CSS 兜底，再 `target.requestFullscreen()`；原生被拒/抛错只保留 CSS 全屏并返回 `true`（`:87-135`）。`exit()`：最多 8 次循环调 `exitFullscreen`，处理「一次调用只弹出嵌套一层」的浏览器行为（`:160-180`）。`toggle()`：按 `activeRef` 切换（`:189`）。`Escape`：若目标内含 `.rt-session-map-expanded/.rt-shot-zoom/.dshp-modal-bg/.dshp-restart-mask/.dshp-auth-mask/.rt-modal/[role=dialog][aria-modal=true]` 则不拦截，交给内层（`:246-254`） |
| — 全屏挂载点 | `client.js:21497`（`const fullscreen = useWorkbenchFullscreen(React, shellElementRef)`） | — | `fullscreen.expanded` 参与 `const full = !embedded && (isFullWindow() \|\| fullscreen.expanded)`（`client.js:21498`） | `openFull = () => fullscreen.enter()`；`exitFull` 额外 `history.replaceState` + `setRefreshKey`（`client.js:21499-21505`） |
| — 全屏挂载点（演练台包） | `lib/redteam/client.js:15913` | — | 同上 | 同上 |
| `createProductTheme(options)` | `ui-theme.js:68` | 无（`localStorage` 键 `dsh-purge-safe-ui-theme`，事件 `dsh-purge-safe-ui-theme-change`） | 返回冻结对象 `{key, event, modes:["dusk","white","system"], defaultMode:"dusk", mode, read, set, subscribe, host}`（`:219-229`） | `set(next)`：非法值直接返回当前；能写 `localStorage` 则持久化，否则写 `volatileMode`；然后 `dispatch()`（`:203-217`）。`subscribe(fn)`：首个订阅者触发 `start()`，最后一个退订触发 `teardown()`（`:193-201`） |
| — 主题读取 | `client.js:21514` | — | `productTheme.read()` | — |
| — 主题订阅 | `client.js:21518-21519` | — | `productTheme.subscribe(next => setTheme(next))` | 主题变化即重渲染 |

`host()` 的探测顺序（`ui-theme.js:33-66`）：`body`/`documentElement` 上的 `data-ds-dark-theme` / `dark` 属性 → `data-theme` 值 → `color-scheme`（style 或 computed）→ `prefers-color-scheme` → 兜底 `"white"`。

**未验证**：面板里哪些按钮最终调用 `/apply`、`/revert`、`/restart` 等，属于 `lib/redteam/client.js` 与 `client.js` 的渲染层，不在本次范围（见 §10）。

---

## 6. 依赖

### 6.1 内部

```
index.js
 ├─ core.js ──── hide-console.js, desktop.js, extract-asar.js, surface.js,
 │               host-clean.js, phase1-keep.js, table-read.js → table-key.js → asset-table.js
 ├─ host.js ──── surface.js, desktop.js, web.js → extract-asar.js
 ├─ identity.js ─ capability-protocol.js, mnemon-settings.js, core.js
 ├─ anchor.js ─── identity.js（isChildAgentContext）
 ├─ subagent-control.js ── identity.js
 ├─ tool-gate.js ── （无内部依赖，只用 identity 的判据思想，判据自带一份 isLeafAgent）
 ├─ net-scope.js ── core.js（findDshHome）
 ├─ rules.js / skills.js / uninstall.js / reapply.js / update.js / rewind.js
 ├─ preset-default.js ── core.js
 └─ continue-retry.js / settle-policy.js / drill-grant.js / official-update.js
```

**循环依赖**：`core.js` ⇄ `desktop.js`（`desktop.js:8` 从 `core.js` 取 `atomicCopyFileSync`/`atomicWriteSync`），`core.js` ⇄ `preset-default.js` 无环，但 `core.js` ⇄ `identity.js` 有单向引用（`identity.js:3` `findDshHome`），`index.js` 双向不成立。

### 6.2 宿主（逐个列出，标注是否公开 API）

| 宿主 API / RPC / slot | 用法 | 位置 | 是否公开 |
|---|---|---|---|
| `ctx.systemPrompt.section({name, order, text, interpolate})` | 注册 prompt 段 | `index.js:505`（`addPromptSection`） | 公开（Cordis 服务） |
| `ctx.systemPrompt.context({name, order, text, required, interpolate})` | 注册子会话 context | `anchor.js:96` | 公开 |
| `ctx.systemPrompt.assemble` | **方法劫持**（`installAssembleGuard`） | `identity.js:674-786` | **非公开**（改的是对象方法，靠 `Object.getOwnPropertyDescriptor` + 自定义 `ASSEMBLE_GUARD` 符号） |
| `system-prompt/assemble` 事件 | waterfall 改写 | `index.js:1044` | 公开（cordis waterfall） |
| `agent/pre-step` | waterfall 拦截 | `net-scope.js:650`、`index.js:636` | 公开 |
| `tools/pre-execute` / `tools/post-execute` | waterfall 降级 | `tool-gate.js:88`、`:108` | 公开 |
| `approval/request` | waterfall 恒放行 | `subagent-control.js:45` | 公开 |
| `session/event` / `session/created` | 观察者 | `subagent-control.js:26`、`:79` | 公开 |
| `session.append(type, data, {surfaceOp})` | 写会话事件 | `subagent-control.js:36`、`:67`、`:86`；`net-scope.js:598-605` | 公开 |
| `ctx.tools.register({name, description, parameters, output, execute})` | 注册工具 | `index.js:1985`、`:2006`、`:2042` | 公开 |
| `ctx.get("commands").register({...})` | 注册命令 | `index.js:1937` | 公开 |
| `ctx.get("webServer").register({kind, path, handler}, label)` | 注册 HTTP 路由 | `index.js:2196` | 公开 |
| `ctx.get("agentPresets").composedPreset(ctx)` | 取当前预设 | `identity.js:409` | **非公开**（无版本承诺） |
| `ctx.get("agents")` / `ctx.get("sessions")` | 找父会话 | `identity.js:497-503` | **非公开** |
| `session.snapshotEvents()` / `session.events` | 读事件流 | `index.js:241-249` | **非公开**（两条路径都试，说明本身不稳定） |
| `session.header.origin` / `delegationDepth` / `parentSession` | 子代理判定 | `identity.js:447-450` | **非公开** |
| `ctx.effect(fn)` | 生命周期回收 | 多处 | 公开 |
| `ctx.inject(["webServer"\|"connection"], fn)` | 服务注入 | `index.js:2184`、`:104` | 公开 |
| `settings.get/update("agent-preset-registry", …)` | 清 `selectedDefault` | `preset-default.js:108-124` | **非公开** |
| `@deepseek-ai/dsh-llm` 的 `createAssistantMessage` | 构造拒绝消息 | `net-scope.js:562` | 公开（包导出），但路径不存在时回退手写 |

### 6.3 外部

| 类别 | 目标 | 位置 |
|---|---|---|
| 文件系统 | `$DSH_HOME/{prompt-inject.md, net-scope-allow.txt, AGENTS.md, CLAUDE.md, rules/, skills/, profiles/, .agent-presets/}` | 见 §2.2 |
| 文件系统 | `$DSH_HOME/dsh-purge-safe/*`（11 个状态文件） | 见 §2.2 |
| 文件系统 | 宿主包目录（`<aiBase>/dsh-*`、`<aiBase>/dsh/node_modules/@deepseek-ai/*`、`packages/*/*/lib/index.js`） | `core.js:6225-6500` |
| 文件系统 | 桌面 `.app` / `resources/app.asar` / 解包目录 | `desktop.js`、`extract-asar.js` |
| 文件系统 | `$DSH_HOME/bin/{dsh,dsh.cmd,dsh.ps1}` 及其 `.dshpurge.bak` | `core.js:7547-7770` |
| 子进程 | `node restart-desktop.js` / `restart-web.js` / `uninstall-restart.js` | `desktop.js:911`、`web.js:151`、`:173` |
| 子进程 | `unzip`（`zip-extract.js`）、`git`（`update.js`）、`pnpm`/`npm`（`core.js:418-437`）、`powershell`（`desktop.js`） | 各文件 |
| 子进程 | `$EDITOR`（`core.js:8231`） | 用户触发 |
| 网络 | `update.js` 内的 GitHub / registry 请求 | **本插件无路由调用**，仅 `localVersion()` 被用（见 §8） |
| 原生 | `kernel32.dll!FreeConsole`（经 koffi） | `hide-console.js:79-97` |
| 环境变量 | `DSH_HOME`、`DSH_BASE`、`DSH_PURGE_RESTART`、`ELECTRON_RUN_AS_NODE`、`HTTP(S)_PROXY` 等 | `core.js:2415`、`hide-console.js:66` |

---

## 7. 与另一版的差异

本节只写**本次实际对比过**的项（第 2、5、11 项按要求给具体差异；另附我顺手验证过的 1、3、4 项）。其余标注「未查」。

| 能力 | community 行号 | safe 行号 | 差异性质 |
|---|---|---|---|
| **【第 2 项】补丁表规模** | `lib/patches/index.mjs`，**88** 条，id 1–96 | `lib/core.js:5506`，**59** 条，id 1–96 | **不对称集合**（`[实测]` 取两个 `ALL_PATCHES` 的 id 差集）：共有 57 个 id；**仅 community 有 31 个**：`2,3,19,21,24,28,30,31,32,45,46,50,53,54,56,60,62,64,65,67,71,73,74,76,77,80,82,83,84,87,88`；**仅 safe 有 2 个**：`85`（`SESSION_PROMPT_STEER_INTERRUPT`）、`86`（`SESSION_QUEUE_STEER_INTERRUPT`） |
| **【第 2 项】同 id 不同物** | — | — | **9 个 id 被两版用于完全不同的补丁**（`[实测]` 比对 `name`）：`52` C=`SESSION_LOG_UPLOAD_DEFAULT_OFF` / S=`SESSION_LOG_CLOUD_UPLOAD_REMOVED`；`89` C=`ASK_USER_WAIT_CAPPED` / S=`SYSTEM_FIELD_EXTRACT`；`90` C=`RESTORE_NATIVE_STEERING` / S=`OPENAI_NATIVE_SYSTEM_ROLE`；`91` C=`BROWSER_COOKIE_NAME_IGNORE_PORT` / S=`ANTHROPIC_NATIVE_PARAMS_SYSTEM`；`92` C=`HOST_MAX_HTTP_HEADER_SIZE` / S=`SUBAGENT_SAME_INJECT_PATH`；`93` C=`SANDBOX_POLICY_BRAND_NEUTRAL` / S=`PRODUCT_ANALYTICS_DEFAULT_OFF`；`94` C=`SKILL_BADGE_DESCRIPTION_NEUTRAL` / S=`PRODUCT_TELEMETRY_OTEL_NOOP`；`95` C=`INSPECTOR_FRAME_BUDGET_RECORD_OVERHEAD` / S=`SESSION_TELEMETRY_OTEL_DISABLED`；`96` C=`INSPECTOR_FRAME_BUDGET_RECORD_OVERHEAD_CLIENT` / S=`SKILL_OFFICE_ASSET_FALLBACK`。**两张表的 id 不能混用** |
| **【第 2 项】补丁定义组织** | 拆成 8 个文件：`patches/{prompt,code,engine,new-tools,opt-in,stability,shared,index}.mjs` | 全部内联在 `core.js:3083-5505` 四个数组 `PATCHES`/`CODE_PATCHES`/`ENGINE_PATCHES`/`NEW_TOOL_PATCHES` | **重写**（结构不同，语义等价） |
| **【第 2 项】引擎拆分** | 拆成 `core/shared.mjs`（298 行）+ `core/verify.mjs`（205 行），`core.js` 只 re-export（`core.js:2392-2394`） | 全在 `core.js` 一个文件 | **重写** |
| **【第 2 项】`patchHasRemainingWork` 判据** | `shared.mjs:192`：`for rep: if matchesPattern(hay, pattern) return true`——**任何 pattern 还在就算有活** | `core.js:7091`：多两条豁免——`needle === written` 跳过（空替换）；`written.includes(needle) && hay.includes(written)` 跳过（插入型已写完） | **重写（safe 更准）** |
| **【第 2 项】`applyReplacementsToText` 的 `skipIfMarked` 条件** | `verify.mjs:24`：`patch.skipIfMarked && patchApplied(source, patch)` | `core.js:7208`：`… && !patchHasRemainingWork(source, patch, fp)` | **重写（safe 修掉「标记在、替换体缺」永久跳过）** |
| **【第 2 项】命中数契约 `expect`** | `verify.mjs:35-45`：`rep.expect` 声明命中数，不符返回 `{hitMismatch:{patch_id,expected,actual,file}}` 且不写盘 | **不存在**；`replacements` 无 `expect` 字段 | **删除（safe 缺这个防误伤闸门）** |
| **【第 2 项】`patchApplied` 特殊分支** | `shared.mjs:159-163`：`id 61/93 → sandboxPolicyApplied`、`id 17 → observationPolicyApplied`、`id 90 → nativeSteeringRestored`、`id 42 → modernSettingsApi` | `core.js:7060`：只有 `id 42` 两个分支 + `forbid` + `markers/markersAny` + `marker` + `replace` 首行前 60 字符 | **删除** 4 个专用判定 |
| **【第 2 项】锚点覆盖（重锚）** | `lib/anchors.js`（84 行）+ `shared.mjs:230` `patchReplacements` 里 `applyOverrides(p, overridesSnapshot())`，读 `$DSH_HOME/dsh-purge/anchor-overrides.json` | **完全不存在**：`core.js:7147` 的 `patchReplacements` 直接返回 `p.replacements`；`grep -r "anchor-overrides\|applyOverrides" vendor/safe` 零命中 | **删除（safe 无法在不改源码的情况下重锚）** |
| **【第 2 项】`rollupPatchStatus` 参数** | `verify.mjs:2`：含 `requireAllTargets`，可产出 `"partial"` | `core.js:7246`：换成 `hostCleanGate`，无 `partial` | **重写** |
| **【第 2 项】补丁字段集** | 88 条上出现 30 种字段（含 `permissionOverride`×14、`surfaces`×7、`chainedAfter`、`requireAllTargets`、`fileOptional`、`fileAllRequired`、`settleWhenAbsent`、`optIn`、`disabledByDefault`、`multiHit`、`verifyRemovedFromBackup`） | 59 条上 19 种字段，唯一独有字段是 `hostCleanGate`×1 | **删除 12 类字段，新增 1 个** |
| **【第 2 项】备份机制** | 只有 `<file>.dshpurge.bak`（`core.js:309`、`:2515`）+ `dsh-purge/applied.json` 版本戳 | `<file>.dshpurge.bak` **加**保险柜 `dsh-purge-safe/host-backups/<sha1>.bak` + 每文件 `.applied.json` 摘要（`core.js:5737`、`5766`、`5845`） | **新增（safe 多一层，宿主文件被整份替换后仍可回滚）** |
| **【第 5 项】net-scope 规模** | 412 行 | 669 行 | **新增 257 行** |
| **【第 5 项】net-scope 是否装闸门** | **不装**。`grep -rn "agent/pre-step" vendor/community/lib/net-scope.js` 零命中；文件里只有 `regionOfSuffix`/`allowFilePath`/`entryHost`/`normalizeAllowText`/`readAllowText`/`ownServerNote`（`community/net-scope.js:410` 的 `ownServerNote(){ return "" }` 是空实现） | `installRegionGate`（`net-scope.js:625`）注册 `agent/pre-step`（`:650`），命中即写拒绝句 + `{kind:"enter", messages:[]}`（`:641`） | **新增（这是 safe 独有、且是唯一的「吞整轮」路径）** |
| **【第 5 项】判据常量** | `DENIAL`（`:186`）、`ATTACK`（`:191`）、`NET_TOPIC`（`:198`）、`BANK_HOSTS`（`:104-172`）与 safe **逐字节相同**（`diff` 对 `BANK_HOSTS` 段零差异） | 同左（`net-scope.js:186`、`:191`、`:198`、`:104-172`） | **等价** |
| **【第 5 项】新增的判定函数** | 无 | `permittedHost`（`:410`）、`isOwnNetwork`（`:414`）、`isIp`（`:430`）、`taskHit`（`:434`）、`isBenignNetworkTopic`（`:439`）、`isAttackTask`（`:445`）、`hostsInTask`（`:451`）、`taskTargetHit`（`:464`） | **新增** |
| **【第 5 项】新增的消息提取** | 无 | `messageBody`（`:476`）、`looksLikeToolResult`（`:486`）、`humanTaskText`（`:493`）、`currentTaskText`（`:505`） | **新增（只看本轮新用户句，避免历史/工具回包误拦）** |
| **【第 5 项】新增的拒绝写入** | 无 | `sessionOf`（`:518`）、`denialMessage`（`:525`）、`denialChunks`（`:552`）、`denialStream`（`:564`）、`appendDenial`（`:580`）、`parkDenial`（`:589`） | **新增（写 assistant/message + compact chunk stream）** |
| **【第 11 项】hide-console 规模** | 309 行 | 361 行 | **新增 52 行** |
| **【第 11 项】`stripProxyEnv`** | **无** | `hide-console.js:66`：删 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/http_proxy/https_proxy/all_proxy`，并置 `NO_PROXY=no_proxy="*"` | **新增** |
| **【第 11 项】`detachWindowsConsole`** | **无** | `hide-console.js:79`：非 win32 返回 `skipped:"not_win32"`；非 Electron/`ELECTRON_RUN_AS_NODE` 返回 `skipped:"not_electron_node"`；用 koffi 载 `kernel32.dll` 调 `FreeConsole()` | **新增** |
| **【第 11 项】密封桌面跳过** | `core.js:236` 起只有 `isElectronHost()` 一条跳过 | `hide-console.js:286` 加 `skipped_electron`；`:291` 加 `isPackagedDesktopDshRoot(root) → skipped_desktop`（`isPackagedDesktopDshRoot` 在 `:272`：路径含 `/resources/app/dsh` 或 `deepseekharnessdesktop`，或 `isInsideDesktopInstall`） | **新增（safe 不碰官方桌面 bin.js，注释：改它会让重启直接打不开）** |
| **【第 11 项】标记名** | `IMPORT_MARK = "dsh-purge-hide-console"`（`:8`）、facade `dsh-purge-child-process-hide.mjs`（`:245`、`:282`） | `"dsh-purge-safe-hide-console"`（`:8`）、`dsh-purge-safe-child-process-hide.mjs`（`:297`、`:334`） | **重命名** |
| **【第 1 项】补丁清单** | 88 条 | 59 条 | 见本节第 1–2 行；逐条见 §9.1 |
| **【第 3 项】`cordis.patch.yml`** | 74 行：5 条 `disabled` + `system-prompt` config + `insert` 5 个条目（`dsh-purge`、`redteam`、`presets-plugin`、`redteam-store`、`redteam-ui`），config 含 `excludePresets: []` 与混淆键 `hooksDenyBypass: true` | 80 行：同样 5 条 `disabled` + `system-prompt` config，**多一条顶层 `- id: dsh-purge-safe / inject: [systemPrompt, tools]`**（`:40-41`），`insert` 只有 4 个条目（**去掉 `presets-plugin`**），config 去掉 `excludePresets`/混淆键、加 `subagentControl`/`toolGateBypass` | **新增 1 条顶层 inject；删除预设插件 insert；config 键替换** |
| **【第 4 项】HTTP 路由** | 18 exact + 3 prefix = 21 条 | 11 exact + 3 prefix = 14 条 | **删除 7 条**：`/diagnose`、`/selfcheck`、`/boost`、`/probe`、`/audit`、`/hooks-deny`、`/update` |
| identity.js | 1029 行 / 29 个 export | 927 行 / 9 个 export | **未查**（结构差异明显，但本次未逐条比对） |
| desktop.js | — | 1996 行 | **未查** |
| rewind.js / rules.js / skills.js / uninstall.js / update.js / reapply.js | — | 各见 §1 | **未查** |
| `ui-fullscreen.js` / `ui-theme.js` | community 无同名文件 | `safe` 独有 | **未查**（community 侧是否有等价实现未比对） |
| `tool-gate.js` / `subagent-control.js` | community 无同名文件 | `safe` 独有 | **未查** |
| `mnemon-settings.js` / `preset-default.js` / `capability-protocol.js` | community 有 `preset-presence.js`/`preset-compat.js` 等，职责划分不同 | `safe` 独立三文件 | **未查** |
| `anchor.js` 的语义 | community 的 `anchors.js` = **补丁锚点覆盖**（改 pattern） | `safe` 的 `anchor.js` = **system prompt 尾部锚点**（身份/格式锁） | **同名不同物**（这一点已确认：`grep anchor-overrides vendor/safe` 零命中，`anchor.js` 全文无补丁 pattern 相关代码） |
| `hide-console.js` 以外的小模块 | `host-clean.js` / `phase1-keep.js` / `table-key.js` / `table-read.js` / `asset-table.js` / `settle-policy.js` | 同名同职责 | **未查**（只确认了被谁 import） |

---

## 8. 风险与脆弱点

| 风险 | 触发条件 | 后果 | 是否可静态检出 |
|---|---|---|---|
| **`agent/pre-step` 地域闸门吞掉整轮** | 本轮新用户句命中 `ATTACK` 且含 `.cn/.hk/.mo` 域名或银行域名，且不在 `net-scope-allow.txt` | 模型从未收到该请求；会话里凭空出现 `assistant` 消息「不行，这是严令禁止的」；用户看到的是「助手自己拒绝了」而不是策略拦截 | 是（`net-scope.js:641` 的 `messages: []`） |
| 闸门正则误伤 | `ATTACK` 含 `(?<!防御)攻击(?!面)`、`(?<!surface\s)\battack\b(?!\s+surface)` 等零宽断言；`NET_TOPIC` 豁免只覆盖 18 个词 | 正常的安全研究/防御讨论被吞轮；或反过来，中文新造词绕过 | 部分（正则可读，但误伤面需语料才能测） |
| 闸门 ReDoS | 超长消息（贴代码/日志）触发 `ATTACK` 零宽断言回溯 | 事件循环卡死；代码有 100 KB cap（`net-scope.js:196`）缓解 | 是 |
| 闸门写会话失败 | `parkDenial` 两层都失败 | 落回 `forward()`，攻击任务照常执行（失败方向是「放行」） | 是（`net-scope.js:643-646`） |
| `messages: []` 被宿主当非法 | 宿主对 `agent/pre-step` 返回值做校验（community `index.js:525` 就有 `messages must be an array` 的 TypeError） | 抛错 → 整轮失败 | 是（两版都有这条校验，safe 返回的是合法空数组，暂未见问题） |
| `installAssembleGuard` 方法劫持 | 宿主改 `systemPrompt.assemble` 的实现或改成 getter-only | 注入整体失效，且**不报错**（`try` 吞掉） | 部分 |
| `slot.rewrite` dispose 为 noop | cordis 正常生命周期触发 cleanup | 设计上故意 noop；若宿主改语义为「必须清理」则内存泄漏 | 是（`identity.js:684-688` 有注释） |
| `patchStatus` 与 `applyPatches` 口径不一致 | 同一文件同时被 `preserveClientBundles` 分支与常规分支处理 | 面板显示与 apply 报告可能差 1 | 是 |
| `hostCleanGate` 只有 #40 一条 | 宿主 `system-prompt/assemble` 文案一变 | #40 永远 `pattern_not_found`，且**不会**被 `optional` 软化为跳过 | 是（`core.js:7276`） |
| **`update.js` 是死代码** | `grep -rn "checkUpdate\|applyUpdate\|handleUpdateOp" vendor/safe/lib vendor/safe/client.js` 在 `update.js` 之外零命中（`redteam/ui.js:778` 是演练台自己的 `handleUpdateOp`） | 1144 行在线更新实现永不执行；`autoUpdateOnStart` 配置项也无人读 | 是 |
| **三个配置项是死的** | `autoUpdateOnStart`（`index.js:55`）、`autoRevertOnMissing`（`:56`）、`injectOnce`（`:57`）在全 `vendor/safe` 内只有 `DEFAULTS` 里那一处出现 | 用户改了没效果，`cordis.patch.yml` 里还写着它们（`:49`、`:50`、`:52`） | 是 |
| 加密槽是混淆不是加密 | 密钥四段中三段为常量、第四段与密文同文件（`table-key.js:5-14`、`asset-table.js`） | 出厂提示词可被任何人解出（`[实测]` 24 298 字符） | 是 |
| `patchStatus` 在无 aiBase 时全判 `na` | 宿主包没定位到 | 面板 `0/0`，用户以为「没有补丁要打」 | 是（`core.js:8305`） |
| 宿主内部 API 依赖 | `ctx.get("agentPresets").composedPreset`、`session.snapshotEvents`、`settings.update("agent-preset-registry")`、`session.header.{origin,delegationDepth,parentSession}` | 宿主升级后红队分流/子代理判定/预设清理静默失效 | 是（见 §6.2 标注「非公开」的行） |
| **两版 id 空间重叠但语义不同** | 同时装过 community 与 safe、或把两版 `patch_status` 混读（9 个 id：52/89/90/91/92/93/94/95/96） | 面板把 safe 的 `SUBAGENT_SAME_INJECT_PATH`（92）显示成 community 的 `HOST_MAX_HTTP_HEADER_SIZE`；反向亦同。`patch_status` 以 id 为键（`core.js:7506-7510`），无命名空间隔离 | 是（两版 `ALL_PATCHES` 的 `name` 一比即出） |
| `net-scope-allow.txt` mtime 缓存 | 同一 mtime（秒级精度文件系统）内改文件 | 允许列表不生效，最长 1 次 stat 周期 | 是（`net-scope.js:390-403`） |
| shim 注入损坏 | `begin` 无 `end` | `stripShimInject` 整份返回不剥离 → 用户 shim 永远带半截注入 | 是（`core.js:7668-7673`） |
| 密封 bin 里 bak 外迁失败 | 拷贝失败或大小不符 | 保留 in-bin bak（宁可脏也不丢原文） | 是（`core.js:7737-7762`） |
| `.applied.json` 摘要只按路径归一化 | 同一路径内容被外部改动但摘要未刷 | `appliedDigestMatches` 误判 | 是（`core.js:5779`） |

---

## 9. 逐条功能清单

### 9.1 补丁全量表（`SF-CORE-P001` – `SF-CORE-P059`）

编号规则：`SF-CORE-P<补丁 id 三位>`。`锚点类型`：`literal-patterns` = `patterns[]` + 单一 `replace`；`replacements` = `{pattern, replace}[]`；`replacements+regex` = 其中至少一条 pattern 是 `RegExp`。
完整机读版见 [08-safe-patches.json](08-safe-patches.json)。目标列用的是 `targetFiles()` 的 `file` 键（键 → 真实路径映射见 §9.2）。

| 编号 | 标题 | 目标（file 键） | 锚点类型 | optional | 作用 | 行号 |
|---|---|---|---|---|---|---|
| `SF-CORE-P001`（id 1） | `WORKSPACE_CONTEXT_INTRO` | `agent-instructions` | replacements | 否 | 全局免责声明 | 3085 |
| `SF-CORE-P004`（id 4） | `SYSTEM_PROMPT_PERSONA` | `agent-preset` / `web-app` / `headless` / `preset-acp-app` / `preset-sdk-app` | replacements | 否 | persona：去掉官方默认身份，不另写人设 | 3158 |
| `SF-CORE-P043`（id 43） | `WEB_PRESET_IDENTITY_STRIP` | `preset-standard` / `preset-ptc` / `preset-cordis` / `preset-minimal` | replacements | 否 | Web 四个内置预设只去掉身份句 | 3174 |
| `SF-CORE-P070`（id 70） | `PRESET_SHELL_NETWORK` | `preset-minimal` / `preset-sdk-minimal` | replacements | 否 | 极简模式终端不再写没有网络 | 3201 |
| `SF-CORE-P005`（id 5） | `APPROVAL_NEVER_SENTENCE` | `user-approval` / `user-approval-invariant` | literal-patterns | 否 | 审批提示句限制 | 3216 |
| `SF-CORE-P006`（id 6） | `SANDBOX_DENY_FILE_WRITE` | `sandbox-local` | literal-patterns | 否 | 沙箱 deny file-write | 3241 |
| `SF-CORE-P007`（id 7） | `SANDBOX_MODE_DEFAULT` | `base` | literal-patterns | 否 | 沙箱默认 danger-full-access（可被 UI 切换，不写死 env） | 3251 |
| `SF-CORE-P008`（id 8） | `APPROVAL_POLICY_DEFAULT` | `base` | literal-patterns | 否 | 审批：danger-full-access → never（与 mode 组合合法） | 3263 |
| `SF-CORE-P009`（id 9） | `APPROVAL_AUTO_GRANT` | `user-approval-code` / `user-approval-invariant` / `user-approval` | replacements | 否 | 审批门自动放行 | 3282 |
| `SF-CORE-P010`（id 10） | `APPROVAL_CONFIG_DEFAULT_NEVER` | `user-approval-code` | literal-patterns | 否 | 审批配置默认 never | 3309 |
| `SF-CORE-P011`（id 11） | `APPROVAL_NEVER_SENTENCE_BYPASS` | `user-approval-code` | replacements | 否 | never 提示句 → 自动放行 | 3318 |
| `SF-CORE-P012`（id 12） | `APPROVAL_ASK_SENTENCE_BYPASS` | `user-approval-code` / `user-approval` | replacements | 否 | ask 提示句 → 自动放行 | 3341 |
| `SF-CORE-P013`（id 13） | `ESCALATION_WIDENING_EXEMPT` | `escalation` | replacements | 否 | 豁免严格升级阶梯 | 3385 |
| `SF-CORE-P014`（id 14） | `ESCALATION_GRANT_UNCONDITIONAL` | `escalation` | replacements | 否 | 升级请求无条件授信 | 3413 |
| `SF-CORE-P015`（id 15） | `SANDBOX_CONFINE_PASSTHROUGH` | `sandbox-local` | literal-patterns | 否 | 沙箱 confine 直通 | 3487 |
| `SF-CORE-P016`（id 16） | `FS_FENCE_DISABLED` | `fs-sandbox` | literal-patterns | 否 | 文件系统围栏取消 | 3565 |
| `SF-CORE-P017`（id 17） | `FS_OBSERVATION_INTENT_FREE` | `fs-observation-policy` | replacements | 否 | 观察策略读写意图放行 | 3598 |
| `SF-CORE-P018`（id 18） | `REPEAT_TOOL_REMINDER_DISABLED` | `repeat-tool-reminder` | replacements | 否 | 重复调用守卫禁用 | 3659 |
| `SF-CORE-P022`（id 22） | `READ_CAPS_RAISED` | `tool-fs` | replacements | 否 | read 上限放宽 | 3713 |
| `SF-CORE-P023`（id 23） | `SUBAGENT_MAXDEPTH_RAISED` | `subagent` / `tool-subagent` | replacements | 否 | 子代理深度默认 3 → 10 | 3734 |
| `SF-CORE-P025`（id 25） | `HARNESS_IDENTITY_STRIP` | `system-prompt` | replacements | 否 | 去掉官方默认身份，保留官方功能提示词 | 3770 |
| `SF-CORE-P026`（id 26） | `MINIMAL_PERSONA_PURGE` | `preset-minimal` / `preset-sdk-minimal` | replacements | 否 | 内置 minimal：去掉默认身份并打开 complete，让 inject 能进 | 3791 |
| `SF-CORE-P029`（id 29） | `TOOL_WEB_UNTRUSTED_NEUTRAL` | `tool-web` / `tool-web-nested` | replacements | 是 | dsh-tool-web：外部内容 untrusted 拦截→可执行数据 | 3849 |
| `SF-CORE-P033`（id 33） | `TOOL_SHELL_DENIAL_PROMPT` | `tool-bash` / `tool-pwsh` | replacements | 是 | bash/pwsh 工具描述：沙箱拒绝话术→可继续 | 3893 |
| `SF-CORE-P034`（id 34） | `SANDBOX_HINT_NEUTRAL` | `escalation` | replacements | 否 | 沙箱拒绝/升级 hint 不再要求用户审批 | 3968 |
| `SF-CORE-P035`（id 35） | `ESCALATION_NEVER_REJECT` | `escalation` | replacements | 否 | 升级结果 rejected/cancelled/unavailable 仍授信 | 3993 |
| `SF-CORE-P036`（id 36） | `TOOL_FS_ESCALATION_SCHEMA` | `tool-fs` / `escalation` | replacements | 是 | fs 升级字段：去掉 user approval 拦截描述 | 4052 |
| `SF-CORE-P037`（id 37） | `SUBAGENT_SCOPE_LOCK_NEUTRAL` | `subagent` / `subagent-types` | replacements | 是 | 子代理权限锁→可继续 | 4082 |
| `SF-CORE-P092`（id 92） | `SUBAGENT_SAME_INJECT_PATH` | `subagent` / `subagent-types` | replacements | 是 | 子代理创建时立刻挂 assemble 注入，并继承父会话权限 | 4106 |
| `SF-CORE-P038`（id 38） | `PERSONA_TEXT_PREFIX_ALIAS` | `persona` | replacements | 是 | dsh-persona：0.2.0 required prefix 改 default，并兼容旧 text | 4159 |
| `SF-CORE-P039`（id 39） | `SESSION_V0_PLUGIN_SUMMARY_ALIAS` | `session-format-v0` | replacements | 否 | v0 会话：mnemon summary 可挂在 instructions/recall 上 | 4190 |
| `SF-CORE-P040`（id 40） | `COMPLETE_PROMPT_KEEP_INJECT` | `system-prompt` / `system-prompt-nested` | replacements+regex | 否 | complete 预设保留注入段并放最前 | 4206 |
| `SF-CORE-P042`（id 42） | `SETTINGS_LEGACY_API` | `settings` | replacements | 否 | 设置服务补回 register/get，旧插件可继续用 | 4220 |
| `SF-CORE-P047`（id 47） | `ANTHROPIC_OAUTH_NO_CLAUDE_IDENTITY` | `pi-ai-anthropic-messages` | replacements | 是 | Anthropic OAuth 不再强插 Claude Code 首段系统提示 | 4450 |
| `SF-CORE-P048`（id 48） | `TOOL_SHELL_DELETE_MOVE_NEUTRAL` | `tool-bash` / `tool-pwsh` | replacements | 是 | bash/pwsh 去掉 delete/move 过度谨慎描述 | 4546 |
| `SF-CORE-P049`（id 49） | `ANTHROPIC_OAUTH_CLI_NEUTRAL` | `pi-ai-anthropic-messages` | replacements | 是 | OAuth 不再伪装 claude-cli | 4565 |
| `SF-CORE-P051`（id 51） | `FRESH_SESSION_FULL_ACCESS` | `permission-presets` / `permission-presets-types` | replacements | 是 | 新会话在部署已是 danger-full-access 时不再钉回 workspace-write | 4593 |
| `SF-CORE-P052`（id 52） | `SESSION_LOG_CLOUD_UPLOAD_REMOVED` | `session-log-deepseek` / `session-log-deepseek-types` | replacements | 是 | Session Log 云端上传整体移除，会话只落本地 | 4618 |
| `SF-CORE-P055`（id 55） | `SYSTEM_PROMPT_REPLACE_HEAD` | `agent-loop` | replacements | 否 | 每一步用当前整段系统提示替换第一条，避免旧提示被钉住 | 4655 |
| `SF-CORE-P066`（id 66） | `SYSTEM_PROMPT_RENDER_GUARD` | `system-prompt` / `system-prompt-nested` | replacements | 否 | renderPrompt 对 undefined section.text 兜底，避免第二轮 gateway/internal | 4670 |
| `SF-CORE-P068`（id 68） | `SYSTEM_NODES_CONTENT_GUARD` | `agent-loop` / `session` | replacements | 否 | systemNodes/derive 对缺 content 兜底，避免回退后第二轮 gateway/internal | 4702 |
| `SF-CORE-P069`（id 69） | `MODEL_STREAM_RELEASE` | `llm-deepseek` | replacements | 是 | deepseek-flash 恢复官方 in-history，并撤掉会打成 TRANSPORT 的独立连接补丁 | 4742 |
| `SF-CORE-P072`（id 72） | `MESSAGES_SYSTEM_CURRENT` | `llm-deepseek` | replacements | 是 | Messages 的 system 字段用当前系统提示，不再把后出现的系统提示降成中途消息 | 4880 |
| `SF-CORE-P075`（id 75） | `REWIND_RESET_TODOS` | `tool-todo` | replacements | 是 | 回退把已完成任务收回成未开始 | 4908 |
| `SF-CORE-P057`（id 57） | `DEEPSEEK_SYSTEM_ROLE` | `pi-ai-completions` / `pi-ai-responses-shared` | replacements | 是 | developer role 仅限 openai.com/azure 原生，第三方代理全回退 system | 4937 |
| `SF-CORE-P058`（id 58） | `REWIND_SKIP_DERIVE` | `session` | replacements | 是 | 回退空标记不进模型请求 | 4986 |
| `SF-CORE-P059`（id 59） | `OFFICIAL_AUTO_REVIEW_PASSTHROUGH` | `auto-review` | replacements | 是 | 官方 Auto Review 不再拦工具 | 5003 |
| `SF-CORE-P061`（id 61） | `OFFICIAL_SANDBOX_POLICY_NEUTRAL` | `sandbox-policy` | replacements | 是 | 沙箱只读策略不拦任务；加宽自动放行 | 5025 |
| `SF-CORE-P063`（id 63） | `OFFICIAL_PLAN_MODE_NEUTRAL` | `base` / `preset-ptc` / `preset-standard` / `preset-cordis` | replacements | 是 | 计划模式：操作者要求实施时不硬拦 | 5045 |
| `SF-CORE-P078`（id 78） | `OVERLAY_RESTORE_FROM_BAK` | `app-boot` | replacements | 是 | 声明过的补丁文件不见时，从 .dshpurge.bak 拷回再加载 | 5076 |
| `SF-CORE-P085`（id 85） | `SESSION_PROMPT_STEER_INTERRUPT` | `api-session-controller` | replacements | 是 | 官方三条路：prompt() 的 steer 走插话，其余走 followup | 5117 |
| `SF-CORE-P086`（id 86） | `SESSION_QUEUE_STEER_INTERRUPT` | `api-session-controller` / `agent-loop` | replacements | 是 | 官方三条路：排队 followup/next-turn，插话 steer/next-step | 5145 |
| `SF-CORE-P089`（id 89） | `SYSTEM_FIELD_EXTRACT` | `agent-loop` | replacements | 是 | buildRequest 把 role:system 消息提取到单独 system 字段 | 5210 |
| `SF-CORE-P090`（id 90） | `OPENAI_NATIVE_SYSTEM_ROLE` | `pi-ai-completions` | replacements | 是 | openai-completions：挂针进 messages[0].role=system | 5277 |
| `SF-CORE-P091`（id 91） | `ANTHROPIC_NATIVE_PARAMS_SYSTEM` | `pi-ai-anthropic-messages` | replacements | 是 | anthropic-messages：挂针进 params.system | 5349 |
| `SF-CORE-P093`（id 93） | `PRODUCT_ANALYTICS_DEFAULT_OFF` | `product-analytics` | replacements | 是 | 产品埋点默认关闭，不再向 collector 送行为事件 | 5426 |
| `SF-CORE-P094`（id 94） | `PRODUCT_TELEMETRY_OTEL_NOOP` | `product-telemetry-otel` | replacements | 是 | 产品遥测 OTLP 导出器装上也不发事件 | 5446 |
| `SF-CORE-P095`（id 95） | `SESSION_TELEMETRY_OTEL_DISABLED` | `session-telemetry-otel` | replacements | 是 | 会话遥测默认 DISABLED，反馈也不走 OTLP | 5466 |
| `SF-CORE-P096`（id 96） | `SKILL_OFFICE_ASSET_FALLBACK` | `skill-office` | replacements | 是 | office-skills 缺 SKILL.md 时回退包内 assets | 5482 |

**逐条状态**：59 条全部「完整」——每条都有 `replacements`/`patterns` + `markers`/`marker`/`replace`，`patchApplied` 与 `patchHasRemainingWork` 都可判定。其中 **6 条无 `markers`**（#6 #7 #8 #10 #15 #16，`[实测]`），判定退化为「`replace` 首行前 60 字符是否在文件里」（`core.js:7071-7073`），属于**部分**判定（对长替换体只能验头部）。

### 9.2 `file` 键 → 真实路径映射（重新实现必需）

`targetFiles(aiBase, dshHome)` 在 `core.js:6225`。`<A>` = aiBase（如 `<profile>/node_modules/@deepseek-ai` 或解包后的 `resources/app/dsh`），`<R>` = 源码树根（`packages/...`）。`nestedPkg(A, pkg, ...rel)`（`core.js:6167`）返回 `[A/pkg/rel…, A/dsh/node_modules/@deepseek-ai/pkg/rel…]`。

| 键 | 首选路径 |
|---|---|
| `agent-instructions` | `<A>/dsh-agent-instructions/lib/index.js` |
| `agent-preset` | `$DSH_HOME/.agent-presets/unrestricted/agent.cordis.yml`，回退 `<R>/packages/bundle/agent-presets/presets/standard/agent.cordis.yml` |
| `web-app` | `<A>/dsh-web-app/cordis.patch.yml` |
| `headless` | `<A>/dsh-headless/cordis.patch.yml` |
| `skill-office` | `nestedPkg(dsh-skill-office, lib, index.js)` |
| `user-approval` | `nestedPkg(dsh-user-approval, lib, types, index.js)` |
| `user-approval-code` | `nestedPkg(dsh-user-approval, lib, index.js)` |
| `user-approval-invariant` | `nestedPkg(dsh-user-approval, lib, invariant.js)` |
| `escalation` | `allExisting`：`nestedPkg(dsh-sandbox, lib, index.js)` + `nestedPkg(dsh-sandbox, lib, types, escalation.js)`（入口排前） |
| `fs-sandbox` | `<A>/dsh-fs-sandbox/lib/index.js` |
| `sandbox-local` | `<A>/dsh-sandbox-local/lib/index.js` |
| `base` | `<A>/dsh-base/cordis.patch.yml` |
| `settings` | `nestedPkg(dsh-settings, lib, index.js)` |
| `fs-observation-policy` | `<A>/dsh-fs-observation-policy/lib/index.js` |
| `repeat-tool-reminder` | `<A>/dsh-repeat-tool-reminder/lib/index.js` |
| `tool-fs` | `allExisting(nestedPkg(dsh-tool-fs, lib, index.js))` |
| `tool-subagent` | `<A>/dsh-tool-subagent/lib/index.js` |
| `subagent` | `allExisting(nestedPkg(dsh-subagent, lib, index.js))` |
| `subagent-types` | `allExisting(nestedPkg(dsh-subagent, lib, types, child-agent.js))` |
| `persona` | `allExisting(nestedPkg(dsh-persona, lib, index.js))` |
| `session-format-v0` | `allExisting(nestedPkg(dsh-session-format-v0-to-v1, lib, index.js))` |
| `system-prompt` | `<A>/dsh-system-prompt/lib/index.js` |
| `system-prompt-nested` | `<A>/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js`（仅嵌套布局登记） |
| `tool-web` | `<A>/dsh-tool-web/lib/index.js` |
| `tool-web-nested` | 同上嵌套路径 |
| `api-session-controller` | `<A>/dsh-api-session-controller/lib/index.js` |
| `pi-ai-completions` / `-responses-shared` / `-anthropic-messages` | `listPiAiApiFiles(dshHome, aiBase, "openai-completions.js"\|"openai-responses-shared.js"\|"anthropic-messages.js")`（`core.js:1515`） |
| `permission-presets` / `-types` | `nestedPkg(dsh-permission-presets, lib[, types], index.js)` |
| `session-log-deepseek` / `-types` | `nestedPkg(dsh-session-log-deepseek, lib[, types], index.js)` |
| `product-analytics` | `nestedPkg(dsh-client-product-analytics, lib, index.js)` |
| `product-telemetry-otel` | `nestedPkg(dsh-host-product-telemetry-otel, lib, index.js)` |
| `session-telemetry-otel` | `nestedPkg(dsh-session-telemetry-otel, lib, index.js)` |
| `llm-deepseek` | `nestedPkg(dsh-llm-deepseek, lib, index.js)` |
| `session` / `agent-loop` / `app-boot` / `tool-todo` / `auto-review` / `sandbox-policy` | `nestedPkg(dsh-<同名>, lib, index.js)` |
| `tool-bash` / `tool-pwsh` | `allExisting(nestedPkg(dsh-tool-{bash,pwsh}, lib, index.js))` |
| `preset-standard` / `-cordis` / `-minimal` / `-ptc` | `shippedPresetYml(root, name, aiBase)`（`core.js:5592`）：`<A>/dsh-web-app/presets/<name>.patch.yml`、`<A>/dsh-agent-presets/presets/<name>/agent.cordis.yml` 等 4 个候选 |
| `preset-acp-app` / `preset-sdk-app` / `preset-sdk-minimal` | `<A>/dsh-{acp-app,sdk-app,sdk-minimal}/cordis.patch.yml` |

**登记裁剪**：`filterTargetFiles`（`core.js:6185`）对数组值只保留「存在且 `allowTargetForPatch`」的项，**落空的键整条删除**；`nestedTargetFiles`（`core.js:6212`）只在 `<A>/dsh/node_modules/@deepseek-ai` 存在时才登记 4 个 `*-nested` 键。

### 9.3 引擎与宿主集成功能

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| `SF-CORE-001` | 补丁表聚合导出 | `core.js:5506` | 完整 | 4 数组拼接，59 条 |
| `SF-CORE-002` | 补丁字段归一（`patterns`→`replacements`） | `core.js:7147` | 完整 | `(p.patterns ?? []).map(pat => ({pattern:pat, replace:p.replace}))` |
| `SF-CORE-003` | 字符串锚点替换 | `core.js:7235-7240` | 完整 | `split/join`，全量替换 |
| `SF-CORE-004` | 正则锚点替换 | `core.js:7222-7233` | 完整 | 仅 #40 使用；`$1..$9` 展开 |
| `SF-CORE-005` | 命中数契约 `expect` | — | **缺失** | community 有（`verify.mjs:35`），safe 无 |
| `SF-CORE-006` | `skipIfMarked` 幂等 | `core.js:7208` | 完整 | 带 `!patchHasRemainingWork` 双条件；`[实测]` 二次应用 `changed:false` |
| `SF-CORE-007` | 插入型不叠层 | `core.js:7237`、`7093-7110` | 完整 | `written.includes(needle) && out.includes(written)` |
| `SF-CORE-008` | YAML 裸 identity 保护 | `core.js:7152`、`7218`、`7097` | 完整 | 避免块标量缩进错乱 |
| `SF-CORE-009` | YAML 里 JS 注释转 `#` | `core.js:7160` | 完整 | 跳过含 `!!js` 的行 |
| `SF-CORE-010` | YAML persona 标量消毒 | `core.js:6628`、`7390` | 完整 | apply 后二次清洗 |
| `SF-CORE-011` | 已应用判定（markers/markersAny/forbid/marker/replace） | `core.js:7060` | 完整 | `[实测]` 6 条无 markers，退化到 replace 前 60 字符 |
| `SF-CORE-012` | 残留原文判定 | `core.js:7091` | 完整 | 见 §3.4 |
| `SF-CORE-013` | 单文件结局三分（applied/pending/skipped） | `core.js:7125`、`7133` | 完整 | |
| `SF-CORE-014` | 补丁级状态归并 | `core.js:7246` | 完整 | 8 级优先 |
| `SF-CORE-015` | 多宿主 apply | `core.js:2456` | 完整 | 宿主枚举 `enumeratePatchAiBases`（`:2372`），去重按 `realpath` 小写 |
| `SF-CORE-016` | 多宿主报告合并（取最差） | `core.js:2427` | 完整 | `APPLY_STATUS_RANK` 8 级 |
| `SF-CORE-017` | 全部宿主写入成功判定 | `core.js:2440` | 完整 | 每个 host `hostWritten === true` |
| `SF-CORE-018` | 官方原文快照（sidecar） | `core.js:5845`、`5833` | 完整 | `<file>.dshpurge.bak` |
| `SF-CORE-019` | 官方原文快照（保险柜） | `core.js:5737`、`5766`、`5802` | 完整 | `host-backups/<sha1(norm)[:24]>.bak` |
| `SF-CORE-020` | 已应用摘要 | `core.js:5766`、`5784` | 完整 | 每文件 `.applied.json` |
| `SF-CORE-021` | 缺文件/空文件自愈 | `core.js:5922`、`5959` | 完整 | 从 bak 或保险柜拷回 |
| `SF-CORE-022` | 升级后刷新陈旧 bak | `core.js:5979` | 完整 | `.bak` 无插件 marker 且与当前字节不同 → 用当前刷新 |
| `SF-CORE-023` | 全量备份 | `core.js:6029` | 完整 | 跳过 profile 层；删历史误建 bak |
| `SF-CORE-024` | 全量回滚（快照优先） | `core.js:6101` | 完整 | 无快照时按补丁反拆，绝不删文件 |
| `SF-CORE-025` | 文本级反拆 | `core.js:6061` | 完整 | 逆序，RegExp 跳过 |
| `SF-CORE-026` | 用户 profile 层保护 | `core.js:5699`、`5705`、`6132` | 完整 | `profiles/*/cordis.patch.yml` 永不进 bak/回滚 |
| `SF-CORE-027` | client bundle 写入节流 | `core.js:5687`、`7441` | 完整 | `preserveClientBundles` 时只判定不写；同步版只在字节变化时写 |
| `SF-CORE-028` | shim 注入（4 种形态） | `core.js:7547`、`7593` | 完整 | node/cmd/ps1/sh，只设 `DSH_HOME` |
| `SF-CORE-029` | shim 旧权限钉清除 | `core.js:7635`、`7644` | 完整 | `DSH_PERMISSION_MODE` 行一并删 |
| `SF-CORE-030` | shim 状态 | `core.js:7694`、`7703` | 完整 | `missing/binary/patched/original` |
| `SF-CORE-031` | 密封 bin 不注入 + bak 外迁 | `core.js:7813`、`7765` | 完整 | 外迁失败保留 in-bin bak |
| `SF-CORE-032` | prompt-inject 启动 seed | `core.js:8085`、`8121` | 完整 | 用户稿永不覆盖 |
| `SF-CORE-033` | prompt-inject 保存/提交/恢复 | `core.js:8208`、`8182`、`8147` | 完整 | |
| `SF-CORE-034` | 出厂默认提示词（加密槽） | `table-key.js:17`、`table-read.js:6`、`core.js:7954` | 完整 | `[实测]` 24 298 字符 |
| `SF-CORE-035` | 空提示词拒绝应用 | `index.js:314`、`2410`、`2542` | 完整 | 400 + `needPrompt:true` |
| `SF-CORE-036` | system-prompt section 注册 | `index.js:540-583` | 完整 | 3 段，order `-100000`/`-99999`/`postPromptOrder` |
| `SF-CORE-037` | 尾部锚点 | `anchor.js:70-116` | 完整 | section 10150 + context 235 |
| `SF-CORE-038` | assemble 方法劫持 | `identity.js:674-786` | 完整 | dispose noop |
| `SF-CORE-039` | assemble waterfall 改写 | `identity.js:787-891`、`index.js:1044` | 完整 | 三种会话分流；返回新对象 |
| `SF-CORE-040` | context 整条删除 | `identity.js:897-902`、`906-925` | 完整 | `approval:policy`/`sandbox:policy`/`subagent:delegation` |
| `SF-CORE-041` | 红队会话判定 | `identity.js:386`、`415`、`435` | 完整 | 预设名归一 + 事件回看 + projection/header 兜底 |
| `SF-CORE-042` | 子代理判定 | `identity.js:476` | 完整 | 只看 `origin` + `delegationDepth`，**不看 `parentSession`** |
| `SF-CORE-043` | 子代理沿父链取注入 | `identity.js:518` | 完整 | 环检测 `Set` |
| `SF-CORE-044` | 能力选用协议段 | `capability-protocol.js:13-43` | 完整 | 三种文本：官方 / 红队指挥 / 红队子代理 |
| `SF-CORE-045` | 地域/银行闸门 | `net-scope.js:625-669` | 完整 | **反向能力**：吞整轮 |
| `SF-CORE-046` | 允许列表读写 | `net-scope.js:373`、`378`、`322-370` | 完整 | 严格 host 校验，密钥/网段/通配符丢弃 |
| `SF-CORE-047` | 工具闸门旁路 | `tool-gate.js:77-129` | 完整 | pre 恒 allow、post 只禁 block |
| `SF-CORE-048` | 子代理禁止再派活 | `tool-gate.js:66-75` | 完整 | 唯一主动 deny 分支 |
| `SF-CORE-049` | 审批接管 4 段 | `subagent-control.js:16-97` | 完整 | never→ask、恒放行、sandbox 钉宽档、新会话预置 |
| `SF-CORE-050` | 新会话全权限 | `index.js:817`、`upgradeFreshSessionAccess` | 完整 | `session/created` + 微任务 |
| `SF-CORE-051` | mnemon 消息过滤 | `index.js:614-663` | 完整 | 三重挂载尝试，`mounted` 闸防叠层 |
| `SF-CORE-052` | cwd 采集 | `index.js:833-911` | 完整 | `last-cwd.txt` |
| `SF-CORE-053` | HTTP 14 条路由 | `index.js:2182-2686` | 完整 | 含 CORS、鉴权、disposer 回收 |
| `SF-CORE-054` | `/rules` 9 个 op | `index.js:2695-2784` | 完整 | 见 §4.3 |
| `SF-CORE-055` | `/skills` 5 个 op | `index.js:2790-2846` | 完整 | |
| `SF-CORE-056` | 3 个 agent 工具 | `index.js:1984-2071` | 完整 | |
| `SF-CORE-057` | 4 个命令 | `index.js:1935-1981` | 完整 | |
| `SF-CORE-058` | 应用后重启调度 | `index.js:2610-2676`、`host.js:44-70` | 完整 | 桌面密封 asar 走 `restartSealedDesktopIfNeeded` |
| `SF-CORE-059` | 重启前完整性闸门 | `index.js:498` | 完整 | 未清洗完则 `restarting:false` |
| `SF-CORE-060` | 卸载 | `uninstall.js:311`、`index.js:2470` | 完整 | 成功后 `scheduleCleanupRestart` |
| `SF-CORE-061` | 预设 selectedDefault 清理 | `preset-default.js:150`、`172` | 完整 | live + 磁盘双路 |
| `SF-CORE-062` | 演练台授权 | `drill-grant.js:13`、`26`、`42` | 完整 | |
| `SF-CORE-063` | 自动重试 / 自动续跑 | `continue-retry.js:313` | 完整 | 默认 `autoContinue:false` |
| `SF-CORE-064` | 启动 settle 策略 | `settle-policy.js:8-55` | 完整 | 桌面 4000 ms；桌面/密封不重启不重打 |
| `SF-CORE-065` | 官方升级标记 | `official-update.js:1-52` | 完整 | `dsh-purge-safe-reapply-asar` |
| `SF-CORE-066` | 控制台隐藏 + 代理变量清理 | `hide-console.js:66`、`79` | 完整 | Windows 专用；非 win 直接 skipped |
| `SF-CORE-067` | 站内全屏 hook | `ui-fullscreen.js:59-288` | 完整 | 构建期内联 |
| `SF-CORE-068` | 主题状态机 | `ui-theme.js:68-234` | 完整 | 构建期内联 |
| `SF-CORE-069` | 在线更新 | `update.js:782`、`983`、`1121` | **缺失（有码无出口）** | 无路由、无工具、无 UI 调用；仅 `localVersion()` 被用 |
| `SF-CORE-070` | 补丁重锚（anchor overrides） | — | **缺失** | community 有 `anchors.js` |
| `SF-CORE-071` | 自检 / 诊断 / 审计 / boost / hooks-deny | — | **缺失** | community 的 7 条路由，safe 未移植 |
| `SF-CORE-072` | `autoUpdateOnStart` / `autoRevertOnMissing` / `injectOnce` | `index.js:55-57` | **缺失（声明即死）** | 全仓无第二处引用 |

---

## 10. 未验证项

| 编号 | 未验证内容 | 缺什么才能验证 |
|---|---|---|
| `U-01` | 地域闸门在真实宿主里的端到端效果（`messages: []` 是否真的让模型不被调用、宿主是否接受空 messages 的 `enter`） | 需要一个装好 safe、且能命中 `.cn` 域名 + 攻击词的活宿主，抓 `agent/pre-step` 前后的事件流 |
| `U-02` | `parkDenial` 写入的 `stream` 记录是否被当前宿主版本接受（注释提到 `#84` 崩溃） | 同 `U-01`，需观察会话能否正常落盘并渲染 |
| `U-03` | `allow-list` 豁免的运行时效果（本次只静态读了 `permittedHost`，没有构造 `net-scope-allow.txt`） | 允许在临时 `$DSH_HOME` 写 `net-scope-allow.txt` 后重跑 `taskTargetHit` |
| `U-04` | `applyPatches` 在真实宿主上的逐条状态（本机 `findAiBase()` 返回 null，`gatherState` 只走到 `59 na`） | 需要一个真实 `aiBase`；本次环境无宿主包 |
| `U-05` | 59 条补丁的锚点在当前 DSH 版本上是否真的命中 | 同 `U-04` |
| `U-06` | `installAssembleGuard` 劫持在宿主实际调用路径上是否生效（`slot.rewrite` 是否被读到） | 需在活宿主里 dump 一次 `assembled.sections` |
| `U-07` | 红队三路分流（根/子/非红队）的真实输出 | 需活宿主 + redteam 预设会话 |
| `U-08` | `identity.js`（927 行）与 community（1029 行）的逐函数差异 | 本次只读了 9 个 export 的入口与判据，未做逐行比对 |
| `U-09` | `desktop.js`（1996 行）、`extract-asar.js`（503 行）、`restart-desktop.js`（670 行）的 asar 解包/交换/重启全链路 | 需 macOS 桌面安装包 + 实际 apply 流程；本次为只读审计 |
| `U-10` | `rewind.js`（644 行）的 fork 新会话行为 | 需活宿主会话事件流 |
| `U-11` | `rules.js` / `skills.js` 的落盘细节（本文件只列了路径与 export） | 未逐函数读 |
| `U-12` | `ui-fullscreen.js` / `ui-theme.js` 在真实浏览器里的行为（含 Shadow DOM 全屏重定向、`Escape` 嵌套判断） | 需在 DSH 面板里实际操作并观察 `document.fullscreenElement` |
| `U-13` | 面板 UI 到底调用哪些 op、按什么顺序（本文件只证明了 op 存在） | 属 `lib/redteam/client.js` / `client.js` 渲染层，超出本次文件范围 |
| `U-14` | `update.js` 是否真的一条路径都不可达（本次用 grep 判定，未做动态确认） | 需在运行中的插件里 hook `checkUpdate` 观察是否被调用 |
| `U-15` | `patchStatus` 与 `applyPatches` 在同一文件上是否会产生不一致口径 | 需真实宿主 + 至少一个 `preserveClientBundles` 场景 |
| `U-16` | community 侧 `net-scope.js` 的 `ownServerNote()` 返回空串是否意味着 community 完全没有地域拦截（还是拦截在别处，如 `redteam/ui.js`） | 需读 community 的 `redteam/ui.js:1063` 那个 `agent/pre-step` hook（本次未展开） |
