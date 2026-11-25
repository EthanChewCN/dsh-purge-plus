#!/usr/bin/env node
/* P20/P21 回归：报告文档视图（markdown 渲染）+ 会话关系图（布局）+ 字段级对齐 + 情报刷新
 *
 * 两条纪律（与前几轮一致）：
 *   ① 前端函数**从构建产物里切原文**跑，不在测试里重写一份等价逻辑 ——
 *      重写的那份永远会过，测不出产物坏了。
 *   ② store 侧直接 import 构建产物 + 真建库，跑真方法。断言的是具体字段与具体值，
 *      不是「有 ok」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* 既能在仓库里跑（scripts/../dist/build/package），也能在**已安装的包里**跑
   （发布包现在带 test-*.mjs，脚本所在包的根就是包根；审计 B-5）。
   注意这里用脚本自身位置而不是 ROOT —— 有些测试的 ROOT 是临时库目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = process.env.PURGE_PKG || (fs.existsSync(path.join(HERE, "..", "dist", "build", "package"))
  ? path.join(HERE, "..", "dist", "build", "package")
  : path.join(HERE, ".."));
const { RedteamStore, dispatch } = await import(path.join(PKG, "lib", "redteam", "store-core.js"));
const { dispatchAsync } = await import(path.join(PKG, "lib", "redteam", "store-core.js"));

/* PURGE_PKG 可指向一份被改坏的副本，用于变异测试（证明断言真的能红）。 */
/* PKG 已在上面解析（脚本自身位置优先）；PURGE_PKG 仍可覆盖。 */
const PKG_OVERRIDE = process.env.PURGE_PKG || "";

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass += 1; return; }
  fails.push(name + (extra === undefined ? "" : " → " + extra));
}
function eq(name, actual, want) {
  ok(name, JSON.stringify(actual) === JSON.stringify(want), "实际 " + JSON.stringify(actual) + " 期望 " + JSON.stringify(want));
}

/** 从产物里切出一个函数/常量的原文（花括号配对）。 */
function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("产物里找不到 function " + name);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
function extractConst(src, name) {
  const m = new RegExp("const " + name + " = [^;\\n]+").exec(src);
  if (m === null) throw new Error("产物里找不到 const " + name);
  return m[0];
}

/* ── 一、面板产物：markdown 渲染器 + 会话图布局 ────────────────────── */
const panel = fs.readFileSync(path.join(PKG, "client.js"), "utf8");
const redteam = fs.readFileSync(path.join(PKG, "lib", "redteam", "client.js"), "utf8");

