#!/usr/bin/env node
// [dsh-purge-plus] 验收：只读地证明构建物可用，不写宿主、不改任何文件。
//
//   1. 包能 import（补丁表 / 围栏 / 入口）
//   2. 补丁表不变式：93 条、自有 5 条 ≥201、id 无重复
//   3. 真实宿主上 --status 能定位 @deepseek-ai 根（DSH_SURFACE=desktop）
//   4. 自有 5 条出现在状态里（pending/applied/drifted 均可，不能消失）
//   5. 锚点预演：每个自有补丁的 pattern 在宿主文件里的命中次数
//      —— 命中 0 次 = 宿主升级后锚点烂了，必须重写；命中 ≥2 次 = 会打歪。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveRepo } from "../overlay/edits.mjs";

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
r.total === 93 ? ok(`总数 ${r.total}`) : bad(`总数应为 93，实际 ${r.total}`);
r.ours.length === 5 ? ok(`自有 ${r.ours.length} 条（≥201）`) : bad(`自有应为 5，实际 ${r.ours.length}`);
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

// ── 6. 按 DSH 的解析上下文真正加载插件入口 ────────────────────────
// 构建目录里没有 node_modules，yaml 之类的直接依赖解析不到。
// DSH 安装后包位于 <profile>/node_modules/<pkg>/，向上能解析到 profile 的依赖。
// 这里用软链复现那个上下文，确保 cordis 加载时不会 ERR_MODULE_NOT_FOUND。
console.log("[6] 插件入口加载（DSH 解析上下文）");
const PROFILE_NM = process.env.DSH_NODE_MODULES
  || path.join(process.env.HOME || "", ".dsh", "profiles", "desktop", "node_modules");
if (!fs.existsSync(PROFILE_NM)) {
  bad(`找不到 profile 的 node_modules: ${PROFILE_NM}（设 DSH_NODE_MODULES 覆盖）`);
} else {
  const LT = path.join(ROOT, "dist", "loadtest");
  fs.rmSync(LT, { recursive: true, force: true });
  fs.mkdirSync(LT, { recursive: true });
  fs.symlinkSync(PROFILE_NM, path.join(LT, "node_modules"));
  fs.cpSync(PKG, path.join(LT, "package"), { recursive: true });
  const loadProbe = `
    const m = await import("./lib/index.js");
    console.log(JSON.stringify({ name: m.name, inject: m.inject, apply: typeof m.apply, exports: Object.keys(m).length }));
  `;
  try {
    const out = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", loadProbe], {
      cwd: path.join(LT, "package"), encoding: "utf8",
    }));
    out.name === "dsh-purge-plus" ? ok(`name=${out.name}`) : bad(`name 应为 dsh-purge-plus，实际 ${out.name}`);
    out.apply === "function" ? ok("apply 可调用") : bad(`apply 类型 ${out.apply}`);
    Array.isArray(out.inject) && out.inject.includes("systemPrompt") && out.inject.includes("tools")
      ? ok(`inject=${JSON.stringify(out.inject)}`) : bad(`inject 异常: ${JSON.stringify(out.inject)}`);
    ok(`具名导出 ${out.exports} 个`);
  } catch (e) {
    bad(`入口加载失败：${(e.stderr || e.message).split("\n").slice(0, 6).join("\n")}`);
  }
  fs.rmSync(LT, { recursive: true, force: true });
}

