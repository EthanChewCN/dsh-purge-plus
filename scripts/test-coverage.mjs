#!/usr/bin/env node
// [dsh-purge-plus] P7 覆盖度引擎：行为回归。
//
// 跑真库（node:sqlite + 临时目录），不是 mock —— 覆盖度的坑几乎全在 SQL 和
// 「状态词校验」上：列默认值、INSERT OR IGNORE、UNIQUE(asset_id)、
// 内外网归属过滤。用 mock 测这些等于没测。
//
// 资产直接写 SQL 插入：本测试只关心覆盖度逻辑，不关心测绘入库那条路径
// （那条已经由资产测绘页的回归覆盖）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
/* 既能在仓库里跑（dist/build/package），也能在**已安装的包里**跑（脚本所在包的根）——
   发布包现在带 test-*.mjs，验收可以对已安装产物复跑（审计 B-5）。 */
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;
const MOD = path.join(PKG, "lib", "redteam", "store-core.js");

if (!fs.existsSync(MOD)) {
  console.error("dist/build/package 不存在，先跑 node scripts/build.mjs");
  process.exit(1);
}
const { RedteamStore } = await import(pathToFileURL(MOD).href);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cov-"));
const store = new RedteamStore(tmp);
/* openEngagement 返回 { id, name, scope }，不是裸 id —— 直接拿来当 id 用会走到
   pathComponent 的校验上并报 invalid path component。 */
const id = store.openEngagement("覆盖度回归", ["203.0.113.0/24", "10.0.0.0/24"]).id;
const db = store.db(id);

function addAsset(ip, cidr) {
  db.prepare("INSERT INTO asset(segment_cidr, ip) VALUES(?,?)").run(cidr, ip);
  return Number(db.prepare("SELECT last_insert_rowid() AS id").get().id);
}
const ext = addAsset("203.0.113.10", "203.0.113.0/24");
const ext2 = addAsset("203.0.113.11", "203.0.113.0/24");
const int = addAsset("10.0.0.5", "10.0.0.0/24");
/* 另开一台内网资产专门测「没权限不能 closed」：上面那台会被塞进 access_session，
   有权限之后走的是另一条分支，测不到这条。 */
const intNoAccess = addAsset("10.0.0.9", "10.0.0.0/24");

const tests = [];
const check = (name, fn) => tests.push({ name, fn });
const eq = (a, b, label) => {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error(`${label || "值"}：期望 ${y}，实际 ${x}`);
};
const ok = (v, label) => { if (!v) throw new Error(`${label || "断言"}不成立`); };
function throws(fn, needle, label) {
  try { fn(); } catch (e) {
    const msg = String((e && e.message) || e);
    if (needle && !msg.includes(needle)) throw new Error(`${label || "报错"}内容不含「${needle}」：${msg}`);
    return msg;
  }
  throw new Error(`${label || "调用"}应当抛错但没有`);
}

// ─────────────────────────────────────────────── 1. 外部资产五项
check("首次读取自动建行，五项都是 untested", () => {
  const c = store.getAssetCoverage(id, ext);
  eq(c.surface, "untested");
  eq(c.web, "untested");
  eq(c.auth, "untested");
  eq(c.cve, "untested");
  eq(c.app, "untested");
  eq(c.status, "open");
  eq(c.missing.length, 5, "缺项数");
  eq(c.complete, false);
  eq(c.asset.scope, "external");
});

check("状态词校验：写 finished 会被拒绝，且不留半条记录", () => {
  throws(() => store.updateAssetCoverage(id, ext, { surface: "finished" }), "只能是", "非法状态");
  eq(store.getAssetCoverage(id, ext).surface, "untested", "被拒后不应改动");
});

check("状态词校验：合法值可以写入", () => {
  const c = store.updateAssetCoverage(id, ext, { surface: "done", note: "nmap 全端口" });
  eq(c.surface, "done");
  eq(c.note, "nmap 全端口");
  eq(c.missing.length, 4);
});

check("没收口就 close 会被拒绝，并点名缺哪几项", () => {
  const msg = throws(() => store.closeAssetCoverage(id, ext), "web", "close 应当拒绝");
  ok(msg.includes("auth") && msg.includes("cve") && msg.includes("app"), "报错要点名全部缺项");
});

check("blocked 必须写原因", () => {
  throws(() => store.closeAssetCoverage(id, ext, { status: "blocked" }), "reason", "blocked 缺原因");
});

check("五项齐了才允许 closed", () => {
  store.updateAssetCoverage(id, ext, { web: "done", auth: "done", cve: "not_applicable", app: "blocked" });
  const c = store.closeAssetCoverage(id, ext);
  eq(c.status, "closed");
  eq(c.complete, true);
  eq(c.missing.length, 0);
});

// ─────────────────────────────────────────────── 2. 队列与内外网归属
check("外部队列只收外网资产，且跳过已收口的", () => {
  const q = store.assetNextActions(id, { limit: 10 });
  const ids = q.actions.map((a) => a.asset_id);
  ok(!ids.includes(ext), "已收口的资产不该出现在队列里");
  ok(!ids.includes(int), "内网资产不该出现在外部队列里");
  ok(ids.includes(ext2), "未动过的外网资产应当在队列里");
});