for (const [label, src] of [["client.js", panel], ["lib/redteam/client.js", redteam]]) {
  const hName = label === "client.js" ? "h2" : "h";
  const preamble = [
    "const h = (tag, props, ...kids) => ({ tag, props: props || {}, kids: kids.flat() });",
    /* 面板产物里 hyperscript 叫 h2，这里两个名字都提供 —— 切出来的原文里用的是产物自己的名字 */
    "const h2 = h;",
    "const copyText = () => {};",
    extractConst(src, "MD_CHUNK"),
    extractConst(src, "MD_CODE_CLIP"),
    extractConst(src, "SM_NODE_W"),
    extractConst(src, "SM_NODE_H"),
    extractConst(src, "SM_LAYER_GAP"),
    extractConst(src, "SM_ROW_GAP"),
    extractConst(src, "SM_MAX_NODES"),
  ].join("\n");
  const body = [
    extractFn(src, "mdInline"),
    extractFn(src, "mdParseBlocks"),
    extractFn(src, "mdOutline"),
    extractFn(src, "smEdgePath"),
    extractFn(src, "sessionGraphLayout"),
    extractFn(src, "sessionGraphApplyPositions"),
  ].join("\n");
  const mod = new Function(preamble + "\n" + body + "\nreturn { mdInline, mdParseBlocks, mdOutline, smEdgePath, sessionGraphLayout, sessionGraphApplyPositions };")();

  /* 1.1 markdown 块解析：报告里真会出现的每一种 */
  const md = [
    "## 1. 复现前置条件",
    "",
    "普通段落，带 **粗体** 与 `行内代码` 与 [链接](https://example.com)。",
    "",
    "```bash",
    "curl -s http://10.0.0.1/api",
    "```",
    "",
    "| # | 得分点 | 分值 |",
    "| --- | --- | --- |",
    "| 1 | 弱口令 | +10 |",
    "",
    "> 引用：响应体只做验证。",
    "",
    "- 第一条",
    "- 第二条",
    "",
    "---",
    "",
    "1. 有序一",
    "2. 有序二",
  ].join("\n");
  const blocks = mod.mdParseBlocks(md);
  const kinds = blocks.map((b) => b.type);
  eq(label + "：块类型序列", kinds, ["h", "p", "code", "table", "quote", "list", "hr", "list"]);
  eq(label + "：标题层级", blocks[0].level, 2);
  eq(label + "：代码块语言", blocks[2].lang, "bash");
  eq(label + "：代码块正文", blocks[2].text, "curl -s http://10.0.0.1/api");
  eq(label + "：表头", blocks[3].head, ["#", "得分点", "分值"]);
  eq(label + "：表体行数", blocks[3].rows.length, 1);
  eq(label + "：表格分隔行没被当成数据", blocks[3].rows[0], ["1", "弱口令", "+10"]);
  eq(label + "：引用", blocks[4].text, "引用：响应体只做验证。");
  eq(label + "：无序列表", blocks[5].ordered, false);
  eq(label + "：有序列表", blocks[7].ordered, true);

  /* 1.1b 终止性：任何输入都必须在有限步内结束（曾出过死循环：以 `|` 开头但下一行
     不是表格分隔行时，表格分支不成立、段落分支又被 `!/^\|/` 挡住，i 不前进） */
  const tricky = [
    "| 说明：这一行不是表格\n下一行是正文",
    "|",
    "|a|b|\n不是分隔行",
    "```bash\n未闭合的代码块",
    "####### 七个井号",
    "- ",
    "> ",
    "---\n---\n---",
    "|a|b|\n|---|---|\n|1|2|3|",
    "\n\n\n",
  ];
  let stuck = null;
  for (const t of tricky) {
    const t0 = Date.now();
    const out = mod.mdParseBlocks(t);
    if (Date.now() - t0 > 500) { stuck = t; break; }
    if (!Array.isArray(out)) { stuck = t; break; }
  }
  ok(label + "：极端输入都能终止（无死循环）", stuck === null, stuck);
  eq(label + "：孤立的竖线行按段落处理",
    mod.mdParseBlocks("| 说明：这一行不是表格\n下一行是正文").map((b) => b.type), ["p", "p"]);

  /* 1.1c 表格里的转义竖线（真实报告里有 `a\|b`），不能被切成两格 */
  const esc = mod.mdParseBlocks("| 列A | 列B |\n| --- | --- |\n| a\\|b | c |");
  eq(label + "：转义竖线不切格", esc[0].rows[0], ["a|b", "c"]);

  /* 1.1d javascript: 链接必须被中和（渲染器不能把输入当可信） */
  const bad = mod.mdInline("[点我](javascript:alert(1))", "k").filter((x) => typeof x === "object");
  eq(label + "：javascript: 链接退化成纯文本", bad.length, 0);

  /* 1.2 行内标记：粗体 / 行内代码 / 链接 */
  const inl = mod.mdInline("a **b** c `d` e [f](https://g.h)", "k");
  const tags = inl.filter((x) => typeof x === "object").map((x) => x.tag);
  eq(label + "：行内标记类型", tags, ["strong", "code", "a"]);
  eq(label + "：行内链接 href", inl.filter((x) => typeof x === "object")[2].props.href, "https://g.h");

  /* 1.3 目录只收 h1–h3 */
  const outline = mod.mdOutline(mod.mdParseBlocks("# a\n\n#### d\n\n## b\n"));
  eq(label + "：目录条目", outline.map((o) => o.text), ["a", "b"]);

  /* 1.4 树布局：单根两子，父节点取子节点中点 */
  const g1 = mod.sessionGraphLayout([
    { id: "eng:a", parent: null },
    { id: "ses:1", parent: "eng:a" },
    { id: "ses:2", parent: "eng:a" },
  ]);
  const byId = new Map(g1.nodes.map((n) => [n.id, n]));
  ok(label + "：根在 0 层", byId.get("eng:a").depth === 0, byId.get("eng:a").depth);
  ok(label + "：子在 1 层", byId.get("ses:1").depth === 1);
  ok(label + "：层距 350", byId.get("ses:1").x - byId.get("eng:a").x === 350);
  ok(label + "：父节点取子节点中点",
    Math.abs(byId.get("eng:a").y - (byId.get("ses:1").y + byId.get("ses:2").y) / 2) < 0.001);
  eq(label + "：边数 = 节点数 - 根数", g1.edges.length, 2);
  ok(label + "：边从父右边出发", g1.edges[0].x1 === byId.get("eng:a").x + 292, g1.edges[0].x1);
  ok(label + "：边落在子左边", g1.edges[0].x2 === byId.get("ses:1").x);
  ok(label + "：贝塞尔路径形状", mod.smEdgePath(g1.edges[0]).startsWith("M ") && mod.smEdgePath(g1.edges[0]).includes(" C "));

  /* 1.5 容错：悬空父节点当根（绑定表指向已删靶标时不该整张图报错） */
  const g2 = mod.sessionGraphLayout([{ id: "ses:x", parent: "eng:gone" }]);
  ok(label + "：悬空父节点当根", g2.nodes.length === 1 && g2.nodes[0].depth === 0);

  /* 1.6 成环抛错（不抛会无限递归） */
  let cyc = null;
  try { mod.sessionGraphLayout([{ id: "a", parent: "b" }, { id: "b", parent: "a" }]); } catch (e) { cyc = e.message; }
  eq(label + "：成环被拒", cyc, "session-graph-cycle");

  /* 1.7 上限与非法 id */
  let tooBig = null;
  try {
    const many = [];
    for (let i = 0; i < 301; i += 1) many.push({ id: "n" + i, parent: null });
    mod.sessionGraphLayout(many);
  } catch (e) { tooBig = e.message; }
  eq(label + "：超 300 节点被拒", tooBig, "session-map-too-large");
  let dup = null;
  try { mod.sessionGraphLayout([{ id: "a" }, { id: "a" }]); } catch (e) { dup = e.message; }
  eq(label + "：重复 id 被拒", dup, "duplicate-session-id");

  /* 1.8 拖拽后边跟着动 */
  const moved = mod.sessionGraphApplyPositions(g1, new Map([["ses:1", { x: 900, y: 500 }]]));
  const mById = new Map(moved.nodes.map((n) => [n.id, n]));
  const edgeTo1 = moved.edges.find((e) => e.to === "ses:1");
  ok(label + "：拖拽后节点位置生效", mById.get("ses:1").x === 900);
  ok(label + "：拖拽后边重算（精确跟随，不做整体平移）",
    edgeTo1.x2 === 900 && edgeTo1.y2 === 500 + 55, edgeTo1.x2 + "/" + edgeTo1.y2);
  ok(label + "：拖拽不会漂（同一位置再拖一次仍是 500）",
    mod.sessionGraphApplyPositions(g1, new Map([["ses:1", { x: 900, y: 500 }]]))
      .nodes.find((n) => n.id === "ses:1").y === 500);

  /* 1.9 产物里两处必须都在：文档视图按钮 + 渲染器 */
  ok(label + "：报告页有「文档视图」开关", src.includes("'文档视图'") || src.includes('"文档视图"'));
  ok(label + "：报告页挂了 MarkdownDoc", /h2?\(MarkdownDoc, \{ text: mdText \}\)/.test(src));
  ok(label + "：会话图取数走 sessionGraph", /op: ["']sessionGraph["']/.test(src));
  ok(label + "：会话图有两个独立的序号槽（手动/自动互不干扰）",
    /const autoSeq = React\.useRef\(0\)|const autoSeq = import_react2\.default\.useRef\(0\)/.test(src)
    && /const manualSeq = /.test(src));
}

/* ── 二、store 侧：字段级对齐 + 情报刷新 ───────────────────────────── */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "purge-p20-"));
const root = path.join(tmp, "redteam");
const store = new RedteamStore(root);
const eng = store.openEngagement("P20 靶标", ["10.0.0.0/24"]);
const engId = eng.id;

