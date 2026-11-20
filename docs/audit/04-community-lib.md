# community 1.7.20 · 其余 lib 模块规格（CM-LIB）

> 审计对象：`vendor/community/lib/`，**排除** `core.js`、`index.js`、`redteam/`、`patches/`、`core/`（另册）。
> 行号以当前 `vendor/community` 快照为准。`[静态]` = 只读代码得出；`[实测]` = 本机实际运行/请求验证过。
> 补充说明：为便于对照构建产物，少数结论同时给了 `dist/build/package/lib/*` 的行号，会明确标注。

---

## 1. 模块清单

「加载」列取值：
- `direct` = `lib/index.js` 直接 import（index.js:1-53 的 import 区，共 36 条 import）
- `transitive` = 只被本族/`core.js` 间接 import
- `entry` = 不 import，由 `spawn` 当独立脚本跑，或作为 sidecar 文件被复制
- `export` = 通过 `package.json.exports` 暴露成独立插件入口

| 文件 | 行数 | 一句话职责 | 是否被 index.js 加载 |
|---|---|---|---|
| **更新族** | | | |
| `update.js` | 1455 | 更新编排总入口：通道、发行列表、检查、安装、回退、自动更新 | direct |
| `update-http.js` | 198 | 唯一 HTTP 传输层：代理/SOCKS/镜像、重定向白名单、超时、体积上限、重试 | direct |
| `update-net.js` | 235 | GitHub 读接口 + 缓存 + `withBudget` 总预算 + codeload 地址改写 | transitive |
| `update-state.js` | 235 | 更新状态文件读写 + 版本号比较原语 | transitive |
| `update-policy.js` | 337 | 更新偏好/凭据分文件持久化 + 定时检查控制器 | direct |
| `update-install.js` | 353 | 文件系统层：目录快照/回滚、git 复位、zip 覆盖、`swapDir` | transitive |
| `update-download.js` | 24 | 发行包下载：独立超时、镜像前缀、来源主机白名单 | transitive |
| `update-integrity.js` | 49 | 上游源码归档的 commit→Git tree 逐文件 SHA1 校验 | transitive |
| `update-mirror.js` | 20 | 镜像前缀规范化与改写（只换传输，不做权威） | transitive |
| `update-secrets.js` | 133 | 密钥文件私有化写入（POSIX 0600 / Windows DACL 助手） | transitive |
| `update-socks.js` | 49 | 有界 SOCKS5 握手（仅更新通道用） | transitive |
| `update-system-proxy.js` | 42 | 只读 WinINET 代理发现（reg.exe → PowerShell 回退） | transitive |
| `update-targets.js` | 24 | 逐 profile 读磁盘版本，汇总 `hasUpdate` / `retryIncomplete` | transitive |
| `community.js` | 968 | 发行源常量、兼容性判定、`Maintenance`（备份/安装/回滚）、发行包校验 | direct |
| `official-update.js` | 53 | 官方升级标记文件与 WSH ASCII 字面量工具 | direct |
| **桌面族** | | | |
| `desktop.js` | 1540 | 桌面安装定位、重启决策、asar 换包、官方 CLI shim 修补 | direct |
| `desktop-cli.js` | 67 | 从 `resources/` 解析桌面 CLI 与内置 pnpm（含越界校验） | transitive |
| `desktop-entry.js` | 81 | 解析桌面壳 `main` 入口（package.main 优先，已知布局兜底） | transitive |
| `desktop-handoff.js` | 17 | 按平台分派 asar 交接（macOS/Windows） | direct |
| `desktop-identity.js` | 155 | 只读包证据判定宿主家族（bundled-host / bundled-cli / next / community） | transitive |
| `desktop-read-scope.js` | 33 | 单次诊断内的读缓存作用域（AsyncLocalStorage） | transitive |
| `macos-asar-handoff.js` | 300 | macOS 侧「等应用退出→硬链接备份→删归档」助手 | transitive |
| `windows-asar-handoff.js` | 287 | Windows 侧同名助手（PowerShell + Job Object 逃逸 + WMI 兜底） | transitive |
| `next-host.js` | 72 | DSH NEXT 第三方壳家族识别与 CLI 修复结论 | transitive |
| `restart-desktop.js` | 506 | 桌面重启助手：杀进程、挪 asar、清理、relaunch | entry |
| `restart-web.js` | 109 | Web 重启助手：等端口、杀旧服务、拉起、抓 URL 开浏览器 | entry |
| `web.js` | 111 | Web 面的重启/清理适配器与 `restartArgv` 重算 | transitive |
| `host.js` | 28 | 面（web/desktop）适配器分发 | direct |
| `host-layout.js` | 136 | 只读布局证据：归档/解包/Tauri 托管归档、进程入口来源 | transitive |
| `host-clean.js` | 13 | 判断系统提示词文件是否已「洗过」（marker 或旧拦截句消失） | transitive |
| `runtime-layout.js` | 113 | `app/runtime` 符号链接修复与 pnpm 入口定位 | transitive |
| **身份与安装** | | | |
| `identity.js` | 1029 | 提示词组装改写核心：置顶注入、剥宿主身份、红队切分、`assemble` 守卫 | direct |
| `instance.js` | 493 | 实例解析：profile / 宿主根 / CLI，绝不扫描其它安装 | direct |
| `install-registry.js` | 68 | 仅针对公开镜像缺版本做一次官方源重试（不关校验） | transitive |
| `installed-package.js` | 37 | 从选中 profile 解析已安装插件包（包名/版本/入口唯一性） | transitive |
| `market-migration.js` | 71 | `cordis.patch.yml` 里旧包名的精确文本迁移/回滚 | transitive |
| `uninstall.js` | 312 | 卸载编排：还原补丁/shim/提示词/规则、清 profile 登记、出清理计划 | direct |
| `uninstall-restart.js` | 111 | 卸载后重启助手（等端口→删目录→拉起） | entry |
| `remove-tree.js` | 66 | 不跟随链接的删除原语（同步/异步，含重试） | transitive |
| `restore-backup.js` | 21 | 只从非空普通文件还原宿主备份 | transitive |
| `rollback-transaction.js` | 94 | 打包还原件、独立进程验证安装、profile 依赖快照 | transitive |
| `maintenance-lock.js` | 167 | 跨进程维护租约（PID 出生时间防复用，双名硬链接） | transitive |
| **预设族** | | | |
| `presets.js` | 67 | 自带 `unrestricted` 预设落盘（不覆盖用户改动） | export 链路 |
| `presets-plugin.js` | 93 | 独立插件入口：向 `agentPresets` 注册 `unrestricted` | export |
| `preset-compat.js` | 363 | 预设定义适配/迁移/注册（子代理策略、工具执行器） | export 链路 |
| `preset-diagnostic.js` | 47 | 只读检查 `agent.cordis.yml` 的 persona.prefix（给 #76 定性） | transitive |
| `preset-injection.js` | 75 | 会话级注入策略与「撤销我方改写」溯源 | direct |
| `preset-presence.js` | 78 | 第三方预设（liangshen）存在性证据 | transitive |
| `permission-state.js` | 72 | 权限三态判定（ok / inferred / broken / unknown） | transitive |
| `permission-migration.mjs` | 108 | 关掉权限补丁时，把宿主文件按历史配方回放到基线 | transitive |
| **提示词与规则** | | | |
| `rules.js` | 560 | 规则文件 CRUD、激活到 `AGENTS.md`/`CLAUDE.md`、CWD 指令扫描与勾选 | direct |
| `skills.js` | 706 | 技能 CRUD、frontmatter 解析、zip/tar/目录导入、备份还原 | direct |
| `boost.js` | 58 | 尾部强化段（`<dsh_boost>`）的开关与正文 | direct |
| `hooks-deny.js` | 224 | hooks deny/ask 旁路的反向写回与状态标注 | transitive |
| `drill-grant.js` | 50 | 演练台授权落盘（`drill-grant.json`） | direct |
| `steering.js` | 80 | #90 补丁：把插话/队列恢复成原生语义 | transitive |
| `tuning.js` | 106 | 插件自有调优状态（`tuning.json`）读写 + 审计 | direct |
| `continue-retry.js` | 360 | 请求失败自动重试 + 异常结束自动续跑（含预算/冷却） | direct |
| `refusal-retry.js` | 331 | 流式拒绝检测与多帧重试（默认关闭） | direct |
| `stream-observation.js` | 24 | 流式诊断采样（不改写、不缓冲、不重试） | transitive |
| **安全与范围** | | | |
| `net-scope.js` | 412 | 域名/区域/银行表 + 自有服务器白名单文件（**拦截逻辑已移除**，见 §3.6） | direct |
| `path-boundary.js` | 57 | 路径包含校验（含 junction 与尚不存在的后代） | transitive |
| `surface.js` | 88 | 面判定（web / desktop / gui / tui）与适配器选择 | transitive |
| `audit.js` | 144 | `audit.jsonl` 追加、轮转、属主校验 | direct |
| `probe.js` | 70 | 运行时 nonce 探针（证明注入真的到达模型） | direct |
| `settle-policy.js` | 61 | 启动自愈/重启的策略闸门（何时不许重启） | direct |
| **其他** | | | |
| `anchors.js` | 84 | 本地重锚覆盖（`anchor-overrides.json`） | transitive |
| `apply-gate.js` | 26 | 换包前的 CLI 修复闸门（区分「修好了」与「不适用」） | direct |
| `asset-table.js` | 169 | 加密槽的密文/掩码/标签/IV 常量 | transitive |
| `atomic-files.js` | 102 | 原子写/原子拷贝（保留 POSIX 权限，Windows 忙重试） | transitive |
| `capability-protocol.js` | 48 | 能力选用协议段（官方/红队指挥/红队执行三版） | direct |
| `child-process-hide.mjs` | 87 | `node:child_process` facade（Windows 隐藏控制台） | entry（sidecar） |
| `command-registration.js` | 20 | 命令名冲突时退到备用名，不中断启动 | direct |
| `extract-asar.js` | 601 | asar 探测/解包/校验/换目录 + `hostFs` 路由 | direct |
| `hide-console.js` | 309 | Windows 控制台隐藏安装/还原、`bin.js` 注入 | transitive |
| `phase1-keep.js` | 21 | 放宽官方 phase-1 白名单到 `dsh-purge*`/`dshpg-*` | transitive |
| `reapply.js` | 392 | 启动/CLI 的「还原→重打」编排与对齐戳（`applied.json`） | direct |
| `reapply-cli.js` | 5 | `reapply` 的 CLI 包装（输出 JSON、退出码） | entry |
| `table-key.js` | 27 | 加密槽的密钥派生与封装（AES-256-GCM + deflate） | transitive |
| `table-read.js` | 18 | 加密槽解封（失败返回空串） | transitive |
| `tar-import.js` | 143 | 受限 tar 读取器（只建目录与普通文件） | transitive |
| `zip-extract.js` | 152 | 受限 zip 读取器（EOCD 自洽、禁链接、禁 zip64） | transitive |
| `yaml-runtime.mjs` | 10 | 延迟 import `yaml`，缺依赖时给出源码安装指引 | transitive |
| `signed-sidecars.mjs` | 27 | 某官方桌面构建的 unpacked 原生文件签名表 | transitive |
| `official-installer.mjs` | 57 | 把官方更新器已下载的安装包交接给 PowerShell 执行 | 未被 import |
| `official-installer.ps1` | 42 | 校验 SHA512 + Authenticode 后静默安装 | entry（被 mjs 调用） |
| `official-installer-launch.jsw` | 5 | WScript 中转，跳出桌面 Job Object 起 PowerShell | entry |
| `official-update.wscript` | 93 | 官方客户端升级后的重启脚本模板（占位符由 JS 填） | entry |
| `selfcheck.js` | 301 | 逐层自证破甲（层→补丁 id 映射、状态汇总） | direct |
| `rewind.js` | 674 | 会话回退（草稿、派生消息缓存、模型历史清理） | direct |

---

## 2. 数据模型

状态根有两个，**互不相同**（这是本族最容易踩的坑）：

- `$DSH_HOME/dsh-purge/` —— 更新器、调优、探针、规则、技能授权等（`update-state.js:19`、`tuning.js:30`、`probe.js:17`、`rules.js:35`、`drill-grant.js:10`）
- `$DSH_HOME/dsh-purge-community/` —— 维护备份、审计、迁移记录（`community.js:334`、`audit.js:21`、`community.js:611`）

> `[实测]` 在构建产物 `dist/build/package/lib/` 里，`audit.js:21` 与 `community.js:334` 仍写死 `dsh-purge-community`，`update-state.js:19` 仍是 `dsh-purge`。改名成 plus 之后两个目录都**没有**跟着改，即 plus 与 community 共用同一套状态目录。

### 2.1 更新族

| 载体 | 字段 | 类型 | 谁写 | 谁读 | 生命周期 |
|---|---|---|---|---|---|
| `dsh-purge/channel.json` | `channel` | `"stable"\|"beta"` | `writeChannelState` `update-state.js:145` | `readChannelState` `:131` | 切通道/安装成功时写；无删除逻辑 |
| 同上 | `pin` | string | 同上 | 同上 | `isBetaName(pin)` 或 `beta` 会被强制清空（`:139`） |
| `dsh-purge/version-history.json` | 数组元素 `{ref,sha,version,channel,label,kind,source,at,targets?,isolatedDir?}` | array ≤20 | `pushHistory` `:160` | `readHistory` `:154`、`update.js:664` | 每次安装/覆盖 push，按 `ref` 去重，截断到 20 |
| `dsh-purge/installed-rev` | 单行文本（git sha 或 `apply:<version>`） | text | `update.js:1177`、`reapply.js:85` | `readStamp` `:167` | 覆盖安装成功写；不删 |
| `dsh-purge/auto-update-guard.json` | `{ref,sha,version,at}` | json | `markAutoUpdateGuard` `:193` | `readAutoUpdateGuard` `:181` | 自动更新成功后写；TTL 12h（`:206`） |
| `dsh-purge/upstream-state.json` | `{ref,dir,sha,at}` | json | `writeUpstreamState` `:226` | `readUpstreamState` `:215` | 上游隔离目录安装后写 |
| `dsh-purge/update-preferences.json` | `{autoCheck,autoInstall,intervalHours}` | json | `savePreferences` `update-policy.js:148` | `preferences` `:39` | 只改行为偏好时写 |
| `dsh-purge/update-channel.json` | `{mirrorUrl,proxyUrl,githubToken}` | json，0600/私有 ACL | `writeChannel` `update-policy.js:118` → `writeSecretFile` `update-secrets.js:111` | `channelSettings` `:28` | 只在通道字段变化时写；`githubToken` 永不回显（`:107`） |
| `dsh-purge/update-status.json` | `{checkedAt,availableVersion,hasUpdate,pendingVersion,restartRequired,lastPendingVersion,pendingResolution,installedAt,targets,installError,error,runningVersion,installedVersion,reconciliationError}` | json | `record` `update-policy.js:203` | `updateStatus` `:159` | 每次检查/安装写；`installError`/`targets` 故意保留（`:183`） |
| `dsh-purge-community/backups/<id>/manifest.json` | `{schema:2,id,created_at,reason,host_version,profile,home,plugins[],sums{},blobs{},bundles[],complete:true}` | json | `Maintenance.snapshot` `community.js:524` | `list` `:366`、`verify` `:556`、`rollback` `:605` | 每次 backup/install 前生成；`prune` 删（`:439`） |
| 同上目录 `objects/<sha256>` | 去重对象（≥32KiB 才入） | binary | `copyTreeDedup` `:234` | `materializeTree` `:274` | `gcObjects` `:409` 删无引用对象 |
| `dsh-purge-community/migrations/<backupId>.json` | `{schema:1,changes:[{id,from,to}]}` | json | `community.js:749`、`:663` | `rollback` `:611` | 用于回滚时反向迁移包名 |
| `dsh-purge-community/audit.jsonl` (+`.1`,`.2`) | `{at,event,pid,...}` | jsonl | `logAudit` `audit.js:97` | `readAudit` `:124` | 1MB 轮转，保留 2 份（`:11-12`、`:43`） |