check("内网队列只收内网资产", () => {
  const q = store.hostNextActions(id, { limit: 10 });
  const ids = q.actions.map((a) => a.asset_id);
  ok(ids.includes(int), "内网资产应当在队列里");
  ok(!ids.includes(ext2), "外网资产不该出现在内网队列里");
});

// ─────────────────────────────────────────────── 3. 主机覆盖度与权限推导
check("权限从 access_session 推导（行里还是 none 也要认）", () => {
  const before = store.getHostCoverage(id, int);
  eq(before.access, "none", "初始应无权限");
  db.prepare("INSERT INTO access_session(asset_id, host, username, method, privilege) VALUES(?,?,?,?,?)")
    .run(int, "10.0.0.5", "root", "ssh", "root");
  const after = store.getHostCoverage(id, int);
  eq(after.access, "root");
  ok(after.credentials >= 1, "有用户名应当计入凭据数");
});

check("没权限的主机不能标 closed，只能 blocked 且写原因", () => {
  throws(() => store.closeHostCoverage(id, intNoAccess), "reason", "无权限收口");
});

// ─────────────────────────────────────────────── 4. 结构化发现自动推进
check("发现把对应维度从 untested 推到 partial", () => {
  const before = store.getHostCoverage(id, int).privesc;
  eq(before, "untested");
  const out = store.addHostFinding(id, { asset_id: int, kind: "privesc", title: "sudo -l 可免密执行 systemctl" });
  ok(out.finding_id > 0, "应当返回 finding_id");
  eq(store.getHostCoverage(id, int).privesc, "partial");
});

check("发现不会把 done 降级成 partial", () => {
  store.updateHostCoverage(id, int, { privesc: "done" });
  store.addHostFinding(id, { asset_id: int, kind: "privesc", title: "补一条提权细节" });
  eq(store.getHostCoverage(id, int).privesc, "done", "done 不该被降级");
});

check("credential 类发现加计数，而不是写状态词", () => {
  const before = Number(store.getHostCoverage(id, int).credentials) || 0;
  store.addHostFinding(id, { asset_id: int, kind: "credential", title: "/etc/shadow 里 3 个可登录账号" });
  const after = Number(store.getHostCoverage(id, int).credentials) || 0;
  eq(after, before + 1, "凭据数应当 +1");
});

check("title 为空 / kind 非法都被拒绝", () => {
  throws(() => store.addHostFinding(id, { asset_id: int, kind: "privesc", title: "  " }), "title", "空标题");
  throws(() => store.addHostFinding(id, { asset_id: int, kind: "nonsense", title: "x" }), "kind", "非法 kind");
});

check("发现列表可按资产与类型过滤", () => {
  const all = store.listHostFindings(id, {});
  ok(all.total >= 3, "至少三条");
  const priv = store.listHostFindings(id, { kind: "privesc" });
  ok(priv.findings.every((f) => f.kind === "privesc"), "过滤后应当只有 privesc");
  const other = store.listHostFindings(id, { asset_id: ext });
  eq(other.total, 0, "外网资产没有主机发现");
});

// ─────────────────────────────────────────────── 5. 汇总
check("coveragePending 分开数内外网", () => {
  const p = store.coveragePending(id);
  eq(p.total, p.external + p.internal, "总数应当等于两侧之和");
  ok(p.internal >= 1, "内网还有未收口的主机");
});

check("coverageSummary 计数一致且不给百分比", () => {
  const s = store.coverageSummary(id);
  eq(s.assets, 4, "资产总数");
  eq(s.external.assets + s.internal.assets, 4, "内外网之和");
  eq(s.external.assets, 2);
  eq(s.internal.assets, 2);
  eq(s.external.closed, 1, "已收口一台外网资产");
  ok(s.findings >= 3, "主机发现计数");
  ok(!("percent" in s) && !("rate" in s), "不应给百分比");
});

check("主机收口：五项齐了才允许 closed", () => {
  store.updateHostCoverage(id, int, { files: "done", web: "not_applicable", db: "not_applicable" });
  throws(() => store.closeHostCoverage(id, int), "lateral", "还差横向");
  store.updateHostCoverage(id, int, { lateral: "blocked" });
  const c = store.closeHostCoverage(id, int);
  eq(c.status, "closed");
  eq(c.complete, true);
});

// ─────────────────────────────────────────────── 6. 表结构真的落地了
check("三张表都在，且 asset_id 唯一", () => {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ["asset_coverage", "host_coverage", "host_finding"]) {
    ok(names.includes(t), "缺表 " + t);
  }
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name);
  ok(idx.includes("ix_host_finding_asset"), "缺 host_finding 索引");
});

// ───────────────────────────────────────────────────────────── 汇总
let pass = 0;
const failures = [];
for (const t of tests) {
  try {
    await t.fn();
    pass += 1;
  } catch (e) {
    failures.push(`${t.name} → ${e && e.message ? e.message : e}`);
  }
}
try { store.close() } catch { /* 忽略 */ }
try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 忽略 */ }

if (failures.length) {
  console.error(`\n✗ test-coverage：${failures.length} 条失败 / ${pass + failures.length} 条\n`);
  for (const f of failures) console.error("  · " + f);
  process.exit(1);
}
console.log(`✓ test-coverage：${pass} 通过 / 0 失败`);
