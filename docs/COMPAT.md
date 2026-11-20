# 宿主兼容性验证报告

> 对象：`dsh-purge-plus` 1.7.20-plus.1（基座 `dsh-purge-community` 1.7.20 + `overlay/`）
> 宿主：DeepSeek Harness Desktop `0.2.2-rc.5`
> 结论：**有条件能上机**（无硬阻塞；3 个条件、4 项风险，见 §7）

---

## 0. 环境与口径

### 0.1 两侧版本（实测，非推测）

| 侧 | 项 | 值 | 证据 |
|---|---|---|---|
| 宿主 | 外层运行时 | `@deepseek-ai/dsh-desktop-runtime` **0.2.2-rc.5** | `Contents/Resources/app/dsh/package.json` |
| 宿主 | 内层主包 | `@deepseek-ai/dsh` **0.2.2-rc.5** | 同上 `dependencies` |
| 宿主 | cordis | `@deepseek-ai/cordis` **4.1.0** | 同上 `dependencies` |
| 宿主 | Electron 壳 | `@deepseek-ai/dsh-desktop` 0.2.2-rc.5，`dshBuildCommit=3f85d888b1297107937d9bd5b853f7e733e179a4` | `Contents/Resources/app/package.json` |
| 宿主 | 插件根 | `/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai` | `dsh-purge --status` 实测 |
| 宿主 | 现状 | 66 个 `*.dshpurge.bak`；含 `dsh-purge` 标记的文件：`@deepseek-ai` 内 **43** 个、`Resources/app` 下 **47** 个、整份 `Resources` 下 **48** 个。差额明细：`@earendil-works/pi-ai/dist/api/{openai-responses-shared,anthropic-messages,openai-completions}.js`（#57 目标）+ `app/lib/main.js`，以及 `Resources/runtime/cli/bin/dsh`（shim） | `find` / `grep -rl` |
| 插件 | 版本 | `dsh-purge-plus@1.7.20-plus.1` | `dist/build/package/package.json` |
| 插件 | 产物 | `dsh-purge-plus-1.7.20-plus.1.tgz`，sha256 `2659cc31f83b2f56dab7025ab66a617fbef7c90d99c29587775d3bdb1088651f` | `shasum -a 256`，与 `dist/SHA256SUMS.txt` 逐字一致 |
| 插件 | 产物完整性 | 解包 378 文件，`diff -rq` 与 `dist/build/package` **完全一致** | `tar xzf` + `diff -rq` |
| profile | 包管理器 | pnpm **11.28.5**，`nodeLinker: hoisted`，lockfile `9.0` | `~/.dsh/profiles/desktop/node_modules/.modules.yaml:566-567`、`pnpm-lock.yaml:1` |

### 0.2 验证时间

2026-11-20 14:57 – 15:07（+08:00）。

### 0.3 用到的命令（全部只读）

```bash
# 状态 / 漂移（不写宿主）
DSH_SURFACE=desktop node bin/dsh-purge.js --status
DSH_SURFACE=desktop DSH_BASE=<aiBase> node bin/community.js diagnose

# 锚点逐条核算：用插件自己的纯函数 applyReplacementsToText 跑在 live 文件文本上
node /tmp/anchor-audit.mjs        # 只 fs.readFileSync + 纯字符串运算

# 入口加载（模拟 profile 解析上下文）
cp -R dist/build/package /tmp/dsh-compat-ctx/node_modules/dsh-purge-community
node -e 'import("dsh-purge-plus")'          # 见 §1
createRequire("/tmp/.../package.json").resolve("dsh-purge-community/redteam")   # 见 §6

# 上游对照
curl api.github.com/repos/deepseek-ai/deepseek-harness/git/trees/dsh-v0.2.2-rc.5?recursive=1
curl raw.githubusercontent.com/.../dsh-v0.2.2-rc.5/<path>   # 5 个 yml，见 §5
```

**没有执行**：`--apply` / `--revert` / `--uninstall`、`plugin_manager` 的 install/set、任何 `pnpm`/`npm` 写入 profile、任何重启。

### 0.4 只读性自证

跑前跑后各做一次 `stat -f '%m %z %N'` 全量快照（宿主 `app/dsh` + `app/lib` 的 js/yml/json，加 `~/.dsh` 三层内所有文件，共 9784 条），`diff` 结果只有两条：

```
< 1795157971 59 /Users/wheming/.dsh/dsh-purge/last-cwd.txt
> 1795158348 59 /Users/wheming/.dsh/dsh-purge/last-cwd.txt
    <mtime 变化> /Users/wheming/.dsh/mobile-gateway-devices.json
```

两条都**不是本报告的命令写的**，依据：

- `last-cwd.txt` 内容为 `/Users/wheming/Documents/deepseek-harness/default-workspace`（本会话 cwd），而我的 CLI 全部以 `dist/build/package` 为 cwd 运行 —— 若是 CLI 写的，内容会是那个目录。写它的三处调用点都在运行期钩子里：`lib/index.js:578`（`system-prompt/assemble`）、`lib/index.js:666`（`session/created`）、`lib/index.js:2760`（HTTP 路由）；`gatherState` / `patchStatusDetail` / `readPatchReport` 路径上没有任何 `writeFile`（`lib/core.js:4678-4780`，`lib/permission-migration.mjs:121-160` 的 `save` 入参在此路径为 `undefined`）。
- `mobile-gateway-devices.json` 属 `dsh-plugin-mobile-gateway` 的心跳，与 purge 无关。

宿主侧：66 个 `.dshpurge.bak` 数量未变，`dsh-purge` 标记文件数未变。

---

## 1. 插件入口加载

### 1.1 声明（`dist/build/package/package.json`）

```json
"type": "module",
"main": "lib/index.js",
"exports": {
  ".": { "default": "./lib/index.js" },
  "./client": "./client.js",
  "./redteam": "./lib/redteam/index.js",
  "./redteam/store": "./lib/redteam/store.js",
  "./redteam/ui": "./lib/redteam/ui.js",
  "./redteam/tools": "./lib/redteam/tools.js",
  "./package.json": "./package.json",
  "./presets-plugin": "./lib/presets-plugin.js"
},
"bin": { "dsh-purge": "bin/dsh-purge.js", "purge-community": "bin/community.js" },
"dsh": { "bundle": { "patch": "./cordis.patch.yml" }, "client": { ... } }
```

