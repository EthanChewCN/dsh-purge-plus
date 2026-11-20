# P20 新增 UI 组件运行时审计（报告文档视图 / 会话关系图）

审计对象：`dsh-purge-plus` 1.7.20-plus.31 的两份构建产物
- 面板内嵌：`dist/build/package/client.js`（17,604 行，hyperscript 名 `h2`，hooks 走 `import_react2.default`）
- 独立窗口：`dist/build/package/lib/redteam/client.js`（6,132 行，`h` + `React`）
- 生成源（对照用）：`overlay/snippets/md-render.js`（199 行）、`session-map.js`（358 行）、`md-render.css`（30 行）、`session-map.css`（32 行）

本文件是唯一写入物。仓库源码、产物、宿主一律未改。

`git status` 里的 `overlay/*`、`scripts/*`、`docs/UI-GAP-SAFE.md` 改动**不是本审计产生的**；其中 `overlay/snippets/md-render.js` 在本次审计进行中（23:16）被外部改动过一次（加上了 H-1 的兜底），这一点在 §0.3 与 §2.3 单独说明。

---

## 0. 口径与方法

### 0.1 怎么验的

| 手法 | 用于 | 说明 |
|---|---|---|
| **切片直跑** | `mdParseBlocks` / `mdInline` / `mdOutline` / `sessionGraphLayout` / `sessionGraphApplyPositions` / `smEdgePath` | 按行号把函数从产物里切出来，`new Function` 注入 stub `h`/`h2`/`React`，跑真代码 |
| **组件直调** | `MarkdownDoc` / `SessionMap` | 手写 stub React（`useState`/`useMemo`/`useRef`/`useEffect` 槽位）+ stub `document`，直接调组件函数拿渲染树，再走树收集 `id`/`className`/`style`/事件处理器 |
| **真实 CSS 量 DOM** | 滚动与遮挡 | 从产物里 eval 出 54,545 字节的 `CSS` 常量，配同层级 DOM 骨架，在 Chrome（chrome-devtools MCP）里量 `getBoundingClientRect` / `scrollHeight` |
| **归一化文本比对** | 两份产物一致性 | 去掉缩进/注释、`h2(`→`h(`、`import_react2.default.`→`React.`、引号统一后逐行 diff |

### 0.2 没做到的

- 运行中的宿主（`127.0.0.1:55439`）**没有 `sessionGraph` 这个 op**（`{"ok":false,"error":"unknown op: sessionGraph"}`，`bootstrap` 返回 `engagements: []`）。装的是旧包、库是空的，所以本轮**没有活数据可比**，全部结论来自产物本身。
- 没有在真插件里点过（DOM 量测用的是与产物同层级的骨架 + 产物里的原样 CSS，不是真页面）。
- React 版本由宿主提供，产物里 `require("react")` 无版本约束；hook 行为按 React 18 语义推断。

### 0.3 两个审计快照（审计期间产物被外部重建过）

本次审计进行中，仓库被外部改动过一次：`overlay/snippets/md-render.js` 在 **23:16** 加上了死循环兜底，随后产物在 **23:18** 被重建。所以本文有两个快照：

| 快照 | 时间 | `client.js` / `lib/redteam/client.js` | 与本文件的关系 |
|---|---|---|---|
| **A** | 23:04 | 814 KB / 386 KB 之前的旧构建 | H-1 的实测样本 |
| **B** | **23:18** | 当前文件（17,604 / 6,132 行） | **本文所有 `文件:行号` 一律以快照 B 为准** |

| 源文件 | mtime | 与快照 B 的关系 |
|---|---|---|
| `overlay/snippets/md-render.js` | 23:16 | 兜底已进产物（`client.js:3457-3460` / `lib/redteam/client.js:1910-1913`）→ **H-1 在快照 B 已不复现** |
| `overlay/snippets/session-map.js` | 23:03 | 与产物归一化 diff = **0** |
| `overlay/snippets/md-render.css` / `session-map.css` | 22:58 / 22:57 | 与产物 CSS 逐行一致 → H-2 / H-3 是当前代码缺陷 |

**复核**：快照 B 上把本文所有脚本重跑了一遍 —— 真实报告 184 块、目录 22/22、500 标题 300 项不可达、3000 块首屏 405 元素、布局 722×3287.4 / 722×16117 / 722×47148、301 节点抛错、拖拽阈值 L1=3 算点击、两份产物归一化 diff 0 —— **数字全部不变**，只有 H-1 从「复现」变成「不复现」。

### 0.4 标记约定

`[实测]` = 跑出来/量出来的数字；`[静态]` = 读代码或 CSS 得出的结论（附 `文件:行号`）。

---

## 1. 结论摘要

