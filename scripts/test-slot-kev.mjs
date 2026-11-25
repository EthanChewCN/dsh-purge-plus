#!/usr/bin/env node
// [dsh-purge-plus] 名额挂起（slot-state）与公告层（kev）的接线测试。
//
// 为什么要单独一个脚本：这两个模块都是 safe 2.0.2 原样移植，**移植 ≠ 生效**。
// 2026-11-25 的三方审计（docs/audit/AUDIT-3WAY）就是靠可达性分析才发现
// 它们已经躺在包里却没有任何调用方。所以这里测两件事：
//   ① 模块本身的行为（纯函数，可离线）；
//   ② 接线点确实存在（tools.js 里真的 import 了、真的调了）。
// ② 用源码断言是不得已：park/unpark 的调用点埋在工具执行的闭包里，
// 没有宿主就跑不起来。配合 verify [35] 的可达性检查，两条一起才能防住
// 「模块在、没人调」这一类回归。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 既能在仓库里跑（dist/build/package），也能在**已安装的包里**跑（脚本所在包的根）——
   发布包现在带 test-*.mjs，验收可以对已安装产物复跑（审计 B-5）。 */
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m) => { fail++; console.error("  ✗ " + m); };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(`${m}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`));

function pkgPath(rel) {
  const p = path.join(PKG, rel);
  if (fs.existsSync(p)) return p;
  return path.join(ROOT, "overlay", "files", rel);
}

console.log("[1] slot-state：挂起语义");
{
  const mod = await import(path.join(pkgPath("lib/redteam/slot-state.js")));
  const { parkAgent, unparkAgent, isParked } = mod;

  eq(isParked("r1", "c1"), false, "未挂起时 isParked 为 false");
  parkAgent("r1", "c1");
  eq(isParked("r1", "c1"), true, "挂起后 isParked 为 true");
  eq(isParked("r1", "c2"), false, "同根不同子互不影响");
  eq(isParked("r2", "c1"), false, "同子不同根互不影响");
  eq(unparkAgent("r1", "c1"), true, "摘标记返回 true");
  eq(isParked("r1", "c1"), false, "摘掉后 isParked 为 false");
  eq(unparkAgent("r1", "c1"), false, "重复摘返回 false（不抛）");
  parkAgent("r1", 7);
  eq(isParked("r1", "7"), true, "数字 id 与字符串 id 归一");
  eq(parkAgent(undefined, "x"), false, "缺参数返回 false 而不是写入");
}

console.log("[2] slot-state：容量保护（长开进程不无限增长）");
{
  const mod = await import(path.join(pkgPath("lib/redteam/slot-state.js")));
  /* 上限保护作用在「根会话」这一层（Map 的键），不是每个根下的子集合 ——
     这是 safe 原版语义（slot-state.js:19 capMap），照抄不改：
     实际用量是「一台机器上同时开几个根会话」，不是「一个根下挂多少子」。 */
  for (let i = 0; i < 600; i++) mod.parkAgent(`root${i}`, `c${i}`);
  eq(mod.isParked("root0", "c0"), false, "超出上限后最早的根被挤掉");
  eq(mod.isParked("root599", "c599"), true, "最新的根仍在");
}

console.log("[3] kev：两种数据形状都要认（本包 intel/kev.json 是 CISA 原始载荷）");
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kev-"));
  const mod = await import(path.join(pkgPath("lib/redteam/kev.js")) + `?v=${Date.now()}`);

  eq(mod.kevStatus(root).available, false, "没有缓存文件时 available=false");

  fs.mkdirSync(path.join(root, "intel"), { recursive: true });
  fs.writeFileSync(path.join(root, "intel", "kev.json"), JSON.stringify({
    dateReleased: "2026-11-20T00:00:00Z",
    vulnerabilities: [
      { cveID: "CVE-2021-44228", vendorProject: "Apache", product: "Log4j2", vulnerabilityName: "Log4Shell", dateAdded: "2021-12-10", knownRansomwareCampaignUse: "Known" },
      { cveID: "CVE-2023-34362", vendorProject: "Progress", product: "MOVEit", vulnerabilityName: "MOVEit SQLi", dateAdded: "2023-06-02", knownRansomwareCampaignUse: "Unknown" },
    ],
  }), "utf8");

  const st = mod.kevStatus(root);
  eq(st.available, true, "CISA 原始形状：available=true");
  eq(st.count, 2, "CISA 原始形状：条数按 vulnerabilities 数出来");

  const hits = mod.lookupKev(root, ["CVE-2021-44228", "cve-2023-34362", "CVE-1999-0001"]);
  eq(hits.map((h) => h.cve).sort(), ["CVE-2021-44228", "CVE-2023-34362"], "命中查询：大小写不敏感、不存在的查不到");
  eq(hits.find((h) => h.cve === "CVE-2021-44228").ransomware, true, "勒索标记被规范化成布尔");

  /* 兼容 safe 原版形状（items[]），且旧路径仍能读 */
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "kev2-"));
  fs.mkdirSync(path.join(root2, "kb"), { recursive: true });
  fs.writeFileSync(path.join(root2, "kb", "cve-kev.json"), JSON.stringify({
    fetched_at: Date.now(), count: 1, items: [{ cve: "CVE-2024-0001" }],
  }), "utf8");
  const mod2 = await import(path.join(pkgPath("lib/redteam/kev.js")) + `?v=${Date.now()}b`);
  eq(mod2.lookupKev(root2, ["CVE-2024-0001"]).length, 1, "safe 原版形状 + 旧路径 kb/cve-kev.json 仍可读");
  eq(mod2.kevStatus(root2).count, 1, "旧路径的条数正确");
}

console.log("[4] 接线点：tools.js 真的 import 并调用了它们");
{
  const src = fs.readFileSync(path.join(PKG, "lib/redteam/tools.js"), "utf8");
  src.includes("from './slot-state.js'")
    ? ok("tools.js import 了 slot-state")
    : bad("tools.js 没有 import slot-state —— 模块又会变成死代码");
  src.includes("parkAgent(rootId, childId)")
    ? ok("回报 blocked/waiting 时挂起")
    : bad("缺少「回报受阻时挂起」的调用");
  src.includes("unparkAgent(rootId, childId)")
    ? ok("子智能体结束时摘挂起标记")
    : bad("缺少「结束即摘标记」的调用");
  src.includes("!isParked(rootSessionId, e.id)")
    ? ok("实时并发数扣掉挂起的")
    : bad("并发数没有扣掉挂起的 —— 挂起等于没挂");
  src.includes("parked: live.parked")
    ? ok("工具返回里带 parked 计数")
    : bad("工具返回里没有 parked 字段");

  const cveSrc = fs.readFileSync(path.join(PKG, "lib/redteam/tools.js"), "utf8");
  cveSrc.includes("import('./kev.js')")
    ? ok("redteam_cve 动态加载了 kev")
    : bad("redteam_cve 没有用 kev —— 公告层仍是死的");
  cveSrc.includes("lookupKev")
    ? ok("CVE 查询用了 lookupKev")
    : bad("CVE 查询没有用 lookupKev");
}

/* 汇总行格式与其它 test-*.mjs 一致：verify [33] 按「N 通过 / M 失败」汇总断言数 */
console.log(`${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
