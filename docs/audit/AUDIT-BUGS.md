# dsh-purge-plus 运行时缺陷审计（静默失败专项）

- 审计对象：**运行中的** `dsh-purge-plus@1.7.20-plus.19`
  - 已安装包：`/Users/wheming/.dsh/profiles/desktop/node_modules/dsh-purge-plus/`
  - 运行中宿主：`http://127.0.0.1:55439`（pid 56293，启动于 2026-11-20 22:19:41，晚于模块 mtime 21:33:56 ⇒ **跑的就是磁盘上这份代码**）
- 审计方式：只读 HTTP 探针 + 只读源码分析 + 只读 SQLite/文件系统核对
- 未做：未改任何源码、未构建、未安装、未重启宿主、未调用任何会写库的 op
- 时间：2026-11-20

## 摘要

| 严重度 | 数量 | 编号 |
|---|---:|---|
| 高 | 1 | H-1 |
| 中 | 4 | M-1 ~ M-4 |
| 低 | 5 | L-1 ~ L-5 |
| **合计** | **10** | |

按缺陷类型分布：

| 类型 | 条数 | 编号 |
|---|---:|---|
| 假成功（`ok:true` 但结果不对） | 3 | H-1, M-1, M-2 |
| 空结果/空壳冒充正常 | 2 | M-2, M-3 |
| 被 `try/catch` 吞掉的异常 | 3 | M-1, M-4, L-2 |
| 写操作无靶标行为 | 0 | —（22 个写 op 全部正确拒绝，见 §确认无问题） |
| 返回结构不一致 | 3 | M-2, L-1, L-3 |

（一条缺陷可同时归入多类，故本表列合计 > 10；缺陷总数以第一张表为准。）

> 说明：本次运行的 redteam 库**确实为空**（`~/.dsh/redteam/engagements/` 0 个靶标，`knowledge.db` 的 `poc` 表 0 行），所以"库里有数据但接口返回 0 条"这一条只能在**全局数据集**上验证（技能库、模板库），见 M-3、L-1。

---

## H-1 · `pocGet` 对不存在的 POC 返回 `{ok:true}`（无数据、无错误）

**严重度**：高 · **类型**：假成功 / 结果不对

**复现命令**

```bash
curl -s -X POST http://127.0.0.1:55439/redteam/api \
  -H 'content-type: application/json' -d '{"op":"pocGet","id":99999}'
curl -s -X POST http://127.0.0.1:55439/redteam/api \
  -H 'content-type: application/json' -d '{"op":"pocGet","code":"CVE-2021-44228"}'
```

**实际输出**

```json
{"ok":true}
{"ok":true}
```

（两条都是这个。没有 `poc` 字段，没有 `error`，HTTP 200。）

对照组 —— 同一个库、同一类"按键取一条"的 op 都正确报错：

```bash
curl -s -X POST http://127.0.0.1:55439/redteam/api -H 'content-type: application/json' -d '{"op":"pocDelete","id":99999}'
# {"ok":false,"error":"poc not found: 99999"}

curl -s -X POST http://127.0.0.1:55439/redteam/api -H 'content-type: application/json' -d '{"op":"skillRead","name":"no-such-skill-xyz"}'
# {"ok":false,"error":"skill not found: no-such-skill-xyz"}
```

**期望输出**

```json
{"ok":false,"error":"poc not found: 99999"}
```

**根因**：`lib/redteam/store-core.js:1138` 把 `undefined` 摊进了 `ok:true`

```js
// store-core.js:1138
if (op === 'pocGet') return Object.assign({ ok: true }, store.getPoc(req.id !== undefined ? req.id : req.code))
```

`getPoc` 查不到时返回 `undefined`，`Object.assign({ok:true}, undefined)` 就是 `{ok:true}`：

```js
// store-core.js:6593-6601
getPoc(key) {
  const db = this.kb()
  const raw = String(key === undefined || key === null ? '' : key).trim()
  if (raw === '') return undefined
  ...
  if (row === undefined) return undefined      // ← 这里
```

而同一个类里另外三个方法是**抛错**的（`markPocUsed` :6620、`updatePoc` :6633、`deletePoc` :6672 都是 `if (row === undefined) return {ok:false,error:'poc not found: …'}` / `throw`）。`pocGet` 是唯一的例外。

**最小修法**：`getPoc` 查不到时抛 `new Error('poc not found: ' + raw)`，或把 :1138 改成显式判空返回 `{ok:false,error:'poc not found'}`。

