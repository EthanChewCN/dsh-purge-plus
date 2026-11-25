#!/usr/bin/env node
// [dsh-purge-plus] P8 回归：data_proof + 四段式报告。
//
// 为什么必须跑真库：这一段的价值全在「哪些资产进了归属证明、哪些被挡在外面、
// 分值与面板是否一致」。字符串断言只能证明代码里有这些字，证明不了行为。
//
// 重点验四件事：
//   ① reportV2 的总分/逐条分值与 scoreReport 完全一致（不重算）；
//   ② 内网资产「被发现了」不等于「入口资产」——没有会话/凭据/通道的不进 1.2；
//   ③ 归属证明强弱按可复核材料判（数据样本/报文/截图/已确认漏洞），不是"有备注就算强"；
//   ④ 复现段的缺口（gaps）会把"复现不出来"的原因写出来，而不是留空。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "plus-r2-"));
/* 既能在仓库里跑（scripts/../dist/build/package），也能在**已安装的包里**跑
   （发布包现在带 test-*.mjs，脚本所在包的根就是包根；审计 B-5）。
   注意这里用脚本自身位置而不是 ROOT —— 有些测试的 ROOT 是临时库目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = fs.existsSync(path.join(HERE, "..", "dist", "build", "package"))
  ? path.join(HERE, "..", "dist", "build", "package")
  : path.join(HERE, "..");
const { RedteamStore } = await import(path.join(PKG, "lib/redteam/store-core.js"));

const store = new RedteamStore(ROOT);
let pass = 0;
let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log("  ✓ " + label); return }
  fail += 1;
  console.log("  ✗ " + label + (extra === undefined ? "" : "  ← " + JSON.stringify(extra)));
};
const section = (s) => console.log("\n" + s);

const eng = store.openEngagement("P8 回归靶标", ["203.0.113.0/24", "10.0.0.0/8"]);

/* ── 1. 建数据：外网一台、内网一台（进去了）、内网一台（只是被发现）──── */
section("[1] 造数据");
store.importBundle(eng.id, {
  scan: { tool: "nmap", argv: ["-sV"] },
  assets: [
    { ip: "203.0.113.10", primary_name: "门户站", ports: [{ port: 443, state: "open" }] },
    { ip: "10.1.2.3", primary_name: "内网应用", ports: [{ port: 8080, state: "open" }] },
    { ip: "10.9.9.9", primary_name: "旁路扫到的打印机", ports: [{ port: 9100, state: "open" }] },
  ],
});
const assets = store.listAssets(eng.id, { limit: 50 }).items || [];
const byIp = new Map(assets.map((a) => [a.ip, a]));
ok(byIp.size === 3, "三台资产落库", [...byIp.keys()]);
const ext = byIp.get("203.0.113.10");
const inn = byIp.get("10.1.2.3");
const bypass = byIp.get("10.9.9.9");

const vuln = store.addVuln(eng.id, {
  asset_id: ext.id, title: "后台弱口令", severity: "high", status: "confirmed",
  target: "http://203.0.113.10/admin", evidence: "admin/admin 登录成功",
});
store.addHttpEvidence(eng.id, {
  vuln_id: vuln.id, asset_id: ext.id, label: "登录请求", method: "POST",
  url: "http://203.0.113.10/admin/login",
  request: "POST /admin/login HTTP/1.1\r\nHost: 203.0.113.10\r\n\r\nuser=admin&pass=admin",
  response: "HTTP/1.1 302 Found\r\nLocation: /dashboard",
});

store.addScoreHit(eng.id, {
  code: "web-app", asset_id: ext.id, target: "http://203.0.113.10/admin",
  evidence: "管理员后台已登录", vuln_id: vuln.id,
});
/* 域名控制是「互联网资产」阶段的计分项（web-app 归靶标权限，见 POINT_STAGE_OVERRIDE）。
   两阶段都要有，否则 3.1 / 3.4 的拆分根本没被验证过。 */
store.addScoreHit(eng.id, {
  code: "domain-control", asset_id: ext.id, target: "203.0.113.10",
  evidence: "域名注册商账号已接管",
});
store.addScoreHit(eng.id, {
  code: "server-host", asset_id: inn.id, target: "10.1.2.3",
  evidence: "root shell 已获得",
});
/* 内网那台真的进去了：访问会话 + 凭据 */
store.addAccess(eng.id, { asset_id: inn.id, host: "10.1.2.3", username: "root", method: "ssh", privilege: "root" });
store.addCredential(eng.id, { asset_id: inn.id, host: "10.1.2.3", username: "root", secret_value: "test-only-password", source: "shadow" });

/* ── 2. data_proof 校验 ─────────────────────────────────────── */
section("[2] addDataProof");
const p1 = store.addDataProof(eng.id, {
  asset_id: ext.id, target: "203.0.113.10", source: "db", interface: "user 表",
  fields: ["姓名", "身份证号"], row_count: 23000, sample: "张*，3301**********1234",
});
ok(p1.meets_threshold === true, "row_count 23000 → meets_threshold");
ok(p1.fields.length === 2, "fields 归一成数组", p1.fields);
const p2 = store.addDataProof(eng.id, {
  asset_id: ext.id, target: "203.0.113.10", source: "api", interface: "/api/orders",
  fields: "订单号,金额", row_count: 300,
});
ok(p2.meets_threshold === false, "row_count 300 → 未达门槛");
ok(p2.fields.length === 2, "fields 传字符串也能切分", p2.fields);

let threw = false;
try { store.addDataProof(eng.id, { fields: ["x"], row_count: -1 }) } catch { threw = true }
ok(threw, "row_count 负数 → 抛错");
threw = false;
try { store.addDataProof(eng.id, { row_count: 10, fields: [] }) } catch { threw = true }
ok(threw, "fields 为空 → 抛错（写清泄露字段才算证明）");

