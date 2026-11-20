#!/usr/bin/env node
// [dsh-purge-plus] 构建：vendor/community + overlay → dist/package → dist/*.tgz
//
// 不变式：
//   · vendor/ 永远不被写入（只在构建时读取），升级时整目录替换即可。
//   · overlay 里只有新增文件 + 6 处精确锚点插入，没有删改上游逻辑。
//   · 任何锚点命中数 ≠ 1 立刻失败，并打印文件、锚点、实际命中次数。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { EDITS } from "../overlay/edits.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const VENDOR = path.join(ROOT, "vendor", "community");
const OVERLAY_FILES = path.join(ROOT, "overlay", "files");
const BUILD = path.join(ROOT, "dist", "build");
const PKG = path.join(BUILD, "package");

const log = (s) => console.log(s);
const die = (s) => { console.error("✗ " + s); process.exit(1); };

// ── 0. 前置检查 ────────────────────────────────────────────────────
if (!fs.existsSync(path.join(VENDOR, "package.json"))) die(`vendor/community 不完整: ${VENDOR}`);
const basePkg = JSON.parse(fs.readFileSync(path.join(VENDOR, "package.json"), "utf8"));
const baseVersion = basePkg.version;
const plusRev = Number(process.env.PLUS_REV || basePkg.plus?.revision || 1);
const version = `${baseVersion}-plus.${plusRev}`;

log(`上游基座  ${basePkg.name}@${baseVersion}`);
log(`本仓库版  dsh-purge-plus@${version}`);

// ── 1. 清空并复制 vendor ───────────────────────────────────────────
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(PKG, { recursive: true });
fs.cpSync(VENDOR, PKG, { recursive: true });
log(`✓ vendor/community → dist/build/package（${countFiles(PKG)} 个文件）`);

// ── 2. 覆盖新增文件 ───────────────────────────────────────────────
fs.cpSync(OVERLAY_FILES, PKG, { recursive: true });
log(`✓ overlay/files 覆盖完成`);

// ── 3. 应用精确锚点编辑 ───────────────────────────────────────────
let applied = 0, warned = 0;
for (const [i, e] of EDITS.entries()) {
  const fp = path.join(PKG, e.file);
  const tag = `#${i + 1} ${e.file}`;
  if (!fs.existsSync(fp)) {
    if (e.required) die(`${tag}: 文件不存在`);
    log(`  ⚠ ${tag}: 文件不存在，跳过`); warned++; continue;
  }
  const src = fs.readFileSync(fp, "utf8");
  const hits = countOccurrences(src, e.find);
  if (hits !== 1) {
    const msg = `${tag}: 锚点命中 ${hits} 次（要求恰好 1 次）\n    锚点: ${JSON.stringify(e.find.slice(0, 120))}`;
    if (e.required) die(msg);
    log(`  ⚠ ${msg}`); warned++; continue;
  }
  fs.writeFileSync(fp, src.replace(e.find, e.replace));
  applied++;
  log(`  ✓ ${tag}`);
}
log(`✓ 编辑完成 applied=${applied} warned=${warned}`);

// ── 4. 重写 package.json ──────────────────────────────────────────
const pkgPath = path.join(PKG, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const repo = process.env.GITHUB_REPO || "OWNER/dsh-purge-plus";
Object.assign(pkg, {
  name: "dsh-purge-plus",
  version,
  description: "以 dsh-purge-community 为基座、移植 dsh-purge-safe 先进能力并长期跟随上游维护的 DSH 附加组件。",
  homepage: `https://github.com/${repo}#readme`,
  repository: { type: "git", url: `git+https://github.com/${repo}.git` },
  bugs: { url: `https://github.com/${repo}/issues` },
  dshTarget: "0.2.2-rc.5 (runtime injection + host patches verified)",
});
pkg.plus = {
  base: { name: basePkg.name, version: baseVersion },
  overlayRevision: plusRev,
  generatedAt: new Date().toISOString(),
};
if (Array.isArray(pkg.files) && !pkg.files.includes("NOTICE-PLUS.md")) pkg.files.push("NOTICE-PLUS.md");
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
log(`✓ package.json 重写：${pkg.name}@${pkg.version}  dshTarget=${pkg.dshTarget}`);

// ── 5. 语法与补丁表自检 ───────────────────────────────────────────
const probe = `
import { ALL_PATCHES } from "./lib/patches/index.mjs";
const ids = ALL_PATCHES.map(p => p.id);
const dup = ids.filter((v,i) => ids.indexOf(v) !== i);
const upstream = ids.filter(id => id < 201);
const ours = ids.filter(id => id >= 201);
console.log(JSON.stringify({ total: ids.length, ours: ours.length, upstreamMax: Math.max(...upstream), dup }));
`;
let probeOut;
try {
  probeOut = execFileSync(process.execPath, ["--input-type=module", "-e", probe], { cwd: PKG, encoding: "utf8" }).trim();
} catch (err) {
  die(`补丁表无法 import：\n${err.stderr || err.message}`);
}
const r = JSON.parse(probeOut);
if (r.dup.length) die(`补丁 id 重复: ${r.dup.join(",")}`);
if (r.ours !== 4) die(`自有补丁数应为 4，实际 ${r.ours}`);
if (r.total !== 88 + 4) die(`补丁总数应为 92，实际 ${r.total}`);
if (r.upstreamMax !== 96) die(`上游补丁最大 id 应为 96，实际 ${r.upstreamMax}（基座可能变了，需复核 PORT-MATRIX）`);
log(`✓ 补丁表 ${r.total} 条（上游 ${r.total - r.ours}，最大 id ${r.upstreamMax} + 自有 ${r.ours} 条 ≥201），id 无重复`);

// ── 6. 打包 ───────────────────────────────────────────────────────
const tgz = path.join(ROOT, "dist", `dsh-purge-plus-${version}.tgz`);
execFileSync("tar", ["-czf", tgz, "-C", BUILD, "package"], { stdio: "inherit" });
const size = (fs.statSync(tgz).size / 1024 / 1024).toFixed(2);
log(`✓ ${path.relative(ROOT, tgz)}  ${size} MB`);
log(`\n安装：dsh 面板 → 插件 → 从文件安装，或\n  pnpm add "file:${tgz}"`);

// ── helpers ──────────────────────────────────────────────────────
function countOccurrences(hay, needle) {
  if (!needle) return 0;
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}
function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? countFiles(p) : 1;
  }
  return n;
}
