#!/usr/bin/env node
// [dsh-purge-plus] 行为归属门禁自己的回归（审计 B-3 的元测试）
//
// scripts/check-proof-classes.mjs 是「验收组必须声明 结构/回归」的判定器。
// 判定器本身如果不判，验收会显示「归属完整」而实际没人管 —— 和它要防的东西同形。
// 所以这里用合成输入逐个把判定器弄坏，断言它必须红。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const CHECKER = path.join(ROOT, "scripts", "check-proof-classes.mjs");

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m) => { fail++; console.error("  ✗ " + m); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "proof-cls-"));
/* 假包：只有这两个测试文件「在包里」 */
const PKG = path.join(tmp, "pkg");
fs.mkdirSync(path.join(PKG, "scripts"), { recursive: true });
for (const n of ["test-alpha.mjs", "test-beta.mjs"]) {
  fs.writeFileSync(path.join(PKG, "scripts", n), "// stub\n", "utf8");
}

/* 判定器里的两个下限从**判定器源码**读，不在这里抄一份。
   抄一份的后果已经发生过两次：下限提到 26/24 之后，这里的 22/26 立刻变成
   「合格输入被判红」—— 元测试红得对，但红的原因是它自己过期了，不是判定器坏了。 */
const checkerSrc = fs.readFileSync(CHECKER, "utf8");
const MIN_BEH = Number((checkerSrc.match(/MIN_BEHAVIORAL = (\d+)/) || [])[1]);
const MIN_STR = Number((checkerSrc.match(/MIN_STRUCTURAL = (\d+)/) || [])[1]);

/** 造一份「验收文件」：beh 组标 回归、str 组标 结构，extra 是附加行。 */
function makeFile(name, { beh = MIN_BEH, str = MIN_STR, testName = "test-alpha.mjs", extra = [] } = {}) {
  const lines = [];
  let id = 0;
  for (let i = 0; i < beh; i += 1) {
    id += 1;
    lines.push(`console.log("[${id}] 行为组 ${id}");  // 回归 ${testName}`);
  }
  for (let i = 0; i < str; i += 1) {
    id += 1;
    lines.push(`console.log("[${id}] 结构组 ${id}");  // 结构`);
  }
  lines.push(...extra);
  const fp = path.join(tmp, name);
  fs.writeFileSync(fp, lines.join("\n") + "\n", "utf8");
  return fp;
}

function run(file) {
  try {
    const out = execFileSync(process.execPath, [CHECKER, `--file=${file}`, `--pkg=${PKG}`], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

console.log("[1] 合格输入必须通过（否则后面所有「红」都没意义）");
{
  /* 下限本身也要有地板：把 MIN_BEHAVIORAL 改成 1 能让这一组永远绿。 */
  MIN_BEH >= 26 && MIN_STR >= 24
    ? ok(`判定器下限 ${MIN_BEH} / ${MIN_STR}（地板 26 / 24）`)
    : bad(`判定器下限被调低：${MIN_BEH} / ${MIN_STR}`);
  const r = run(makeFile("good.mjs"));
  r.code === 0 ? ok(`${MIN_BEH} 行为 + ${MIN_STR} 结构 → 通过`) : bad(`合格输入被判红：${r.out.trim()}`);
  new RegExp(`行为 ${MIN_BEH}`).test(r.out) ? ok("计数如实输出") : bad(`计数不对：${r.out.trim()}`);
}

console.log("[2] 少一个声明 → 必须红，并点出组号");
{
  const fp = makeFile("unmarked.mjs", {
    extra: ['console.log("[99] 忘了声明");'],
  });
  const r = run(fp);
  r.code !== 0 && /没有声明 结构\/回归：99/.test(r.out)
    ? ok("未声明组被点出来")
    : bad(`未声明组没被抓：${r.out.trim()}`);
}

console.log("[3] 声明的脚本不在包里 → 必须红");
{
  const r = run(makeFile("ghost.mjs", { testName: "test-ghost.mjs" }));
  r.code !== 0 && /test-ghost\.mjs（包内没有）/.test(r.out)
    ? ok("包内缺失的脚本被点出来")
    : bad(`幽灵脚本没被抓：${r.out.trim()}`);
}

console.log("[4] 全标结构 → 必须红（这是绕过本门禁最省事的办法）");
{
  const r = run(makeFile("allstruct.mjs", { beh: 0, str: MIN_BEH + MIN_STR }));
  r.code !== 0 && /行为组只有 0 个/.test(r.out)
    ? ok("全标结构被拒")
    : bad(`全标结构通过了：${r.out.trim()}`);
}

console.log("[5] 组号重复 → 必须红");
{
  const fp = makeFile("dup.mjs", { extra: ['console.log("[1] 重号");  // 结构'] });
  const r = run(fp);
  r.code !== 0 && /组号重复：1/.test(r.out) ? ok("重号被点出来") : bad(`重号没被抓：${r.out.trim()}`);
}

console.log("[6] 测试名格式不对 → 必须红（防止写成路径穿越或任意文件）");
{
  const fp = makeFile("badname.mjs", { extra: [] });
  fs.writeFileSync(fp, fs.readFileSync(fp, "utf8").replace("// 回归 test-alpha.mjs", "// 回归 ../../etc/passwd"), "utf8");
  const r = run(fp);
  r.code !== 0 ? ok("非法名字被拒") : bad("非法名字通过了");
}

console.log("[7] 一个组都没有 → 必须红（脚本被清空时的兜底）");
{
  const fp = path.join(tmp, "empty.mjs");
  fs.writeFileSync(fp, "// nothing\n", "utf8");
  const r = run(fp);
  r.code !== 0 && /没有解析到任何验收组/.test(r.out) ? ok("空文件被拒") : bad(`空文件通过了：${r.out.trim()}`);
}

console.log("[8] 真实 verify.mjs 必须通过（用它自己的包路径，不是上面的假包）");
{
  let r;
  try {
    const out = execFileSync(process.execPath, [CHECKER, `--file=${path.join(ROOT, "scripts", "verify.mjs")}`], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    r = { code: 0, out };
  } catch (e) {
    r = { code: e.status ?? 1, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
  r.code === 0 ? ok(`真实验收文件归属完整（${(r.out.match(/行为 (\d+)/) || [])[1]} 个行为组）`) : bad(`真实验收文件被判红：${r.out.trim()}`);
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
