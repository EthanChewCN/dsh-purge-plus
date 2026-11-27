#!/usr/bin/env node
// [dsh-purge-plus] R22 回归：safe 2.0.2 的 op 名兼容层 + team-mode 接线 + 挂针契约。
//
// 三块各有一类**只能靠行为证明**的东西：
//   [1] 三个只读别名（cveSearch / cveLookup / templateCatalogStatus）
//       —— 断言「不再是 unknown op」不够，要断言真能查到刚写进去的那一行；
//   [2] 第四个别名 intelSync —— 没配数据源时必须 skipped + note，不能像同步过了；
//   [3] team-mode —— 断言 installPlusCapabilities 真把 installTeamMode 装上了，
//       并且 ensureRedteamTeamMode 对红队根会话**只写一次** team/mode。
//       这一条是因为审计里出现过「installTeamMode 零调用方」的误判：
//       调用一直在，只是没有任何可观测痕迹。
//   [4] #209 挂针契约 —— 把补丁产出的表达式真求值一遍，function / string 两种
//       写法都要拿到正文，其他类型仍为空串（严格超集）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(import.meta.dirname, "..");
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;

let pass = 0;
let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log("  ✓ " + label); return }
  fail += 1;
  console.log("  ✗ " + label + (extra === undefined ? "" : "  ← " + JSON.stringify(extra)));
};
const section = (s) => console.log("\n" + s);

if (!fs.existsSync(path.join(PKG, "lib/redteam/store-core.js"))) {
  console.error("✗ 找不到构建产物，先跑 node scripts/build.mjs");
  process.exit(1);
}

/* 先把 DSH_HOME 指到临时目录：能力接线层会跑 ensureRedteamRuntime，
   不隔离的话测试会往真实 ~/.dsh/redteam 里铺目录。 */
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "dshpp-r22-home-"));
process.env.DSH_HOME = HOME;

const { dispatch, dispatchAsync, RedteamStore } = await import(path.join(PKG, "lib/redteam/store-core.js"));
const caps = await import(path.join(PKG, "lib/plus-capabilities.js"));
const teamMode = await import(path.join(PKG, "lib/redteam/team-mode.js"));
const { OVERLAY_PATCHES } = await import(path.join(PKG, "lib/patches/overlay.mjs"));