### 1.2 实际导出（不是猜的）

在「profile 里已安装」的解析上下文下 `import("dsh-purge-plus")` 的实际输出：

```
exports: allowPluginRequest, apply, default, inject, installCommands,
         installHungPromptGlobal, installIdentityOverride, installMnemonMessageStrip,
         installWebServer, name, registerPromptSections, rewriteLiveAssembly, trustedHostnames
name:   "dsh-purge-plus"
inject: ["systemPrompt","tools"]
typeof apply: function
default type: object | keys: apply, inject, name
default.name: "dsh-purge-plus" | typeof default.apply: function | default.inject: ["systemPrompt","tools"]
```

- `export const name = "dsh-purge-plus"` —— `lib/index.js:56`
- `export const inject = ["systemPrompt", "tools"]` —— `lib/index.js:60`
- `export function apply(ctx, config)` —— `lib/index.js:1485`
- `const plugin = { name, inject, apply }; export default plugin;` —— `lib/index.js:3015-3019`

Cordis 的加载器两种形状都吃（具名 `apply` 或 `default` 对象），这里两者一致，不存在歧义。

### 1.3 一个必须说清的加载细节

直接在 `dist/build/package` 里 `node -e 'import("./lib/index.js")'` 会失败：

```
ERR_MODULE_NOT_FOUND: Cannot find package 'yaml' imported from .../lib/yaml-runtime.mjs
源码安装缺少 yaml。请在插件源码根目录（含 package-lock.json）运行 npm ci --omit=dev --ignore-scripts。
```

这是**预期行为**，不是缺陷：`yaml@2.9.1` 是 `package.json` 的正式 `dependencies`，`files` 白名单里没有 `node_modules`，所以 tgz 不带依赖，装进 profile 时由包管理器补。本机 profile 根部已 hoist `yaml@2.9.1`（`~/.dsh/profiles/desktop/node_modules/yaml`），补上后 import 一次通过。

**判定：入口形状合格。**

---

## 2. 宿主 API 依赖矩阵

扫描范围：`dist/build/lib/` 下除 `lib/patches/` 以外的运行期文件（`lib/patches/*.mjs` 里的 `ctx.xxx` 是**补丁锚点字符串**，不是调用）。

调用面统计：`ctx.get` 39 处、`ctx.effect` 29 处、`ctx.on` 27 处、`ctx.logger` 16 处、`ctx.inject` 3 处、`ctx.provide` 2 处。

### 2.1 服务（`ctx.get(...)` / `inject` 声明）

| API / 服务 | 插件用处（文件:行号） | 宿主是否存在（文件:行号） | 判定 |
|---|---|---|---|
| `systemPrompt` | `lib/index.js:60`（inject 声明） | `dsh-system-prompt/lib/index.js:228` `super(ctx,"systemPrompt")` | ✅ 存在 |
| `tools` | `lib/index.js:60`；`lib/index.js:1715/1736/1772`（`ctx.tools.register`） | `dsh-tools/lib/index.js:417` `super(ctx,"tools")` | ✅ 存在 |
| `webServer` | `lib/index.js:1546`、`lib/index.js:2016`（`ctx.inject(["webServer"], …)`） | `dsh-host-webserver/lib/index.js:335` `super(ctx,"webServer")` | ✅ 存在 |
| `commands` | `lib/index.js:1805`（`ctx.inject(["commands"], …)`） | `dsh-commands/lib/index.js:259` `super(ctx,"commands")` | ✅ 存在 |
| `agentPresets` | `lib/identity.js:501`、`lib/preset-injection.js:71`、`lib/redteam/index.js:502`、`lib/redteam/tools.js:641` | `dsh-agent-preset-registry/lib/index.js:456` `super(ctx,"agentPresets")` | ✅ 存在 |
| `agents` | `lib/preset-injection.js:71` | `dsh-agent/lib/index.js:450` `super(ctx,"agents")` | ✅ 存在 |
| `sessions` | `lib/redteam/ui.js:334`、`lib/redteam/ui.js:917` | `dsh-session/lib/index.js:1822` `super(ctx,"sessions")` | ✅ 存在 |
| `subagents` | `lib/redteam/tools.js:305`、`lib/redteam/ui.js:333`、`lib/redteam/ui.js:916` | `dsh-subagent/lib/index.js:2976` `super(ctx,"subagents")` | ✅ 存在 |
| `skills` | `lib/redteam/tools.js:529` | `dsh-skill/lib/index.js:132` `super(ctx,"skills")` | ✅ 存在 |
| `sessionPersistence` | `lib/steering.js:30,33`（补丁源文本） | `dsh-session-persistence/lib/index.js:265` `super(ctx,"sessionPersistence")` | ✅ 存在 |
| `connection` | `lib/index.js:1960` | `dsh-client-connection/lib/index.js:710` `super(ctx,"connection")` | ✅ 存在 |
| `approval` | 仅补丁锚点 `lib/patches/new-tools.mjs:2104`（运行期不直接取） | `dsh-user-approval/lib/index.js:97` `super(ctx,"approval")` | ✅ 存在 |
| `desktopRuntime` | `lib/desktop.js:799` `ctx.get("desktopRuntime") \|\| ctx.get("desktopActions")` | **`grep -rn` 全 `Contents/Resources` 为 0 命中** | ⚠️ 宿主没有；**有守卫**：`ctx.get` 非严格取值返回 `undefined`（`cordis/lib/index.js:1347-1349`），`desktopRuntimeOf()` 随后 `if (!runtime \|\| typeof runtime.requestRestart !== "function") return null`，调用方全部判空 |
| `desktopActions` | 同上 `lib/desktop.js:799` | **0 命中** | ⚠️ 同上，非阻塞 |