// ── 7. 在线更新通道指向本仓库 ────────────────────────────────────
// 这条是「面板里点升级能不能用」的直接判据：插件自己去 GitHub 找 release，
// 找错仓库就会拉到 community 的包，或者找不到资产。
console.log("[7] 在线更新通道");
{
  const repo = resolveRepo();
  const slug = `${repo.owner}/${repo.repo}`;
  const read = (f) => fs.readFileSync(path.join(PKG, f), "utf8");
  const consts = [
    ["lib/community.js", /export const REPOSITORY = "([^"]+)"/, "REPOSITORY"],
    ["lib/update-net.js", /export const SOURCE_REPO = "([^"]+)"/, "SOURCE_REPO"],
  ];
  for (const [file, re, label] of consts) {
    const m = read(file).match(re);
    if (!m) { bad(`${label} 未找到`); continue; }
    m[1] === slug ? ok(`${label} = ${m[1]}`) : bad(`${label} = ${m[1]}（应为 ${slug}）`);
  }
  // 更新路径上不允许残留旧仓库坐标，否则升级会去拉 community 的包。
  // 旧坐标不能写字面量：vendor 副本里的仓库名可能是混淆过的，硬编码会永远
  // 匹配不到（这条检查曾经就是空转的）。改为从 vendor 原文里提取。
  const upstreamSrc = fs.readFileSync(path.join(ROOT, "vendor/community/lib/community.js"), "utf8");
  const upstreamSlug = (upstreamSrc.match(/export const REPOSITORY = "([^"]+)"/) || [])[1] || "";
  if (!upstreamSlug) bad("无法从 vendor 提取上游仓库坐标");
  else {
    const leftovers = ["lib/community.js", "lib/update-net.js", "lib/update.js", "lib/update-targets.js"]
      .filter((f) => read(f).includes(upstreamSlug));
    leftovers.length === 0
      ? ok(`更新路径无上游坐标残留（已核对 ${upstreamSlug.length} 字符坐标）`)
      : bad(`旧仓库坐标残留: ${leftovers.join(", ")}`);
  }

  // 资产名必须与 build 产出的 tgz 前缀一致，否则 releases 里永远匹配不到。
  const pkgJson = JSON.parse(read("package.json"));
  const asset = `${pkgJson.name}-${pkgJson.version}.tgz`;
  const tgz = path.join(ROOT, "dist", asset);
  fs.existsSync(tgz) ? ok(`发行资产名 ${asset}`) : bad(`dist 里没有 ${asset}`);

  // 发行 tag 白名单：不放宽的话，我们自己的 tag 会被过滤掉，
  // 面板「检查更新」永远显示已是最新——这是在线升级的硬闸门。
  const upd = read("lib/update.js");
  const reLine = upd.match(/const FORK_RELEASE_RE = (\/\^[^\n]+\/);/);
  if (!reLine) bad("FORK_RELEASE_RE 未找到");
  else {
    const re = eval(reLine[1]);
    const tag = `v${pkgJson.version}`;
    re.test(tag) ? ok(`发行 tag 白名单接受 ${tag}`) : bad(`发行 tag 白名单拒绝 ${tag}`);
    re.test("v1.7.20") ? ok("发行 tag 白名单仍接受 vX.Y.Z") : bad("vX.Y.Z 被拒");
    !re.test("v1.7.20-rc.1") ? ok("发行 tag 白名单拒绝预发布") : bad("预发布未被拒");
  }

  // 同一道闸门在 community.js 里还有两处**内联**正则：列表过滤 + 安装前校验。
  // 只放宽 update.js 那一处时，列表能过、点安装却抛「只安装正式发布版本」。
  const comm = read("lib/community.js");
  const marker = "(?:-plus\\.\\d+)?";
  const inlineN = comm.split(marker).length - 1;
  inlineN === 2
    ? ok("community.js 两处内联 tag 正则已放宽")
    : bad(`community.js 内联正则放宽数量 = ${inlineN}（应为 2）`);

  // 历史条目要按当前 releases 过滤：状态目录沿用 community，历史里混着它的
  // 下载记录，不过滤就会列出装不动的条目。
  upd.includes("forkRefs")
    ? ok("历史条目按当前 releases 过滤")
    : bad("历史条目未过滤（会列出装不动的旧版本）");
  !comm.includes("dsh-purge Community")
    ? ok("发行 label 无社区版残留")
    : bad("label 仍含 dsh-purge Community");
  // 版本比较：plus.N 递增要判成更新，上游大版本要压过任何 plus 小版本。
  const vs = await import(path.join(PKG, "lib", "update-state.js"));
  const okNewer = vs.versionIsNewer("1.7.20-plus.2", "1.7.20-plus.1")
    && vs.versionIsNewer("1.7.21", "1.7.20-plus.9")
    && !vs.versionIsNewer("1.7.20-plus.1", "1.7.20-plus.1");
  okNewer ? ok("版本比较：plus.N 递增 / 上游大版本 / 同版不更新") : bad("versionIsNewer 对 plus 版本判定错误");

  // 已安装包身份校验要认得本包名。
  read("lib/installed-package.js").includes("COMMUNITY_PACKAGE = 'dsh-purge-plus'")
    ? ok("installed-package 认 dsh-purge-plus") : bad("installed-package 仍只认 community");
  pkgJson.repository?.url?.includes(slug) ? ok(`package.json repository = ${slug}`)
    : bad(`package.json repository = ${pkgJson.repository?.url}`);
}