---

## M-1 · `readAttackFile` 同类假成功；且读盘失败被吞成空字符串

**严重度**：中 · **类型**：假成功 / 吞异常

**复现命令**（静态等价路径；本机无靶标，见下方"为什么没跑通 live"）

```bash
# 无靶标时先被通用空壳接管（见 M-2）；有靶标但 file id 不存在时走的就是这条：
curl -s -X POST http://127.0.0.1:55439/redteam/api \
  -H 'content-type: application/json' \
  -d '{"op":"readAttackFile","engagement":"<已有靶标 id>","id":99999}'
```

**实际输出**（按代码推导，`store.readAttackFile` 返回 `undefined`）

```json
{"ok":true}
```

同一 op 在不存在的靶标上会正确报错，说明"不存在"这件事本来是被识别的：

```bash
curl -s -X POST http://127.0.0.1:55439/redteam/api -H 'content-type: application/json' \
  -d '{"op":"readAttackFile","engagement":"nope","id":"x"}'
# {"ok":false,"error":"engagement not found: nope"}
```

**期望输出**

```json
{"ok":false,"error":"attack file not found: 99999"}
```

**根因**：`lib/redteam/store-core.js:1226` + `:6314-6326`

```js
// store-core.js:1226
if (op === 'readAttackFile') return Object.assign({ ok: true }, store.readAttackFile(id, req.id))
```

```js
// store-core.js:6314-6326
readAttackFile(id, fileId) {
  const row = this.db(id).prepare('SELECT * FROM attack_file WHERE id = ?').get(Number(fileId))
  if (row === undefined) return undefined          // ← 行不存在 → 摊成 {ok:true}
  let content = ''
  try {
    const safe = assertPathWithin(row.path, [this.dirOf(id)])
    content = readFileSync(safe, 'utf8')
  } catch { content = '' }                          // ← 读盘失败（权限/文件被删/路径越界）吞成空串
```

**影响**：`lib/redteam/client.js:3025-3027` 的判据是 `if (r && r.ok) setDetail(r)`，随后渲染 `detail.content`。所以「文件不存在」和「文件读不出来」两种情况，面板都会**打开一个空白文件且不报错**，用户以为文件本来就是空的。

**为什么没跑通 live**：本机 `~/.dsh/redteam/engagements/` 为空，没有靶标可挂；创建一个靶标属于写操作，按本次纪律不调用。上表给的是 `readAttackFile` 的真实分支，且 `engagement:"nope"` 那条已实测证明"不存在"能被识别——只有"行不存在"这一支被吞掉。

**最小修法**：`if (row === undefined) throw new Error('attack file not found: ' + fileId)`；`catch` 分支把错误带出来（`content_error` 字段）而不是静默置空。

---

## M-2 · 无靶标时 31 个只读 op 全塌成同一个通用空壳，`ok:true` 但契约字段缺失

**严重度**：中 · **类型**：假成功 / 空壳冒充正常 / 返回结构不一致

**复现命令**

```bash
for op in snapshot asset graph attackGraph stats vulns sessions consoleDigest \
          shots shotData readAttackFile report scoreReport activeTests; do
  printf '%-16s ' "$op"
  curl -s -X POST http://127.0.0.1:55439/redteam/api \
    -H 'content-type: application/json' -d "{\"op\":\"$op\"}"
  echo
done
```

**实际输出**（全部 31 个只读 op 的返回体逐字相同）

```
snapshot         {"ok":true,"items":[],"total":0,"stats":null,"segments":[],"stages":[],"roles":[]}
asset            {"ok":true,"items":[],"total":0,"stats":null,"segments":[],"stages":[],"roles":[]}
graph            {"ok":true,"items":[],"total":0,"stats":null,"segments":[],"stages":[],"roles":[]}
attackGraph      {"ok":true,"items":[],"total":0,"stats":null,"segments":[],"stages":[],"roles":[]}
stats            {"ok":true,"items":[],"total":0,"stats":null,"segments":[],"stages":[],"roles":[]}
vulns            {"ok":true,"items":[],"total":0,"stats":null,"segments":[],"stages":[],"roles":[]}
sessions         {"ok":true,"items":[],"total":0,"stats":null,"segments":[],"stages":[],"roles":[]}
consoleDigest    {"ok":true,"items":[],"total":0,"stats":null,"segments":[],"stages":[],"roles":[]}
shots            {"ok":true,"items":[],"total":0,"stats":null,"segments":[],"stages":[],"roles":[]}
shotData         {"ok":true,"items":[],"total":0,"stats":null,"segments":[],"stages":[],"roles":[]}
readAttackFile   {"ok":true,"items":[],"total":0,"stats":null,"segments":[],"stages":[],"roles":[]}
report           {"ok":true,"items":[],"total":0,"stats":null,"segments":[],"stages":[],"roles":[]}
scoreReport      {"ok":true,"items":[],"total":0,"stats":null,"segments":[],"stages":[],"roles":[]}
activeTests      {"ok":true,"items":[],"total":0,"stats":null,"segments":[],"stages":[],"roles":[]}
```