const listed = store.listDataProofs(eng.id, {});
ok(listed.total === 2, "listDataProofs 总数", listed.total);
ok(store.listDataProofs(eng.id, { target: "203.0.113.10" }).total === 2, "按 target 过滤");
ok(store.listDataProofs(eng.id, { asset_id: inn.id }).total === 0, "按 asset_id 过滤：内网那台没有证明");

/* ── 3. 四段式报告 ──────────────────────────────────────────── */
section("[3] reportV2");
const r2 = store.reportV2(eng.id);
const base = store.scoreReport(eng.id);

ok(r2.summary.points === base.summary.points, "总分与 scoreReport 一致（不重算）", [r2.summary.points, base.summary.points]);
ok(r2.summary.items === base.items.length, "条目数与 scoreReport 一致", [r2.summary.items, base.items.length]);
ok(typeof r2.markdown === "string" && r2.markdown.length > 0, "markdown 原样带出（下载 .md 用它）");

/* 一、归属证明 */
const inet = r2.asset_proof.internet || [];
const entries = r2.asset_proof.internal_entry || [];
ok(inet.length === 1 && inet[0].ip === "203.0.113.10", "1.1 只有外网那台", inet.map((x) => x.ip));
ok(inet[0].strength === "strong", "外网那台有数据样本 → 强归属", inet[0].strength);
ok(inet[0].data_proofs.length === 2, "证明卡带上两条 data_proof", inet[0].data_proofs.length);
ok(entries.length === 1 && entries[0].ip === "10.1.2.3", "1.2 只收真正进去的内网资产", entries.map((x) => x.ip));
ok(!entries.some((x) => x.ip === "10.9.9.9"), "只是被发现的内网资产不进 1.2（旁路扫到的打印机）");
ok(bypass !== undefined, "那台打印机确实在资产库里（不是没查到）");

/* 二、汇总表 */
ok(Array.isArray(r2.stage_summary) && r2.stage_summary.length > 0, "阶段汇总非空");
const sumPts = r2.stage_summary.reduce((n, s) => n + s.points, 0);
ok(sumPts === r2.summary.points, "各阶段分值之和 = 总分", [sumPts, r2.summary.points]);
const tableCount = Object.values(r2.stage_tables).reduce((n, rows) => n + rows.length, 0);
ok(tableCount === r2.summary.items, "分阶段明细行数 = 条目数", [tableCount, r2.summary.items]);

/* 三、复现 */
const internetRepro = r2.repro.internet || [];
ok(internetRepro.length >= 1, "3.1 有互联网复现条目", internetRepro.length);
ok(internetRepro.every((x) => x.stage_code === "internet"), "3.1 只装 internet 阶段");
ok((r2.repro.target || []).length >= 1, "3.4 有靶标权限条目", (r2.repro.target || []).length);
ok((r2.repro.target || []).every((x) => x.stage_code === "target"), "3.4 只装 target 阶段");
const first = internetRepro[0];
ok(first.replay_cmd !== null || first.http.length > 0, "复现条目至少给命令或报文");
ok(Array.isArray(first.gaps), "复现条目带 gaps 数组");
ok(first.gaps.length > 0, "没截图时 gaps 会点名「没有截图」", first.gaps);
ok(typeof first.chain_no === "number", "复现条目带链路序号（与报告正文对得上）");
ok(r2.summary.reproducible >= 1, "可复现计数 ≥ 1", r2.summary.reproducible);

/* 内网按 /24 分段 */
ok(Array.isArray(r2.repro.internal_segments), "3.3 内网按网段分组");
ok(r2.repro.internal_segments.every((s) => typeof s.segment === "string"), "每个分段都有 segment 标识",
  r2.repro.internal_segments.map((s) => s.segment));

/* 四、交付清单 */
ok(r2.cleanup && r2.cleanup.total === 0, "没有清理项时 total=0");
store.addCleanup(eng.id, { kind: "webshell", target: "203.0.113.10", title: "上传的 cmd.jsp" });
store.addCleanup(eng.id, { kind: "account", target: "10.1.2.3", title: "自建 root2" });
const r2b = store.reportV2(eng.id);
ok(r2b.cleanup.total === 2, "清理项进了第四段", r2b.cleanup.total);
ok(r2b.cleanup.open === 2, "未处理计数", r2b.cleanup.open);

/* ── 4. 未挂资产的证明 ─────────────────────────────────────── */
section("[4] orphan 证明");
store.addDataProof(eng.id, { target: "某未登记系统", fields: ["手机号"], row_count: 5000 });
const r2c = store.reportV2(eng.id);
ok((r2c.asset_proof.orphan || []).length === 1, "只写 target 的证明单列进 1.3",
  (r2c.asset_proof.orphan || []).map((x) => x.target));
ok(r2c.asset_proof.orphan[0].total_rows === 5000, "orphan 带行数合计");

/* ── 5. 空靶标不炸 ─────────────────────────────────────────── */
section("[5] 边界");
const empty = store.openEngagement("空靶标");
const r2e = store.reportV2(empty.id);
ok(r2e.summary.points === 0 && r2e.summary.items === 0, "空靶标：0 分 0 项");
ok((r2e.asset_proof.internet || []).length === 0, "空靶标：归属证明为空数组而不是 null");
ok(Array.isArray(r2e.repro.internal_segments), "空靶标：内网分段是空数组");
ok(r2e.cleanup.total === 0, "空靶标：清理段可读");

console.log("\n" + (fail === 0 ? "全部通过" : "失败 " + fail + " 项") + "：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
