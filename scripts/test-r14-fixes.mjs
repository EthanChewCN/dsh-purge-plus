#!/usr/bin/env node
// [dsh-purge-plus] R14 契约批：参数被丢 / 统计口径错 / 局部更新重置 / 队列含已放弃主机。
//
// 这一批的共同形状是「返回 ok:true，数字和结果看着正常，错在语义」，
// 所以每条都用**造数据 + 对比两次调用**的方式验，而不是查源码里有没有那个词：
//   · 翻页：第 1 页与第 2 页必须不同（旧代码恒同一页）
//   · cleared：只看 status=done 时仍必须报 false（旧代码恒 true）
//   · 策略：只传 timeoutMs 后其它三项必须原样（旧代码被重置成 false/''）
//   · 队列：abandoned 的资产必须不出现（旧代码照样排在前面）

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 既能在仓库里跑（dist/build/package），也能在**已安装的包里**跑（脚本所在包的根）——
   发布包带 test-*.mjs，故障注入门禁还会把它整份复制到临时目录再跑一遍。 */
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m) => { fail++; console.error("  ✗ " + m); };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(`${m}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`));

const { RedteamStore, dispatch, dispatchAsync } = await import(path.join(PKG, "lib", "redteam", "store-core.js"));
const { savePlatformConfig } = await import(path.join(PKG, "lib", "redteam", "platform-config.js"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plus-r14-"));

/** 造一个有 3 个模板的 nuclei 目录，并把它写进平台配置。 */
function seedTemplates() {
  const dir = path.join(tmp, "templates");
  fs.mkdirSync(path.join(dir, "http", "cves"), { recursive: true });
  const files = [
    ["http/cves/CVE-2021-44228.yaml", "id: CVE-2021-44228\ninfo:\n  name: log4j rce\n  severity: critical\n  tags: rce,log4j\n"],
    ["http/cves/CVE-2022-0001.yaml", "id: CVE-2022-0001\ninfo:\n  name: other rce\n  severity: high\n  tags: rce\n"],
    ["http/misc/unauth.yaml", "id: unauth-panel\ninfo:\n  name: panel unauth\n  severity: medium\n  tags: unauth\n"],
  ];
  for (const [rel, body] of files) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, body, "utf8");
  }
  return dir;
}

console.log("[1] PA-08：翻页参数必须真的生效");
{
  const root = path.join(tmp, "eng1");
  const store = new RedteamStore(root);
  const dir = seedTemplates();
  /* 平台配置指向临时模板目录（索引从这里建） */
  savePlatformConfig({ nucleiTemplatesDir: dir }, root);

  const page1 = store.searchTemplates("", 2, 0);
  const page2 = store.searchTemplates("", 2, 2);
  eq(page1.items.length, 2, "第 1 页 2 条");
  eq(page2.items.length, 1, "第 2 页 1 条（共 3 条）");
  const p1 = page1.items.map((t) => t.path);
  const p2 = page2.items.map((t) => t.path);
  eq(p1.filter((x) => p2.includes(x)), [], "两页没有重叠（旧代码 offset 被丢，两页恒相同）");
  eq(page1.matched, 3, "matched 是全量 3 条，不是页长");

  /* op 层也要把 offset 传下去（q 为空时 op 走「不检索」分支，所以给一个能命中两条的词） */
  const viaOp1 = dispatch(store, { op: "pocSearch", q: "CVE-20", templateOffset: 0, templateLimit: 1 });
  const viaOp2 = dispatch(store, { op: "pocSearch", q: "CVE-20", templateOffset: 1, templateLimit: 1 });
  eq(viaOp1.templates.items.length, 1, "第 1 页 1 条");
  eq(viaOp2.templates.items.length, 1, "第 2 页 1 条");
  eq(viaOp1.templates.items[0].path === viaOp2.templates.items[0].path, false,
    "pocSearch 传 templateOffset 后两页不同（旧代码 offset 被丢，恒同一页）");
}

