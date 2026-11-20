# P20 运行时缺陷审计（构建产物）

只读审计。未改动任何代码；本文件是唯一写入。

## 0. 审计对象

| 文件 | 行数 | sha256 前 16 位 |
|---|---:|---|
| `dist/build/package/lib/redteam/store-core.js` | 7629 | `b2f59dee432dbafc` |
| `dist/build/package/lib/redteam/schema.js` | 833 | `9dd5b2f6a354d4b1` |
| `dist/build/package/lib/redteam/tools.js` | — | `6fbc3134dad72d18` |
| `dist/build/package/client.js` | 17597 | `c78cf8074ae0d149` |
| `dist/build/package/lib/redteam/client.js` | 6125 | `2971b8fb641df51e` |

**审计口径**：只读 `dist/build/package/`（构建产物），不读 `vendor/`。文中行号一律指构建产物。

**判定标准**：只收「会导致错误行为 / 静默失败 / 数据损坏」的缺陷。风格、命名、注释、日志措辞一律不收。

**复现方式**：需要跑代码的三条（R-01 / R-02 / R-05）已在本机用最小脚本复现，脚本见 §8。其余为确定性代码路径，逐行可推。

## 1. 结论总览

共 26 条：**高 5 / 中 11 / 低 10**。

| 编号 | 等级 | 位置 | 一句话 |
|---|---|---|---|
| R-01 | 高 | `client.js:3394` / `lib/redteam/client.js:1847` | Markdown 解析器对「`\|` 开头且下一行不是分隔行」的输入**死循环**，标签页卡死并吃光内存 |
| R-02 | 高 | `store-core.js:2603` | KEV 的 meta 路径用 `replace(/\.json$/…)` 推导；`dest` 不以 `.json` 结尾时**把刚下载的数据覆盖成 meta**，仍报 `updated` |
| R-03 | 高 | `store-core.js:2172-2183` + `tools.js:774-786` + `store-core.js:1026-1030` | 新列 `location` **写入永远为 NULL**：store 收、op 不转发、工具没这个参数，且工具把 `target` 描述成「具体位置」 |
| R-04 | 高 | `store-core.js:2168-2170` | 去重键 `(kind,target)` 不含 location：同主机第二个 webshell/账号被**静默吞成一条** |
| R-05 | 高 | `store-core.js:2196-2201`、`2258` | 清理清单 SQL 异常被吞成空数组，`cleared` 由 `open===0` 推出 → **查询失败 = 报告写「已清干净」** |
| R-06 | 中 | `store-core.js:3074-3090` | 关系图的「在等谁」跨靶标串台：会话改绑后仍显示旧靶标的等待状态 |
| R-07 | 中 | `store-core.js:3077` + `1713` | `attentionQueue` 的 limit 上限就是 100，超出部分被静默截掉且无截断标记 |
| R-08 | 中 | `store-core.js:1303-1310` | `intelUpdate` 的 op 恒返回 `ok:true`，即使两条资源全部 `failed` |
| R-09 | 中 | `store-core.js:2642-2674` | nuclei 的 `.nuclei-stage-<pid>` 只在成功路径删除，所有异常路径永久残留（最多 256MB+） |
| R-10 | 中 | `store-core.js:2654-2666` | 目录交换的失败点没有全覆盖；跨文件系统 rename 必失败且无兜底 |
| R-11 | 中 | `store-core.js:2513-2541` | 下载上限只挡字节数不挡内存：256MB 上限 = ~512MB 峰值，无 `content-length` 预检 |
| R-12 | 中 | `store-core.js:2678-2696` | `#countTemplates` 只读前 400 字节 + 深度>6 返回 0；`git pull` 成功但 0 个模板仍报 `updated` |
| R-13 | 中 | `store-core.js:5961-5968` | `layout:'simple'` 分支把整份报告算两遍，外层已构造好的 markdown 被丢弃 |
| R-14 | 中 | `schema.js:604-607`、`773` | `ensure()` 吞掉 ALTER 异常并**恒返回 true**；补列失败后 `addCleanup` 的 INSERT 必然报错 |
| R-15 | 中 | `client.js:9039-9041` | 拖拽时每次 pointermove 重跑整张图的布局（无 memo、无 rAF 合帧） |
| R-16 | 中 | `client.js:9015` | `useEffect` 依赖漏 `props.sessionId`：换会话不重新取数，「本会话」高亮与绑定都落在旧会话 |
| R-17 | 低 | `store-core.js:1407-1424` | 绑定表半截 JSON 被当作「还没绑过」，关系图返回空图且 `ok:true`，与「真没有绑定」不可区分 |
| R-18 | 低 | `store-core.js:1454-1459` | 200 条截断按 `at` 降序，`at` 为 null 的条目 `"null"` 排在 ISO 时间之前 → 优先保留、把新的挤掉 |
| R-19 | 低 | `store-core.js:2543-2551` | `update-log.jsonl` 无上限、无轮转，失败也写 |
| R-20 | 低 | `store-core.js:2583`、`2622` | `dest` 的计算在 `try` 之外；抛错会让整轮 `intelUpdate` 中断，与「单个资源失败不影响另一个」的注释矛盾 |
| R-21 | 低 | `store-core.js:2599-2602` | KEV 的 `dest + '.tmp-' + pid` 在 rename 失败时残留（dest 是目录时必现） |
| R-22 | 低 | `store-core.js:5964` | `delete report.markdown` 只删副本，顶层 `markdown` 仍有值；同一字段两个位置一个有值一个没有 |
| R-23 | 低 | `store-core.js:2241` | `updateCleanup` 的白名单没有 `location`：写错的 location 永远改不了 |
| R-24 | 低 | `client.js:9055` | `setPointerCapture` 失败时 `dragRef` 不会复位，之后任意 pointermove 继续拖动上一个节点 |
| R-25 | 低 | `store-core.js:916` / `923`（evidenceLedger op） | `total` 取自 `list({limit:500})` 的长度，可能小于 `unverified` 计数，两个数字互相矛盾 |
| R-26 | 低 | `store-core.js:2322-2332` | `scopeCheckTarget` 对无法解析的 CIDR 条目 `continue`，整条授权范围被静默忽略，结论退化成 `out` |