| 编号 | 问题 | 严重度 | 证据 |
|---|---|---|---|
| ~~**H-1**~~ | `mdParseBlocks` 在「以 `\|` 开头但下一行不是分隔行」时**死循环**，面板主线程冻结 / 堆爆 —— **快照 A 命中，快照 B（23:18 重建）已修复** | 已修复 | 快照 A：实测 20 万次迭代原地打转、4 GB OOM；快照 B：返回 1 块 |
| **H-2** | 报告页（含新文档视图）**没有滚动容器**，`.rt-main.rt-r2` 是 `overflow:hidden`；「继续加载」按钮在可视区外 | **高** | 实测 clientH 371 / scrollH 1784，按钮 bottom 1875 > dock bottom 520 |
| **H-3** | 会话图在默认 620px 面板宽度下，**会话节点被详情栏盖住并被裁掉**，只有靶标节点可见 | **高** | 实测 pane 352px、节点 x 414–706、detail 从 x 376 起；需 ≥1100px 才不被遮 |
| **M-1** | 目录项对「未渲染的块」点击**静默无效**，不自动展开 | 中 | 500 标题 → 300 项点了没反应（首个 index 400） |
| **M-2** | >300 节点时整块 body（**含搜索框**）不渲染，文案却让人「用上面的搜索缩小范围」 | 中 | 实测 301 节点：input 数 0、`rt-sm-body` 不存在 |
| **M-3** | 表格不处理 `\|` 转义，单元格被拆开；真实报告已命中 | 中 | `AUDIT-BUGS.md` 里 4 列表头 / 5 列表体 |
| **M-4** | 拖拽无 `onPointerCancel`/`onPointerLeave`、不检查 `ev.buttons`：指针捕获失败或丢 pointerup 后**永久卡在拖拽态** | 中 | 实测 `buttons:0` 的 hover 仍把节点从 (390,40) 拖到 (590,240) |
| **M-5** | 点图上靶标只做 `setEng+loadSnapshot`，**不调 `activateEngagement`**；下拉框路径会调 → 两条路径行为不一致 | 中 | `client.js:9058` vs `lib/redteam/client.js:5999` |
| **M-6** | `mdInline` 不校验 href scheme，`javascript:` 直接进 `<a href>` | 中 | 实测 `[点我](javascript:location='//evil')` → `href="javascript:location='//evil'"` |
| L-1~L-10 | 见 §2.7 / §3.6 | 低 | — |

**两份产物行为不一致：0 处**（见 §4，归一化后逐行 diff 差异行 = 0）。

---

## 2. A · 报告文档视图

注入点：`client.js:3981-3982`（面板）/ `lib/redteam/client.js:2434-2435`（窗口）
```js
doc ? h2(MarkdownDoc, { text: mdText }) : h2('div', null, /* 卡片视图 */)
```

### 2.1 真实报告解析结果 [实测]

拿仓库里真实存在的 `docs/audit/AUDIT-BUGS.md`（695 行）跑：

```
panel blocks=184  {h:22, list:1, table:6, p:91, quote:1, hr:13, code:50}
win   blocks=184  {h:22, list:1, table:6, p:91, quote:1, hr:13, code:50}
两份产物解析结果一致: true
目录项 22，最后一个目录项 index=180 / blocks=184
```

前 12 块抽查（标题 / 表格 / 引用 / 分隔线 / 代码块 / 列表全部按预期切出）：

```
h1 dsh-purge-plus 运行时缺陷审计（静默失败专项）
list(ul) items=6
h2 摘要
table head=3 rows=4
p 按缺陷类型分布：
table head=3 rows=5
p （一条缺陷可同时归入多类，故本表列合计 > 10；缺陷总数以第一张表为准。）
quote 说明：本次运行的 redteam 库**确实为空**（`~/.dsh/redte…
hr
h2 H-1 · `pocGet` 对不存在的 POC 返回 `{ok:true}`（无数据、无错误）
p **严重度**：高 · **类型**：假成功 / 结果不对
p **复现命令**
```

行内（`mdInline`，`md-render.js:18`）[实测]：

| 输入 | 输出 |
|---|---|
| `**粗体**` | `<strong>粗体</strong>` |
| `` `code` `` | `<code class=rt-md-ic>code</code>` |
| `[文字](https://a.b/c?d=1)` | `<a href=… target=_blank rel=noreferrer>文字</a>` |
| `**a * b**` | 原样（`[^*]+` 不吃内部 `*`） |
| `**未闭合` / `` `未闭合 `` | 原样 |

### 2.2 表格边界 [实测]

| 场景 | 结果 | 判定 |
|---|---|---|
| `\|` 转义：`\| \`grep a \\\| wc -l\` \| 管道 \|` | `["\`grep a \\","wc -l\`","管道"]` —— 2 列表头下拆出 **3** 个单元格 | **缺陷 M-3** |
| 空单元格 `\| \| 2 \| \|` | `["","2",""]` | 正常 |
| 表体少一列（头 3 / 体 2） | `["1","2"]`，不补齐 | 低（少一个 `<td>`，右侧留空） |
| 表体多一列（头 2 / 体 3） | `["1","2","3"]`，多出一个 `<td>` | 低（表格多一列，挤压其它列） |
| 无前导竖线的 GFM 表（`a \| b` / `--- \| ---`） | 整块退化成 `p`（内容不丢，但不渲染成表） | 低 |
| 单列表 + 分隔行只写 `---`（无竖线） | **死循环**（见 H-1） | 高 |

**M-3 不是理论问题**：`AUDIT-BUGS.md` 里就有一张表被拆坏 —— 实测 `head=4 / rows=[4,5]`，源头是这行：

```
| `templateStats.total` | `14403` | `find nuclei-templates -name '*.yaml' -o -name '*.yml' \| wc -l` → `14403` | 一致（虚高 2…
```

根因：`md-render.js:81`
```js
const split = (t) => t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
```
`split('|')` 不看反斜杠。修法：`t.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))`。

### 2.3 H-1：`mdParseBlocks` 死循环（快照 A 命中；快照 B 已修复）

**复现**（把产物里的函数切出来，只加一个循环计数器，仓库代码不动）：

```
a) 只有一行表头（截断在表格行）   → 死循环: SPIN @ i=0 line="| a | b |"  累计循环次数 > 200001
b) 表头后跟非分隔行               → 死循环: SPIN @ i=0 line="| a | b |"  累计循环次数 > 200001
c) 表格缺分隔行（两行都是数据）   → 死循环: SPIN @ i=0 line="| a | b |"  累计循环次数 > 200001
d) 分隔行无竖线（单列表）         → 死循环: SPIN @ i=0 line="| a |"      累计循环次数 > 200001
e) 表格正常（对照）               → blocks=1  spin=1
```

不加计数器直接跑，node 进程 4 GB 堆耗尽后被 abort（`FATAL ERROR: Ineffective mark-compacts near heap limit`）。

**根因（快照 A 的产物）**：`client.js:3450-3456` / `lib/redteam/client.js:1903-1909`（对应源码 `md-render.js:108-114`）

```js
if (line.trim() === '') { i += 1; continue }
const para = []
while (i < lines.length && lines[i].trim() !== ''
  && !/^```/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !/^>\s?/.test(lines[i])
  && !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i]) && !/^\|/.test(lines[i])) {   // ← 这一条
  para.push(lines[i]); i += 1
}
blocks.push({ type: 'p', text: para.join('\n') })
```

走到这里时 `lines[i]` 一定不满足前面任何一个分支。`|` 开头的行只有在「下一行是分隔行」时才进表格分支（`:78`），否则掉进段落分支；而段落循环第一轮就被 `!/^\|/` 挡住 → `para` 为空、`i` 不动 → `while (i < lines.length)` 原地无限追加空 `p` 块。

**可达路径**（按现实度排序）：
1. 报告 markdown 被截断，最后一行落在表格行（任何长度上限/手工裁剪/拼接出错）；
2. 单元格值里带换行，且续行以 `|` 开头 —— 生成器有裸拼的地方：`store-core.js:5842`（`g.target` 未过 `oneLine`）、`:5941`、`:5952`、`:7325`、`:7330`（`a.host` / `c.host` / `c.username` 原样进单元格）；
3. 正文里出现一行以 `|` 开头的普通文本（例如证据原文里粘了一段 `| id | 回显 |`）。

一旦命中，`RtBoundary` 错误边界**接不住**（不是异常，是死循环），整个面板 tab 卡死。

**状态：快照 A 命中，快照 B 不复现。**

`overlay/snippets/md-render.js:115-118`（mtime **23:16**）已经有兜底：

```js
/* 兜底：任何没被上面分支接住、又进不了段落循环的行（典型：以 `|` 开头但下一行
   不是表格分隔行）在这里按单行段落处理。**必须保证 i 前进** —— 否则同一行会被
   无限重判，标签页直接卡死（实测过：CPU 100% 直到 OOM）。 */