### 2.2 事件（`ctx.on(...)`）

| 事件 | 插件用处（文件:行号） | 宿主侧派发/监听（文件:行号） | 判定 |
|---|---|---|---|
| `tools/pre-execute` | `lib/subagent-fence.js:63`（`{global:true,prepend:true}`） | `dsh-tools/lib/pipeline.js:386` `this.ctx.waterfall(carrier,"tools/pre-execute",exec,…)` | ✅ 存在，签名 `(exec, next)` 一致（宿主内已有 `dsh-tool-jobs/lib/index.js:273` 同形监听） |
| `system-prompt/assemble` | `lib/index.js:760` | `dsh-system-prompt/lib/index.js:401` `waterfall(…,"system-prompt/assemble",assembly,context,…)` | ✅ 存在，插件用 `(...args)` + `args.length>=3 ? args.at(-1) : null` 兼容两种签名 |
| `agent/pre-step` | `lib/index.js:543`、`lib/index.js:856` | `dsh-agent-loop/lib/index.js:704` `dispatch.waterfall("agent/pre-step",{agent,messages,signal},…)` | ✅ 存在 |
| `session/created` | `lib/index.js:679`、`lib/index.js:705`、`lib/index.js:838` | `dsh-session/lib/index.js:2000` 派发 | ✅ 存在 |
| `session/event` | `lib/index.js:680` | `dsh-session/lib/index.js:1600/1610/1670` 派发 | ✅ 存在 |
| `llm/stream` | `lib/index.js:1491` | `dsh-repeat-tool-reminder/lib/index.js:2189` `waterfall(this,"llm/stream",options,…)` | ✅ 存在 |
| `agent-preset/selected` | `lib/index.js:847` | `dsh-api-session-controller/lib/types/agent.js:425` `session.append('agent-preset/selected',…)` | ✅ 存在 |
| `tools/post-execute` | **运行期未使用**（只在 `lib/patches/new-tools.mjs` 里作为补丁锚点字符串出现） | `dsh-tools/lib/pipeline.js:668` | ✅ 存在（本插件不依赖） |

### 2.3 cordis 核心面

| API | 插件用处 | cordis 4.1.0 是否存在 | 判定 |
|---|---|---|---|
| `ctx.effect(fn)` | 29 处，如 `lib/index.js:387/556/677/703/865` | `cordis/lib/index.js` 有 `effect(` | ✅ |
| `ctx.inject([...], cb)` | `lib/index.js:1546/1805/2016` | 同上 | ✅ |
| `ctx.provide(name, obj)` | `lib/redteam/store.js:77`（`redteam`）、`lib/redteam/index.js:617`（`redteamMode`） | 同上；两个都是本插件自建服务，不与宿主重名 | ✅ |
| `ctx.on(ev, fn, {global, prepend})` | 全部监听点 | `cordis/lib/index.js:808`（按 `options.global` 过滤）、`:810`（`options.prepend ? "unshift" : "push"`） | ✅ 两个选项都真实生效 |
| `ctx.logger` | 16 处 | cordis 内建 mixin（`cordis/lib/index.js:263/268/389/555` 均以 `context.logger.error` 使用） | ✅ |
| `ctx.reflect?.get?.(name,false)` | `lib/index.js:1517`（refusal-retry 取 `llm`） | `cordis/lib/index.js:1347` `get(name, strict=true)` | ✅ |

### 2.4 「插件用了但宿主没有」清单

只有两项，且都是**可选能力**：

1. `desktopRuntime`
2. `desktopActions`

两者在整份 `Contents/Resources`（含 `app/`、`app/dsh/`、`runtime/`）里 0 命中 —— 说明 0.2.2-rc.5 的桌面壳没有对外提供这两个 Cordis 服务。插件侧的取值是 `ctx.get()`（非严格、不抛）+ 结构判空，取不到就返回 `null`，对应能力（asar 重命名/重启交接）降级为「走进程重启脚本」路径（`lib/desktop.js:798-802` 之后的分支）。

**判定：无「用了但宿主没有且会抛」的 API。**

### 2.5 一条运行期旁证

本次验证所在的会话，其可用工具列表里已经有 `purge_status` / `purge_apply` / `purge_revert` —— 这三个正是 `lib/index.js:1716/1737/1773` 注册的工具名。也就是说 **`inject: ["systemPrompt","tools"]` 在本机宿主上真实解析成功、`ctx.tools.register` 真实生效**，不是静态推断。同一份证据也说明 `cordis.patch.yml` 的 `insert` 在本机能把插件挂起来（当前挂的是 community 1.7.20，包名同为 `dsh-purge-community`）。

---

## 3. 补丁锚点命中

### 3.1 总数与状态

补丁表共 **92 条**（`ALL_PATCHES.length`，实测 `lib/patches/index.mjs` 汇总 7 个数组）：

```
total: 92
by layer: {"提示词":27,"代码":53,"工具":9,"0.1.5 兼容":1,"0.2.0 兼容":2}
dup ids: []            min/max id: 1 / 204
```

`dsh-purge --status`（`DSH_SURFACE=desktop`）实测：

```
补丁 79/92 已清洗, 4 待清洗
```

逐条状态统计（92 条逐行解析）：

| 状态 | 条数 | id |
|---|---|---|
| `applied` | **79** | 其余全部 |
| `pending` | **4** | 201, 202, 203, 204 |
| `skipped` | **3** | 35, 76, 80 |
| `na` | **5** | 28, 30, 31, 64, 65 |
| `unknown` | **1** | 71 |

交叉验证（`bin/community.js diagnose`，`checked: 92`）：

```json
{ "host": ".../node_modules/@deepseek-ai", "checked": 92,
  "drifted": [], "optionalDrift": [ { "id": 76, "status": "skipped", "reason": "anchor_drift" } ],
  "chained": [], "missing": [ { "id": 71, "status": "unknown", "reason": "target_file_missing", "anchors": [] } ] }
```

即：**0 条真漂移**（`drifted: []`）——79 条 applied 的锚点全部仍在，没有「报告完成但实际没打上」的情况（这正是上一版 `#62` 的病）。

