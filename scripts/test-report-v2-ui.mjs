#!/usr/bin/env node
// [dsh-purge-plus] P8/P12 界面渲染回归：四段式报告与证据条目**真的渲染出来**。
//
// 为什么不能只靠 verify 的字符串断言：那些断言只能证明代码里有「资产归属证明」
// 这几个字，证明不了「数据里少一个字段时组件不会抛异常」。
// 这里用真数据（store 生成的 reportV2）+ 记录型 h() 递归渲染一遍。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "plus-r2ui-"));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = fs.existsSync(path.join(HERE, "..", "dist", "build", "package"))
  ? path.join(HERE, "..", "dist", "build", "package")
  : path.join(HERE, "..");
const { RedteamStore } = await import(path.join(PKG, "lib/redteam/store-core.js"));
let pass = 0;
let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log("  ✓ " + label); return }
  fail += 1;
  console.log("  ✗ " + label + (extra === undefined ? "" : "  ← " + JSON.stringify(extra)));
};
const section = (s) => console.log("\n" + s);

/* ── 从构建产物里切出组件原文（不重写一份等价实现）────────────── */
const src = fs.readFileSync(path.join(PKG, "client.js"), "utf8");
const cut = (from, to) => {
  const a = src.indexOf(from);
  const b = to === null ? src.length : src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error("切不出代码段：" + from);
  return src.slice(a, b);
};
const reportSrc = cut("  const R2_CONF = {", "  /* 外层开关");
const rowSrc = cut("  const CONF_LABEL = {", "  function EvidenceTab(props) {");

/* 记录型 h：函数组件直接调用，最后把整棵树摊平成文本 */
const flat = [];
function h(tag, props, ...kids) {
  if (typeof tag === "function") return tag(props || {});
  const list = kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false);
  if (tag === "img") return null;
  flat.push({ tag, props: props || {}, text: list.filter((k) => typeof k === "string" || typeof k === "number").join(" ") });
  return { tag, props, kids: list };
}
const React = {
  useState: (init) => [typeof init === "function" ? init() : init, () => {}],
  useEffect: () => {},
};
const fake = (name, fn) => { const f = (...a) => (fn ? fn(...a) : undefined); Object.defineProperty(f, "name", { value: name }); return f; };

/* ── 1. 用真数据渲染 ReportV2 ───────────────────────────────── */
section("[1] ReportV2 渲染");
const store = new RedteamStore(ROOT);
const eng = store.openEngagement("渲染回归", ["203.0.113.0/24", "10.0.0.0/8"]);
store.importBundle(eng.id, {
  scan: { tool: "nmap", argv: [] },
  assets: [{ ip: "203.0.113.10", primary_name: "门户" }, { ip: "10.1.2.3", primary_name: "内网" }],
});
const A = store.listAssets(eng.id, { limit: 10 }).items;
const ext = A.find((x) => x.ip === "203.0.113.10");
const inn = A.find((x) => x.ip === "10.1.2.3");
const v = store.addVuln(eng.id, { asset_id: ext.id, title: "弱口令", severity: "high", status: "confirmed", target: "http://203.0.113.10/a", evidence: "admin/admin" });
store.addHttpEvidence(eng.id, { vuln_id: v.id, asset_id: ext.id, method: "POST", url: "http://203.0.113.10/a", request: "POST /a HTTP/1.1", response: "200 OK" });
store.addScoreHit(eng.id, { code: "web-app", asset_id: ext.id, target: "http://203.0.113.10/a", evidence: "后台已登录", vuln_id: v.id });
store.addScoreHit(eng.id, { code: "server-host", asset_id: inn.id, target: "10.1.2.3", evidence: "root" });
store.addAccess(eng.id, { asset_id: inn.id, host: "10.1.2.3", username: "root" });
store.addDataProof(eng.id, { asset_id: ext.id, target: "203.0.113.10", fields: ["姓名"], row_count: 12000 });
store.addCleanup(eng.id, { kind: "webshell", target: "203.0.113.10", title: "cmd.jsp" });
const data = store.reportV2(eng.id);

let ReportV2;
try {
  /* 产物里 hooks 走 import_react2.default.useState（演练台 IIFE 方言），
     测试的作用域必须同时提供 React 与 import_react2，否则求值即 ReferenceError。 */
  const factory = new Function("h", "h2", "React", "import_react2", "copyText", "URL", "Blob", "document",
    reportSrc + "\n return { ReportV2, R2ProofCard, R2ReproCard, R2ReproList };");
  ({ ReportV2 } = factory(h, h, React, { default: React }, () => {}, { createObjectURL: () => "", revokeObjectURL: () => {} }, function () {}, { createElement: () => ({ click: () => {} }) }));
  ok(true, "组件代码可求值（切自构建产物）");
} catch (e) {
  ok(false, "组件代码无法求值：" + e.message);
  process.exit(1);
}

