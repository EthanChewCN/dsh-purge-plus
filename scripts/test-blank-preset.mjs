#!/usr/bin/env node
// [dsh-purge-plus] P24 回归：#207 / #208 —— 复用空白会话时沿用日志里记下的预设。
//
// 这两条补丁的失效方式很隐蔽：打不上时不报错，只是「下拉里选的红队模式
// 发一句话就变回标准模式」。而且补丁本身是**插入代码**，字符串存在不等于
// 逻辑正确 —— 判据写反、取错来源、没兜住墓碑 id，都会让补丁看起来 applied
// 却毫无作用。
//
// 所以这里做两件事：
//   1. 把两条补丁真打到宿主文件的副本上，用 node --check 验语法；
//   2. 从打过补丁的文本里**原样切出插入的代码块**，注入假 ctx / 假 observed
//      跑真值表 —— 测的是将来真跑起来的那几行字节，不是重新写一遍的等价物。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
/* 既能在仓库里跑（dist/build/package），也能在**已安装的包里**跑（脚本所在包的根）——
   发布包现在带 test-*.mjs，验收可以对已安装产物复跑（审计 B-5）。 */
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;
if (!fs.existsSync(PKG)) {
  console.error("dist/build/package 不存在，先跑 node scripts/build.mjs");
  process.exit(1);
}
const AI_BASE = process.env.DSH_BASE
  || "/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai";
const HOST = path.join(AI_BASE, "dsh-api-session-controller", "lib", "index.js");
if (!fs.existsSync(HOST)) {
  console.error(`宿主文件不存在: ${HOST}`);
  process.exit(1);
}

const { applyReplacementsToText } = await import(pathToFileURL(path.join(PKG, "lib", "core", "verify.mjs")).href);
const { OVERLAY_PATCHES } = await import(pathToFileURL(path.join(PKG, "lib", "patches", "overlay.mjs")).href);

let pass = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) { pass += 1; return; }
  fails.push(name + (extra === undefined ? "" : " → " + JSON.stringify(extra)));
}

const p207 = OVERLAY_PATCHES.find((p) => p.id === 207);
const p208 = OVERLAY_PATCHES.find((p) => p.id === 208);
ok(!!p207, "补丁表含 #207");
ok(!!p208, "补丁表含 #208");
if (!p207 || !p208) { console.log(`\n${pass} 通过 / ${fails.length} 失败`); for (const f of fails) console.log("  ✗ " + f); process.exit(1); }

// ── 1. 真打到宿主副本上 ────────────────────────────────────────────
// 宿主文件可能**已经被打过**（本插件装好后 --apply 就写进去了）。那种情况下
// skipIfMarked 会让 applyReplacementsToText 直接返回原文，测试就成了空转。
// 所以先按补丁自身的 replace→pattern 反向还原出干净基线，再正着打一遍 ——
// 这与引擎里 revert 用的是同一个手法（split(替换物).join(锚点)）。
function unapply(text, p) {
  let out = text;
  for (const { pattern, replace } of p.replacements) {
    if (typeof pattern === "string" && typeof replace === "string" && out.includes(replace)) {
      out = out.split(replace).join(pattern);
    }
  }
  return out;
}
const pristine = unapply(unapply(fs.readFileSync(HOST, "utf8"), p208), p207);
const original = pristine;
let patched = original;
ok(!pristine.includes(p207.markers[0]) && !pristine.includes(p208.markers[0]),
  "基线已还原为未打补丁状态（否则后面的断言是空转）");
for (const p of [p207, p208]) {
  const r = applyReplacementsToText(patched, p, HOST);
  ok(!r.hitMismatch, `#${p.id} 命中数契约满足`, r.hitMismatch);
  ok(r.changed, `#${p.id} 产生了改动`);
  patched = r.text;
}

const tmp = path.join(os.tmpdir(), `dshpp-blank-preset-${process.pid}.mjs`);
fs.writeFileSync(tmp, patched);
let syntaxOk = true;
try {
  execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
} catch (e) {
  syntaxOk = false;
  ok(false, "打过补丁的文件能过 node --check", String(e.stderr || e.message).slice(0, 400));
}
if (syntaxOk) ok(true, "打过补丁的文件能过 node --check");
fs.rmSync(tmp, { force: true });

// 幂等：再打一次不该再改
for (const p of [p207, p208]) {
  const again = applyReplacementsToText(patched, p, HOST);
  ok(!again.changed, `#${p.id} 二次应用是幂等的（marker 生效）`);
}

// 原文其余部分必须原样保留：只允许增加，不允许减少
const originalLines = original.split("\n").length;
const patchedLines = patched.split("\n").length;
ok(patchedLines > originalLines, "补丁是纯插入（行数增加）", { originalLines, patchedLines });
ok(patched.includes("const composition = await this.composeAgent(request.agentPreset);"),
  "原有的 composeAgent 调用仍在");

// ── 2. 切出插入的代码块 ────────────────────────────────────────────
// 从 marker 注释往后找第一个 `if (request.agentPreset ===`，按花括号配对取整块。
function extractBlock(text, marker) {
  const at = text.indexOf(marker);
  if (at < 0) return "";
  const start = text.indexOf("if (request.agentPreset ===", at);
  if (start < 0) return "";
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return "";
}
const block207 = extractBlock(patched, p207.markers[0]);
const block208 = extractBlock(patched, p208.markers[0]);
ok(block207.length > 0, "#207 插入块可切出");
ok(block208.length > 0, "#208 插入块可切出");
ok(block207.includes("observed.projections"), "#207 走 projections 快路径");
ok(block207.includes("agent-preset/selected"), "#207 有事件回退");
ok(block208.includes("this.presetForSession"), "#208 用 presetForSession 取记录");

