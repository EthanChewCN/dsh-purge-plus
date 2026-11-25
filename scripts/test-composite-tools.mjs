#!/usr/bin/env node
// [dsh-purge-plus] P11 回归：授权范围核对 + 隧道实测。
//
// 这两件事都属于「说错了会让人去碰不该碰的东西」，所以不靠读代码判断：
//   · 范围核对的 CIDR 数学必须逐位验（/0、/8、/24、/32、非整字节边界）；
//   · 隧道实测必须验「连不上时要如实说连不上」，而不是给一个空结果当成功。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "plus-scope-"));
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

/* ── 1. 范围核对 ───────────────────────────────────────────── */
section("[1] scopeCheckTarget");
const eng = store.openEngagement("范围回归", ["203.0.113.0/24", "10.0.0.0/8", "192.168.7.9/32"]);
const c = (t) => store.scopeCheckTarget(eng.id, t);

ok(store.engagementScope(eng.id).length === 3, "engagementScope 读回三条范围");
ok(c("203.0.113.10").status === "in", "/24 内的地址判 in", c("203.0.113.10"));
ok(c("203.0.114.10").status === "out", "/24 外的地址判 out");
ok(c("10.255.255.255").status === "in", "/8 的最后一个地址判 in（掩码边界）");
ok(c("11.0.0.1").status === "out", "/8 之外判 out");
ok(c("192.168.7.9").status === "in", "/32 精确命中");
ok(c("192.168.7.10").status === "out", "/32 隔壁判 out");
ok(c("http://203.0.113.10/admin").status === "in", "URL 形式能取出 IP");
ok(c("203.0.113.10:8443").status === "in", "host:port 形式能取出 IP");
ok(c("203.0.113.10").cidr === "203.0.113.0/24", "命中时回带命中的 CIDR", c("203.0.113.10").cidr);

const u = c("portal.example.com");
ok(u.status === "unresolved", "域名不解析，判 unresolved（核对不产生网络副作用）", u.status);
ok(u.ip === null, "unresolved 时不编造 IP");
const v6 = c("fe80::1");
ok(v6.status === "unresolved", "IPv6 判 unresolved（不猜）", v6.status);

const unscoped = store.openEngagement("没写范围的靶标");
ok(store.scopeCheckTarget(unscoped.id, "1.2.3.4").status === "unscoped", "没记范围判 unscoped（不阻断但要提示）");

const zero = store.openEngagement("全放行", ["0.0.0.0/0"]);
ok(store.scopeCheckTarget(zero.id, "8.8.8.8").status === "in", "/0 掩码算对（8.8.8.8 在范围内）");
ok(store.scopeCheckTarget(zero.id, "10.0.0.1").status === "in", "/0 掩码：内网地址也在");

/* 非整字节掩码：/25 应该把 203.0.113.0/24 切成两半 */
const half = store.openEngagement("半段", ["203.0.113.0/25"]);
ok(store.scopeCheckTarget(half.id, "203.0.113.100").status === "in", "/25 前半段判 in");
ok(store.scopeCheckTarget(half.id, "203.0.113.200").status === "out", "/25 后半段判 out");

/* 脏数据：范围里混了域名/空串，不能因此把一切判成 out */
const dirty = store.openEngagement("脏范围", ["", "  ", "example.com", "203.0.113.0/24"]);
ok(store.scopeCheckTarget(dirty.id, "203.0.113.5").status === "in", "范围里混脏数据仍能命中有效 CIDR");
ok(store.scopeCheckTarget(dirty.id, "198.51.100.1").status === "out", "脏数据不会让一切判 in");

/* ── 2. 隧道实测 ───────────────────────────────────────────── */
section("[2] pivotProbe");
const probe = await store.pivotProbe("127.0.0.1:1", ["10.1.2.3:22", "10.1.2.4:80"], 800);
ok(probe.total === 2, "两个目标都尝试了", probe.total);
ok(probe.reachable === 0, "没有隧道时可达数为 0（不是 undefined）");
ok(probe.probes.every((p) => p.ok === false), "每个目标都如实报 ok:false");
ok(probe.probes.every((p) => typeof p.error === "string" && p.error !== ""), "失败时带原因", probe.probes.map((p) => p.error));

const badListen = await store.pivotProbe("not-a-port", ["10.1.2.3:22"], 500);
ok(typeof badListen.error === "string", "listen 解析不了时明确报错", badListen.error);
ok((badListen.probes || []).length === 0, "listen 坏掉时不做无意义的探测");

const empty = await store.pivotProbe("127.0.0.1:1080", [], 500);
ok(empty.total === 0 && empty.reachable === 0, "空目标列表返回 0/0，不抛错");

const capped = await store.pivotProbe("127.0.0.1:1", Array.from({ length: 60 }, (_, i) => "10.0.0." + (i + 1) + ":22"), 200);
ok(capped.total === 50, "目标数上限 50（超出的截掉）", capped.total);

console.log("\n" + (fail === 0 ? "全部通过" : "失败 " + fail + " 项") + "：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