flat.length = 0;
let threw = null;
try { ReportV2({ data, eng: eng.id, onSwitch: () => {} }); } catch (e) { threw = e; }
ok(threw === null, "渲染不抛异常", threw && threw.message);

const allText = flat.map((x) => x.text).join(" | ");
const classes = flat.map((x) => (x.props && x.props.className) || "").join(" ");
ok(allText.includes("一、资产归属证明"), "渲染出一、资产归属证明");
ok(allText.includes("二、得分汇总表"), "渲染出二、得分汇总表");
ok(allText.includes("三、得分点复现"), "渲染出三、得分点复现");
ok(allText.includes("四、交付清单"), "渲染出四、交付清单");
ok(allText.includes("1.1 互联网资产"), "渲染出 1.1");
ok(allText.includes("1.2 内网入口资产"), "渲染出 1.2");
ok(allText.includes("3.3 内网（按网段）"), "渲染出 3.3");
ok(flat.some((x) => x.tag === "table"), "汇总表真的渲染成 table");
ok(flat.filter((x) => x.tag === "tr").length >= 2, "表格有数据行", flat.filter((x) => x.tag === "tr").length);
ok(classes.includes("rt-r2-proof"), "归属证明卡带 rt-r2-proof");
ok(classes.includes("rt-r2-repro"), "复现卡带 rt-r2-repro");
ok(classes.includes("rt-r2-strong") || classes.includes("rt-r2-weak"), "归属强弱徽章渲染出来");
ok(allText.includes("203.0.113.10"), "目标 IP 出现在正文里");
ok(allText.includes("cmd.jsp"), "清理项出现在第四段");

/* 空数据：不能炸，要给可读的空态 */
flat.length = 0;
let threwEmpty = null;
try {
  ReportV2({ data: { summary: {}, asset_proof: {}, stage_summary: [], stage_tables: {}, repro: {}, cleanup: { total: 0, items: [] } }, eng: eng.id, onSwitch: () => {} });
} catch (e) { threwEmpty = e; }
ok(threwEmpty === null, "全空数据也不抛异常", threwEmpty && threwEmpty.message);
const emptyText = flat.map((x) => x.text).join(" | ");
ok(emptyText.includes("没有可归属的互联网资产"), "空数据给出可读空态，而不是空白");

/* ── 2. EvidenceRow 渲染 ────────────────────────────────────── */
section("[2] EvidenceRow 渲染");
const fmt = (t) => String(t === null || t === undefined ? "" : t).replace("T", " ").slice(0, 16);
const factory2 = new Function("h", "h2", "React", "import_react2", "fmt", rowSrc + "\n return { EvidenceRow };");
const { EvidenceRow } = factory2(h, h, React, { default: React }, fmt);

flat.length = 0;
let threwRow = null;
try {
  EvidenceRow({ item: { ev_id: "ev_abc123456789", confidence: "claimed", authority: "subagent-report", operation: "nmap_scan", recorded_at: "2026-11-20T10:00:00Z", source_agent: "sub-1", result: { open: [22] }, limitations: ["只扫了 TCP"], supporting_ev_ids: [], parameters: { target: "10.0.0.1" } } });
} catch (e) { threwRow = e; }
ok(threwRow === null, "证据条目渲染不抛异常", threwRow && threwRow.message);
const rowText = flat.map((x) => x.text).join(" | ");
ok(rowText.includes("声称（未核实）"), "claimed 显示成「声称（未核实）」而不是英文枚举");
ok(rowText.includes("nmap_scan"), "操作名出现在条目里");
ok(flat.some((x) => (x.props && x.props.className || "").includes("rt-ev-warn")), "未核实条目带警示色");

flat.length = 0;
EvidenceRow({ item: { ev_id: "ev_x", confidence: "observed", operation: "verify", result: null, limitations: [], supporting_ev_ids: [], parameters: {} } });
const okText = flat.map((x) => x.text).join(" | ");
ok(okText.includes("已核实"), "observed 显示成「已核实」");

console.log("\n" + (fail === 0 ? "全部通过" : "失败 " + fail + " 项") + "：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