### 2.2 桌面族

| 载体 | 字段 | 类型 | 谁写 | 谁读 | 生命周期 |
|---|---|---|---|---|---|
| `<resources>/app.asar.bak` | — | binary | `renameAsarAside` `extract-asar.js:198`、`restart-desktop.js:273` | 人工恢复 | 换包时归档被改名 |
| `<resources>/app.asar.purge-handoff.json` | `{token,phase,updated_at,exe,bundle,asar,backup,archive_sha256,timeoutMs,pollMs,pid,detail}` | json | `macos-asar-handoff.js:234`、`windows-asar-handoff.js:38` | `readMacAsarHandoff` `:9` / `readWindowsAsarHandoff` `:148` | phase ∈ starting/ready/waiting_for_quit/waiting_for_unlock/moving/complete/expired/failed/helper_stopped/archive_reappeared/backup_missing |
| `<resources>/app.asar.rename-pending` | token | text | `macos-asar-handoff.js:233`、`windows-asar-handoff.js:186` | 两个 handoff 模块 | 完成或失败后删除；30min 视为失效（`desktop.js:857`） |
| `<resources>/app.dshpurge-prev[-<uuid>]` | — | dir | `commitExtractedDir` `extract-asar.js:456` | `newestPreservedDir` `:509` | 解包成功后被 `clearStaleExtractedApps`（`official-update.js:29`）清 |
| `<resources>/app.dshpurge-recover.json` | `{when,destDir,nextDir,prev,prevRestored,operation,code,syscall,error}` | json | `extract-asar.js:475` | 人工/下次 `extractAsarToSide` `:425` | 换目录成功后 unlink（`:502`） |
| `dsh-purge/unpacked-asar.json` | 归档身份（size/mtime） | json | `core.js`（`writeUnpackedAsarStamp`，被 `reapply.js:362` 调用） | `shouldExtractAsar` `extract-asar.js:247` | 换包成功后写 |
| `%TMP%/dsh-purge-official-restart[-pid-rand].{js,cmd,log}` | 脚本与日志 | text | `desktop.js:1299` | `officialRestartLogState` `:1111` | 24h 后由 `cleanupLegacyRestartScripts` `:38` 删 |
| `%TMP%/dsh-purge-official-restarting` | mtime | marker | `desktop.js:1280` | `planOfficialRestart` `:1092` | 45s 窗口（`:1085`）；脚本结束时删 |
| `%TMP%/dsh-purge-desktop.log` | 行日志 | text | `logInternal` `desktop.js:28` | 人工 | 不轮转（只 append） |
| `%TMP%/purge-macos-handoff-<token>.cjs` | 自包含 worker | js | `macos-asar-handoff.js:273` | 子进程 | 用完不删（`flag:"wx"`，靠 tmp 清理） |
| `%TMP%/dsh-purge-handoff-<token>.ps1` + `.broker.log` + `.launch.log` | 脚本与日志 | text | `windows-asar-handoff.js:184`、`:267` | 子进程 | 同上 |

### 2.3 身份与安装 / 预设 / 提示词

| 载体 | 字段 | 类型 | 谁写 | 谁读 | 生命周期 |
|---|---|---|---|---|---|
| `dsh-purge/tuning.json` | `{boost,injectPosition,askNoBlock,rewind,refusalRetry,refusalDecompose,refusalSeed,permissionPatches,contextManagement,extraPatches[]}` | json 0600 | `writeTuning` `tuning.js:70` | `readTuning` `:37` | 缺文件即默认全开（`:14-25`）；非法值归一（`:55-66`） |
| `dsh-purge/boost.json` | `{enabled}` | json | 旧版 | `readBoost` `boost.js:35` | 仅当 `tuning.json` 不存在时生效（`:40`） |
| `dsh-purge/hooks-deny.json` | `{hooksDenyBypass}` | json | `saveHookDenySettings` `hooks-deny.js:208` | `loadHookDenySettings` `:168` | 优先级：文件 > 插件 config > 默认 true（`:179-181`） |
| `dsh-purge/drill-grant.json` | `{granted:true,at}` | json | `writeDrillGrant` `drill-grant.js:28` | `readDrillGrant` `:13` | 卸载成功时 `clearDrillGrant` `:45` 删 |
| `dsh-purge/probe.json` | `{nonce,at}` | json 0600 | `createProbe` `probe.js:41` | `readProbe` `:20` | 30min TTL，过期自删（`:27-34`） |
| `dsh-purge/anchor-overrides.json` | `{ "<patchId>": { "<index>": {pattern,at,host} } }` | json 0600 | `writeOverride` `anchors.js:38` | `readOverrides` `:27` | `clearOverride` `:54` 删；删文件即回出厂锚点 |
| `dsh-purge/applied.json` | `{version,sha,at}` | json | `writeAppliedStamp` `reapply.js:93` | `readAppliedStamp` `:37` | 只在「应用」成功时写（`:207`） |
| `dsh-purge/settle-restart.guard` | `{version,at}` | json | `markSettleRestart` `reapply.js:277` | `shouldSkipSettleRestart` `:266` | 180s 冷却窗口 |
| `dsh-purge/continue-retry.json` | `{autoRetry,retryMax,autoContinue,continueMax,continueText}` | json | 调用方（`core.js`） | `loadSettings` `continue-retry.js:66` | 与插件 config 合并（`:77`） |
| `dsh-purge/cwd-selections.json` | `{paths:string[]}` | json | `writeCwdSelections` `rules.js:501` | `readCwdSelections` `:494` | 勾选即写 |
| `dsh-purge/workspace-policy.json` | `{policy:"fallback"\|"strict"\|"always"}` | json | `writeWorkspacePolicy` `rules.js:469` | `readWorkspacePolicy` `:460` | 缺文件 = fallback |
| `dsh-purge/last-cwd.txt` | 路径 | text | `writeLastCwd` `rules.js:525` | `readLastCwd` `:518` | 每次状态查询后写 |
| `dsh-purge/net-scope-allow.txt` | 每行一个 host 或 `user@host`，`#` 注释 | text | `writeAllowText` `net-scope.js:381` | `readAllowText` `:373` | 归一化后写（丢弃通配/网段/密钥，`:349`） |
| `rules/<id>.md` | 规则正文 ≤256KB | md | `saveRule` `rules.js:161` | `readRule` `:152` | 原子写 + 失败回滚（`:185-200`） |
| `rules/<id>.json` | `{name,target}` | json | `writeRuleMeta` `rules.js:104` | `readRuleMeta` `:95` | `target ∈ {AGENTS.md, CLAUDE.md}` |
| `rules/state.json` | `{active:id}` | json | `setActive` `rules.js:233` | `readActive` `:224` | 删规则时连带删（`:216-221`） |
| `$DSH_HOME/AGENTS.md` / `CLAUDE.md` | 规则正文 | md | `activateRule` `rules.js:281` | 宿主 agent-instructions | 首次激活前备份为 `<target>.dsh-purge-rule.bak`（`:271`） |
| `skills/<id>/SKILL.md` 或 `skills/<id>.md` | frontmatter + 正文 | md ≤256KB | `saveSkill` `skills.js:412` | `readSkill` `:298` | 写前备份到 `dsh-purge-backups/skills/<id>_<stamp>_<pid-rand>`（`:368`） |
| `dsh-purge-community/maintenance.guard/<token>.json` + `maintenance.lock` | `{schema:1,host,pid,createdAt,token}` | json，两名字同一 inode | `acquireMaintenanceLock` `maintenance-lock.js:51` | `check()` `:71` | 成功 release 后两个名字都删（`:83-104`） |
| `dsh-purge-community/pkgs/<sha256>/<basename>` | tgz 持久副本 | binary | `Maintenance.install` `community.js:693` | pnpm 安装 | 不自动清（占空间） |
| `dsh-purge-community/install-recovery/<backupId>/` | `package.json`、`pnpm-lock.yaml`、`node_modules` 全树 | dir | `checkpointProfile` `rollback-transaction.js:55` | `restore()` `:67` | 成功后 `finish()` 删（`:66`） |
| `dsh-purge-community/restored/<backupId>-<rand>/` | 还原件 staging | dir | `rollback` `community.js:622` | `installWithDsh` | 不自动清 |

---

## 3. 业务逻辑

### 3.0 更新族：这一族解决什么问题

**问题**：插件要能「面板点一下就换版本」，并且换坏了能退回来，而宿主进程正在运行、网络可能被墙/限流、用户可能配了代理或镜像、GitHub 可能返回脏数据。

**机制**：把更新拆成 6 个可独立失败的阶段，每阶段都有降级值而不是抛异常；任何写入磁盘的动作前必须先有快照。

**状态存在**：§2.1 的 7 个 JSON + `backups/`。

#### 3.0.1 完整时序（检查 → 选目标 → 下载 → 校验 → 安装 → 重启）

```
① 检查   checkUpdate()                      update.js:788
   ├ listRemoteVersions()                   update.js:635
   │   ├ listForkReleases()                 update.js:550
   │   │   ├ releasedVersions()             community.js:854   ← GitHub API /releases?per_page=20
   │   │   │   └ 失败/超时 → releases.atom  update.js:569
   │   │   │       └ 逐个核 SHA256SUMS.txt  update.js:538 verifyAtomRelease
   │   │   │           └ 全失败 → 10 分钟内旧缓存 update.js:583
   │   │   │               └ 仍无 → {rows:[],error}            update.js:586
   │   │   └ 60s 内存缓存                                       update.js:502-504
   │   ├ listGithubTags()                   update.js:590   ← 只作 legacy 展示
   │   ├ remoteHeadSha(master/beta)         update-net.js:171 ← API 与 atom 双路
   │   ├ readHistory()                      update.js:664   ← 本地历史补进列表
   │   └ ensureRunningVersion / markCurrent / hideListedVersion
   ├ lanesOf() → stable/beta 两条 lane       update.js:760
   ├ summarizeProfileUpdates(profileVersions(...))   update-targets.js:5,16
   └ 失败时 readPublishedVersion() 补一句「GitHub 当前正式版为 X」 update.js:773,859-866
② 选目标  lane = lanes[state.channel]        update.js:808
   ├ channel=stable → ref="releases"，取 lane.latestRef（= 最新 tag）
   └ channel=beta   → ref="beta"，走隔离目录（永不覆盖当前安装）
③ 下载   prepareRelease()                    community.js:889
   ├ 校验 ref 形状 → 版本一致 → asset/sums 必须是官方 URL 前缀
   ├ 有镜像时：直连 api.github.com 取 metadata + asset.digest（authoritative）  :897-904
   ├ 否则读 SHA256SUMS.txt 取 expected                                         :905-911
   ├ downloadArchive() → 主机白名单 + 180s 预算                                update-download.js:18
   └ 写 dsh-purge-community/downloads/<ref>/<name>（atomic）                    :914-917
④ 校验   hash(bytes) === expected            community.js:913
   └ validateArchive()：tar -tzf 路径必须都在 package/ 下、无 .. / 反斜杠；
      tar -tvzf 首字符只允许 - 或 d；package.json 的 name/version/repository.url 必须匹配  :926-967
⑤ 安装   Maintenance.install()               community.js:686
   ├ 复制 tgz 到持久目录 pkgs/<sha256>/（避免 pnpm 记住 /tmp 路径）              :693-697
   ├ snapshot("before-update")                                                  :698
   ├ fromLatest 浮动依赖 → 先改成本地 file: 再装（防 pnpm 重解析旧 URL）         :703-717
   ├ installWithDsh() → 修 runtime 链接 → dsh plugin add（180s 超时）           :771-850
   ├ 装后身份核对：node_modules/<PACKAGE>/package.json 的 name+version           :720-723
   ├ verifyInstalledPackage() → 全新进程 import 一遍                             rollback-transaction.js:19
   ├ 迁移 cordis.patch.yml 里的旧包名（只改 name 行，不碰其余 YAML）             :728-729
   ├ 更新 dsh.profile.bundles                                                   :739-746
   └ 失败 → checkpoint.restore() 恢复 package.json/pnpm-lock/node_modules       :762-767
⑥ 重启   返回 needRestart=true / needsFullQuit=true，由调用方决定              update.js:1007-1008
   桌面密封 asar → 走 asar 交接（§3.1），Web → restart-web.js
```

#### 3.0.2 每个环节的失败路径与降级

| 环节 | 失败条件 | 行为 | 证据 |
|---|---|---|---|
| 发行列表 API | 403/429 限流、断网、20s 预算超时 | 降级 `releases.atom`；atom 再失败 → 10min 旧缓存；仍无 → `{rows:[],error}`，`hasUpdate:null` | `update.js:556-586`、`update-net.js:49` |
| atom 候选 | tag 不匹配 `FORK_RELEASE_RE`、SHA256SUMS 里没有对应 tgz | 该候选被丢弃；全部丢弃则算降级失败 | `update.js:517`、`:538-547` |
| 上游 head/tag | 任一请求失败 | 返回空串，只是列表少几行，不影响正式通道 | `update-net.js:171-189` |
| 版本比较 | 本地版本为空 | `versionIsNewer(remote,"")` = true（视为有更新） | `update-state.js:94` |
| 发行包元数据 | draft/prerelease/asset URL 不符 | `throw "正式发行元数据不匹配"` | `community.js:901` |
| SHA256 | 缺失或格式不对 | `throw "发行包缺少有效 SHA256"` | `community.js:911` |
| 字节校验 | 哈希不符 | `throw "安装包 SHA256 校验失败"`，不落盘 | `community.js:913` |
| 归档结构 | 含 `..`、反斜杠、链接、非 package/ 前缀、identity 不符 | `throw`，不安装 | `community.js:936-966` |
| 网络/完整性失败 | `prepareRelease` 抛错 | **不启动安装、也不启动回滚**（因为还没备份） | `update.js:934-935` 注释与顺序 |
| 备份 | `manager.backup()` 抛错 | 中止本次安装 | `update.js:937` |
| 安装后验证 | 磁盘版本 ≠ 目标版本 | 抛错 → 回滚到 `backup.id` | `update.js:939`、`:953-959` |
| 回滚本身失败 | `manager.rollback` 抛错 | 错误信息里带「回滚失败：…」，结果 `ok:false` | `update.js:957-958` |
| 并发 | 两个 `applyUpdate` 同时进来 | 第二个共享第一个的 Promise | `update.js:1213-1227` |
| 自动更新死循环 | 宿主没重启 → 又判定有更新 | `auto-update-guard.json` 12h 内同目标跳过 | `update.js:1323-1328`、`update-state.js:206` |