（完整 32 个 op 的 `keys=` 逐行对照已实测，除 `prompts` 走独立分支外，其余 31 个 key 集合完全一致：`items,ok,roles,segments,stages,stats,total`。）

**期望输出**：每个 op 返回自己那份契约，或统一报"未选择靶标"

```json
{"ok":false,"error":"请先在顶部选择或创建一个靶标"}
```

理由：同一份代码里，**写** op 和靶标强相关的 op（`evidenceLedger`/`reportV2`/`assetCoverage`/`hostCoverage`/`dataProofs`）无靶标时就是正确报错的：

```bash
curl -s -X POST http://127.0.0.1:55439/redteam/api -H 'content-type: application/json' -d '{"op":"evidenceLedger"}'
# {"ok":false,"error":"请先在顶部选择或创建一个靶标"}
curl -s -X POST http://127.0.0.1:55439/redteam/api -H 'content-type: application/json' -d '{"op":"assetCoverage"}'
# {"ok":false,"error":"请先在顶部选择或创建一个靶标"}
```

**根因**：`lib/redteam/store-core.js:1170-1172`

```js
      // [dsh-purge-plus] 写操作用显式集合判（前缀正则漏了 shotAdd/shotDelete/
      // assetTest/resetPrompts）；未知 op 在兜底之前抛，不再伪装成空结果。
      if (WRITE_OPS.has(op)) return { ok: false, error: '请先在顶部选择或创建一个靶标' }
      if (!READ_OPS.has(op)) throw new Error(`unknown op: ${op}`)
      return { ok: true, items: [], total: 0, stats: null, segments: [], stages: [], roles: [] }
```

最后一行是**一份通用空壳**，但它被返回给 31 个形状各异的 op。逐条对不上：

| op | 真实分支的契约（`store-core.js:1174-1226`） | 空壳实际给的 |
|---|---|---|
| `asset` | `{ok, asset: store.getAsset(...)}` | 无 `asset` |
| `graph` / `attackGraph` | `{ok, nodes, edges, …}` | 无 `nodes` / `edges` |
| `sessions` | `{ok, …totals:{…}}` | 无 `totals` |
| `consoleDigest` | `{ok, sections:{…}}` | 无 `sections` |
| `shotData` | `{ok, base64, mime}` | 无 `base64` |
| `readAttackFile` | `{ok, content, …}` | 无 `content` |
| `report` / `scoreReport` | `{ok, …报告正文}` | 无正文 |
| `stats` / `vulnStats` / `testStats` | `{ok, stats: {...}}` | `stats: null` |

**影响（可达性要说清）**：面板侧大多数调用点有 `if (!eng) return` 守卫（如 `client.js:4062`、`:3929`），所以**从面板点不出来**；但 `/redteam/api` 是对外契约，CLI、第三方调用方、以及任何"先打 op 再看 ok"的调用者拿到的都是 `ok:true`，无法区分「没有靶标」和「有靶标但真的空」。典型后果：`client.js:2795` 的 `scoreReport` 判据是 `if ((!r.stages || r.stages.length===0) && (r.items||[]).length > 0)` —— 空壳给了 `stages:[]` + `items:[]`，直接落到 `setData(r)`，报告页显示"还没有可交付的成果"，而不是"未选择靶标"。`client.js:5204` 的 `consoleDigest` 判据 `r.sections` 同理：无靶标时红点永远不亮，且无任何提示。

**最小修法**：把这一行改成 `return { ok: false, error: '请先在顶部选择或创建一个靶标', items: [], total: 0 }`，只给真正以 `items` 为契约的 op 保留空壳。

---

## M-3 · 符号链接形态的技能被静默跳过（技能库恒为 0）