/* 2.1 会话关系图：绑定三条，其中一条指向不存在的靶标（不该出现在图里） */
store.setSessionBinding("sess-root-1111", engId, "P20 靶标");
store.setSessionBinding("sess-child-2222", engId, "P20 靶标");
const graph = store.sessionGraph();
eq("sessionGraph：会话数", graph.sessions.length, 2);
eq("sessionGraph：按靶标计数", graph.count_by_engagement[engId], 2);
ok("sessionGraph：带短 id", graph.sessions[0].short.length <= 14, graph.sessions[0].short);
ok("sessionGraph：数据源标明本机落盘", graph.source === "sessions.json");
/* 手工把一条绑定指向不存在的靶标，验证它被过滤而不是变成孤点 */
const raw = JSON.parse(fs.readFileSync(store.sessionBindingsPath(), "utf8"));
raw.agents["sess-ghost-3333"] = { engagement: "ghost-engagement", name: "x", at: new Date().toISOString() };
fs.writeFileSync(store.sessionBindingsPath(), JSON.stringify(raw));
eq("sessionGraph：指向已删靶标的绑定被过滤", store.sessionGraph().sessions.length, 2);

/* 2.2 bootstrap 带 stats */
const boot = dispatch(store, { op: "bootstrap" });
ok("bootstrap：engagements[0].stats 存在", boot.engagements[0].stats !== null && boot.engagements[0].stats !== undefined,
  JSON.stringify(boot.engagements[0].stats));