#### 3.0.3 镜像 / 代理 / SOCKS 怎么选（`update-http.js`）

选择顺序（`proxyFor` `update-http.js:45`）：

1. `no_proxy` / `NO_PROXY` 命中 → **不用代理**（`bypassProxy` `:18`，支持 `*`、`<local>`、`host:port`、`*.suffix`）
2. 显式环境变量，按优先级：`PURGE_HTTPS_PROXY` → `https_proxy` → `HTTPS_PROXY` → `http_proxy` → `HTTP_PROXY`（`:47`）
3. 都没有且 `platform === "win32"` → `readWindowsProxy()`（`update-system-proxy.js:24`：`reg.exe query HKCU\...\Internet Settings`，非 ASCII 或布局异常时回退 PowerShell `-EncodedCommand`）
   - `AutoConfigURL` 有值但 `ProxyEnable` 为假 → **抛错**要求显式配 `PURGE_HTTPS_PROXY`（`:42`）
4. 协议白名单：`http: / https: / socks: / socks5: / socks5h:`，其它抛「仅支持 HTTP/HTTPS CONNECT 或 SOCKS5」（`:52`）
5. SOCKS 分支：`socksTunnel()` 做有界握手（方法协商 → 可选用户名密码 → CONNECT 域名），响应缓冲上限 1024B，然后 `tls.connect`（`update-socks.js:3-49`、`update-http.js:77-87`）
6. HTTP/HTTPS 代理分支：发 `CONNECT host:port`，带 `proxy-authorization: Basic`，状态码非 200 直接失败（`:88-104`）
7. 代理只用于 HTTPS：明文 HTTP 目标 + 有代理 → 抛「更新代理只用于 HTTPS 下载」（`:129`）

镜像（`update-mirror.js`）：

- 来源：`PURGE_GH_MIRROR`（也可由 `update-channel.json.mirrorUrl` 注入，`update-policy.js:102`）
- 规范化（`:3`）：必须 https、无凭证、无 query/hash、端口必须 443、**不能是 GitHub 自己的域**；`gh-proxy.org` 会被补成 `https://gh-proxy.org/`；不以 `/` 结尾则补
- 生效范围：只对 `MIRROR_HOSTS` 里的主机改写（`:14-19`），即只换传输
- **权威元数据绕过镜像**：`requestUpdate(..., {authoritative:true})` 时 `mirrored = null`（`update-http.js:165`）；且镜像请求会把 `GITHUB_TOKEN`/`GH_TOKEN` 清空（`:176`），避免把 token 发给镜像
- 校验不受镜像影响：`prepareRelease` 在有镜像时**直连** GitHub 取 `asset.digest`（`community.js:897-904`）

#### 3.0.4 `community.js` 的三个判据（含版本号正则）

**(a) `listForkReleases`（`update.js:550`）**

```js
// 过滤：只认 tag 形状
const FORK_RELEASE_RE = /^v\d+\.\d+\.\d+$/;            // update.js:116  [静态]
rows.map(forkReleaseItem).filter(item => FORK_RELEASE_RE.test(item.ref))   // update.js:562
```

- `[实测]` `v1.7.20` → true；`v1.7.20-plus.1` → **false**；`v1.7.20-rc.1` → false；`v1.7` → false；`v1.7.20.1` → false
- 放宽后（plus 构建，`dist/build/package/lib/update.js:116`）：`/^v\d+\.\d+\.\d+(?:-plus\.\d+)?$/`
  - `[实测]` `v1.7.20-plus.1` / `v1.7.20-plus.2` → true；`v1.7.20-rc.1`、`v1.7.20-plus`（无数字）、`v1.7.20.1` → 仍 false
  - 即：**只多认 `-plus.N` 一种后缀**，预发布、四段版本号、无数字后缀都不认
- 同一正则还有两处（`community.js:866` 发行过滤、`community.js:890` `prepareRelease` 准入）；plus 构建里 `community.js` 恰好 2 处、`update.js` 1 处 `(?:-plus\.\d+)?`（`[实测]` `grep -o` 计数）

**(b) `checkUpdate`（`update.js:788`）**

判据与输出：

| 判据 | 行 | 结果 |
|---|---|---|
| `listed.error` 或 `listed.stale` | `:826` | `hasUpdate = null`（不是 false） |
| `state.channel === "stable" && !state.pin && lane.version` | `:819` | 逐 profile 判 `hasUpdate`，`retryIncomplete` 表示「部分目标已最新、部分未更新」 |
| 否则 | `:821` | 直接用 lane 的 `hasUpdate` |
| `listed.error` | `:856` | `result.error = "无法读取社区发行列表：…"`（面板只渲染 error/notice） |
| `state.channel === "beta"` | `:858` | `result.error = UPSTREAM_WARNING` |
| 列表失败 | `:859-866` | 追加 `publishedVersion`（直连 `/releases/latest`，要求 `draft===false && prerelease===false && tag 匹配 && html_url 完全一致`，`:780-783`） |

`[实测]`（`dist/build/package`，2026-11-20T16:2x+08:00）真实返回：

```json
{"ok":false,"hasUpdate":null,
 "error":"无法读取社区发行列表：GitHub API 额度耗尽（HTTP 403），重置时间 2026-11-20T08:32:02.000Z；…；releases.atom 降级失败：GitHub 资源不存在或无访问权限（HTTP 404）；最新正式版也未能确认：…403…",
 "degraded":"releases.atom 降级失败：GitHub 资源不存在或无访问权限（HTTP 404）",
 "remoteVersion":"1.7.20-plus.3","updateTarget":"releases","releases":0,"versions":1}
```

同时 `[实测]`：`https://github.com/EthanChewCN/dsh-purge-plus` 返回 **404**（账号页 `https://github.com/EthanChewCN` 返回 200），`/releases.atom` 同样 404。即该仓库当前对匿名请求不可见（私有或已改名），因此本机 IP 一旦被 API 限流，atom 兜底**必然**失败。

**(c) `prepareRelease`（`community.js:889`）**

| 判据 | 行 | 失败文案 |
|---|---|---|
| `ref` 形状（同上正则） | `:890` | 只安装正式发布版本 |
| `ref === "v"+version` | `:891` | 发行版本与标签不一致 |
| `asset`/`sums` 必须等于 `https://github.com/<REPOSITORY>/releases/download/<ref>/<name>` | `:893-895` | 发行包或校验文件不属于当前项目的官方发行来源 |
| 镜像模式下 metadata 的 tag/draft/prerelease/asset URL | `:899-902` | 官方发行元数据不匹配 |
| `expected` 必须是 64 位小写 hex | `:911` | 发行包缺少有效 SHA256 |
| 字节哈希 | `:913` | 安装包 SHA256 校验失败 |
| 归档结构 + 身份 | `:918`、`:926-967` | 安装包路径无效 / 不允许链接或特殊文件 / 身份与发行版本不一致 |

`fromLatest` 浮动依赖的识别正则（`community.js:703-704`）：

```js
/^https:\/\/github\.com\/kingcharleslzy-ai\/dsh-purge\/releases\/latest\/download\/dsh-purge-community(?:-[0-9]+\.[0-9]+\.[0-9]+)?\.tgz$/
```

plus 构建把它改成了 `.../EthanChewCN/dsh-purge-plus/.../dsh-purge-plus(?:-[0-9]+\.[0-9]+\.[0-9]+(?:-plus\.[0-9]+)?)?\.tgz`（`dist/build/package/lib/community.js:704`）。若旧依赖写的是上游直链而正则不认，`fromLatest=false`，`keepDisabled` 语义（`:705`）丢失。

#### 3.0.5 自动更新（`autoUpdateIfNeeded` `update.js:1304`）

1. `channel === "beta"` → 直接跳过（`skipped:"upstream-lane"`）
2. `checkUpdate()` 失败 → `skipped:"offline"`
3. 无更新 → `skipped:"latest"`
4. 读 `auto-update-guard.json`；12h 内且同 `ref`/同 `version` 且 `!retryIncomplete` → `skipped:"guard"`
5. 否则 `applyUpdate(..., {reason:"auto"})`

控制器侧（`update-policy.js:188` `createUpdateController`）：`start()` 先 30s 再按 `intervalHours`（默认 6）循环；网络 I/O 之后**重读**两个开关（`:245`），任一关闭即放弃安装；`restartRequired` 时只允许 `retryIncomplete && remoteVersion === pendingVersion` 这一种例外（`:256`）。

### 3.1 桌面族：解包/换包的完整流程与失败回滚

**问题**：官方桌面把宿主封在 `app.asar` 里，插件要改宿主源码就必须先把归档解出来；而归档被运行中的进程占用，不能直接删。

**机制**：`extract-asar.js` 负责「探测是否被封 → 解到旁路目录 → 校验整棵树 → 换目录」；`*-asar-handoff.js` 负责「不杀进程，等用户自己退出后再动归档」。

#### 3.1.1 解包（`extractAsarToSide` → `commitExtractedDir`）

```
shouldExtractAsar({usable, identity, recorded, upgrade})      extract-asar.js:247
  无 identity（归档不存在）→ false
  !usable（目录不在）      → true
  upgrade 且 identity≠recorded → true
  recorded 存在且 identity≠recorded → true
  其余 → false（复用现有目录）

extractAsarToSide(asar, dest)                                :417
  usual = dest + ".dshpurge-next"
  若存在 dest+".dshpurge-recover.json" → mkdtemp（上次失败可能留着唯一完整副本）
  否则 mkdir(usual)；EEXIST → mkdtemp(usual+"-")
  extractAsar(asar, next)                                    :553
    读 16 字节头：magic=4、headerSize、jsonSize；jsonSize ≤256MB；8+headerSize ≤ 文件大小
    walk(header) 逐条 safeArchiveName（禁 ..、禁 / \ :、禁尾随点空格、禁 CON/NUL/COM1）
    先整体校验数据区间（offset+size 不得越过 dataOffset 之后），再落盘
    最后建链接：link 目标必须在 destDir 内（assertWithinRoots）
  失败 → discardDir(next)

overlayAsarUnpacked(asar, dest)                              :327
  把 app.asar.unpacked 里未在归档正文的原生文件补进 dest（已存在则跳过）

verifyStagedAsar(asar, stage)                                :372
  逐条比对：目录 / 链接目标 / 普通文件（size 或 integrity SHA256 或 signedSidecars 摘要）
  任何不符 → throw "解包不完整，取消换包"

commitExtractedDir(dest, next)                               :456
  dest 存在 → rename(dest, dest+".dshpurge-prev[-uuid]")
  rename(next, dest)
  失败：
    尝试 restoreFromPrev
    写 dest+".dshpurge-recover.json"（含 code/syscall/error/prev/prevRestored）
    err.keepStage = true，nextDir 保留
  成功：unlink recover.json（失败只 emitWarning，不进入回滚路径）
```

失败回滚：`restoreExtractedDir(dest, prev)`（`:531`）先把当前 `dest` 改名成 `dest.dshpurge-failed-<ts>`，再把 `prev` 改回来；改名失败时把 failed 改回 dest；最后删 failed。

#### 3.1.2 换包（不杀进程的交接）

macOS（`macos-asar-handoff.js`）：

1. `scheduleMacAsarHandoff`（`:196`）要求 `exe` 在 `<bundle>/Contents/MacOS/` 下，且 `asar` 的父目录 realpath 等于 `<bundle>/Contents/Resources`
2. 已有活动 phase（starting/ready/waiting_for_quit/moving）→ `already`；有陌生 `rename-pending` 锁 → 抛错要求人工检查（`:223-232`）
3. 写 `token` 到 `.rename-pending`（`wx`）、写状态 json、把 worker 源码 `toString()` 序列化成独立 `.cjs` 并 `spawn`（`:269-288`）
4. worker 流程：`ready` → 校验 `app/package.json` 的 `main` 在 app 内且存在、`app/runtime` 链接不缺 → `waiting_for_quit` → 每 `pollMs` 用 `/bin/ps -axo pid=,comm=` 判目标进程是否还在（只看 comm，不看 argv）→ 归档 sha256 必须仍等于开工时的值 → `moving` → `linkSync` 硬链接备份 → 校验 inode/dev/hash → `unlinkSync` 原归档 → 校验 → `complete`
5. 超时（默认 30min）→ `expired`，原归档保留，`exitCode=2`

Windows（`windows-asar-handoff.js`）：逻辑同上，但

- 用 PowerShell 脚本（`WINDOWS_ASAR_HANDOFF_PS1` `:9`），状态写入用 `[IO.File]::Replace`（`:51`），失败重试 3s 内对 32/33（sharing/lock violation）与 80/183（创建竞态）退避
- 进程判活用 `Get-Process -Name <exeBaseName>` 再比 `Path`（`:81`）
- 启动助手时先探测自己是否在 Job Object 里（`IsProcessInJob`），在则改用**同用户本地 WMI** `Win32_Process.Create` 起进程，否则 `Start-Process`（`:204-266`）；broker 观察子进程时把「已 ack（state.phase≠starting）」「确实不存在（ObjectNotFound）」「未知」三态分开，只有第二种才算死（`:230-265`）
- 换归档失败且 win32_code ∉ {32,33} → 立即 `failed`；∈ {32,33} → `waiting_for_unlock` 继续等

#### 3.1.3 重启决策（`desktop.js`）

| 入口 | 判据 | 行为 |
|---|---|---|
| `desktopRestartChoice` `:900` | `openBrowser===false` → `skip`；win32+official → `windows-official`；有 exe 且 `asarSealed` → `asar-swap`；有 exe → `helper`；有 runtime → `request-restart`；否则 `helper` | 只决定走哪条 |
| `scheduleRestart` `:942` | `openBrowser===false` 直接跳过；`officialExeFromProcess()||findDesktopAppExecutable()`；win32+official → `restartOfficialHarness`；有 asar 文件 → `scheduleAsarSwapRestart`；否则 helper / `runtime.requestRestart()` | 返回 `{restarting, asarSwap?, error?}` |
| `restartOfficialHarness` `:1183` | 未找到 exe → `{restarting:false}`；win32 且 asar 还在 → `scheduleWindowsAsarHandoff`；`isOfficialHarnessExecutable` 为假但有 asar → `scheduleAsarSwapRestart`；`requireClean!==false` 且 `unpackedHostIsClean` 为假 → `{restarting:false, clean:false}`；45s 内已有 running 的 inflight → `already` | 真起 wscript 或 PowerShell |
| `planOfficialRestart` `:1092` | `fresh && state==="running"` → `already`；否则 `wshJs && scriptAscii!==false` → wscript，否则 powershell | 纯函数，可单测 |
| `scheduleAsarRenameWhenIdle` `:851` | 30min 内已有 `rename-pending` → `already`；win32 转 `scheduleWindowsAsarHandoff` | macOS/Linux 起 `/bin/sh` 轮询脚本，最长 1800s |