### 3.2 非 applied 逐条原因

用插件自己的纯函数 `applyReplacementsToText()`（`lib/core/verify.mjs:7`，只做字符串运算、不写盘）把每条补丁的每个 `pattern` 跑到 live 文件文本上，得到 `changed` / `hitMismatch`：

| # | 名称 | 状态 | 目标文件（实测存在性） | 逐锚点命中 | 原因 |
|---|---|---|---|---|---|
| 201 | PRODUCT_ANALYTICS_DEFAULT_OFF | `pending` | `dsh-client-product-analytics/lib/index.js` ✅存在 | `changed=true`，0 mismatch | **从未应用过**。锚点在 313 行命中。可打 |
| 202 | PRODUCT_TELEMETRY_OTEL_NOOP | `pending` | `dsh-host-product-telemetry-otel/lib/index.js` ✅ | `changed=true`，0 mismatch | 同上，锚点 41-42 行命中。可打 |
| 203 | SESSION_TELEMETRY_OTEL_DISABLED | `pending` | `dsh-session-telemetry-otel/lib/index.js` ✅ | `changed=true`，0 mismatch | 同上，锚点 25 行命中。可打 |
| 204 | SKILL_OFFICE_ASSET_FALLBACK | `pending` | `dsh-skill-office/lib/index.js` ✅ | `changed=true`，0 mismatch | 同上，锚点 1 行 + 59-60 行命中。可打 |
| 35 | ESCALATION_NEVER_REJECT | `skipped` | `dsh-sandbox/lib/index.js` ✅ | 2 个 pattern 各 **0 命中**，`changed=false` | 锚点语义已在 rc.5 消失（全宿主 `grep "escalating this"` = 0）。该补丁 `settleWhenAbsent:true` → 判定「无活可干 = 已到位」。**不是缺口**：同一语义已由 #13/#14 落到 `dsh-sandbox/lib/index.js:145`（`approval is auto-granted`）与 `:170`（`escalation bypass: every escalation request is granted`） |
| 76 | PRESET_UNRESTRICTED_IDENTITY_STRIP | `skipped` | `~/.dsh/.agent-presets/unrestricted/agent.cordis.yml` ✅ | 3 个 pattern 各 **0 命中** | 该预设由 purge 自己生成，第 19 行注释明写「#76 会把这里的官方身份句剥离，所以这里不要放 `You are a coding agent powered by ...`」，第 20 行是 `prefix: \|` 块标量 + 中文人设。**无官方身份句可剥 = 已到位**（`optional:true`，`anchor_drift`） |
| 80 | MINIMAL_OFFICIAL_TOOLSET | `skipped` | `dsh-web-app/presets/minimal.patch.yml` ✅、`dsh-sdk-minimal/cordis.patch.yml` ✅ | 8 个 pattern 各 **0 命中** | 这是**撤销型**补丁：pattern 里带 `# [dsh-purge] minimal fs tool parity` 等标记，要求把这些行换回官方 toolset。标记不存在 = 官方 toolset 已就位，`settleWhenAbsent:true` → 已到位 |
| 28 | LIANGSHEN_PHASE1_KEEP_INJECT | `na` | key `liangshen-tool-bootstrap` **未在 `targetFiles` 定义** | — | 目标插件（梁神 `@linxin666/dsh-liangshen`）未安装。`~/.dsh/profiles/desktop/node_modules` 无 `*liangshen*` |
| 30 / 31 | HOOKS_CLAUDE_DENY_ALLOW / HOOKS_CODEX_DENY_ALLOW | `na` | key `hooks-claude-code*` / `hooks-codex*` **未定义** | — | `dsh-hooks-claude-code` / `dsh-hooks-codex` 未安装 |
| 64 / 65 | HOOKS_STOP_STEER_NEUTRAL / HOOKS_PRESTEP_REJECT_NEUTRAL | `na` | 同上 4 个 key **未定义** | — | 同上 |
| 71 | LIANGSHEN_IDENTITY_LINE | `unknown` | key `preset-liangshen` = `~/.dsh/.agent-presets/liangshen/agent.cordis.yml`（不存在） | — | **插件自身的判定 bug**，见 §3.3 |

### 3.3 #71 的 `unknown` 是一个可复现的真 bug（不影响上机，但会被误读成风险）

`lib/core.js:3953-3957`：

```js
if (p.id === 71 && status[p.id] === "missing_file") {
  const presence = liangshenPresence(options.dshHome ?? findDshHome());
  if (presence === "absent") status[p.id] = "na";
  else if (presence === "unknown") status[p.id] = "unknown";
}
```

`liangshenPresence()`（`lib/preset-presence.js:31`）本应返回 `"absent"`，实测返回 `"unknown"`。根因已定位：

```
~/.dsh/profiles/ 下有 macOS 的 .DS_Store（普通文件）
lib/preset-presence.js:49   readdirSync("~/.dsh/profiles") 把 .DS_Store 当 profile 名列出
lib/preset-presence.js:57   readFileSync("profiles/.DS_Store/package.json") → ENOTDIR
lib/preset-presence.js:63   catch 只放行 ENOENT → 抛出 → 外层 catch（:75）→ return "unknown"（:76）
```

实测：

```
profile .DS_Store -> ENOTDIR  ENOTDIR: not a directory, open '.../profiles/.DS_Store/package.json'
presence: unknown
```

**后果**：`#71` 永远显示 `unknown` 而不是 `na`；且 `unknown` **不进入任何计数桶**（见 §3.4）。这是社区版 1.7.20 继承下来的问题，不是 plus 引入的。修法一行：`if (e.code !== "ENOENT" && e.code !== "ENOTDIR") throw e;`。

### 3.4 计数口径：同一份 payload 里有三个分母