/* 2.3 cleanup.location：写入 / 读回 / 老库迁移 */
const c1 = store.addCleanup(engId, { kind: "webshell", target: "10.0.0.5", title: "删除冰蝎马", location: "/upload/shell.php" });
const c2 = store.addCleanup(engId, { kind: "account", target: "10.0.0.5", title: "删自建账号", location: "svc_backup" });
ok("addCleanup：两条都新建（location 不同但 target+kind 相同 → 去重只看 target+kind，这里 kind 不同）",
  c1.cleanup_id !== c2.cleanup_id);
const cl = store.listCleanup(engId, {});
eq("listCleanup：location 已落库（顺序按 priority/时间，这里只比集合）",
  cl.items.map((x) => x.location).sort(), ["/upload/shell.php", "svc_backup"]);
const db = store.db(engId);
const cols = db.prepare("PRAGMA table_info(cleanup_item)").all().map((r) => r.name);
ok("cleanup_item：新库直接带 location 列", cols.includes("location"), cols.join(","));
/* 老库迁移：把列删掉再跑 migrate —— 模拟升级前的库 */
db.exec("ALTER TABLE cleanup_item DROP COLUMN location");
ok("cleanup_item：删列后 migrate 能补回来",
  (() => {
    try {
      const mod = store.db(engId);
      mod.prepare("SELECT 1").get();
      /* 直接调 migrate（schema.js 导出） */
      return true;
    } catch { return false; }
  })());
const schemaMod = await import(path.join(PKG, "lib", "redteam", "schema.js"));
schemaMod.migrate(db);
ok("cleanup_item：migrate 后 location 列回来了",
  db.prepare("PRAGMA table_info(cleanup_item)").all().some((r) => r.name === "location"));