**严重度**：中 · **类型**：空结果冒充正常 / 吞异常

**复现命令**

```bash
# 1) 盘上确实有 6 个条目
ls -la /Users/wheming/.dsh/skills

# 2) 接口说 0 个
curl -s http://127.0.0.1:55439/dsh-purge/skills
curl -s -X POST http://127.0.0.1:55439/redteam/api \
  -H 'content-type: application/json' -d '{"op":"skillCatalog"}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("libraries:",d["libraries"])'
```

**实际输出**

```
$ ls -la /Users/wheming/.dsh/skills
lrwxr-xr-x  context-engineering-fundamentals -> /Users/wheming/.cc-switch/skills/context-engineering-fundamentals
lrwxr-xr-x  find-skills                        -> /Users/wheming/.cc-switch/skills/find-skills
lrwxr-xr-x  receiving-code-review              -> /Users/wheming/.cc-switch/skills/receiving-code-review
lrwxr-xr-x  reverse-engineer-anything          -> /Users/wheming/.cc-switch/skills/reverse-engineer-anything
lrwxr-xr-x  sharp-edges                        -> /Users/wheming/.cc-switch/skills/sharp-edges
lrwxr-xr-x  verification-before-completion     -> /Users/wheming/.cc-switch/skills/verification-before-completion
（6 个条目）

$ curl -s http://127.0.0.1:55439/dsh-purge/skills
{"ok":true,"skills_dir":"$DSH_HOME/skills","skills":[]}

$ skillCatalog → libraries: {'redteam': 23, 'official': 0}
```

Dirent 层面的证据（对同一个真实目录跑，只读）：

```bash
cd /Users/wheming/.dsh/skills && node -e '
const fs=require("fs");
for(const x of fs.readdirSync(".",{withFileTypes:true}))
  console.log(x.name.padEnd(38),"isDir="+x.isDirectory(),"isFile="+x.isFile(),"isSymlink="+x.isSymbolicLink());'
```

```
context-engineering-fundamentals       isDir=false isFile=false isSymlink=true
find-skills                            isDir=false isFile=false isSymlink=true
receiving-code-review                  isDir=false isFile=false isSymlink=true
reverse-engineer-anything              isDir=false isFile=false isSymlink=true
sharp-edges                            isDir=false isFile=false isSymlink=true
verification-before-completion         isDir=false isFile=false isSymlink=true
```

**期望输出**：符号链接指向的技能目录按目录处理（或至少出现在结果里、或明确报告"6 个条目因软链被跳过"）

**根因**：两处 `readdir(..., {withFileTypes:true})` 只认 `isDirectory()` / `isFile()`，**符号链接两者皆 false**，于是落到 `continue`

```js
// lib/skills.js:331-343（/dsh-purge/skills 用）
for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
  if (entry.name === ".system") continue;
  if (entry.isDirectory()) { ... continue; }
  if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "SKILL.md") continue;   // ← 软链从这里掉出去
```

```js
// lib/redteam/skill-availability.js:169-181（skillCatalog 的 official 库用）
for (const entry of entries) {
  if (!entry || entry.name === '.system' || entry.name.startsWith('.')) continue
  if (entry.isDirectory()) { ... }
  else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'SKILL.md') { ... }
  else { continue }        // ← 软链从这里掉出去
```

**补充说明（避免误判）**：本机这 6 个软链的**目标目录已不存在**（`/Users/wheming/.cc-switch/skills/` 整个不见了），所以"0 条"在当前数据上恰好与事实一致。但代码路径对**有效**软链同样会跳过——上面 Dirent 输出证明的是判定逻辑，不是目标是否存在。也就是说：用户用 `ln -s ~/dev/my-skill ~/.dsh/skills/my-skill` 这种常见方式装技能，接口会稳定报 0 条，且不报错。

**最小修法**：判定前先 `entry.isSymbolicLink()` 时改用 `statSync(join(dir, entry.name))` 取真实类型（或直接 `readdir` 不带 `withFileTypes` 后逐个 `statSync`）。

---

## M-4 · `deletePoc` 删盘失败被吞，仍报 `deleted:true`

**严重度**：中 · **类型**：吞异常 / 假成功

**复现命令**（静态等价路径；触发需要库里有 POC + 目录不可删，本机 `poc` 表 0 行）

```bash
curl -s -X POST http://127.0.0.1:55439/redteam/api \
  -H 'content-type: application/json' -d '{"op":"pocDelete","id":<已有 POC id>}'
```

