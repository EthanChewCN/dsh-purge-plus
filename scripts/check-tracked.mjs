#!/usr/bin/env node
// [dsh-purge-plus] 构建输入受版本控制（R18）
//
// 问题（R15 的同一类，只是发生在 git 层）：`dist/` 不进 git，构建**完全**由
// `overlay/` 与 `scripts/` 决定。只要有一个构建输入没被提交，别人克隆一次再
// `node scripts/build.mjs`，产出的包就与本机这份**不是同一个东西** —— 而且
// 构建照样成功、验收照样全绿（验收跑的是本机那份 dist，不是克隆出来的）。
//
// R17 收尾时实测：34 个未跟踪文件里 12 个是 overlay 构建输入、4 个是随包分发
// 的验收脚本。也就是说「克隆能重建出这个包」当时是假的。
//
// 判据分两层：
//   1) 正向：枚举出的每个构建输入都必须在 `git ls-files` 里；
//   2) 反向：`overlay/` 与 `scripts/` 下不允许存在任何未跟踪文件 —— 这一条不依赖
//      枚举是否完备，新加一个输入却忘了提交，同样会红。
// 另加两条健全性：SNIP("x") 指向的文件必须存在（否则构建会在半途炸）；
// `overlay/files/**` 必须被 build.mjs 整目录拷贝（枚举方式与构建一致）。
//
// 用法：
//   node scripts/check-tracked.mjs                 # 查本仓库
//   node scripts/check-tracked.mjs --repo=DIR      # 查指定仓库（回归用）
//   node scripts/check-tracked.mjs --strict        # 输入有未提交修改也算失败
//   node scripts/check-tracked.mjs --json
// 退出码：0 通过 / 1 不通过 / 3 不是 git 仓库（调用方据此报「不适用」）

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const REPO = path.resolve(argOf("repo", path.resolve(import.meta.dirname, "..")));
const STRICT = argv.includes("--strict");
const asJson = argv.includes("--json");

const problems = [];
const notes = [];