## 2. A. `sessionGraph()` 与 op `sessionGraph`

### R-06【中】跨靶标的「在等谁」串台

**位置**：`store-core.js:3073-3090`（`waiting` 的构造），`store-core.js:3102`（挂到节点上）。

**代码事实**：`waiting` 是一个只按 `session_id` 建键的 Map（`3082` 的 `waiting.has(sid)`），构造时**遍历所有靶标**、对每个靶标调 `attentionQueue(eng.id, …)`（`3077`），然后 `3102` 无条件 `waiting.get(sid)` 挂到该会话节点上 —— 全程没有校验 `row.session_id` 这个会话当前是不是绑在 `eng.id` 上。

**触发条件**：会话 S 先绑靶标 A，A 的库里留下一条未确认的 `agent_report`（`acknowledged_at IS NULL`）；随后把 S 改绑到 B（面板下拉或 `redteam_session_bind`）。`setSessionBinding` 只改 `sessions.json`，**不会**去 A 的库里确认旧回报。

**后果**：关系图上 S 节点显示的「在等：…」来自 A 的回报，而节点连的是 B。因为 `waiting` 按靶标顺序先到先得（`engagements` 按 `created_at` 倒序，`listEngagements` 的排序），新建的靶标排前面，所以**旧靶标的等待反而更容易赢**。用户会照着这条去 B 里找人，找不到。

**修法建议**：构造 `waiting` 时按绑定反查归属 —— 先把 `bindings` 折叠成 `sid → engagement`，循环里加 `if (!sid || sidEngagement.get(sid) !== eng.id) continue`；或在 `attentionQueue` 里按 `session_id` 参数收窄。

### R-07【中】100 条上限把「在等」截掉且无标记

**位置**：`store-core.js:3077`（`limit: 100`）、`store-core.js:1713`（`Math.min(…, 100)` 是硬上限）、`store-core.js:1724`（`items.slice(0, limit)`）。

**触发条件**：某个靶标里未确认回报超过 100 条（多子智能体并行、或 `acknowledge` 一直没做）。`attentionQueue` 返回的 `items` 已经是被切过的数组，`total` 才是全量。

**后果**：`sessionGraph` 只读 `q.items`（`3078`），`q.total` 从不使用 → 排在 100 名之后的会话在图上显示「没在等」。`attentionQueue` 按 rank 排序（`waiting > ready > blocked > failed > progress`），被截掉的首先是 `progress` 类，但只要 `waiting/blocked` 累积过百，真正要人处理的也会被截掉。**没有任何字段能让人发现这里被截断过**。

**修法建议**：`rows` 取到后比较 `q.total > q.items.length`，在 `sessionGraph` 返回值里加 `waiting_truncated: true`（并在节点上标「还有 N 条未显示」）；或改成按 `session_id` 直查，绕开队列切片。

### R-17【低】绑定表损坏 = 空图，且与「真没有绑定」不可区分

**位置**：`store-core.js:1407-1410`（`sessionBindings` 的 `catch { parsed = null }`）。

**行为（任务点名项）**：文件缺失、半截 JSON、`agents` 不是对象、某条 `engagement` 不是非空字符串 —— 一律被当成「还没绑过」，返回 `{}`。`sessionGraph` 因此返回 `sessions: []`、`count_by_engagement: {}`、`ok: true`。

**后果**：面板走空态分支（`client.js:9112-9115`「还没有会话绑定过靶标」），运维无法区分「确实没绑」与「绑定表被写坏了」。写入侧用的是 `atomicWriteSync`（`1461`），正常不会半截；但手工编辑、磁盘满、备份还原截断都会产生这种文件，而**下一次 `setSessionBinding` 会用新内容整份覆盖**（`1461`），坏文件里的其余绑定就永久消失了。

**修法建议**：`JSON.parse` 失败时不要静默返回 `{}`，返回 `{ __error }` 并由 op 透出成 `note`/`bindings_error`；`setSessionBinding` 检测到读失败时先备份成 `sessions.json.corrupt-<ts>` 再写。

### R-18【低】200 条截断的排序把 null 排在最前

**位置**：`store-core.js:1454-1459`。

**代码事实**：`sort((a,b) => String(b[1].at).localeCompare(String(a[1].at)))` 是降序，`at` 为 null 时键是字符串 `"null"`。ICU 排序里数字先于字母，所以 `"null"` 大于任何 `"2026-…"`，降序排在最前，`slice(0, 200)` 优先保留。

**触发条件**：绑定表里有 `at` 缺失的条目（旧版本写入、手工编辑、别的工具写入）。`sessionBindings` 在 `1419` 把非字符串 `at` 归一成 `null`。

**后果**：这类条目挤占名额，把真正较新的绑定挤出 200 条之外并**从文件里删掉**（`1461` 只写 `pruned`）。是数据丢失，不是显示问题。

**修法建议**：排序键改成 `Number.isFinite(Date.parse(at)) ? Date.parse(at) : 0`，null 排最后；或直接按 `Object.entries` 插入顺序截断。

### 已核对：`count_by_engagement` 与 `sessions` 一致（无缺陷）

`store-core.js:3093-3104`：`countBy` 与 `sessions.push` 在**同一个循环体**里、同一份 `bindings` 上完成，过滤条件也是同一个 `existing.has(...)`（`3094`）。op（`825-847`）只是给 `sessions` 加了 `current` 字段，没有动 `count_by_engagement`。两者不可能不一致。

### 已核对：绑定指向已删除靶标会被过滤（无缺陷，但口径偏宽）