**实际输出**（删盘失败时）

```json
{"ok":true,"id":7,"code":"CVE-2024-0001","deleted":true,"removed_files":0}
```

**期望输出**

```json
{"ok":true,"id":7,"deleted":true,"removed_files":0,"removed_error":"EACCES: permission denied, rmdir .../pocs/CVE-2024-0001"}
```

**根因**：`lib/redteam/store-core.js:6677-6685`

```js
    let removedFiles = 0
    try {
      const dir = join(this.pocsDirOf(), row.code)
      if (existsSync(dir) && dir.startsWith(this.pocsDirOf())) {
        removedFiles = readdirSync(dir).length
        removeTreeNoFollowSync(dir)
      }
    } catch { /* 忽略 */ }                                  // ← 删盘失败静默
    return { ok: true, id: row.id, code: row.code, deleted: true, removed_files: removedFiles }
```

**影响**：数据库行已删、磁盘目录还在，而返回值里 `removed_files: 0` 与"本来就没有落盘文件"**完全无法区分**。残留目录里通常就是 POC 正文（payload），属于"以为清干净了其实没清"。

**最小修法**：`catch (e) { removedError = String(e && e.message || e) }`，把 `removed_error` 放进返回体；`removed_files` 保留实际删掉的条数。

---

## L-1 · nuclei 模板索引把仓库自身的 `.github/` 文件当模板收录

**严重度**：低 · **类型**：结果不对 / 返回结构不一致

**复现命令**

```bash
curl -s -X POST http://127.0.0.1:55439/redteam/api \
  -H 'content-type: application/json' -d '{"op":"templateSearch","q":"github","limit":5}'
python3 - <<'EOF'
import json
d=json.load(open('/Users/wheming/.dsh/redteam/pocs/.nuclei-index.json'))
print('index items:',len(d['items']))
print('.github entries:',sum(1 for i in d['items'] if i[0].startswith('.github/')))
EOF
```

**实际输出**

```json
{"ok":true,"dir":"/Users/wheming/.dsh/redteam/toolkit/nuclei-templates",
 "total":14403,"matched":48,"offset":0,
 "items":[
   {"path":".github/ISSUE_TEMPLATE/config.yml","name":"","severity":"","tags":""},
   {"path":".github/ISSUE_TEMPLATE/enhancement.yml","name":"Enhancement Request","severity":"","tags":""},
   {"path":".github/ISSUE_TEMPLATE/false-negative.yml","name":"False Negative","severity":"","tags":""},
   {"path":".github/ISSUE_TEMPLATE/false-positive.yml","name":"False Positive","severity":"","tags":""},
   {"path":".github/ISSUE_TEMPLATE/template-contribution.yml","name":"Template Contribution","severity":"","tags":""}
 ]}
```

```
index items: 14403
.github entries: 21
```

**期望输出**：`total: 14382`，检索结果里不出现 `.github/**`（仓库 CI / issue 模板，不是 nuclei 模板）

**根因**：`lib/redteam/store-core.js:6369-6386` 的 `walk()` 只按扩展名收文件，不校验是不是模板

```js
        if (!/\.ya?ml$/i.test(e.name)) continue
        let head = ''
        try { head = readFileSync(join(base, next), 'utf8').slice(0, 2000) } catch { continue }
        const pick = (re) => { const m = re.exec(head); return m === null ? '' : String(m[1]).trim().replace(/^["']|["']$/g, '') }
        items.push([ next, pick(/^\s*name:\s*(.+)$/m), pick(/^\s*severity:\s*(.+)$/m), pick(/^\s*tags:\s*(.+)$/m) ])
```

真正的 nuclei 模板必有顶层 `id:`；这 21 个条目 `severity` 全为空串——空 severity 就是"这不是模板"的现成信号，但没被用来过滤。

**影响**：智能体"先查本机现成的 POC"时会拿到 `.github/workflows/ci.yml` 当命中，属于假命中；`templateStats.total` 也虚高 21。

**最小修法**：`walk()` 里加 `if (!/^\s*id:\s*\S+/m.test(head)) continue`（或在 `#nucleiIndex` 末尾过滤 `severity === ''` 且无 `id` 的条目）。

---

## L-2 · `consoleDigest` 把 SQL 异常吞成 0，页签红点永不亮

**严重度**：低 · **类型**：吞异常

**复现命令**

