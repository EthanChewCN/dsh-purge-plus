#!/usr/bin/env node
// [dsh-purge-plus] 故障注入门禁（审计 B-12：验收只会「查字符串在不在」，从不构造故障）。
//
// 做法：把 dist/build/package 整份复制到临时目录 → 在副本里**故意改坏一处行为** →
// 跑指定的回归脚本 → 断言它**必须变红**。改坏之后仍然全绿，说明那条测试守的不是行为。
//
// 为什么必须有基线：一条测试本来就在红（比如环境缺依赖），任何变异都会「被检出」，
// 那这个门禁等于恒绿。所以每个变异前先跑一次未改动的副本，基线必须绿。
//
// 判据（R17 收紧）：变红还不够 —— 必须是**断言级**变红。测试崩在未捕获异常上、
// 或者干脆没跑到汇总行，都只能说明「改坏了会炸」，说明不了「这条测试守住了这个行为」。
// 所以要求：退出码非 0 **且** 输出里仍有 `N 通过 / M 失败` 且 M > 0。
//
// 用法：
//   node scripts/mutate-check.mjs                      全部跑一遍
//   node scripts/mutate-check.mjs --only=M3            只跑一个（调试用）
//   node scripts/mutate-check.mjs --manifest=/tmp/x.json  换一份清单（并行补变异时用）
//   node scripts/mutate-check.mjs --list               只打印清单

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 仓库里用 dist/build/package；装好的包里 ROOT 本身就是产物根。 */
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;
const MANIFEST = path.resolve((process.argv.find((a) => a.startsWith("--manifest=")) || "").slice(11)
  || path.join(ROOT, "scripts", "mutations.json"));

const argv = process.argv.slice(2);
const only = (argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const listOnly = argv.includes("--list");

const mutations = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const picked = only ? mutations.filter((m) => m.id === only) : mutations;
if (listOnly) {
  for (const m of mutations) console.log(`${m.id}  ${m.test}  ${m.why}`);
  process.exit(0);
}
if (picked.length === 0) {
  console.error(`没有匹配的变异：--only=${only}`);
  process.exit(2);
}

/** 复制一份包到临时目录（副本里跑测试，仓库与已装产物都不动）。 */
function clonePackage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plus-mut-"));
  fs.cpSync(PKG, dir, { recursive: true, verbatimSymlinks: true });
  return dir;
}

/** 在副本里跑一个回归脚本，返回 { code, out }。 */
function runTest(dir, script) {
  try {
    const out = execFileSync(process.execPath, [path.join("scripts", script)], {
      cwd: dir, encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status === undefined ? 1 : e.status, out: String(e.stdout || "") + String(e.stderr || "") };
  }
}

/* 汇总行有两族写法，都得认：
     A  `N 通过 / M 失败`（可带 `✓ test-x：` 前缀或换行）
     B  `✗ test-x：K 条失败 / T 条`（cleanup / coverage 这类「按用例计」的脚本）
   只认一族会把另一族的失败当成「没跑到汇总行」。 */
const SUMMARY_A = /(\d+)\s*通过\s*\/\s*(\d+)\s*失败/;
const SUMMARY_B = /✗\s*test-[a-z0-9-]+：(\d+)\s*条失败\s*\/\s*(\d+)\s*条/;

/** 解析汇总行 → { total, failed } | null。 */
function summary(out) {
  const a = out.match(SUMMARY_A);
  if (a) return { total: Number(a[1]) + Number(a[2]), failed: Number(a[2]) };
  const b = out.match(SUMMARY_B);
  if (b) return { total: Number(b[2]), failed: Number(b[1]) };
  return null;
}

/** 断言测试输出里确实有断言（避免「脚本直接 exit 0」被当成通过）。 */
function hasAssertions(out) {
  const s = summary(out);
  return s !== null && s.total > 0;
}

/* 断言级失败。两条都算：
     - 跑到汇总行且失败数 > 0
     - 打印过 `✗` 断言行（之后可能因为后续行引用了空结果而抛异常 —— 断言已经响了，
       只是那条测试没把空结果护住。M16 就是这种：先 ✗「命中 0 条」，再在
       `items[0].path` 上抛。把这种判成「没检出」等于否认已经响过的断言）
   基线必须是全绿的（见下面 baseline 检查），所以这里出现的 ✗ 只可能由本次改坏引起。 */
function assertionFailure(out) {
  const s = summary(out);
  if (s !== null && s.failed > 0) return true;
  return /(^|\n)\s*✗\s/.test(out);
}

let detected = 0;
const missed = [];
const baselineCache = new Map();

for (const m of picked) {
  const dir = clonePackage();
  try {
    const file = path.join(dir, m.file);
    if (!fs.existsSync(file)) { missed.push({ id: m.id, why: "目标文件不存在：" + m.file }); continue; }
    const src = fs.readFileSync(file, "utf8");
    const hits = src.split(m.find).length - 1;
    if (hits !== 1) { missed.push({ id: m.id, why: `锚点在 ${m.file} 里命中 ${hits} 次（要求恰好 1 次）` }); continue; }

    /* 基线：同一份副本、未改动 → 必须绿且真的有断言 */
    let base = baselineCache.get(m.test);
    if (base === undefined) {
      base = runTest(dir, m.test);
      baselineCache.set(m.test, base);
    }
    if (base.code !== 0 || !hasAssertions(base.out)) {
      missed.push({ id: m.id, why: `基线不健康（${m.test} 在未改动副本上 ${base.code === 0 ? "没有断言" : "exit " + base.code}）` });
      continue;
    }

    fs.writeFileSync(file, src.replace(m.find, m.replace), "utf8");
    const res = runTest(dir, m.test);
    /* 「检出」= 断言级变红。三种不算：
       - 语法/模块解析崩（改坏的方式不合法）
       - 退出码 0（测试对这次改坏无感）
       - 非 0 但没跑到汇总行（崩在异常上，说明不了这条断言守住了行为） */
    const syntaxCrash = /SyntaxError|Cannot find module|ERR_MODULE_NOT_FOUND/.test(res.out);
    if (res.code !== 0 && !syntaxCrash && assertionFailure(res.out)) {
      detected += 1;
      console.log(`  ✓ ${m.id} 被检出（${m.test} 断言失败）`);
    } else {
      const why = syntaxCrash ? "变异把代码改成了语法错误（红得没有意义）"
        : res.code === 0 ? "改坏之后仍然全绿"
          : "变红了但没跑到汇总行（崩在异常上，不是断言守住的）";
      missed.push({ id: m.id, why });
      console.log(`  ✗ ${m.id} 未被检出（${m.test}：${why}）`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log("");
if (missed.length > 0) {
  for (const x of missed) console.error(`  ✗ ${x.id}：${x.why}`);
  console.error(`故障注入：${detected}/${picked.length} 被检出`);
  process.exit(1);
}
console.log(`故障注入：${detected}/${picked.length} 被检出`);