const tmpRoots = [];
const tmp = (tag) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dshpp-r22-${tag}-`));
  tmpRoots.push(dir);
  return dir;
};

/** 造一份最小但结构合法的底库（与 scripts/build-cve-db.mjs 同列名）。 */
function seedCveDb(root, rows) {
  fs.mkdirSync(path.join(root, "kb"), { recursive: true });
  const db = new DatabaseSync(path.join(root, "kb", "cve.db"));
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.exec(`CREATE TABLE cve (
    cve TEXT PRIMARY KEY, title TEXT, vendor TEXT, product TEXT, versions TEXT, cvss REAL,
    severity TEXT, vector TEXT, cwe TEXT, published TEXT, updated TEXT, desc TEXT, refs TEXT,
    kev INTEGER, epss REAL, edb TEXT, nuclei TEXT)`);
  db.exec("CREATE TABLE template (path TEXT, id TEXT, name TEXT, severity TEXT, tags TEXT, cves TEXT, author TEXT, cwe TEXT, proto TEXT)");
  db.exec("CREATE TABLE exp (id TEXT, file TEXT, description TEXT, type TEXT, platform TEXT, published TEXT, author TEXT, cves TEXT, msf TEXT)");
  db.exec("CREATE TABLE poc_github (cve TEXT, repos INTEGER, items TEXT)");
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("version", "4");
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("built_at", String(Date.now()));
  for (const r of rows) {
    db.prepare("INSERT INTO cve (cve, title, vendor, product, severity, cvss, published, kev, nuclei) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(r.cve, r.title || "test row", r.vendor || "acme", r.product || "widget", r.severity || "high",
        r.cvss ?? 9.8, r.published || "2026-01-01", r.kev ? 1 : 0, r.nuclei || null);
  }
  db.prepare("INSERT INTO template (path, id, name, severity, proto) VALUES (?,?,?,?,?)")
    .run("http/cves/x.yaml", "CVE-2026-0001", "x", "high", "http");
  db.close();
}

const emptyStore = () => new RedteamStore(tmp("empty"));

try {
  /* ── 1. 空库：三个别名必须被认出，且说清「库不在」 ─────────────── */
  section("[1] 空库：op 被认出（不再是 unknown op），并把「库不在」写进返回值");
  {
    const s = emptyStore();
    for (const op of ["cveSearch", "cveLookup", "templateCatalogStatus"]) {
      const r = dispatch(s, { op, q: "log4j", ids: ["CVE-2026-0001"] });
      ok(r.ok === true, `${op} → ok:true（不是 unknown op）`, r.error);
      ok(!/unknown op/i.test(String(r.error || "")), `${op} 不再报 unknown op`, r.error);
      ok(typeof r.note === "string" && r.note.length > 0, `${op} 空库时带 note 说明原因`, r.note);
    }
    const search = dispatch(s, { op: "cveSearch", q: "log4j" });
    ok(Array.isArray(search.items) && search.items.length === 0, "空库 cveSearch → items 是空数组（形状不塌）", search.items);
    ok(search.status && search.status.available === false, "空库 cveSearch → status.available=false", search.status);
    const cat = dispatch(s, { op: "templateCatalogStatus" });
    ok(cat.cve_db !== undefined && cat.status !== undefined, "templateCatalogStatus 同时给 cve_db 与 status（safe 同形）", Object.keys(cat));
    ok(cat.status.available === false, "空库 templateCatalogStatus.status.available=false", cat.status);
  }

  /* ── 2. 真库：别名必须查到刚写进去的那一行 ─────────────────────── */
  section("[2] 真库：三个别名与底层函数同结果");
  {
    const root = tmp("db");
    seedCveDb(root, [
      { cve: "CVE-2026-0001", title: "acme widget rce", kev: true, cvss: 9.8 },
      { cve: "CVE-2026-0002", title: "other thing", vendor: "globex", product: "gadget", kev: false, cvss: 5.0 },
    ]);
    const s = new RedteamStore(root);

    const byQ = dispatch(s, { op: "cveSearch", q: "CVE-2026-0001" });
    ok(byQ.ok === true && byQ.items.length === 1, "cveSearch q=CVE 编号 → 命中 1 条", byQ.items.length);
    ok(byQ.items[0].cve === "CVE-2026-0001", "命中的是那一条", byQ.items[0] && byQ.items[0].cve);
    ok(byQ.status.available === true, "status.available=true", byQ.status);

    const kevOnly = dispatch(s, { op: "cveSearch", kevOnly: true });
    ok(kevOnly.items.length === 1 && kevOnly.items[0].cve === "CVE-2026-0001", "cveSearch kevOnly → 只剩 KEV 那条", kevOnly.items.map((x) => x.cve));

    const byVendor = dispatch(s, { op: "cveSearch", vendor: "globex" });
    ok(byVendor.items.length === 1 && byVendor.items[0].cve === "CVE-2026-0002", "cveSearch vendor → 按厂商过滤", byVendor.items.map((x) => x.cve));

    /* 类型收敛：'x' 不是数字，不能被当成 0 或 NaN 塞进 SQL */
    const badCvss = dispatch(s, { op: "cveSearch", minCvss: "x" });
    ok(badCvss.ok === true && badCvss.items.length === 2, "cveSearch minCvss='x' 被忽略（不缩小结果、不报错）", badCvss.items.length);

    const lookupArr = dispatch(s, { op: "cveLookup", ids: ["CVE-2026-0001"] });
    ok(lookupArr.items.length === 1 && lookupArr.items[0].cve === "CVE-2026-0001", "cveLookup ids 数组 → 命中", lookupArr.items.length);
    const lookupOne = dispatch(s, { op: "cveLookup", ids: "CVE-2026-0001" });
    ok(lookupOne.items.length === 1, "cveLookup ids 单值也被接受（safe 的 ids ?? cve ?? id 口径）", lookupOne.items.length);
    const lookupJunk = dispatch(s, { op: "cveLookup", ids: [null, 7, "CVE-2026-0001"] });
    ok(lookupJunk.ok === true && lookupJunk.items.length === 1, "cveLookup 丢弃非字符串项，不把 undefined 拼进 SQL", lookupJunk.items.length);

    const cat = dispatch(s, { op: "templateCatalogStatus" });
    ok(cat.status.available === true && cat.status.count === 1, "templateCatalogStatus 数到 1 个模板", cat.status);
    ok(cat.status.by_proto && cat.status.by_proto.http === 1, "按协议分组里 http=1", cat.status.by_proto);
  }

  /* ── 3. intelSync：没配数据源必须 skipped + note ──────────────── */
  section("[3] intelSync 没配数据源时 skipped，且明说没联网没落盘");
  {
    const s = emptyStore();
    const before = process.env.REDTEAM_INTEL_BASE;
    delete process.env.REDTEAM_INTEL_BASE;
    const r = await dispatchAsync(s, { op: "intelSync" });
    if (before !== undefined) process.env.REDTEAM_INTEL_BASE = before;
    ok(r.ok === true, "intelSync → ok:true（skipped 不算失败，与 safe 一致）", r);
    ok(r.result && r.result.action === "skipped", "action=skipped", r.result);
    ok(typeof r.note === "string" && /没有联网/.test(r.note), "带 note 说明没联网也没落盘", r.note);
    ok(r.status !== undefined, "带 status（safe 形状）", Object.keys(r));
  }

  /* ── 4. team-mode：接线 + 只写一次 ────────────────────────────── */
  section("[4] team-mode 真的被装上，且对红队根会话只写一次");
  {
    const handlers = new Map();
    const ctx = {
      on(name, fn) { handlers.set(name, fn); return () => handlers.delete(name) },
      get() { return undefined },
      effect() {},
      logger: { info() {}, warn() {}, debug() {} },
    };
    const report = caps.installPlusCapabilities(ctx, {});
    ok(Array.isArray(report.installed) && report.installed.includes("team-mode"),
      "installPlusCapabilities 把 team-mode 记进 installed", report);
    ok(handlers.has("agent/created") && handlers.has("agent/pre-step"),
      "installTeamMode 注册了 agent/created 与 agent/pre-step", [...handlers.keys()]);

    const appended = [];
    const session = {
      header: { agentPreset: "redteam", delegationDepth: 0, origin: "user" },
      events: [],
      append(type, data) { appended.push({ type, data }); this.events.push({ type, data }) },
      snapshotEvents() { return this.events },
    };
    const first = teamMode.ensureRedteamTeamMode(session, () => true);
    ok(first === "enabled", "红队根会话 → enabled", first);
    ok(appended.length === 1 && appended[0].type === "team/mode" && appended[0].data.enabled === true,
      "写了 team/mode {enabled:true}", appended);
    const second = teamMode.ensureRedteamTeamMode(session, () => true);
    ok(second === "skip-already" && appended.length === 1, "第二次调用不再写（幂等）", { second, n: appended.length });

    const notRedteam = { header: { agentPreset: "standard" }, events: [], append() { appended.push("x") } };
    ok(teamMode.ensureRedteamTeamMode(notRedteam, () => false) === "skip-not-redteam",
      "非红队会话一条都不写", notRedteam);

    /* 关掉开关时必须是彻底的空操作，而不是「装了但内部判断」 */
    const off = teamMode.installTeamMode({ on() { throw new Error("不该注册") } }, { redteamTeamMode: false });
    ok(typeof off === "function", "redteamTeamMode:false → 返回可调用的空 disposer", typeof off);
  }

  /* ── 5. #209 挂针契约：function 与 string 都认 ────────────────── */
  section("[5] #209 挂针契约表达式：function / string 双认，其余为空串");
  {
    const p = OVERLAY_PATCHES.find((x) => x.id === 209);
    ok(Boolean(p), "#209 在自有补丁表里");
    ok(p && p.chainedAfter === 88, "#209 chainedAfter=88（锚点是 #88 的产物）", p && p.chainedAfter);
    ok(p && Array.isArray(p.markers) && p.markers.length === 1, "#209 带 marker", p && p.markers);
    const src = p ? p.replacements[0].replace : "";
    ok(/typeof dshPurgeHungRaw === "function"/.test(src), "#209 保留 function 分支");
    ok(/typeof dshPurgeHungValue === "string"/.test(src), "#209 新增 string 分支");

    /* 真求值：把补丁产出的两行塞进一个函数里跑，比字符串断言可靠。 */
    const expr = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace("const dshPurgeHungRaw = globalThis.__dshPurgeHungPrompt;", "const dshPurgeHungRaw = globalThis.__dshPurgeHungPrompt;")
      .replace("const dshPurgeHung =", "const dshPurgeHung =");
    const run = new Function("globalThis", `${expr}\nreturn dshPurgeHung;`);
    const g = {};
    ok(run(g) === "", "没有挂针 → 空串", run(g));
    g.__dshPurgeHungPrompt = () => "FUNC-BODY";
    ok(run(g) === "FUNC-BODY", "function 契约 → 取到正文", run(g));
    g.__dshPurgeHungPrompt = "  STR-BODY  ";
    ok(run(g) === "STR-BODY", "string 契约 → 取到正文并 trim", run(g));
    g.__dshPurgeHungPrompt = 42;
    ok(run(g) === "", "其他类型 → 空串（不把 42 变成 \"42\"）", run(g));
    g.__dshPurgeHungPrompt = () => ({});
    ok(run(g) === "", "function 返回对象 → 丢弃（不糊成 [object Object]）", run(g));
  }
} finally {
  for (const d of tmpRoots) {
    try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* 已删 */ }
  }
  try { fs.rmSync(HOME, { recursive: true, force: true }) } catch { /* 已删 */ }
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