function git(args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

try {
  /* 探测时把 git 自己的 stderr 吞掉：非仓库是很正常的一种输入
     （已安装的包里就没有 .git），不该在验收输出里留一行 fatal。 */
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"],
    { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch {
  if (asJson) console.log(JSON.stringify({ ok: null, reason: "not-a-git-repo", repo: REPO }));
  else console.log(`不适用：${REPO} 不是 git 仓库（已安装的包没有 .git）`);
  process.exit(3);
}

// ── 枚举构建输入 ────────────────────────────────────────────────
const rel = (p) => path.relative(REPO, p).split(path.sep).join("/");

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const editsPath = path.join(REPO, "overlay", "edits.mjs");
const buildPath = path.join(REPO, "scripts", "build.mjs");
const editsSrc = fs.existsSync(editsPath) ? fs.readFileSync(editsPath, "utf8") : "";
const buildSrc = fs.existsSync(buildPath) ? fs.readFileSync(buildPath, "utf8") : "";

const SNIP_DIR = path.join(REPO, "overlay", "snippets");
const inputs = new Set();

/* overlay/files/**：build.mjs 用 cpSync 整目录覆盖，所以目录下每一个文件都是输入。
   这条不能改成「只算被引用的」—— 拷进去就进包，与有没有人 import 无关。 */
for (const f of walk(path.join(REPO, "overlay", "files"))) inputs.add(rel(f));

/* overlay/snippets/**：只算真的被读的那几个（SNIP("x") / readSnippet("x") /
   build.mjs 里的 src: "x.css"）。 */
const snipRefs = new Set();
for (const m of editsSrc.matchAll(/SNIP\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) snipRefs.add(m[1]);
for (const m of buildSrc.matchAll(/readSnippet\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) snipRefs.add(m[1]);
for (const m of buildSrc.matchAll(/["'`]([A-Za-z0-9._-]+\.(?:js|css))["'`]/g)) {
  if (fs.existsSync(path.join(SNIP_DIR, m[1]))) snipRefs.add(m[1]);
}
const danglingSnips = [];
for (const name of snipRefs) {
  const p = path.join(SNIP_DIR, name);
  if (fs.existsSync(p)) inputs.add(rel(p));
  else danglingSnips.push(name);
}
if (danglingSnips.length > 0) problems.push(`SNIP 指向的文件不存在：${danglingSnips.join("、")}`);

/* overlay 的其它真源：edits.mjs 本身、repo.json（发布坐标）、op-ledger.json（op 契约分母）。 */
for (const name of ["edits.mjs", "repo.json", "op-ledger.json"]) {
  const p = path.join(REPO, "overlay", name);
  if (fs.existsSync(p)) inputs.add(rel(p));
}

/* scripts/：build.mjs 会拷贝 test-*.mjs + 固定助手清单 + CVE 构建器。
   这里直接按「构建真的读什么」枚举；反向那条会兜住漏枚举的新文件。 */
const shippedHelpers = ["verify.mjs", "check-op-contract.mjs", "check-proof-classes.mjs",
  "check-mutation-coverage.mjs", "check-vendor-drift.mjs", "mutate-check.mjs", "mutations.json",
  "build-cve-db.mjs"];
const scriptsDir = path.join(REPO, "scripts");
if (fs.existsSync(scriptsDir)) {
  for (const name of fs.readdirSync(scriptsDir)) {
    if (/^test-.*\.mjs$/.test(name) || shippedHelpers.includes(name)) inputs.add(rel(path.join(scriptsDir, name)));
  }
}
/* 构建脚本自己也是输入：改了它而没提交，克隆出来的包同样不是这一份。 */
for (const p of [buildPath, path.join(scriptsDir, "check-tracked.mjs")]) {
  if (fs.existsSync(p)) inputs.add(rel(p));
}

// ── 1) 正向：每个输入都被跟踪 ───────────────────────────────────
const tracked = new Set(
  git(["ls-files", "-z", "--", "overlay", "scripts"]).split("\0").filter(Boolean),
);
const missing = [...inputs].filter((f) => !tracked.has(f)).sort();
if (missing.length > 0) problems.push(`构建输入未被跟踪（${missing.length} 个）：${missing.join("、")}`);

// ── 2) 反向：overlay/ 与 scripts/ 下不许有未跟踪文件 ─────────────
const untracked = git(["ls-files", "-z", "--others", "--exclude-standard", "--", "overlay", "scripts"])
  .split("\0").filter(Boolean).sort();
if (untracked.length > 0) problems.push(`overlay/ 或 scripts/ 下有未跟踪文件（${untracked.length} 个）：${untracked.join("、")}`);

// ── 3) strict：输入有未提交修改 → 克隆出来的不是这一份 ───────────
const dirty = git(["status", "--porcelain", "-z", "--", "overlay", "scripts"])
  .split("\0").filter(Boolean)
  .map((s) => s.slice(3))
  .filter((f) => inputs.has(f));
if (STRICT && dirty.length > 0) {
  problems.push(`构建输入有未提交修改（${dirty.length} 个）：${dirty.join("、")}`);
} else if (dirty.length > 0) {
  notes.push(`构建输入有未提交修改 ${dirty.length} 个（--strict 会失败）`);
}

const ok = problems.length === 0;
if (asJson) {
  console.log(JSON.stringify({ ok, inputs: inputs.size, tracked: tracked.size, missing, untracked, dirty, notes }, null, 2));
} else {
  console.log(`构建输入：${inputs.size} 个 · 已跟踪 ${inputs.size - missing.length} · 未跟踪 ${untracked.length}`);
  for (const n of notes) console.log(`   · ${n}`);
  if (!ok) for (const p of problems) console.log(`FAIL ${p}`);
  console.log(ok ? "构建输入受版本控制：OK" : "构建输入受版本控制：FAIL");
}
process.exit(ok ? 0 : 1);