### 3.2 身份与安装：`identity.js` 到底改了宿主的什么标识

**它不改宿主文件**（宿主源码改动是 `patches/` 的事，另册）。它改的是**每一轮 prompt 组装结果**（`assembled.sections`）：

| 动作 | 判据 | 副作用 | 行 |
|---|---|---|---|
| 丢掉官方身份段 | `name === "harness:identity"` 或 `"dsh-purge:identity"` | 该 section 不进入输出 | `:951-952` |
| 剥宿主身份句 | 非插件段（`!isPluginPromptSection`） | `stripChatmlTags(stripHarnessPersona(text))`：删 `You are an AI agent, powered by DeepSeek Harness.`、`You are a coding agent powered by the {{model}} model…`、`我是 DeepSeek 的 AI 助手`、Claude 身份句，并把一批「拒绝/审批/不可信」句式替换成「继续执行/自动授权/可用参考」 | `:956-958`、`:106-190` |
| 注入置顶 | 每次组装 | 生成 `{name:"dsh-purge", order:-100000, interpolate:false}` 与 `{name:"dshpg-capabilities", order:-99999}` 置于最前 | `:330-380`、`:3` |
| 去重注入 | 全文精确匹配；>4096 字符的分段后逐段匹配；每段再退一步把连续空白当 `\s+` | 其它段里出现的注入正文被删除（避免系统提示词出现 2–4 份） | `:287-327` |
| 折叠进 persona | `dropPurgeAfterFold !== false` | 有 `deployment:persona-prefix` 就写进去；没有就新建该段 | `:762-781` |
| 官方身份中性化 | `overlayOfficialIdentity` | `deployment:persona-prefix`/`persona` 里若是官方身份句 → 清空；`persona-suffix` → 只留 `Your working directory is {{cwd}}.`（无 cwd 变量时用静态句）；缺 suffix 则补一个 `order:10200` | `:227-262`、`:8-9` |
| 红队切分 | 文本里有独立成行的 `CTF CORE CONTRACT`（且不在代码围栏内） | 从该行切开，红队模式丢掉 ctfTail；同时去掉「禁区说明」段 | `:435-468` |
| 红队操作稿 | 文本含 `## 运行环境前提` | 只保留操作稿并前置一句「身份以上面为准」 | `:383-421` |
| 最小预设适配 | 名字命中 minimal | 删 `STRICT REQUIREMENT — MUST USE` 整块，改写 Claude 工具名残句 | `:552-598` |
| 能力协议 | `capabilityProtocol !== false` | 按 官方/红队指挥/红队执行 三选一插入 `dshpg-capabilities` | `capability-protocol.js:43-48` |
| 兜底再插一次 | 输出里找不到注入前 80 字符 | 在最前补一个 `dsh-purge` 段 | `:1006-1022` |

`installAssembleGuard`（`:823`）包住 `prompt.assemble`：

- 用 `Symbol.for("dsh-purge.assembleGuard")` 做幂等标记；重复安装只替换 `slot.rewrite`，不再 defineProperty（否则 Cordis 每读一次方法就多一层代理，最终栈溢出）
- 内层 `assemble` 抛错时**原样抛出**（不返回空 assembly，否则会静默丢掉 persona/context/工具声明）
- `rewrite` 抛错时返回未改写的 `assembled`
- accessor 挂不上时退到 `defineProperty(value, writable:false)`，再退到直接赋值

### 3.3 预设族

**问题**：宿主 0.1.7+ 的模式下拉只认 `agentPresets.register()`，把文件夹丢进 `~/.dsh/.agent-presets/` 不会出现。

| 入口 | 判据 | 副作用 | 行 |
|---|---|---|---|
| `installPreset` `presets.js:32` | 目标文件已存在且无 `force` → `kept`；否则 `COPYFILE_EXCL` 复制 | 落盘后顺手应用补丁 #24 的替换（避免自检显示「#24 待应用」） | `:37-54` |
| `presets-plugin.apply(ctx)` `presets-plugin.js:30` | `profileOwnsPreset` 为真 → 交由宿主注册；registry 未就绪 → 每 500ms 重试，上限 40 次；错误含 `already/duplicate/invalid` → 终态不重试 | `adaptListAgents` → `ensureToolExecutor` → `migratePresetDefinition` → `backupPresetMigration` → `registerPresetDefinitions`；`ctx.effect` 卸载时 release | `:51-92` |
| `injectionPolicy(config, context)` `preset-injection.js:11` | `enabled !== false && !excluded && !unknown`；`unknown` = 配了 exclude 但解析不到当前预设 | 返回 `{preset, excluded, unknown, allowed}` | `:11-20` |
| `withoutPurgeInjection` `:30` | 按 `Symbol.for('dsh-purge.prompt-provenance.v1')` 记录的原/写快照精确回退 | 只撤我方写入，正则删用户文本一律不做 | `:27-54` |
| `inspectPresetText` `preset-diagnostic.js:8` | 必须是 patch 列表、恰好一个 `persona` 行、`disabled` 只能是字面 false、`config.prefix` 必须是无 `{{`/`${` 的字符串 | 返回 `not_needed` / `skipped` / `unknown` | `:11-30` |
| `permissionState` `permission-state.js:39` | `full(v) = sandbox==="danger-full-access" && approval==="never"`；`known` 需 sandbox/approval 都是字面串；`pinned` 需 `defaultPreset` 匹配 `^[a-z][a-z-]*$` | 四态：`unknown`（不可判）/ `broken`（已知但不是全权）/ `inferred`（运行时默认全权但未固定）/ `ok`（profile 显式固定全权） | `:3`、`:53-58` |

### 3.4 `rules.js` / `skills.js`：数据结构、增删改查、注入点

`rules.js`

- 数据：`rules/<id>.md`（正文）+ `rules/<id>.json`（`{name,target}`）+ `rules/state.json`（`{active}`）
- id 约束 `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`（`:17`），正文 ≤256KB（`:18`）
- 增：`saveRule` 原子写两份，任一失败按原值回滚（`:161-202`）
- 删：`deleteRule` 删 md+json；若删的是 active，连带删 state.json（`:204-222`）
- 改：同「增」
- 查：`listRules`（按 id 排序，`size` 来自 stat）、`readRule`、`rulesStatus`（含 `injectSource`、CWD 候选、勾选、策略）
- **注入点有两个，互相独立**：
  1. 系统提示词注入正文：`resolveInjectText`（`:243`）优先级 = 本进程框内提交（`peekCommittedOverride`）> `$DSH_HOME/prompt-inject.md` > 内置默认文本；`ensureOperatorBody` 把它挂到 `hangOperatorPrompt`（`:260`）
  2. 工作区指令：`activateRule` 把规则正文写进 `$DSH_HOME/AGENTS.md` 或 `CLAUDE.md`（`:266-284`），首次写前把原文件备份成 `.dsh-purge-rule.bak`
- CWD 规则：`ancestorChainForCwd`（`:396`，最多 32 层，遇 `.git/.hg/.svn` 停）+ `scanCwdInstructions`（`:426`，候选 `AGENTS.md`/`CLAUDE.md`/`*.local.md`）+ 勾选 `cwd-selections.json`；`readSelectedCwdInject`（`:538`）只采用**仍在当前扫描结果里**的勾选，总长 >512KB 截断

`skills.js`

- 数据：`skills/<id>/SKILL.md`（bundle）或 `skills/<id>.md`（flat）；id 必须 kebab-case（`:14`）
- frontmatter 自研解析：`splitFrontmatter`（`:106`）+ `blockScalarValue`（`:131`，支持 `|`/`>`/chomp/indent）+ `yamlLineField`（`:180`）+ `yamlBoolField`（`:200`）；不做 anchor/alias/多行 flow
- 增：`saveSkill` → 备份 → `removeOfficialSkill` → 写 bundle；失败 `restoreSkillFromBackup`（`:412-448`）
- 删：`deleteSkill` 先备份再删（`:450-457`）
- 导入：`importArchive`（zip/tar.gz，12MB 上限、解压后 50MB 上限、200 条目上限，CRC 可校验）/ `importFileTree` / `importFromPath`；三处都先 `assertImportSourceOutsideSkills` 防「从 skills 自身导入把源删空」（`:93-97`、`:570`）
- **注入点**：不注入提示词，只落 `$DSH_HOME/skills`，由宿主 skill 目录自动发现

### 3.5 提示词与规则族其余入口

| 入口 | 判据 | 副作用 / 失败路径 | 行 |
|---|---|---|---|
| `installContinueRetry(ctx, opts)` | `agent/request-error`：下游已 `retry` 就放行；`shouldAutoRetry` 排除永久错误码（AUTH/QUOTA/CONTEXT_* 等）；`takeRetry` 按 `turn:step:code` 去重；`agent/status` idle 后 280ms 才考虑续跑，且要求无新鲜人类轮、inbox 空、`autoContinue` 开 | 返回 `{kind:"retry"}` 并置 `globalThis.__dshPurgeRetryPending = true`；发送失败 `refundContinue` 并累加 `failStreak`（≥3 停手） | `continue-retry.js:276-360` |
| `streamWithRefusalRetry` | 缓冲到 400 字或 `finish`/tool-call/16000 推理字后判拒绝；命中且还有帧 → 关流重来；重试必须换 `retryStream`（Cordis 的 `next` 只能调一次） | 帧序列：`RETRY_NUDGE` → `FRAME_NUDGE` →（seed）→（decompose）；重试流建不起来时**放行上一轮拒绝文本**；结束时再采样 8000 字判 `partial_refused` | `refusal-retry.js:165-331` |
| `boost` | `readTuning().boost === true`（旧 `boost.json` 仅在无 `tuning.json` 时生效） | 把 `<dsh_boost>` 段以最大 order 追加到末尾 | `boost.js:14-50` |
| `hooks-deny` | 四条补丁 #30/#31/#64/#65 同一开关 `hooksDenyBypass`；文件 > 插件 config > 默认 true | 关闭时从补丁表里剔除这四条（`selectPatches` `:220`），并把已写死的形态按 8 条反向规则写回官方形态 | `hooks-deny.js:7-222` |
| `drill-grant` | 文件不存在 → 未授权；`granted===true` 才算 | 原子写（tmp+rename）；卸载时只删这一个文件 | `drill-grant.js:13-50` |
| `steering` | `nativeSteeringRestored`：不允许残留旧 marker；控制器要求 `NATIVE_QUEUE_GUARD`+`NATIVE_PROMPT`+（`NATIVE_QUEUE_CASE` 或 `HOST_QUEUE_CASE_GATED`）；loop 要求 `NATIVE_STEER` | 只做文本替换定义，实际写入由 `patches/` 执行 | `steering.js:35-80` |
| `stream-observation` | 只统计 `text-delta` 字数、tool-call/reasoning 布尔；错误码只保留 `^[A-Z][A-Z0-9_]{0,39}$` 形状 | 不改写、不缓冲、不重试；`report` 抛错被吞 | `stream-observation.js:2-24` |

### 3.6 `net-scope.js`：拦截逻辑在 1.7.20 已被移除（关键结论）

`[静态]` + `[实测]`：

- 模块**仍导出**：`allowFilePath`、`entryHost`、`normalizeAllowText`、`readAllowText`、`writeAllowText`、`ownServerNote`、`regionOfSuffix`（`[实测]` `node -e 'import("./lib/net-scope.js")'` 得到 7 个导出，与上述完全一致）
- `ownServerNote()` **返回空串**（`net-scope.js:410-412`；`[实测]` 输出 `""`），所以 `identity.js:787` 的 `withOwnServers()` 什么都不加
- 以下符号**只在文件内部定义、无任何外部引用**（`[静态]` 全库 grep）：
  - `DENIAL = "不行，这是严令禁止的"`（`:186`）
  - `ATTACK` 正则（`:191-192`）、`ATTACK_SCAN_CAP`（`:196`）
  - `NET_TOPIC`（`:198`）
  - `BANK_HOSTS`（`:104-173`）与 `bankHit`（`:175`）
  - `isSkippedV4`（`:214`）、`parseIpv6`（`:225`）
  - `allowDecision`（`:406`）、`allowCache`/`readAllowExact`（`:390-404`）
  - `regionOfSuffix`（`:253`）虽 `export`，但库内无调用方
- 唯一被 `index.js` 使用的是 `readAllowText`/`writeAllowText`（`index.js:45`），挂在 `/dsh-purge/own-servers` 路由上（`index.js:2643-2670`，path 在 `:2645`）：GET 读原文件，POST 归一化后写回并返回 `{content,dropped}`

**结论**：community 1.7.20 的 `net-scope.js` 已退化为「域名/区域/银行数据表 + 自有服务器白名单编辑器」。它**不拦截任何东西、不往会话写任何文本**。历史版本里那套「命中即注入拒绝句」的行为在本快照中不存在。

项目自己的维护档案给了同一结论（`[静态]`，全包 grep 佐证）：

> `docs/maintenance-archive.md:385` —— 「本 fork **没有**「目标解析到公网就拒绝」的门禁。上游 1.1.74–1.1.77 曾在 `agent/pre-step` 里塞「不行，这是严令禁止的」并清空本轮消息，本版已连判定逻辑一起删除。」

`[实测]` 全包 grep `installRegionGate|taskTargetHit|isAttackTask|isBenignNetworkTopic|currentTaskText|不行，这是严令禁止的`，除 `lib/net-scope.js` 自身与该条档案外 **零命中**。

safe 2.0.0 仍然保留完整拦截（见 §7）。

### 3.7 安全与范围其余入口

| 入口 | 判据 | 行为 | 行 |
|---|---|---|---|
| `assertWithinRoots(target, roots, io)` | 先 `within(root, abs)` 粗筛，再对 `realDestination` 双向 realpath 复核 | 不在根内 → 抛 `path outside allowed roots` | `path-boundary.js:32-42` |
| `assertNoLinkedDescendants(root, target, io)` | 从 root 到 target 逐级 `lstat`，任一级是符号链接即抛 | 解包时禁止穿过既有链接写文件 | `:45-57` |
| `detectSurface(input)` | `DSH_SURFACE` 强制优先；否则 `hasDesktopIdentity(process.resourcesPath)` → desktop；否则 web | gui/tui 未单独适配，`adapterFor` 回落 web | `surface.js:77-88` |
| `logAudit(event, data, home)` | 目录必须非链接；文件必须普通文件且 `nlink===1`；root 运行时要求 `PURGE_AUDIT_UID/GID` 同时有效；Linux 用 `/proc/self/fd/<fd>` 钉住目录 | 失败返回 `false` 且只 warn 一次，**绝不影响主流程** | `audit.js:97-122` |
| `createProbe` / `probeText` | `probe.json` 存在且未过 30min | 注入 `<dsh_probe>` 段要求模型回显 nonce | `probe.js:41-69` |
| `settleMayRestart` / `settleMayReapply` / `applyShouldRestart` | desktop 一律不许 settle 重启；desktop+sealed 不许 settle 重打；`sealed` 时「应用」必须重启 | 纯函数 | `settle-policy.js:33-61` |

