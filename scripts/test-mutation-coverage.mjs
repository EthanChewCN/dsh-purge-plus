#!/usr/bin/env node
// [dsh-purge-plus] 变异覆盖门禁自己的回归（R17 的元测试）
//
// scripts/check-mutation-coverage.mjs 是「每个行为组都要有变异认领」的判定器。
// 判定器不判的时候，验收会显示「覆盖完整」而实际没人管 —— 与它要防的东西同形。
// 这里用合成输入把判定器逐个弄坏，断言它必须红。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const CHECKER = path.join(ROOT, "scripts", "check-mutation-coverage.mjs");

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m) => { fail++; console.error("  ✗ " + m); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mut-cov-"));

/** 造一份验收文件：两个行为组 + 一个结构组。 */
function makeVerify(name, extra = []) {
  const fp = path.join(tmp, name);
  fs.writeFileSync(fp, [
    'console.log("[1] 行为组一");  // 回归 test-alpha.mjs',
    'console.log("[2] 行为组二");  // 回归 test-beta.mjs',
    'console.log("[3] 结构组");  // 结构',
    ...extra,
    "",
  ].join("\n"), "utf8");
  return fp;
}

function mutation(over) {
  return {
    id: "M-x", file: "lib/a.js", find: "a", replace: "b",
    test: "test-alpha.mjs", groups: [1], why: "合成用例",
    ...over,
  };
}

function run(manifest, file) {
  const mp = path.join(tmp, `${manifest.name || "m"}.json`);
  fs.writeFileSync(mp, JSON.stringify(manifest.items, null, 2), "utf8");
  try {
    const out = execFileSync(process.execPath, [
      CHECKER, `--file=${file}`, `--manifest=${mp}`,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

const GOOD = makeVerify("good.mjs");

console.log("[1] 每个行为组都有有效认领 → 通过");
{
  const r = run({ name: "good", items: [mutation({}), mutation({ id: "M-y", test: "test-beta.mjs", groups: [2] })] }, GOOD);
  r.code === 0 ? ok("两个行为组各一条认领 → 通过") : bad(`合格输入被判红：${r.out.trim()}`);
  /孤儿 0/.test(r.out) ? ok("孤儿计数如实输出") : bad(`孤儿计数不对：${r.out.trim()}`);
}

console.log("[2] 有一个组没人认领 → 必须红，并点出组号");
{
  const r = run({ name: "uncov", items: [mutation({})] }, GOOD);
  r.code !== 0 && /\[2\]/.test(r.out) && /没有任何变异认领/.test(r.out)
    ? ok("未覆盖的组被点出来")
    : bad(`未覆盖没被抓：${r.out.trim()}`);
}

console.log("[3] 认领结构组 → 必须红（结构组没有行为可证）");
{
  const r = run({ name: "struct", items: [mutation({ groups: [3] }), mutation({ id: "M-y", test: "test-beta.mjs", groups: [2] })] }, GOOD);
  r.code !== 0 && /不是行为组/.test(r.out) ? ok("认领结构组被拒") : bad(`认领结构组通过了：${r.out.trim()}`);
}

console.log("[4] 认领的组并不声明这条测试 → 必须红（挂错门）");
{
  const r = run({ name: "wrong", items: [mutation({ groups: [2] }), mutation({ id: "M-y", test: "test-beta.mjs", groups: [2] })] }, GOOD);
  r.code !== 0 && /不含 test-alpha\.mjs/.test(r.out) ? ok("错配被点出来") : bad(`错配没被抓：${r.out.trim()}`);
}

console.log("[5] 孤儿变异（没写 groups）→ R18 起判红");
{
  /* R17 时这条用例断言的是「孤儿只计数、不判红」。R18 改了规则：13 条孤儿对应
     13 条 R11–R15 修好的缺陷，它们在验收面上不存在 —— 允许孤儿就是允许
     「这条修复没人认领」悄悄堆积。旧断言因此反过来：必须红，且要点名。 */
  const r = run({ name: "orphan", items: [
    mutation({}), mutation({ id: "M-y", test: "test-beta.mjs", groups: [2] }),
    mutation({ id: "M-z", groups: undefined }),
  ] }, GOOD);
  r.code !== 0 && /孤儿变异/.test(r.out) && /M-z/.test(r.out)
    ? ok("孤儿被点名并判红")
    : bad(`孤儿处理不对：${r.out.trim()}`);
}

console.log("[6] 变异 id 重复 → 必须红");
{
  const r = run({ name: "dup", items: [mutation({}), mutation({ test: "test-beta.mjs", groups: [2] })] }, GOOD);
  r.code !== 0 && /id 重复/.test(r.out) ? ok("重号被点出来") : bad(`重号没被抓：${r.out.trim()}`);
}

console.log("[7] 条目缺字段 → 必须红（没有 why 的变异等于没写理由）");
{
  const r = run({ name: "shape", items: [
    mutation({ why: "" }), mutation({ id: "M-y", test: "test-beta.mjs", groups: [2] }),
  ] }, GOOD);
  r.code !== 0 && /缺字段/.test(r.out) ? ok("缺字段被点出来") : bad(`缺字段没被抓：${r.out.trim()}`);
}

console.log("[8] 空清单 → 必须红（脚本被清空时的兜底）");
{
  const r = run({ name: "empty", items: [] }, GOOD);
  r.code !== 0 && /没有任何变异/.test(r.out) ? ok("空清单被拒") : bad(`空清单通过了：${r.out.trim()}`);
}

console.log("[9] 真实 verify.mjs + 真实 mutations.json → 通过");
{
  try {
    const out = execFileSync(process.execPath, [CHECKER,
      `--file=${path.join(ROOT, "scripts", "verify.mjs")}`,
      `--manifest=${path.join(ROOT, "scripts", "mutations.json")}`,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    ok(`真实验收与清单一致（${(out.match(/行为组 (\d+)/) || [])[1]} 个行为组）`);
  } catch (e) {
    bad(`真实文件被判红：${`${e.stdout || ""}${e.stderr || ""}`.trim()}`);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