`3094` 的 `existing` 来自 `listEngagements()`，即「`engagements/` 下存在同名**目录**」。`setSessionBinding` 的写入前置检查用的是 `existsSync(this.dbPathOf(engagement))`（`1448`），即「**assets.db 存在**」。两个口径不同：目录还在、`assets.db` 被删掉时，绑定会通过 `3094` 的过滤并在图上出现，但 `attentionQueue` → `this.db(id)` 会抛 `engagement not found`（`3130-3134`），被 `3079` 吞成 `rows=[]`，节点照常渲染。属于口径不一致导致的僵尸节点，等级低，不单列。

### 已核对：`attentionQueue` 抛错被正确降级（无缺陷）

`3076-3079` 的 `try/catch` 包住了整个调用，`catch { rows = [] }`。表缺失（`1701-1704` 也各自有 catch）、库文件缺失、FTS 缺失都不会让整张图报错 —— 与注释声明一致。

## 3. B. `intelUpdate` / `#updateKev` / `#updateNuclei` / `#fetchCapped` / `#countTemplates`

### R-02【高】KEV 的 meta 覆盖掉刚下载的数据

**位置**：`store-core.js:2599-2607`。关键一行 `2603`：

```js
writeFileSync(dest.replace(/\.json$/, '.meta.json'), JSON.stringify({…}), 'utf8')
```

**触发条件**：`dest` 不以 `.json` 结尾。`dest` 可由请求体指定：op `intelUpdate` 在 `1305` 把 `req.dest` 原样透传，`2583` 用 `options.dest || this.#intelPaths('kev')[0]`。默认路径是 `…/intel/kev.json`（`2414`）不会触发；`req.dest = "/tmp/kev-feed"` 就会。

**后果（已实测，见 §8.1）**：`2602` 先把 48MB 的 KEV 数据 rename 到 `dest`，`2603` 的 `replace` 不生效、meta 路径与 `dest` **同一个文件**，于是数据被 11 字节的元数据覆盖。函数继续走 `2608` 记日志、`2609-2613` 返回 `{ action:'updated', bytes, count, sha256 }` —— **成功形状 + 已被写坏的文件**。调用方拿 `count` 和 `sha256` 做对账会全部对不上。

**修法建议**：meta 路径用无条件后缀 `dest + '.meta.json'`；`dest` 加后缀白名单（只接受 `.json`）或限制在 `#intelPaths('kev')` 的目录内。

### R-08【中】op 恒返回 `ok:true`

**位置**：`store-core.js:1303-1310`。

**代码事实**：`return Object.assign({ ok: true }, out)`，而 `out.results` 里每条都可能是 `{ action: 'failed', error }`。`intelUpdate`（`2565-2578`）本身也不设 `ok`。

**后果**：包内的两个消费者各自补了判断 —— 工具 `redteam_intel` 在 `tools.js:842` 重算 `failed.length === 0`，面板按钮在 `client.js:3564` 重算 `bad` —— 但任何直接打 `/redteam/api` 的调用方（脚本、以后接的自动化、`curl` 验收）会把「两条资源全失败」读成成功。这是最容易被写进验收报告的那种错。

**修法建议**：`ok: (out.results || []).every(r => r.action !== 'failed')`，与工具口径统一。

### R-09【中】nuclei 的 stage 目录在异常路径永久残留

**位置**：`store-core.js:2642-2674`。`rmSync(stage, …)` 只出现在两处：`2643`（**下次**运行开头，且目录名带 `process.pid`）和 `2666`（成功路径）。

**触发条件（任一）**：`tar` 不存在（`2647` ENOENT）；`tar -xzf` 失败（包被截断、磁盘满）；顶层目录数 ≠ 1（`2649`）；缺 `http/` 与 `network/`（`2651`）；`renameSync(unpacked, dest)` 失败（`2660`）；`rmSync(backup)` 失败（`2665`）。

**后果**：`stage` 里留着 `templates.tgz`（最多 256MB）**加上**解压出来的整棵目录树。`2643` 的清理只对**同一个 pid** 有效，而 pid 每次都变 → 每失败一次就多一份，永不回收。跑几次弱网环境就能吃掉几个 GB。

**修法建议**：把 stage 的生命周期包进 `try { … } finally { rmSync(stage, { recursive: true, force: true }) }`；`finally` 里的失败用 `force: true` 吞掉即可。

### R-10【中】目录交换的失败点没有全覆盖 + 跨设备 rename

**位置**：`store-core.js:2654-2666`。

三处漏洞：

1. `renameSync(dest, backup)`（`2658`）**在 `try` 之外**。它成功、后续步骤也成功、但 `rmSync(backup)`（`2665`）抛错（权限/被占用/只读卷）→ 落到 `2670` 的外层 catch → 返回 `action:'failed'`，而 `dest` 已经是新数据、`backup` 还在、`stage` 也在。**失败结论与事实相反**。
2. `2658` 之后、`2660` 之前进程被杀：`dest` 消失，只剩 `dest.bak-<ts>`。下次 `intelStatus` 报 `missing`（`2445-2453`），用户看到「nuclei 模板不见了」，而数据其实在 `.bak` 里 —— 没有任何代码会去找它。
3. `stage` 在 `this.root/intel/` 下，`dest` 在 `$HOME/.local/nuclei-templates`（`2418`）。两者跨挂载点时 `renameSync(unpacked, dest)` 必然 `EXDEV` → 每次更新都失败、每次都留 stage（见 R-09），且**没有 `cpSync` 兜底**。

**修法建议**：`2658` 挪进 `try`；回滚分支记录 `backup` 路径到返回值，让下一次调用能识别并恢复 `.bak-*`；跨设备时退化为 `cpSync(unpacked, dest, {recursive:true})` 再删 stage。

### R-11【中】大小上限只挡字节数，不挡内存

**位置**：`store-core.js:2513-2541`。`chunks.push(Buffer.from(chunk))`（`2536`）+ `Buffer.concat(chunks)`（`2539`）。