---

## 4. 对外接口

### 4.1 HTTP op（`index.js` 注册的路由 → 使用本族模块）

| 类型 | 名称 | 入参 | 出参 | 调用方 |
|---|---|---|---|---|
| HTTP exact | `GET/POST /dsh-purge/status` | — | 宿主状态、补丁计数、`via` | 面板「状态」页 |
| HTTP exact | `GET /dsh-purge/diagnose` | — | `compatibility()` 报告 + 逐条漂移 | 面板「诊断」 |
| HTTP exact | `GET /dsh-purge/selfcheck` | — | `selfCheck()` 的 layers/summary | 面板「自检」 |
| HTTP exact | `GET/POST /dsh-purge/boost` | `{enabled}` | 当前值 | 面板「强化」 |
| HTTP exact | `POST /dsh-purge/probe` | — | `{nonce,message}` | 面板「探针」 |
| HTTP exact | `GET /dsh-purge/audit` | `?limit=` | `readAudit()` 行 | 面板「审计」 |
| HTTP exact | `GET/POST /dsh-purge/hooks-deny` | `{hooksDenyBypass}` | 设置 + 标注后的补丁状态 | 面板「hooks」 |
| HTTP exact | `GET /dsh-purge/last-user` | — | 最后一条人类消息 | 回退按钮 |
| HTTP exact | `GET /dsh-purge/rewind/options`、`POST /dsh-purge/rewind` | `{sessionId,mode}` | `analyzeRewind`/`applyRewind` 结果 | 会话输入框回退 |
| HTTP exact | `GET/POST /dsh-purge/update` | `{op,channel,ref,pin,apply}` | `handleUpdateOp()` 结果 | 面板「更新」 |
| HTTP exact | `POST /dsh-purge/apply` | `{ref?}` | `applyPatchesAllHosts` 报告 | 面板「应用」 |
| HTTP exact | `POST /dsh-purge/revert` | — | 还原报告 | 面板「回退」 |
| HTTP exact | `POST /dsh-purge/uninstall` | — | `uninstallPurge()` 报告 + 清理计划 | 面板「卸载」 |
| HTTP exact | `GET/POST /dsh-purge/drill-grant` | — | `{granted,at}` | 演练台首启 |
| HTTP exact | `GET/POST /dsh-purge/override` | `{text}` | 注入正文 | 面板「提示词」 |
| HTTP exact | `GET/POST /dsh-purge/own-servers` | `{content}` | `{content,dropped}` | 面板「自有服务器」 |
| HTTP exact | `POST /dsh-purge/restart` | `{openBrowser?}` | `scheduleRestart()` 结果 | 面板「重启」 |
| HTTP prefix | `/dsh-purge/rules[/op]` | `op ∈ status/scan-cwd/toggle-cwd/set-policy/read/save/activate/delete/reset` | 见 §3.4 | 面板「规则」 |
| HTTP prefix | `/dsh-purge/skills[/op]`、`/dsh-purge/skill[/op]` | `op ∈ status/read/save/delete/import` | 见 §3.4 | 面板「技能」 |

### 4.2 更新 op（`handleUpdateOp` `update.js:1375`）

| op | 行为 |
|---|---|
| `check` / `status` / `versions` | `checkUpdate()` |
| `channel` | `switchChannel(body.channel, {apply: body.apply!==false})` |
| `switch` / `rollback` | `switchVersion(body.ref \|\| body.version \|\| body.id)` |
| `auto` | `autoUpdateIfNeeded()` |
| `plan` / `sites` / `inspect` | `planReport()`（只读） |
| `upstream` | `applyUpdate(..., {source:"upstream"})` → 隔离目录 |
| 其它（默认 `apply`） | stable 通道下 `ref` 为空/`master`/`main` 一律视为「当前通道最新」 |

### 4.3 独立进程入口（spawn 而非 import）

| 脚本 | 触发者 | 环境变量 | 退出码 |
|---|---|---|---|
| `restart-desktop.js` | `desktop.js:887/967/990/1247` | `DSH_PURGE_RESTART`（JSON：`respawn,killApp,asar,execPath,cwd,waitPid,pid,argv,cleanup,helper`） | 0 成功；1 前置失败或 asar 未挪开 |
| `restart-web.js` | `web.js:81` | 同上 + `port,host,openBrowser` | 0 成功；1 端口等不到/拉起失败 |
| `uninstall-restart.js` | `web.js:97`、`desktop.js:1313` | 同上 + `cleanup[]` | 0 成功；1 端口等不到 |
| `reapply-cli.js` | `bin/` | — | 0/1，stdout 一行 JSON |
| `official-installer-launch.jsw` | `official-installer.mjs:29` | `DSH_UPDATE_WORKER/EXE/FILE/VERSION/HASH/LOG/PARENT` | 透传 PowerShell 退出码 |
| `official-installer.ps1` | 上者 | 同上 | 0/1 |
| `child-process-hide.mjs` | 被复制成 `<binRoot>/lib/dsh-purge-child-process-hide.mjs`（`hide-console.js:248`） | — | — |

### 4.4 包导出子路径（`package.json.exports`）

`.` → `lib/index.js`；`./client` → `client.js`；`./presets-plugin` → `lib/presets-plugin.js`；`./redteam*` 四个。

---

## 5. UI 触点

> 只列「这个模块被哪个前端页签用到」。前端组件名与行号在 `client.js`（另册），此处给 op 级对应关系。

| 模块 | 页签 | 依赖的 op | 展示字段 | 交互 |
|---|---|---|---|---|
| `update.js` / `community.js` / `update-state.js` / `update-policy.js` | 更新 | `/dsh-purge/update` | `localVersion,remoteVersion,hasUpdate,lanes,versions,releases,error,degraded,via,installed` | 「检查更新」→ `op:check`；「升级」→ `op:apply`；选版本 → `op:switch`；切通道 → `op:channel` |
| `update-targets.js` | 更新（多 profile 提示） | 同上 | `targets[].{profile,version,needsUpdate}`、`retryIncomplete` | 部分失败时显示「重试未完成」 |
| `update-net.js` / `update-http.js` | 更新（错误条） | 同上 | `error`（限流/代理/超时文案） | 只读展示 |
| `desktop.js` / `host.js` / `web.js` / `settle-policy.js` | 应用 / 重启 | `/dsh-purge/apply`、`/dsh-purge/restart` | `asarSwap`、`needsFullQuit`、`clean` | 「应用」→ 写补丁后按策略重启；「重启」→ `scheduleRestart` |
| `extract-asar.js` / `*-asar-handoff.js` | 诊断 / 应用 | `/dsh-purge/diagnose`、`/dsh-purge/apply` | `handoff.phase`、`archive_exists`、`unpacked_exists` | 显示「等客户端退出后自动挪走归档」 |
| `host-layout.js` / `desktop-identity.js` / `surface.js` | 诊断 | `/dsh-purge/diagnose` | `state`（archive_entry/unpacked_entry/different_instance/unknown_runtime）、`host_family` | 只读 |
| `selfcheck.js` / `probe.js` | 自检 / 探针 | `/dsh-purge/selfcheck`、`/dsh-purge/probe` | `layers[].{title,state,applied,required,pending,broken,note}` | 「探针」→ 生成 nonce，要求模型回显 |
| `audit.js` | 审计 | `/dsh-purge/audit` | `at,event,pid,...data` | 只读列表 |
| `tuning.js` / `boost.js` | 强化 | `/dsh-purge/boost` | `enabled` | 开关 → 写 `tuning.json` 并写审计 |
| `hooks-deny.js` | hooks | `/dsh-purge/hooks-deny` | `hooksDenyBypass`、四条补丁状态 | 关闭后把宿主写回官方形态 |
| `rules.js` | 规则 | `/dsh-purge/rules/*` | `rules[]`、`active`、`injectSource`、`cwd_candidates[]`、`workspace_policy` | 新建/编辑/激活/删除/勾选 CWD 文件/切策略 |
| `skills.js` | 技能 | `/dsh-purge/skills/*` | `skills[].{id,description,kind,valid,size,path}` | 编辑/删除/导入压缩包或目录 |
| `net-scope.js` | 自有服务器 | `/dsh-purge/own-servers` | `content`、`dropped` | 保存白名单（**不影响任何拦截**，见 §3.6） |
| `identity.js` / `capability-protocol.js` / `preset-injection.js` | 提示词 / 预设 | `/dsh-purge/override` | 注入正文、来源（prompt/default/none） | 保存后下一步组装生效 |
| `presets.js` / `presets-plugin.js` | 预设（宿主模式下拉） | 无 HTTP，走 `agentPresets` 服务 | 预设名 `unrestricted` | 选中即由宿主组装 |
| `permission-state.js` | 状态 / 自检 | `/dsh-purge/status`、`/dsh-purge/selfcheck` | `state ∈ ok/inferred/broken/unknown`、`preset/sandbox/approval/source` | 只读；不自动改权限 |
| `drill-grant.js` | 演练台 | `/dsh-purge/drill-grant` | `granted` | 首次进入弹一次确认 |
| `rewind.js` | 会话输入框 | `/dsh-purge/rewind/options`、`/dsh-purge/rewind`、`/dsh-purge/last-user` | 可回退轮次、草稿 | 回退按钮（需 `tuning.rewind`） |
| `maintenance-lock.js` / `rollback-transaction.js` | 更新 / 回退（错误条） | `/dsh-purge/update`、`/dsh-purge/revert` | `MAINTENANCE_BUSY` / `LOCK_LOST` / `回滚失败` | 报错即停，不自动重试 |
| `uninstall.js` | 卸载 | `/dsh-purge/uninstall` | `applied,reverted,cleanup[],errors[]` | 卸载后走清理重启助手 |
| `official-update.js` | 应用（升级标记） | 无 | 升级标记是否存在 | 决定是否重解包 |

---

## 6. 依赖

### 6.1 内部（本族内）

- `update.js` → `community.js`、`update-{http,net,state,install,targets}.js`、`installed-package.js`、`instance.js`、`remove-tree.js`、`core.js`
- `community.js` → `extract-asar.js`(diskFs)、`remove-tree.js`、`update-download.js`、`maintenance-lock.js`、`atomic-files.js`、`market-migration.js`、`update-http.js`、`runtime-layout.js`、`instance.js`、`desktop-identity.js`、`install-registry.js`、`rollback-transaction.js`
- `update-install.js` → `update-integrity.js`、`update-net.js`、`zip-extract.js`、`core.js`、`remove-tree.js`
- `update-http.js` → `update-mirror.js`、`update-socks.js`、`update-system-proxy.js`
- `desktop.js` → `desktop-read-scope.js`、`desktop-identity.js`、`next-host.js`、`runtime-layout.js`、`windows-asar-handoff.js`、`official-update.js`、`extract-asar.js`、`host-clean.js`、`atomic-files.js`
- `extract-asar.js` → `path-boundary.js`、`remove-tree.js`、`signed-sidecars.mjs`
- `desktop-identity.js` → `next-host.js`、`desktop-read-scope.js`、`extract-asar.js`
- `identity.js` → `net-scope.js`、`capability-protocol.js`、`phase1-keep.js`
- `presets-plugin.js` → `presets.js`、`preset-compat.js`、`redteam/preset-composition.js`
- `tuning.js` → `atomic-files.js`、`maintenance-lock.js`、`audit.js`、`core.js`
- `refusal-retry.js` → `audit.js`、`stream-observation.js`
- `selfcheck.js` → `permission-state.js`、`preset-diagnostic.js`、`community.js`、`instance.js`、`core.js`
- `reapply.js` → `core.js`；`reapply-cli.js` → `reapply.js`
- `uninstall.js` → `core.js`、`host.js`、`rules.js`、`update.js`、`drill-grant.js`、`community.js`、`remove-tree.js`

### 6.2 宿主 API（逐个列，标注是否公开）

| API | 位置 | 用途 | 是否公开 |
|---|---|---|---|
| `ctx.get("agentPresets")` / `ctx.agentPresets.register/unregister/composedPreset` | `presets-plugin.js:35-49`、`identity.js:501-507` | 注册/读取预设 | 公开服务 |
| `ctx.get("permissionPresets")`（`defaultPreset`/`resolve`） | `permission-state.js:28-31` | 读运行时权限 | 公开服务 |
| `ctx.get("shell").sandboxMode`、`ctx.get("approval").config.policy` | `permission-state.js:33-34` | 权限回退读法 | 公开服务 |
| `ctx.get("agents").get(sessionId)` | `preset-injection.js:71-73`、`identity.js:614` | 由 sessionId 找活 agent | 公开服务 |
| `ctx.get("profileContext").installAnchor` | `presets-plugin.js:66` | 定位宿主包树 | 半公开（插件间约定） |
| `ctx.get("desktopRuntime")` / `ctx.get("desktopActions").requestRestart()` | `desktop.js:797-801` | 优雅重启 | 半公开 |
| `ctx.inject(["webServer"], host => host.webServer.register({kind,path,handler}, label))` | `index.js:2012`、`:2021-2028`、`:1542` | 注册 HTTP 路由（所有 `/dsh-purge/*`） | 公开插件 API（Cordis 注入） |
| `allowPluginRequest(request, response, trustedHostnames(webServer.host, hostTrustedHosts(ctx)))` | `index.js:2024` | 路由前置来源校验 | 公开（`dsh-web-server` 辅助） |
| `ctx.on("system-prompt/assemble")` | `index.js` | 改写组装结果 | 公开事件 |
| `ctx.on("agent/pre-step")` | `index.js` | 步骤前钩子 | 公开事件 |
| `ctx.on("llm/stream")` | `index.js`、`refusal-retry.js` | 流包装 | 公开事件 |
| `ctx.on("agent/request-error")`、`ctx.on("agent/status")` | `continue-retry.js:325,341` | 重试/续跑 | 公开事件 |
| `ctx.on("session/created")`、`ctx.on("session/event")`、`ctx.on("agent-preset/selected")` | `index.js` | 会话与预设跟踪 | 公开事件 |
| `ctx.effect(fn, label)` | `presets-plugin.js:85`、`settle-policy.js:15` | 生命周期清理 | 公开 API |
| `commands.register({name,...})` | `command-registration.js:5-19` | 注册斜杠命令 | 公开 API |
| `session.append(type, payload, {surfaceOp})` | `macos/windows` 无关；`rewind.js`、safe 的 net-scope 用 | 写会话事件 | 半公开（内部事件名） |
| `agent.followup(message)` / `agent.steer(message)` | `continue-retry.js:269` | 投递续跑/插话 | 半公开 |
| `agent.inbox.remove/hasPending/size` | `continue-retry.js:257-259`、`steering.js` | 队列状态 | 半公开 |
| `@deepseek-ai/dsh-llm` 的 `createAssistantMessage` | safe 的 `net-scope.js:527`；community 未用 | 造 assistant 消息 | 内部包 |
| `prompt.assemble`（defineProperty 包装） | `identity.js:823-937` | 改写提示词 | 内部方法（靠 descriptor 结构） |
| `@deepseek-ai/dsh-tool-subagent-control` / `dsh-tool-executor-native` / `dsh-tool-subagent` | `preset-compat.js:10,89,115` | 预设子代理策略迁移 | 内部包（用 `createRequire` 从宿主树 require） |

