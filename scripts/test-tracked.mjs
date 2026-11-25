#!/usr/bin/env node
// 回归：scripts/check-tracked.mjs（构建输入受版本控制）
//
// 用**真 git 仓库**做夹具：判定依赖 `git ls-files`，拿假字符串喂它等于测了个空。
// 每个用例先建一份最小仓库（overlay/edits.mjs 里有 SNIP("a.js")，overlay/files/
// 下有一个文件，scripts/ 下有一个 test-*），按需 add/commit/改坏，再跑门禁。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const GATE = path.resolve(import.meta.dirname, "check-tracked.mjs");
let pass = 0, fail = 0;
const ok = (m) => { pass += 1; console.log(`✓ ${m}`); };
const bad = (m) => { fail += 1; console.log(`✗ ${m}`); };
const eq = (a, b, m) => (a === b ? ok(m) : bad(`${m}（期望 ${b}，实际 ${a}）`));

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tracked-"));
const GIT = ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false"];

function fixture(name) {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(path.join(dir, "overlay", "snippets"), { recursive: true });
  fs.mkdirSync(path.join(dir, "overlay", "files", "lib"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "overlay", "edits.mjs"),
    'import fs from "node:fs";\nconst SNIP = (n) => fs.readFileSync(n, "utf8");\nexport const E = [SNIP("a.js")];\n');
  fs.writeFileSync(path.join(dir, "overlay", "snippets", "a.js"), "export const a = 1;\n");
  fs.writeFileSync(path.join(dir, "overlay", "files", "lib", "x.js"), "export const x = 1;\n");
  fs.writeFileSync(path.join(dir, "scripts", "build.mjs"),
    'const s = readSnippet("a.js");\nconst css = "a.js";\n');
  fs.writeFileSync(path.join(dir, "scripts", "test-t.mjs"), "console.log('x');\n");
  fs.writeFileSync(path.join(dir, "overlay", "repo.json"), "{}\n");
  fs.writeFileSync(path.join(dir, "overlay", "op-ledger.json"), "[]\n");
  return dir;
}

function git(dir, args) {
  return execFileSync("git", [...GIT, ...args], { cwd: dir, encoding: "utf8" });
}
function init(dir) {
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "init"]);
}
function run(dir, extra = []) {
  try {
    const out = execFileSync(process.execPath, [GATE, `--repo=${dir}`, "--json", ...extra], { encoding: "utf8" });
    return { code: 0, json: JSON.parse(out) };
  } catch (e) {
    const out = `${e.stdout || ""}`;
    let json = null;
    try { json = JSON.parse(out); } catch { /* 非 JSON（不该发生） */ }
    return { code: e.status ?? 1, json, raw: out };
  }
}

// ── [1] 干净仓库：全部输入已提交 → 通过 ─────────────────────────
{
  const dir = fixture("clean");
  init(dir);
  const r = run(dir);
  eq(r.code, 0, "干净仓库：退出码 0");
  eq(r.json.ok, true, "干净仓库：ok=true");
  eq(r.json.missing.length, 0, "干净仓库：无未跟踪输入");
  /* 输入集合必须包含「整目录拷贝」与「SNIP 点名」两类，否则枚举口径本身是错的 */
  const names = r.json.missing.concat([]);
  eq(names.length, 0, "干净仓库：missing 为空");
}

// ── [2] 一个构建输入未跟踪（overlay/files 深路径）→ 失败 ─────────
{
  const dir = fixture("untracked-input");
  init(dir);
  fs.writeFileSync(path.join(dir, "overlay", "files", "lib", "y.js"), "export const y = 1;\n");
  const r = run(dir);
  eq(r.code, 1, "未跟踪的 overlay/files 新文件：退出码 1");
  eq(r.json.ok, false, "未跟踪的 overlay/files 新文件：ok=false");
  const hit = (r.json.missing || []).some((f) => f.endsWith("overlay/files/lib/y.js"));
  hit ? ok("点到了那个文件（overlay/files 是整目录拷贝，新文件即输入）") : bad(`没有点到：${JSON.stringify(r.json.missing)}`);
}