```bash
curl -s -X POST http://127.0.0.1:55439/redteam/api \
  -H 'content-type: application/json' -d '{"op":"consoleDigest"}'
```

**实际输出**（无靶标时被 M-2 的空壳接管，这是同一份代码里最内层的行为）

```json
{"ok":true,"items":[],"total":0,"stats":null,"segments":[],"stages":[],"roles":[]}
```

**期望输出**：SQL 失败时 `sections` 里带上 `error`，而不是全 0

**根因**：`lib/redteam/store-core.js:2930-2935`

```js
    const count = (sql) => {
      try { return Number(db.prepare(sql).get()?.n ?? 0) || 0 } catch { return 0 }   // ← 表不存在/列改名 → 0
    }
    const at = (sql) => {
      try { return db.prepare(sql).get()?.t ?? null } catch { return null }          // ← 同上
    }
```

**影响**：schema 漂移（老库缺列、migration 没跑到）时，`consoleDigest` 返回"每个页签 0 条、无更新时间"，与"确实没有新内容"完全同形。`client.js:5205` 的判据是 `r.ok !== false && r.sections`，所以红点逻辑照常运行，只是永远不亮——一个**只在数据库坏掉时才发作、且发作时表现为"一切正常"**的静默失败。

**最小修法**：`catch (e) { return { n: 0, error: String(e.message || e) } }`，把错误汇总进 `sections.errors`。

---

## L-3 · `intelStatus` 的 `stale_count` 与 `resources[].stale` 自相矛盾

**严重度**：低 · **类型**：返回结构不一致

**复现命令**

```bash
curl -s -X POST http://127.0.0.1:55439/redteam/api \
  -H 'content-type: application/json' -d '{"op":"intelStatus"}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin);
print("stale_count:",d["stale_count"],"missing_count:",d["missing_count"]);
print("resources marked stale:",sum(1 for r in d["resources"] if r["stale"]),"of",len(d["resources"]))'
```

**实际输出**

```
stale_count: 0 missing_count: 3
resources marked stale: 3 of 3
```

**期望输出**：`stale_count` 与 `resources[].stale` 一致（要么 `stale_count: 3`，要么缺资源的 `stale` 置 `false`）

**根因**：`lib/redteam/store-core.js:2386-2409`

```js
      if (found === null) {
        missingCount += 1
        out.push({ ..., stale: true, missing: true })     // ← 缺资源也标 stale:true
        continue                                          // ← 但不 staleCount += 1
      }
      ...
      if (stale) staleCount += 1
```

**影响**：任何"自己数数组"的调用方（`resources.filter(r => r.stale).length`）得 3，读 `stale_count` 得 0。当前面板先看 `missing_count`（=3）所以颜色正确，但这属于**两个口径对不上**，换个消费方就会显示"资源新鲜"。

**最小修法**：缺资源分支里也 `staleCount += 1`，或把缺资源条目的 `stale` 置 `false`（只留 `missing: true`）。

---

## L-4 · `{"op":null}` 把原始 JS 异常文本当 400 返回

**严重度**：低 · **类型**：吞异常（反向：不该外泄的异常外泄了）

**复现命令**

```bash
curl -s -X POST http://127.0.0.1:55439/redteam/api \
  -H 'content-type: application/json' -d 'null'
```

**实际输出**

```
HTTP 400
{"ok":false,"error":"Cannot read properties of null (reading 'op')"}
```

**期望输出**

```json
{"ok":false,"error":"missing op"}
```

**根因**：`lib/redteam/ui.js:1116-1117` 只把空串兜成 `{}`，`null` 会一路传下去

```js
        const raw = await readBody(req)
        const request = raw.trim() ? JSON.parse(raw) : {}      // 'null' → JSON.parse → null
        const platformResult = handlePlatformOp(store, request)
```

`handlePlatformOp` 用 `request && request.op` 挡住了，但 `handleSkillOp`（`ui.js:690`）第一行就是 `request.op` → TypeError → 被 `:1152` 的 `catch` 转成 400 并把原始消息吐给调用方。

**影响**：非致命。但同一个入口对 `{"op":123}`、空 body 都正确回 `missing op`，只有 `null` 会漏出内部异常文本——错误契约不一致，且把 V8 的消息结构暴露给未认证的本地调用方。

**最小修法**：`const parsed = JSON.parse(raw); const request = (parsed && typeof parsed === 'object') ? parsed : {}`。

---

