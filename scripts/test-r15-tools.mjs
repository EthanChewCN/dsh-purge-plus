#!/usr/bin/env node
// [dsh-purge-plus] R15：工具层的两条契约。
//
// 1. 并发闸门 `redteam_agent_slot` 的回报口径。
//    safe 2.0.2 的枚举只有 progress/ready/blocked/waiting，子智能体想报 failed/dropped
//    会被参数校验直接拒掉 —— 「失败了」这件事根本传不回来。而且 action 必填、
//    又有一个同名 status 参数，调用方无法判断 action=status 到底是「查看」还是「回报」。
//
// 2. 无靶标时工具层的回执。
//    16 处 `ok:true, note:'还没有靶标'` 是死分支（解析器先抛），但口径与 op 层
//    （ok:false + no_target:true）不一致；解析器将来一旦返回空串，失败会静默。
//
// 这个脚本要 import 真正的 tools.js，而它依赖宿主包 `@deepseek-ai/dsh-tools`。
// 找不到宿主就**跳过**（打印 SKIP），不把环境缺失算成失败。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const HERE = path.resolve(import.meta.dirname, "..");
const PKG = fs.existsSync(path.join(HERE, "dist", "build", "package"))
  ? path.join(HERE, "dist", "build", "package")
  : HERE;

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m) => { fail++; console.error("  ✗ " + m); };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(`${m}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`));

/** 找一个能 require('@deepseek-ai/dsh-tools') 的宿主包，返回它的 package.json 路径。 */
function findHostPkg() {
  const cands = [
    process.env.PURGE_DSH_CLI,
    "/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai/dsh/package.json",
  ];
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  for (const profile of ["desktop", "web", "default"]) {
    cands.push(path.join(home, "profiles", profile, "node_modules", "@deepseek-ai", "dsh", "package.json"));
  }
  for (const p of cands) {
    if (!p || !fs.existsSync(p)) continue;
    try {
      const mod = createRequire(p)("@deepseek-ai/dsh-tools");
      if (mod && typeof (mod.defineTool || mod.default?.defineTool) === "function") return p;
    } catch { /* 下一个 */ }
  }
  return null;
}

const host = findHostPkg();
if (host === null) {
  console.log("SKIP：本机找不到宿主包 @deepseek-ai/dsh（工具层契约需要它才能加载）");
  console.log("0 通过 / 0 失败");
  process.exit(0);
}
process.env.PURGE_DSH_CLI = host;

const { RedteamStore } = await import(path.join(PKG, "lib", "redteam", "store-core.js"));
const { apply } = await import(path.join(PKG, "lib", "redteam", "tools.js"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plus-r15-tools-"));
const store = new RedteamStore(path.join(tmp, "redteam"));
const tools = [];
const ctx = {
  tools: { register: (t) => tools.push(t) },
  get: (n) => (n === "redteam" ? store : undefined),
  redteam: store,
  effect: () => {}, on: () => () => {},
  logger: { warn() {}, info() {}, error() {} },
  subagents: { listChildren: async () => ({ children: [] }) },
};
apply(ctx);

const slot = tools.find((t) => t.name === "redteam_agent_slot");
const main = { agent: { session: { id: "MAIN" } } };
const child = { agent: { session: { id: "CHILD1", header: { parentSession: "MAIN" } } } };
const call = async (args, exec) => JSON.parse(await slot.execute(args, exec));

console.log("[1] 并发闸门：回报状态");
{
  const a = await call({ action: "acquire", label: "样本" }, main);
  eq(a.ok, true, "主会话能占名额");

  const blocked = await call({ report: "blocked" }, child);
  eq(blocked.ok, true, "report=blocked 不必再传 action（旧代码要求 action 必填）");
  eq(blocked.reported, "blocked", "回执带 reported");
  eq(blocked.parked, true, "blocked 时 parked=true（让出名额）");

  for (const st of ["failed", "dropped"]) {
    const r = await call({ report: st }, child);
    eq(r.ok, true, `report=${st} 被接受（safe 的枚举里没有这两个值，旧代码直接参数报错）`);
    eq(r.parked, false, `${st} 不占名额`);
  }

  const legacy = await call({ action: "status", status: "blocked" }, child);
  eq(legacy.ok, true, "旧写法 action=status + status=blocked 仍可用");
  eq(legacy.reported, "blocked", "旧写法照常回报");
  eq(typeof legacy.deprecated, "string", "旧写法回执里标了 deprecated");

  const asMain = await call({ report: "blocked" }, main);
  eq(asMain.ok, false, "主会话填 report 被拒");
}

console.log("[2] 无靶标：目标相关工具必须是 ok:false");
{
  const rows = [];
  for (const t of tools) {
    let j;
    try { j = JSON.parse(await t.execute({}, main)); } catch { j = { ok: undefined }; }
    rows.push([t.name, j]);
  }
  /* 这些工具与靶标无关，ok:true 是对的 */
  const INDEPENDENT = new Set([
    "redteam_session_info", "redteam_roles", "redteam_agent_slot",
    "redteam_intel", "redteam_template_refresh", "redteam_proxy_pool",
    "redteam_poc_search", "redteam_poc_list", "redteam_cve",
  ]);
  const leaking = rows.filter(([name, j]) => j.ok === true && !INDEPENDENT.has(name));
  eq(leaking.map(([n]) => n), [], "没有任何目标相关工具在无靶标时返回 ok:true");

  const attention = rows.find(([n]) => n === "redteam_attention")[1];
  eq(attention.ok, false, "attention 无靶标时 ok:false");
  eq(attention.no_target === true || attention.reason === "engagement_ambiguous", true, "并且说清是「没靶标」而不是空数据");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