if (para.length === 0) { para.push(lines[i]); i += 1 }
```

时间线：

| 时间 | 事件 |
|---|---|
| 23:04 | 快照 A 构建 —— 两份产物 `grep "para.length === 0"` **零命中**，`client.js:3450-3456` 是裸循环 → **死循环存在** |
| 23:05 | 本轮审计开始，在快照 A 上复现（上文 SPIN 输出 + OOM） |
| 23:16 | `overlay/snippets/md-render.js` 被外部改动，加入上述兜底 |
| 23:18 | 产物被重建 —— 快照 B：`client.js:3457-3460` / `lib/redteam/client.js:1910-1913` 有兜底 |

快照 B 上复核 [实测]：

```
mdParseBlocks('| a | b |')  →  [{type:'p', text:'| a | b |'}]    外层循环只跑 1 轮
mdParseBlocks('| a | b |\n普通文字') → 不再死循环
```

结论：**H-1 已在快照 B 修复，不需要再动代码**。保留这一节是因为：(a) 快照 A 的构建确实带着这个洞跑过一段时间；(b) 这类「解析器某条分支不推进 i」的 bug 容易复发，`para.length === 0` 这个兜底是必须长期保留的护栏 —— 建议在构建产物里加一条断言（`grep -c "para.length === 0" dist/build/package/client.js` 必须 ≥1），避免下次改动又把兜底弄丢。

**若还要再兜一层**：把 `!/^\|/` 这条改成「确认是表格行才拦」，或在函数入口对 `i` 做单调性断言。

### 2.4 H-2：文档视图没有滚动容器，「继续加载」按钮点不到

用产物里的原样 CSS + 同层级 DOM（dock 620×520，与 `clampRtGeom` 默认值一致，见 `client.js:9821`）在 Chrome 里量 [实测]：

```
report.dock      = {w:620, h:520, bottom:520}
report.body      = {h:371}                     ← .rt-body{flex:1;min-height:0}
report.main      = {h:371}                     ← .rt-main.rt-r2
mainScrollH=1784  mainClientH=371              ← 1413px 内容不可达
report.more      = {y:1832, bottom:1875}       ← 「继续加载」按钮
moreInsideDock = false
overflow 链:
  rt-md-doc   overflow=visible h=1679 scrollH=1679 clientH=1679
  rt-md-wrap  overflow=visible h=1679 scrollH=1679 clientH=1679
  rt-main rt-r2 overflow=hidden h=371 scrollH=1784 clientH=371   ← 只有它裁，且不给滚
  rt-body     overflow=visible h=371  scrollH=371  clientH=371
  rt-dock     overflow=visible h=520  scrollH=518  clientH=518