### 6.3 外部

网络（全部经 `update-http.js`，主机白名单 `UPDATE_HOSTS` `:15`）：
`github.com`、`codeload.github.com`、`api.github.com`、`raw.githubusercontent.com`、`objects.githubusercontent.com`、`release-assets.githubusercontent.com`、`cdn.jsdelivr.net`。

具体端点：

- `GET https://api.github.com/repos/<repo>/releases?per_page=20`（`community.js:858`）
- `GET https://api.github.com/repos/<repo>/releases/latest`（`update.js:774`）
- `GET https://api.github.com/repos/<repo>/releases/tags/<tag>`（`community.js:899`，仅镜像模式）
- `GET https://api.github.com/repos/<repo>/commits/<ref>`、`/git/trees/<sha>?recursive=1`（`update-integrity.js:9-14`）
- `GET https://api.github.com/repos/<repo>/tags?per_page=50`（`update-net.js:196`）
- `GET https://github.com/<repo>/releases.atom`、`/commits/<ref>.atom`（`update-net.js:221,179`）
- `GET https://raw.githubusercontent.com/<repo>/<ref>/package.json`、`https://cdn.jsdelivr.net/gh/<repo>@<ref>/package.json`、`api.github.com/repos/<repo>/contents/package.json?ref=`（`update-net.js:142-147`）
- `GET https://github.com/<repo>/releases/download/<tag>/<file>`、`.../SHA256SUMS.txt`（`community.js:893`）
- `GET https://codeload.github.com/<repo>/{zip,tar.gz}/...`（`update-net.js:62-74`）

子进程：

- `git -C <dir> {rev-parse,status,fetch,checkout,reset}`（`update-install.js:66-133`，超时 20–60s，`windowsHide`）
- `tar -tzf/-tvzf/-xOzf`（`community.js:929-956`）、`tar -czf`（`rollback-transaction.js:14`）
- `dsh plugin --profile <p> add/remove/config get`（`community.js:783-799`，超时 180s）
- `powershell.exe`：卸载登记/运行进程/快捷方式探测（`desktop.js:355,401,460`）、WinINET 代理（`update-system-proxy.js:34`）、密钥 ACL 助手（`update-secrets.js:92`）、asar 交接 broker（`windows-asar-handoff.js:269`）、前置窗口（`restart-desktop.js:406`）
- `reg.exe query HKCU\...\Internet Settings`（`update-system-proxy.js:27`）
- `wscript.exe`（`desktop.js:1302`、`official-installer.mjs:29`）、`cscript.exe`（`desktop.js:1147` 探针）
- `/bin/ps`、`osascript`、`open`（`restart-desktop.js:127,238,332`；`macos-asar-handoff.js:136`）
- `tasklist`/`taskkill`（`restart-desktop.js:81`、`desktop.js:1031`）
- `plutil`/`defaults`（`desktop-identity.js:133`、`restart-desktop.js:105-113`）
- `node --input-type=module -e <code>`（`rollback-transaction.js:30`，全新进程验证安装）

文件系统关键路径：`$DSH_HOME`、`$DSH_HOME/profiles/<name>`、`<resources>/app.asar`、`<resources>/app`、`<resources>/app.asar.unpacked`、`<resources>/runtime`、`/Applications/*.app`、`%LOCALAPPDATA%\Programs\*`、`%APPDATA%\DSH Desktop\*`、`os.tmpdir()`。

---

## 7. 与另一版的差异

> **除 `net-scope.js` 一行外，与 safe 的差异我未查。** 下表只有第 1 行是本次实际静态对比得出的；其余按指令标注「与 safe 的差异我未查」，不臆测。

| 能力 | community 行号 | safe 行号 | 差异性质 |
|---|---|---|---|
| 区域/银行网络范围拦截（攻击词判定 → 往会话写拒绝句 → 清空本轮 messages） | **不存在**。`net-scope.js:186,191,198` 三个常量是死代码；`ownServerNote()` 返回 `""`（`:410`）；模块只导出 7 个符号（`[实测]`） | `net-scope.js:439` `isBenignNetworkTopic`、`:445` `isAttackTask`、`:464` `taskTargetHit`、`:505` `currentTaskText`、`:525-587` `denialMessage`/`appendDenial`、`:625-669` `installRegionGate`（挂 `agent/pre-step`，`{global:true,prepend:true}`，命中后 append 一条 `DENIAL` 消息并返回 `{kind:"enter",messages:[]}`） | **删除**（community 把整条拦截链移除，只留数据表与白名单编辑） |
| 更新族 | `update.js` 1455 行 / 13 个 `update-*.js` | safe 单文件 `lib/update.js`（1144 行），无 `update-*` 子模块 | 与 safe 的差异我未查 |
| 桌面族 | `desktop.js` 1540 + 14 个同族文件 | safe `lib/desktop.js` + `host-clean.js` + `surface.js` 等，无 `*-asar-handoff.js` | 与 safe 的差异我未查 |
| 身份与安装 | `identity.js` 1029 / `instance.js` 493 / `Maintenance` 在 `community.js` | safe 有 `identity.js`、`subagent-control.js`、`tool-gate.js`，无 `community.js` | 与 safe 的差异我未查 |
| 预设族 | `presets*.js` 6 个 + `permission-state/migration` | safe 只有 `preset-default.js` | 与 safe 的差异我未查 |
| 提示词与规则 | `rules.js` 560 / `skills.js` 706 / `continue-retry` / `refusal-retry` | safe 有 `rules.js`、`skills.js`、`continue-retry.js` | 与 safe 的差异我未查 |
| 运维层（审计/锁/回滚事务/自检/探针） | `audit.js`、`maintenance-lock.js`、`rollback-transaction.js`、`selfcheck.js`、`probe.js` 全在 | 与 safe 的差异我未查（safe 目录清单里未见同名文件） | 与 safe 的差异我未查 |

---

## 8. 风险与脆弱点

| 风险 | 触发条件 | 后果 | 是否可静态检出 |
|---|---|---|---|
| 状态目录分裂 | 任何一次运行 | 更新状态在 `dsh-purge/`，备份/审计在 `dsh-purge-community/`；改名成 plus 后两个目录名都没跟着改，plus 与 community 共用状态 | 是（`update-state.js:19` vs `community.js:334`） |
| 匿名更新通道完全依赖仓库公开 | 仓库转私有/改名 | API 403 时 atom 兜底 404，`rows:[]`，面板显示「尚未发布可安装的社区正式版本」而非真实原因 | 是 + `[实测]` 已复现 |
| `releases.atom` 兜底要先逐个下 `SHA256SUMS.txt` | 限流且候选 12 个 | 12 次串行下载（每次 8s 预算），最坏 96s | 是（`update.js:569-576`） |
| `FORK_RELEASE_RE` 白名单过窄 | tag 带任何非 `-plus.N` 后缀 | 发行被静默过滤，面板永远「已是最新」 | 是（`update.js:116`、`:562`） |
| `fromLatest` 正则与仓库坐标强耦合 | 换 owner/repo 或 tag 形态 | `keepDisabled` 语义丢失，原本被禁用的 bundle 会被重新启用 | 是（`community.js:703-705`） |
| `prune` 的「每天留 1 份」按 `created_at.slice(0,10)` 分组 | 跨时区/同一天多次备份 | 可能删掉当天较早但仍需要的快照（`keepLast` 默认 5 兜底） | 是（`community.js:445-455`） |
| `gcObjects` 与 `prune` 并发 | 两个进程同时维护 | 引用集读的是 `this.list()`（只含 `complete:true`），未完成快照引用的对象可能被当垃圾删 | 是（`community.js:409-433`） |
| 维护锁用 PID 出生时间防复用 | 系统时钟回拨 / `ps` 精度不足 | `ownerDead` 可能误判活进程为死（差 >2000ms 才算复用），或反之 | 是（`maintenance-lock.js:35-43`） |
| Windows 交接依赖 `Get-Process.Path` | 权限不足读不到 Path | `$alive` 恒空 → 提前认为应用已退出 → 归档被挪走而进程仍在用 | 是（`windows-asar-handoff.js:81`） |
| 官方重启脚本按 pid 杀进程 | 同目录下另一个 DSH 实例 | `pids()` 同时匹配「exe 完全相同」与「路径以 installRoot 开头」，会连带杀掉同安装目录的其它实例 | 是（`desktop.js:1014`） |
| `restart-desktop.js` 杀进程范围 | macOS 上同 bundle 的 helper | `listDarwinPids` 匹配 `Contents/Frameworks/` 开头的进程，可能杀掉渲染/GPU 子进程（预期内）但也会杀掉用户开的第二个窗口 | 是（`restart-desktop.js:146`） |
| `killOtherDesktopProcesses` 用 `process.kill(pid, undefined)` | Linux 上 signal 为 `undefined` | Node 抛 `ERR_INVALID_ARG_TYPE`（被 try/catch 吞掉），实际什么也没杀 | 是（`restart-desktop.js:266`） |
| asar 解包「先整体校验再落盘」的内存/时间 | 归档巨大 | `walk` 结果全量入数组，`copyRange` 1MB 缓冲；解包期间宿主不可用 | 是（`extract-asar.js:553-600`） |
| `verifyStagedAsar` 只比 size 不比内容 | 归档条目无 integrity 且非 signed | 同尺寸被篡改内容能通过 | 是（`extract-asar.js:391-399`） |
| `update-secrets` 的 Windows ACL 助手 | `System32\WindowsPowerShell\v1.0\powershell.exe` 缺失 | 抛错且不写新密钥（安全侧失败即关闭，正确） | 是（`update-secrets.js:89-102`） |
| `writeSecretFile` 的 `renameSync` 覆盖 | 目标已存在且被占用（Windows） | 抛错；`finally` 里清理 staging 失败会再抛一个错，掩盖原错 | 是（`update-secrets.js:124-132`） |
| 代理探测的 PAC 分支 | 用户用 PAC | 直接抛错要求手配 `PURGE_HTTPS_PROXY`，更新不可用 | 是（`update-http.js:42`） |
| 重试预算 | 同一 `requestUpdate` 内 2 次重试跨所有重定向共享 | 3xx 链长时重试机会被前面的跳转用光 | 是（`update-http.js:169-183`） |
| `audit.js` 属主校验 | root 运行且未设 `PURGE_AUDIT_UID/GID` | 用 `DSH_HOME` 属主；容器里 root-owned mount 会保留 root，可能让非 root 进程读不到 | 是（`audit.js:60-72`） |
| `tuning.json` 符号链接 | 用户把配置 link 到共享位置 | `saveTuning` 会 realpath 后写目标（保留链接），但 `readTuning` 用 `lstatSync(file,{throwIfNoEntry:false})` 判断，链接指向不存在时走 `ENOENT` 分支返回默认值 | 是（`tuning.js:44`、`:91`） |
| `rules.activateRule` 备份条件 | 目标文件内容恰好等于某条规则正文 | 不备份，`resetToOriginal` 时可能把用户原文件当规则删掉（`:272-279`、`:320-331` 有 `fileContent === ruleContent` 才删的兜底） | 是 |
| `skills.saveSkill` 的「先删后写」 | 写入失败 | 依赖 `restoreSkillFromBackup`；若备份也没成功则技能丢失 | 是（`skills.js:425-439`） |
| `preset-injection` 的 Symbol 溯源 | assembly 被结构化克隆（丢 Symbol） | `withoutPurgeInjection` 退化为只按 section 名过滤，可能留下我方改写的正文 | 是（`preset-injection.js:29-53`） |
| `continue-retry` 的 `globalThis.__dshPurgeRetryPending` | 多会话并发 | 全局标志无法区分会话，可能让另一个会话多吃一次强制注入 | 是（`continue-retry.js:337`） |
| `refusal-retry` 的缓冲判定 | 回答前 400 字里出现「我不能…」的技术描述 | 误判为拒绝 → 白烧一次重试；`REFUSAL_PATTERNS` 已用「必须带拒绝对象」收敛（`:11`） | 是 |
| `net-scope.js` 死代码 | 维护者以为还有拦截 | 改 `BANK_HOSTS`/`ATTACK` 完全不生效 | 是 + `[实测]` |
| `official-installer.ps1` 信任链 | 只校验 SHA512（来自 `owner.updater`）+ Authenticode 主体名 | 若 updater 元数据被投毒且攻击者持有同主体签名证书，会执行 | 是（`official-installer.ps1:26-29`） |

---

## 9. 逐条功能清单

> 前缀 `CM-LIB-`；每个文件至少一条。