console.log("[2] PA-08b：templateSearch 认 cve 参数");
{
  const root = path.join(tmp, "eng2");
  const store = new RedteamStore(root);
  savePlatformConfig({ nucleiTemplatesDir: seedTemplates() }, root);
  const byCve = dispatch(store, { op: "templateSearch", cve: "CVE-2021-44228" });
  eq(byCve.matched, 1, "按 cve 只命中 1 条（旧代码忽略 cve，返回全库 3 条）");
  eq(byCve.items[0].path, "http/cves/CVE-2021-44228.yaml", "命中的是那条模板");
  const byQ = dispatch(store, { op: "templateSearch", q: "unauth" });
  eq(byQ.matched, 1, "q 仍然可用");
}

console.log("[3] PL-04：cleared 不能按筛选算");
{
  const root = path.join(tmp, "eng3");
  const store = new RedteamStore(root);
  const eng = store.openEngagement({ name: "清理口径", scope: "10.0.0.0/24" });
  const eid = eng.id;
  store.addCleanup(eid, { kind: "webshell", target: "10.0.0.5", location: "/var/www/a.php", title: "a" });
  store.addCleanup(eid, { kind: "webshell", target: "10.0.0.5", location: "/var/www/b.php", title: "b" });
  const done = store.addCleanup(eid, { kind: "account", target: "10.0.0.6", location: "root", title: "c" });
  store.updateCleanup(eid, done.cleanup_id, { status: "done" });

  const onlyDone = store.listCleanup(eid, { status: "done" });
  eq(onlyDone.items.length, 1, "筛选 done 只返回 1 条");
  eq(onlyDone.by_status.open, 2, "by_status.open 是**整表** 2（旧代码按当前页算 = 0）");
  eq(onlyDone.cleared, false, "还有 2 条 open → cleared=false（旧代码报 true）");

  /* 全部收口后才允许说清干净 */
  const all = store.listCleanup(eid, {});
  for (const it of all.items) store.updateCleanup(eid, it.id, { status: "done" });
  const after = store.listCleanup(eid, { status: "done" });
  eq(after.cleared, true, "全部 done 后 cleared=true");
  eq(store.cleanupSummary(eid).cleared, true, "cleanupSummary 口径一致");
}

console.log("[4] PL-06：只改超时不能把连接开关重置");
{
  const root = path.join(tmp, "eng4");
  const store = new RedteamStore(root);
  store.proxyPoolSavePolicy({ enabled: true, autoConnect: true, timeoutMs: 9000, enginePath: "/opt/mihomo" });
  const after = store.proxyPoolSavePolicy({ timeoutMs: 5000 });
  eq(after.timeoutMs, 5000, "超时改了");
  eq(after.enabled, true, "enabled 保持 true（旧代码被重置成 false）");
  eq(after.autoConnect, true, "autoConnect 保持 true");
  eq(after.enginePath, "/opt/mihomo", "enginePath 保持原值（旧代码被清空）");

  const off = store.proxyPoolSavePolicy({ enabled: false });
  eq([off.enabled, off.autoConnect, off.enginePath], [false, true, "/opt/mihomo"], "显式关 enabled 时其余不动");
}