```

CSS 依据：
- `.rt-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}`（`client.js:442`）
- `.rt-r2{padding-bottom:24px}`（`client.js:319`）—— 只有这一条，**没有 `overflow`**
- `.rt-body{flex:1;min-height:0;display:flex;flex-direction:column}`（`client.js:439`）—— 也没有 `overflow`
- dock 高度被 `geom.h` 钉死（`client.js:10622`），默认 520、上限 640

结论：报告页（不只是文档视图，卡片视图同样）只能看到第一屏约 371px；**「继续加载 / 全部展开」按钮本身就在 1875px 处**，用户既滚不到也点不到 —— 分块渲染这套机制在当前容器里等于没用。

验证修法（只在页面里改，没动仓库）[实测]：

```
main.style.overflow='auto' 后： mainScrollH=1784, scrollable=true
scrollTop=99999 → scrollTop=1412，按钮 bottom 落回 dock 内 → moreVisible=true
```

嵌入式（`rt-embedded`）形态同理：`.rt-dock.rt-embedded{width:100%;height:100%}` 仍然是有界高度，链条一样。

**最小修法**：`.rt-main.rt-r2{overflow:auto}`（或把 `MarkdownDoc` 包进 `.rt-pane`，`.rt-pane` 已有 `overflow:auto`）。顺带给 `.rt-md-toc` 的 `position:sticky` 一个滚动容器，否则它也不生效。

### 2.5 分块与性能 [实测]

| 场景 | 数字 |
|---|---|
| 3000 块（3000 段） | 解析 1.60–1.87 ms（两次快照）；`MarkdownDoc` 返回 ~2.1 ms；**首屏只渲染 400 块 = 405 个元素**；按钮 `继续加载（还有 2600 块）` |
| 单块巨型表格 200 行 | 1 块，**2011 个元素**，1.9 ms |
| 单块巨型表格 1000 行 | 1 块，**10011 个元素**，5.5 ms |
| 单块巨型表格 2000 行 | 1 块，**20011 个元素**，8.8 ms |
| 目录计算（3000 块 / 1000 标题） | 0.36 ms |

`MD_CHUNK` 是按**块**切的（`md-render.js:140` `blocks.slice(0, limit)`），所以一张几千行的表格不受保护 —— 而四段式报告的「0.2 记录与计分对账 / 5.2 附录」正是这种长表。8.8 ms 只是 `createElement` 的成本，真 DOM 提交与布局会显著更贵。**L-10**。

### 2.6 M-1：目录跳转对未渲染的块静默失效 [实测]

500 个 `## 标题` + 500 段正文 → 1000 块：

```
blocks=1000  目录项=500  已渲染 id=200
目录里点了没反应的项数=300  首个不可达 index=400
点击 index=400 后 scrollIntoView 调用记录 = 无
```

**「目录里的 index 与渲染 id 是否一致」—— 逐字核对结论：一致。**

- 目录 index 来自 `mdOutline` 的**块下标**（`md-render.js:125-129`，`out.push({ index: i, ... })`）；
- 渲染 id 来自 `renderBlock(b, idx)` 的 `idx`（`:148-149`），而 `idx` 是 `shown.map(renderBlock)` 传进来的**`shown` 下标**；
- 因为 `shown = blocks.slice(0, limit)`（`:140`）**从 0 开始**，`shown` 下标 ≡ `blocks` 下标，两者目前重合。

实测印证：真实报告 184 块 / 22 个标题，`rt-md-b{index}` 22/22 全部命中；500 标题场景下 index 0–399 命中、400+ 全缺 —— 缺的正好是没渲染的部分。

所以这不是「下标错位」，而是「**目录列出了全部标题，正文只渲染了前 limit 块**」：`jump()`（`:141-147`）拿到 `null` 就静默返回。

风险提示：这个正确性依赖「`shown` 恒从 0 切」。若以后改成窗口式切片（`blocks.slice(limit-400, limit)`），id 会立刻错位。

**最小修法**：`jump()` 里先 `setLimit(Math.max(limit, index + 1))`，再在下一帧 `requestAnimationFrame` 里 scroll；或让 `outline` 只列 `index < limit` 的项并标注「（未展开）」。

### 2.7 其余 A 项