**后果**：`nuclei` 的 `max_bytes` 是 256MB（`2507`），意味着峰值 `chunks` 256MB + `Buffer.concat` 再复制一份 = **~512MB**，随后 `writeFileSync(tarPath, got.buf)` 再持有一次，`tar` 解压又要一份磁盘。低内存机器上直接 OOM，而 OOM 发生在 `writeFileSync` 之前 → 进 `2670` 的 catch → 又留一个 stage。另外没有任何 `content-length` 预检：服务端声明 2GB 也会先读满 256MB 才断。

**修法建议**：先读 `res.headers.get('content-length')` 与 `maxBytes` 比较，超了直接抛；改成边读边 `createWriteStream` 写临时文件并累计计数，彻底去掉内存缓冲。

### R-12【中】模板计数可以静默为 0 而仍报 `updated`

**位置**：`store-core.js:2678-2696`。`2680` 深度 > 6 直接 `return 0`；`2689-2690` 只读前 400 字节、要求行首 `id:`。

**触发条件**：① `git pull` 成功但目录里没有可识别模板（比如用户把 `dest` 指向了一个普通 git 仓库，`2626` 的 `existsSync(join(dest,'.git'))` 只认 `.git`）；② 模板文件以 >400 字节的注释/license 头开头。

**后果**：`2633` 与 `2669` 都返回 `{ action:'updated', templates: count }`，`count` 可以是 0。工具侧只把 `failed` 当失败（`tools.js:842`），于是「更新成功、0 个模板」被判为成功。紧接着 `intelStatus` 的 `age_days` 是新目录的 mtime，`stale:false` → 面板显示「资源新鲜」，而实际上一个模板都没有。

**修法建议**：`count === 0` 时返回 `{ action:'failed', error:'更新后未识别到任何模板（目录结构不对？）' }`，或至少加 `warning` 字段并让 `ok` 变 false；`#countTemplates` 的读窗口提到 2KB。

### R-19【低】`update-log.jsonl` 无上限

**位置**：`store-core.js:2550-2556`（`appendFileSync` 在 `2554`，无轮转、无大小检查）。`intelUpdate('all')` 每轮写 2 行，失败也写（`2616`、`2672`）。每次 `kev` 失败记一行、`nuclei` 每次 `git-pull-failed` 还多一行（`2636`）。长期定时刷新会无界增长。

**修法建议**：追加前 `statSync` 判大小，超过 1MB 轮转成 `update-log.1.jsonl`（保留一份即可）。

### R-20【低】`dest` 的计算在 try 之外，会打断整轮

**位置**：`store-core.js:2583`（`#updateKev`）与 `2623`（`#updateNuclei`）—— 两行都在各自 `try` 之前。

**后果**：`#intelPaths` 若抛错（`this.root` 非字符串、`join` 参数类型错），异常直接冒出 `#updateKev`，`intelUpdate` 的 `for` 循环（`2569-2575`）中断，另一条资源根本不会跑，op 只回一个 `{ok:false,error}`。与 `2563` 的注释「单个资源失败不影响另一个」直接矛盾。

**修法建议**：把 `dest` 计算挪进 `try`，或在 `intelUpdate` 的循环里给每次 `await` 包一层 try，单条失败也 push 成 `{action:'failed'}`。

### R-21【低】KEV 的 tmp 文件在 rename 失败时残留

**位置**：`store-core.js:2600-2602`。`tmp = dest + '.tmp-' + process.pid` 写入后，`renameSync(tmp, dest)` 若失败（`dest` 是目录 → `ENOTEMPTY`/`EISDIR`；跨设备 → `EXDEV`），`tmp` 不会被删。

**后果**：每次失败在 `intel/` 下留一个最多 48MB 的 `kev.json.tmp-<pid>`，且不同 pid 不互相覆盖。

**修法建议**：`renameSync` 包 `try/catch`，catch 里 `rmSync(tmp, {force:true})` 后 rethrow。

### 已核对：`dry_run` 确实不写任何文件（无缺陷）

- `#updateKev`：`2596-2598` 在 `mkdirSync`（`2599`）之前返回，`#intelLog`（`2608`）也在其后。
- `#updateNuclei` git 分支：`2625` 在 `execFileSync('git', …)`（`2628`）之前返回。
- `#updateNuclei` tar 分支：`2641` 在 `mkdirSync(stage)`（`2644`）之前返回。
- `intelUpdate` 收尾的 `intelStatus()`（`2578`）是纯读（`2436-2483`），不写 `.checked`（那是 `intelRefresh` 的事，`2702-2710`）。

结论：`dry_run` 路径上没有任何 `writeFileSync` / `appendFileSync` / `mkdirSync` / `rmSync`。

### 已核对：`HOME` 为空、`tar`/`git` 缺失、200+HTML 错误页（无新增缺陷）

- **`HOME` 为空**：`#intelPaths('kev')` 的第一条是 `<root>/intel/kev.json`（`2414`），不受影响；`#intelPaths('nuclei')` 两条都以 `HOME` 为前缀（`2418-2423`），为空则数组为空 → `dest === undefined` → `2625` 的守卫抛「找不到可写的模板目录（HOME 为空？）」，行为正确。`#updateKev` 没有同样的守卫，但它的 dest 恒非空。
- **`tar` 不存在**：`2647` 抛 `spawnSync tar ENOENT` → `2670` → `action:'failed'`。行为正确，只是错误文案不含「没装 tar」的指引，且留 stage（R-09）。
- **`git` 不存在**：`2628` 抛 ENOENT → `2636` 记 `git-pull-failed` → 退回整包下载。行为正确。
- **200 + HTML**：KEV 三道校验齐全（`2588` `JSON.parse`、`2591` `vulnerabilities` 必须是数组、`2592` 空数组拒绝、`2594` 每条必须有 `cveID`），HTML 一定被拦。nuclei 只查 `bytes < 1024`（`2640`），>1KB 的 HTML 能通过下载校验，但 `tar -xzf` 会失败 → `failed`。**唯一的加固点**：nuclei 没有 gzip 魔数校验（`buf[0]===0x1f && buf[1]===0x8b`），加一行可以让错误信息从 tar 的乱码变成「返回的不是 tar.gz」。