// ── 3. 注入假 ctx 跑真值表 ─────────────────────────────────────────
// 切出来的块是 `claim()` 方法体的一部分：用到 this.ctx.get / this.presetForSession /
// request / observed。这里原样包进 async 函数执行。
function runner(block) {
  const fn = new Function("request", "observed", "live", `
    return (async function () {
      ${block}
      return request;
    }).call(this);
  `);
  return (self, request, observed, live) => fn.call(self, request, observed, live);
}
const run207 = runner(block207);
const run208 = runner(block208);

const presets = (known) => ({
  get: (name) => name === "agentPresets"
    ? { resolve: async (id) => { if (!known.includes(id)) throw new Error("unknown preset"); return { id }; } }
    : undefined,
});
const selfFor = (known, recordedForSession) => ({
  ctx: presets(known),
  presetForSession: () => recordedForSession,
});
const obs = (projected, events) => ({
  projections: projected === undefined ? undefined : { values: { agentPreset: projected } },
  events,
});
const sel = (id) => ({ type: "agent-preset/selected", data: { agentPreset: id } });

// —— #207 冷路径 ——
{
  const req = await run207(selfFor(["redteam", "standard"]), { cwd: "/w" }, obs(undefined, [sel("redteam")]));
  ok(req.agentPreset === "redteam", "#207 事件里记着 redteam → 沿用 redteam", req.agentPreset);
}
{
  const req = await run207(selfFor(["redteam", "standard"]), { cwd: "/w" }, obs("redteam", [sel("standard")]));
  ok(req.agentPreset === "redteam", "#207 projections 优先于事件扫描", req.agentPreset);
}
{
  const req = await run207(selfFor(["redteam", "standard"]), { cwd: "/w" }, obs(undefined, [sel("redteam"), sel("standard")]));
  ok(req.agentPreset === "standard", "#207 多条事件取最后一条", req.agentPreset);
}
{
  const req = await run207(selfFor(["redteam", "standard"]), { cwd: "/w", agentPreset: "standard" }, obs("redteam", [sel("redteam")]));
  ok(req.agentPreset === "standard", "#207 请求点名预设时不覆盖", req.agentPreset);
}
{
  const req = await run207(selfFor([]), { cwd: "/w" }, obs("gone-plugin-preset", [sel("gone-plugin-preset")]));
  ok(req.agentPreset === undefined, "#207 名册不认的墓碑 id 不沿用（不把创建打挂）", req.agentPreset);
}
{
  const self = { ctx: { get: () => undefined }, presetForSession: () => "redteam" };
  const req = await run207(self, { cwd: "/w" }, obs("redteam", [sel("redteam")]));
  ok(req.agentPreset === undefined, "#207 没有 agentPresets 服务时保持原样", req.agentPreset);
}
{
  const self = { ctx: { get: () => ({ resolve: async () => { throw new Error("boom"); } }) }, presetForSession: () => "redteam" };
  const req = await run207(self, { cwd: "/w" }, obs("redteam", [sel("redteam")]));
  ok(req.agentPreset === undefined, "#207 resolve 抛错时吞掉并保持原样", req.agentPreset);
}
{
  const req = await run207(selfFor(["redteam"]), { cwd: "/w" }, obs(undefined, []));
  ok(req.agentPreset === undefined, "#207 日志里没有记录时不乱猜", req.agentPreset);
}

// —— #208 活路径 ——
{
  const req = await run208(selfFor(["redteam", "standard"], "redteam"), { cwd: "/w" }, undefined, {});
  ok(req.agentPreset === "redteam", "#208 活会话记着 redteam → 沿用 redteam", req.agentPreset);
}
{
  const req = await run208(selfFor(["redteam", "standard"], "redteam"), { cwd: "/w", agentPreset: "standard" }, undefined, {});
  ok(req.agentPreset === "standard", "#208 请求点名预设时不覆盖", req.agentPreset);
}
{
  const req = await run208(selfFor(["redteam", "standard"], "gone"), { cwd: "/w" }, undefined, {});
  ok(req.agentPreset === undefined, "#208 墓碑 id 不沿用", req.agentPreset);
}
{
  const req = await run208(selfFor(["redteam", "standard"], undefined), { cwd: "/w" }, undefined, {});
  ok(req.agentPreset === undefined, "#208 没记预设时保持原样", req.agentPreset);
}
{
  const self = { ctx: { get: () => undefined }, presetForSession: () => "redteam" };
  const req = await run208(self, { cwd: "/w" }, undefined, {});
  ok(req.agentPreset === undefined, "#208 没有 agentPresets 服务时保持原样", req.agentPreset);
}

// ── 4. 两条补丁的分工：不能互相顶掉 ────────────────────────────────
ok(!p207.replacements[0].replace.includes("presetForSession"),
  "#207 不依赖 presetForSession（冷会话没有 session 对象）");
ok(p208.replacements[0].replace.includes("presetForSession"),
  "#208 走 presetForSession（活会话有 session）");
// claim() 里 `if (live !== void 0)` 在 observeSession 之前，所以 208 的插入点
// 必须比 207 靠前；顺序反了说明有一条插错了分支。
ok(patched.indexOf(p208.markers[0]) < patched.indexOf(p207.markers[0]),
  "#208 插在活分支、#207 插在冷分支（活分支在前）",
  { live: patched.indexOf(p208.markers[0]), cold: patched.indexOf(p207.markers[0]) });

console.log(`\n${pass} 通过 / ${fails.length} 失败`);
if (fails.length) {
  for (const f of fails) console.log("  ✗ " + f);
  process.exit(1);
}