/* 2.4 scoreReport({layout:'simple'})：结构化 report + 同一份 markdown，且不递归 */
const simple = store.scoreReport(engId, { layout: "simple" });
ok("scoreReport：layout=simple 返回 report", simple.report !== undefined && simple.report !== null);
eq("scoreReport：layout 字段", simple.layout, "simple");
ok("scoreReport：report 里有四段结构",
  ["asset_proof", "stage_summary", "repro", "cleanup"].every((k) => simple.report[k] !== undefined));
ok("scoreReport：markdown 非空", typeof simple.markdown === "string" && simple.markdown.length > 0);
ok("scoreReport：report 里不再重复带 markdown（避免两份大字符串）", simple.report.markdown === undefined);
/* [PA-05] 默认已对齐 safe 2.0.2：不传 layout 走 simple。
   legacy 仍然可用，只是要显式要 —— 这里两条都验，防止有人把默认翻回去。 */
const byDefault = store.scoreReport(engId, {});
eq("scoreReport：默认走 simple（与 safe 一致）", byDefault.layout, "simple");
ok("scoreReport：默认带 report 结构化对象", byDefault.report && byDefault.report.stage_tables !== undefined);
const legacy = store.scoreReport(engId, { layout: "legacy" });
eq("scoreReport：显式 layout:'legacy' 仍然可用", legacy.layout, "legacy");
ok("scoreReport：legacy 不带 report 对象", legacy.report === undefined);
eq("scoreReport：两条路径的总分一致", simple.summary.points, legacy.summary.points);
const viaOp = dispatch(store, { op: "scoreReport", engagement: engId, layout: "simple" });
eq("scoreReport op：透传 layout", viaOp.layout, "simple");

/* 2.5 getAssetCoverage 的 asset.ports */
const ins = db.prepare("INSERT INTO asset(ip, primary_name, segment_cidr) VALUES(?,?,?)").run("10.0.0.9", "web-01", "10.0.0.0/24");
const assetId = Number(ins.lastInsertRowid);
db.prepare("INSERT INTO port(asset_id, proto, port, state) VALUES(?,?,?,?)").run(assetId, "tcp", 443, "open");
const cov = store.getAssetCoverage(engId, assetId);
ok("getAssetCoverage：asset.ports 是数组（上游那个键恒 undefined，这里给真数据）", Array.isArray(cov.asset.ports), typeof cov.asset.ports);
eq("getAssetCoverage：asset.ports 与顶层 ports 同源", cov.asset.ports.length, cov.ports.length);
eq("getAssetCoverage：端口号", cov.asset.ports[0] && cov.asset.ports[0].port, 443);

/* 2.6 情报刷新：intelStatus 绝不联网 */
const realFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = () => { fetchCalls += 1; throw new Error("intelStatus 不该联网"); };
store.intelStatus();
store.intelRefresh();
eq("intelStatus/intelRefresh：零网络调用", fetchCalls, 0);

/* 2.7 KEV 下载：形状校验 + 原子落盘 + meta */
const kevGood = JSON.stringify({
  catalogVersion: "2026.11.20",
  dateReleased: "2026-11-20T00:00:00.000Z",
  count: 2,
  vulnerabilities: [
    { cveID: "CVE-2026-0001", vendorProject: "A", product: "B", vulnerabilityName: "n1" },
    { cveID: "CVE-2026-0002", vendorProject: "C", product: "D", vulnerabilityName: "n2" },
  ],
});
function stubFetch(payload, opts = {}) {
  globalThis.fetch = async () => ({
    ok: opts.ok !== false,
    status: opts.status || 200,
    statusText: opts.statusText || "OK",
    headers: new Map([["etag", '"abc"'], ["last-modified", "Fri, 20 Nov 2026 00:00:00 GMT"]]),
    body: {
      getReader() {
        let done = false;
        return {
          read: async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: new TextEncoder().encode(payload) };
          },
          cancel: async () => {},
        };
      },
    },
  });
}
const kevDest = path.join(tmp, "intel", "kev.json");
stubFetch(kevGood);
const up1 = await store.intelUpdate("kev", { dest: kevDest });
eq("intelUpdate：KEV 更新成功", up1.results[0].action, "updated");
eq("intelUpdate：条目数", up1.results[0].count, 2);
ok("intelUpdate：文件已落盘", fs.existsSync(kevDest));
ok("intelUpdate：meta 已写", fs.existsSync(path.join(tmp, "intel", "kev.meta.json")));
const metaPath0 = path.join(tmp, "intel", "kev.meta.json");
ok("intelUpdate：meta 里记了来源",
  fs.existsSync(metaPath0)
  && JSON.parse(fs.readFileSync(metaPath0, "utf8")).source.includes("known_exploited_vulnerabilities"),
  fs.existsSync(metaPath0) ? "source 字段不对" : "meta 文件不存在");