console.log("[5] PL-07：带 % 的值不能当通配符、也不能炸");
{
  const root = path.join(tmp, "eng5");
  const store = new RedteamStore(root);
  fs.mkdirSync(path.join(root, "kb"), { recursive: true });
  const db = new DatabaseSync(path.join(root, "kb", "cve.db"));
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  db.exec(`CREATE TABLE IF NOT EXISTS cve (cve TEXT PRIMARY KEY, title TEXT, vendor TEXT, product TEXT,
    versions TEXT, cvss REAL, severity TEXT, vector TEXT, cwe TEXT, published TEXT, updated TEXT,
    desc TEXT, refs TEXT, kev INTEGER, epss REAL, edb TEXT, nuclei TEXT)`);
  db.prepare("INSERT INTO meta(key,value) VALUES('version','4')").run();
  db.prepare("INSERT INTO cve(cve,title,vendor,severity) VALUES(?,?,?,?)").run("CVE-2021-44228", "log4j", "apache", "critical");
  db.close();
  const { resetCveDbCache, searchCve } = await import(path.join(PKG, "lib", "redteam", "cve-db.js"));
  resetCveDbCache();
  let threw = null;
  let rows = null;
  try { rows = searchCve(root, { cve: "CVE-2021-44228" }); } catch (e) { threw = String(e && e.message || e); }
  eq(threw, null, "正常 CVE 查询不抛");
  eq(rows.length, 1, "命中 1 条");
  threw = null;
  try { searchCve(root, { cve: "CVE-2021-44228\\" }); } catch (e) { threw = String(e && e.message || e); }
  eq(threw, null, "带反斜杠的坏值不抛（走不到 LIKE 分支，但也不能炸）");
  /* 真正的判据：值里的 % 是字面量。不转义时 LIKE '%%%' 命中全库，
     界面上「搜了个 %」看起来像「什么都能搜到」，实际是筛了个寂寞。 */
  const wild = searchCve(root, { vendor: "%" });
  eq(wild.length, 0, "vendor 传 % 当字面量（不转义会命中全库）");
  const under = searchCve(root, { vendor: "_" });
  eq(under.length, 0, "vendor 传 _ 当字面量（不转义会命中任意单字符）");
  eq(searchCve(root, { vendor: "apache" }).length, 1, "正常 vendor 仍然命中");
  resetCveDbCache();
}

console.log("[6] PA-14：缺 title 不再抛错，改成生成可读标题");
{
  const root = path.join(tmp, "eng6");
  const store = new RedteamStore(root);
  const eng = store.openEngagement({ name: "标题", scope: "10.0.0.0/24" });
  const r = store.addCleanup(eng.id, { kind: "webshell", target: "10.0.0.9", location: "/x.php" });
  eq(typeof r.cleanup_id, "number", "没有 title 也能建");
  const row = store.listCleanup(eng.id, {}).items.find((x) => x.id === r.cleanup_id);
  eq(row.title, "webshell @ 10.0.0.9 /x.php（自动生成）", "标题按 kind/target/location 生成");
  eq(row.title.includes("自动生成"), true, "标了「自动生成」，人能看出这是推导出来的");
  /* 显式给了就照用 */
  const r2 = store.addCleanup(eng.id, { kind: "account", target: "10.0.0.9", location: "root", title: "删 root 账号" });
  eq(store.listCleanup(eng.id, {}).items.find((x) => x.id === r2.cleanup_id).title, "删 root 账号", "显式 title 优先");
}

console.log("[7] PA-16：已放弃的资产不进队列");
{
  const root = path.join(tmp, "eng7");
  const store = new RedteamStore(root);
  const eng = store.openEngagement({ name: "队列", scope: "10.0.0.0/24" });
  const eid = eng.id;
  /* 资产没有公开的 add 方法（内部走 #upsertAsset），直接写库更贴近真实形态 */
  const db = store.db(eid);
  const add = (ip, name) => Number(db.prepare(
    "INSERT INTO asset(ip, primary_name, segment_cidr) VALUES(?,?,?)",
  ).run(ip, name, "10.0.0.0/24").lastInsertRowid);
  const a = add("10.0.0.11", "alive.internal");
  const b = add("10.0.0.12", "givenup.internal");
  const c = add("10.0.0.13", "nosurf.internal");
  store.updateAssetTest(eid, { asset_id: b, status: "abandoned", test: "被封 3 次" });
  store.updateAssetTest(eid, { asset_id: c, status: "no_surface", test: "无面" });

  const q = store.hostNextActions(eid, { limit: 30 });
  const ips = q.actions.map((x) => x.asset_ip);
  eq(ips.includes("10.0.0.11"), true, "正常主机在队列里");
  eq(ips.includes("10.0.0.12"), false, "abandoned 不在队列里（旧代码会排在最前）");
  eq(ips.includes("10.0.0.13"), false, "no_surface 不在队列里");
  eq(q.total, ips.length, "total 与明细一致");
}

fs.rmSync(tmp, { recursive: true, force: true });

/* 汇总行格式与其它 test-*.mjs 一致：verify [33] 按「N 通过 / M 失败」汇总断言数 */
console.log(`${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