| 项 | 结论 | 级别 |
|---|---|---|
| 代码块未闭合（markdown 被截断） | 会吞掉后面**全部**内容：`# 标题` + 未闭合 ```` ```bash ```` + 后续 4 行 → 只剩 2 块，`code.text` = `"echo hi\n\| a \| b \|\n## 这不是标题\n尾巴"` [实测]。行为与 CommonMark 一致，但报告被截断时会把结论藏进代码块，建议在 EOF 处补一个闭合并标「（内容在此截断）」 | L-1 |
| 空 / 全空白 / null 文本 | 统一显示「这份报告还没有正文（先记一条得分）」[实测] | 正常 |
| 文档 ↔ 卡片切换 | `doc ? MarkdownDoc : div` 是**不同类型同位置**，React 会卸载重建 → `limit` / `openCode` 全部归零，每次切回都退回 400 块 [静态 `client.js:3981`]。不是 state 泄漏，是进度丢失 | L-4 |
| 报告内容变了（refreshKey 刷新） | 组件不重挂，`openCode` 按**块下标**存（`md-render.js:137`），不随 text 重置 → 新报告同下标的代码块直接显示「收起」[实测：报告A 展开第 1 块 → 切报告B 按钮仍是「收起」] | L-3 |
| 表格列数不齐 | 不补齐、不截断，直接交给浏览器（见 §2.2） | L-2 |

---

## 3. B · 会话关系图

注入点：`client.js:9406` / `lib/redteam/client.js:5117`
```js
h(SessionMap, { refreshKey, sessionId: props.sessionId, onPick: props.onPick })
```

### 3.1 布局坐标（纯函数，给数字）[实测]

| 场景 | 节点 | 边 | 画布 | x 范围 | y 范围 | 节点重叠对数 |
|---|---|---|---|---|---|---|
| 1 靶标 / 20 会话 | 21 | 20 | **722 × 3287.4** | 40..390 | 40..3042 | **0** |
| 5 靶标 / 100 会话 | 105 | 100 | **722 × 16117.0** | 40..390 | 40..15871.6 | **0** |
| 5 靶标 / 0 会话 | 5 | 0 | 600 × 1107 | 40 | 40..861.6 | 0 |
| 1 靶标 / 0 会话 | 1 | 0 | 600 × 360 | 40 | 40 | 0 |
| 3 靶标 / 297 会话 | 300 | 297 | **722 × 47148** | 40..390 | 40..46902.8 | 0 |
| 2 靶标 / 299 会话（301 节点） | — | — | 抛 `session-map-too-large` | — | — | — |

单靶标 20 会话的逐点坐标（前 6）：

```
ses:e0s0 x=390 y=40   ses:e0s1 x=390 y=198  ses:e0s2 x=390 y=356
ses:e0s3 x=390 y=514  ses:e0s4 x=390 y=672  ses:e0s5 x=390 y=830
```

**节点不重叠**（含 5 个靶标各自 20 会话、含悬空父节点当根、含 300 节点满额）。之前担心的 `row += 0.3`（`session-map.js:90`）会让根之间只隔 47.4px，实测不会：`row` 在放完最后一片叶子时已经 `+1`，再 `+0.3` 实际是 1.3 行 = 205.4px > 节点高 110。

悬空父节点（会话绑到已删除的靶标）→ 当根，`(40,40)` 与 `(40,245.4)`，不重叠，画布 600×490.8 [实测]。

### 3.2 H-3：默认面板宽度下会话节点根本看不见

用产物原样 CSS + 同层级 DOM 量 [实测]（dock 620×520）：

```
smbody  = {x:24, w:572}
pane    = {x:24, w:352}          ← .rt-sm-body 第一列 minmax(0,1.65fr)
graph   = {x:24, w:722, right:746}
detail  = {x:376, w:220, right:596}   ← 第二列 minmax(220px,.8fr)，有实底背景
nodeSes = {x:414, w:292, right:706}
nodeCoveredByDetail = true
clippedByBody       = true
```

按宽度扫（同一份 DOM 只改 dock 宽度）：

| dock 宽 | pane 宽 | detail 起点 x | 会话节点 x..right | 被 detail 盖住 | 被 body 裁 |
|---|---|---|---|---|---|
| 620（默认） | 352 | 376 | 414..706 | **是** | **是** |
| 800 | 506 | 530 | 414..706 | **是** | 否 |
| 1000 | 641 | 665 | 414..706 | **是** | 否 |
| 1100 | 708 | 732 | 414..706 | 否 | 否 |
| 1200（上限） | 776 | 800 | 414..706 | 否 | 否 |

嵌入式形态下宽度取宿主右栏宽度（通常比 620 还窄），只会更糟。

也就是说：**默认 620px 面板下，图上只能看到靶标节点（x 40..332），20 个会话节点全部落在详情栏背后并被 `.rt-sm-body{overflow:hidden}` 裁掉**；要看到会话，得把面板拖到 ≈1100px 以上（`clampRtGeom` 允许到 1200，`client.js:9824`）。而「会话关系图」的全部信息就在会话节点上。

CSS 依据：
- `.rt-sm-body{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(220px,.8fr);gap:0;border:…;overflow:hidden}`（`client.js:405`）
- `.rt-sm-graph-pane{position:relative;min-width:0;background:…}`（`client.js:406`）—— **没有 `overflow`**
- `.rt-sm-detail{…background:var(--dsw-alias-bg-l2)}`（`client.js:424`）—— 实底，盖住溢出的节点

**最小修法**：`.rt-sm-graph-pane{overflow:auto}` + 搜索框移出滚动区（sticky 或放在 pane 外），保留 292px 节点与 350px 层距；这样 722px 画布在 352px 视口里可横向滚动。另一种是把 `SM_LAYER_GAP` 与 `SM_NODE_W` 按容器宽度自适应（但节点文字会挤）。

### 3.3 300 节点上限的 UI：给了提示，但提示让你用一个不存在的控件 [实测]

301 节点（2 靶标 + 299 会话）时的渲染树：

```
错误文案: ['节点超过 300 个，图不再渲染（会把浏览器卡死）。用上面的搜索缩小范围。']
渲染出的 input 数: 0
有 rt-sm-body: false
有 rt-sm-node: 0
文案里提到「搜索」: true   但搜索框存在: false
```

原因：搜索框在 `.rt-sm-body` 里面（`session-map.js:273-276`），而整个 body 的渲染条件是 `!layoutErr && items.length > 0`（`:270`）。超限时 `sessionGraphLayout` 抛错 → `layoutErr` 非空 → body 连同搜索框一起不渲染。

而且就算搜索框在，它也**不能**缩小节点集：`hit()`（`session-map.js:200`）只决定 `is-dim`（`opacity:.35`），节点照旧全部渲染。所以这条提示是不可执行的。

**最小修法**：超限时不要整块不渲染 —— 渲染搜索框 + 前 300 个节点，并给「只显示前 N 个 / 按靶标折叠」两个动作；或把提示改成「节点过多，请在左侧切换靶标查看」这种真能执行的话。

### 3.4 拖拽：坐标换算准确，但状态机缺兜底

坐标换算 [实测]：`onDown` 记 `{x: node.x, y: node.y, startX: clientX, startY: clientY}`（`session-map.js:211`），`onMove` 用 `node.x + (clientX-startX)`（`session-map.js:218`）。拖动 (+60,+40) 后：

```
根节点 style: left 100px  top 159px     （原 40 / 119）
第一条边 后:  x1 = 392, y1 = 214
期望:         x1 = 100+292 = 392, y1 = 159+55 = 214
```

**边精确跟随**（`sessionGraphApplyPositions` 重算 `x1/y1/x2/y2`，`session-map.js:101-116`），画布按 `max(graph.width, maxX+W+40)` 长（`:120-124`）。

阈值 [实测]（`Math.abs(dx)+Math.abs(dy) < 4`）：

| 位移 | L1 | 结果 |
|---|---|---|
| (1,1) | 2 | 当成**点击** → `onPick('e0')` 切靶标 |
| (2,1) | 3 | 当成**点击** → 切靶标 |
| (2,2) | 4 | 当成拖拽 |
| (3,1) | 4 | 当成拖拽 |

→ 2~3px 的手抖仍会切靶标（L-7）。

**M-4：指针捕获失败 / 丢 pointerup 后卡死** [实测]

```
a.props.onPointerDown({clientX:0,clientY:0,pointerId:1,button:0,
                       currentTarget:{setPointerCapture:()=>{throw new Error('no capture')}}})