| 口径 | 值 | 来源 | 算式 |
|---|---|---|---|
| 补丁表总数 | **92** | `ALL_PATCHES.length` | — |
| `patches_total`（本机适用） | **87** | `lib/core.js:4706`（`na` 不计入分母） | 92 − 5 na |
| `display_total`（面板分组后） | **78** | `groupPatchesForDisplay` 把 15 条并成 6 组（−9） | 87 − 9 |
| CLI 打印的分母 | **92** | `bin/dsh-purge.js:26` 硬用 `core.ALL_PATCHES.length` | 与 `patches_total=87` 不一致 |

且 `79 applied + 4 pending + 3 skipped + 5 na = 91`，差的 1 条正是 `#71 unknown` —— 它被算进 `patches_total`，却不落进任何计数器。这与历史版本 `#80` 的口径问题同源。

**影响**：只影响数字展示，不影响「补丁是否真的打上」。上机前建议把 CLI 分母改成 `state.patches_total`，并把 `unknown` 归入 `skipped` 或单独加一个桶。

---

## 4. 自有补丁与围栏

### 4.1 枚举：92 = 88 + 4

`lib/patches/index.mjs`（overlay 注入后的实际内容）：

```js
import { OVERLAY_PATCHES } from './overlay.mjs'; // [dsh-purge-plus]
export const ALL_PATCHES = [...PATCHES, ...CODE_PATCHES, ...ENGINE_PATCHES,
  ...NEW_TOOL_PATCHES, ...OPT_IN_PATCHES, ...STABILITY_PATCHES, ...OVERLAY_PATCHES];
```

`overlay.mjs` 导出 4 条，id 201–204，与上游 1..96 无重叠（实测 `dup ids: []`，`max id: 204`）。id 段位约束与 `docs/PORT-MATRIX.md` 一致。

### 4.2 锚点在**当前宿主文件**上是否命中

四条全部 `changed=true`、`hitMismatch=null`，且 4 个目标文件里 `dsh-purge` 标记数为 **0**（说明 community 没碰过它们，是干净基线，不存在「锚点针对已打状态」的歧义）：

| # | live 文件 | 锚点行号（实测） | 与 `overlay.mjs` 注释声明是否一致 | `changed` | 现有 `dsh-purge` 标记 |
|---|---|---|---|---|---|
| 201 | `dsh-client-product-analytics/lib/index.js` | **313**: `enabled: z.boolean().default(true).volatile(),` | 注释写 313 ✅ | true | 0 |
| 202 | `dsh-host-product-telemetry-otel/lib/index.js` | **41-42**: `super(ctx, "productTelemetry");` + `const reporter = ctx.otel.createEventReporter({` | 注释写 41-42 ✅ | true | 0 |
| 203 | `dsh-session-telemetry-otel/lib/index.js` | **25**: `const DEFAULT_TELEMETRY_MODE = SessionTelemetryMode.FEEDBACK_ONLY;` | 注释写 25 ✅ | true | 0 |
| 204 | `dsh-skill-office/lib/index.js` | **1**: `import { readFile } from "node:fs/promises";` + **59**: `const assetRoot = config.assetRoot ?? fileURLToPath(...)` | 注释写 59-60 ✅ | true | 0 |

四条都带 `optional:true` + `skipIfMarked:true` + marker `[dsh-purge-plus] …`，宿主升级后锚点消失只会变成 `drifted`，不会阻断其余 88 条 —— 设计符合 `overlay.mjs` 头部第 3 条约束。

### 4.3 `lib/subagent-fence.js`

- **能被 import**：`node --input-type=module -e 'import("./lib/subagent-fence.js")'` → `exports: installSubagentFence`（唯一导出，`typeof === "function"`）。
- **注册行为**（假 ctx 探针）：`[{ev:"tools/pre-execute", opts:{global:true, prepend:true}}]`，返回 disposer 函数。
- **行为测试**（6 例，实测输出）：

| 场景 | exec | 结果 |
|---|---|---|
| 叶子 + `subagent` | `{name:"subagent", agent:{session:{header:{origin:"subagent"}}}}` | `{"kind":"deny","reason":"子代理是叶子节点，不能再派活（subagent）…"}` |
| 叶子 + `workflow` | 同上，name=`workflow` | `deny` |
| 叶子 + `read` | 非委派工具 | `{"kind":"allow","via":"next"}`（**透传**，不截断链） |
| 根 + `subagent` | `header.origin="user"` | `allow` |
| 深度 2 + `subagent` | `header.delegationDepth=2` | `deny` |
| 无 agent | `{name:"subagent"}` | `allow` |
| `config.subagentFence=false` | — | 返回空 disposer，**不注册**（探针里 `ctx.on` 未被调用） |
| `ctx.on` 不存在 | `{}` | 返回空 disposer，不抛 |

- **谓词与宿主一致**：`isLeafAgent` 读 `agent.session.header.origin` 与 `header.delegationDepth`。宿主侧同款判据存在 —— `dsh-tool-goal/lib/index.js:50` `execution.agent.session.header.origin === "subagent"`、`dsh-terminal-panel/lib/index.js:430/501`、`dsh-workspace-changes/lib/index.js:960` `origin === "subagent" || (delegationDepth ?? 0) > 0`。
- **挂载点**：`lib/index.js:1489` `try { installSubagentFence(ctx, cfg); } catch {}`，位于 `apply()` 第一行，早于其它 hook。

**判定：#201–204 可打；围栏可用且 fail-open。**

---

## 5. 与上游开源仓库的偏离

### 5.1 参照版本

上游**有**精确对应版本：tag `dsh-v0.2.2-rc.5`，commit `9c2670d3bce5275e0d1610272958121af87787bb`（`api.github.com/repos/deepseek-ai/deepseek-harness/tags`）。因此**不存在「rc.5 无对应 tag、只能用邻近版本参照」的问题**，本节结论可直接采信。

### 5.2 配置类文件：字节级对照（最强证据）

拿宿主 `.dshpurge.bak`（原厂基线）与上游 tag 的对应文件做 `cmp`：

