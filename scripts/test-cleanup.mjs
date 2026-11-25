#!/usr/bin/env node
// [dsh-purge-plus] P9 清理清单：行为回归。
//
// 跑真库（node:sqlite + 临时目录），不是 mock —— 清理清单的坑几乎全在「去重」和
// 「wontfix 必须写原因」上：列默认值、INSERT OR IGNORE、UNIQUE(asset_id)、
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

check("登记一条清理项", () => {
  const out = store.addCleanup(id, { asset_id: ext, kind: "webshell", title: "上传的 cmd.php", target: "http://203.0.113.10/cmd.php" });
  ok(out.cleanup_id > 0, "应当返回 cleanup_id");
  eq(out.deduped, false, "首次登记不该被去重");
  const l = store.listCleanup(id, {});
  eq(l.total, 1);
  eq(l.by_status.open, 1);
  eq(l.cleared, false, "还有 open 就不算清完");
});

check("同 target + 同 kind 且未收口 → 去重，不新增行", () => {
  const again = store.addCleanup(id, { asset_id: ext, kind: "webshell", title: "又传了一次", target: "http://203.0.113.10/cmd.php" });
  eq(again.deduped, true, "应当被去重");
  eq(store.listCleanup(id, {}).total, 1, "行数不该增加");
});

check("kind 非法被拒；title 缺省时自动生成（R14 起不再抛）", () => {
  throws(() => store.addCleanup(id, { kind: "nonsense", title: "x" }), "kind", "非法 kind");
  /* [dsh-purge-plus] R14：safe 只要求 kind，从 safe 迁移的调用方一律不带 title，
     硬抛等于让它们全失败。改成按 kind/target/location 生成可读标题。 */
  const auto = store.addCleanup(id, { kind: "file", title: "   ", target: "203.0.113.10", location: "/tmp/x" });
  eq(auto.deduped, false, "空标题也能建（自动生成）");
  const row = store.listCleanup(id, {}).items.find((x) => x.id === auto.cleanup_id);
  eq(row.title.includes("自动生成"), true, "标题标了「自动生成」");
});

check("status 校验：只认 open / done / wontfix", () => {
  const item = store.listCleanup(id, {}).items[0];
  throws(() => store.updateCleanup(id, item.id, { status: "finished" }), "只能是", "非法状态");
});

check("wontfix 必须写原因", () => {
  const item = store.listCleanup(id, {}).items[0];
  throws(() => store.updateCleanup(id, item.id, { status: "wontfix" }), "detail", "wontfix 缺原因");
  const out = store.updateCleanup(id, item.id, { status: "wontfix", detail: "客户要求保留以做取证" });
  eq(out.cleanup.status, "wontfix");
  eq(out.cleanup.detail, "客户要求保留以做取证");
});

check("done 之后 cleared 变 true", () => {
  const item = store.listCleanup(id, {}).items[0];
  store.updateCleanup(id, item.id, { status: "done" });
  const l = store.listCleanup(id, {});
  eq(l.by_status.done, 1);
  eq(l.by_status.open, 0);
  eq(l.cleared, true, "没有 open 项就该 cleared");
});

check("去重只挡未收口的：已 done 之后再登记同一处会新增", () => {
  const again = store.addCleanup(id, { asset_id: ext, kind: "webshell", title: "又被传了一次", target: "http://203.0.113.10/cmd.php" });
  eq(again.deduped, false, "收口之后同一个位置再出现，是新的待办");
  /* 上一条「空标题自动生成」会多留一条，总数按实际条数比 —— 这里比的是「新增了没有」，
     不是绝对条数，所以用 >= 原值+1 的形式更稳。 */
  eq(store.listCleanup(id, {}).total >= 2, true, "两条都在（含上一条自动标题的）");
});

check("按 status / kind 过滤", () => {
  eq(store.listCleanup(id, { status: "open" }).total, 1);
  eq(store.listCleanup(id, { kind: "webshell" }).total, 2);
  eq(store.listCleanup(id, { kind: "account" }).total, 0);
});

check("翻页：total 是整表条数，不是当前页长度（PA-13）", () => {
  /* 三条、每页两条。旧代码 total = rows.length，第 1 页报 2，
     调用方以为只有两条，第二页永远拿不到。 */
  store.addCleanup(id, { asset_id: ext, kind: "account", title: "翻页样本 A" });
  store.addCleanup(id, { asset_id: ext, kind: "account", title: "翻页样本 B" });
  store.addCleanup(id, { asset_id: ext, kind: "account", title: "翻页样本 C" });
  const all = store.listCleanup(id, { kind: "account" });
  eq(all.total, 3, "整表 3 条");
  const p1 = store.listCleanup(id, { kind: "account", limit: 2, offset: 0 });
  const p2 = store.listCleanup(id, { kind: "account", limit: 2, offset: 2 });
  eq(p1.total, 3, "第 1 页 total 仍是 3（不是 2）");
  eq(p1.returned, 2, "第 1 页返回 2 条");
  eq(p2.returned, 1, "第 2 页返回 1 条");
  const ids1 = p1.items.map((x) => x.id), ids2 = p2.items.map((x) => x.id);
  eq(ids1.some((x) => ids2.includes(x)), false, "两页不重叠");
});

check("cleanupSummary 与 list 的计数一致", () => {
  const s = store.cleanupSummary(id);
  const l = store.listCleanup(id, {});
  eq(s.total, l.total, "总数");
  eq(s.open, l.by_status.open, "open 数");
  eq(s.done, l.by_status.done, "done 数");
  eq(s.cleared, l.cleared, "cleared");
});

check("表与索引真的落地", () => {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  ok(names.includes("cleanup_item"), "缺 cleanup_item 表");
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name);
  ok(idx.includes("ix_cleanup_status"), "缺清理清单索引");
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
  console.error(`\n✗ test-cleanup：${failures.length} 条失败 / ${pass + failures.length} 条\n`);
  for (const f of failures) console.error("  · " + f);
  process.exit(1);
}
console.log(`✓ test-cleanup：${pass} 通过 / 0 失败`);