b.props.onPointerMove({clientX:200,clientY:200, buttons:0})   // 在【另一个】节点上移动，且没按键
→ a 的 style: left 590px top 240px      （从 390/40 被拖走了）
再移到第三个节点 → left 690px top 340px
```

三个原因叠在一起：
1. `dragRef` 是**组件级**的（`session-map.js:130`），`onMove` 挂在**每个**节点上（`session-map.js:291`），任何节点上的 pointermove 都会驱动同一个 `dragRef`；
2. `onMove` 不检查 `ev.buttons`，所以松开鼠标后 hover 仍在拖；
3. 节点上只有 `onPointerDown/Move/Up` 三个处理器 [实测 props keys]，**没有 `onPointerCancel` / `onPointerLeave`**；`setPointerCapture` 失败被 `try{}catch{}` 静默吞掉（`session-map.js:216`），指针离开节点后 `pointerup` 收不到 → `dragRef` 永远不清。

另外 `onDown` 只挡了 `button === 2`（右键），**中键也会开始拖** [实测：`button:1` 拖动后节点从 390/40 移到 490/140]。

**最小修法**：
- `onMove` 首行 `if (!ev.buttons) { dragRef.current = null; return }`；
- 把 `onPointerMove/onPointerUp/onPointerCancel` 挂到 `.rt-sm-graph` 容器上（容器级 pointer 事件 + 命中判断），或补 `onPointerCancel`/`onPointerLeave` 清 `dragRef`；
- `onDown` 改 `if (!ev || ev.button !== 0) return`。

### 3.5 选中节点被删 / 搜索误伤 / onPick 契约

| 检查 | 结论 |
|---|---|
| 选中会话后数据刷新把它删掉 | **不崩溃**。`selected = graph.nodes.find(...) || null`（`session-map.js:198`），渲染时 `selected === null` 走空态「点左侧节点看详情」，`is-selected` 节点数 0，`绑定时间` 行消失 [实测]。`selectedId` 保留但不产生副作用（同 id 节点回来会重新高亮） |
| 搜索 `is-dim` 是否误伤父节点 | **会**。搜 `s0-1` 时：命中的会话 `s0-1` 高亮，兄弟 `s0-0/s0-2` 变灰（合理），但**父节点「靶标 e0」也变灰**（`hit()` 只看 `node.label`/`node.engagement`，不看子节点是否命中，`:200`）[实测]。搜靶标名时反过来：靶标高亮、它的 3 个会话全灰 —— 树结构断掉。**L-5** |
| 点靶标节点时 `onPick` 传的是什么 | **engagement id**（`node.engagement`，`:203-209`），实测 `['e1']`，不带 `ses:` 前缀；点会话节点不调 `onPick`，只 `setSelectedId` [实测] |
| 与父组件 `AgentsTab.onPick` 契约是否一致 | **一致但缺一步**。父组件定义：`onPick: (id) => { if (!id) return; setEng(id); loadSnapshot(id) }`（`lib/redteam/client.js:5926` / `client.js:10518`），期望的就是 engagement **id**（下拉框 `value: x.id`，`lib/redteam/client.js:6003`）。但下拉框那条路径还多调了一次 `api({op:'activateEngagement', engagement:id})`（`lib/redteam/client.js:5999`，注释写「同步当前靶标：原生 skill 目录按它解析技能根」），**图上点靶标不会调** → 两条改同一个状态的路径行为不一致，原生技能根不跟随。**M-5** |

### 3.6 其余 B 项

| 项 | 结论 | 级别 |
|---|---|---|
| `.rt-sm-edge.orphan` 样式 | **不可达**。`edge.to` 恒为 `ses:*`（只有 session 有 parent，且 parent 恒为 `eng:*`），实测「存在 to 不以 ses: 开头的边: false」→ 虚线样式永远不出现 | L-6 |
| 拖拽位置持久化 | 只存在 `positions` state（`session-map.js:130`），无任何落盘调用；切页签时 `.rt-body` 的 `key: 'body-' + st.tab` 会重挂 → 布局回到自动排版。注释说「按靶标隔离，切靶标不串位」（`:4615`）成立（key 是 `eng:`/`ses:` 全 id），但用户会以为位置能记住 | L-8 |
| 拖到画布左上外 | `applyPositions` 刻意不做平移归一化（`session-map.js:117-119` 注释），节点被裁到视口外，只能再拖回来。注释里已声明为取舍 | 已知取舍 |
| NaN 坐标 | `isFinite(pos.x) && isFinite(pos.y)` 才采用，否则忽略 [实测] | 正常 |
| 空 positions / 未知 id | 原样返回同一对象；未知 id 不改变画布尺寸 [实测] | 正常 |
| 环 / 自环 / 重复 id / 数字 id | 分别抛 `session-graph-cycle`（自环也命中）、`duplicate-session-id`、`session-id-invalid` [实测] | 正常 |
| 首次加载未完成时的空态 | `data === null` 且 `busy === true` 时同时显示「读取中…」和「还没有会话绑定过靶标」—— 空态文案在真拿到数据前就出现 [静态 `session-map.js:266-269`] | L-9（文案误导） |
| 并发读 | 自动/手动两个 seq 槽（`:132-134`），手动刷新不会被自动刷新丢弃；`mine !== seq.current` 丢弃过期响应 [静态] | 正常（相对 safe 是改进） |

### 3.7 300 节点时拖拽的每帧成本 [实测]

```
300 节点：sessionGraphLayout + sessionGraphApplyPositions 单次 = 0.38 ms
```

布局本身不是瓶颈；瓶颈在 3.2 的画布尺寸（722×47148）与 3.1 的可见性。

---

## 4. 两份产物一致性（专项）

### 4.1 代码

归一化（去缩进/注释、`h2(`→`h(`、`import_react2.default.`→`React.`、引号统一）后逐行 diff：

```
MarkdownDoc 区  行数 182 182   差异行 0
SessionMap 区   行数 321 321   差异行 0
```

结论：**两份产物的这两个组件是同一份源码的两个 hyperscript 绑定，没有任何行为差异**。

实测侧证：
- 真实报告解析：`JSON.stringify(blocks)` 完全相同（184 块）；
- 目录：`mdOutline` 输出完全相同；
- 渲染树 tag 序列 / id 序列完全相同（`div,div,h3,table,thead,tr,th,th,tbody,tr,td,td,ul,li,li,blockquote,hr,div,div,span,div,button,pre,p,strong,code,a`）；
- `SessionMap` 渲染树 53 个 tag 逐个相同，节点坐标 style 完全相同；
- 布局/边路径：`JSON.stringify(layout)` 相同，`smEdgePath` 输出相同。

### 4.2 样式

| 项 | 面板 | 窗口 |
|---|---|---|
| CSS 常量 | `client.js:280` `const CSS = \``（54,545 字节） | `lib/redteam/client.js:23` |
| 注入方式 | `client.js:16053` `h("style",{"data-dsh-purge-drill":"1"}, __dshPurgeDrill.CSS)`（React 子节点） | `:6093-6095` `document.createElement('style')` + `textContent = CSS` + append |
| `rt-md-*` / `rt-sm-*` 规则文本 | 逐行 diff **完全一致**（`client.js:370-431` vs `lib/redteam/client.js:111-172`） | 同 |
| 类名集合 | 25 个 `rt-md-*` + 21 个 `rt-sm-*`，两份**完全相同** | 同 |

`rt-md-*` 25 个：`wrap doc toc tocitem lv1 lv3 h h1 h2 h3 h4 h5 h6 hr ic codebox codehead pre table list quote more p b`
`rt-sm-*` 21 个：`card head note ok busy body graph-pane search graph svg edge node node-title node-label node-sub node-wait detail detail-empty detail-title kv actions`

### 4.3 冲突

- 两个前缀在**本包内**没有第二处定义（每个选择器只出现一次；`rt-md-h1` 等只在 `client.js:380` 一处定义）[实测 grep]。
- 与既有 `rt-*` 无同名：`rt-md-*` / `rt-sm-*` 不与 `rt-main / rt-card / rt-pane / rt-toolbar / rt-tag / rt-r2-*` 撞名。
- 一处**潜在**冲突（非本轮引入）：MarkdownDoc 把 markdown 的 h1/h2/h3 映射成 `<h2>/<h3>/<h4>`（`md-render.js:151`），而 `.rt-card h4{margin:0 0 6px;font-size:13px}`（`client.js:480`）特异性 (0,1,1) 高于 `.rt-md-h3` (0,1,0)。当前 MarkdownDoc 不在 `.rt-card` 里，所以不发作；将来若把文档视图塞进卡片，标题字号会被卡片规则吃掉。
- `.rt-sm-edge.orphan` 是死样式（见 3.6 L-6）。

---

## 5. 确认无问题的检查项（证明真查过）

1. 两份产物 `MarkdownDoc` 区归一化 diff = 0 行差异。
2. 两份产物 `SessionMap` 区归一化 diff = 0 行差异。
3. 两份产物 `rt-md-*` / `rt-sm-*` CSS 规则逐行一致；类名集合一致（25 + 21）。
4. 真实报告 184 块解析，两份产物 `JSON.stringify` 相等。
5. 标题 / 表格 / 代码块 / 列表 / 引用 / 分隔线 / 行内粗体 / 行内代码 / 链接 9 类元素全部按预期产出（见 §2.1）。
6. 目录 id 与块下标一致：22/22 命中；且确认 `shown` 从 0 切片是这一致性的前提。
7. 空文本 / 全空白 / null 文本都走空态，不抛错。
8. `MD_CHUNK` 边界：399/400 无按钮；401 → 「还有 1 块」；800 → 「还有 400 块」；801 → 点一次后「还有 1 块」→ 全部展开后按钮消失。
9. 代码块折叠：5000 字符 → 首屏 4000 + `\n…（已折叠）`（共 4007），按钮「展开全部（5000 字符）」。
10. 3000 块不会一次性渲染：首屏 400 块 / 405 元素。
11. 布局重叠：1/20、5/100、5/0、300 节点四种规模重叠对数全为 0。
12. 布局容错：环、自环、重复 id、数字 id、悬空父节点 5 种坏数据行为符合注释声明。
13. 拖拽后边坐标精确跟随（x1=392 / y1=214 与期望一致）。
14. `applyPositions` 对空 Map、未知 id、NaN 坐标三种输入均安全。
15. 选中节点被删除不崩溃、不残留选中态。
16. `onPick` 传 engagement id，与 `AgentsTab` 契约一致（但缺 `activateEngagement`，见 M-5）。
17. 两份产物的 SessionMap 渲染树 53 个 tag 顺序一致、节点坐标一致。
18. 自动/手动刷新用两个独立 seq 槽，过期响应会被丢弃。
19. 300 节点整（`rows.length === 300`）不抛错；301 抛 `session-map-too-large`。
20. **快照 B（23:18 重建产物）复核**：上列 1–19 全部重跑，数字不变；仅 H-1 由「死循环」变为「返回 1 块」。
21. 产物里 `grep -c "para.length === 0"` = 1（`client.js:3460`）/ 1（`lib/redteam/client.js:1913`），兜底在。

---

## 6. 复现脚本

全部只读，不联网、不改仓库。放到 `/tmp` 下跑。

```js
// /tmp/harness.mjs —— 从产物里切函数，注入 stub
import fs from 'node:fs'
const ROOT = '/Users/wheming/Documents/dsh-purge-plus'
function sliceByMarkers(file, startMarker, endMarker) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  let s = lines.findIndex((l) => l.includes(startMarker))
  let e = lines.findIndex((l, i) => i > s && l.includes(endMarker))
  const body = lines.slice(s, e)
  while (body.length && body[body.length - 1].trim() !== '}') body.pop()
  return body.join('\n')
}
export function loadBuild(which) {
  const file = which === 'panel'
    ? ROOT + '/dist/build/package/client.js'
    : ROOT + '/dist/build/package/lib/redteam/client.js'
  const src = sliceByMarkers(file, 'const MD_CHUNK = 400', 'P6 态势首页') + '\n'
    + sliceByMarkers(file, 'const SM_NODE_W = 292', '「现在在等谁」') + '\n'
    + 'return {mdParseBlocks, mdInline, mdOutline, MarkdownDoc, SessionMap,'
    + ' sessionGraphLayout, sessionGraphApplyPositions, smEdgePath, SM_MAX_NODES};'
  const slots = []
  let cursor = 0
  const React = {
    useState(i) { const k = cursor++; if (!(k in slots)) slots[k] = typeof i === 'function' ? i() : i
      return [slots[k], (v) => { slots[k] = typeof v === 'function' ? v(slots[k]) : v }] },
    useMemo(f) { return f() },
    useRef(i) { const k = cursor++; if (!(k in slots)) slots[k] = { current: i }; return slots[k] },
    useEffect(f) { effects.push(f) },
  }
  const effects = []
  const h = (tag, props, ...kids) => ({ tag, props: props || {}, children: kids.flat(9) })
  const api = (req) => (globalThis.__API ? globalThis.__API(req) : Promise.resolve({ ok: true }))
  const fn = new Function('h', 'h2', 'React', 'import_react2', 'document', 'copyText', 'api', src)
  return { mod: fn(h, h, React, { default: React }, { getElementById: () => null }, () => {}, api),
           rt: { slots, effects, reset() { cursor = 0 } } }
}
```

```js
// H-1：死循环。只给【内存里的副本】插一个计数器，仓库文件不动。
// ⚠ 只在快照 A（23:04 的产物）上复现；快照 B（23:18）已有兜底，跑出来是 1 块。
//   要在快照 B 上复现，先把内存副本里的 `if (para.length === 0) ...` 一行删掉。
import fs from 'node:fs'
const FILE = '/Users/wheming/Documents/dsh-purge-plus/dist/build/package/client.js'
const all = fs.readFileSync(FILE, 'utf8').split('\n')
const s0 = all.findIndex((l) => l.includes('const MD_CHUNK = 400'))
const e0 = all.findIndex((l, i) => i > s0 && l.includes('P6 态势首页'))
const body = all.slice(s0, e0).join('\n')
const inst = body.replace('while (i < lines.length) {',
  'while (i < lines.length) { if (++globalThis.__SPIN > 200000) throw new Error("SPIN @ i=" + i);')
const mdParseBlocks = new Function('h', 'h2', 'React', 'import_react2', 'document', 'copyText', 'api',
  inst + '\nreturn mdParseBlocks;')(
  (t, p, ...c) => ({ t, p, c }), () => {}, {}, { default: {} }, { getElementById: () => null }, () => {}, () => {})
globalThis.__SPIN = 0
try { mdParseBlocks('| a | b |') } catch (e) { console.log(e.message, globalThis.__SPIN) }
// 输出：SPIN @ i=0 200001
// 不加计数器直接跑 mdParseBlocks('| a | b |') → 4GB 堆耗尽 FATAL ERROR
```

```js
// M-1：目录跳转不可达
const blocks = p.mod.mdParseBlocks(text)          // 500 个 ## 标题
const outline = p.mod.mdOutline(blocks)            // 500 项
// 渲染后收集 id，index >= 400 的 300 项无对应 id
```

```js
// B：布局数字
p.mod.sessionGraphLayout(items)   // 5 靶标 / 100 会话 → 722 × 16116.99
```

```js
// H-2 / H-3：DOM 量测。CSS 从产物里 eval 出来，DOM 层级照抄产物（见本轮 /tmp/p20/layout.html）
const src = fs.readFileSync(FILE, 'utf8')
const a = src.indexOf('const CSS = `')
const b = src.indexOf('`', a + 13)
const css = eval(src.slice(a + 12, b + 1))   // 54,545 字节
// 拼成 .rt-dock(620x520,flex column) > head/groups/tabs > .rt-body > .rt-main.rt-r2 > .rt-md-wrap + .rt-md-more
// 以及 .rt-main > .rt-pane > .rt-card.rt-sm-card > .rt-sm-body > (.rt-sm-graph-pane > .rt-sm-graph) + .rt-sm-detail
// 在 Chrome 里读 getBoundingClientRect / scrollHeight
```
（本轮实际用 chrome-devtools MCP 在 `file:///tmp/p20/layout.html` 上量，得到 §2.4 / §3.2 的数字。）

---

## 7. 建议的修复顺序

1. ~~**H-1**~~ 已由 23:18 的重建解决；**建议补一条构建断言**（产物里 `para.length === 0` 计数 ≥1），防止兜底再被改丢。
2. **H-2**（`.rt-r2{overflow:auto}`）—— 一行 CSS，直接让文档视图可用。
3. **H-3**（`.rt-sm-graph-pane{overflow:auto}`）—— 一行 CSS，让会话节点可见。
4. **M-2**（超限时保留搜索框 + 截断渲染）—— 让提示可执行。
5. **M-1**（jump 先扩 limit 再滚）/ **M-4**（拖拽兜底）/ **M-5**（统一切靶标入口）/ **M-3**（`\|` 转义）/ **M-6**（href 白名单）。
6. L 级按需。
