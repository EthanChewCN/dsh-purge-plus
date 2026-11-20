#!/usr/bin/env node
// [dsh-purge-plus] 验收：只读地证明构建物可用，不写宿主、不改任何文件。
//
//   1. 包能 import（补丁表 / 围栏 / 入口）
//   2. 补丁表不变式：92 条、自有 4 条 ≥201、id 无重复
//   3. 真实宿主上 --status 能定位 @deepseek-ai 根（DSH_SURFACE=desktop）
//   4. 自有 4 条出现在状态里（pending/applied/drifted 均可，不能消失）
//   5. 锚点预演：每个自有补丁的 pattern 在宿主文件里的命中次数
//      —— 命中 0 次 = 宿主升级后锚点烂了，必须重写；命中 ≥2 次 = 会打歪。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const PKG = path.join(ROOT, "dist", "build", "package");
const AI_BASE = process.env.DSH_BASE
  || "/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai";

let failed = 0;
const ok = (s) => console.log(`  ✓ ${s}`);
const bad = (s) => { console.error(`  ✗ ${s}`); failed++; };

if (!fs.existsSync(PKG)) {
  console.error("dist/build/package 不存在，先跑 node scripts/build.mjs");
  process.exit(1);
}
console.log(`宿主根 ${AI_BASE}\n`);

// ── 1. import ───────────────────────────────────────────────────
console.log("[1] 模块可加载");
const probe = `
const idx = await import("./lib/patches/index.mjs");
const fence = await import("./lib/subagent-fence.js");
const ids = idx.ALL_PATCHES.map(p => p.id);
const ours = idx.ALL_PATCHES.filter(p => p.id >= 201);
console.log(JSON.stringify({
  total: ids.length,
  ours: ours.map(p => ({ id: p.id, name: p.name, file: p.file, patterns: (p.replacements||[]).map(r => r.pattern) })),
  dup: ids.filter((v,i)=>ids.indexOf(v)!==i),
  fence: typeof fence.installSubagentFence,
}));
`;
let r;
try {
  r = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", probe], { cwd: PKG, encoding: "utf8" }));
  ok("补丁表 / 围栏 可 import");
} catch (e) {
  bad(`import 失败：${e.stderr || e.message}`);
  process.exit(1);
}

// ── 2. 不变式 ───────────────────────────────────────────────────
console.log("[2] 补丁表不变式");
r.total === 92 ? ok(`总数 ${r.total}`) : bad(`总数应为 92，实际 ${r.total}`);
r.ours.length === 4 ? ok(`自有 ${r.ours.length} 条（≥201）`) : bad(`自有应为 4，实际 ${r.ours.length}`);
r.dup.length === 0 ? ok("id 无重复") : bad(`id 重复: ${r.dup}`);
r.fence === "function" ? ok("installSubagentFence 已导出") : bad(`围栏导出类型 ${r.fence}`);

// ── 3. 宿主定位 ─────────────────────────────────────────────────
console.log("[3] 真实宿主 --status");
let status = "";
try {
  status = execFileSync(process.execPath, ["bin/dsh-purge.js", "--status"], {
    cwd: PKG, encoding: "utf8",
    env: { ...process.env, DSH_SURFACE: "desktop", DSH_BASE: AI_BASE },
  });
  ok("--status 执行成功");
} catch (e) {
  bad(`--status 失败：${e.stderr || e.message}`);
}
if (status.includes(`插件根 / root  ${AI_BASE}`)) ok("宿主根解析正确");
else bad("宿主根未解析到预期路径（DSH_SURFACE=desktop 生效？）");

// ── 4. 自有补丁状态 ─────────────────────────────────────────────
console.log("[4] 自有补丁状态");
for (const p of r.ours) {
  const line = status.split("\n").find((l) => l.includes(`[#${p.id}]`));
  if (!line) { bad(`#${p.id} 未出现在状态输出`); continue; }
  if (/pending|applied|already|drifted/.test(line)) ok(`#${p.id} ${p.name}`);
  else bad(`#${p.id} 状态异常: ${line.trim()}`);
}

// ── 5. 锚点预演（用 --status 打印的真实路径，不猜 core 导出名）──────
console.log("[5] 锚点预演命中次数");
const fileMap = parseStatusPaths(status);
for (const p of r.ours) {
  const keys = Array.isArray(p.file) ? p.file : [p.file];
  const targets = keys.flatMap((k) => fileMap[k] || []);
  if (!targets.length) { bad(`#${p.id} 宿主文件键 ${keys.join(",")} 未解析到文件`); continue; }
  const counts = p.patterns.map((pat) => targets.reduce((n, fp) => n + countOcc(fs.readFileSync(fp, "utf8"), pat), 0));
  const already = targets.some((fp) => fs.readFileSync(fp, "utf8").includes("[dsh-purge-plus]"));
  const verdict = already
    ? "已含本仓库标记"
    : counts.every((c) => c === 1) ? "全部锚点恰好 1 次" : `命中 ${counts.join("/")} 次`;
  (already || counts.every((c) => c === 1)) ? ok(`#${p.id} ${targets.length} 文件 · ${verdict}`) : bad(`#${p.id} ${verdict} —— 锚点已漂移`);
}

console.log("");
if (failed) { console.error(`验收失败：${failed} 项`); process.exit(1); }
console.log("验收通过（本次全程只读，宿主未被修改）。");

// ── helpers ────────────────────────────────────────────────────
function countOcc(hay, needle) {
  if (!needle) return 0;
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}
function parseStatusPaths(text) {
  const map = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s{4}([a-z0-9-]+)\s+(\/\S.*)$/i);
    if (m) map[m[1]] = [m[2].trim()];
  }
  return map;
}