## 4. C. `scoreReport(..., {layout:'simple'})`

### R-13【中】整份报告算两遍，外层 markdown 被丢弃

**位置**：`store-core.js:5961-5968`；被调方 `reportV2` 在 `2768` 又调了一次 `this.scoreReport(id, options)`。

**代码事实**：进入 simple 分支时，外层的 `items2`、`stages`、`summary`、以及 `md`（`5540-5956` 构造的整份 legacy markdown，含每条命中最多 20KB 的 `clip(e.request, 20000)`）**都已经算完**。`5962` 再调 `reportV2`，`2768` 内部第三次读库、第二次构造同样的 legacy markdown，最后 `5967` 用的是**内层**的 `built.markdown`，外层 `md.join('\n')`（`5970` 只在 legacy 分支用到）被直接丢弃。

**后果**：500 条命中时约 2× CPU、2× 峰值内存；`summary`（外层）与 `report.summary`（内层）来自两个不同时刻的两次查询。同进程内两次调用是同步的、中间不会插入别的写入，所以**数值不会分叉**；但 `report.generated_at`（`3037`）与外层 `summary` 不是同一时刻，且一旦有第二个进程（CLI、另一个宿主进程）在这两次之间写库，同一份响应里的两个总分就会不一致 —— 而这正是 `5957-5960` 的注释最想避免的事。

**修法建议**：simple 分支直接 `return { items: items2, stages, summary, markdown: md.join('\n'), report: built, layout:'simple' }`，复用外层已算好的结果；或反过来，simple 分支在函数**开头**就分流，根本不构造 legacy 的 `items`/`md`。

### R-22【低】`delete report.markdown` 造成的字段不对称

**位置**：`store-core.js:5963-5964`。

`const report = Object.assign({}, built); delete report.markdown` —— 只删浅拷贝上的键，`built` 不受影响，顶层 `markdown`（`5967`）仍是完整正文。**包内没有任何消费者读 `.report.markdown`**（全包 grep 无命中），所以现在不会出错。

但这构成一个对外契约陷阱：同一份响应里 `markdown` 有值、`report.markdown` 是 `undefined`；任何按 `{report:{markdown}}` 读的调用方会拿到 `undefined` 并**静默渲染空报告**。另外该分支当前**无调用方**（全包 grep `layout` 只有定义处 `5957/5961/5962/5967/5970`，没有任何调用点传 `'simple'`），属未启用的死代码 —— 死代码里的契约错误最难在回归里发现。

**修法建议**：要么保留 `report.markdown` 并让两处同源，要么删掉整个 `report` 字段只留顶层 `markdown`；不要留「同名不同值」。

### 已核对：递归保护成立（无缺陷）

调用链：`scoreReport(simple)` → `5962` `reportV2({...options, layout:'legacy'})` → `2768` `scoreReport(legacy)` → `5961` 判 `!== 'simple'` → `5970` 返回。深度恒为 2，不存在自递归。`Object.assign({}, options, {layout:'legacy'})` 是**强制覆盖**（不是 `options.layout || 'legacy'`），所以调用方即使传 `layout:'simple'` 也压不进去。任何非 `'simple'` 的 layout 值（含 `'Simple'`、`'v2'`）都静默走 legacy，这是宽松的，但不构成错误行为。

## 5. D. `cleanup_item.location` 迁移与 `addCleanup`

### R-03【高】新列 `location` 的写入路径永远为 NULL

**位置**：三处必须同时看 ——

1. `store-core.js:2172-2183`：`addCleanup` 从 `item.location` 取值，列名与占位符都已就位。
2. `store-core.js:1026-1030`：op `addCleanup` **只转发 7 个字段**（`asset_id/target/kind/title/detail/evidence_ref/priority/created_by`），**没有 `location`**。
3. `tools.js:771-783`：工具 `redteam_cleanup` 的 `parameters` 里**根本没有 location**；而它的 `target` 描述写的是「add：具体位置（URL / 主机:端口 / 账号名 / 文件路径）」（`tools.js:775`）。

**后果**：`cleanup_item.location` 在真实数据里 100% 是 NULL。更糟的是语义被写反了：`2172` 的注释说「target 只写『哪台机器』」，而工具告诉模型「target 写具体位置」。模型按工具描述填，路径就落在 `target` 里；报告第四段（`3028-3030`）只映射 `target`、不映射 `location`，于是「删哪个文件」这件事在交付物里彻底消失 —— 而这正是 `2172` 注释声称要解决的问题。

面板侧的旁证：交付报告那张表的表头写的是「类型 / **位置** / 说明 / 状态」（`lib/redteam/client.js:2394`），而单元格渲染的是 `c.target`（`2395`）—— 界面早就把 `target` 当「位置」用了，与 store 注释里「target 只写哪台机器」正好相反。三处口径（DDL 注释、工具描述、界面表头）互相矛盾，新列 `location` 落在一个谁都不用的中间态。

**修法建议**：三处一起改 —— op 转发 `req.location`；工具加 `location` 参数并把 `target` 描述改成「哪台机器」；`reportV2` 的 cleanup 映射加 `location`。

### R-04【高】去重键不含 location，第二条被静默吞掉

**位置**：`store-core.js:2168-2170`。

```js
const dup = target === '' ? undefined : db.prepare(
  "SELECT id FROM cleanup_item WHERE kind = ? AND target = ? AND status = 'open'").get(kind, target)
if (dup) return { cleanup_id: Number(dup.id), deduped: true }
```

**触发条件**：同一台主机上留下两个不同的 webshell（`/var/www/a.php`、`/var/www/b.php`），agent 按工具描述把 `target` 写成主机名 `10.0.0.5`。