| 宿主文件 | 上游路径 | 上游字节 | `.bak` 字节 | `cmp` | live 与 `.bak` 差异 |
|---|---|---|---|---|---|
| `dsh-base/cordis.patch.yml` | `packages/bundle/base/cordis.patch.yml` | 21702 | 21702 | **完全相同** | 10 行（purge 编辑） |
| `dsh-web-app/cordis.patch.yml` | `packages/bundle/web-app/cordis.patch.yml` | 24174 | 24174 | **完全相同** | 3 行 |
| `dsh-web-app/presets/minimal.patch.yml` | `packages/bundle/web-app/presets/minimal.patch.yml` | 3724 | 3724 | **完全相同** | 7 行 |
| `dsh-sdk-minimal/cordis.patch.yml` | `packages/bundle/sdk-minimal/cordis.patch.yml` | 5815 | 5815 | **完全相同** | 5 行 |
| `dsh-headless/cordis.patch.yml` | `packages/bundle/headless/cordis.patch.yml` | 1571 | 1571 | **完全相同** | 3 行 |

**结论**：本机宿主 = 上游 rc.5 原文 + 仅 purge 的编辑，没有任何第三方改动。这条同时证明了「`.dshpurge.bak` 基线是干净的原厂字节」，回滚可信。

### 5.3 JS 类文件：只能做锚点级对照

上游**不提交构建产物** —— `packages/**/lib/index.js` 在 tag 里 0 个文件（`packages/**/src/*.ts` 才是源码）。宿主的 `node_modules/@deepseek-ai/*/lib/index.js` 是 pnpm 安装时由 `tsdown` 编译出来的 ESM（tab 缩进、双引号、`void 0` 等形态），与 TS 源码不可能字节相等。

所以 JS 侧的口径是：**以本机实装为准，用锚点命中证明「补丁针对的就是 rc.5 的编译产物」**。已做两向验证：

1. 4 条 overlay 锚点在上游 **源码**里存在（证明不是针对 fork 写的）：
   - `packages/client/product-analytics/src/index.ts:36` `enabled: z.boolean().default(true).volatile(),`
   - `packages/host/product-telemetry-otel/src/index.ts:84-85` `super(ctx, 'productTelemetry')` / `ctx.otel.createEventReporter({`
   - `packages/session/session-telemetry-otel/src/index.ts:37` `DEFAULT_TELEMETRY_MODE = SessionTelemetryMode.FEEDBACK_ONLY`
   - `packages/skill/skill-office/src/index.ts:3` `import { readFile } from 'node:fs/promises'`、`:81` `const assetRoot = config.assetRoot ?? fileURLToPath(...)`
2. 同一批锚点在 live **编译产物**上命中（`changed=true`，行号见 §4.2）。

上游源码用单引号、编译产物用双引号 —— overlay 的 pattern 写的是**编译产物形态**（tab + 双引号），这是正确选择（补丁打的是 `lib/index.js`，不是 `src/*.ts`）。

### 5.4 无法用上游验证、只能以本机为准的部分

- `packages/**/lib/index.js` 的编译形态（上游无产物可比）。
- 桌面壳 `app/lib/main.js` 与 `dsh-tools` 的运行时行为：Electron 侧 `@deepseek-ai/dsh-desktop` 是 `private: true`，不在开源包清单里。
- `desktopRuntime` / `desktopActions` 两个服务：上游 tree 里检索不到，属桌面壳私有实现；本机实测也不存在。

---

## 6. 安装与回滚步骤

### 6.1 现状（实测）

```
~/.dsh/profiles/desktop/package.json
  dependencies["dsh-purge-community"] = "file:/Users/wheming/.dsh/dsh-purge-community/pkgs/5b3d66e8…/dsh-purge-community-1.7.20.tgz"
  dsh.profile.bundles = [ … , "dsh-purge-community", "dsh-plugin-mobile-gateway", … ]

~/.dsh/profiles/desktop/node_modules/dsh-purge-community/    ← 实目录（非软链），21 项
~/.dsh/profiles/desktop/pnpm-lock.yaml:29-31   importer 条目
~/.dsh/profiles/desktop/pnpm-lock.yaml:456-457 resolution + integrity
```

包管理器：pnpm 11.28.5 / `nodeLinker: hoisted`（`.modules.yaml:566-567`）。

### 6.2 关键约束：安装目录名必须是 `dsh-purge-community`

`dist/build/package/cordis.patch.yml` 里有 **5 处** `name:` 硬编码包名：

```yaml
- insert:
    - id: dsh-purge            name: 'dsh-purge-community'
    - id: dsh-purge-redteam    name: dsh-purge-community/redteam
    - id: dsh-purge-presets    name: dsh-purge-community/presets-plugin
    - id: dsh-purge-redteam-store  name: dsh-purge-community/redteam/store
    - id: dsh-purge-redteam-ui     name: dsh-purge-community/redteam/ui
```

而宿主的 bundle 加载器（`dsh-app-boot/lib/index.js:1805-1806`）用 `resolveBundleDir(binName, packageName, …)` 解析 `dsh.profile.bundles` 里的名字，插件 `name` 走 Node 的 bare-specifier 解析（同文件 `:1322` 注释「a bundle name resolves first from the dsh installation, then from the profile directory」，实现是 `createRequire(parent).resolve.paths(name)`，`:2419/:4322`）。

**实测（决定性）**：

| 安装目录名 | `require.resolve("dsh-purge-community")` | `dsh-purge-community/redteam` | manifest `name` |
|---|---|---|---|
| `node_modules/dsh-purge-community/` | ✅ → `…/dsh-purge-community/lib/index.js` | ✅ | `dsh-purge-plus` |
| `node_modules/dsh-purge-plus/` | ❌ `MODULE_NOT_FOUND` | ❌ | `dsh-purge-plus` |

即：**解析看目录名，不看 manifest 的 `name` 字段**。所以替换时**必须保留依赖键与 bundles 条目名 = `dsh-purge-community`**，否则 bundle 会被 `skippedBundles` 静默跳过（`dsh-app-boot/lib/index.js:1822-1825`，只在 stderr 打一行 `skipping profile bundle …`）。

