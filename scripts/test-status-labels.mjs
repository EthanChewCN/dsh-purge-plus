#!/usr/bin/env node
// [dsh-purge-plus] 状态词条回归：三种「不适用」必须显示成三句不同的话。
//
// 为什么单独测：这是用户唯一肉眼可见的语义面。补丁详情里每一行都带一个状态胶囊，
// 如果两个不同状态印同一句话，用户就只能靠颜色猜——而颜色没有任何地方解释。
// 字符串断言（grep 到某个 key 存在）挡不住这种错：key 都在，只是**映射重了**。
//
// 做法：从构建产物里切出 statusLabel() 的真身，用假的 t() 跑真代码。
// 重写一份等价实现没有意义——重写的那份永远会过。

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 既能在仓库里跑（dist/build/package），也能在**已安装的包里**跑（脚本所在包的根）——
   发布包现在带 test-*.mjs，验收可以对已安装产物复跑（审计 B-5）。 */
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;
const CLIENT = path.join(PKG, "client.js");

let pass = 0;
let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log("  ✓ " + label); return }
  fail += 1;
  console.log("  ✗ " + label + (extra === undefined ? "" : "  ← " + JSON.stringify(extra)));
};
const section = (s) => console.log("\n" + s);

if (!fs.existsSync(CLIENT)) {
  console.error("✗ 找不到构建产物，先跑 node scripts/build.mjs");
  process.exit(1);
}
const src = fs.readFileSync(CLIENT, "utf8");

/* ── 0. 从产物里切出真函数 ─────────────────────────────────────── */
const head = "function statusLabel(st, t) {";
const at = src.indexOf(head);
if (at < 0) {
  console.error("✗ 产物里找不到 statusLabel()，宿主结构变了");
  process.exit(1);
}
const end = src.indexOf("\n}\n", at);
const fnSrc = src.slice(at, end + 2);
const statusLabel = new Function("return " + fnSrc)();
// 用 key 本身当译文：这样断言的是「映射到哪个词条」，不是文案写得好不好。
const t = (k) => k;

/* ── 1. 三种状态必须是三句不同的话 ─────────────────────────────── */
section("[1] na / skipped / missing_file 不再共用一句");
const na = statusLabel("na", t);
const skipped = statusLabel("skipped", t);
const missing = statusLabel("missing_file", t);
ok(na === "status.na", "na → status.na（本端不需要）", na);
ok(skipped === "status.skipped", "skipped → status.skipped（跳过）", skipped);
ok(missing === "status.missing_file", "missing_file → status.missing_file（缺目标文件）", missing);
ok(new Set([na, skipped, missing]).size === 3, "三者互不相同（这正是用户看不懂的那处）", [na, skipped, missing]);

/* ── 2. 顺带修掉的老碰撞：off 与 skipped ───────────────────────── */
section("[2] off 与 skipped 不再都叫「跳过」");
const off = statusLabel("off", t);
ok(off === "status.off", "off → status.off（已关闭）", off);
ok(off !== skipped, "off ≠ skipped", [off, skipped]);

/* ── 3. 其余状态不能被这次改动带歪 ─────────────────────────────── */
section("[3] 其余映射不变");
const table = [
  ["applied", "status.applied"], ["already", "status.applied"],
  ["pending", "status.pending"], ["unmatched", "status.unmatched"],
  ["partial", "status.partial"], ["drifted", "status.drifted"],
  ["disabled", "status.disabled"], ["unlocated", "status.unlocated"],
];
for (const [st, want] of table) ok(statusLabel(st, t) === want, st + " → " + want, statusLabel(st, t));
ok(statusLabel("", t) === "unknown", "空状态 → unknown（不静默返回空串）", statusLabel("", t));

