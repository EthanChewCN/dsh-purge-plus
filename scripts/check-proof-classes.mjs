#!/usr/bin/env node
// [dsh-purge-plus] 行为归属门禁（审计 B-3）
//
// 问题：验收里大量断言只是「这行字符串还在文件里」。那种断言能证明代码没被删，
// 但证明不了它做对了事 —— R11 的 18 条缺陷全都在「44/45 组全绿」的验收下活着。
//
// 做法：每个验收组必须在行尾声明它凭什么算数：
//
//   console.log("[12] P0 静默失败四件");  // 回归 test-silent-failures.mjs
//   console.log("[2] 补丁表不变式");      // 结构
//
//   // 结构            —— 断言的是构建产物本身（计数、命名、文档一致性、能否 import）
//   // 回归 test-a.mjs —— 断言的是行为，由那条回归脚本证明（可逗号列多条）
//
// 本脚本只做「归属是否完整」的判定，不判断归属得对不对 —— 那是人和变异门禁的事
// （scripts/mutate-check.mjs 负责证明「声明的测试真的会红」）。
//
// 用法：
//   node scripts/check-proof-classes.mjs                 # 查 scripts/verify.mjs
//   node scripts/check-proof-classes.mjs --file X.mjs    # 查别的文件
//   node scripts/check-proof-classes.mjs --pkg DIR       # 指定「包内 scripts」在哪
//   node scripts/check-proof-classes.mjs --json

import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const ROOT = path.resolve(import.meta.dirname, "..");
const FILE = path.resolve(argOf("file", path.join(ROOT, "scripts", "verify.mjs")));
const PKG = path.resolve(argOf("pkg",
  fs.existsSync(path.join(ROOT, "dist", "build", "package"))
    ? path.join(ROOT, "dist", "build", "package")
    : ROOT));
const asJson = argv.includes("--json");

/** 期望的组数下限。防止「把组拆碎/合并」绕过归属检查。
 *  R17 起两个数都锁到当前实际值：把某个行为组改标成「结构」是绕过 [48]
 *  变异覆盖最省事的办法（结构组不需要变异），所以行为组少一个就必须红。 */
const MIN_BEHAVIORAL = 26;
const MIN_STRUCTURAL = 24;

const src = fs.readFileSync(FILE, "utf8");
/* 组头 = console.log("[N] 标题"); 行尾可带 // 声明。
   允许字符串里以 \n 开头（[23] 就是这么写的）：漏掉这种写法会让那一组
   既不被统计、也不被要求声明 —— 门禁自己开的天窗。 */
const heads = [...src.matchAll(/console\.log\("(?:\\n)?\[(\d+)\][^"]*"\)(.*)$/gm)];

const structural = [];
const behavioral = [];
const unmarked = [];
const badTest = [];
const dup = [];
const seen = new Set();

for (const h of heads) {
  const id = Number(h[1]);
  if (seen.has(id)) dup.push(id);
  seen.add(id);

  const tail = h[2] || "";
  const m = tail.match(/\/\/\s*(结构|回归\s+(.+))$/);
  if (!m) { unmarked.push(id); continue; }
  if (m[1] === "结构") { structural.push(id); continue; }

  const names = m[2].split(",").map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) { unmarked.push(id); continue; }
  for (const n of names) {
    if (!/^test-[a-z0-9-]+\.mjs$/.test(n)) badTest.push(`${id}:${n}（名字不合法）`);
    else if (!fs.existsSync(path.join(PKG, "scripts", n))) badTest.push(`${id}:${n}（包内没有）`);
  }
  behavioral.push(id);
}

const problems = [];
if (heads.length === 0) problems.push(`没有解析到任何验收组：${FILE}`);
if (dup.length > 0) problems.push(`组号重复：${dup.join(", ")}`);
if (unmarked.length > 0) problems.push(`没有声明 结构/回归：${unmarked.join(", ")}`);
if (badTest.length > 0) problems.push(`声明的回归脚本有问题：${badTest.join(", ")}`);
if (behavioral.length < MIN_BEHAVIORAL) problems.push(`行为组只有 ${behavioral.length} 个，下限 ${MIN_BEHAVIORAL}`);
if (structural.length < MIN_STRUCTURAL) problems.push(`结构组只有 ${structural.length} 个，下限 ${MIN_STRUCTURAL}`);

const result = {
  file: FILE,
  groups: heads.length,
  structural: structural.length,
  behavioral: behavioral.length,
  unmarked,
  badTest,
  dup,
  problems,
  ok: problems.length === 0,
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log(`行为归属：${heads.length} 组 · 结构 ${structural.length} · 行为 ${behavioral.length} · OK`);
} else {
  console.log(`行为归属：${heads.length} 组 · 结构 ${structural.length} · 行为 ${behavioral.length}`);
  for (const p of problems) console.error(`  FAIL ${p}`);
}
process.exit(result.ok ? 0 : 1);