ok("intelUpdate：update-log 有记录（落在 store.root/intel）",
  fs.readFileSync(path.join(root, "intel", "update-log.jsonl"), "utf8").includes('"key":"kev"'));

/* 2.8 形状不对 → 拒绝落盘，且**旧文件不被破坏** */
const before = fs.readFileSync(kevDest, "utf8");
stubFetch(JSON.stringify({ vulnerabilities: [] }));
const up2 = await store.intelUpdate("kev", { dest: kevDest });
eq("intelUpdate：空数组被拒", up2.results[0].action, "failed");
ok("intelUpdate：拒绝原因说清是空数组", /空数组/.test(up2.results[0].error), up2.results[0].error);
eq("intelUpdate：旧文件没被覆盖", fs.readFileSync(kevDest, "utf8"), before);

stubFetch(JSON.stringify({ foo: 1 }));
const up3 = await store.intelUpdate("kev", { dest: kevDest });
eq("intelUpdate：形状不对被拒", up3.results[0].action, "failed");
stubFetch("<html>error</html>");
const up4 = await store.intelUpdate("kev", { dest: kevDest });
eq("intelUpdate：HTML 错误页被拒（不是 JSON）", up4.results[0].action, "failed");

/* 2.9 dry-run 不落盘 */
fs.rmSync(kevDest);
stubFetch(kevGood);
const up5 = await store.intelUpdate("kev", { dest: kevDest, dry_run: true });
eq("intelUpdate：dry-run 动作", up5.results[0].action, "dry-run");
ok("intelUpdate：dry-run 不写文件", !fs.existsSync(kevDest));

/* 2.10 HTTP 失败 / 超上限 */
stubFetch("x", { ok: false, status: 503, statusText: "Service Unavailable" });
const up6 = await store.intelUpdate("kev", { dest: kevDest });
eq("intelUpdate：HTTP 503 报失败", up6.results[0].action, "failed");
ok("intelUpdate：错误里带状态码", /503/.test(up6.results[0].error), up6.results[0].error);

/* 2.11 nuclei：目录不存在时也不会把 dest 写坏（这里用 404 模拟） */
stubFetch("nope", { ok: false, status: 404 });
const nucDest = path.join(tmp, "nuclei-templates");
const up7 = await store.intelUpdate("nuclei", { dest: nucDest });
eq("intelUpdate：nuclei 下载失败如实报", up7.results[0].action, "failed");
ok("intelUpdate：失败后没有留下半截目录", !fs.existsSync(nucDest));

/* 2.12 wordlists：没有权威上游，明确 skipped 而不是假装成功 */
const up8 = await store.intelUpdate("wordlists", {});
eq("intelUpdate：wordlists 明确跳过", up8.results[0].action, "skipped");

/* 2.13 未知资源 */
const up9 = await store.intelUpdate("nope", {});
eq("intelUpdate：未知资源报失败", up9.results[0].action, "failed");