### 更新族

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| CM-LIB-001 | 通道常量与标签（stable=fork releases / beta=upstream 隔离） | `update.js:106-113` | 完整 | `UPSTREAM_WARNING` 同时进 `error` 字段确保面板可见 |
| CM-LIB-002 | 发行 tag 白名单 `FORK_RELEASE_RE` | `update.js:116` | 完整 | `[实测]` 只认 `vX.Y.Z`（plus 构建再认 `-plus.N`） |
| CM-LIB-003 | 本 fork 发行列表（60s 缓存 + atom 兜底 + 10min 旧缓存） | `update.js:550-587` | 完整 | 三级降级，见 §3.0.2 |
| CM-LIB-004 | atom 兜底时逐发行核 `SHA256SUMS.txt` | `update.js:538-547` | 完整 | 只保留真带 tgz 的发行，最多 12 个 |
| CM-LIB-005 | 上游 tag/head 只作 legacy 展示 | `update.js:590-633` | 完整 | 每条带 `warning`、`legacy:true` |
| CM-LIB-006 | 版本列表合并（fork + 上游 + 历史 + 本地运行版）与当前标记 | `update.js:635-701`、`:416-474` | 完整 | `markCurrent` 只认与运行 `package.json` 相同的版本 |
| CM-LIB-007 | lane 描述（stable/beta 各自的 `hasUpdate`） | `update.js:707-765` | 完整 | beta lane `isolated:true` |
| CM-LIB-008 | 检查更新（永不抛异常，`hasUpdate:null` 表达未知） | `update.js:788-868` | 完整 | `[实测]` 见 §3.0.4(b) |
| CM-LIB-009 | 只读元数据兜底 `readPublishedVersion` | `update.js:773-786` | 完整 | 强校验 draft/prerelease/tag/html_url 四件 |
| CM-LIB-010 | 安装本 fork 发行包（备份→装→验证→失败回滚→历史） | `update.js:897-1016` | 完整 | 网络/完整性失败不启动安装也不回滚 |
| CM-LIB-011 | 上游 legacy 隔离目录安装 | `update.js:1027-1097` | 完整 | 永不覆盖当前安装，返回 `dependencySpec` |
| CM-LIB-012 | 原版 git/zip/dsh 三类作业覆盖 | `update.js:1120-1207` | 部分 | 保留但仅显式调用；`job.package === PACKAGE` 一律跳过 |
| CM-LIB-013 | `applyUpdate` 单飞 + 上游/发行分流 | `update.js:1215-1256` | 完整 | 并发调用共享同一 Promise |
| CM-LIB-014 | 通道切换与版本回退 | `update.js:1262-1298` | 完整 | `local-*` 拒绝；已最新则 `skipped:"latest"` |
| CM-LIB-015 | 自动更新（guard 12h + `retryIncomplete` 例外） | `update.js:1304-1341` | 完整 | 永不抛 |
| CM-LIB-016 | 只读规划报告 | `update.js:1347-1373` | 完整 | 含 `sites`/`plan`/`skippedSites` |
| CM-LIB-017 | op 路由 | `update.js:1375-1399` | 完整 | 默认 op=apply |
| CM-LIB-018 | 唯一 HTTP 传输（代理/SOCKS/镜像/重定向/超时/体积/重试） | `update-http.js:159-198` | 完整 | 目标主机与协议在改写前后各校验一次（`:164`、`:173`） |
| CM-LIB-019 | 代理选择与 no_proxy 绕过 | `update-http.js:18-54` | 完整 | 见 §3.0.3 |
| CM-LIB-020 | 请求头策略（UA、剥 Authorization、仅 api.github.com 带 token） | `update-http.js:55-61` | 完整 | 镜像请求强制清空 token（`:176`） |
| CM-LIB-021 | GitHub 读接口 + 缓存 + 预算 | `update-net.js:49-235` | 完整 | head 30s / tags 60s / pkg 300s；失败短缓存 15–30s |
| CM-LIB-022 | codeload 直连与 archive URL 改写 | `update-net.js:62-89` | 完整 | 避开 `github.com/archive` 的 302 |
| CM-LIB-023 | `releases.atom` 解析（含 diagnostics 形态） | `update-net.js:214-235` | 完整 | 同时认 `releases/tag/` 与 `Repository/<id>/<tag>` 两种 id |
| CM-LIB-024 | 状态文件路径与读写（channel/history/stamp/guard/upstream） | `update-state.js:18-235` | 完整 | 全部 `atomicWriteSync` |
| CM-LIB-025 | 版本比较（core 三段 + 预发布逐段，数字优先于字母） | `update-state.js:60-103` | 完整 | `[实测]` `1.7.20 > 1.7.20-plus.1` |
| CM-LIB-026 | `sameRev` 只对 hex 允许短前缀 | `update-state.js:117-125` | 完整 | `[实测]` `apply:1.6.2 ≠ apply:1.6.27` |
| CM-LIB-027 | 更新偏好与凭据分文件 + 校验 + 公开视图 | `update-policy.js:8-116` | 完整 | 空 token = 保持原值，清除需 `clearGithubToken:true` |
| CM-LIB-028 | 定时检查控制器（30s 首跑、I/O 后重读开关、pending 例外） | `update-policy.js:188-337` | 完整 | `restartRequired` 时只在 `retryIncomplete && 同版本` 下重试 |
| CM-LIB-029 | 版本状态对账（升级与回退都置 `restartRequired`） | `update-policy.js:165-186` | 完整 | 版本串必须匹配 semver 形状才动 |
| CM-LIB-030 | 目录快照/还原（不跟随链接，`node_modules`/`.git` 事务性搬运） | `update-install.js:163-215` | 完整 | 还原失败会把回滚前目录放回 |
| CM-LIB-031 | git 复位（dirty 保护、fetch 回退、`-B` 或 `reset --hard`） | `update-install.js:109-134` | 完整 | 非 force 且 dirty → 抛「未提交改动」 |
| CM-LIB-032 | 源码归档下载 + 逐文件校验（Git tree SHA1） | `update-install.js:227-252`、`update-integrity.js:8-49` | 完整 | 先钉 commit 再下 zip；非普通文件/未登记文件一律拒 |
| CM-LIB-033 | zip 覆盖（先备份、逐目录写、失败全量回滚、拒绝非目录目标） | `update-install.js:260-325` | 完整 | 删不掉旧目录即中止（防半升级） |
| CM-LIB-034 | `swapDir` 整体换目录（失败先还原 retired 再退备份） | `update-install.js:328-353` | 完整 | 上游隔离目录安装用 |
| CM-LIB-035 | 发行包下载（独立超时 180s、镜像、主机白名单） | `update-download.js:6-24` | 完整 | 只允许 github.com / release-assets / objects |
| CM-LIB-036 | 镜像前缀规范化与改写 | `update-mirror.js:3-20` | 完整 | 禁 GitHub 自身域、禁 query/hash、端口必须 443 |
| CM-LIB-037 | 密钥文件私有化（POSIX 0600；Windows DACL 助手 + 原子 rename） | `update-secrets.js:104-133` | 完整 | 失败即关闭（不写新密钥） |
| CM-LIB-038 | SOCKS5 有界握手 | `update-socks.js:3-49` | 完整 | 响应上限 1024B，支持用户名密码 |
| CM-LIB-039 | WinINET 代理只读发现（reg.exe → PowerShell 回退） | `update-system-proxy.js:6-42` | 完整 | 非 ASCII 或布局异常即换路 |
| CM-LIB-040 | 逐 profile 磁盘版本与更新汇总 | `update-targets.js:5-24` | 完整 | `retryIncomplete` = 部分目标待更新 |
| CM-LIB-041 | 兼容性判定（kernel / family 两层，只诊断不阻断） | `community.js:110-180` | 完整 | `patch_writes_allowed = layout && !sealed` |
| CM-LIB-042 | `Maintenance` 备份（内容寻址去重、manifest schema 2、保留策略、GC） | `community.js:307-489` | 完整 | 见 §2.1 |
| CM-LIB-043 | 备份校验（文件集合 + 每文件哈希 + 去重对象哈希 + 插件路径） | `community.js:556-592` | 完整 | `realpath(folder) === folder` 防符号链接 |
| CM-LIB-044 | 回滚（verify → 安全快照 → 反向迁移 → 打包 → 安装 → 验证 → 恢复 bundles） | `community.js:605-685` | 完整 | 失败用 `checkpointProfile` 恢复依赖与清单 |
| CM-LIB-045 | 安装（持久化 tgz、快照、fromLatest 迁移、身份核对、独立进程验证、失败恢复） | `community.js:686-769` | 完整 | 见 §3.0.1 ⑤ |
| CM-LIB-046 | `installWithDsh`（runtime 修复、profile 归属校验、detached link 处理、registry 恢复） | `community.js:771-850` | 完整 | 只 detach 自己 staging 出来的链接 |
| CM-LIB-047 | 发行列表解析（draft/prerelease/tag/asset/sums 四重过滤） | `community.js:854-888` | 完整 | 缺 asset 或缺 sums 的发行直接丢弃 |
| CM-LIB-048 | 发行包准备与校验（URL 前缀、元数据、SHA256、落盘、结构校验） | `community.js:889-920` | 完整 | 见 §3.0.4(c) |
| CM-LIB-049 | 归档校验（大小、路径、类型、identity） | `community.js:926-967` | 完整 | 只允许 `-`/`d` 类型 |
| CM-LIB-050 | 官方升级标记与 WSH ASCII 字面量 | `official-update.js:13-53` | 完整 | 标记只在 exe 名为 DeepSeek Harness 时生效 |

### 桌面族

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| CM-LIB-051 | 桌面安装根定位（exe/resources/argv/env，discover 才查注册表/进程/快捷方式） | `desktop.js:499-693` | 完整 | 名字兜底只看路径尾段（`:151`） |
| CM-LIB-052 | 从 `resources/app/...` 反推安装目录 | `desktop.js:274-289` | 完整 | 三个 marker：`app.asar.unpacked/`、`app/`、`contents/resources/` |
| CM-LIB-053 | 重启决策表（skip / windows-official / asar-swap / helper / request-restart） | `desktop.js:900-993` | 完整 | 纯函数 + 副作用函数分离 |
| CM-LIB-054 | 官方 Windows 重启脚本（WScript，含宿主清洗标记闸门、robocopy 补 unpacked、80 次改名重试） | `desktop.js:999-1059` | 完整 | 清洗标记为 false 时**不启动**（`:1025`） |
| CM-LIB-055 | `planOfficialRestart`（wscript vs powershell 选择 + inflight 语义） | `desktop.js:1092-1105` | 完整 | 纯函数，日志状态机在 `:1111` |
| CM-LIB-056 | 桌面 CLI shim 修补（sh / cmd 三级回退 + 幂等升级 + `.bak`） | `desktop.js:1342-1456` | 完整 | 只对官方家族生效（`:1484`） |
| CM-LIB-057 | `repairOfficialCliAfterUnpack`（含 NEXT 家族 notApplicable） | `desktop.js:1473-1540` | 完整 | NEXT 返回 `ok:false, notApplicable:true` |
| CM-LIB-058 | asar 空闲改名（macOS/Linux 轮询脚本，30min 锁） | `desktop.js:851-876` | 完整 | 不杀进程，等用户退出 |
| CM-LIB-059 | asar 换包重启（helper 全权 kill+relaunch） | `desktop.js:879-894` | 完整 | `#85 reverted` 注释解释为何不自己杀 |
| CM-LIB-060 | 桌面 CLI 解析（三级布局 + 包 bin 校验 + 越界拒绝） | `desktop-cli.js:5-40` | 完整 | 含 `realpath` 逃逸检查 |
| CM-LIB-061 | 内置 pnpm 解析（`DSH_DESKTOP_PNPM_ENTRY/RUNNER`） | `desktop-cli.js:44-67` | 完整 | 越界即抛 |
| CM-LIB-062 | 桌面壳入口解析（package.main 优先，禁止歧义） | `desktop-entry.js:12-81` | 完整 | 多个候选命中 → `ambiguous_entry` |
| CM-LIB-063 | 平台分派 asar 交接 | `desktop-handoff.js:9-17` | 完整 | 其它平台抛「不支持」 |
| CM-LIB-064 | 宿主家族判定（bundled-host → next → bundled-cli → community） | `desktop-identity.js:71-106` | 完整 | NEXT 必须在 bundled-cli 之前判（注释 `:77-83`） |
| CM-LIB-065 | 归档内读包证据（自研 ASAR 头解析、链接深度 8、大小上限） | `desktop-identity.js:23-55` | 完整 | 不写归档、不解包 |
| CM-LIB-066 | macOS bundle 可执行解析（plutil + 逃逸校验 + X_OK） | `desktop-identity.js:129-139` | 完整 | 非 darwin 抛错 |
| CM-LIB-067 | 单次诊断读缓存作用域 | `desktop-read-scope.js:8-33` | 完整 | 失败/未知结果不缓存（`:31`） |
| CM-LIB-068 | macOS 交接状态读取与异常相态推断 | `macos-asar-handoff.js:9-62` | 完整 | `complete` 但归档回来 → `archive_reappeared` |
| CM-LIB-069 | macOS 交接 worker（等退出→硬链接→校验→删归档） | `macos-asar-handoff.js:65-194` | 完整 | token 防「被新一次交接取代」 |
| CM-LIB-070 | Windows 交接 PowerShell 脚本（原子状态发布 + 三态判活） | `windows-asar-handoff.js:9-133` | 完整 | 见 §3.1.2 |
| CM-LIB-071 | Windows 交接 broker（Job Object 检测 + WMI 逃逸 + 20s ack） | `windows-asar-handoff.js:204-286` | 完整 | `starting` 只是请求，不是就绪证明（`:285`） |
| CM-LIB-072 | NEXT 家族识别与 CLI 修复结论 | `next-host.js:13-72` | 完整 | 绝不返回 `ok:true` 表示跳过 |
| CM-LIB-073 | 桌面重启助手（quit 三级、挪 asar、清理、relaunch、Windows 前置窗口） | `restart-desktop.js:420-472` | 完整 | 见 §8 风险行 |
| CM-LIB-074 | Web 重启助手（等端口、杀旧、拉起、抓 `dsh web:` URL 开浏览器） | `restart-web.js:18-109` | 完整 | URL 只留在内存（`:82-84`） |
| CM-LIB-075 | Web 面适配器与 `restartArgv` 重算 | `web.js:24-111` | 完整 | `request=null` 时默认不弹浏览器（`:80`） |
| CM-LIB-076 | 面适配器分发 | `host.js:5-28` | 完整 | gui/tui 回落 web |
| CM-LIB-077 | 布局证据（归档/解包/Tauri 托管归档 + 进程入口来源 + 交接状态） | `host-layout.js:25-136` | 完整 | 只读，不给写入目标（注释 `:41`） |
| CM-LIB-078 | 宿主提示词清洗判定 | `host-clean.js:2-13` | 完整 | marker 齐 / 旧拦截句消失 二者其一 |
| CM-LIB-079 | `app/runtime` 链接修复（含架构容器迁移、失败回滚、绝递归删链接） | `runtime-layout.js:20-107` | 完整 | 返回 `{ok,reason,error,backup,rollback}` |
| CM-LIB-080 | asar 探测与 `hostFs` 路由（5s 缓存、写即失效、作用域强缓存） | `extract-asar.js:17-191` | 完整 | 性能修复见注释 `:36-51` |
| CM-LIB-081 | asar 解包（全量校验→落盘→最后建链接） | `extract-asar.js:553-601` | 完整 | 只建普通文件与目录 |
| CM-LIB-082 | 解包旁路目录 + 整树校验 + 提交/回滚 + recover 记录 | `extract-asar.js:327-551` | 完整 | 见 §3.1.1 |
| CM-LIB-083 | 是否需要解包（目录可用性 × 归档身份 × 升级标记） | `extract-asar.js:247-254` | 完整 | 纯函数 |