**后果**：第二条返回 `{deduped:true, cleanup_id: <第一条的 id>}`，**新的一条一个字节都不写**。调用方看到 `ok:true` + 一个 id，会认为登记成功。演练收尾按清单逐条删，第二个 webshell 就留在靶标上 —— 这是清理清单最不能出的错。反过来，如果 agent 把路径写进 `target`，去重就退化成按路径判，同主机不同路径两条都留（这时结果是对的）。**行为完全取决于调用方怎么写，没有任何约束**。

**修法建议**：去重键改成 `(kind, target, COALESCE(location,''))`；`deduped:true` 时在返回值里带上被命中的那条的 `location`，让调用方能判断「是不是同一个东西」。

### R-05【高】查询异常被吞成「已清干净」

**位置**：`store-core.js:2196-2201`（`listCleanup` 的 `catch { rows = [] }`）、`2213`（`cleared: byStatus.open === 0`）、`2254-2267`（`cleanupSummary` 同样的 `catch { rows = [] }` 与 `out.cleared = out.open === 0`）。

**触发条件**：`cleanup_item` 表不存在（老库 + `migrate` 那段大 `try` 被前面的错误打断，见 R-14）、库被独占锁、库只读、磁盘错误。

**后果**：`rows = []` → `by_status.open === 0` → `cleared: true`；`cleanupSummary` 同样得到 `{total:0, open:0, cleared:true}`。于是：

- `reportV2` 第四段（`3011-3033`）拿到 `cleanup.total === 0`，前端 `lib/redteam/client.js:2386` 走「没有登记清理项」分支；
- 首页徽章按 `cleared` 显示绿灯。

**「查不出来」被渲染成「已经清干净」**，这是本包最危险的一条静默失败 —— 它把一个「我不知道」变成了一句对外承诺。

**修法建议**：`catch` 里不要返回空数组，改成 `throw`（或返回 `{ error }`）；`cleared` 只在查询成功时计算，查询失败时返回 `cleared: null` + `error`，让前端显示「无法确认」。

### R-14【中】`ensure()` 恒返回 true，补列失败无人知

**位置**：`schema.js:604-607`：