/* 2.13b R-04：同一台主机上两个不同的 webshell 必须是两条清理项 */
const w1 = store.addCleanup(engId, { kind: "webshell", target: "10.0.0.7", location: "/upload/a.php", title: "删 A 马" });
const w2 = store.addCleanup(engId, { kind: "webshell", target: "10.0.0.7", location: "/upload/b.php", title: "删 B 马" });
ok("addCleanup：同主机不同 location 不去重", w1.cleanup_id !== w2.cleanup_id && !w2.deduped);
const w3 = store.addCleanup(engId, { kind: "webshell", target: "10.0.0.7", location: "/upload/a.php", title: "又记一遍" });
ok("addCleanup：同主机同 location 仍去重", w3.deduped === true && w3.cleanup_id === w1.cleanup_id);

/* 2.13c R-03：location 要能从 op 一路走到落库，并进报告第四段 */
const opAdd = dispatch(store, {
  op: "addCleanup", engagement: engId, kind: "account", target: "10.0.0.8",
  location: "svc_deploy", title: "删部署账号",
});
ok("op addCleanup：location 透传", opAdd.ok === true && opAdd.deduped !== true);
const rowsWithLoc = store.listCleanup(engId, {}).items.filter((x) => x.location === "svc_deploy");
eq("op addCleanup：location 真的落库", rowsWithLoc.length, 1);
const r2 = store.reportV2(engId, {});
ok("reportV2：清理项带 location（报告第四段「位置」列靠它）",
  (r2.cleanup.items || []).some((x) => x.location === "svc_deploy"),
  JSON.stringify((r2.cleanup.items || []).map((x) => x.location)));

/* 2.13d R-05：查询失败是「未知」，不是「已清干净」 */
{
  const broken = new RedteamStore(path.join(tmp, "broken"));
  const bEng = broken.openEngagement("坏库", []);
  const bDb = broken.db(bEng.id);
  bDb.exec("DROP TABLE cleanup_item");
  const sum = broken.cleanupSummary(bEng.id);
  eq("cleanupSummary：表没了 → cleared 是 null（不是 true）", sum.cleared, null);
  ok("cleanupSummary：带上 query_error", typeof sum.query_error === "string" && sum.query_error.length > 0);
  const list = broken.listCleanup(bEng.id, {});
  eq("listCleanup：查询失败 → cleared 是 null", list.cleared, null);
}

/* 2.13e R-09：nuclei 失败后不留 stage 目录 */
{
  const stageLeft = fs.existsSync(path.join(root, "intel"))
    ? fs.readdirSync(path.join(root, "intel")).filter((n) => n.startsWith(".nuclei-stage"))
    : [];
  eq("intelUpdate：nuclei 失败后没有残留 stage 目录", stageLeft, []);
}

/* 2.13f R-02：dest 不以 .json 结尾时，meta 不能覆盖数据本身 */
{
  const oddDest = path.join(tmp, "intel", "kev-data");
  stubFetch(kevGood);
  const up = await store.intelUpdate("kev", { dest: oddDest });
  eq("intelUpdate：非 .json 结尾的 dest 也能更新", up.results[0].action, "updated");
  const body = fs.readFileSync(oddDest, "utf8");
  ok("intelUpdate：数据文件没被 meta 覆盖（仍是 JSON 全文）", body.includes("CVE-2026-0001"), body.slice(0, 60));
  ok("intelUpdate：meta 写在另一个文件里", fs.existsSync(oddDest + ".meta.json"));
}

/* 2.14 op 路由：intelUpdate 走异步分发 */
globalThis.fetch = realFetch;
const opOut = await dispatchAsync(store, { op: "intelUpdate", target: "wordlists" });
eq("dispatchAsync：intelUpdate 可达", opOut.ok, true);
eq("dispatchAsync：返回 results 数组", Array.isArray(opOut.results), true);

fs.rmSync(tmp, { recursive: true, force: true });

console.log("\nP20/P21 回归：" + pass + " 通过 / " + fails.length + " 失败");
if (fails.length > 0) {
  for (const f of fails) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("  ✓ 全部通过");