/* ── 4. 词条真的存在，且中文是新的那句 ─────────────────────────── */
section("[4] 词条存在性（两份语言表都要有）");
const dec = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const dicts = [];
{
  // 语言表是 { ... } 字面量；直接按 "key": "value" 对全文件抓，中英各一份。
  const re = /"(status\.[a-z_]+)":\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(src))) dicts.push([m[1], dec(m[2])]);
}
const zhMissing = dicts.filter(([k, v]) => k === "status.missing_file" && v === "缺目标文件");
const enMissing = dicts.filter(([k, v]) => k === "status.missing_file" && v === "Target missing");
ok(zhMissing.length === 1, "中文表有 status.missing_file = 缺目标文件", zhMissing.length);
ok(enMissing.length === 1, "英文表有 status.missing_file = Target missing", enMissing.length);
ok(dicts.some(([k, v]) => k === "status.na" && v === "本端不需要"), "status.na 词条在（原来存在但没人用）");
ok(dicts.some(([k, v]) => k === "status.off" && v === "已关闭"), "status.off 词条在（原来存在但没人用）");

/* ── 5. #35 竖排三行的排版修复 ─────────────────────────────────── */
section("[5] 补丁明细首列不再把 #35 挤成三行");
const idRule = /\.dshpp-id \{\\n  font-family: var\(--dshpp-mono\);\\n  opacity: 0\.75;\\n  width: (\d+)px;\\n((?:.|\n)*?)\}/.exec(src);
ok(!!idRule, "找到 .dshpp-id 规则");
if (idRule) {
  const width = Number(idRule[1]);
  ok(width >= 56, `列宽 ${width}px 足够放下 "#35"（42px 时内容盒只剩 12px）`, width);
  ok(idRule[2].includes("white-space: nowrap"), "禁止断行");
  ok(idRule[2].includes("overflow-wrap: normal"), "抵消 td 上的 overflow-wrap:anywhere");
}
const narrow = /\.dshpp-page \.dshpp-table :is\(th, td\):first-child \{\\n    width: (\d+)px;/.exec(src);
ok(!!narrow, "找到窄屏容器查询里的首列宽度");
if (narrow) ok(Number(narrow[1]) >= 56, `窄屏首列 ${narrow[1]}px 也够（原来是 44px，会压回换行）`, narrow[1]);

/* ── 6. na 的 tone 必须与 applied 不同 ────────────────────────── */
section("[6] 「本端不需要」不再与「已生效」同色");
// 同样从产物里切真函数。statusKind() 决定胶囊的 is-* 类名，也就是颜色。
const kHead = "function statusKind(st) {";
const kAt = src.indexOf(kHead);
ok(kAt >= 0, "产物里找到 statusKind()");
let statusKind = null;
if (kAt >= 0) {
  const kEnd = src.indexOf("\n}\n", kAt);
  statusKind = new Function("return " + src.slice(kAt, kEnd + 2))();
}
if (statusKind) {
  ok(statusKind("na") === "na", "na → 独立 tone \"na\"（原来是 \"ok\"，与 applied 同色）", statusKind("na"));
  ok(statusKind("na") !== statusKind("applied"), "na ≠ applied：一个「无事可做」，一个「做完了」", [
    statusKind("na"), statusKind("applied"),
  ]);
  ok(statusKind("applied") === "ok", "applied 仍是绿（不能被顺手改掉）", statusKind("applied"));
  ok(statusKind("skipped") === "miss", "skipped 仍是灰", statusKind("skipped"));
  ok(statusKind("missing_file") === "miss", "missing_file 仍是灰", statusKind("missing_file"));
  ok(statusKind("drifted") === "bad", "drifted 仍是红", statusKind("drifted"));
  ok(statusKind("pending") === "wait", "pending 仍是黄", statusKind("pending"));
}
// 样式侧：is-na 必须是「灰 + 虚线」，且两份作用域都要有。
// 只加基础那份不够——页面那份给 is-ok/is-wait/is-bad 各自定了描边色，
// is-na 会退回 .dshpp-page .dshpp-pill 的**实线**灰，虚线就丢了。
const naBase = /\.dshpp-pill\.is-na \{\\n  color: var\(--dshpp-mute\);\\n  border-style: dashed;\\n\}/.exec(src);
const naPage = /\.dshpp-page \.dshpp-pill\.is-na \{\\n  color: var\(--dshpp-mute\);\\n  border-style: dashed;\\n\}/.exec(src);
ok(!!naBase, "基础样式有 .dshpp-pill.is-na（灰 + 虚线）");
ok(!!naPage, "页面作用域也有 .dshpp-page .dshpp-pill.is-na（否则退回实线）");
// 与四格指标那格用同一套语汇
ok(/\.dshpp-tile\.is-na \{\\n  border-style: dashed;\\n\}/.test(src), "与 .dshpp-tile.is-na 的虚线语汇一致");

/* ── 7. 面板内嵌那份产物不能落队 ───────────────────────────────── */
section("[7] 两份产物一致性");
const REDTEAM = path.join(PKG, "lib", "redteam", "client.js");
const rt = fs.readFileSync(REDTEAM, "utf8");
ok(!rt.includes("function statusLabel("), "补丁面板只存在于 client.js（演练台那份不该有，也不该被误改）");

/* ── 8. 「跳过」的原因不能借用「文件不在」 ─────────────────────── */
section("[8] skipped 与 missing_file 的**原因行**也必须分开");
// 胶囊文案分开还不够：每行下面还有一行小字（t("hint." + st)）。
// 这两句原来一模一样，都是「目标文件不在本安装里」——而 skipped 的成因里
// 根本没有「文件不存在」（文件在，只是没有可应用的锚点）。
// 用户看到 #35 写着「跳过」+「目标文件不在本安装里」，会以为这个包被拆过。
const hintRe = /"hint\.(skipped|missing_file)":\s*"((?:[^"\\]|\\.)*)"/g;
const hints = [];
let hm;
while ((hm = hintRe.exec(src))) hints.push([hm[1], dec(hm[2])]);
const hintOf = (k) => hints.filter(([n]) => n === k).map(([, v]) => v);
const hSkip = hintOf("skipped");
const hMiss = hintOf("missing_file");
ok(hSkip.length === 2, "hint.skipped 中英各一条", hSkip.length);
ok(hMiss.length === 2, "hint.missing_file 中英各一条", hMiss.length);
ok(hSkip.length === 2 && hMiss.length === 2 && hSkip[0] !== hMiss[0],
  "中文：skipped 的原因 ≠ missing_file 的原因", [hSkip[0], hMiss[0]]);