console.log("[8] cordis.patch.yml 插件名");
{
  const yml = fs.readFileSync(path.join(PKG, "cordis.patch.yml"), "utf8");
  const name = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).name;
  const hits = yml.split(name).length - 1;
  hits >= 5 ? ok(`插件名 ${name} 出现 ${hits} 处`) : bad(`插件名 ${name} 只出现 ${hits} 处（应为 5）`);
  // 上游基座包名一旦残留，宿主会 MODULE_NOT_FOUND 并静默跳过整个 bundle。
  const stray = (yml.match(/name:\s*['"]?dsh-purge-community/g) || []).length;
  stray === 0 ? ok("无上游包名残留") : bad(`仍有 ${stray} 处上游包名`);
}

console.log("[9] client.js 浏览器模块名");
{
  const js = fs.readFileSync(path.join(PKG, "client.js"), "utf8");
  const name = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).name;
  const m = js.match(/__ModuleLoader__\.load\(\{id:"([^"]+)"/);
  m && m[1] === name ? ok(`模块 id = ${m[1]}`) : bad(`模块 id = ${m ? m[1] : "未找到"}，应为 ${name}`);
  const stray = (js.match(/dsh-purge-community/g) || []).length;
  stray === 0 ? ok("无上游包名残留") : bad(`client.js 仍有 ${stray} 处上游包名`);
}

console.log("[10] client.js 界面版本");
{
  const pkg2 = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"));
  const js = fs.readFileSync(path.join(PKG, "client.js"), "utf8");
  const base = pkg2.version.replace(/-plus\.\d+$/, "");
  const uiVers = new Set((js.match(/1\.7\.20[0-9.\-a-z]*/g) || []));
  const stale = [...uiVers].filter((v) => v !== pkg2.version);
  stale.length === 0 ? ok(`界面版本 = ${pkg2.version}`) : bad(`界面版本残留 ${stale.join(", ")}`);
  js.includes(`Plus ${pkg2.version}`) ? ok("面板徽章为 Plus") : bad("面板徽章仍是社区版");
  js.includes("社区版 1.7.20") ? bad("仍有 社区版 1.7.20 文案") : ok("无社区版版本文案");
}

console.log("[11] 演练台「凭据与文件」页");
{
  const files = ["lib/redteam/client.js", "client.js"];
  for (const f of files) {
    const src = fs.readFileSync(path.join(PKG, f), "utf8");
    const comp = (src.match(/function ArtifactsTab/g) || []).length;
    const tab = /artifacts['"], *['"]?凭据与文件/.test(src) || src.includes('["artifacts", "凭据与文件"]');
    const disp = src.includes("st.tab === 'artifacts'") || src.includes('st.tab === "artifacts"');
    comp === 1 && tab && disp ? ok(`${f}：组件 + 页签 + 分发 齐`) : bad(`${f}：组件 ${comp} / 页签 ${tab} / 分发 ${disp}`);
  }
  // 两个 op 必须有后端
  const core = fs.readFileSync(path.join(PKG, "lib/redteam/store-core.js"), "utf8");
  const hasCred = /op\s*===\s*['"]credentials['"]/.test(core);
  const hasAccess = /op\s*===\s*['"]access['"]/.test(core);
  hasCred && hasAccess ? ok("credentials / access 两个 op 后端存在") : bad("credentials 或 access 后端缺失");
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