> 未验证项（诚实标注）：本机没装 pnpm（`command -v pnpm` 空），上表是 **npm 11.20.0** 实测的别名行为（`npm install dsh-purge-community@file:…tgz` → 建 `node_modules/dsh-purge-community`，其 `package.json.name` 是 `dsh-purge-plus`）。pnpm hoisted 对非 registry 别名的目录命名预期一致，但**没有在本机跑通验证**。§6.3 第 4 步给了落地后的自检命令；若不通过，用 §6.5 的软链兜底。

### 6.3 安全替换步骤（保留回滚点，不碰宿主）

```bash
# 0) 备份整个 profile 的清单与锁（不动 node_modules 内容）
P=~/.dsh/profiles/desktop
mkdir -p ~/dsh-plus-migration
cp "$P/package.json" "$P/pnpm-lock.yaml" ~/dsh-plus-migration/

# 1) 把 plus 的 tgz 放进 purge 自己的 pkgs 缓存（沿用 community 的布局，便于 file: 引用）
sha256=$(shasum -a 256 dist/dsh-purge-plus-1.7.20-plus.1.tgz | cut -d' ' -f1)
dst=~/.dsh/dsh-purge-community/pkgs/$sha256
mkdir -p "$dst" && cp dist/dsh-purge-plus-1.7.20-plus.1.tgz "$dst/"

# 2) 只改 specifier，**不改键名**（键名必须留在 dsh-purge-community）
#    package.json:  dependencies["dsh-purge-community"] = "file:<上面那个 tgz>"
#    dsh.profile.bundles 保持 "dsh-purge-community" 不变

# 3) 装（DSH 侧推荐用 plugin_manager install_bundle，它会走同一套 profile 安装；
#    手工等价物：）
cd "$P" && pnpm install --config.node-linker=hoisted

# 4) 落地自检（不改任何东西，只解析）
node -e '
const {createRequire}=require("module");
const r=createRequire(process.env.HOME+"/.dsh/profiles/desktop/package.json");
for (const s of ["dsh-purge-community","dsh-purge-community/redteam","dsh-purge-community/redteam/store","dsh-purge-community/redteam/ui","dsh-purge-community/presets-plugin"])
  console.log(s.padEnd(26), r.resolve(s));
console.log("manifest name:", r("dsh-purge-community/package.json").name);   // 应为 dsh-purge-plus
'

# 5) 看 bundle 是否被接受（不启动会话，只 dump 组合）
#    GUI：设置 → 插件；或命令行确认没有 "skipping profile bundle" 告警

# 6) 首次应用 4 条新补丁（写宿主，需显式执行）
node "$P/node_modules/dsh-purge-community/bin/dsh-purge.js" --apply
#    期望：#201–#204 → 已清洗；其余 79 条 → 已是最新 / already

# 7) 重启 DSH 使宿主侧补丁进入进程
```

替换**需要动的地方**（穷举）：

| 位置 | 是否要改 | 说明 |
|---|---|---|
| `package.json` → `dependencies["dsh-purge-community"]` | ✅ 改成 plus 的 `file:` | 键名不变 |
| `package.json` → `dsh.profile.bundles` | ❌ 不改 | 条目名 `dsh-purge-community` 必须保留 |
| `pnpm-lock.yaml` | 由 `pnpm install` 重写 | importer `:29-31`、resolution `:456-457` 会换 integrity |
| `node_modules/dsh-purge-community/` | 由 `pnpm install` 重写 | 目录名必须仍是 `dsh-purge-community` |
| `~/.dsh/dsh-purge-community/`（状态目录） | ❌ 不改，**故意共用** | 见 §6.4 |
| 宿主 `*.dshpurge.bak` | ❌ 不动 | 继续当原厂基线用 |

### 6.4 两个包同时存在会怎样（逐项）

| 维度 | 结论 | 依据 |
|---|---|---|
| **补丁 id 冲突** | **不会**。plus = 社区 88 条 + 201–204，id 段位互斥（`dup ids: []`）；两包同时存在时，第二个实例对同一批补丁只会报 `already`（`patchApplied` 命中对方的 marker） | `lib/patches/index.mjs`、`lib/core/shared.mjs:157` |
| **状态目录** | **共用** `~/.dsh/dsh-purge-community/`（`lib/audit.js:21`、`lib/community.js:334`、`lib/preset-compat.js:235/296` 都硬写 `"dsh-purge-community"`）。overlay 注释明说这是**故意**的：改名会让历史基线变孤儿 | 实测路径 + `overlay/edits.mjs` 注释 |
| **`.dshpurge.bak` 基线污染** | 共用同一份 `.bak`，且 `apply` 对已有 `.bak` 采取「保留不覆盖」策略 → 不会把已打状态当原文存成基线。**但存在回滚不对称**，见下 | `lib/core.js:2746` `revertAll` |
| **回滚不对称（真风险）** | `revertAll` 只遍历 `flattenTargetPaths(targetFiles(aiBase))`。plus 的 `core.js` 被 overlay 补了 `product-analytics`/`product-telemetry-otel`/`session-telemetry-otel`/`skill-office` 四个键，**社区版没有这四个键**。所以：用 plus 还原 → 4 个文件一并还原；用社区版还原 → 这 4 个文件**留在已打状态**，并留下 4 个孤儿 `.bak` | `overlay/edits.mjs` B 段 + `lib/core.js:2746-2790` |
| **运行期双份 hook** | 两实例都会挂 `system-prompt/assemble`（`{global:true,prepend:true}`）。注入段名以 `dsh-purge` 前缀命名，`withoutPurgeInjection` 按名字先剥后加（`lib/preset-injection.js:30-60`，`isPurgeSection` 判 `dsh-purge` / `dsh-purge-` / `dsh-purge:` / `dshpg-` 前缀）→ **预期不会重复注入**，但会双份 CPU/日志开销 | 代码路径；**未做运行期实测** |
| **命令名冲突** | 有优雅降级：`/purge` 被占用会退到 fallback 名，再冲突就放弃注册并 warn，不中断启动 | `lib/command-registration.js:2-19` |
| **Web 路由** | 两实例都注册 `/dsh-purge/*` 同路径，取决于 `webServer.register` 对重复 path 的处理；插件用 `trackRoute` 包裹，但**未在本机验证重复注册是否抛错** | `lib/index.js:1546/2025/2986`；**未验证** |
| **工具名冲突** | 两实例都注册 `purge_status`/`purge_apply`/`purge_revert`（`lib/index.js:1716/1737/1773`）。宿主 `ctx.tools.register` 对重名行为未验证 | **未验证** |