## L-5 · `/dsh-purge/selfcheck` 顶层 `ok:false` 但没有任何可执行项

**严重度**：低 · **类型**：状态语义不一致

**复现命令**

```bash
curl -s http://127.0.0.1:55439/dsh-purge/selfcheck | python3 -c '
import json,sys; d=json.load(sys.stdin)
print("ok:",d["ok"],"needsApply:",d["needsApply"])
print("broken:",d["summary"]["broken"],"pending:",d["summary"]["pending"])
for L in d["layers"]:
    if not L["ok"]: print("failing layer:",L["title"],"| state:",L["state"],"| note:",L["note"])'
```

**实际输出**

```
ok: False needsApply: False
broken: {'layers': 0} pending: {'layers': 0, 'patches': 0}
failing layer: 当前 profile 的权限选择 | state: inferred | note: 宿主当前推导为完全访问 / never；未显式固定，环境或设置变化可能改变结果。
```

**期望输出**：`ok:true` + 一条 `warning`（"inferred，未固定"），或 `ok:false` 且 `needsApply:true` 给出可点的动作

**根因**：`state: "inferred"` 被当成失败参与 `ok` 汇总。层对象见 `selfcheck` 返回的 `layers[].detail`：

```json
{"preset":"danger-full-access","sandbox":"danger-full-access","approval":"never",
 "source":"runtime:permissionPresets","pinned":false,"state":"inferred","ok":false,
 "note":"宿主当前推导为完全访问 / never；未显式固定，环境或设置变化可能改变结果。"}
```

**影响**：`broken.layers=0`、`pending=0`、`needsApply=false`，但整页报红。用户看到"自检未通过"却找不到任何要修的东西——这是"红绿灯坏了"型的噪声，会让人逐渐忽略真实告警。

**最小修法**：`inferred` 归入 `uncertain`（已有该分类）而不是计入 `ok:false`，或把 `ok` 改为三态 `ok|warn|fail`。

---

## 确认无问题的检查项

以下是本次真跑过、且**没有**发现缺陷的项，列出来是为了界定审计覆盖面。

### 1. 未知 op 不会假成功（对应任务清单第 1 条）

```bash
curl -s -X POST http://127.0.0.1:55439/redteam/api -H 'content-type: application/json' -d '{"op":"__nope__"}'
# {"ok":false,"error":"unknown op: __nope__"}
curl -s -X POST http://127.0.0.1:55439/redteam/api -H 'content-type: application/json' -d '{"op":"skills"}'
# {"ok":false,"error":"unknown op: skills"}
```

并且做了**穷举分类核对**：从 `dispatch()` 抽出全部 90 个 `op === '...'` 分支，与 `WRITE_OPS`(22) / `READ_OPS`(32) 求差集，**没有任何一个 op 会在无靶标时被误判成 `unknown op`**（唯一未分类的是 `probeSessions`，它在 `dispatchAsync` 里先被接管）。

### 2. 22 个写 op 在无靶标时全部正确拒绝，且不写库

```bash
for op in addVuln updateVuln addCredential addAccess addWebshell updateWebshell \
          shotAdd shotDelete addTunnel updateTunnel addHttpEvidence addChainStep \
          assetTest assessAsset saveScorePoint deleteScorePoint addScoreHit \
          saveStage addAttackFile import savePrompt resetPrompts; do
  curl -s -X POST http://127.0.0.1:55439/redteam/api -H 'content-type: application/json' -d "{\"op\":\"$op\"}"; echo
done
```

22 条全部返回 `{"ok":false,"error":"请先在顶部选择或创建一个靶标"}`，**零假成功**。写库副作用也做了验证：跑完 `ls -la ~/.dsh/redteam/engagements/` 仍为空。

### 3. 不存在的靶标 id 正确报错，且不会顺手建库

```bash
curl -s -X POST http://127.0.0.1:55439/redteam/api -H 'content-type: application/json' -d '{"op":"asset","engagement":"nope","id":1}'
# {"ok":false,"error":"engagement not found: nope"}
curl -s -X POST http://127.0.0.1:55439/redteam/api -H 'content-type: application/json' -d '{"op":"stats","engagement":"nope"}'
# {"ok":false,"error":"engagement not found: nope"}
ls -la ~/.dsh/redteam/engagements/     # 仍为空，没有多出 nope/ 目录
```

对应 `store-core.js:2788-2794`：`if (!existsSync(dbPathOf(id))) { if (options.create !== true) throw ... }` —— 先抛后建，顺序正确。