### 身份与安装

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| CM-LIB-084 | 提示词改写总入口（去身份、置顶注入、去重、折叠 persona、红队切分、能力协议、兜底） | `identity.js:939-1029` | 完整 | 返回新对象，不改入参（`:945-947`） |
| CM-LIB-085 | 宿主身份句剥离表（30+ 条正则，含把拒绝/审批句式改成继续/自动授权） | `identity.js:106-190` | 完整 | 见 §3.2 |
| CM-LIB-086 | `assemble` 守卫（幂等、可解绑、错误语义保真） | `identity.js:823-937` | 完整 | 重复安装只换 `slot.rewrite` |
| CM-LIB-087 | 会话/预设解析（mounted → selected 事件 → projection → header） | `identity.js:495-546` | 完整 | 子代理沿父会话上溯（`:624-635`） |
| CM-LIB-088 | 红队 CTF 段切分（代码围栏内不算标记） | `identity.js:435-468` | 完整 | 只在独立行且后文确为竞赛约定时算 |
| CM-LIB-089 | profile 解析（显式参数 → 环境 → argv → `--profile` → 简写 → 唯一候选） | `instance.js:27-126` | 完整 | 多候选即抛，绝不猜 |
| CM-LIB-090 | 实例/宿主/CLI 解析（只认显式选择器与当前进程入口） | `instance.js:227-492` | 完整 | `diagnosticHost` 对密封归档给预期路径（`:331-399`） |
| CM-LIB-091 | 公开镜像缺版本时的一次官方源重试 | `install-registry.js:49-68` | 完整 | 只对 `@dsh-ops/bash-win32-x64` 且仅当当前源是 npmmirror |
| CM-LIB-092 | 已安装包解析（包名/版本/入口唯一） | `installed-package.js:8-37` | 完整 | 多份安装即抛「无法确定生效入口」 |
| CM-LIB-093 | `cordis.patch.yml` 旧包名迁移与反向迁移 | `market-migration.js:21-58` | 完整 | 只改 `name` 标量，`insert` 里的一律拒 |
| CM-LIB-094 | 卸载编排（还原补丁/shim/flash/提示词/规则、清登记、出清理计划） | `uninstall.js:203-289` | 完整 | 任一步失败即 `ok:false` 且不产出清理计划 |
| CM-LIB-095 | 卸载后清理（CLI 直删 / 助手删） | `uninstall.js:291-312` | 完整 | 重试 8×120ms |
| CM-LIB-096 | 卸载重启助手 | `uninstall-restart.js:37-77` | 完整 | 端口等不到就放弃 |
| CM-LIB-097 | 不跟随链接的删除 | `remove-tree.js:8-66` | 完整 | 拒绝删文件系统根；`lstat` 先于 `isDirectory` |
| CM-LIB-098 | 只从非空普通文件还原宿主备份 | `restore-backup.js:4-21` | 完整 | 空文件/被改/符号链接一律拒 |
| CM-LIB-099 | 还原件打包 + 独立进程验证 + profile 依赖快照 | `rollback-transaction.js:11-94` | 完整 | 验证只 import，不 apply/不注册工具 |
| CM-LIB-100 | 跨进程维护租约（双名硬链接、PID 出生时间、失败保留现场） | `maintenance-lock.js:51-167` | 完整 | `MAINTENANCE_BUSY` / `LOCK_LOST` / `LOCK_UNREADABLE` |

### 预设族

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| CM-LIB-101 | 自带预设落盘（不覆盖用户改动）+ 顺手应用 #24 | `presets.js:32-56` | 完整 | `COPYFILE_EXCL` |
| CM-LIB-102 | 预设注册插件（registry 就绪重试 40 次、迁移、备份、卸载 release） | `presets-plugin.js:30-93` | 完整 | `already/duplicate/invalid` 不重试 |
| CM-LIB-103 | 预设定义适配/迁移/注册（子代理策略、工具执行器、旧 child id） | `preset-compat.js:40-363` | 完整 | 保留用户源 YAML，只改注册组合 |
| CM-LIB-104 | 预设只读诊断（给 #76 定性 not_needed/skipped/unknown） | `preset-diagnostic.js:8-47` | 完整 | 有 `{{`/`${` 一律 unknown |
| CM-LIB-105 | 会话级注入策略（排除预设、未知上下文按排除处理） | `preset-injection.js:5-20` | 完整 | `unknown` 时 `allowed=false` |
| CM-LIB-106 | 注入溯源与精确回退 | `preset-injection.js:29-62` | 完整 | 用 `Symbol.for` 存原/写快照 |
| CM-LIB-107 | 第三方预设存在性证据 | `preset-presence.js:4-78` | 完整 | 三级路径 + package.json 依赖声明 |
| CM-LIB-108 | 权限三态判定 | `permission-state.js:8-72` | 完整 | `ok/inferred/broken/unknown` |
| CM-LIB-109 | 权限补丁关闭时的基线回放 | `permission-migration.mjs:23-108` | 完整 | 未知编辑不当成归属，冲突即报 |

### 提示词与规则

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| CM-LIB-110 | 规则 CRUD（原子写 + 失败回滚） | `rules.js:128-237` | 完整 | 见 §3.4 |
| CM-LIB-111 | 注入正文解析优先级（框内提交 > prompt-inject.md > 内置默认） | `rules.js:243-264` | 完整 | 返回 `{text,source,ruleId}` |
| CM-LIB-112 | 规则激活到 `AGENTS.md`/`CLAUDE.md` + 首写备份 | `rules.js:266-284` | 完整 | 备份后缀 `.dsh-purge-rule.bak` |
| CM-LIB-113 | 规则还原（先还原备份，再按内容相等决定是否删目标） | `rules.js:299-338` | 完整 | 返回 `{removed,skipped,restored}` |
| CM-LIB-114 | CWD 指令扫描与勾选注入（512KB 截断、跨目录失效） | `rules.js:396-560` | 完整 | 见 §3.4 |
| CM-LIB-115 | 技能 CRUD + frontmatter 自研解析 | `skills.js:106-457` | 完整 | 支持 `|`/`>`/chomp/indent |
| CM-LIB-116 | 技能导入（zip / tar.gz / 目录 / 单文件）与限额 | `skills.js:475-690` | 完整 | 12MB / 50MB / 200 条目 |
| CM-LIB-117 | 技能路径安全（禁从 skills 自身导入、realpath 重叠检测） | `skills.js:65-97` | 完整 | `#54` |
| CM-LIB-118 | 尾部强化段 | `boost.js:14-58` | 完整 | 默认开（`tuning.boost`） |
| CM-LIB-119 | hooks deny/ask 反向写回与状态标注 | `hooks-deny.js:25-162` | 完整 | 8 条反向规则 + 哨兵检测 |
| CM-LIB-120 | 演练授权落盘 | `drill-grant.js:9-50` | 完整 | tmp+rename |
| CM-LIB-121 | #90 原生插话恢复（文本形态 + 完成判定） | `steering.js:35-80` | 完整 | `strictFiles`/`requireAllTargets` 语义在补丁侧 |
| CM-LIB-122 | 调优状态读写 + 审计 | `tuning.js:37-106` | 完整 | 默认全开；非法值归一 |
| CM-LIB-123 | 请求失败自动重试 + 异常结束自动续跑 | `continue-retry.js:109-360` | 完整 | 预算/去重/失败连击上限 |
| CM-LIB-124 | 流式拒绝检测与多帧重试 | `refusal-retry.js:55-331` | 完整 | 默认关闭（`tuning.refusalRetry`） |
| CM-LIB-125 | 流诊断采样 | `stream-observation.js:2-24` | 完整 | 不改写、不缓冲 |

### 安全与范围

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| CM-LIB-126 | 自有服务器白名单编辑（归一化：只收单个 IP/完整主机名） | `net-scope.js:327-388` | 完整 | 丢弃通配/网段/密钥/文件后缀（`:331`、`:345`） |
| CM-LIB-127 | 区域后缀表与银行表 | `net-scope.js:6-184` | 部分 | **纯数据，无调用方**；`regionOfSuffix` 导出但库内未用 |
| CM-LIB-128 | 区域/银行拦截（攻击词 → 写拒绝句 → 清空本轮） | — | **缺失** | 本快照已移除；`DENIAL`/`ATTACK`/`NET_TOPIC` 成死代码（`net-scope.js:186-198`） |
| CM-LIB-129 | 路径包含校验（junction + 尚不存在的后代） | `path-boundary.js:5-57` | 完整 | `realDestination` 逐级上溯 |
| CM-LIB-130 | 面判定 | `surface.js:16-88` | 完整 | `DSH_SURFACE` 强制优先 |
| CM-LIB-131 | 审计流水（轮转、属主、Linux fd 钉目录、失败不致命） | `audit.js:10-144` | 完整 | 见 §8 风险行 |
| CM-LIB-132 | 运行时 nonce 探针 | `probe.js:11-70` | 完整 | 30min TTL |
| CM-LIB-133 | 启动自愈/重启策略闸门 | `settle-policy.js:3-61` | 完整 | desktop 一律不许 settle 重启 |

### 其他

| 编号 | 功能 | 代码位置 | 状态 | 备注 |
|---|---|---|---|---|
| CM-LIB-134 | 本地重锚覆盖（读写/清除/叠加） | `anchors.js:19-84` | 完整 | 越界 index 忽略 |
| CM-LIB-135 | 换包闸门（`ok` vs `notApplicable`） | `apply-gate.js:12-26` | 完整 | 只在 `handoff && sealed` 时生效 |
| CM-LIB-136 | 加密槽常量 | `asset-table.js:166-169` | 完整 | `SLOT` 拼接 163 行字符串 |
| CM-LIB-137 | 原子写/拷贝（保留权限、Windows 忙重试、durable fsync） | `atomic-files.js:39-98` | 完整 | `chmod` 在 rename 之前 |
| CM-LIB-138 | 能力选用协议三版 | `capability-protocol.js:11-48` | 完整 | 段名 `dshpg-capabilities`（避开宿主 `dsh-purge` 前缀过滤） |
| CM-LIB-139 | `node:child_process` facade（Windows 隐藏控制台） | `child-process-hide.mjs:12-87` | 完整 | 只 patch 一次（`MARK`） |
| CM-LIB-140 | 命令名冲突退让 | `command-registration.js:2-19` | 完整 | 返回 `registered/fallback/conflict` |
| CM-LIB-141 | Windows 控制台隐藏安装/还原 + `bin.js` 注入 | `hide-console.js:69-307` | 完整 | 源码 cli 只清理 sidecar（`#41`） |
| CM-LIB-142 | phase-1 白名单放宽 | `phase1-keep.js:1-21` | 完整 | 保留 CRLF |
| CM-LIB-143 | 启动/CLI 还原重打编排 + 对齐戳 + 冷却 | `reapply.js:37-392` | 完整 | 见 §8 风险行 |
| CM-LIB-144 | `reapply` CLI 包装 | `reapply-cli.js:3-5` | 完整 | stdout 一行 JSON |
| CM-LIB-145 | 加密槽密钥派生与封装 | `table-key.js:11-27` | 完整 | AES-256-GCM + deflate 9 |
| CM-LIB-146 | 加密槽解封 | `table-read.js:6-18` | 完整 | 失败返回 `""` |
| CM-LIB-147 | 受限 tar 读取（校验和、PAX、禁链接、禁嵌套扩展头） | `tar-import.js:94-143` | 完整 | 只建目录与普通文件 |
| CM-LIB-148 | 受限 zip 读取（EOCD 自洽、禁 zip64、禁链接、可选 CRC） | `zip-extract.js:22-152` | 完整 | 不回退外部解压工具（注释 `:135-147`） |
| CM-LIB-149 | 延迟加载 `yaml` 并给源码安装指引 | `yaml-runtime.mjs:1-10` | 完整 | 只标注缺失直接依赖 |
| CM-LIB-150 | 官方构建的 unpacked 原生文件签名表 | `signed-sidecars.mjs:4-27` | 完整 | 按 ASAR 头 sha256 索引 |
| CM-LIB-151 | 官方安装器交接（校验元数据完整性 → WScript 中转 → 等 ack） | `official-installer.mjs:9-57` | 完整 | SHA512 必须 `^[A-Za-z0-9+/]{86}==$` |
| CM-LIB-152 | 官方安装器执行（SHA512 + Authenticode 主体名 → 静默装 → 校验 FileVersion） | `official-installer.ps1:1-42` | 完整 | 见 §8 风险行 |
| CM-LIB-153 | WScript 中转起 PowerShell | `official-installer-launch.jsw:1-5` | 完整 | 为绕开桌面 Job Object |
| CM-LIB-154 | 官方升级后的重启脚本模板 | `official-update.wscript:1-93` | 完整 | 占位符由 `official-update.js` 填 |
| CM-LIB-155 | 逐层自检（层→补丁 id、状态汇总、hints） | `selfcheck.js:17-301` | 完整 | `notApplicable` 才从分母移除（`:104-109`） |
| CM-LIB-156 | 会话回退（草稿、派生消息、模型历史清理、锁） | `rewind.js:198-674` | 完整 | 受 `tuning.rewind` 控制 |

---

## 10. 未验证项

| 编号 | 未验证内容 | 缺什么才能验证 |
|---|---|---|
| U-1 | `Maintenance.install` 在真实 pnpm 下的完整链路（`dsh plugin add` 的退出码/输出形态） | 需要一次真实安装并保留 `pnpm` 日志；本次只静态读了 `community.js:771-850` |
| U-2 | `windows-asar-handoff` 的 Job Object 分支 | 需要 Windows + 从 Job Object 内启动的宿主；本机是 macOS |
| U-3 | `official-installer.ps1` 的 Authenticode 校验 | 需要一份真实的官方安装包与签名链 |
| U-4 | `restart-desktop.js` 在 Windows 上的 `--updated` 前置窗口 | 需要 Windows 桌面会话 |
| U-5 | `desktop.js:1092` `planOfficialRestart` 的日志状态机与真实 wscript 日志的对应 | 需要一次真实的 wscript 重启并保留 `%TMP%/dsh-purge-official-restart.log` |
| U-6 | `prune` 在跨时区/跨天场景的保留结果 | 需要构造多天多份备份并跑 `prune`（会删文件，本次只读审计未执行） |
| U-7 | `gcObjects` 与并发 `snapshot` 的竞态 | 需要两个进程同时维护同一 `backups/` |
| U-8 | `presets-plugin` 在真实宿主 `agentPresets.register()` 上的注册结果 | 需要运行中的 DSH 且该 profile 未声明 `unrestricted` |
| U-9 | `identity.js` 改写在真实多轮会话里的去重效果（系统提示词是否只剩一份） | 需要 dump 一份真实 `assembled.sections` |
| U-10 | `refusal-retry` 的重试帧在真实 provider 上的效果 | 需要真实拒绝样本；本次只读代码 |
| U-11 | `continue-retry` 的 280ms idle 竞态是否真被消除 | 需要多轮真实 idle→submit 时序复现 |
| U-12 | `signed-sidecars.mjs` 的表是否覆盖当前官方构建 | 需要对应版本的 `app.asar` 头 sha256 与 unpacked 文件实际摘要 |
| U-13 | `update-system-proxy` 的 reg.exe 非 ASCII 回退 | 需要 Windows + 非 ASCII 代理凭据 |
| U-14 | `selfcheck.js` 层映射与 `ALL_PATCHES` 的一致性 | `ALL_PATCHES` 在 `core.js`/`patches/`（另册），本次只核了 id 引用形状 |
| U-15 | `rewind.js` 的回退在真实会话事件流上的边界（打开中的轮次、子代理） | 需要真实 session 事件序列 |
| U-16 | 更新通道「成功路径」（能真的列出并安装一个发行） | 仓库当前对匿名 404（`[实测]`），需要仓库恢复公开或配 `GITHUB_TOKEN`；本次只验到失败路径 |
| U-17 | `install-registry.js` 的官方源重试 | 需要 npmmirror 缺版本的复现环境 |
| U-18 | `permission-migration.mjs` 的基线回放 | 需要一份带 `.dshpurge.bak` 的真实宿主文件与被禁用的权限补丁 |