**建议**：迁移期**不要**让两个包同时启用。要么先 `plugin_manager` 移除 `dsh-purge-community` 再装 plus（同一键名，天然互斥），要么直接覆盖安装（同键名 = 同一个槽位，物理上不可能并存）。上面那张表是「假如并存」的推演，不是推荐路径。

### 6.5 回滚步骤

```bash
# A. 只想退插件版本（宿主补丁不动）
cp ~/dsh-plus-migration/package.json ~/dsh-plus-migration/pnpm-lock.yaml ~/.dsh/profiles/desktop/
cd ~/.dsh/profiles/desktop && pnpm install --config.node-linker=hoisted
#    键名没变，bundles 没变 → 回到 community 1.7.20

# B. 要把宿主补丁也退回原厂
node ~/.dsh/profiles/desktop/node_modules/dsh-purge-community/bin/dsh-purge.js --revert
#    ⚠️ 如果之前用 plus 打过 #201–204，community 的 revert 不会碰这 4 个文件（§6.4），
#       必须先用 plus 的 revert 跑一遍，或手工把 4 个 .bak 拷回：
#       dsh-client-product-analytics/lib/index.js
#       dsh-host-product-telemetry-otel/lib/index.js
#       dsh-session-telemetry-otel/lib/index.js
#       dsh-skill-office/lib/index.js

# C. 若 §6.3 第 4 步解析失败（pnpm 把目录建成 dsh-purge-plus）
ln -s dsh-purge-plus ~/.dsh/profiles/desktop/node_modules/dsh-purge-community
#    重跑第 4 步自检；仍失败则回退到 A
```

---

## 7. 结论：能否上机

### 判定：**有条件能**

| 维度 | 结论 |
|---|---|
| 入口加载 | ✅ 通过（具名 + default 双形状一致，`inject` 两个服务宿主都有） |
| 宿主 API | ✅ 通过（12 项服务 / 8 个事件 / 6 个 cordis API 全部存在；仅 `desktopRuntime`/`desktopActions` 缺失，有守卫、非阻塞） |
| 补丁锚点 | ✅ 通过（79 applied、**0 真漂移**；4 条新补丁锚点全部命中 live 文件） |
| 自有补丁 + 围栏 | ✅ 通过（92 = 88 + 4；围栏 import/注册/6 例行为全对） |
| 上游偏离 | ✅ 已澄清（上游有 rc.5 tag；5 个 yml 与 `.bak` 字节完全相同） |
| 安装/回滚 | ⚠️ 有约束（必须保留安装名 `dsh-purge-community`） |

### 上机的 3 个条件

1. **安装名必须是 `dsh-purge-community`**。依赖键、`dsh.profile.bundles` 条目都保持 `dsh-purge-community` 不变，只把 specifier 换成 plus 的 tgz。改名会让 `cordis.patch.yml` 里 5 处 `name:` 全部解析失败 → bundle 被静默 skip（§6.2 双向实测）。
2. **4 条新补丁需要显式 `--apply`**。#201–204 现在是 `pending`，装完不会自动生效（bundle 配置里 `autoApplyOnStart: false`）。
3. **回滚顺序要反过来**：先用 plus revert，再用 community revert；否则 4 个文件会留在已打状态 + 4 个孤儿 `.bak`（§6.4）。

### 阻塞项

**无硬阻塞。** 没有一条补丁会打不上、没有一个 API 会抛、没有一个事件挂不上。

### 已知风险（按严重度）

| # | 风险 | 影响 | 处置 |
|---|---|---|---|
| R1 | 安装名/别名不符预期（pnpm 行为未在本机验证） | bundle 被静默 skip，面板看不到插件 | 装完立刻跑 §6.3 第 4 步解析自检；不通过用 §6.5 C 软链兜底 |
| R2 | 回滚不对称（community revert 不覆盖 #201–204 的 4 个文件） | 4 个文件残留补丁 + 4 个孤儿 `.bak` | 回滚按 plus → community 顺序；或手工拷回 4 个 `.bak` |
| R3 | `#71` 的 `unknown` 计数 bug（`.DS_Store` → `ENOTDIR`） | 状态显示 `unknown` 而非 `na`；计数少 1 条，`79+4+3+5=91≠92` | 不影响功能；修法一行（`lib/preset-presence.js` 放行 `ENOTDIR`），建议随下一个 plus 版本带上 |
| R4 | CLI 分母用 `ALL_PATCHES.length`（92），payload 的 `patches_total` 是 87，面板 `display_total` 是 78 | 三个数字并存，容易被误读成「少打了」 | 建议 CLI 改用 `state.patches_total` |
| R5 | 双包并存时 web 路由 / 工具名重复注册的行为未验证 | 若并存可能启动告警 | 迁移期用同一键名覆盖，物理上避免并存 |

### 与历史结论的差异（供对照）

- 上一轮记录的是「72/74、6 条 na、2 条 skipped、#62 是唯一真缺口」。本轮宿主已升到 **0.2.2-rc.5**、补丁表已扩到 **92 条**，口径变为 **79 applied / 4 pending / 3 skipped / 5 na / 1 unknown**，且 `#62` 已 applied（`drifted: []`）。两次的宿主版本与补丁表都不同，数字不可直接比较。
- 上一轮记录的 6 条 na 里的 `#71`，本轮因 `.DS_Store` 变成 `unknown`（R3），`#35` 因 `settleWhenAbsent` 变成 `skipped` —— 两者都不是新出现的缺口。

---

*本报告全部结论均可用 §0.3 的命令复现。验证过程未修改宿主任何文件、未 apply/revert 任何补丁、未重启任何进程（只读性自证见 §0.4）。*