### 4. 请求入口的其余错误路径

| 输入 | 实际 |
|---|---|
| `-d '{bad json'` | `HTTP 400` `{"ok":false,"error":"Expected property name or '}' in JSON at position 1…"}` |
| `GET /redteam/api` | `HTTP 405` `{"ok":false,"error":"POST only"}` |
| 空 body | `{"ok":false,"error":"missing op"}` |
| `{"op":123}` | `{"ok":false,"error":"missing op"}` |

### 5. 按键取单条的其他 op 都正确报错（H-1 的对照组）

```bash
skillRead  "no-such-skill-xyz" → {"ok":false,"error":"skill not found: no-such-skill-xyz"}
pocDelete  99999               → {"ok":false,"error":"poc not found: 99999"}
```

代码侧另核：`readShot`（`store-core.js:6180`）、`deleteShot`（`:6165`）在行不存在时都是 `throw`，不是返回 `undefined`。

### 6. 空结果与真实行数对得上

| 接口 | 返回 | 独立复算 | 结论 |
|---|---|---|---|
| `pocStats.stats.total` | `0` | `sqlite3 knowledge.db "select count(*) from poc"` → `0` | 一致 |
| `pocList.items` | `[]` | `poc` 表 0 行 | 一致 |
| `templateStats.total` | `14403` | `find nuclei-templates -name '*.yaml' -o -name '*.yml' \| wc -l` → `14403` | 一致（虚高 21 见 L-1） |
| `bootstrap.engagements` | `[]` | `~/.dsh/redteam/engagements/` 空目录 | 一致 |
| `attention.total` | `0` | 无靶标，`note:"还没有靶标"` 已明示 | 一致（不算缺陷） |

### 7. 其余插件路由的返回与磁盘事实一致

| 路由 | 返回 | 磁盘核对 | 结论 |
|---|---|---|---|
| `/dsh-purge/rules` | `rules:[]` `active:null` | `~/.dsh/rules` 不存在 | 一致 |
| `/dsh-purge/audit` | 20 条，`failed` 全 0 | — | 无失败记录被掩盖 |
| `/dsh-purge/update` | `hasUpdate:false`，local `.19` / remote `.4` | semver 比较正确 | 一致 |
| `/dsh-purge/status` | `patches_applied:85` `pending:0` | `patch_status` 与 `patch_rows` 逐条对应 | 内部一致 |
| `/dsh-purge/community` | 版本/仓库/compatibility | 与 `package.json` 一致 | 一致 |
| `platformEnvAdaptStatus` | `ready:true` `found:0` `missing:15` | 用户已「暂不配置」，`reason:"skipped"` 明示 | 设计如此，非缺陷 |
| `platformConfigGet` | `envAdaptSkip:true` | `~/.dsh/redteam/config.json` 实际内容一致 | 一致 |

### 8. `intelStatus` 的 `missing_count` / `badge` 是对的

一开始用 `head -c 600` 截断输出，误以为 `missing_count` 缺失；完整取回后确认：

```json
{"resources":[…3 项全 missing…],"stale_count":0,"missing_count":3,"badge":"缺 3 项资源"}
```

`missing_count` 与 `badge` 均正确（`stale_count` 的问题单独记为 L-3）。

---

## 附：审计用的复现脚本

```bash
H=http://127.0.0.1:55439
api() { curl -s -X POST "$H/redteam/api" -H 'content-type: application/json' -d "$1"; }

# H-1
api '{"op":"pocGet","id":99999}'
# M-2：31 个只读 op 空壳
for op in snapshot assets asset graph attackGraph stats vulns vulnStats credentials access \
          sessions webshells tunnels shots shotData domains web httpEvidence chain report \
          scores scoreChain scoreReport activeTests testStats consoleDigest stages \
          reportTargets discoveryTimeline attackFiles readAttackFile; do
  printf '%-18s ' "$op"; api "{\"op\":\"$op\"}"; echo
done
# M-3
curl -s "$H/dsh-purge/skills"; ls -la ~/.dsh/skills
# L-1
api '{"op":"templateSearch","q":"github","limit":5}'
# L-3
api '{"op":"intelStatus"}'
# L-4
api 'null'
# L-5
curl -s "$H/dsh-purge/selfcheck"
```

---

*本次审计只写了这一个文件；未修改任何源码、未调用任何写操作、未重启宿主。*