ok(hSkip.length === 2 && hMiss.length === 2 && hSkip[1] !== hMiss[1],
  "英文：skipped 的原因 ≠ missing_file 的原因", [hSkip[1], hMiss[1]]);
ok(hSkip[0] && !hSkip[0].includes("不在本安装"), "skipped 不再声称「目标文件不在本安装里」", hSkip[0]);
ok(hMiss[0] && hMiss[0].includes("不在本安装"), "missing_file 保留原话（这一条才是真的文件不在）", hMiss[0]);

/* ── 9. 状态列不再吞掉剩余宽度 ─────────────────────────────────── */
section("[9] 状态胶囊的列位置");
// 宽屏 table-layout 是 auto，状态列作为最后一列会吃掉全部剩余宽度：
// 760px 容器实测 246px 宽，胶囊 53~88px，右边空 158px。
const wide = /@container purge-page \(min-width: 641px\) \{([\s\S]*?)\n\}/.exec(src);
ok(!!wide, "存在 min-width: 641px 的容器查询（宽屏专修）");
if (wide) {
  const body = wide[1];
  const w = /:is\(th, td\):last-child \{\\n    width: (\d+)px;/.exec(body);
  ok(!!w, "宽屏给最后一列定了宽");
  if (w) {
    const px = Number(w[1]);
    ok(px >= 100 && px <= 160, `列宽 ${px}px 落在「放得下 88px 胶囊 + 两侧 15px」的合理区间`, px);
  }
  ok(/\.dshpp-pill \{\\n    white-space: nowrap;/.test(body), "胶囊在宽屏禁止换行（否则「缺目标文件」会折成两行）");
}
// 窄屏那条 88px 的规则必须仍在，且**在**宽屏规则之前——同特异性靠源序决胜，
// 顺序反了窄屏就会被 120px 覆盖，360px 屏幕上直接顶破容器。
const iNarrow = src.indexOf(".dshpp-page .dshpp-table :is(th, td):last-child {\\n    width: 88px;");
const iWide = src.indexOf("@container purge-page (min-width: 641px)");
ok(iNarrow >= 0, "窄屏 88px 规则仍在");
ok(iNarrow >= 0 && iWide >= 0 && iNarrow < iWide, "窄屏规则排在宽屏规则之前（否则被反盖）", [iNarrow, iWide]);

/* ── 10. 同效补丁不能被报成「没生效」 ──────────────────────────── */
section("[10] #35 与 #14 同效：#35 必须认得出 #14 写的标记");
// #14 把整个 approveEscalation 换成 return mode，于是 #35 要替换的那段
// switch 消失了 → silentWhenMissing → skipped。行为其实已经到位，
// 报成「跳过」是**假阴性**：用户会以为这条保护没上。
const PATCHES = path.join(PKG, "lib", "patches", "new-tools.mjs");
const patches = fs.readFileSync(PATCHES, "utf8");
const i35 = patches.indexOf("id: 35,");
const iMk = i35 < 0 ? -1 : patches.indexOf("markers:", i35);
// 不能用 indexOf("]") 找结尾：标记串本身就是 "[dsh-purge] ..."，第一个 ] 在字符串里。
ok(i35 >= 0 && iMk > i35, "产物里找到 #35 的 markers 数组");
if (i35 >= 0 && iMk > i35) {
  const block = patches.slice(i35, iMk + 320);
  const list = patches.slice(iMk, iMk + 320);
  ok(list.includes("[dsh-purge] escalation never rejected"), "保留原标记");
  ok(list.includes("[dsh-purge] escalation bypass: every escalation request is granted."),
    "收录 #14 写的同效标记", list.trim().slice(0, 140));
  ok(/markersAny:\s*true/.test(block), "markersAny: true（markers 默认要求全部命中，不给就永远 false）");
}
// 只查文本还不够：这段代码是**插进源码**的，一旦换行写成字面 \n，
// 整个 markers 段会被行注释吃掉——文本里看得见，运行时却不存在。
// 上一版就是这样：grep 全绿，patch.markers === undefined。
{
  const mod = await import(path.join(PATCHES.replace(/new-tools\.mjs$/, "index.mjs")));
  const p35 = mod.ALL_PATCHES.find((p) => String(p.id) === "35");
  ok(!!p35, "运行时能取到 #35");
  if (p35) {
    ok(Array.isArray(p35.markers) && p35.markers.length === 2,
      "运行时 patch.markers 真的是 2 条（不是被注释掉的文本）", p35.markers);
    ok(p35.markersAny === true, "运行时 patch.markersAny === true", p35.markersAny);
    const { patchApplied } = await import(path.join(PKG, "lib", "core", "shared.mjs"));
    const esc = "/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai/dsh-sandbox/lib/index.js";
    if (fs.existsSync(esc)) {
      const text = fs.readFileSync(esc, "utf8");
      if (text.includes("[dsh-purge] escalation bypass: every escalation request is granted.")) {
        ok(patchApplied(text, p35) === true,
          "对真宿主文件判定：#35 = applied（同效标记生效，不再假阴性）");
      } else {
        console.log("  · 跳过运行时判定：本机 escalation 文件里没有 #14 的标记");
      }
    } else {
      console.log("  · 跳过运行时判定：找不到 dsh-sandbox/lib/index.js");
    }
  }
}

/* ── 11. 状态胶囊在行内垂直居中 ───────────────────────────────── */
section("[11] 状态胶囊在行内垂直居中");
// 基础样式 .dshpp-table td 本来是 middle，但页面作用域那条 (th, td) 规则
// 把它改成了 top。单行行看不出来；三行行（中文名 / 英文标识 / 原因）里，
// 胶囊就贴在行顶，和整行的视觉中心差出一个胶囊的高度。
const baseTop =
  ".dshpp-page .dshpp-table td {\\n  text-align: left;\\n  padding: 7px 10px;" +
  "\\n  border-bottom: 1px solid var(--dshpp-line);\\n  vertical-align: top;";
ok(src.includes(baseTop), "前提仍在：页面作用域的 td 是 vertical-align: top");
const midRule = ".dshpp-page .dshpp-table td:last-child {\\n  vertical-align: middle;\\n}";
ok(src.includes(midRule), "状态列（最后一列）单独改回 middle");
// 整表改 middle 会把 #35 也拉到行中间——它该和标题首行对齐。
ok(
  !/\.dshpp-page \.dshpp-table td \{\\n(?:  [^\\n]*\\n)*?  vertical-align: middle;/.test(src),
  "没有把整张表改成 middle（首列 #35 必须留在行首行）"
);
ok(
  !/\.dshpp-page \.dshpp-table td:first-child \{\\n  vertical-align: middle;/.test(src),
  "首列没被改成 middle"
);
// 特异性：被覆盖的那条是 (0,2,1)，新规则必须更具体，否则换个文件顺序就失效。
const spec = (sel) =>
  (sel.match(/\.[\w-]+/g) || []).length * 100 + (sel.match(/:(?!:)[\w-]+/g) || []).length * 10;
ok(
  spec(".dshpp-page .dshpp-table td:last-child") > spec(".dshpp-page .dshpp-table td"),
  "新规则特异性高于被覆盖的 td 规则（不靠源序决胜）",
  [spec(".dshpp-page .dshpp-table td:last-child"), spec(".dshpp-page .dshpp-table td")]
);

/* ── 12. 分桶口径：顶部条与健康度卡片必须算出同一组数 ─────────── */
section("[12] 「本端不适用」与「跳过」分开计，两边分母一致");
// 用户截图：顶部条「85/87 · 6 条本机不适用」，健康度「85/85 全部就位 + 本端不适用 8」。
// 同一台机器两个数——因为顶部条走服务端 gatherState（na 只算 status==="na"），
// 健康度走客户端 patchGroupCounts，而它的 isNaRow() 把 skipped / missing_file
// 一起塞进了 na。于是「跳过 2」被伪装成「不需要」，缺口从界面上消失。
const grab = (name, next) => {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) return "";
  const j = src.indexOf("function " + next + "(", i + 1);
  return src.slice(i, j > 0 ? j : i + 2000);
};
const bucketSrc =
  grab("isNaRow", "isSkipRow") +
  grab("isSkipRow", "patchGroupCounts") +
  grab("patchGroupCounts", "tallyPatches") +
  grab("tallyPatches", "Tile");
const B = new Function(bucketSrc + "; return { isNaRow, isSkipRow, patchGroupCounts, tallyPatches };")();

ok(B.isNaRow({ st: "na" }) === true, "isNaRow 认 na");
ok(B.isNaRow({ st: "skipped" }) === false, "isNaRow 不再认 skipped（这正是原来的错）");
ok(B.isNaRow({ st: "missing_file" }) === false, "isNaRow 不再认 missing_file");
ok(B.isSkipRow({ st: "skipped" }) && B.isSkipRow({ st: "missing_file" }), "isSkipRow 认 skipped + missing_file");

// 用真实分布造一份行集：85 applied / 2 skipped / 6 na
const rows = [];
for (let i = 0; i < 85; i += 1) rows.push({ st: "applied" });
rows.push({ st: "skipped" }, { st: "skipped" });
for (let i = 0; i < 6; i += 1) rows.push({ st: "na" });
const c = B.patchGroupCounts(rows);
ok(c.applied === 85 && c.skipped === 2 && c.na === 6, "分桶正确", c);
ok(c.total === 93, "total = 93（全部补丁）", c.total);
ok(c.denom === 87, "分母 = total - na = 87（跳过留在分母里）", c.denom);
ok(
  c.applied + c.pending + c.off + c.skipped + c.na === c.total,
  "五桶相加 == total（可对账，不再有黑洞）",
  c
);
// 边界：只有 na 时分母为 0，不能被除
const onlyNa = B.patchGroupCounts([{ st: "na" }, { st: "na" }]);
ok(onlyNa.denom === 0, "全是 na 时分母为 0（渲染侧有 Math.max(denom,1) 兜底）", onlyNa);

// 顶部条用的服务端字段必须存在，且与客户端同口径
ok(src.includes("info?.patches_skipped"), "顶部条报出「跳过」条数（否则 85+6≠93）");
ok(
  !src.includes('\\u6761\\u672C\\u673A\\u4E0D\\u9002\\u7528'),
  "顶部条文案统一成「本端不适用」（原来一处「本机」一处「本端」）"
);

// 词条：zh / en 都要有，缺了会直接印出 key
for (const key of ["health.skipped", "health.hint.skipped", "health.verdict.skipped", "filter.skipped"]) {
  ok(src.includes('"' + key + '":'), "词条存在：" + key);
}
ok(
  (src.match(/"filter\.skipped":/g) || []).length === 2,
  "filter.skipped 中英各一条",
  (src.match(/"filter\.skipped":/g) || []).length
);
// 结论句：有跳过时不能说「全部就位」
ok(
  /counts\.pending\s*\?\s*t\("health\.verdict\.pending"[\s\S]{0,220}?counts\.skipped\s*\?\s*t\("health\.verdict\.skipped"/.test(src),
  "结论句按 pending → skipped → ok 的顺序降级"
);
ok(
  src.includes('var FILTERS = ["all", "pending", "off", "skipped", "na"];'),
  "过滤条有独立的「跳过」按钮"
);
// 样式：五格自适应 + 跳过格灰字 + 进度条跳过段
ok(
  src.includes(".dshpp-tiles {\\n  display: grid;\\n  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));"),
  "指标格改成 auto-fit（5 格不会被挤到第二行）"
);
ok(src.includes(".dshpp-tile.is-skip .dshpp-tile-v"), "跳过格用灰字");
ok(src.includes(".dshpp-bar .is-skip"), "进度条有跳过段");

/* ── 13. 分组默认展开由数据决定，不再写死某一组 ───────────────── */
section("[13] 补丁明细的默认展开不再硬编码「代码」组");
// 用户问：为什么一点进插件，「代码」这一块永远是展开的？
// 因为初值是 useState({ code: true }) —— 作者按偏好指定一组，其余全收。
// 而本机 93 条里「代码」54/54 全绿，真有未写入项的「提示词」(#76 跳过)
// 与「工具」(#80 跳过) 反而是收起的：默认视图正好展示最不需要看的一组。
// 连 isSkipRow 一起切进来：needsAttentionRow 调它，单独切出来会 ReferenceError
const A = new Function(
  grab("isSkipRow", "needsAttentionRow") +
  grab("needsAttentionRow", "patchGroupCounts") +
  "; return needsAttentionRow;"
)();

ok(A({ st: "pending" }) === true, "待应用 → 要展开");
ok(A({ st: "unmatched" }) === true, "未对上 → 要展开");
ok(A({ st: "drifted" }) === true, "锚点漂移 → 要展开");
ok(A({ st: "partial" }) === true, "部分命中 → 要展开");
ok(A({ st: "skipped" }) === true, "跳过 → 要展开（没落地就是没落地）");
ok(A({ st: "missing_file" }) === true, "缺目标文件 → 要展开");
ok(A({ st: "applied" }) === false, "已应用 → 收起");
ok(A({ st: "already" }) === false, "already → 收起");
ok(A({ st: "na" }) === false, "本端不需要 → 收起");
ok(A({ st: "disabled" }) === false, "可选关闭 → 收起（用户自己关的，不是问题）");

ok(!src.includes("useState({ code: true })"), "初值不再硬编码「代码组展开」");
ok(src.includes("const [open, setOpen] = useState(null);"), "初值为 null（跟随数据默认）");
ok(
  src.includes("if (rows.some((row) => needsAttentionRow(row))) autoOpen[key] = true;"),
  "默认展开由 needsAttentionRow 决定，不是常量表"
);
ok(src.includes("const base = prev || autoOpen;"), "第一次点击先复制默认状态（不会把别的自动展开组一起收掉）");
ok(src.includes("const expanded = !!effectiveOpen[key];"), "渲染读 effectiveOpen，不是裸 open");

// 端到端：按本机真实分布造行，走**真** LAYER_GROUP + **真** needsAttentionRow
const layerAt = src.indexOf("var LAYER_GROUP = {");
const layerEnd = src.indexOf("var GROUP_ORDER", layerAt);
const LAYER_GROUP = new Function(src.slice(layerAt, layerEnd) + "; return LAYER_GROUP;")();
const mk = (layer, n, st) => Array.from({ length: n }, () => ({ layer, st }));
const shaped = [
  ...mk("代码", 54, "applied"),
  ...mk("提示词", 24, "applied"), { layer: "提示词", st: "skipped" }, ...mk("提示词", 2, "na"),
  ...mk("工具", 4, "applied"), { layer: "工具", st: "skipped" }, ...mk("工具", 4, "na"),
  ...mk("0.1.5 兼容", 1, "applied"), ...mk("0.2.0 兼容", 2, "applied")
];
const grp = new Map();
for (const row of shaped) {
  const key = LAYER_GROUP[row.layer] || "code";
  if (!grp.has(key)) grp.set(key, []);
  grp.get(key).push(row);
}
const auto = {};
for (const [key, rs] of grp) if (rs.some((r) => A(r))) auto[key] = true;
ok(!auto.code, "「代码」54/54 全绿 → 默认收起（就是用户看到的那一组）", auto);
ok(auto.prompt === true, "「提示词」有 #76 跳过 → 默认展开");
ok(auto.tools === true, "「工具」有 #80 跳过 → 默认展开");
ok(!auto.compat && !auto.dsh20, "两个兼容组全绿 → 收起");

// 活体对账：宿主在跑就拿真数据比一次——这才是当初漏掉它的那条断言
const live = await (async () => {
  try {
    const res = await fetch("http://127.0.0.1:55439/dsh-purge/status", { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null }
})();
if (live && live.patch_status) {
  const liveRows = Object.keys(live.patch_status).map((id) => ({ st: live.patch_status[id] }));
  const lc = B.patchGroupCounts(liveRows);
  ok(
    lc.applied === live.patches_applied && lc.denom === live.patches_total && lc.na === live.patches_na,
    "客户端分桶 == 服务端计数（顶部条与卡片不会再打架）",
    { client: { applied: lc.applied, denom: lc.denom, na: lc.na }, server: { applied: live.patches_applied, denom: live.patches_total, na: live.patches_na } }
  );
  ok(
    lc.skipped === (live.patches_skipped ?? lc.skipped),
    "跳过条数两边一致",
    [lc.skipped, live.patches_skipped]
  );
  // 默认展开：用宿主返回的真 layer 再算一遍
  const liveLayerRows = (live.patch_rows || []).map((r) => ({ layer: r.layer, st: r.status }));
  if (liveLayerRows.length) {
    const g2 = new Map();
    for (const row of liveLayerRows) {
      const key = LAYER_GROUP[row.layer] || "code";
      if (!g2.has(key)) g2.set(key, []);
      g2.get(key).push(row);
    }
    const autoLive = {};
    for (const [key, rs] of g2) if (rs.some((r) => A(r))) autoLive[key] = true;
    ok(!autoLive.code, "活体：「代码」组没有未写入项，默认收起", autoLive);
    ok(autoLive.prompt === true && autoLive.tools === true, "活体：有跳过项的两组默认展开", autoLive);
  }
} else {
  console.log("  · 跳过活体对账：宿主没在跑或状态接口不可达");
}

console.log("\n" + (fail === 0 ? "全部通过" : "有失败") + `：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
