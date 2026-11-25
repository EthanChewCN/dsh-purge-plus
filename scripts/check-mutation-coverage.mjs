#!/usr/bin/env node
// [dsh-purge-plus] 变异覆盖门禁（R17）
//
// [47] 只要求「每个行为组声明一条回归脚本」。但声明了不等于守住了：一条从没被
// 改坏过的回归，和一条不存在的回归，在验收输出里长得一模一样。
//
// 所以再进一步：**每个行为组至少要有一条变异认领它**。变异条目里写
//   "groups": [19]
// 表示「这条改坏的就是 [19] 所声明的那个行为」。判定规则：
//
//   1. 认领必须有效 —— 组号是行为组，且该组声明的测试里包含这条变异的 test
//   2. 每个行为组至少被一条有效认领覆盖
//   3. 变异本身要能被 mutate-check 跑出「断言级变红」（那是 [46] 的事）
//
// 为什么用 `groups` 而不是「按测试名反推」：一条回归脚本常常横跨多个组
// （test-r13-fixes.mjs 同时守 CVE 检索、任务板、补丁状态、备份），按名字反推
// 会让「随便哪个组的变异」都算覆盖。认领是显式的，错了看得出来。
//
// 孤儿变异（没写 groups）**算失败**（R18 起）。R17 时允许它存在，理由是「它们证明
// [33] 汇总里那条回归会红」。实测结果是：13 条变异成了孤儿，对应 13 条 R11–R15 修好的
// 真实缺陷 —— 它们在验收面上根本不存在，只有变异门禁自己知道被守住了。
// 允许孤儿 = 允许「这条修复没有任何验收组认领」悄悄堆积，所以现在必须认领（[50] 就是
// 为这批补的）。
//
// 用法：
//   node scripts/check-mutation-coverage.mjs
//   node scripts/check-mutation-coverage.mjs --file scripts/verify.mjs --manifest scripts/mutations.json
//   node scripts/check-mutation-coverage.mjs --json

import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const ROOT = path.resolve(import.meta.dirname, "..");
const FILE = path.resolve(argOf("file", path.join(ROOT, "scripts", "verify.mjs")));
const MANIFEST = path.resolve(argOf("manifest", path.join(ROOT, "scripts", "mutations.json")));
const asJson = argv.includes("--json");

const src = fs.readFileSync(FILE, "utf8");
/* 与 check-proof-classes.mjs 同一套解析规则：组头 = console.log("[N] 标题"); 行尾可带 // 声明。 */
const heads = [...src.matchAll(/console\.log\("(?:\\n)?\[(\d+)\][^"]*"\)(.*)$/gm)];
const mutations = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

const groups = new Map();
for (const h of heads) {
  const tail = h[2] || "";
  const m = tail.match(/\/\/\s*(结构|回归\s+(.+))$/);
  if (!m || m[1] === "结构") continue;
  groups.set(Number(h[1]), { id: Number(h[1]), tests: m[2].split(",").map((s) => s.trim()).filter(Boolean) });
}

const ids = mutations.map((mu) => mu.id);
const dupIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
const badShape = mutations
  .filter((mu) => !mu.id || !mu.file || !mu.find || mu.replace === undefined || !mu.test || !mu.why)
  .map((mu) => mu.id || "(无 id)");

const invalid = [];
const claimsByGroup = new Map();
const unattached = [];
for (const mu of mutations) {
  const claimed = Array.isArray(mu.groups) ? mu.groups : [];
  if (claimed.length === 0) { unattached.push(mu.id); continue; }
  for (const gid of claimed) {
    const g = groups.get(Number(gid));
    if (!g) { invalid.push(`${mu.id} 认领的 [${gid}] 不是行为组`); continue; }
    if (!g.tests.includes(mu.test)) {
      invalid.push(`${mu.id} 认领 [${gid}]，但该组声明的是 ${g.tests.join(" / ")}，不含 ${mu.test}`);
      continue;
    }
    if (!claimsByGroup.has(g.id)) claimsByGroup.set(g.id, []);
    claimsByGroup.get(g.id).push(mu.id);
  }
}

const uncovered = [...groups.values()].filter((g) => !claimsByGroup.has(g.id)).map((g) => g.id);

const problems = [];
if (groups.size === 0) problems.push(`没有解析到任何行为组：${FILE}`);
if (mutations.length === 0) problems.push(`清单里没有任何变异：${MANIFEST}`);
if (uncovered.length > 0) problems.push(`有 ${uncovered.length} 个行为组没有任何变异认领：${uncovered.map((i) => `[${i}]`).join(" ")}`);
if (unattached.length > 0) problems.push(`有 ${unattached.length} 条孤儿变异（没写 groups）：${unattached.join("、")}`);
if (invalid.length > 0) problems.push(...invalid.map((x) => `无效认领：${x}`));
if (dupIds.length > 0) problems.push(`变异 id 重复：${dupIds.join(", ")}`);
if (badShape.length > 0) problems.push(`变异条目缺字段：${badShape.join(", ")}`);

const result = {
  file: FILE,
  manifest: MANIFEST,
  groups: groups.size,
  mutations: mutations.length,
  covered: groups.size - uncovered.length,
  uncovered,
  unattached,
  problems,
  ok: problems.length === 0,
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log(`变异覆盖：行为组 ${groups.size} · 有变异认领 ${result.covered} · 变异 ${mutations.length}`
    + ` · 孤儿 ${unattached.length} · OK`);
} else {
  console.log(`变异覆盖：行为组 ${groups.size} · 有变异认领 ${result.covered} · 变异 ${mutations.length}`);
  for (const p of problems) console.error(`  FAIL ${p}`);
}
process.exit(result.ok ? 0 : 1);