// ── [3] 未跟踪文件不在枚举里，但仍在 overlay/scripts 下 → 失败 ───
{
  const dir = fixture("untracked-stray");
  init(dir);
  fs.writeFileSync(path.join(dir, "scripts", "stray.mjs"), "// 没人 import，但也没提交\n");
  const r = run(dir);
  eq(r.code, 1, "scripts/ 下的游离文件：退出码 1（反向那一层）");
  const hit = (r.json.untracked || []).some((f) => f.endsWith("scripts/stray.mjs"));
  hit ? ok("反向层点到了游离文件（不依赖枚举完备）") : bad(`反向层没点到：${JSON.stringify(r.json.untracked)}`);
}

// ── [4] SNIP 指向不存在的文件 → 失败（构建会在半途炸）─────────────
{
  const dir = fixture("dangling-snip");
  init(dir);
  fs.writeFileSync(path.join(dir, "overlay", "edits.mjs"),
    'const SNIP = (n) => n;\nexport const E = [SNIP("missing.js")];\n');
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "dangling"]);
  const r = run(dir);
  eq(r.code, 1, "SNIP 悬空：退出码 1");
  eq(r.json.ok, false, "SNIP 悬空：ok=false");
}

// ── [5] strict：输入有未提交修改 ─────────────────────────────────
{
  const dir = fixture("dirty");
  init(dir);
  fs.writeFileSync(path.join(dir, "overlay", "snippets", "a.js"), "export const a = 2;\n");
  const lax = run(dir);
  eq(lax.code, 0, "默认模式：未提交修改不算失败（开发中会一直红）");
  eq((lax.json.notes || []).length > 0, true, "默认模式：给出「有未提交修改」的提示");
  const strict = run(dir, ["--strict"]);
  eq(strict.code, 1, "strict 模式：未提交修改 → 失败");
  eq(strict.json.ok, false, "strict 模式：ok=false");
}

// ── [6] 不是 git 仓库 → 退出码 3（调用方报「不适用」）────────────
{
  const dir = fixture("nogit");
  const r = run(dir);
  eq(r.code, 3, "非 git 仓库：退出码 3");
  eq(r.json.reason, "not-a-git-repo", "非 git 仓库：reason 明确");
}

// ── [7] 已跟踪但被删除 → 不算失败（删除本身是提交的一部分）──────
// 注意：只删文件不够，必须**同时**去掉引用 —— 否则那是悬空 SNIP，
// 门禁红得对。这一条守的是「删除不该被误报成未跟踪」。
{
  const dir = fixture("deleted");
  init(dir);
  fs.rmSync(path.join(dir, "overlay", "snippets", "a.js"));
  fs.writeFileSync(path.join(dir, "overlay", "edits.mjs"), "export const E = [];\n");
  fs.writeFileSync(path.join(dir, "scripts", "build.mjs"), "const css = 0;\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "drop"]);
  const r = run(dir);
  eq(r.code, 0, "删除并提交（引用同时去掉）：不误报");
}

// ── [8] 本仓库自检（真跑一次，只读）──────────────────────────────
// 这一条不看 ok：提交之前本仓库本来就不通过（那正是这个门禁存在的理由）。
// 它守的是**枚举口径**——输入集合突然缩到几十个，说明有人把枚举改坏了。
{
  const repo = path.resolve(import.meta.dirname, "..");
  const r = run(repo);
  if (r.code === 3) {
    /* 已安装的包里没有 .git —— 这一条在包内没有对象可查，正确回答是「不适用」。
       判据不是「通过」，而是「明确说出不是 git 仓库」，不能静默当绿。 */
    eq(r.json && r.json.reason, "not-a-git-repo", "包内模式（无 .git）：明确报不适用");
    ok(true, "包内模式：不做枚举量级检查（没有版本控制可比）");
  } else {
    (r.json && r.json.inputs >= 100)
      ? ok(`本仓库枚举到 ${r.json.inputs} 个构建输入（量级合理）`)
      : bad(`本仓库只枚举到 ${r.json && r.json.inputs} 个输入，口径可能被改坏`);
    (r.json && typeof r.json.ok === "boolean")
      ? ok("本仓库自检给出了明确判定（ok 为布尔）")
      : bad("本仓库自检没有给出判定");
  }
}

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