```js
const ensure = (table, column, ddl) => {
  if (has(table, column)) return false
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`) } catch { /* 并发迁移时忽略 */ }
  return true
}
```

调用点在 `schema.js:773`，而它位于 `714` 开始的那个大 `try` 里（覆盖 `asset_coverage` / `host_coverage` / `host_finding` / `cleanup_item` / `data_proof` 五段 DDL）。

**触发条件**：① `ALTER TABLE` 因 `SQLITE_BUSY`（另一个进程正在写）、只读挂载、磁盘满失败；② `714` 那段里更早的 `db.exec` 抛错 → 整个 `try` 跳到 `775` 的 catch，`773` 根本没执行。

**后果**：`ensure` 无论成败都 `return true`，调用方（`773` 没接返回值，但 `2174` 的 INSERT 显式写了列名 `location`）在列不存在时直接报 `table cleanup_item has no column named location` → **每一次登记清理项都失败**。而 `listCleanup` 用的是 `SELECT *`（`2198`），不受影响 → 读得到旧数据、写不进新数据，症状看起来像「保存按钮坏了」。

**修法建议**：`ensure` 在 `ALTER` 失败后**再 `has()` 一次**，仍不存在就 `throw`（或返回 `false` 并由调用方记录）；`773` 从大 `try` 里挪出来单独 try，避免被前面的 DDL 连带。

### 已核对：`addCleanup` 的 SQL 参数个数严格对应（无缺陷，逐个数的）

`store-core.js:2174-2183`：

| # | 列 | 实参 | 位置 |
|---|---|---|---|
| 1 | `asset_id` | `item.asset_id == null ? null : Number(item.asset_id)` | 2177 |
| 2 | `target` | `target === '' ? null : target` | 2178 |
| 3 | `location` | `location === '' ? null : location` | 2178 |
| 4 | `kind` | `kind` | 2178 |
| 5 | `title` | `title` | 2178 |
| 6 | `detail` | `item.detail === undefined ? null : item.detail` | 2179 |
| 7 | `evidence_ref` | `item.evidence_ref === undefined ? null : item.evidence_ref` | 2180 |
| 8 | `status` | `'open'` | 2181 |
| 9 | `priority` | `String(item.priority \|\| 'medium')` | 2182 |
| 10 | `created_by` | `item.created_by === undefined ? null : item.created_by` | 2183 |
| 11 | `created_at` | `nowIso()` | 2183 |

列 **11** 个、占位符 **11** 个、实参 **11** 个，顺序逐项对上。`2174-2175` 的列名串与 `VALUES(?,?,?,?,?,?,?,?,?,?,?)` 都是 11 项。**没有错位。**

`location` 被插在 `target` 之后、`kind` 之前，与 DDL 顺序（`schema.js:407`）一致；即使不一致也不影响，因为 INSERT 显式列名。`last_insert_rowid()`（`2184`）在同一连接上取，不会串到别的语句。

### R-23【低】`location` 写进去也改不了

**位置**：`store-core.js:2241` 的字段白名单 `['detail','evidence_ref','priority','target','title']`，以及 `1033` 的 op 白名单（同样没有 `location`）。

**后果**：`location` 是写一次的。配合 R-04（去重吞掉新值）和 R-03（根本写不进），即使将来修好 R-03，写错的位置也永远无法纠正，只能删库重来。

**修法建议**：两处白名单都加 `'location'`。

## 6. E. 前端两份产物

### R-01【高】`mdParseBlocks` 死循环

**位置**：三份产物逐字相同 —— `client.js:3394-3460`、`lib/redteam/client.js:1847-1913`、源片段 `overlay/snippets/md-render.js`。

**死循环的精确路径**（以 `client.js` 行号）：

1. `3400` 取 `line`；`3401` fence 不匹配；`3411` heading 不匹配；`3417` 分隔线不匹配。
2. `3422` 表格分支要求 `i + 1 < lines.length && isTableSep(lines[i + 1])`。当下一行**不是**分隔行时不成立。
3. `3431` quote 不匹配；`3437` bullet 不匹配。
4. `3450` `line.trim() === ''` 不成立（这一行有内容）。
5. `3452-3456` 段落循环的第一个条件 `!/^\|/.test(lines[i])` **立即为假** → `para` 保持空数组、`i` **一步都没前进**。
6. `3457` `blocks.push({ type: 'p', text: '' })`，`while (i < lines.length)` 回到第 1 步，**同一行再判一次**。

`i` 永不递增，`blocks` 每轮增长一个空块 → CPU 100% 且内存持续上涨，标签页卡死直到 OOM 被杀。

**触发条件**：任何一行以 `|` 开头、且**下一行不是**表格分隔行（`/^\|?[\s:-]*-[-\s:|]*\|?$/` 且含 `|`）。已实测（§8.2）：输入 `'| 说明：这一行不是表格\n下一行是正文'` 立即挂死；`'| a | b |\n不是分隔行\n正文'` 同样挂死。

**报告里怎么产生这种行**：`store-core.js:5842` 与 `5952` 把 `g.target` / `c.target` **原样**拼进表格行（同文件其它单元格都过了 `oneLine()`，只有这两处没有）。值里含换行时该行被劈成两行：

```
| 1 | `10.0.0.5
| 备注` | … | +10 |
```

第二行以 `|` 开头，下一行是普通表格行（`isTableSep` 为假）→ 命中死循环。`target` 是模型/工具写入的自由文本，带换行完全可能。

**修法建议**（两处都要改）：

1. 解析器兜底：段落分支前加 `if (/^\|/.test(line)) { i += 1; continue }`；或段落循环后判 `if (para.length === 0) i += 1`。
2. 数据侧归一：`5842` / `5952` 的 `g.target` / `c.target` 过一遍 `oneLine()`。

只改一处不够 —— 解析器是通用渲染器（`MarkdownDoc` 同时渲染 `scoreReport.markdown` 与 `reportV2.markdown`），任何来源的正文都能触发。

### R-15【中】拖拽时每次 pointermove 重跑整张图布局

**位置**：`client.js:9036-9042`（`buildItems()` + `sessionGraphLayout(items)` + `sessionGraphApplyPositions(...)` 全部裸写在渲染体里，无 `useMemo`）、`9064-9076`（`onMove` 里 `setPositions`）。

**后果**：每次 `pointermove` → `setPositions` → 重渲染 → `buildItems()` 重建数组（新引用）→ 布局全量重算（`place()` 递归 + 重建所有边，节点上限 300）→ 再 `sessionGraphApplyPositions` 把边重算一遍。300 节点时每个 move 事件做 300 次 `place` + 300 条边重建 + 600 次 `Map.get`，pointermove 频率可达 60-120Hz，拖拽明显掉帧、CPU 飙高。同时 `items` 每次是新数组，任何基于引用相等的 memo 都失效。

**修法建议**：`const items = useMemo(buildItems, [data])`；`const graph = useMemo(() => sessionGraphApplyPositions(sessionGraphLayout(items), positions), [items, positions])`；`onMove` 里用 `requestAnimationFrame` 合帧再 `setPositions`。

### R-16【中】`useEffect` 依赖漏 `sessionId`

**位置**：`client.js:9015`：`useEffect(() => { load(false) }, [refreshKey])`；`load` 在 `8997` 用了 `props.sessionId`（`api({ op:'sessionGraph', session: props.sessionId || '' })`）。

**后果**：切换会话（`sessionId` 变）但 `refreshKey` 没变时不会重新取数 → 图上的「本会话」高亮（`store-core.js:840-842` 由 `root_session` 算出）仍是旧会话；同时「把本会话绑到这个靶标」按钮（`client.js:9193`）用的还是 `props.sessionId` 的**当前**值 —— 渲染用的是旧数据、写操作是新会话，两边不一致。

**修法建议**：依赖改成 `[refreshKey, props.sessionId]`。

### R-24【低】指针捕获失败后拖拽状态粘住

**位置**：`client.js:9062`：`try { ev.currentTarget.setPointerCapture(ev.pointerId) } catch { /* 老浏览器没有指针捕获 */ }`，`onUp`（`9077-9082`）只挂在节点自己的 `onPointerUp` 上。

**后果**：没有指针捕获的环境里，指针在节点外抬起不会触发 `onUp`，`dragRef.current` 永不为 `null`；之后任意 `pointermove`（悬停在别的节点上）都会继续按 `drag.x + dx` 移动**上一个**被拖的节点，节点乱飞且无法停止，直到重新按下-抬起一次。

**修法建议**：`onPointerDown` 时在 `window` 上挂一次性的 `pointerup`/`pointercancel` 兜底复位 `dragRef`。

### 已核对：两份产物行为一致（无缺陷，逐函数比过）

把两份产物的方言归一（`h2(` → `h(`、`import_react2.default` → `React`、去掉行首缩进、合并空行）后，逐函数做**逐字比对**：

| 函数 | `client.js` | `lib/redteam/client.js` | 结果 |
|---|---|---|---|
| `mdParseBlocks` | 3394 | 1847 | 逐字相同（2173 字符） |
| `mdOutline` | 3470 | 1923 | 相同（212） |
| `MarkdownDoc` | 3472 | 1925 | 相同（3076） |
| `mdInline` | — | — | 相同（848） |
| `SessionMap` | 8976 | 4732 | 相同（8426） |
| `sessionGraphLayout` | 8883 | 4639 | 相同（2024） |
| `sessionGraphApplyPositions` | 8947 | 4703 | 相同（1019） |
| `smEdgePath` | 8868 | 4624 | 相同（222） |

`overlay/snippets/md-render.js` 与 `overlay/snippets/session-map.js` 里的同名函数也与两份产物一致。**没有发现 h→h2 / React→import_react2.default 转换漏改的地方**。R-01 因此在三份产物里同时存在 —— 修的时候三处都要改（源片段 + 构建产物），否则重新构建会把补丁冲掉。

### 已核对：空输入 / 只有分隔线 / 未闭合代码块（无缺陷）

实测（§8.2）：`''` → 0 块；`null` → 0 块；`'---\n---\n***'` → 3 个 `hr`；`'```js\nconst a=1\n'`（未闭合）→ 1 个 `code` 块且正常终止（`3407` 的 `i += 1` 越过末尾，`while` 条件为假退出）。`\r\n` 在 `3395` 被归一。4 万行输入解析耗时 7ms，`MarkdownDoc` 只渲染 `blocks.slice(0, limit)`（`3478`）+ `MD_CHUNK=400` 分页（`3537`），不会因为行数多而卡。

## 7. F. `overlay/snippets/*.js` 其它新增代码

### R-25【低】`evidenceLedger` 的 `total` 与 `unverified` 口径不一致

**位置**：`store-evidence-ops.js` → `store-core.js:899-935` 段（op `evidenceLedger`，`914` 建对象、`916` 取 `unverified`、`923` 取 `total`）。`out.total = all.length`，而 `all = ledger.list({ engagement_id: lid, limit: 500 })`；`out.unverified` 来自 `ledger.countUnverified(lid)`（独立的 COUNT 查询）。

**后果**：账本超过 500 条时，`total` 恒等于 500，而 `unverified` 可能是 800。面板同时显示「共 500 条 / 800 条未核实」—— 自相矛盾的数字，会让人以为面板算错了而忽略这条纪律。

**修法建议**：`total` 用 `COUNT(*)`；或返回 `truncated: all.length >= 500` 并让前端显示「500+」。

### R-26【低】`scopeCheckTarget` 静默忽略无法解析的授权范围条目

**位置**：`store-core.js:2322-2332`（源片段 `overlay/snippets/store-scope-probe.js:41-49`）。

```js
for (const cidr of scope) {
  const [base, bitsRaw] = String(cidr).split('/')
  const baseInt = ipToInt(base)
  if (baseInt === null) continue      // ← 静默跳过
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw)
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) continue   // ← 同样静默
}
return { status: 'out', scope, ip, target: raw }
```

**触发条件**：`engagement.yaml` 的 `scope_cidrs` 里写了域名（`example.com`）、区间（`10.0.0.1-10.0.0.20`）、或写错（`10.0.0.0/33`）。

**后果**：该条目被静默丢弃，函数继续用剩下的条目判断；全部条目都无效时返回 `status:'out'` —— 明明填了授权范围，结论却是「不在范围内」。用户看到的是「目标超出授权」，实际是「授权范围填错了」，两种情况的处置完全相反。

**修法建议**：收集被跳过的条目，返回值加 `ignored: [...]`；当 `scope.length > 0 && 有效条目 === 0` 时返回 `status:'unscoped'` 或专门的 `invalid_scope`。

## 8. 复现脚本

### 8.1 R-02：KEV meta 覆盖数据

```js
const fs = require('fs')
const dest = '/tmp/kev-feed'                                  // 模拟 req.dest，不以 .json 结尾
fs.writeFileSync(dest, JSON.stringify({ vulnerabilities: [{ cveID: 'CVE-1' }] }))
// store-core.js:2603 的那一行
fs.writeFileSync(dest.replace(/\.json$/, '.meta.json'), JSON.stringify({ count: 1 }))
console.log(fs.statSync(dest).size, fs.readFileSync(dest, 'utf8'))
```

实测输出：`11 {"count":1}` —— 数据被元数据覆盖，函数仍返回 `action:'updated'`。

### 8.2 R-01：`mdParseBlocks` 死循环

把 `client.js:3394-3466` 的函数体原样复制出来，加一个迭代计数器（上限 5000）后运行：

| 输入 | 结果 |
|---|---|
| `'\| 说明：这一行不是表格\n下一行是正文'` | **hang**（`i=0`，`blocks` 已达 5000 上限） |
| `'\| a \| b \|\n不是分隔行\n正文'` | **hang**（`i=0`） |
| `''` | 正常，0 块 |
| `null` | 正常，0 块 |
| `'---\n---\n***'` | 正常，3 块 |
| `'```js\nconst a=1\n'` | 正常，1 块 |
| `'a\r\nb'` | 正常，1 块 |
| 4 万行（每 7 行一个 `## h`） | 正常，7ms |

前两行即死循环证据：`i` 始终为 0，`blocks` 每轮 `push` 一个空块。

### 8.3 其余条目

R-03 / R-04 / R-05 / R-06 / R-07 / R-08 / R-09 / R-10 / R-13 / R-14 为确定性代码路径，按文中行号逐行可推，无需运行。R-15 / R-16 / R-24 为浏览器行为，判据是代码结构（无 `useMemo`、依赖数组缺项、`onUp` 只挂节点），不依赖时序。

## 9. 未验证 / 边界说明

1. **R-01 的端到端可达性**依赖 `cleanup_item.target` 或 `score_hit.target` 里出现 `\n|`。我没有构造真实库去跑一份完整报告 —— 判据是 `store-core.js:5842` / `5952` 未做 `oneLine()` 归一（同文件其它 30 余处表格单元格都做了），这条代码事实足以成立；解析器本身对任意输入死循环是独立缺陷，不依赖这条可达路径。
2. **R-10 的跨设备场景**未实测 `EXDEV`；判据是 `stage`（`this.root/intel`）与 `dest`（`$HOME/.local/nuclei-templates`）来自两个不同的配置源（`2418` 与 `2642`），是否同挂载点取决于部署。
3. **R-14 的并发迁移**未实测两个进程同时打开同一 `assets.db`；判据是 `ensure` 的 `catch` 吞掉 `SQLITE_BUSY` 后仍 `return true`（`606-607`）。
4. 本文件不涉及 `vendor/` 与上游 `safe` 的差异，那部分见 `docs/audit/AUDIT-SAFE.md`。
