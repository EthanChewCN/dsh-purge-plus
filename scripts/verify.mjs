#!/usr/bin/env node
// [dsh-purge-plus] 验收：只读地证明构建物可用，不写宿主、不改任何文件。
//
//   1. 包能 import（补丁表 / 围栏 / 入口）
//   2. 补丁表不变式：96 条、自有 8 条 ≥201、id 无重复
//   3. 真实宿主上 --status 能定位 @deepseek-ai 根（DSH_SURFACE=desktop）
//   4. 自有 8 条出现在状态里（pending/applied/drifted 均可，不能消失）
//   5. 锚点预演：每个自有补丁的 pattern 在宿主文件里的命中次数
//      —— 命中 0 次 = 宿主升级后锚点烂了，必须重写；命中 ≥2 次 = 会打歪。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { resolveRepo } from "../overlay/edits.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 两种运行位置：仓库里（ROOT 有 dist/build/package）与装好的包里（ROOT 就是包根）。
   不这样解析的话，「装完在包根跑 node scripts/verify.mjs 就能自证」永远走不到第二行。 */
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;
const AI_BASE = process.env.DSH_BASE
  || "/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai";

let failed = 0;
let skipped = 0;
const ok = (s) => console.log(`  ✓ ${s}`);
const bad = (s) => { console.error(`  ✗ ${s}`); failed++; };
/* 仓库侧才有原文（vendor/ 上游副本、dist/ 里的 tgz）。装好的包里没有这些，
   对应的组**明确报「不适用」并计数**，不静默跳过 —— 跳过在验收里就是恒绿。
   上限见文件末尾：不适用组数超过 SKIP_CAP 就是有人在拿「不适用」当挡箭牌。 */
const IN_REPO = ROOT !== PKG && fs.existsSync(path.join(ROOT, "vendor", "community"));
const na = (m) => { skipped += 1; console.log(`  ○ 不适用：${m}`); };

if (!fs.existsSync(path.join(PKG, "package.json"))) {
  console.error(`${PKG} 不是产物目录（没有 package.json）。仓库里先跑 node scripts/build.mjs。`);
  process.exit(1);
}
console.log(`产物根 ${PKG}`);
console.log(`宿主根 ${AI_BASE}\n`);

// ── 1. import ───────────────────────────────────────────────────
console.log("[1] 模块可加载");  // 结构
const probe = `
const idx = await import("./lib/patches/index.mjs");
const fence = await import("./lib/subagent-fence.js");
const ids = idx.ALL_PATCHES.map(p => p.id);
const ours = idx.ALL_PATCHES.filter(p => p.id >= 201);
console.log(JSON.stringify({
  total: ids.length,
  ours: ours.map(p => ({ id: p.id, name: p.name, file: p.file, markers: p.markers || [], patterns: (p.replacements||[]).map(r => r.pattern) })),
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
console.log("[2] 补丁表不变式");  // 结构
r.total === 96 ? ok(`总数 ${r.total}`) : bad(`总数应为 96，实际 ${r.total}`);
r.ours.length === 8 ? ok(`自有 ${r.ours.length} 条（≥201）`) : bad(`自有应为 8，实际 ${r.ours.length}`);
r.dup.length === 0 ? ok("id 无重复") : bad(`id 重复: ${r.dup}`);
r.fence === "function" ? ok("installSubagentFence 已导出") : bad(`围栏导出类型 ${r.fence}`);

// ── 2b. 预设模板里的插件名 ──────────────────────────────────────
// 预设的 agent.cordis.yml 若仍写上游包名（如 dsh-purge-community/redteam/tools），
// 宿主解析不到该子条目 → 预设被标 broken → 客户端模式下拉把 broken 行整个滤掉，
// 于是「红队模式」在界面上凭空消失。这里把这件事钉死在构建验收里。
console.log("[2b] 预设模板插件名");
{
  const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"));
  const selfName = pkgJson.name;
  const presetRoot = path.join(PKG, "presets");
  const yamls = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fp);
      else if (/\.ya?ml$/.test(entry.name)) yamls.push(fp);
    }
  };
  walk(presetRoot);
  yamls.length > 0 ? ok(`预设模板 ${yamls.length} 份`) : bad("presets/ 下没有 yml 模板");

  const foreign = [];
  for (const fp of yamls) {
    const text = fs.readFileSync(fp, "utf8");
    for (const line of text.split("\n")) {
      const m = /^\s*name:\s*['"]?([A-Za-z0-9@._/-]+)['"]?\s*$/.exec(line);
      if (!m) continue;
      const name = m[1];
      if (name.startsWith("./") || name.startsWith("cordis:") || name.startsWith("@")) continue;
      const pkgPart = name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0];
      if (pkgPart !== selfName) foreign.push(`${path.relative(PKG, fp)}: ${name}`);
    }
  }
  foreign.length === 0
    ? ok(`没有指向其他包名的插件行（全部解析到 ${selfName}）`)
    : bad(`预设里有解析不到的插件名：${foreign.join(" · ")}`);

  // 红队预设必须真的引用本包的 tools 子路径，否则等于没接上工具面。
  const redteamYml = yamls.find((fp) => fp.endsWith(path.join("redteam", "agent.cordis.yml")));
  if (!redteamYml) bad("找不到 presets/redteam/agent.cordis.yml");
  else {
    const text = fs.readFileSync(redteamYml, "utf8");
    text.includes(`${selfName}/redteam/tools`)
      ? ok(`红队预设引用 ${selfName}/redteam/tools`)
      : bad(`红队预设没有引用 ${selfName}/redteam/tools`);
  }
}

// ── 3. 宿主定位 ─────────────────────────────────────────────────
console.log("[3] 真实宿主 --status");  // 结构
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
console.log("[4] 自有补丁状态");  // 结构
for (const p of r.ours) {
  const line = status.split("\n").find((l) => l.includes(`[#${p.id}]`));
  if (!line) { bad(`#${p.id} 未出现在状态输出`); continue; }
  /* 只认 applied / already。
     `drifted` 的语义就是「锚点烂了」，`pending` 是「还没打上」——
     以前这里把两者都算通过，和 [5] 的文件级豁免叠加后，
     一个彻底漂移的补丁可以同时过 [4] 和 [5]（审计 B-2）。 */
  const state = (line.match(/—\s*(\S+)\s*$/) || [])[1] || "";
  if (state === "applied" || state === "already") ok(`#${p.id} ${p.name} — ${state}`);
  else bad(`#${p.id} ${p.name} — ${state || line.trim()}（要求 applied / already，drifted 与 pending 都不算到位）`);
}

// ── 5. 锚点预演（用 --status 打印的真实路径，不猜 core 导出名）──────
console.log("[5] 锚点预演命中次数");  // 结构
const fileMap = parseStatusPaths(status);
for (const p of r.ours) {
  const keys = Array.isArray(p.file) ? p.file : [p.file];
  const targets = [...new Set(keys.flatMap((k) => fileMap[k] || []))];
  if (!targets.length) { bad(`#${p.id} 宿主文件键 ${keys.join(",")} 未解析到文件`); continue; }
  /* 逐文件判「这条补丁在这个文件上到位没有」。
     以前是 `targets.some(fp => 文本里有 "[dsh-purge-plus]")` —— 文件级豁免：
     #207 与 #208 都落在 api-session-controller，其中一条漂移到 0 命中时，
     另一条留下的标记会让两条一起过（审计 B-1）。现在按补丁自己的 marker 判。 */
  const rows = [];
  const broken = [];
  for (const fp of targets) {
    const text = fs.readFileSync(fp, "utf8");
    const marked = (p.markers || []).some((mk) => typeof mk === "string" && mk && text.includes(mk));
    const counts = p.patterns.map((pat) => countOcc(text, pat));
    const good = marked || counts.every((c) => c === 1);
    rows.push(`${path.basename(fp)} ${marked ? "已应用" : "锚点 " + counts.join("/")}`);
    if (!good) broken.push(`${path.basename(fp)}：marker 不在，锚点命中 ${counts.join("/")}（要求每处恰好 1 次）`);
  }
  broken.length === 0
    ? ok(`#${p.id} ${targets.length} 文件逐文件通过（${rows.join(" · ")}）`)
    : bad(`#${p.id} ${broken.join("；")}`);
}

// ── 6. 按 DSH 的解析上下文真正加载插件入口 ────────────────────────
// 构建目录里没有 node_modules，yaml 之类的直接依赖解析不到。
// DSH 安装后包位于 <profile>/node_modules/<pkg>/，向上能解析到 profile 的依赖。
// 这里用软链复现那个上下文，确保 cordis 加载时不会 ERR_MODULE_NOT_FOUND。
console.log("[6] 插件入口加载（DSH 解析上下文）");  // 结构
const PROFILE_NM = process.env.DSH_NODE_MODULES
  || path.join(process.env.HOME || "", ".dsh", "profiles", "desktop", "node_modules");
if (!fs.existsSync(PROFILE_NM)) {
  bad(`找不到 profile 的 node_modules: ${PROFILE_NM}（设 DSH_NODE_MODULES 覆盖）`);
} else {
  /* 放临时目录而不是 ROOT/dist：包内模式时 ROOT 就是包根，
     往 ROOT/dist 里拷 PKG 等于把目录拷进自己的子目录（ERR_FS_CP_EINVAL）。 */
  const LT = fs.mkdtempSync(path.join(os.tmpdir(), "plus-loadtest-"));
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
console.log("[7] 在线更新通道");  // 结构
if (!IN_REPO) {
  na("在线更新通道要拿 vendor/community 的上游坐标与 dist/ 里的 tgz 对账（仓库侧）");
} else {
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
  // 版本比较：0.1.N 递增要判成更新，且必须按数字比（0.1.10 > 0.1.9）；
  // 历史 tag（`1.7.20-plus.N`）仍要能解析，否则旧安装升不上来。
  const vs = await import(path.join(PKG, "lib", "update-state.js"));
  const okNewer = vs.versionIsNewer("0.1.37", "0.1.36")
    && vs.versionIsNewer("0.1.10", "0.1.9")
    && vs.versionIsNewer("1.7.20-plus.2", "1.7.20-plus.1")
    && !vs.versionIsNewer("0.1.37", "0.1.37");
  okNewer ? ok("版本比较：0.1.N 递增 / 数字序 / 历史 plus tag / 同版不更新") : bad("versionIsNewer 版本判定错误");

  // 换轨后旧方案的 tag 不能参与比较：数字序上 1.7.20-plus.4 > 0.1.38，
  // 混进来面板就会把**旧版本**当成「有更新」推给用户（实测过一次）。
  // 用注入的假发行列表做行为断言，不联网。
  const updMod = await import(path.join(PKG, "lib", "update.js"));
  const fakeRows = [
    { ref: "v1.7.20-plus.4", version: "1.7.20-plus.4", url: "u", asset: "a", sums: "s" },
    { ref: `v${pkgJson.version}`, version: pkgJson.version, url: "u2", asset: "a2", sums: "s2" },
  ];
  const listed = await updMod.listForkReleases({ fresh: true, services: { releases: async () => fakeRows } });
  const refs = listed.rows.map((r) => r.ref);
  refs.includes(`v${pkgJson.version}`) && !refs.includes("v1.7.20-plus.4")
    ? ok("旧方案 tag 已被排除出更新比较")
    : bad(`旧方案 tag 仍在比较里：${refs.join(", ")}`);

  // 已安装包身份校验要认得本包名。
  read("lib/installed-package.js").includes("COMMUNITY_PACKAGE = 'dsh-purge-plus'")
    ? ok("installed-package 认 dsh-purge-plus") : bad("installed-package 仍只认 community");
  pkgJson.repository?.url?.includes(slug) ? ok(`package.json repository = ${slug}`)
    : bad(`package.json repository = ${pkgJson.repository?.url}`);
}

console.log("[8] cordis.patch.yml 插件名");  // 结构
{
  const yml = fs.readFileSync(path.join(PKG, "cordis.patch.yml"), "utf8");
  const name = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).name;
  const hits = yml.split(name).length - 1;
  hits >= 5 ? ok(`插件名 ${name} 出现 ${hits} 处`) : bad(`插件名 ${name} 只出现 ${hits} 处（应为 5）`);
  // 上游基座包名一旦残留，宿主会 MODULE_NOT_FOUND 并静默跳过整个 bundle。
  const stray = (yml.match(/name:\s*['"]?dsh-purge-community/g) || []).length;
  stray === 0 ? ok("无上游包名残留") : bad(`仍有 ${stray} 处上游包名`);
}

console.log("[9] client.js 浏览器模块名");  // 结构
{
  const js = fs.readFileSync(path.join(PKG, "client.js"), "utf8");
  const name = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).name;
  const m = js.match(/__ModuleLoader__\.load\(\{id:"([^"]+)"/);
  m && m[1] === name ? ok(`模块 id = ${m[1]}`) : bad(`模块 id = ${m ? m[1] : "未找到"}，应为 ${name}`);
  const stray = (js.match(/dsh-purge-community/g) || []).length;
  stray === 0 ? ok("无上游包名残留") : bad(`client.js 仍有 ${stray} 处上游包名`);
}

console.log("[10] client.js 界面版本");  // 回归 test-version-notice.mjs
{
  const pkg2 = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"));
  const js = fs.readFileSync(path.join(PKG, "client.js"), "utf8");
  /* 页脚是**血缘句**，不是版本号：两个上游都会继续更新，写死版本等于每次同步
     后都在误报。这里断言的是「存在且不含任何版本号」。 */
  const FOOT = "基于 dsh-purge Community + dsh-purge safe 独立维护 · MIT / Apache-2.0 · 上游署名见 NOTICE";
  js.includes(FOOT) ? ok("页脚血缘 = Community + safe（无版本号）") : bad("页脚血缘缺失或仍带版本号");
  /基于 dsh-purge Community [\d]/.test(js)
    ? bad("页脚仍写死上游版本号")
    : ok("页脚不含上游版本号");
  // 界面版本必须是本包版本；基座版本号不该在界面里留残影。
  if (!IN_REPO) {
    na("基座版本残留比对需要 vendor/community 的 package.json（仓库侧）");
  } else {
    const baseVer = JSON.parse(fs.readFileSync(path.join(ROOT, "vendor/community/package.json"), "utf8")).version;
    const stale = [...new Set((js.match(new RegExp(baseVer.replace(/\./g, "\\.") + "[0-9.\\-a-z]*", "g")) || []))];
    stale.length === 0 ? ok(`界面无基座版本 ${baseVer} 残留`) : bad(`界面残留基座版本 ${stale.join(", ")}`);
  }
  js.includes(`Plus ${pkg2.version}`) ? ok(`面板徽章 = Plus ${pkg2.version}`) : bad("面板徽章不是本包版本");
  js.includes(`"${pkg2.version}"`) ? ok(`界面版本 = ${pkg2.version}`) : bad(`界面版本不是 ${pkg2.version}`);
  /^0\.1\.\d+$/.test(pkg2.version) ? ok(`版本号方案 0.1.N = ${pkg2.version}`) : bad(`版本号不是 0.1.N：${pkg2.version}`);
  // README 随包分发，写死本包版本号 → 每发一版都要改文档，改完文档包内容又变，
  // 于是又要发一版。版本以 Release 徽章为准。
  const readme = fs.readFileSync(path.join(PKG, "README.md"), "utf8");
  readme.includes(`**${pkg2.version}**`)
    ? bad("README 写死了本包版本号")
    : ok("README 不写死版本号（跟随 Release 徽章）");
}

console.log("[10b] 技能页可见性（版本换轨回归）");
{
  const js = fs.readFileSync(path.join(PKG, "client.js"), "utf8");
  const pkg3 = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"));
  /* 上游的门槛按 1.x 语义写：主版本≠1 时只比「是否 >1」。本仓库换到 0.1.N 后
     0.1.x 一律被判成「低于 1.1.12」，SkillsSection 直接 return null → 整页空白。
     这是换轨时真实发生过的回归，锁死它。 */
  /\+\s*parts\[1\]\s*!==\s*1/.test(js)
    ? bad("client.js 仍有 1.x 语义的版本门槛（0.1.N 会被判成过旧）")
    : ok("client.js 无 1.x 语义版本门槛");
  const fnText = js.match(/function skillUiAllowed\(d\) \{[\s\S]*?\n\}/);
  if (!fnText) bad("找不到 skillUiAllowed");
  else {
    let allowed;
    try {
      allowed = new Function(`${fnText[0]}; return skillUiAllowed;`)()({
        ok: true,
        plugin_version: pkg3.version,
      });
    } catch (e) {
      bad(`skillUiAllowed 求值失败：${e.message}`);
    }
    if (allowed === true) ok(`skillUiAllowed(${pkg3.version}) = true（技能页可见）`);
    else if (allowed === false) bad(`skillUiAllowed(${pkg3.version}) = false → 技能页整页空白`);
  }
  const sk = fs.readFileSync(path.join(PKG, "lib/skills.js"), "utf8");
  sk.includes("skills_dead: await deadSkillLinks(") ? ok("status 回报 skills_dead") : bad("status 未回报 skills_dead");
  js.includes('"skills.dead"') ? ok("空态文案含失效链接提示") : bad("空态文案缺失效链接提示");
}

console.log("[11] 演练台「凭据与文件」页");  // 回归 test-artifacts-tab.mjs
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

console.log("[12] P0 静默失败四件");  // 回归 test-silent-failures.mjs
{
  const schema = fs.readFileSync(path.join(PKG, "lib/redteam/schema.js"), "utf8");
  const core = fs.readFileSync(path.join(PKG, "lib/redteam/store-core.js"), "utf8");

  // G-1：两个常量必须在 schema.js 定义，且 store-core 不再自己定义
  schema.includes("export const SCOPE_SQL =") && schema.includes("export const LEGACY_STAGE_MAP =")
    ? ok("schema.js 定义并导出 SCOPE_SQL / LEGACY_STAGE_MAP")
    : bad("schema.js 缺少 SCOPE_SQL 或 LEGACY_STAGE_MAP 的导出定义");
  /^const SCOPE_SQL = /m.test(core) || /^export const LEGACY_STAGE_MAP = /m.test(core)
    ? bad("store-core.js 仍有本地定义（会与 schema.js 的副本漂移）")
    : ok("store-core.js 无本地副本");
  /SCOPE_SQL, LEGACY_STAGE_MAP,/.test(core) && /export \{ LEGACY_STAGE_MAP \}/.test(core)
    ? ok("store-core.js 从 schema.js 引入并原样再导出（对外 API 不变）")
    : bad("store-core.js 未从 schema.js 引入两个常量，或丢了再导出");

  // G-2/G-3：显式集合 + 未知 op 提前抛
  const writeBlock = core.match(/const WRITE_OPS = new Set\(\[([\s\S]*?)\]\)/);
  const readBlock = core.match(/const READ_OPS = new Set\(\[([\s\S]*?)\]\)/);
  if (!writeBlock || !readBlock) bad("WRITE_OPS / READ_OPS 集合缺失");
  else {
    const parse = (s) => [...s.matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1]);
    const W = new Set(parse(writeBlock[1]));
    const R = new Set(parse(readBlock[1]));
    ok(`WRITE_OPS ${W.size} 条 / READ_OPS ${R.size} 条`);
    const both = [...W].filter((x) => R.has(x));
    both.length === 0 ? ok("两个集合无交集") : bad(`同时被当成读和写：${both.join(", ")}`);

    // 兜底分支必须先用集合挡住未知 op，否则 `unknown op` 永远抛不出来
    /if \(!READ_OPS\.has\(op\)\) throw new Error\(`unknown op: \$\{op\}`\)/.test(core)
      ? ok("未知 op 在兜底之前抛出")
      : bad("兜底分支未拦住未知 op（拼错的 op 会返回 ok:true）");
    /\/\^\(add\|save\|update\|delete\|import\|assess\|open\)\//.test(core)
      ? bad("仍有前缀正则判写操作（漏 shotAdd/shotDelete/assetTest/resetPrompts）")
      : ok("已无前缀正则判写操作");

    // 动态对账：guard 之后出现的每个 op 字面量都必须被两个集合覆盖
    const guardAt = core.indexOf("if (!id) {");
    // 只对账 dispatch 本体：dispatchAsync 单独处理 probeSessions，不在这两个集合里
    const asyncAt = core.indexOf("export async function dispatchAsync");
    const body = guardAt < 0 ? "" : core.slice(guardAt, asyncAt > guardAt ? asyncAt : undefined);
    const seen = new Set([...body.matchAll(/op === '([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1]));
    const missing = [...seen].filter((x) => !W.has(x) && !R.has(x));
    guardAt < 0 ? bad("找不到 `if (!id) {` 兜底分支") : null;
    missing.length === 0
      ? ok(`guard 之后的 ${seen.size} 个 op 全部被集合覆盖`)
      : bad(`集合漏了 ${missing.length} 个 op：${missing.join(", ")}`);
  }

  // G-4：模板检索的 category / offset 与 byCategory
  /searchTemplates\(q, limit = 40, offset = 0, category = ''\)/.test(core)
    ? ok("searchTemplates 收 4 个参数（q / limit / offset / category）")
    : bad("searchTemplates 签名仍是 (q, limit)，category 会被静默丢弃");
  /return \{ dir: dir \|\| null, total: items\.length, cve, cve_ids: cveIdSet\.size, byCategory \}/.test(core)
    ? ok("templateStats 返回 byCategory")
    : bad("templateStats 未返回 byCategory（面板分类计数恒为 0）");
  /\.map\(\(\[code, n\]\) => \(\{ code, name: pocCategoryName\(code\), n \}\)\)/.test(core)
    ? ok("byCategory 同时给出 code（面板用）与 name（工具文案用）")
    : bad("byCategory 只给出一种键，面板或工具会拿到 undefined");
}

console.log("[13] P1 会话绑定层 / P2 会话关系图");  // 回归 test-session-binding.mjs, test-silent-failures.mjs, test-p20.mjs
{
  const core = fs.readFileSync(path.join(PKG, "lib/redteam/store-core.js"), "utf8");
  const tools = fs.readFileSync(path.join(PKG, "lib/redteam/tools.js"), "utf8");

  for (const m of ["sessionBindingsPath", "sessionBindings", "sessionBinding", "setSessionBinding", "clearSessionBinding"]) {
    new RegExp(`\\b${m}\\(`).test(core) ? ok(`store.${m} 存在`) : bad(`store.${m} 缺失`);
  }
  // 原子写：sessions.json 的写入不能走 writeFileSync
  /atomicWriteSync\(this\.sessionBindingsPath\(\)/.test(core)
    ? ok("sessions.json 用 atomicWriteSync 写（不写半截 JSON）")
    : bad("sessions.json 未走原子写");
  /writeFileSync\(this\.sessionBindingsPath\(\)/.test(core)
    ? bad("sessions.json 仍在用 writeFileSync 直接覆盖")
    : ok("sessions.json 无 writeFileSync 覆盖");

  for (const op of ["sessionBinding", "sessionBindings", "bindSessionEngagement"]) {
    new RegExp(`op === '${op}'`).test(core) ? ok(`op ${op} 已接进 dispatch`) : bad(`op ${op} 缺失`);
  }
  /store\.setSessionBinding\(req\.session, req\.engagement, req\.name\)/.test(core)
    ? ok("activateEngagement 带 session 时自动落盘")
    : bad("activateEngagement 未落盘");

  // 只数调用点：定义那行是 `function persistRootBinding(...)`，顶格，不匹配 ^\s+
  const persistSites = (tools.match(/^\s+persistRootBinding\(store, exec, /gm) || []).length;
  persistSites === 2 ? ok("工具侧 2 处显式绑定都落盘（open / session_bind）") : bad(`工具侧落盘点 ${persistSites} 处（要求 2）`);

  for (const f of ["client.js", "lib/redteam/client.js"]) {
    const src = fs.readFileSync(path.join(PKG, f), "utf8");
    const comp = (src.match(/function SessionMap\(/g) || []).length;
    const mount = /h2?\(SessionMap, \{ refreshKey/.test(src);
    const pick = /onPick: \(id\)/.test(src);
    /* P20 起数据源换成 sessionGraph（自己落盘的绑定表 + 在等谁），不再直打宿主 RPC */
    const op = /op: ["']sessionGraph["']/.test(src);
    comp === 1 && mount && pick && op
      ? ok(`${f}：SessionMap 组件 + 挂载 + onPick + 取数 齐`)
      : bad(`${f}：组件 ${comp} / 挂载 ${mount} / onPick ${pick} / 取数 ${op}`);
  }
  // 面板跟随只在 client.js（宿主上下文只在这份产物里）
  const panel = fs.readFileSync(path.join(PKG, "client.js"), "utf8");
  /const rtSessionId = \(\) =>/.test(panel) && /op: "sessionBinding"/.test(panel)
    ? ok("client.js：面板启动时按本会话绑定跟随")
    : bad("client.js：缺少会话跟随接线");
}

console.log("[14] P3 子智能体回报 / 「现在在等谁」");  // 回归 test-attention.mjs
{
  const core = fs.readFileSync(path.join(PKG, "lib/redteam/store-core.js"), "utf8");
  const schema = fs.readFileSync(path.join(PKG, "lib/redteam/schema.js"), "utf8");
  const tools = fs.readFileSync(path.join(PKG, "lib/redteam/tools.js"), "utf8");

  /* 表：没有这张表，队列只能靠读自然语言猜「它是不是在等人」 */
  /CREATE TABLE IF NOT EXISTS agent_report \(/.test(schema)
    ? ok("schema.js：agent_report 表存在")
    : bad("schema.js：缺 agent_report 表");
  /acknowledged_at TEXT/.test(schema)
    ? ok("schema.js：回报有「已处理」列（否则一条 waiting 是永生的）")
    : bad("schema.js：缺 acknowledged_at 列");
  /ensure\('agent_report', 'acknowledged_at'/.test(schema)
    ? ok("schema.js：老库（曾装过 safe）会补列")
    : bad("schema.js：缺老库补列");
  (schema.match(/ix_agent_report_/g) || []).length === 2
    ? ok("schema.js：两个索引齐（session / parent）")
    : bad(`schema.js：ix_agent_report_* 索引数 ${(schema.match(/ix_agent_report_/g) || []).length}（要求 2）`);

  for (const m of ["parseAgentReport", "recordAgentReport", "acknowledgeAgentReports", "latestAgentReports", "attentionQueue"]) {
    new RegExp(`\\b${m}\\(`).test(core) ? ok(`store.${m} 存在`) : bad(`store.${m} 缺失`);
  }
  /* 队列必须在 SQL 里收窄：safe 是全表 SELECT * 再在 JS 里去重，会话一多就每次全表扫 */
  /SELECT r\.\* FROM agent_report r[\s\S]{0,200}GROUP BY session_id/.test(core)
    ? ok("attentionQueue 在 SQL 里取「每会话最新一条」（不全表拉进 JS）")
    : bad("attentionQueue 仍在 JS 侧去重");
  /acknowledged_at IS NULL/.test(core)
    ? ok("队列只算未确认的回报")
    : bad("队列未按 acknowledged_at 过滤");
  /* 覆盖度引擎未移植时不能靠 TypeError 静默返回 0 */
  /typeof this\[fn\] === 'function'/.test(core) && /coverage_available/.test(core)
    ? ok("覆盖度引擎缺失时显式标记 coverage_available=false")
    : bad("覆盖度缺失被静默吞成 0（无法区分「收口了」和「没接」）");

  for (const op of ["attention", "attentionAck"]) {
    new RegExp(`op === '${op}'`).test(core) ? ok(`op ${op} 已接进 dispatch`) : bad(`op ${op} 未接进 dispatch`);
  }

  /* 工具：回报入口 + 查询入口 */
  /name: 'redteam_attention'/.test(tools)
    ? ok("工具 redteam_attention 已注册")
    : bad("工具 redteam_attention 缺失");
  /store\.parseAgentReport\(/.test(tools) && /store\.recordAgentReport\(/.test(tools)
    ? ok("subagent/end 里解析并落库回报")
    : bad("subagent/end 未接回报解析");
  /textOfAssistantMessage\(info && info\.lastAssistantMessage\)/.test(tools)
    ? ok("回报取自 info.lastAssistantMessage")
    : bad("回报取数位置不对");
  /* 报告里没有结构化字段时不能瞎写 */
  /const parsed = reportText === '' \? null : store\.parseAgentReport\(reportText\)/.test(tools)
    ? ok("解析不到就不写（不猜）")
    : bad("解析失败路径不明");

  for (const f of ["client.js", "lib/redteam/client.js"]) {
    const src = fs.readFileSync(path.join(PKG, f), "utf8");
    const comp = (src.match(/function AttentionCard\(/g) || []).length;
    const mount = /h2?\(AttentionCard, \{/.test(src);
    const op = src.includes("op: 'attention'") || src.includes('op: "attention"');
    const ack = src.includes("op: 'attentionAck'") || src.includes('op: "attentionAck"');
    comp === 1 && mount && op && ack
      ? ok(`${f}：AttentionCard 组件 + 挂载 + 查询 + 收口 齐`)
      : bad(`${f}：组件 ${comp} / 挂载 ${mount} / 查询 ${op} / 收口 ${ack}`);
  }
}

console.log("[15] P4 导航分组 / 二级页签");  // 回归 test-nav-groups.mjs
{
  /* 两份产物都要有：lib/redteam/client.js 是「全面浏览」新窗口那份，
     client.js 是面板内嵌那份。只改一份会出现「面板里有分组、新窗口里没有」。 */
  for (const f of ["lib/redteam/client.js", "client.js"]) {
    const src = fs.readFileSync(path.join(PKG, f), "utf8");
    const groups = /const TAB_GROUPS = \[/.test(src);
    const aliases = /const TAB_ALIASES = \{ testing: 'assets'/.test(src);
    const groupOf = /const groupOf = \(tab\) =>/.test(src);
    const filtered = /tabs\.filter\(\(t\) => activeGroup\.tabs\.indexOf\(t\[0\]\) >= 0\)\.map\(/.test(src);
    /* 分组行必须只出现一次：出现两次说明替换把两处都改了，会渲染两排 chips */
    const rows = (src.match(/className: 'rt-groups', role: 'tablist'/g) || []).length;
    /* 二级页签仍要按 tabs 表过滤 —— 全量 tabs.map 说明过滤没接上 */
    const unfiltered = (src.match(/tabs\.map\(\(t\) => \{/g) || []).length;
    const keys = /const navigateGroupKey = \(event, index\) =>/.test(src);
    const unread = /const groupHasUnread = \(g\) =>/.test(src);
    groups && aliases && groupOf && filtered && rows === 1 && unfiltered === 0 && keys && unread
      ? ok(`${f}：分组表 / 别名 / 过滤 / 键盘 / 组内未读 齐`)
      : bad(`${f}：groups=${groups} aliases=${aliases} groupOf=${groupOf} filtered=${filtered} rows=${rows} unfiltered=${unfiltered} keys=${keys} unread=${unread}`);

    /* CSS 必须跟着进来，否则 chips 是一排没有间距的裸按钮 */
    for (const cls of [".rt-groups{", ".rt-group{", ".rt-group.on{", ".rt-group:focus-visible{"]) {
      src.includes(cls) ? ok(`${f}：样式 ${cls}`) : bad(`${f}：缺样式 ${cls}`);
    }
  }

  /* 别名要覆盖「代码里真会出现的页签名」：testing 来自资产页的视图切换，
     prompts 来自智能体页的历史名。缺一个，从那个入口进来分组会算错。 */
  const rt = fs.readFileSync(path.join(PKG, "lib/redteam/client.js"), "utf8");
  /TAB_ALIASES = \{ testing: 'assets', attackfiles: 'artifacts', prompts: 'agents' \}/.test(rt)
    ? ok("别名表覆盖 testing / attackfiles / prompts")
    : bad("别名表不完整");
}

console.log("[16] P5 站内全屏");  // 回归 test-fullscreen.mjs
{
  /* P5 的关键不是「钩子写了」，而是三件事同时成立：
     ① 钩子真的在产物里，且只定义一次
     ② 外壳 ref 真的挂上了（只定义不挂 = 永远拿不到元素，等于没做）
     ③ 所有「开新窗口看完整控制台」的入口都改走了原地铺满，或至少带兜底
     第 ③ 条最容易漏：只装钩子不改入口，功能在原地但没人调用它。 */
  const BEGIN = "/* [dsh-purge-plus] __RT_FULLSCREEN_BEGIN__ */";
  const END = "/* [dsh-purge-plus] __RT_FULLSCREEN_END__ */";
  for (const f of ["lib/redteam/client.js", "client.js"]) {
    const src = fs.readFileSync(path.join(PKG, f), "utf8");
    const begin = countOcc(src, BEGIN);
    const end = countOcc(src, END);
    const defs = (src.match(/function useWorkbenchFullscreen\(/g) || []).length;
    const calls = (src.match(/= useWorkbenchFullscreen\(/g) || []).length;
    const refLine = /shellProps\.ref = shellRef/.test(src);
    const fullState = /const full = fullscreen\.expanded \|\| isFullWindow\(\)/.test(src);
    /* 嵌入形态不套 .rt-full：宿主 layout containment 会把 fixed 关进右栏 */
    const noFullWhenEmbedded = /shellProps = full && !embedded/.test(src);
    const cssTop = /\.rt-full\{position:fixed;top:var\(--dsh-frame-chrome-top/.test(src);
    const cssNative = /\.rt-dock\.rt-embedded:fullscreen/.test(src);
    const evDef = /const FULL_REQUEST_EVENT = /.test(src);
    const evListen = /addEventListener\(FULL_REQUEST_EVENT, onFull\)/.test(src);
    const escGuard = /if \(!isFullWindow\(\) \|\| embedded\) return/.test(src);
    /* 旧的「打不开新窗口」报错分支必须彻底消失：它只在那条被替换掉的路上存在 */
    const noOldErr = !/无法打开新窗口|\\u65E0\\u6CD5\\u6253\\u5F00\\u65B0\\u7A97\\u53E3/.test(src);

    begin === 1 && end === 1 && defs === 1 && calls === 1 && refLine && fullState
      && noFullWhenEmbedded && cssTop && cssNative && evDef && evListen && escGuard && noOldErr
      ? ok(`${f}：钩子 1 次 / ref 已挂 / 嵌入不套 .rt-full / 事件已接 / 旧报错已清`)
      : bad(`${f}：marker=${begin}/${end} defs=${defs} calls=${calls} ref=${refLine} state=${fullState} emb=${noFullWhenEmbedded} cssTop=${cssTop} cssNative=${cssNative} ev=${evDef}/${evListen} esc=${escGuard} oldErr=${!noOldErr}`);
  }

  /* 入口收口：凡是拿 '#redteam-full' 拼 URL 去 window.open 的地方，
     前面 400 字内必须出现「先请求原地铺满」或「原生全屏没成」的判断。
     用位置窗口而不是行号：行号会随无关改动漂，窗口对语义更宽容。 */
  for (const f of ["lib/redteam/client.js", "client.js"]) {
    const src = fs.readFileSync(path.join(PKG, f), "utf8");
    let bad_ = 0;
    let sites = 0;
    let at = src.indexOf("window.open(");
    while (at !== -1) {
      /* 只认真的在建 URL 的调用：注释里那句「为什么不再用 window.open('#redteam-full')」
         也是 window.open 加 hash，不排掉会一直误报。 */
      const lineStart = src.lastIndexOf("\n", at) + 1;
      const lineHead = src.slice(lineStart, at).trim();
      const inComment = lineHead.startsWith("*") || lineHead.startsWith("//") || lineHead.startsWith("/*");
      const ahead = src.slice(at, at + 300);
      if (!inComment && ahead.includes("#redteam-full")) {
        sites += 1;
        const before = src.slice(Math.max(0, at - 500), at);
        if (!before.includes("requestInPlaceFull") && !before.includes("document.fullscreenElement")) bad_ += 1;
      }
      at = src.indexOf("window.open(", at + 1);
    }
    sites > 0 && bad_ === 0
      ? ok(`${f}：${sites} 个开窗入口全部有原地铺满或原生失败兜底`)
      : bad(`${f}：${sites} 个开窗入口里 ${bad_} 个是无条件开新窗口`);
  }
}

console.log("[17] P7 覆盖度引擎");  // 回归 test-coverage.mjs
{
  const schema = fs.readFileSync(path.join(PKG, "lib", "redteam", "schema.js"), "utf8");
  const core = fs.readFileSync(path.join(PKG, "lib", "redteam", "store-core.js"), "utf8");
  const tools = fs.readFileSync(path.join(PKG, "lib", "redteam", "tools.js"), "utf8");

  /* 三张表必须**两处都有**：DDL 管新库，迁移块管老库（先装 community/safe 再换本包）。
     只有 DDL 的话，老库打开时表不存在，覆盖度 op 直接抛错。 */
  const TABLES = ["asset_coverage", "host_coverage", "host_finding"];
  const ddl = TABLES.filter((t) => countOcc(schema, "CREATE TABLE IF NOT EXISTS " + t) === 2);
  ddl.length === TABLES.length
    ? ok("三张表：DDL 与老库迁移块各建一次")
    : bad("缺建表语句：" + TABLES.filter((t) => !ddl.includes(t)).join(", "));

  const METHODS = ["getAssetCoverage", "updateAssetCoverage", "closeAssetCoverage", "assetNextActions",
    "getHostCoverage", "updateHostCoverage", "addHostFinding", "listHostFindings", "closeHostCoverage",
    "hostNextActions", "coveragePending", "coverageSummary"];
  const missM = METHODS.filter((m) => !new RegExp("\\b" + m + "\\(").test(core));
  missM.length === 0 ? ok(`store 方法 ${METHODS.length} 个齐`) : bad("store 缺方法：" + missM.join(", "));

  /* 状态词白名单必须在场：没有它，写 finished / yes / 空串都会被当成合法值存下去，
     队列于是永远认为没做完，而界面上看起来「标过了」。 */
  /const allowed = \['untested', 'partial'\]\.concat\(RedteamStore\.COV_DONE\)/.test(core)
    ? ok("状态词白名单：untested/partial + done/blocked/not_applicable")
    : bad("缺少覆盖度状态词白名单");

  /* close 必须点名缺项：只说「还没做完」对智能体没有可执行性 */
  /缺少：' \+ cov\.missing\.join/.test(core)
    ? ok("收口拒绝时点名缺哪几项")
    : bad("收口报错没有点名缺项");

  const OPS = ["assetCoverage", "hostCoverage", "hostFinding", "coverageSummary"];
  const missO = OPS.filter((o) => !new RegExp("op === '" + o + "'").test(core));
  missO.length === 0 ? ok(`op ${OPS.length} 条齐`) : bad("缺 op：" + missO.join(", "));

  const TOOLS = ["redteam_asset_coverage", "redteam_host_coverage", "redteam_host_finding",
    "redteam_host_findings", "redteam_coverage_gaps", "redteam_coverage_summary"];
  const missT = TOOLS.filter((t) => !tools.includes("name: '" + t + "'"));
  missT.length === 0 ? ok(`工具 ${TOOLS.length} 个注册`) : bad("缺工具：" + missT.join(", "));

  /* attention 的 coverage_available 是「按名字探测 hostNextActions/assetNextActions」得出的。
     两个队列函数一旦缺失，它会诚实地报 false —— 所以这条断言等价于「P7 真的解锁了 P3」。 */
  /const fns = \['hostNextActions', 'assetNextActions'\]/.test(core)
    && /hostNextActions\(id, opts = \{\}\)/.test(core)
    && /assetNextActions\(id, opts = \{\}\)/.test(core)
    ? ok("attention 的 coverage_available 现在会报 true（两个队列函数都在）")
    : bad("attention 探测的两个队列函数不齐，pending_coverage 仍会恒为 0");

  /* 内外网归属必须现算：本包的 asset 表没有 scope 列，照抄 safe 的 COALESCE(a.scope,...)
     会让每一行退化成同一个值，队列把内外网混在一起。 */
  /scopeOfIp\(a\.ip\) !== 'external'/.test(core) && /scopeOfIp\(a\.ip\) !== 'internal'/.test(core)
    ? ok("两侧队列按 scopeOfIp 现算归属（不依赖不存在的 asset.scope 列）")
    : bad("队列没有按 scopeOfIp 过滤内外网");
}

console.log("[18] P6 态势首页");  // 回归 test-attention-badge.mjs
{
  /* 三处必须同时成立，缺一处就是「页签在但点开空白」：
     tabs 表 / TAB_GROUPS / body 分发。组件本体定义一次即可。 */
  for (const f of ["lib/redteam/client.js", "client.js"]) {
    const src = fs.readFileSync(path.join(PKG, f), "utf8");
    const tabEntry = /\['overview', '工作总览'\]|\["overview", "\\u5DE5\\u4F5C\\u603B\\u89C8"\]/.test(src);
    const groupEntry = /key: 'overview', label: '工作总览', tabs: \['overview'\]/.test(src);
    const defs = (src.match(/function OverviewTab\(props\)/g) || []).length;
    const dispatch = /st\.tab === 'overview'\) body = h\(OverviewTab|st\.tab === "overview"\)\n\s+body = h2\(OverviewTab/.test(src);
    /* 首页是全局页：分发必须在 `!eng` 分支**之前**，否则选中靶标前点首页什么都不发生 */
    /* 用「分发点之后 400 字内出现 !eng 分支」判断，不用全局 indexOf 比大小：
       文件别处也有 `!eng) {`，全局比大小会拿到一个更早的位置，永远是 false。 */
    const dispatchAt = src.indexOf("OverviewTab, {");
    const beforeNoEng = dispatchAt !== -1 && /!eng\) \{/.test(src.slice(dispatchAt, dispatchAt + 400));
    /* 五路数据源：少一路首页就少一块，而不是报错 */
    const ops = ["snapshot", "coverageSummary", "attention", "assetCoverage", "hostCoverage", "intelStatus"]
      .filter((o) => src.includes("op: '" + o + "'") || src.includes('op: "' + o + '"'));
    tabEntry && groupEntry && defs === 1 && dispatch && beforeNoEng && ops.length === 6
      ? ok(`${f}：页签 / 分组 / 组件 / 分发 / 6 路数据源 齐`)
      : bad(`${f}：tab=${tabEntry} group=${groupEntry} defs=${defs} dispatch=${dispatch} beforeNoEng=${beforeNoEng} ops=${ops.length}/6`);
  }

  const rt = fs.readFileSync(path.join(PKG, "lib", "redteam", "client.js"), "utf8");
  /* 降级路径必须显式：覆盖度引擎没启用时不能假装「没有缺口」 */
  /coverage_available === false/.test(rt) && /覆盖度引擎未启用/.test(rt)
    ? ok("覆盖度不可用时首页明说，而不是把缺失伪装成 0")
    : bad("首页缺少「覆盖度引擎未启用」的降级文案");
  /pending_coverage/.test(rt) && /该派下一个智能体了/.test(rt)
    ? ok("「没有人等但有缺口」时提示派下一个智能体")
    : bad("首页缺少「有缺口但没人等」的提示");
}

console.log("[19] P9 清理清单 / P10 资源保鲜");  // 回归 test-cleanup.mjs, test-p20.mjs
{
  const schema = fs.readFileSync(path.join(PKG, "lib", "redteam", "schema.js"), "utf8");
  const core = fs.readFileSync(path.join(PKG, "lib", "redteam", "store-core.js"), "utf8");
  const tools = fs.readFileSync(path.join(PKG, "lib", "redteam", "tools.js"), "utf8");

  countOcc(schema, "CREATE TABLE IF NOT EXISTS cleanup_item") === 2
    ? ok("cleanup_item：DDL 与老库迁移块各建一次")
    : bad(`cleanup_item 建表语句 ${countOcc(schema, "CREATE TABLE IF NOT EXISTS cleanup_item")} 处（要求 2）`);

  const CM = ["addCleanup", "listCleanup", "updateCleanup", "cleanupSummary"];
  const missC = CM.filter((m) => !new RegExp("\\b" + m + "\\(").test(core));
  missC.length === 0 ? ok("清理清单 store 方法 4 个齐") : bad("缺方法：" + missC.join(", "));

  const CO = ["cleanup", "addCleanup", "updateCleanup", "cleanupSummary"];
  const missCO = CO.filter((o) => !new RegExp("op === '" + o + "'").test(core));
  missCO.length === 0 ? ok("清理清单 op 4 条齐") : bad("缺 op：" + missCO.join(", "));

  /* wontfix 必须写原因：不清理是一个决定，不是遗漏。没有原因的 wontfix
     在报告里和「忘了做」完全一样。 */
  /wontfix 必须写 detail/.test(core)
    ? ok("wontfix 强制写原因")
    : bad("wontfix 没有强制原因");

  /* 去重只挡「未收口」的：已 done 之后同一位置再出现，是新的待办 */
  /AND status = 'open'/.test(core) && /deduped/.test(core)
    ? ok("清理项去重只挡未收口的（deduped 标记）")
    : bad("清理项缺少去重或去重范围不对");

  tools.includes("name: 'redteam_cleanup'") ? ok("工具 redteam_cleanup 已注册") : bad("缺 redteam_cleanup");

  /* 资源保鲜：只做本地探针，不许出现网络调用 */
  /static INTEL_RESOURCES = \[/.test(core) && /intelStatus\(\)/.test(core) && /intelRefresh\(\)/.test(core)
    ? ok("intelStatus / intelRefresh 就位")
    : bad("缺 intelStatus / intelRefresh");
  /* 只读探针（INTEL_RESOURCES / intelStatus）必须零网络；真下载只许出现在 P21 段。 */
  const intelProbe = core.slice(core.indexOf("static INTEL_RESOURCES"), core.indexOf("[dsh-purge-plus] P21"));
  intelProbe.length > 200 && !/fetch\(|https?:\/\/|tcpConnect/.test(intelProbe)
    ? ok("只读探针不联网（无 fetch / URL / 连接）")
    : bad("只读探针里出现了网络调用（intelStatus 必须纯本地）");
  const intelNet = core.slice(core.indexOf("[dsh-purge-plus] P21"), core.indexOf("/* ---------- 路径 ---------- */"));
  /fetch\(/.test(intelNet) && /max_bytes/.test(intelNet) && /dry_run/.test(intelNet)
    ? ok("刷新走独立方法：fetch + 大小上限 + dry-run")
    : bad("P21 段缺 fetch / 大小上限 / dry-run 之一");
  /known_exploited_vulnerabilities\.json/.test(intelNet) && /codeload\.github\.com/.test(intelNet)
    ? ok("两个下载源都是官方地址（CISA / projectdiscovery）")
    : bad("下载源不是官方地址");
  /renameSync\(/.test(intelNet)
    ? ok("落盘走临时文件 + rename（不留半截 JSON）")
    : bad("没有原子落盘");
  /missing_count/.test(core) && /stale_count/.test(core)
    ? ok("过期与缺失分开报")
    : bad("没有区分 stale 与 missing");
  tools.includes("name: 'redteam_intel'") ? ok("工具 redteam_intel 已注册") : bad("缺 redteam_intel");
  (core.includes("op === 'intelStatus'") && core.includes("op === 'intelRefresh'"))
    ? ok("资源保鲜 op 2 条齐")
    : bad("缺 intelStatus / intelRefresh op");

  /* 徽章：首页顶部一行，不占版面 */
  const panel = fs.readFileSync(path.join(PKG, "client.js"), "utf8");
  /资源保鲜/.test(panel) && /intel\.badge/.test(panel)
    ? ok("首页资源徽章已接（面板内嵌版）")
    : bad("首页缺资源徽章");
}

console.log("[20] P8 数据证明 + 四段式报告");  // 回归 test-report-v2.mjs, test-report-v2-ui.mjs
{
  const schema = fs.readFileSync(path.join(PKG, "lib", "redteam", "schema.js"), "utf8");
  const core = fs.readFileSync(path.join(PKG, "lib", "redteam", "store-core.js"), "utf8");
  const tools = fs.readFileSync(path.join(PKG, "lib", "redteam", "tools.js"), "utf8");

  countOcc(schema, "CREATE TABLE IF NOT EXISTS data_proof") === 2
    ? ok("data_proof：DDL 与老库迁移块各建一次")
    : bad("data_proof 缺建表语句（新库或老库迁移）");
  /* 列名与 safe 2.0.0 逐字一致：老库（曾装过 safe）能直接接上，不会丢历史数据 */
  const COLS = ["asset_id", "vuln_id", "target", "source", "interface", "fields",
    "row_count", "sample", "query", "evidence_ref", "pii_type", "note", "created_by", "created_at"];
  const dpDdl = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS data_proof"), schema.indexOf("CREATE TABLE IF NOT EXISTS cleanup_item"));
  const missCol = COLS.filter((c) => !new RegExp("(^|[^a-z_])" + c + "\\s+(INTEGER|TEXT)").test(dpDdl));
  missCol.length === 0 ? ok(`data_proof 列齐（${COLS.length} 列，与 safe 同名）`) : bad("缺列：" + missCol.join(", "));

  const METHODS = ["addDataProof", "listDataProofs", "reportV2"];
  const missM = METHODS.filter((m) => !new RegExp("^  " + m + "\\(", "m").test(core));
  missM.length === 0 ? ok("store 方法 3 个齐") : bad("缺 store 方法：" + missM.join(", "));

  /* 最要紧的一条：报告不许自己算分。出现独立的累加就是两套口径的开始。 */
  const r2Start = core.indexOf("  reportV2(");
  const r2Block = r2Start < 0 ? "" : core.slice(r2Start, core.indexOf("\n  /* ----------", r2Start));
  /this\.scoreReport\(/.test(r2Block)
    ? ok("reportV2 复用 scoreReport 的分值与条目（不重算）")
    : bad("reportV2 没有复用 scoreReport —— 会出现「报告分」与「面板分」两套口径");
  !/score_hit/.test(r2Block)
    ? ok("reportV2 不直接查 score_hit（分值只有一个来源）")
    : bad("reportV2 自己查了 score_hit —— 两套计分口径必然漂移");

  /* 内网入口必须真的「进去了」才算：只看发现不看入口，会把旁路扫到的设备写成入口 */
  /entryAssets/.test(r2Block) && /access_session/.test(r2Block) && /webshell/.test(r2Block)
    ? ok("内网入口按「有会话/凭据/通道」判定")
    : bad("内网入口没有按进入证据判定");

  (core.includes("op === 'dataProofs'") && core.includes("op === 'addDataProof'") && core.includes("op === 'reportV2'"))
    ? ok("op 3 条齐（dataProofs / addDataProof / reportV2）")
    : bad("缺 op：dataProofs / addDataProof / reportV2");

  tools.includes("name: 'redteam_data_proof'") ? ok("工具 redteam_data_proof 已注册") : bad("缺 redteam_data_proof");

  /* 界面：两份产物都要有四段式组件与切换 */
  for (const f of ["client.js", path.join("lib", "redteam", "client.js")]) {
    const src = fs.readFileSync(path.join(PKG, f), "utf8");
    const need = ["function ReportV2", "function ReportTabPlus", "资产归属证明", "得分汇总表", "得分点复现", "交付清单"];
    const miss = need.filter((k) => !src.includes(k));
    miss.length === 0
      ? ok(`${f}：四段式组件 / 四段标题 / 外层开关 齐`)
      : bad(`${f}：缺 ${miss.join(", ")}`);
    /h2?\(ReportTabPlus, \{ engagement: eng/.test(src)
      ? ok(`${f}：报告页已切到外层开关`)
      : bad(`${f}：报告页没切到 ReportTabPlus（四段式进不去）`);
    src.includes(".rt-r2-proof") && src.includes(".rt-r2-repro")
      ? ok(`${f}：.rt-r2-* 样式已注入`)
      : bad(`${f}：缺 .rt-r2-* 样式`);
  }
}

console.log("[21] P11 复合工具入口");  // 回归 test-composite-tools.mjs
{
  const core = fs.readFileSync(path.join(PKG, "lib", "redteam", "store-core.js"), "utf8");
  const tools = fs.readFileSync(path.join(PKG, "lib", "redteam", "tools.js"), "utf8");

  ["engagementScope", "scopeCheckTarget", "pivotProbe"].forEach((m) => {
    new RegExp("^  (async )?" + m + "\\(", "m").test(core) ? ok(`store.${m} 就位`) : bad(`缺 store.${m}`);
  });

  /* 范围核对必须在 store 里做一份：tools 里再写一遍 IP 数学，迟早两边结论不一样 */
  /ipInCidr|mask = bits === 0/.test(core) ? ok("CIDR 掩码运算在 store（唯一实现）") : bad("找不到 CIDR 运算");

  const TOOLS = ["redteam_asset", "redteam_asset_next", "redteam_host", "redteam_next_action",
    "redteam_batch", "redteam_pivot_probe", "redteam_scope_check", "redteam_template_refresh"];
  const missT = TOOLS.filter((t) => !tools.includes("name: '" + t + "'"));
  missT.length === 0 ? ok(`复合工具 ${TOOLS.length} 个全部注册`) : bad("缺工具：" + missT.join(", "));

  /* 批量落库必须显式报被拒条目，不能静默丢弃 */
  /rejected\.push\(\{ ip: it\.ip, reason: 'out_of_scope'/.test(tools)
    ? ok("batch 超范围条目进 rejected（不静默丢）")
    : bad("batch 没有记录被拒条目");
  /reason: 'out_of_scope'/.test(tools) ? ok("vulns 批量同样按范围拒绝") : bad("vulns 批量没做范围过滤");

  /* 隧道实测：没有网络调用就是假的（必须真握手） */
  /Buffer\.from\(\[5, 1, 0\]\)/.test(core) ? ok("SOCKS5 握手是真的发字节（不是只看端口）") : bad("pivotProbe 没有真握手");

  /* 模板保鲜不许联网：与 P10 同一纪律 */
  const refreshAt = tools.indexOf("name: 'redteam_template_refresh'");
  const refreshBlock = refreshAt < 0 ? "" : tools.slice(refreshAt, refreshAt + 2000);
  !/fetch\(|https?:\/\//.test(refreshBlock)
    ? ok("模板保鲜工具不联网")
    : bad("模板保鲜工具里出现网络调用");
}

console.log("[22] P12 证据账本 UI");  // 回归 test-evidence-ledger.mjs
{
  const core = fs.readFileSync(path.join(PKG, "lib", "redteam", "store-core.js"), "utf8");
  const tabsDef = fs.readFileSync(path.join(ROOT, "overlay", "snippets", "nav-groups-defs.js"), "utf8");

  /import \{ EvidenceLedger, UnknownRegistry \} from '\.\/evidence-ledger\.mjs'/.test(core)
    ? ok("store-core 已引入账本类")
    : bad("store-core 没引入 EvidenceLedger / UnknownRegistry（op 会 ReferenceError）");
  core.includes("op === 'evidenceLedger'") ? ok("op evidenceLedger 就位") : bad("缺 evidenceLedger op");

  /* 三态必须分得开：空账本 / 有未闭环 / 全部闭环。
     混在一起看就是假绿灯 —— 这是这一页唯一真正的价值。 */
  /out\.empty = out\.total === 0 && out\.unknown_total === 0/.test(core)
    ? ok("empty 与 unresolved 分开报（不把空账本当绿灯）")
    : bad("没有区分「还没记账」与「全部核实完毕」");
  /out\.degraded = true/.test(core)
    ? ok("账本被篡改时降级展示（不白屏、不假装正常）")
    : bad("缺降级分支");

  tabsDef.includes("'evidence'")
    ? ok("导航分组已含「证据账本」页签")
    : bad("TAB_GROUPS 里没有 evidence");

  for (const f of ["client.js", path.join("lib", "redteam", "client.js")]) {
    const src = fs.readFileSync(path.join(PKG, f), "utf8");
    ["function EvidenceTab", "function EvidenceRow", "账本还是空的", "未解决的作战问题"].forEach((k) => {
      src.includes(k) ? ok(`${f}：${k}`) : bad(`${f}：缺 ${k}`);
    });
    /h2?\(EvidenceTab, \{ engagement: eng/.test(src)
      ? ok(`${f}：证据账本已分发`)
      : bad(`${f}：证据账本没有分发（页签点开空白）`);
    src.includes("rt-ev-headline") ? ok(`${f}：账本样式已注入`) : bad(`${f}：缺 rt-ev-* 样式`);
  }
}

/* ── [23] P20/P21 报告文档视图 · 会话关系图 · 字段级对齐 · 情报刷新 ── */
console.log("\n[23] P20/P21 报告文档视图 · 会话关系图 · 字段级对齐 · 情报刷新");  // 回归 test-report-v2-ui.mjs, test-p20.mjs
{
  const core = fs.readFileSync(path.join(PKG, "lib", "redteam", "store-core.js"), "utf8");
  const schema = fs.readFileSync(path.join(PKG, "lib", "redteam", "schema.js"), "utf8");

  /* 23.1 scoreReport 的 layout 分支：两条路径都存在，且 simple 不重算分 */
  /* [PA-05] 默认必须是 simple：safe 2.0.2 的默认是 simple，而 redteam_score_report
     三方逐字相同、只传 {limit} —— 默认翻转会让同一个工具在换包后给出另一份报告。 */
  /String\(options\.layout \|\| 'simple'\) !== 'legacy'/.test(core)
    ? ok("scoreReport：默认 simple（legacy 需显式 layout:'legacy'）")
    : bad("scoreReport：默认 layout 不是 simple");
  /report: report,\s*\n\s*markdown: built\.markdown/.test(core)
    ? ok("scoreReport：simple 返回 report + 同一份 markdown")
    : bad("scoreReport：simple 没把 report 带出来");
  /layout: 'legacy'/.test(core)
    ? ok("scoreReport：legacy 分支标明 layout（调用方能分辨拿到的是哪种）")
    : bad("scoreReport：legacy 分支没标 layout");
  /this\.reportV2\(id, Object\.assign\(\{\}, options, \{ layout: 'legacy' \}\)\)/.test(core)
    ? ok("scoreReport：递归保护（reportV2 回调时降级成 legacy）")
    : bad("scoreReport：缺递归保护 —— simple 会无限递归");

  /* 23.2 bootstrap 带 stats */
  /store\.listEngagements\(\{ includeStats: true \}\)/.test(core)
    ? ok("bootstrap：engagements 带 stats")
    : bad("bootstrap：includeStats 仍是 false（面板要再发 N 个请求）");

  /* 23.3 cleanup.location：两处 DDL + 迁移 + 写入 */
  countOcc(schema, "CREATE TABLE IF NOT EXISTS cleanup_item (") === 2
    ? ok("cleanup_item：DDL 仍两处")
    : bad("cleanup_item：DDL 处数变了");
  countOcc(schema, "  location TEXT,") + countOcc(schema, "      location TEXT,") >= 2
    ? ok("cleanup_item：两处 DDL 都有 location")
    : bad("cleanup_item：DDL 缺 location");
  /ensure\('cleanup_item', 'location', 'TEXT'\)/.test(schema)
    ? ok("cleanup_item：老库迁移补 location")
    : bad("cleanup_item：老库不会补 location（升级后写入报错）");
  /INSERT INTO cleanup_item\(asset_id, target, location, kind/.test(core)
    ? ok("addCleanup：写入带 location")
    : bad("addCleanup：没有写 location");

  /* 23.4 覆盖度的 asset.ports */
  /ports: this\.#covPortsOf\(db, asset\.id\),\n\s*\},\n\s*ports: this\.#covPortsOf/.test(
    fs.readFileSync(path.join(PKG, "lib", "redteam", "store-core.js"), "utf8"))
    ? ok("getAssetCoverage：asset.ports 与顶层 ports 同源")
    : bad("getAssetCoverage：缺 asset.ports");

  /* 23.5 会话关系图：store 方法 + op + 组件（两份产物） */
  /sessionGraph\(\) \{/.test(core) ? ok("store：sessionGraph 方法就位") : bad("store：缺 sessionGraph");
  /if \(op === 'sessionGraph'\)/.test(core) ? ok("op：sessionGraph 就位") : bad("op：缺 sessionGraph");
  /count_by_engagement/.test(core) ? ok("sessionGraph：按靶标计数") : bad("sessionGraph：缺计数");
  for (const f of ["client.js", "lib/redteam/client.js"]) {
    const src = fs.readFileSync(path.join(PKG, f), "utf8");
    /function sessionGraphLayout\(/.test(src) ? ok(`${f}：布局是纯函数（可单测）`) : bad(`${f}：缺 sessionGraphLayout`);
    /session-map-too-large/.test(src) ? ok(`${f}：300 节点上限`) : bad(`${f}：缺节点上限`);
    /session-graph-cycle/.test(src) ? ok(`${f}：成环被拒（不无限递归）`) : bad(`${f}：缺成环保护`);
    /rt-sm-graph/.test(src) ? ok(`${f}：图样式已注入`) : bad(`${f}：缺 rt-sm-* 样式`);
  }

  /* 23.6 markdown 渲染器 + 文档视图（两份产物） */
  for (const f of ["client.js", "lib/redteam/client.js"]) {
    const src = fs.readFileSync(path.join(PKG, f), "utf8");
    /function mdParseBlocks\(/.test(src) ? ok(`${f}：markdown 块解析器`) : bad(`${f}：缺 mdParseBlocks`);
    /function MarkdownDoc\(/.test(src) ? ok(`${f}：MarkdownDoc 组件`) : bad(`${f}：缺 MarkdownDoc`);
    /rt-md-doc/.test(src) ? ok(`${f}：markdown 样式已注入`) : bad(`${f}：缺 rt-md-* 样式`);
  }

  /* 23.7 情报刷新：op 走异步 + 工具 action + UI 按钮 */
  /if \(req\.op === 'intelUpdate'\)/.test(core) ? ok("op：intelUpdate 走异步分发") : bad("op：缺 intelUpdate");
  const toolsSrc = fs.readFileSync(path.join(PKG, "lib", "redteam", "tools.js"), "utf8");
  countOcc(toolsSrc, "store.intelUpdate(") >= 2
    ? ok("工具：两个情报入口都能真下载（redteam_intel / redteam_template_refresh）")
    : bad(`工具：只有 ${countOcc(toolsSrc, "store.intelUpdate(")} 处能下载`);
  const panelSrc = fs.readFileSync(path.join(PKG, "client.js"), "utf8");
  /op: ["']intelUpdate["']/.test(panelSrc)
    ? ok("UI：态势首页有「更新 KEV / 模板」按钮")
    : bad("UI：没有刷新入口（只有工具能刷）");

  /* 23.8 审计 R-01：markdown 解析器必须保证前进（曾出过死循环） */
  const mdSrc = fs.readFileSync(path.join(PKG, "lib", "redteam", "client.js"), "utf8");
  /if \(para\.length === 0\) \{ para\.push\(lines\[i\]\); i \+= 1 \}/.test(mdSrc)
    ? ok("mdParseBlocks：兜底分支保证 i 前进（无死循环）")
    : bad("mdParseBlocks：缺前进兜底 —— 以 | 开头的非表格行会死循环");

  /* 23.9 审计 R-02：meta 路径不能与数据文件相同 */
  core.includes("const metaPath = /\\.json$/i.test(dest) ? dest.replace")
    ? ok("KEV：meta 路径与数据文件分离（dest 不以 .json 结尾时不会覆盖数据）")
    : bad("KEV：meta 路径可能等于 dest（48MB 数据会被 11 字节元数据覆盖）");

  /* 23.10 审计 R-03：location 全链（op → 工具 → 报告列） */
  /* addCleanup 直传；updateCleanup 走白名单循环（B1 的写法），所以要查白名单里有没有它 */
  /* R21：addCleanup 分发层改为「req.item || req」后键名是 src.location —— 两者都算转发 */
  /location: (req|src)\.location/.test(core)
    && /for \(const [fk] of \['status', 'detail', 'evidence_ref', 'priority', 'target', 'title', 'location'\]\)/.test(core)
    ? ok("op：addCleanup / updateCleanup 都转发 location")
    : bad("op：location 没转发（写了也永远是 NULL）");
  /location: \{ type: 'string', description: 'add：具体位置/.test(toolsSrc)
    ? ok("工具：redteam_cleanup 有 location 参数")
    : bad("工具：缺 location 参数（智能体写不进去）");
  /c\.location \|\| c\.target/.test(panelSrc)
    ? ok("报告第四段：「位置」列优先 location")
    : bad("报告第四段：位置列只显示 target");

  /* 23.11 审计 R-04：去重键带 location */
  /COALESCE\(target, ''\) = \? AND COALESCE\(location, ''\) = \?/.test(core)
    ? ok("addCleanup：去重键含 location（同主机两个马不会被吞掉）")
    : bad("addCleanup：去重键不含 location");

  /* 23.12 审计 R-05：查不出来 ≠ 清干净；R14 起还要「不按筛选算」 */
  /cleared: queryError === null && openTotal !== null \? openTotal === 0 : null/.test(core)
    && /SELECT COUNT\(\*\) AS n FROM cleanup_item WHERE status = 'open'/.test(core)
    && /out\.cleared = queryError === null \? out\.open === 0 : null/.test(core)
    ? ok("cleanup：cleared 用整表 open 数（查询失败是 null、只看 done 也不会假报清干净）")
    : bad("cleanup：cleared 口径不对（查询失败或按筛选算）");

  /* 23.13 审计 R-09/R-10：nuclei 临时目录必清 + 跨挂载点兜底 + gzip 魔数 */
  /\} finally \{\n\s*try \{ rmSync\(stage/.test(core)
    ? ok("nuclei：stage 目录在 finally 里清（失败也不残留 ≤256MB）")
    : bad("nuclei：stage 只在成功路径清");
  /cpSync\(unpacked, dest, \{ recursive: true \}\)/.test(core)
    ? ok("nuclei：跨挂载点用 cpSync 兜底（否则 rename 必 EXDEV）")
    : bad("nuclei：跨挂载点没有兜底");
  /* 23.14 UI 审计 H-2/H-3：滚动容器与窄面板布局 */
  const panelCss = fs.readFileSync(path.join(PKG, "client.js"), "utf8");
  /\.rt-main\.rt-r2\{overflow:auto\}/.test(panelCss)
    ? ok("报告页：自己滚（父级 overflow:hidden 会吞掉超出的内容）")
    : bad("报告页：没有滚动容器 —— 文档视图超出部分点不到");
  /\.rt-sm-body\{display:grid;grid-template-columns:minmax\(0,1fr\)/.test(panelCss)
    ? ok("会话图：默认单栏（窄面板下详情栏不再盖住节点）")
    : bad("会话图：默认两栏 —— 620px 面板下节点被遮");
  /\.rt-sm-graph-pane\{[^}]*overflow:auto/.test(panelCss)
    ? ok("会话图：图区可横向滚动")
    : bad("会话图：图区裁切且不能滚动");

  /* 23.15 UI 审计 M-4/M-5：拖拽守卫 + 切靶标走 activateEngagement */
  /if \(!ev \|\| ev\.button !== 0\) return/.test(panelCss)
    ? ok("会话图：只认左键拖拽")
    : bad("会话图：中键/右键也会拖动");
  /if \(ev\.buttons === 0\) \{ dragRef\.current = null; return \}/.test(panelCss)
    ? ok("会话图：丢了 pointerup 也不会卡住拖拽")
    : bad("会话图：pointerup 丢失后节点会跟着鼠标跑");
  /op: ["']activateEngagement["']/.test(panelCss)
    ? ok("会话图：点靶标走 activateEngagement（后端指针真的切）")
    : bad("会话图：点靶标只改前端 state，后端指针没动");

  /* 23.16 构建守卫必须与「构建时刻」无关，否则守卫常红等于没有守卫 */
  if (!IN_REPO) {
    na("构建摘要守卫要看 build.mjs 原文（仓库侧）");
  } else {
    const buildSrc = fs.readFileSync(path.join(ROOT, "scripts", "build.mjs"), "utf8");
    /function stableBytes\(rel, abs\)/.test(buildSrc) && /delete holder\.generatedAt/.test(buildSrc)
      ? ok("构建摘要剔除 generatedAt（同 revision 重跑不再误报「内容不同」）")
      : bad("构建摘要含 generatedAt —— 同一内容每次摘要都变，T7 守卫会永远报错");
  }

  /0x1f && got\.buf\[1\] === 0x8b/.test(core)
    ? ok("nuclei：先验 gzip 魔数再解压")
    : bad("nuclei：没有 gzip 魔数校验（200 + HTML 会被当模板包）");
}

// ── 24. 维护文档只在本机：既不进仓库，也不进发行物 ────────────────
// 文档（移植判定 / 审计报告 / 发布手册 / 合规清单）是开发期材料。它们含本机绝对
// 路径与内部推理，不该出现在公开仓库；构建脚本也因此不再把 docs 复制进包。
// 这三条是**回归守卫**：将来谁把 docs 加回 git 或复制回包，验收立刻红。
console.log("[24] 维护文档只在本机");  // 结构
if (!IN_REPO) {
  na("「维护文档不进仓库也不进包」要比对仓库的 docs/ 与 .gitignore（仓库侧）");
} else {
  const localDocs = path.join(ROOT, "docs");
  const localMd = fs.existsSync(localDocs)
    ? fs.readdirSync(localDocs).filter((f) => f.endsWith(".md"))
    : [];

  /* 24.1 git 索引里不得有 docs/ 下的任何文件 */
  let tracked = null;
  try {
    tracked = execFileSync("git", ["ls-files", "docs"], { cwd: ROOT, encoding: "utf8" });
  } catch { tracked = null; }
  if (tracked === null) {
    console.log("  · 不是 git 工作区，跳过索引检查");
  } else if (tracked.trim() === "") {
    ok(`docs/ 未被 git 跟踪（本机 ${localMd.length} 个 md 仍在）`);
  } else {
    bad(`docs/ 又被加进 git 了：${tracked.trim().split("\n").slice(0, 3).join(", ")}…`);
  }

  /* 24.2 .gitignore 必须钉住 /docs/，否则下次 git add -A 又会带进来 */
  const gi = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  /^\/docs\/$/m.test(gi)
    ? ok(".gitignore 钉住 /docs/")
    : bad(".gitignore 缺 /docs/ —— git add -A 会把维护文档重新加进仓库");

  /* 24.3 包内不得出现与本机文档同字节的文件（按 sha256 精确比对，不靠文件名） */
  const pkgDocs = path.join(PKG, "docs");
  const hash = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  const ours = new Set(localMd.map((f) => hash(path.join(localDocs, f))));
  const leaked = fs.existsSync(pkgDocs)
    ? fs.readdirSync(pkgDocs).filter((f) => f.endsWith(".md") && ours.has(hash(path.join(pkgDocs, f))))
    : [];
  leaked.length === 0
    ? ok(`发行物不含本仓库维护文档（包内 docs ${fs.existsSync(pkgDocs) ? fs.readdirSync(pkgDocs).length : 0} 个文件，均来自上游）`)
    : bad(`发行物里出现了本仓库维护文档：${leaked.join(", ")}`);
}

// ── 25. 待办角标挂在 shell.overlay，且不自动收口 ────────────────────
// 角标的价值全在「不在这页也看得见」。挂到页签内部功能测试照样全绿（打开演练台能看见），
// 只有人在别的页面时才暴露 —— 所以这里断言**挂载点**，不是「组件存在」。
console.log("[25] 待办角标");  // 回归 test-attention-badge.mjs
{
  const panel = fs.readFileSync(path.join(PKG, "client.js"), "utf8");
  const rt = fs.readFileSync(path.join(PKG, "lib", "redteam", "client.js"), "utf8");

  const fnAt = panel.indexOf("function AttentionBadge()");
  const ovAt = panel.indexOf("function PanelOverlays()");
  if (fnAt < 0) bad("面板产物缺 AttentionBadge 组件");
  else ok("面板产物有 AttentionBadge");

  /* 25.1 挂载点：必须出现在 PanelOverlays 函数体内（shell.overlay 的插槽） */
  if (fnAt >= 0 && ovAt > fnAt) {
    const overlays = panel.slice(ovAt, panel.indexOf("function apply(ctx)", ovAt));
    overlays.includes("h(AttentionBadge")
      ? ok("挂在 PanelOverlays（shell.overlay 常驻，不随页签切换消失）")
      : bad("AttentionBadge 没挂进 PanelOverlays —— 只有打开某个页签时才看得见");
    overlays.includes("h(EnvAdaptSendGate)")
      ? ok("PanelOverlays 原有内容未被替换")
      : bad("PanelOverlays 原有内容被覆盖了");
  }

  /* 25.2 不自动收口：收口是人的判断，自动 ack 会把「我还没答」变成「已处理」 */
  if (fnAt >= 0) {
    const body = panel.slice(fnAt, ovAt > fnAt ? ovAt : fnAt + 12000);
    body.includes("attentionAck")
      ? bad("角标里出现 attentionAck —— 读了就收口等于替人做决定")
      : ok("角标不自动收口");
    body.includes('op: "attention"')
      ? ok("角标读 attention op")
      : bad("角标没读 attention op");
  }

  /* 25.3 跳页事件两端都在：只有一端 = 按钮点了没反应 */
  const listeners = [rt, panel].filter((t) => t.includes("addEventListener('dsh-purge-plus:goto-tab'")).length;
  listeners === 2
    ? ok("跳页事件两端都在（独立窗口 + 面板内嵌）")
    : bad(`跳页事件只有 ${listeners}/2 端在监听 —— 「去智能体页」会点了没反应`);
}

// ── 26. 计数口径：文档数字 vs 代码复算 ─────────────────────────────
// 教训有两条：
//   ① README 曾写「26 处 / 6 处」锚点编辑，实际 172 条 —— 文档与代码
//      长期各说各话，因为从来没有一条断言把两边对过账。
//   ② 2026-11-22 的第三方审计把上游补丁静态数成 87 条（漏了 new-tools
//      里的 #90），据此宣布「95 条被推翻」。运行时 ALL_PATCHES 实测 88 条，
//      88 + 自有 7 = 95，构建不变式本来就是对的 —— 错的是文本扫描。
//      （后来加了自有 #209，总数变成 96 = 88 + 8；下面一律用 allIds.length，
//      不再写死 —— 写死的那个数正是 README 停在 95 而没人发现的原因。）
// 所以这里不数源码文本，而是 import 装配产物的补丁表；README 必须出现
// 同一个数字，加一条编辑/补丁而不改文档就会在这里红。
console.log("[26] 计数口径（文档 vs 代码复算）");  // 结构
if (!IN_REPO) {
  na("计数复算要读 build.mjs 的 SNIPPETS 表与 docs 原文（仓库侧）");
} else {
  const { buildEdits } = await import("../overlay/edits.mjs");
  const edits = buildEdits(resolveRepo());
  const reqFalse = edits.filter((e) => e.required === false).length;
  const buildSrc = fs.readFileSync(path.join(ROOT, "scripts", "build.mjs"), "utf8");
  const s0 = buildSrc.indexOf("const SNIPPETS = [");
  const s1 = buildSrc.indexOf("for (const sn of SNIPPETS)", s0);
  const snippets = s0 >= 0 && s1 > s0 ? (buildSrc.slice(s0, s1).match(/dialect:/g) || []).length : -1;

  const patchesMod = await import(path.join(PKG, "lib", "patches", "index.mjs"));
  const overlayMod = await import(path.join(PKG, "lib", "patches", "overlay.mjs"));
  const allIds = patchesMod.ALL_PATCHES.map((p) => p.id);
  const ownIds = (overlayMod.OVERLAY_PATCHES || []).map((p) => p.id);
  const retainedMod = await import(path.join(PKG, "lib", "patches", "retained.mjs"));
  const retainedIds = (retainedMod.RETAINED_PATCHES || []).map((p) => p.id);
  // 1.7.24 把 14 条执行边界补丁下线，本包改为自有补丁保留（retained.mjs）。
  // 所以「上游」= 既不是自有、也不是保留的那部分。
  const upIds = allIds.filter((id) => !ownIds.includes(id) && !retainedIds.includes(id));
  const missing = [];
  for (let i = 1; i <= 96; i += 1) if (!upIds.includes(i)) missing.push(i);

  upIds.length === 74
    ? ok(`上游 1.7.24 补丁 ${upIds.length} 条（1–96，缺号 ${missing.length} 个：${missing.join(",")}）`)
    : bad(`上游补丁应为 74 条，实际 ${upIds.length}（缺号 ${missing.join(",")}）`);
  retainedIds.length === 14
    ? ok(`保留的退役补丁 ${retainedIds.length} 条（${retainedIds.join(",")}）`)
    : bad(`保留的退役补丁应为 14 条，实际 ${retainedIds.length}`);
  ownIds.length === 8
    ? ok(`自有补丁 ${ownIds.length} 条（${ownIds.join(",")}）`)
    : bad(`自有补丁应为 8 条，实际 ${ownIds.length}`);
  allIds.length === 96
    ? ok(`合计 ${allIds.length} 条（74 + 14 + 8）`)
    : bad(`合计应为 96，实际 ${allIds.length}`);
  new Set(allIds).size === allIds.length
    ? ok("id 无重复")
    : bad("id 有重复");

  edits.length > 0
    ? ok(`overlay/edits.mjs ${edits.length} 条（required:false ${reqFalse} 条）`)
    : bad("overlay/edits.mjs 读不出条目");
  snippets > 0 ? ok(`§3c snippet 注入点 ${snippets} 处`) : bad("snippet 计数失败");

  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const must = [
    [`${edits.length} 条`, "锚点编辑条数"],
    [`${snippets} 处`, "snippet 注入点"],
    ["74 条", "上游补丁条数"],
    ["14 条", "保留的退役补丁条数"],
    [`${allIds.length} 条`, "补丁合计"],
  ];
  for (const [needle, label] of must) {
    readme.includes(needle) ? ok(`README 含正确数字：${label} = ${needle}`) : bad(`README 缺失正确数字：${label}（应含「${needle}」）`);
  }
  for (const stale of ["没有一行逻辑删改", "26 处锚点", "6 处锚点"]) {
    readme.includes(stale) ? bad(`README 仍有旧错误表述：${stale}`) : ok(`README 无旧表述：${stale}`);
  }
  // 英文版同一口径。上一轮审计抓到过「英文徽章漏改」——只查中文等于只查一半。
  const readmeEn = fs.readFileSync(path.join(ROOT, "README.en.md"), "utf8");
  for (const [needle, label] of [[`${edits.length} anchor edits`, "锚点编辑条数"], [`${snippets} snippet injection`, "snippet 注入点"]]) {
    readmeEn.includes(needle) ? ok(`README.en 含正确数字：${label}`) : bad(`README.en 缺失正确数字：${label}（应含「${needle}」）`);
  }

  // 注释也会说谎：build.mjs 头部写着「179 条（required 176）」，实际 185/182，
  // 而读注释的人会据此以为改动面比真实的小。注释里的数字同样纳入复算。
  {
    const head = buildSrc.slice(0, buildSrc.indexOf("import fs from"));
    const m = head.match(/锚点编辑：overlay\/edits\.mjs \*\*(\d+) 条\*\*（required (\d+) \/ required:false (\d+)）/);
    if (!m) bad("build.mjs 头部注释里找不到锚点编辑计数（注释被改成了别的形状，本组无法核对）");
    else {
      const [, total, req, reqFalse2] = m.map(Number);
      const wantReq = edits.length - reqFalse;
      total === edits.length && req === wantReq && reqFalse2 === reqFalse
        ? ok(`build.mjs 注释计数与代码一致（${total} = required ${req} + required:false ${reqFalse2}）`)
        : bad(`build.mjs 注释计数过时：写 ${total}/${req}/${reqFalse2}，实际 ${edits.length}/${wantReq}/${reqFalse}`);
    }
  }

  /* 只查"某处含正确数字"是不够的 —— 2026-11-23 就是这样漏的：README.md 第 64 行
     写 185（新），第 233/273 行还写 176（旧），存在性断言照样绿。这里改成
     「所有出现处都必须等于实际条数」，任何一处旧数字都算失败。 */
  for (const [file, text, pattern, unit] of [
    ["README.md", readme, /(\d+)\s*条锚点编辑/g, "条"],
    ["README.en.md", readmeEn, /(\d+)\s*anchor edits/g, "anchor edits"],
  ]) {
    const seen = [...text.matchAll(pattern)].map((m) => Number(m[1]));
    const wrong = seen.filter((n) => n !== edits.length);
    seen.length === 0
      ? bad(`${file} 找不到锚点编辑条数（应至少出现一次 ${edits.length}）`)
      : wrong.length === 0
        ? ok(`${file} 锚点编辑条数一致（${seen.length} 处均为 ${edits.length}）`)
        : bad(`${file} 锚点编辑条数不一致：${wrong.join("、")} ≠ ${edits.length}`);
  }
}

// ── 27. 装配包 scripts 路径存在 ────────────────────────────────────
// 与 build §4 的剔除规则同一条：装配包 package.json 里每个 script 引用
// 的相对路径都必须在装配目录真实存在。build 漏剔或基座将来新增死脚本，
// 都会在这里红 —— 装到用户机器上「点哪条炸哪条」属于交付事故。
console.log("[27] 装配包 scripts 路径存在");  // 结构
{
  const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"));
  const SCRIPT_PATH_RE = /(?<![\w/.-])((?:test|packages|scripts|bin|lib|docs|locale|presets|skills)\/[^\s"']+)/g;
  let checked = 0;
  const missingRefs = [];
  for (const [name, cmd] of Object.entries(pkgJson.scripts || {})) {
    for (const m of String(cmd).matchAll(SCRIPT_PATH_RE)) {
      checked += 1;
      if (!fs.existsSync(path.join(PKG, m[1]))) missingRefs.push(`${name} → ${m[1]}`);
    }
  }
  missingRefs.length === 0
    ? ok(`scripts 引用的 ${checked} 个相对路径全部存在`)
    : bad(`scripts 引用了不存在的路径：${missingRefs.join(" · ")}`);
}

console.log("[28] op 契约（两家上游能力面 vs 产物）");  // 结构
if (!IN_REPO) {
  na("op 契约要读 vendor/ 里两家上游的 store-core（仓库侧）");
} else {
  // 「覆盖社区版与 safe 版的全部能力」的分母是后端 op，不是 UI：
  // store-core 的 dispatch 是扁平 if 链，UI 只是它的消费者。这一组把分母
  // 钉住 —— 上游新增一条 op 而产物没有，或 UI 写错一个 op 名，都在这里红，
  // 而不是等用户看到空白页面。
  let out = "";
  let code = 0;
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, "scripts", "check-op-contract.mjs")], {
      cwd: ROOT, encoding: "utf8",
    });
  } catch (e) {
    out = `${e.stdout || ""}${e.stderr || ""}`;
    code = e.status ?? 1;
  }
  const cov = out.match(/覆盖 (\d+)\/(\d+)/);
  const uni = out.match(/union (\d+)/);
  code === 0
    ? ok(`op 覆盖 ${cov ? cov[1] + "/" + cov[2] : "?"}（并集 ${uni ? uni[1] : "?"} 条）· UI 引用全部可解析`)
    : bad(`op 契约不通过：${out.split("\n").filter((l) => l.startsWith("FAIL")).join(" · ") || out.trim()}`);
  // 门禁本身必须能看见失败：三种变异在 check-op-contract 的用法说明里，这里只
  // 断言它至少报出了一个数，避免脚本被改成 `exit 0` 的空壳还显示绿。
  cov && uni ? null : bad("op 契约没有输出覆盖数字（脚本可能被改成空壳）");
}

// ── [29] safe 能力层移植（技能 / 叶子模块 / 接线） ────────────────
// 三件事都是「加文件」型的改动，最容易出现的是**加了但没落地**或**落地了但没人用**。
// 所以这里既查包内文件，也查引用链：技能文本里点名的工具必须真存在，
// 移植模块必须被 import，否则就是死代码。
{
  console.log("[29] safe 能力层移植");  // 结构
  const pkgSkills = path.join(PKG, "skills", "redteam");
  const names = fs.existsSync(pkgSkills) ? fs.readdirSync(pkgSkills).filter((f) => f.endsWith(".md")) : [];
  names.length === 40
    ? ok(`技能库 ${names.length} 个（community 23 + safe 独有 17）`)
    : bad(`技能库 ${names.length} 个，期望 40`);

  // 技能文本点名的工具必须在 tools.js 里注册；点错名字等于让智能体调一个不存在的工具。
  const toolsSrc = fs.readFileSync(path.join(PKG, "lib/redteam/tools.js"), "utf8");
  const registered = new Set([...toolsSrc.matchAll(/name:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]));
  const referenced = new Set();
  for (const f of names) {
    const text = fs.readFileSync(path.join(pkgSkills, f), "utf8");
    for (const m of text.matchAll(/redteam_[a-z0-9_]+/g)) referenced.add(m[0]);
  }
  const missing = [...referenced].filter((t) => !registered.has(t));
  missing.length === 0
    ? ok(`技能引用的 ${referenced.size} 个工具全部已注册`)
    : bad(`技能引用了未注册的工具：${missing.join(", ")}`);

  // 移植的叶子模块：必须存在，且必须被 import（否则是死代码）。
  const ported = ["slot-state", "ticket-stage", "team-board", "orchestrator-clock", "kev", "cve-db", "intel-sync", "team-mode"];
  const absent = ported.filter((m) => !fs.existsSync(path.join(PKG, "lib/redteam", m + ".js")));
  absent.length === 0 ? ok(`移植模块 ${ported.length} 个全部在包内`) : bad(`移植模块缺失：${absent.join(", ")}`);

  const capSrc = fs.readFileSync(path.join(PKG, "lib/plus-capabilities.js"), "utf8");
  const indexSrc = fs.readFileSync(path.join(PKG, "lib/index.js"), "utf8");
  const wired = /installPlusCapabilities/.test(indexSrc) && /installTeamMode/.test(capSrc);
  wired ? ok("能力接线层已挂进 apply（team-mode + preset-default）") : bad("能力接线层没有挂进 apply");

  // Apache-2.0 §4(b)：改过的文件要带改动标注。移植件统一带来源行。
  const unmarked = ported
    .map((m) => path.join(PKG, "lib/redteam", m + ".js"))
    .concat([path.join(PKG, "lib/preset-default.js")])
    .filter((f) => !fs.readFileSync(f, "utf8").slice(0, 400).includes("[dsh-purge-plus]"));
  unmarked.length === 0 ? ok("移植件均带来源标注（Apache-2.0 §4(b)）") : bad(`缺来源标注：${unmarked.map((f) => path.basename(f)).join(", ")}`);
}

// ── [30] 团队任务板面板 + CVE 底库 ────────────────────────────────
// 这两块最容易出的错都是「代码写了但没接上」：页签加了却没进导航分组
// （二级页签被过滤掉，点不出来），工具加了却指向一个不在包里的构建器
// （报错文案让人去跑一个不存在的脚本）。
{
  console.log("[30] 团队任务板 / CVE 底库");  // 回归 test-intel-cve-sync.mjs
  const uiSrc = fs.readFileSync(path.join(PKG, "lib/redteam/ui.js"), "utf8");
  const hasFn = /async function handleTeamBoardOp\(ctx, store, request\)/.test(uiSrc);
  const hasRoute = /const teamBoardResult = await handleTeamBoardOp\(ctx, store, request\)/.test(uiSrc);
  hasFn && hasRoute ? ok("任务板数据面在 ui.js 且已接进 /redteam/api 路由") : bad("任务板数据面没接进路由（op 会 404/unknown）");

  const panel = fs.readFileSync(path.join(PKG, "client.js"), "utf8");
  const redteam = fs.readFileSync(path.join(PKG, "lib/redteam/client.js"), "utf8");
  /\["team",/.test(panel) && /\['team', '任务板'\]/.test(redteam)
    ? ok("两份产物都有「任务板」页签") : bad("任务板页签缺失（面板内嵌版或独立窗口）");
  /st\.tab === "team"/.test(panel) && /st\.tab === 'team'/.test(redteam)
    ? ok("两份产物都有任务板分发") : bad("任务板分发缺失");
  /tabs: \['agents', 'team'\]/.test(panel) && /tabs: \['agents', 'team'\]/.test(redteam)
    ? ok("导航分组「协同进度」含任务板") : bad("任务板没进导航分组（二级页签会被过滤掉）");
  /* 只读纪律：面板里没有 Agent 身份，任何 teamTask* 写 op 都会绕过 TEAM_LEAD_REQUIRED。 */
  /op:\s*["']teamTask/.test(panel) || /op:\s*["']teamTask/.test(redteam)
    ? bad("任务板出现了写 op（会绕过 TEAM_LEAD_REQUIRED）") : ok("任务板只读（无写 op）");

  /* 判定口径：会话头的 agentPreset 是建会话时的快照，切过预设它不变。
     只看 header 会把「中途切到红队」的会话判成非红队，进而误关它的团队模式
     （v0.1.54 实测踩过：8 条里 1 条是被误关的真红队会话）。 */
  /event\.type === ['"]agent-preset\/selected['"]/.test(uiSrc)
    ? ok("预设判定读 agent-preset/selected（不只看 header 快照）")
    : bad("预设判定只看 header：中途切到红队的会话会被误关");
  /Array\.isArray\(request\.restore\)/.test(uiSrc)
    ? ok("开启回滚只认显式 restore 列表（不自动开）")
    : bad("restore 会自动推断：可能把用户手动关掉的团队模式又开回去");
  /* 反向同一个坑：按 header 跳过不读日志，会漏掉「头是红队、中途切到普通、
     team/mode 还开着」的会话。全量读 65 会话 / 104MB 实测约 2.1 秒，不值得为它省。 */
  /skipped\.push\(/.test(uiSrc) || /const skipped = \[\]/.test(uiSrc)
    ? bad("审计按 header 跳过会话：会漏掉「头是红队、中途切走、模式还开着」的那一类")
    : ok("审计不按 header 跳过（每份日志都读，不漏反向误判）");

  /* 行组装是显式白名单：官方视图的字段少复制一个，面板就是「看着正常、少一栏」。
     v0.1.56 实测漏了 writeScopeWarnings —— 两条 in_progress 任务写域重叠，
     面板上一条告警都没有。这里把官方 TASK_VIEW_SCHEMA 的 11 个字段逐个对一遍。 */
  const rowStart = uiSrc.indexOf("id: String(task.id");
  const rowBlock = rowStart < 0 ? "" : uiSrc.slice(rowStart, uiSrc.indexOf("report_at:", rowStart) + 12);
  const officialFields = [
    ["id", "id:"], ["revision", "revision:"], ["subject", "subject:"],
    ["description", "description:"], ["status", "status:"], ["blockedBy", "blockedBy:"],
    ["writeScopes", "writeScopes:"], ["ownerId", "owner_id:"], ["ownerName", "owner_name:"],
    ["ready", "ready:"], ["writeScopeWarnings", "writeScopeWarnings:"],
  ];
  const missingFields = officialFields.filter(([, token]) => !rowBlock.includes(token)).map(([name]) => name);
  rowStart >= 0 && missingFields.length === 0
    ? ok(`任务行保留官方视图全部 ${officialFields.length} 个字段（含写域重叠告警）`)
    : bad(`任务行漏了官方字段：${missingFields.join(", ") || "整段行组装都找不到"}`);
  /* 字段传了但界面不画 = 等于没有。两份产物都要渲染。 */
  /writeScopeWarnings/.test(panel) && /writeScopeWarnings/.test(redteam)
    ? ok("两份产物都渲染写域冲突告警")
    : bad("写域冲突告警没渲染（数据层修了但界面不画）");

  /* 上面那条只证明「那一行在」，不证明「值是对的」。v0.1.57 就是这么绿的：
     代码写的是 `teams.tasks.list(target)`，而 TeamService 上没有 `tasks` 成员，
     探测永远为假 → hostView 恒 null → writeScopeWarnings 恒空。
     所以这里既要查"取宿主视图的入口对不对"，也要把规则真跑一遍对答案。 */
  /teams\.listTasks\(/.test(uiSrc) && /agentsSvc\.get\(|agents\.get\(/.test(uiSrc)
    ? ok("宿主视图经 teams.listTasks(agent) 获取（Agent 由 agents.get 按会话取）")
    : bad("拿不到宿主视图：listTasks 需要 Agent，缺 agents.get 就只能永远退回快照");
  /teams\.tasks\b/.test(uiSrc)
    ? bad("还在探测 teams.tasks —— TeamService 没有这个成员，那段是死代码")
    : ok("没有 teams.tasks 死探测");
  /warningsOf\(allTasks, task\)/.test(uiSrc)
    ? ok("快照退回时按官方同一条规则现算写域告警")
    : bad("快照退回时写域告警恒空（透传一个快照里根本不存在的字段）");

  /* 行为测试：期望值取自宿主自己的 team_task_list 实测输出
     （task-1 已完成、task-2 进行中、两条写域都是 recon → task-1 与 task-3 各得一条告警）。 */
  try {
    const { writeScopeWarningsOf, scopesOverlap } = await import(
      path.join(PKG, "lib/redteam", "team-board-views.js")
    );
    const fixtures = [
      { id: "task-1", status: "completed", writeScopes: ["recon"] },
      { id: "task-2", status: "in_progress", writeScopes: ["recon"] },
      { id: "task-3", status: "pending", writeScopes: ["recon"] },
      { id: "task-4", status: "pending", writeScopes: ["docs/report.md"] },
      { id: "task-5", status: "deleted", writeScopes: ["recon"] },
    ];
    const cases = [
      ["已完成任务与进行中任务重叠", writeScopeWarningsOf(fixtures, fixtures[0]), ["write scopes overlap with task-2"]],
      ["进行中任务自身不告警", writeScopeWarningsOf(fixtures, fixtures[1]), []],
      ["待领取任务与进行中任务重叠", writeScopeWarningsOf(fixtures, fixtures[2]), ["write scopes overlap with task-2"]],
      ["写域不相交不告警", writeScopeWarningsOf(fixtures, fixtures[3]), []],
    ];
    const failed = cases.filter(([, got, want]) => JSON.stringify(got) !== JSON.stringify(want));
    failed.length === 0
      ? ok(`写域告警行为正确（${cases.length} 个用例，deleted 兄弟不计入）`)
      : bad(`写域告警行为不对：${failed.map(([n, got, want]) => `${n} 得到 ${JSON.stringify(got)} 期望 ${JSON.stringify(want)}`).join("；")}`);
    scopesOverlap("recon", "reconciliation") === false && scopesOverlap("recon", "recon/subs") === true
      ? ok("写域比较落在路径分隔符上（recon ≠ reconciliation，recon ⊃ recon/subs）")
      : bad("写域比较用裸 startsWith：recon 会把 reconciliation 也算成重叠");

    /* 空串口径：上游 `scopesOverlap('', '')` 为真。空串实际进不了库
       （写入时 writeScope('') 抛 TEAM_INVALID_WRITE_SCOPE），所以下面这组
       断言钉的是"判据本身与上游逐字一致"，不是某个真实可达场景。 */
    const emptyPair = [
      { id: "task-a", status: "in_progress", writeScopes: [""] },
      { id: "task-b", status: "in_progress", writeScopes: [""] },
    ];
    const emptyVsReal = [
      { id: "task-a", status: "in_progress", writeScopes: [""] },
      { id: "task-c", status: "in_progress", writeScopes: ["recon"] },
    ];
    const noScopes = [
      { id: "task-d", status: "in_progress", writeScopes: [] },
      { id: "task-e", status: "in_progress", writeScopes: [] },
    ];
    const emptyCases = [
      ["空串写域互撞与宿主同报", writeScopeWarningsOf(emptyPair, emptyPair[0]), ["write scopes overlap with task-b"]],
      ["空串写域不撞真实写域", writeScopeWarningsOf(emptyVsReal, emptyVsReal[0]), []],
      ["未声明写域（空数组）互不告警", writeScopeWarningsOf(noScopes, noScopes[0]), []],
    ];
    const emptyFailed = emptyCases.filter(([, got, want]) => JSON.stringify(got) !== JSON.stringify(want));
    emptyFailed.length === 0
      ? ok("写域空串口径与宿主一致（3 个用例）")
      : bad(`写域空串口径与宿主分叉：${emptyFailed.map(([n, got, want]) => `${n} 得到 ${JSON.stringify(got)} 期望 ${JSON.stringify(want)}`).join("；")}`);
  } catch (error) {
    bad(`写域规则模块导入失败：${error && error.message ? error.message : String(error)}`);
  }

  /* 明确点名却找不到会话时不能静默换板 —— 面板会把别人的任务当成这个会话的显示。
     缺参和找不到也要分开报（v0.1.58 两种情况都报"会话不在本进程"，原因说错）。 */
  /找不到会话：/.test(uiSrc) && /teamBoardMode 需要 session 参数/.test(uiSrc)
    ? ok("任务板：点名找不到会话时报错，缺参与找不到分开报")
    : bad("任务板：显式 session 找不到时可能静默换成别的会话的板");
  /error:\s*'[^']*会话不在本进程/.test(uiSrc)
    ? bad("还在用「会话不在本进程」这句：缺参时它把原因说反了")
    : ok("没有「会话不在本进程」这句误导文案");

  /* 缺参文案：把 undefined 拼进错误里，调用方分不清「你没给 id」和「这个 id 不存在」。
     这里真起一个临时 store 打一遍 dispatch —— 只查字符串在不在等于没查。 */
  try {
    const { RedteamStore, dispatch } = await import(path.join(PKG, "lib/redteam", "store-core.js"));
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-verify-"));
    const probeStore = new RedteamStore(tmpRoot);
    const probes = [
      ["pocGet", { op: "pocGet" }, /需要 id 或 code/],
      ["pocDelete", { op: "pocDelete" }, /需要 id 或 code/],
      ["pocUse", { op: "pocUse" }, /需要 id 或 code/],
      ["pocUpdate", { op: "pocUpdate" }, /需要 id 或 code/],
      ["activateEngagement", { op: "activateEngagement" }, /需要 engagement/],
      ["pocGet 查无此条", { op: "pocGet", id: 99999 }, /poc not found: 99999/],
      ["activateEngagement 查无此靶标", { op: "activateEngagement", engagement: "no-such-engagement" }, /engagement not found/],
    ];
    const bads = [];
    for (const [label, req, want] of probes) {
      const got = dispatch(probeStore, req);
      const text = String((got && got.error) || "");
      if (!want.test(text)) bads.push(`${label} 得到 ${JSON.stringify(text)}`);
      if (/undefined/.test(text)) bads.push(`${label} 文案里漏了 undefined：${JSON.stringify(text)}`);
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    bads.length === 0
      ? ok(`缺参文案正确（${probes.length} 个用例，无 undefined 外泄）`)
      : bad(`缺参文案不对：${bads.join("；")}`);
  } catch (error) {
    bad(`dispatch 探测失败：${error && error.message ? error.message : String(error)}`);
  }

  const builder = path.join(PKG, "scripts", "build-cve-db.mjs");
  fs.existsSync(builder) ? ok("CVE 构建器随包分发（scripts/build-cve-db.mjs）") : bad("CVE 构建器没进包（工具报错会指向不存在的脚本）");
  const toolsSrc2 = fs.readFileSync(path.join(PKG, "lib/redteam", "tools.js"), "utf8");
  /name: 'redteam_cve'/.test(toolsSrc2) ? ok("redteam_cve 已注册") : bad("redteam_cve 未注册");

  const localDb = path.join(ROOT, "intel", "cve.db");
  if (fs.existsSync(localDb)) {
    const { validateCveDbFile } = await import(path.join(PKG, "lib/redteam", "cve-db.js"));
    const v = validateCveDbFile(localDb);
    v.ok ? ok(`本机 CVE 库校验通过（v${v.version} · ${v.count} 条）`) : bad(`本机 CVE 库校验失败：${v.error}`);
  } else {
    ok("本机未建 CVE 库（可选层：node scripts/build-cve-db.mjs --install）");
  }
}

// [31] 验收组数口径（文档 vs 自身）
// 本组把自己也算进去：组号必须是 1..N 连续，两份 README 里每一处「N 组只读」
// 都必须等于这个 N。上一版 README 写着 28 组而实际已有 30 组 —— 存在性断言
// 抓不到「数字过时」，这里逐处比对。
console.log("[31] 验收组数口径（文档 vs 自身）");  // 结构
{
  const selfSrc = fs.readFileSync(path.join(ROOT, "scripts", "verify.mjs"), "utf8");
  const nums = [...selfSrc.matchAll(/console\.log\("(?:\\n)?\[(\d+)\]/g)].map(m => Number(m[1]));
  const uniq = [...new Set(nums)].sort((a, b) => a - b);
  const total = uniq.length;
  const contiguous = total > 0 && uniq.every((n, i) => n === i + 1);
  contiguous ? ok(`组号连续 1–${total}（共 ${total} 组）`) : bad(`组号不连续：${uniq.join(",")}`);
  for (const [file, re] of [
    ["README.md", /(\d+) 组只读/g],
    ["README.en.md", /(\d+) read-only checks/g],
  ]) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const found = [...text.matchAll(re)].map(m => Number(m[1]));
    if (found.length === 0) bad(`${file} 没有出现验收组数`);
    else if (found.every(n => n === total)) ok(`${file} 验收组数一致（${found.length} 处均为 ${total}）`);
    else bad(`${file} 验收组数不一致：${found.join(",")} ≠ ${total}`);
  }
}

// [32] 文档与产物一致性（README 说的是不是产物里真有的）
// 上一轮只守住「数字」，守不住「清单」：README 的自有补丁一节列了 201/202/203/205/206
// 五条，实际有七条（207/208 从未出现在文档里）；页签数写着 11、产物里是 14；
// 「6 分组导航在路线图」其实早已实现；还引用了三个不在仓库里的文件（RELEASE.md /
// UPSTREAM.md / package.json）。这一组把这些逐条钉在产物上。
console.log("[32] 文档与产物一致性");  // 结构
{
  const clientSrc = fs.readFileSync(path.join(PKG, "client.js"), "utf8");
  const tabsAt = clientSrc.indexOf("const tabs = [");
  const tabsEnd = clientSrc.indexOf("];", tabsAt);
  const tabIds = tabsAt >= 0 && tabsEnd > tabsAt
    ? [...clientSrc.slice(tabsAt, tabsEnd).matchAll(/\[\s*"([a-z-]+)"\s*,/g)].map((m) => m[1])
    : [];
  const grpAt = clientSrc.indexOf("const TAB_GROUPS = [");
  /* 不能用 indexOf("]") 找数组结尾 —— 第一个 ] 是 `tabs: ['overview']` 里的。
     做一次括号配对：从 [ 起数深度，回到 0 才是整个数组。 */
  let groups = 0;
  if (grpAt >= 0) {
    const open = clientSrc.indexOf("[", grpAt);
    let depth = 0;
    let end = -1;
    for (let i = open; i < clientSrc.length; i += 1) {
      const ch = clientSrc[i];
      if (ch === "[") depth += 1;
      else if (ch === "]") { depth -= 1; if (depth === 0) { end = i; break } }
    }
    if (end > open) groups = [...clientSrc.slice(open, end).matchAll(/\{\s*key:\s*'/g)].length;
  }
  tabIds.length > 0 ? ok(`产物页签 ${tabIds.length} 个（${tabIds.join(" ")}）`) : bad("读不出产物页签表");
  groups > 0 ? ok(`产物一级分组 ${groups} 个`) : bad("读不出一级分组表");

  const overlayMod = await import(path.join(PKG, "lib", "patches", "overlay.mjs"));
  const ownIds = (overlayMod.OVERLAY_PATCHES || []).map((p) => p.id);

  for (const [file, lang] of [["README.md", "zh"], ["README.en.md", "en"]]) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const wantTabs = lang === "zh" ? `${tabIds.length} 个页签` : `${tabIds.length} tabs`;
    const wantGroups = lang === "zh" ? `${groups} 个分组` : `${groups} groups`;
    text.includes(wantTabs) ? ok(`${file} 页签数 = ${tabIds.length}`) : bad(`${file} 页签数不对（应含「${wantTabs}」）`);
    text.includes(wantGroups) ? ok(`${file} 分组数 = ${groups}`) : bad(`${file} 分组数不对（应含「${wantGroups}」）`);

    const missingIds = ownIds.filter((id) => !text.includes(`#${id}`) && !text.includes(String(id)));
    missingIds.length === 0
      ? ok(`${file} 列全自有补丁 ${ownIds.length} 条（${ownIds.join(",")}）`)
      : bad(`${file} 漏列自有补丁：${missingIds.map((i) => "#" + i).join(",")}`);

    /* 仓库里不存在的 .md 引用一律算错：README 是给外人看的，指向一个
       只在本机存在的文件等于给了一个 404。docs/ 已被 .gitignore 排除，
       所以引用 docs/ 里的文件名同样算错（读者看不到）。
       例外：随发行物分发的新增文件（overlay/files/**），它们在包里有、在仓库根没有。 */
    const shipped = new Set();
    const walk = (dir) => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) walk(p);
        else shipped.add(d.name);
      }
    };
    walk(path.join(ROOT, "overlay", "files"));
    const refs = [...new Set([...text.matchAll(/([A-Z][A-Z0-9-]{1,30}\.md)/g)].map((m) => m[1]))];
    const dead = refs.filter((f) => f !== file && !fs.existsSync(path.join(ROOT, f)) && !shipped.has(f));
    dead.length === 0
      ? ok(`${file} 引用的文档全部可达（${refs.length} 个）`)
      : bad(`${file} 引用了不存在的文件：${dead.join("、")}`);
  }

  /* 验收表：49 组不可能全塞进 README，但必须**说明是节选** ——
     否则读者会以为表里 8 行就是全部，红了一项还找不到是哪一项。 */
  for (const [file, needle] of [["README.md", "节选"], ["README.en.md", "excerpt"]]) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    text.includes(needle) ? ok(`${file} 验收表标注为节选`) : bad(`${file} 验收表没标注节选（读者会以为只有表里几条）`);
  }

  /* 表里点名的组号必须真的存在。R18 之前 README 写「全部 35 组」而实际 48 组，
     没有一条断言管这件事 —— 读者照着表里的编号找，找到的是另一版产物。
     这里把 README 的验收表与 verify.mjs 的组号集合对齐（双向：表里的必须存在，
     且表必须是节选而不是复制一遍）。 */
  const verifySrc = fs.readFileSync(path.join(ROOT, "scripts", "verify.mjs"), "utf8");
  const groupIds = new Set([...verifySrc.matchAll(/console\.log\("(?:\\n)?\[(\d+)\]/g)].map((mm) => Number(mm[1])));
  for (const [file, head] of [["README.md", "## 验收"], ["README.en.md", "## Verification"]]) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const at = text.indexOf(head);
    if (at < 0) { bad(`${file} 找不到验收章节（${head}）`); continue; }
    const rest = text.slice(at + head.length);
    const next = rest.search(/\n## /);
    const sec = next >= 0 ? rest.slice(0, next) : rest;
    const rows = [...sec.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((mm) => Number(mm[1]));
    const ghost = rows.filter((n) => !groupIds.has(n));
    rows.length > 0
      ? (ghost.length === 0
        ? ok(`${file} 验收表 ${rows.length} 行组号都真实存在`)
        : bad(`${file} 验收表点了不存在的组：${ghost.join(",")}`))
      : bad(`${file} 验收表一行都没解析出来`);
    rows.length < groupIds.size
      ? ok(`${file} 验收表是节选（${rows.length} < ${groupIds.size}）`)
      : bad(`${file} 验收表列了 ${rows.length} 行，已不是节选（总共 ${groupIds.size} 组）`);
  }
}

// [33] 回归测试汇总（验收不该只跑 verify 自己）
// 结构性问题：31 组验收没有一组会跑那 19 个 test-*.mjs。于是「verify 全绿」
// 和「行为没坏」是两件事 —— 有人把 dispatch 改坏，只要不碰验收断言就照样绿。
// 全量跑完只要 3 秒，没有理由不跑。
console.log("[33] 回归测试汇总（scripts/test-*.mjs）");  // 结构
{
  const files = fs.readdirSync(path.join(ROOT, "scripts")).filter((n) => /^test-.*\.mjs$/.test(n)).sort();
  const reds = [];
  let totalPass = 0;
  for (const name of files) {
    let out = "";
    let code = 0;
    try {
      out = execFileSync(process.execPath, [path.join(ROOT, "scripts", name)], {
        cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000,
      });
    } catch (e) {
      code = e.status ?? 1;
      out = `${e.stdout || ""}${e.stderr || ""}`;
    }
    const m = out.match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
    if (code !== 0) {
      const lastFail = out.split("\n").filter((l) => l.includes("✗")).slice(-2).join(" ");
      reds.push(`${name}（exit ${code}）${lastFail ? " " + lastFail.trim() : ""}`);
    } else if (!m) {
      /* exit 0 但没打印汇总行 = 一条断言都没跑。
         以前这种脚本会被算成全绿（totalPass 只是不增长），
         等于「把测试删空」也能过验收（审计 B-4）。 */
      reds.push(`${name}（exit 0 但没打印「N 通过 / M 失败」—— 没有断言不算通过）`);
    } else {
      if (Number(m[1]) === 0) reds.push(`${name}（0 条断言 —— 空跑不算通过）`);
      else totalPass += Number(m[1]);
    }
  }
  reds.length === 0
    ? ok(`${files.length} 个测试脚本全绿（${totalPass} 条断言）`)
    : bad(`测试脚本失败 ${reds.length} 个：${reds.join(" · ")}`);
}

// [34] 运行时门槛（engines 与代码里的内置模块 import 对齐）
// 上游的 engines 是 `>=18`，但 redteam 层在模块顶层静态 import `node:sqlite`
// （Node 22.5 才有的内置模块）。声明与代码不一致的后果不是「少个功能」：
// 在 Node 18/20 上 `import` 阶段就 ERR_UNKNOWN_BUILTIN_MODULE，插件直接加载失败，
// 而包管理器已经放行了。这里把两者绑在一起 —— 代码用哪个内置模块，声明就得跟到哪。
console.log("[34] 运行时门槛（engines vs 实际 import）");  // 结构
{
  const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"));
  const declared = String((pkgJson.engines && pkgJson.engines.node) || "");
  const m = declared.match(/(\d+)\.(\d+)/);
  const declaredNum = m ? Number(`${m[1]}.${m[2]}`) : 0;

  const hits = [];
  const walk = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { if (d.name !== "node_modules") walk(p); continue; }
      if (!/\.(js|mjs|cjs)$/.test(d.name)) continue;
      const src = fs.readFileSync(p, "utf8");
      for (const mm of src.matchAll(/(?:from\s*|require\()\s*['"]node:(sqlite|test|sea)['"]/g)) {
        hits.push({ file: path.relative(PKG, p), mod: mm[1] });
      }
    }
  };
  walk(path.join(PKG, "lib"));
  const mods = [...new Set(hits.map((h) => h.mod))];
  const NEED = { sqlite: 22.5 };
  const need = Math.max(0, ...mods.map((x) => NEED[x] || 0));

  if (mods.length === 0) {
    ok("代码未使用需要更高版本的内置模块");
  } else {
    ok(`代码使用内置模块 ${mods.map((x) => "node:" + x).join("、")}（${hits.length} 处），要求 Node ≥ ${need}`);
    declaredNum >= need
      ? ok(`engines.node = ${declared}（满足 ≥ ${need}）`)
      : bad(`engines.node = ${declared} 低于代码要求 ${need} —— 在旧 Node 上装下去会在 import 阶段直接崩`);
  }

  for (const file of ["README.md", "README.en.md"]) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    text.includes(`Node ≥ ${need}`)
      ? ok(`${file} 标注 Node ≥ ${need}`)
      : bad(`${file} 没标注真实运行时门槛（应含「Node ≥ ${need}」）`);
  }
}

console.log("[35] 模块可达性（移植过来但没人 import = 等于没移植）");  // 结构
{
  /* 背景：safe 的 13 个模块是「原样移植」，移植完成不等于功能生效 ——
     只要没有调用方 import，它在包里就是一段死代码，面板上却会显示「已支持」。
     docs/audit/AUDIT-3WAY-2026-11-25.md §4 就是这么抓出 5 个的。
     这里的判据：lib 下每个 js/mjs 必须能从入口走到；走不到的必须登记在
     DEAD_MODULE_ALLOWLIST 里并写明原因 —— 新出现的死模块直接红。 */

  const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"));
  const entries = new Set();
  const addPath = (p) => { if (typeof p === "string" && p.startsWith("./")) entries.add(path.normalize(p)); };
  const scanObj = (o) => {
    if (!o) return;
    if (typeof o === "string") { addPath(o); return; }
    if (Array.isArray(o)) { o.forEach(scanObj); return; }
    if (typeof o === "object") for (const v of Object.values(o)) scanObj(v);
  };
  scanObj(pkgJson.main); scanObj(pkgJson.exports); scanObj(pkgJson.dsh); scanObj(pkgJson.bin);

  const all = [];
  const walkLib = (rel) => {
    for (const d of fs.readdirSync(path.join(PKG, rel), { withFileTypes: true })) {
      if (d.name === "node_modules") continue;
      const r = path.join(rel, d.name);
      if (d.isDirectory()) walkLib(r);
      else if (/\.(js|mjs)$/.test(d.name)) all.push(r);
    }
  };
  walkLib("lib");

  const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
  const resolveSpec = (from, spec) => {
    if (!spec.startsWith(".")) return null;
    const base = path.normalize(path.join(path.dirname(from), spec));
    for (const cand of [base, base + ".js", base + ".mjs", path.join(base, "index.js")]) {
      const fp = path.join(PKG, cand);
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return cand;
    }
    return null;
  };

  const seen = new Set();
  const queue = [...entries].map((e) => path.normalize(e));
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f) || !fs.existsSync(path.join(PKG, f))) continue;
    seen.add(f);
    const src = fs.readFileSync(path.join(PKG, f), "utf8");
    let m;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(src))) {
      const r = resolveSpec(f, m[1]);
      if (r && !seen.has(r)) queue.push(r);
    }
  }

  /* 不是「没人 import」而是「入口不是 import」的白名单：浏览器 bundle、子进程 sidecar、CLI。 */
  const NON_IMPORT_ENTRIES = {
    "lib/redteam/client.js": "浏览器 bundle，由宿主按包名加载，不经 Node import",
    "lib/child-process-hide.mjs": "子进程 sidecar（--require 预载）",
    "lib/official-installer.mjs": "子进程 sidecar（官方安装器）",
    "lib/reapply-cli.js": "CLI 入口（bin 脚本 spawn）",
    "lib/restart-desktop.js": "重启器，由 restart 脚本以子进程拉起",
    "lib/restart-web.js": "重启器，同上",
    "lib/uninstall-restart.js": "卸载重启器，同上",
  };
  /* 已知债务：移植了但还没接线。允许存在，但每次验收都会点名，
     新增死模块不会被这个白名单兜住 —— 必须写清原因才能进来。
     2026-11-25 第二轮审计后已清空：orchestrator-clock / team-board 接进了
     任务板数据面，intel-sync 判明不是冗余（它同步的是 cve.db 整库，
     不是 KEV/nuclei）并接进了 intelUpdate。见 [36]。 */
  const DEAD_MODULE_ALLOWLIST = {};

  const unreachable = all.filter((f) => !seen.has(f));
  const unexpected = unreachable.filter((f) => !(f in NON_IMPORT_ENTRIES) && !(f in DEAD_MODULE_ALLOWLIST));
  const debt = unreachable.filter((f) => f in DEAD_MODULE_ALLOWLIST);

  ok(`lib 内 ${all.length} 个模块，入口可达 ${all.length - unreachable.length}，非 import 入口 ${unreachable.length - debt.length - unexpected.length}`);
  unexpected.length === 0
    ? ok("没有未登记的死模块")
    : bad(`出现未登记的死模块：${unexpected.join("、")} —— 移植了没人 import 等于没移植`);
  debt.length === 0
    ? ok("没有待接线的已知债务")
    : console.log(`  · 已知债务 ${debt.length} 项（每次验收点名，见 docs/audit/AUDIT-3WAY）：\n` +
        debt.map((f) => `      - ${f}：${DEAD_MODULE_ALLOWLIST[f]}`).join("\n"));
}

// [36] 观察时钟 / 任务板合并 / CVE 底库同步的接线
// 三个模块都是 safe 2.0.2 原样移植。上一轮审计抓出它们「在包里但没人 import」，
// 这一轮接完线，必须在这里钉住「接上的是对的那条路」：
//   · stall 判定靠的是 claimedAt + staleMs 两个入参，少一个那条分支就永远走不到；
//   · cve 同步必须挂在 intelUpdate 上，且 intelStatus 只读状态文件（不联网）。
console.log("[36] 观察时钟 / 任务板合并 / CVE 底库同步");  // 回归 test-board-clock.mjs
{
  const uiSrc = fs.readFileSync(path.join(PKG, "lib/redteam/ui.js"), "utf8");
  const coreSrc = fs.readFileSync(path.join(PKG, "lib/redteam/store-core.js"), "utf8");

  const wiring = [
    [uiSrc.includes("await import('./orchestrator-clock.js')"), "任务板数据面 import 观察时钟"],
    [uiSrc.includes("await import('./team-board.js')"), "任务板数据面 import 合并模块"],
    [uiSrc.includes("clockMod.sweepStalled(boardTasks, clockCfg, now)"), "每次读任务板推进时钟"],
    [uiSrc.includes("staleMs: clockCfg.enabled ? clockCfg.minutes * 60000 : 0"), "把 staleMs 传进合并"],
    [uiSrc.includes("claimedAt: clockMod ? (task) => clockMod.claimedAt(task) : undefined"), "把 claimedAt 传进合并"],
    [coreSrc.includes("import { intelSyncStatus, syncIntel } from './intel-sync.js'"), "store-core import 底库同步"],
    [coreSrc.includes("cve_sync: intelSyncStatus(this.root)"), "intelStatus 报 cve_sync（只读状态文件）"],
    [coreSrc.includes("['kev', 'nuclei', 'cve']"), "intelUpdate 的 all 包含 cve"],
    [coreSrc.includes("await this.#updateCveDb(options)"), "intelUpdate 分发到 #updateCveDb"],
  ];
  const missingWiring = wiring.filter(([okFlag]) => !okFlag).map(([, why]) => why);
  missingWiring.length === 0
    ? ok(`接线点 ${wiring.length}/${wiring.length} 就位（时钟 / 合并 / 底库同步）`)
    : bad(`接线缺失：${missingWiring.join("、")}`);

  /* intelStatus 的定位是「只读探针，永不联网」。cve_sync 只能是本地状态读取：
     一旦有人在里面加了 fetch/网络调用，「看一眼状态」就变成了出口动作。 */
  /* 按大括号配平取方法体（见文件末尾 bodyOf）：不能靠「到下一个方法名」切片 ——
     P21 的 intel-net 块正好插在 intelStatus 与 intelRefresh 之间，
     那样切出来的范围会把真实的下载代码算进来，误报成「探针联网」。 */
  const statusBlock = bodyOf(coreSrc, "intelStatus() {");
  const netInProbe = /\bfetch\(|https?\.(?:get|request)\(|syncIntel\(|fetchIntelManifest\(/.test(statusBlock);
  netInProbe
    ? bad("intelStatus 里出现了网络调用 —— 只读探针不该有出口动作")
    : ok("intelStatus 仍然只读（没有 fetch / syncIntel / http 请求）");

  /* 两个测试脚本必须在，且必须在 [33] 的 glob 里被跑到。 */
  const t1 = path.join(ROOT, "scripts", "test-board-clock.mjs");
  const t2 = path.join(ROOT, "scripts", "test-intel-cve-sync.mjs");
  [t1, t2].every((f) => fs.existsSync(f))
    ? ok("两项接线各有独立回归脚本（test-board-clock / test-intel-cve-sync）")
    : bad(`接线测试脚本缺失：${[t1, t2].filter((f) => !fs.existsSync(f)).map((f) => path.basename(f)).join("、")}`);
}

// [37] 代理池子系统（12 个 op）
// safe 2.0.2 的代理池只有前端：12 个 op 在它的服务端 dispatch 里一条都不存在，
// 调用只会得到 unknown op。本包是从零实现的，所以这里要把我们自己的契约钉死：
//   · 12 个 op 都要有分发（只写方法不接 op = 功能不存在）；
//   · 解析模块必须是纯函数（不碰 net/fs），否则单测跑不动、也没法在浏览器侧复用；
//   · 对外形状不许带 secret —— 口令只留在本机 pool.json；
//   · 12 个 op 都要登记在 op-ledger（[28] 的 C 项会逐个核对，这里点名一次）。
console.log("[37] 代理池子系统（12 个 op）");  // 回归 test-proxy-pool.mjs
{
  const coreSrc = fs.readFileSync(path.join(PKG, "lib/redteam/store-core.js"), "utf8");
  const toolSrc = fs.readFileSync(path.join(PKG, "lib/redteam/tools.js"), "utf8");
  const PROXY_OPS = [
    "proxyPoolGet", "proxyPoolSave", "proxyProfileSave", "proxyProfileDelete", "proxyProfilesDelete",
    "proxyPoolImport", "proxyConfigImport", "proxyProfileTest", "proxyPoolTest",
    "proxyProfileConnect", "proxyPoolConnect", "proxyPoolDisconnect",
  ];
  const noBranch = PROXY_OPS.filter((op) => !new RegExp(`req\\.op === '${op}'|op === '${op}'`).test(coreSrc));
  noBranch.length === 0
    ? ok(`12 个代理 op 全部有分发`)
    : bad(`代理 op 缺分发：${noBranch.join("、")}`);

  const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, "overlay", "op-ledger.json"), "utf8"));
  const noLedger = PROXY_OPS.filter((op) => !ledger.ops || !ledger.ops[op]);
  noLedger.length === 0
    ? ok("12 个代理 op 全部登记在 op-ledger")
    : bad(`代理 op 未登记：${noLedger.join("、")}`);

  /* 解析模块必须是纯函数：一旦 import 了 net/fs，单测就得起真网络，
     而这块最容易出错的恰恰是字符串解析。 */
  const parsePath = path.join(PKG, "lib/redteam/proxy-parse.js");
  if (!fs.existsSync(parsePath)) {
    bad("缺少 lib/redteam/proxy-parse.js（代理配置解析）");
  } else {
    const parseSrc = fs.readFileSync(parsePath, "utf8");
    const impure = /from\s+'node:(net|fs|http|https|child_process|dns)'/.test(parseSrc);
    impure ? bad("proxy-parse.js 引入了 IO 模块，应当是纯函数") : ok("proxy-parse.js 是纯函数（无 net/fs/http import）");
    const exportsParse = /export function parseProxyConfig\s*\(/.test(parseSrc);
    exportsParse ? ok("导出 parseProxyConfig") : bad("proxy-parse.js 没导出 parseProxyConfig");
  }

  /* 对外形状不许带口令。判据是 #proxyPublic 的函数体里不能出现 `secret:` 这个键。 */
  const publicBody = bodyOf(coreSrc, "#proxyPublic(profile) {");
  publicBody === ""
    ? bad("找不到 #proxyPublic（对外节点形状）")
    : (/\bsecret\s*:/.test(publicBody)
      ? bad("#proxyPublic 里出现了 secret 字段 —— 口令不该回传给调用方")
      : ok("#proxyPublic 不含 secret（只给 passwordSet）"));

  /* connect 的纪律：探测失败必须先 throw，不能先写 activeId。 */
  const connectBody = bodyOf(coreSrc, "async proxyProfileConnect(id, options = {}) {");
  const throwAt = connectBody.indexOf("没有切换生效节点");
  const setAt = connectBody.indexOf("state.activeId = key");
  (throwAt > 0 && setAt > throwAt)
    ? ok("connect 先探测、失败即抛，之后才写 activeId（顺序正确）")
    : bad("connect 的「失败不切换」顺序不对：先写了 activeId 或缺少失败分支");

  toolSrc.includes("name: 'redteam_proxy_pool'")
    ? ok("redteam_proxy_pool 已注册")
    : bad("redteam_proxy_pool 未注册");

  const testFile = path.join(ROOT, "scripts", "test-proxy-pool.mjs");
  fs.existsSync(testFile) ? ok("代理池有独立回归脚本（test-proxy-pool.mjs）") : bad("缺少 test-proxy-pool.mjs");
}

// [38] 沙箱跟随 + 区域出网闸
// 两项都来自 safe 2.0.2，但**都不是原样无条件装**，所以这里钉的是「边界」而不是「有没有」：
//   · sandbox-follow 只搬 P3/P4。P1/P2 在本包被源码补丁 #9 覆盖（decide() 直接返回
//     allowed-once，waterfall 不会被调用），装上去就是一段永远不执行的代码；
//   · net-scope 的闸默认关闭，且**不能**覆盖基座的 lib/net-scope.js ——
//     基座 identity.js / index.js 依赖它的 ownServerNote 与读写函数。
console.log("[38] 沙箱跟随 / 区域出网闸");  // 回归 test-sandbox-net.mjs
{
  const followPath = path.join(PKG, "lib/sandbox-follow.js");
  const gatePath = path.join(PKG, "lib/net-scope-gate.js");
  const basePath = path.join(PKG, "lib/net-scope.js");
  const capPath = path.join(PKG, "lib/plus-capabilities.js");

  if (!fs.existsSync(followPath)) {
    bad("缺少 lib/sandbox-follow.js（沙箱模式跟随）");
  } else {
    const src = fs.readFileSync(followPath, "utf8");
    (/export function installSandboxFollow\s*\(/.test(src) ? ok : bad)("sandbox-follow 导出 installSandboxFollow");
    (/WIDE_SANDBOX_MODE = "danger-full-access"/.test(src) ? ok : bad)("宽档常量是 danger-full-access");
    /* 关键：不许挂 approval/* —— 补丁 #9 已经让 decide() 直接返回，那层永远不执行。 */
    (/ctx\.on\(\s*["']approval\//.test(src)
      ? bad("sandbox-follow 注册了 approval/* 监听 —— 与补丁 #9 重复，且永远不会执行")
      : ok("sandbox-follow 不碰 approval/*（由补丁 #9 负责）"));
  }

  if (!fs.existsSync(gatePath)) {
    bad("缺少 lib/net-scope-gate.js（区域出网闸）");
  } else {
    const src = fs.readFileSync(gatePath, "utf8");
    (/export function installRegionGate\s*\(/.test(src) ? ok : bad)("net-scope-gate 导出 installRegionGate");
    (/export (?:async )?function taskTargetHit\s*\(/.test(src) ? ok : bad)("导出 taskTargetHit（数据层可用）");
  }

  /* 基座文件必须原样：被覆盖会让 identity.js 的 ownServerNote import 直接失败。 */
  if (!fs.existsSync(basePath)) {
    bad("基座 lib/net-scope.js 不见了");
  } else {
    const base = fs.readFileSync(basePath, "utf8");
    (/export function ownServerNote\s*\(/.test(base) ? ok : bad)("基座 net-scope.js 仍导出 ownServerNote（identity.js 依赖）");
    (/export function installRegionGate\s*\(/.test(base)
      ? bad("闸被混进了基座 net-scope.js —— 会覆盖掉 ownServerNote")
      : ok("闸没有混进基座文件"));
  }

  if (!fs.existsSync(capPath)) {
    bad("缺少 lib/plus-capabilities.js");
  } else {
    const cap = fs.readFileSync(capPath, "utf8");
    (cap.includes("installSandboxFollow") ? ok : bad)("能力层装了 sandbox-follow");
    /* 默认关闭的判据：安装调用必须包在 wantGate 条件里，而不是无条件调用。 */
    const gated = /const wantGate = [\s\S]{0,200}if \(wantGate\) \{[\s\S]{0,200}installRegionGate\(ctx\)/.test(cap);
    gated ? ok("区域闸默认关闭（只有 wantGate 为真才 installRegionGate）")
      : bad("区域闸看起来被无条件安装 —— 上游是无条件装的，本包必须默认关闭");
  }

  const testFile = path.join(ROOT, "scripts", "test-sandbox-net.mjs");
  fs.existsSync(testFile) ? ok("两项各有独立回归脚本（test-sandbox-net.mjs）") : bad("缺少 test-sandbox-net.mjs");
}

// [39] 预设自愈（宿主升级后红队预设不能半失效）
// 这一块的失败形态最隐蔽：预设「还在」，但里面某一行已经不被新宿主接受，
// 结果是整个模式下拉被抽空或 registered-broken —— 界面上只表现为「没有红队模式」。
// 原先 apply 在预设已存在时直接 kept，自愈代码存在但永远走不到，所以这里查三件事：
//   ① 捷径没了（apply 无条件调 installPreset 且传 ctx）；
//   ② 六段修复都在（缺一段就等于那一类失效不会自愈）；
//   ③ 修的是**本包**的包名，不是 community 的。
console.log("[39] 预设自愈");  // 回归 test-preset-repair.mjs
{
  const idxPath = path.join(PKG, "lib/redteam/index.js");
  if (!fs.existsSync(idxPath)) {
    bad("缺少 lib/redteam/index.js");
  } else {
    const src = fs.readFileSync(idxPath, "utf8");

    (!/const exists = existsSync\(join\(dir, 'agent\.cordis\.yml'\)\)/.test(src)
      ? ok : bad)("apply 里没有「预设已存在就 kept」的捷径");
    (/result = installPreset\(\{ force: process\.env\.REDTEAM_PRESET_REFRESH === '1', ctx,/.test(src)
      ? ok : bad)("apply 无条件调用 installPreset 并传 ctx（组合修复要读 ptcRuntime）");

    const segments = [
      ["stripDeprecatedToolFilter", "剥离 0.2.1 废弃的 toolFilter"],
      ["disableSubagentModelSelection", "子代理锁成父模型"],
      ["repairComposition", "按宿主实际安装的包开关 workflow 行"],
      ["insertScheduleRow", "补 tool-schedule 行"],
      ["insertTeamBoardGuidance", "补共享任务板纪律"],
      ["fixStaleWaitGuidance", "修正 wait_agent 等待说明"],
      ["disableUnavailableListAgents", "宿主没有 list-agents 子路径时关掉那行"],
    ];
    const missing = segments.filter(([fn]) => !new RegExp(`function ${fn}\\s*\\(`).test(src));
    missing.length === 0
      ? ok(`六段修复 + list-agents 判定全部就位（${segments.length} 个）`)
      : bad(`预设自愈缺函数：${missing.map(([fn]) => fn).join("、")}`);

    /* 两版 toolFilter 剥离不能并存：基座那版会留下 allow:，且让 safe 那版永远看不到键。 */
    (/function repairToolFilter\(text\) \{\s*return stripDeprecatedToolFilter\(text\)/.test(src)
      ? ok : bad)("repairToolFilter 统一委托给 stripDeprecatedToolFilter（不再有两套跳过规则）");

    /* 工具包名必须是本包坐标：写 community 的话老用户升级后 tools 行解析不到。 */
    const legacyToolsName = /'dsh-purge-community\/redteam\/tools'/.test(src);
    legacyToolsName ? bad("工具包名还映射到 dsh-purge-community/redteam/tools（本包里解析不到）")
      : ok("工具包名映射到本包坐标（没有 community 残留）");

    const testFile = path.join(ROOT, "scripts", "test-preset-repair.mjs");
    fs.existsSync(testFile) ? ok("有独立回归脚本（test-preset-repair.mjs）") : bad("缺少 test-preset-repair.mjs");
  }
}

// [40] 数据目录铺底（bootstrap-runtime）
// 这块的风险与别处相反：不是「没接线」，而是「接得太狠」——
// 上游在 apply 里 download:true + background，启动就可能在后台拉 100MB+ 模板并刷 KEV。
// 本包只接本地那半（知识库 DDL / pocs / toolkit / 平台配置），下载必须显式触发。
// 所以这里既查「在不在」，也查「启动路径里不许有 download:true」。
console.log("[40] 数据目录铺底");  // 回归 test-runtime-ensure.mjs
{
  const brPath = path.join(PKG, "lib/redteam/bootstrap-runtime.js");
  if (!fs.existsSync(brPath)) {
    bad("缺少 lib/redteam/bootstrap-runtime.js");
  } else {
    const src = fs.readFileSync(brPath, "utf8");
    (/export async function ensureRedteamRuntime\s*\(/.test(src) ? ok : bad)("导出 ensureRedteamRuntime");
    (/export function templatesStatus\s*\(/.test(src) ? ok : bad)("导出 templatesStatus");
    /* 三种下载协议都在：只剩一种时，镜像挂了就没退路。 */
    const protos = ["GIT_URLS", "TAR_URLS", "ZIP_URLS"].filter((n) => new RegExp(`const ${n} = \\[`).test(src));
    const protosOk = protos.length === 3;
    protosOk ? ok("模板下载保留了 git / tar / zip 三种协议（含镜像回退）")
      : bad(`模板下载协议缺：${["GIT_URLS", "TAR_URLS", "ZIP_URLS"].filter((n) => !protos.includes(n)).join("、")}`);
  }

  const coreSrc = fs.readFileSync(path.join(PKG, "lib/redteam/store-core.js"), "utf8");
  (/req\.op === 'runtimeEnsure'/.test(coreSrc) ? ok : bad)("dispatchAsync 有 runtimeEnsure 分支");
  const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, "overlay", "op-ledger.json"), "utf8"));
  (ledger.ops && ledger.ops.runtimeEnsure ? ok : bad)("runtimeEnsure 已登记在 op-ledger");

  const cap = fs.readFileSync(path.join(PKG, "lib/plus-capabilities.js"), "utf8");
  (/ensureRedteamRuntime\(\{ download: false \}\)/.test(cap)
    ? ok : bad)("启动时只做本地那半（download:false）");
  (/ensureRedteamRuntime\(\{ download: true/.test(cap)
    ? bad("启动路径里出现了 download:true —— 启动不该有不可见的出口动作")
    : ok("启动路径里没有 download:true"));

  const toolSrc = fs.readFileSync(path.join(PKG, "lib/redteam/tools.js"), "utf8");
  (/action === 'runtime'/.test(toolSrc) ? ok : bad)("redteam_intel 支持 action=runtime");

  const testFile = path.join(ROOT, "scripts", "test-runtime-ensure.mjs");
  fs.existsSync(testFile) ? ok("有独立回归脚本（test-runtime-ensure.mjs）") : bad("缺少 test-runtime-ensure.mjs");
}

// [41] 尾部锚点 + mnemon 开关
// 两项都在注入层，错了不会报错只会让行为悄悄变：
//   · 锚点注册两份 → 尾部出现两段互不相同的规则块（基座已经占了 order 10150）；
//   · 子会话锚点位置错了 → 排在宿主 delegation 之前，对消不掉那句「会被自动拒绝」；
//   · mnemon 开关没人读 → 用户打开开关发现记忆段还是被摘掉。
console.log("[41] 尾部锚点 / mnemon 开关");  // 回归 test-anchor-mnemon.mjs
{
  const anchorPath = path.join(PKG, "lib/anchor.js");
  if (!fs.existsSync(anchorPath)) {
    bad("缺少 lib/anchor.js（尾部锚点）");
  } else {
    const src = fs.readFileSync(anchorPath, "utf8");
    (/export function registerAnchor\s*\(/.test(src) ? ok : bad)("导出 registerAnchor");
    (/export function anchorTextFor\s*\(/.test(src) ? ok : bad)("导出 anchorTextFor");
    const nameOk = /dsh-purge-plus:anchor/.test(src) && /dsh-purge-plus:child-anchor/.test(src);
    nameOk ? ok("锚点名带本包前缀（不会和上游撞名）") : bad("锚点名没有本包前缀");
    const noLegacy = !/dsh-purge-safe:/.test(src);
    noLegacy ? ok("没有上游前缀残留") : bad("锚点名里还有 dsh-purge-safe 前缀");
    /* 子会话 context 必须排在宿主 delegation(120) 之后、且 required。 */
    const childOrder = Number((src.match(/export const CHILD_ORDER = (\d+)/) || [])[1]);
    childOrder > 120 ? ok(`子锚点 order=${childOrder}（排在宿主 delegation 120 之后）`) : bad(`子锚点 order=${childOrder}，太靠前`);
    (/required: true/.test(src) ? ok : bad)("子锚点标了 required（rc5 的 refreshContext 才不会 suppress 掉它）");
    /* 默认只装子会话那条：section 注册必须受 anchorMode 控制。 */
    (/anchorMode !== "child"/.test(src) ? ok : bad)("section 注册受 anchorMode 控制（默认只装子会话那条）");
  }

  const mnemonPath = path.join(PKG, "lib/mnemon-settings.js");
  if (!fs.existsSync(mnemonPath)) {
    bad("缺少 lib/mnemon-settings.js（mnemon 开关）");
  } else {
    const src = fs.readFileSync(mnemonPath, "utf8");
    (/path\.join\(dshHome, "dsh-purge-plus", SETTINGS_FILE\)/.test(src)
      ? ok : bad)("设置落 $DSH_HOME/dsh-purge-plus/mnemon.json（不是上游目录）");
    (/export function loadMnemonSettings\s*\(/.test(src) && /export function saveMnemonSettings\s*\(/.test(src)
      ? ok : bad)("读写两个入口都在");
  }

  const idSrc = fs.readFileSync(path.join(PKG, "lib/identity.js"), "utf8");
  (/import \{ loadMnemonSettings \} from "\.\/mnemon-settings\.js"/.test(idSrc)
    ? ok : bad)("identity 真的读这个开关");
  const uses = (idSrc.match(/mnemonKeep === true \? false :/g) || []).length;
  uses === 2 ? ok("两处 dropMnemon 都走同一个开关") : bad(`dropMnemon 只有 ${uses} 处走开关（应为 2）`);
  (/export function isChildAgentContext\s*\(/.test(idSrc) ? ok : bad)("identity 导出 isChildAgentContext（锚点要用）");

  const cap = fs.readFileSync(path.join(PKG, "lib/plus-capabilities.js"), "utf8");
  (/registerAnchor\(ctx, \{/.test(cap) ? ok : bad)("能力层注册了锚点");
  (/anchorMode: cfg\.anchorSection === true \? "both" : "child"/.test(cap)
    ? ok : bad)("默认只装子会话那条（anchorSection 才两段都装）");

  const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, "overlay", "op-ledger.json"), "utf8"));
  (ledger.ops && ledger.ops.mnemonSettings ? ok : bad)("mnemonSettings 已登记在 op-ledger");

  const testFile = path.join(ROOT, "scripts", "test-anchor-mnemon.mjs");
  fs.existsSync(testFile) ? ok("有独立回归脚本（test-anchor-mnemon.mjs）") : bad("缺少 test-anchor-mnemon.mjs");
}

// [42] 原件备份 / 自愈（「保险库」的等价实现）
// safe 的 core.js 有一整套 vault（ensureOfficialSnapshot / writeVaultMeta / listVaultEntries），
// 本包基座在 lib/core.js 里已经有等价的一套：backupAll 建 .dshpurge.bak、
// restoreMissingOriginalsFromBak 还原、refreshStaleBaksForUpgrade 跟宿主升级刷新、
// applyPatches 前做 profile 级快照。所以**不移植 vault** —— 两套并存只会互相盖。
// 这条门禁的职责：证明等价机制真的在，并且没有第二套被偷偷加进来。
console.log("[42] 原件备份 / 自愈");  // 回归 test-vault-equivalence.mjs
{
  const coreSrc = fs.readFileSync(path.join(PKG, "lib", "core.js"), "utf8");
  const bakOk = /const BAK_SUFFIX = "\.dshpurge\.bak"/.test(coreSrc);
  bakOk ? ok("备份后缀 .dshpurge.bak") : bad("找不到 .dshpurge.bak 备份后缀");
  const chain = [
    ["export async function backupAll(", "backupAll（建备份）"],
    ["export function restoreMissingOriginalsFromBak(", "restoreMissingOriginalsFromBak（还原）"],
    ["export function refreshStaleBaksForUpgrade(", "refreshStaleBaksForUpgrade（升级后刷新）"],
    ["collapseDuplicateLegacyApplyPath", "重复声明折叠（自愈）"],
  ];
  const missing = chain.filter(([needle]) => !coreSrc.includes(needle));
  missing.length === 0
    ? ok(`等价机制 ${chain.length}/${chain.length} 就位`)
    : bad(`等价机制缺：${missing.map(([, why]) => why).join("、")}`);

  /* 备份失败必须中止写入：没有备份就改宿主是不可接受的。 */
  (/Host backup failed[\s\S]{0,80}patch writes cancelled/.test(coreSrc)
    ? ok : bad)("备份失败时中止写入");
  /* 还原必须拒绝空备份/符号链接，否则「还原」会把原文件写成空。 */
  const restoreSrc = fs.readFileSync(path.join(PKG, "lib", "restore-backup.js"), "utf8");
  (/Invalid backup \(empty or non-regular\)/.test(restoreSrc) ? ok : bad)("空备份被拒绝");
  (/Refusing to restore through symbolic link/.test(restoreSrc) ? ok : bad)("符号链接目标被拒绝");

  /* 反向：不许出现第二套 vault。 */
  const SAFE_VAULT = ["ensureOfficialSnapshot", "writeVaultMeta", "listVaultEntries"];
  const hits = SAFE_VAULT.filter((sym) => new RegExp(`function ${sym}\\b`).test(coreSrc));
  hits.length === 0 ? ok("没有第二套 vault 并存") : bad(`core.js 里出现了 safe 的 vault 实现：${hits.join("、")}`);

  const testFile = path.join(ROOT, "scripts", "test-vault-equivalence.mjs");
  fs.existsSync(testFile) ? ok("有独立回归脚本（test-vault-equivalence.mjs）") : bad("缺少 test-vault-equivalence.mjs");
}

// [43] 皮肤层（safe 的 token 链）
// 16 个 CSS 里只移植了 3 个：ui-theme → workspace-skin → unified-components 是一条
// 完整的 token 链（--ui-* → --rt-* → 组件），而且作用域就是 .rt-dock / .rt-full，
// 正是本包演练台窗口的根类。其余 13 个页面皮肤逐类比对后命中率只有 6%–30%，搬过来是整片零命中。
// 这条门禁查三件事：注入到位、顺序对、不许有全局泄漏（body/html/* 那种）。
console.log("[43] 皮肤层（token 链）");  // 结构
{
  const skinPath = path.join(ROOT, "overlay", "snippets", "rt-skin.css");
  if (!fs.existsSync(skinPath)) {
    bad("缺少 overlay/snippets/rt-skin.css");
  } else {
    const skin = fs.readFileSync(skinPath, "utf8");
    const depth = (() => { let d = 0; for (const c of skin) { if (c === "{") d += 1; else if (c === "}") d -= 1; } return d; })();
    depth === 0 ? ok("括号平衡") : bad(`括号不平衡（depth=${depth}）`);
    (skin.includes("--ui-canvas:") ? ok : bad)("含 ui-theme 的 --ui-* 调色板");
    (skin.includes("--rt-border:var(--ui-line)") ? ok : bad)("含 workspace-skin 的 --ui-* → --rt-* 映射");
    (skin.includes(":is(.rt-dock, .rt-full)") ? ok : bad)("组件规则挂在 .rt-dock / .rt-full 作用域下");

    /* 顺序：token 定义必须在消费之前，否则组件拿到的是未定义变量。 */
    const uiAt = skin.indexOf("--ui-canvas:");
    const rtAt = skin.indexOf("--rt-border:var(--ui-line)");
    const compAt = skin.indexOf(":is(.rt-dock, .rt-full) :is(.rt-card");
    (uiAt >= 0 && rtAt > uiAt && compAt > rtAt)
      ? ok("顺序正确：--ui-* → --rt-* → 组件规则")
      : bad(`token 链顺序不对（ui=${uiAt} rt=${rtAt} 组件=${compAt}）`);

    /* 全局泄漏：不许出现裸 body / html / * 规则，也不许 @import 外部资源。 */
    const globalRule = /(^|\n)\s*(body|html|\*)\s*[,{]/.test(skin);
    globalRule ? bad("皮肤层里有全局规则（body/html/*）—— 会改到宿主自己的界面") : ok("没有全局规则（不改宿主界面）");
    (/@import|url\(/.test(skin) ? bad : ok)("没有 @import / url()（不拉外部资源）");

    /* 两份产物都要有：面板内嵌版与独立窗口版。 */
    for (const rel of ["lib/redteam/client.js", "client.js"]) {
      const src = fs.readFileSync(path.join(PKG, rel), "utf8");
      src.includes("--ui-canvas:") && src.includes("--rt-border:var(--ui-line)")
        ? ok(`${rel} 已注入皮肤层`)
        : bad(`${rel} 缺皮肤层`);
    }
  }
}

// [44] 主题开关（dusk / white / system）
// 皮肤层装上之后 data-theme 才真的有消费者；这条门禁钉的是**作用范围**：
// 属性只能写在 .rt-dock / .rt-full 上，不许写 <html> / <body> ——
// 插件替用户决定整个宿主的明暗是越界。
console.log("[44] 主题开关");  // 回归 test-theme-toggle.mjs
{
  const snipPath = path.join(ROOT, "overlay", "snippets", "theme-toggle.js");
  if (!fs.existsSync(snipPath)) {
    bad("缺少 overlay/snippets/theme-toggle.js");
  } else {
    const src = fs.readFileSync(snipPath, "utf8");
    (src.includes("'dusk'") && src.includes("'white'") && src.includes("'system'") ? ok : bad)("三档齐全（dusk / white / system）");
    const scopeOk = /CONTAINERS = '\.rt-dock,\.rt-full'/.test(src);
    scopeOk ? ok("只作用于 .rt-dock / .rt-full") : bad("容器选择器不对");
    const leaks = /documentElement\.setAttribute\('data-theme'/.test(src) || /body\.setAttribute\('data-theme'/.test(src);
    leaks ? bad("片段里往 html/body 写了 data-theme —— 会改到宿主自己的界面") : ok("不往 html/body 写 data-theme");
    (src.includes("dsh-purge-plus:ui-theme") ? ok : bad)("存储键带本包前缀");
    /* 容器不在时不许挂按钮：否则面板里会出现一个悬空胶囊。 */
    /* 查**注入后的产物**，不是片段原文：片段在、但没被注入时，
       查原文一样绿（审计 B-11）。 */
    {
      const guard = "if (containers().length === 0) return false;";
      const bundles = ["lib/redteam/client.js", "client.js"].filter((rel) => {
        try { return fs.readFileSync(path.join(PKG, rel), "utf8").includes(guard); } catch { return false; }
      });
      bundles.length === 2
        ? ok("容器不存在时不挂按钮（两份产物里都有这条守卫）")
        : bad(`容器守卫只出现在 ${bundles.length}/2 份产物里：${bundles.join(",") || "都没有"}`);
    }

    for (const rel of ["lib/redteam/client.js", "client.js"]) {
      const bundle = fs.readFileSync(path.join(PKG, rel), "utf8");
      bundle.includes("dshpp-theme-pill") ? ok(`${rel} 已注入主题开关`) : bad(`${rel} 缺主题开关`);
    }
  }
  const testFile = path.join(ROOT, "scripts", "test-theme-toggle.mjs");
  fs.existsSync(testFile) ? ok("有独立回归脚本（test-theme-toggle.mjs）") : bad("缺少 test-theme-toggle.mjs");
}

// [45] 验收脚本随包分发（「能不能对已安装产物复跑」）
// 以前 `plus.dshCompat.evidenceInRepo: false` 是实话：发布包里一个 test-*.mjs 都没有，
// 兼容性声明在产物里没有任何可复现证据（审计 B-5）。
// 这条门禁查四件事：数量对得上、片段 fixture 在、**真的在包内跑得起来**、
// 以及验收/回归点名要用的脚本没有漏在包外（漏了就等于只在仓库能自证）。
console.log("[45] 验收脚本随包分发");  // 结构
{
  const repoTests = fs.readdirSync(path.join(ROOT, "scripts")).filter((n) => /^test-.*\.mjs$/.test(n));
  const pkgTests = fs.readdirSync(path.join(PKG, "scripts")).filter((n) => /^test-.*\.mjs$/.test(n));
  if (ROOT === PKG) {
    /* 包内模式没有仓库可比：只断言「有测试、且不是空壳」。 */
    pkgTests.length > 0 ? ok(`包内 ${pkgTests.length} 个 test-*.mjs（包内模式：无仓库可比）`) : bad("包内一个 test-*.mjs 都没有");
  } else {
    repoTests.length === pkgTests.length
      ? ok(`包内 ${pkgTests.length} 个 test-*.mjs（与仓库一致）`)
      : bad(`包内测试数 ${pkgTests.length} ≠ 仓库 ${repoTests.length}`);
    const missing = repoTests.filter((n) => !pkgTests.includes(n));
    missing.length === 0 ? ok("逐个文件都在") : bad(`缺：${missing.join("、")}`);
  }

  const fixture = path.join(PKG, "scripts", "fixtures", "theme-toggle.js");
  fs.existsSync(fixture) ? ok("片段 fixture 随包（theme-toggle.js）") : bad("缺 scripts/fixtures/theme-toggle.js");

  /* 包内自洽：验收与回归里点名要用的脚本必须真的在包里。
     只带 test-*.mjs 时，包内跑 verify 会在 [28]/[46]/[47] 上红 ——
     「装完能自证」就成了只在仓库成立的说法。 */
  const pkgScriptNames = new Set(fs.readdirSync(path.join(PKG, "scripts")));
  const repoScriptNames = new Set(fs.readdirSync(path.join(ROOT, "scripts")));
  const referenced = new Set();
  const scanFiles = ["verify.mjs", ...pkgTests];
  for (const f of scanFiles) {
    const text = fs.readFileSync(path.join(PKG, "scripts", f), "utf8");
    for (const m of text.matchAll(/["'`]([a-z0-9-]+\.(?:mjs|json))["'`]/g)) referenced.add(m[1]);
  }
  /* build.mjs 只在「dist 不存在，先跑 node scripts/build.mjs」这句报错里被点名：
     它需要整个仓库（overlay/vendor），不可能随包分发，也不该算依赖。 */
  const MENTION_ONLY = new Set(["build.mjs"]);
  const danglingDeps = [...referenced]
    .filter((n) => repoScriptNames.has(n) && !pkgScriptNames.has(n) && !MENTION_ONLY.has(n))
    .sort();
  danglingDeps.length === 0
    ? ok(`包内自洽：验收/回归点名的 ${[...referenced].filter((n) => repoScriptNames.has(n)).length} 个脚本都在包内`)
    : bad(`包内缺依赖：${danglingDeps.join("、")}（装完跑 verify 会在这几组上红）`);

  /* 真的在包内跑一个：这是「能复跑」的唯一硬证据。挑行为最重的那个。 */
  try {
    const out = execFileSync(process.execPath, [path.join("scripts", "test-proxy-pool.mjs")], {
      cwd: PKG, encoding: "utf8", timeout: 120000,
    });
    const m = out.match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
    (m && Number(m[2]) === 0 && Number(m[1]) > 0)
      ? ok(`包内实跑 test-proxy-pool：${m[1]} 条断言全绿`)
      : bad(`包内实跑没有给出有效汇总：${out.slice(-160)}`);
  } catch (e) {
    bad(`包内实跑失败：${(e.stdout || e.message || "").split("\n").slice(-3).join(" ")}`);
  }
}

// [46] 故障注入（审计 B-12：验收只会「查字符串在不在」，从不构造故障）
// 把包整份复制到临时目录 → 故意改坏一处行为 → 指定回归必须变红。
// 改坏之后仍然全绿，说明那条测试守的不是行为，只是字符串。
console.log("[46] 故障注入（改坏一处行为，指定回归必须变红）");  // 结构
{
  try {
    const out = execFileSync(process.execPath, [path.join("scripts", "mutate-check.mjs")], {
      cwd: ROOT, encoding: "utf8", timeout: 600000,
    });
    const m = out.match(/故障注入：(\d+)\/(\d+) 被检出/);
    (m && Number(m[1]) === Number(m[2]) && Number(m[2]) > 0)
      ? ok(`${m[2]} 个变异全部被检出`)
      : bad(`变异未被全部检出：${(m ? m[0] : out.slice(-200))}`);
  } catch (e) {
    // 失败时要把 stderr 也带上：只取 stdout 会把「脚本崩在哪」这件事一起吞掉，
    // 上一版就是这样只看到「前三个变异被检出」而不知道后面发生了什么。
    const tail = (t) => String(t || "").split("\n").filter(Boolean).slice(-6).join(" | ");
    bad(`故障注入门禁失败：${tail(e.stdout) || String(e.message || "")}${e.stderr ? " · stderr: " + tail(e.stderr) : ""}`);
  }
}

// [47] 行为归属（审计 B-3：验收里大量断言只是「这行字符串还在文件里」）
// 每个验收组必须在行尾说明它凭什么算数，两种答案：
//   // 结构                —— 断言的是构建产物本身（计数、命名、文档一致性、能否 import）
//   // 回归 test-x.mjs     —— 断言的是**行为**，由那条回归脚本证明（可逗号列多条）
// 声明的脚本必须在**已打包**的 scripts/ 里 —— [45] 保证包内能跑，两者合起来才是
// 「这条行为有测试，而且测试跟着包走」。两边的下限防止「全标结构」把它变成恒绿。
console.log("[47] 行为归属（每个验收组都要说明凭什么算数）");  // 结构
{
  /* 判定逻辑住在 scripts/check-proof-classes.mjs：它自己有合成用例的回归
     （scripts/test-proof-classes.mjs），比把逻辑内联在这里更可测。 */
  let out = "";
  let code = 0;
  try {
    out = execFileSync(process.execPath, [
      path.join(ROOT, "scripts", "check-proof-classes.mjs"),
      `--file=${path.join(ROOT, "scripts", "verify.mjs")}`,
      `--pkg=${PKG}`,
    ], { cwd: ROOT, encoding: "utf8" });
  } catch (e) {
    out = `${e.stdout || ""}${e.stderr || ""}`;
    code = e.status ?? 1;
  }
  const m = out.match(/行为归属：(\d+) 组 · 结构 (\d+) · 行为 (\d+)/);
  if (code !== 0) {
    bad(`行为归属不通过：${out.split("\n").filter((l) => l.includes("FAIL")).join(" · ") || out.trim().slice(-200)}`);
  } else if (!m) {
    bad("行为归属没有输出计数（脚本可能被改成空壳）");
  } else {
    ok(`${m[1]} 个验收组全部声明了归属`);
    const lim = out.match(/下限 (\d+) \/ (\d+)/);
    ok(`结构 ${m[2]} 组 · 行为 ${m[3]} 组（下限 ${lim ? lim[1] + " / " + lim[2] : "未知"}）`);
    ok(`声明的回归脚本都在包内（包内能跑由 [45] 保证）`);
    console.log(`     结构 ${m[2]} · 行为 ${m[3]}`);
  }
  /* 「不适用」是唯一能让一组不产出判定的口子，所以它必须被计数并设上限。
     上限 2 = 已知的两处（[7] 整组 + [10] 的基座版本比对），都在仓库侧。 */
  /* 上限 7 = 目前全部「只能仓库侧做」的位置，逐个点名（多一个就说明有人在加口子）：
       [7] 在线更新通道 / [10] 基座版本比对 / [22] 构建摘要守卫 /
       [24] 维护文档不进包 / [26] 计数复算 / [28] op 契约 /
       [49] 构建输入受版本控制（已安装的包里没有 .git）。 */
  const SKIP_CAP = 7;
  skipped <= SKIP_CAP
    ? ok(`不适用 ${skipped} 组（上限 ${SKIP_CAP}）`)
    : bad(`不适用 ${skipped} 组，超过上限 ${SKIP_CAP} —— 「不适用」正在被当挡箭牌`);
  if (skipped > 0) console.log(`     本次在${IN_REPO ? "仓库" : "包内"}模式运行，${skipped} 处只能报不适用`);
}

// [48] 变异覆盖（R17：声明了回归脚本 ≠ 那条回归真的会红）
// [47] 保证「每个行为组都有一条回归脚本」，但一条从没被改坏过的回归，和一条
// 不存在的回归，在输出里长得一模一样。这一组要求每个行为组都被至少一条变异
// **显式认领**（mutations.json 里的 "groups": [N]），且认领必须有效：
// 组号是行为组、该组声明的测试里确实包含这条变异的 test。
console.log("[48] 变异覆盖（每个行为组都有会红的判据）");  // 结构
{
  /* 判定逻辑住在 scripts/check-mutation-coverage.mjs。
     配对方式有讲究：--file 用**这次正在跑的** verify.mjs，--manifest 用**随包发布**的
     那份 mutations.json —— 两边都必须是真货，否则可以拿一份改了组号的副本来骗过门禁。 */
  let out = "";
  let code = 0;
  try {
    out = execFileSync(process.execPath, [
      path.join(ROOT, "scripts", "check-mutation-coverage.mjs"),
      `--file=${path.join(ROOT, "scripts", "verify.mjs")}`,
      `--manifest=${path.join(PKG, "scripts", "mutations.json")}`,
    ], { cwd: ROOT, encoding: "utf8" });
  } catch (e) {
    out = `${e.stdout || ""}${e.stderr || ""}`;
    code = e.status ?? 1;
  }
  const m = out.match(/变异覆盖：行为组 (\d+) · 有变异认领 (\d+) · 变异 (\d+) · 孤儿 (\d+)/);
  if (code !== 0) {
    bad(`变异覆盖不通过：${out.split("\n").filter((l) => l.includes("FAIL")).join(" · ") || out.trim().slice(-200)}`);
  } else if (!m) {
    bad("变异覆盖没有输出计数（脚本可能被改成空壳）");
  } else {
    ok(`${m[1]} 个行为组全部有变异认领（${m[2]}/${m[1]}）`);
    ok(`清单里 ${m[3]} 条变异，认领关系全部有效`);
    console.log(`     孤儿变异 ${m[4]} 条（守的是 [33] 汇总里的回归，不对应单个行为组）`);
  }
}

// [49] 构建输入受版本控制（R18）
// R15 修的是「仓库能重建出包」，这一组修的是「克隆能重建出仓库」。
// dist/ 不进 git，产物完全由 overlay/ + scripts/ 决定；只要有一个输入没提交，
// 别人克隆再 build 得到的包与本机这份不是同一个东西，而构建照样成功。
console.log("[49] 构建输入受版本控制");  // 回归 test-tracked.mjs
{
  const isGit = fs.existsSync(path.join(ROOT, ".git"));
  if (!isGit) {
    na("构建输入受版本控制需要 .git（已安装的包里没有版本控制）");
  } else {
    let out = "";
    let code = 0;
    try {
      out = execFileSync(process.execPath, [path.join(ROOT, "scripts", "check-tracked.mjs"), `--repo=${ROOT}`],
        { cwd: ROOT, encoding: "utf8", timeout: 120000 });
    } catch (e) {
      out = `${e.stdout || ""}${e.stderr || ""}`;
      code = e.status ?? 1;
    }
    const m = out.match(/构建输入：(\d+) 个 · 已跟踪 (\d+) · 未跟踪 (\d+)/);
    if (code !== 0) {
      bad(`构建输入不受版本控制：${out.split("\n").filter((l) => l.startsWith("FAIL")).join(" · ") || out.trim().slice(-200)}`);
    } else if (!m) {
      bad("构建输入门禁没有输出计数（脚本可能被改成空壳）");
    } else {
      ok(`构建输入 ${m[1]} 个全部受版本控制（未跟踪 ${m[3]}）`);
      /* 「输入集合」本身也要有个下限：把枚举改成空集同样能全绿。 */
      Number(m[1]) >= 100
        ? ok(`输入集合 ${m[1]} 个（下限 100）`)
        : bad(`输入集合只有 ${m[1]} 个，枚举口径被改坏了`);
    }
  }
}

// [50] R11–R15 审计缺陷回归（13 条修复，此前只有变异守着、没有验收组认领）
// 这 13 条是 R11–R15 逐轮审计里修掉的真实缺陷，各有 1 条变异证明「改回去会红」。
// 但 [48] 一直把它们的变异算成「孤儿」—— 孤儿的意思是：**没有任何验收组认领它**。
// 也就是说这 13 条修复在验收面上不存在，只有变异门禁自己知道它们被守住了。
//
// 这一组把认领补齐，并且是**双向**的：
//   · 表里的每一条，manifest 必须真的认领 [50]（删掉认领就红）；
//   · manifest 里认领 [50] 的每一条，必须在这张表里（偷偷塞一条进来也红）；
//   · 四条脚本现场跑一遍（不是 grep），断言数下限防止被改成空壳。
console.log("[50] R11–R15 审计缺陷回归");  // 回归 test-r11-fixes.mjs, test-r13-fixes.mjs, test-r14-fixes.mjs, test-r15-tools.mjs
{
  /* id / 守它的脚本 / 修的是什么。id 与 scripts/mutations.json 一一对应。 */
  const TABLE = [
    ["M3-preset-wait-dup", "test-r11-fixes.mjs", "预设自愈插出第二段等待文案，旧的那段还在（PL-03）"],
    ["M7-savePrompt-wipe", "test-r11-fixes.mjs", "漏传 content 被当成清空，角色提示词写成 0 字节（R11-1）"],
    ["M8-trojan-base64", "test-r11-fixes.mjs", "trojan 口令被当 base64 解，节点永久连不上（R11-2）"],
    ["M9-coverage-swallow", "test-r11-fixes.mjs", "覆盖度查不出来被报成「查得出来、没缺口」（R11-3）"],
    ["M5-board-bytask", "test-r13-fixes.mjs", "任务板按任务定位退化成按会话，同会话多张卡只剩一条（PA-03/32）"],
    ["M13-rollup-drift", "test-r13-fixes.mjs", "漂移被报成 skipped —— 软成功（CM-01）"],
    ["M14-bak-empty", "test-r13-fixes.mjs", "0 字节 bak 永久占位，备份形同不存在（CM-10）"],
    ["M16-cve-extract", "test-r13-fixes.mjs", "只从文件名取 CVE，正文里写编号的模板搜不到（PA-06）"],
    ["M10-template-offset", "test-r14-fixes.mjs", "面板翻页参数被丢，「下一页」永远是同一页（PA-08）"],
    ["M11-cleared-filter", "test-r14-fixes.mjs", "cleared 按当前页算，把「还有 20 条没删」报成已收尾（PL-04）"],
    ["M12-like-escape", "test-r14-fixes.mjs", "值里的 % / _ 当通配符，搜一个 % 命中全库（PL-07）"],
    ["M15-queue-skip", "test-r14-fixes.mjs", "已放弃的资产重回队列，与提示词「直接跳过」矛盾（PA-16）"],
    ["M6-slot-report-enum", "test-r15-tools.mjs", "report 枚举退回四个值，子智能体报 failed 被参数校验拒掉（PA-30）"],
  ];

  const manifest = JSON.parse(fs.readFileSync(path.join(PKG, "scripts", "mutations.json"), "utf8"));
  const byId = new Map(manifest.map((m) => [m.id, m]));

  const missing = TABLE.filter(([id]) => !byId.has(id)).map(([id]) => id);
  missing.length === 0 ? ok(`清单里 ${TABLE.length} 条变异都在`) : bad(`清单里缺：${missing.join("、")}`);

  const unclaimed = TABLE.filter(([id]) => byId.has(id) && !(byId.get(id).groups || []).includes(50)).map(([id]) => id);
  unclaimed.length === 0
    ? ok(`${TABLE.length} 条变异都认领了 [50]`)
    : bad(`没认领 [50]：${unclaimed.join("、")}`);

  const tableIds = new Set(TABLE.map(([id]) => id));
  const strangers = manifest.filter((m) => (m.groups || []).includes(50) && !tableIds.has(m.id)).map((m) => m.id);
  strangers.length === 0
    ? ok("没有「认领了 [50] 却不在表里」的变异")
    : bad(`认领了 [50] 但表里没有：${strangers.join("、")}`);

  /* 变异与脚本的配对必须与清单一致：表里写 A 脚本，清单里跑 B 脚本，
     等于这条修复其实没人守。 */
  const wrongScript = TABLE.filter(([id, script]) => byId.has(id) && byId.get(id).test !== script).map(([id]) => id);
  wrongScript.length === 0 ? ok("表里记的脚本与清单一致") : bad(`脚本对不上：${wrongScript.join("、")}`);

  /* 现场跑四条脚本：断言数下限防止「脚本被改成空壳但退出 0」。 */
  const scripts = [...new Set(TABLE.map(([, s]) => s))];
  const MIN = { "test-r11-fixes.mjs": 40, "test-r13-fixes.mjs": 25, "test-r14-fixes.mjs": 30, "test-r15-tools.mjs": 12 };
  let total = 0;
  for (const name of scripts) {
    let out = "";
    let code = 0;
    try {
      out = execFileSync(process.execPath, [path.join(ROOT, "scripts", name)], { cwd: ROOT, encoding: "utf8", timeout: 180000 });
    } catch (e) {
      out = `${e.stdout || ""}${e.stderr || ""}`;
      code = e.status ?? 1;
    }
    const m = out.match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
    if (code !== 0 || !m || Number(m[2]) !== 0) {
      bad(`${name} 没跑绿：${(m ? m[0] : out.trim().split("\n").slice(-2).join(" "))}`);
    } else if (Number(m[1]) < (MIN[name] || 1)) {
      bad(`${name} 只有 ${m[1]} 条断言（下限 ${MIN[name]}）—— 可能被改成空壳`);
    } else {
      total += Number(m[1]);
      ok(`${name}：${m[1]} 条断言全绿`);
    }
  }
  console.log(`     四条脚本合计 ${total} 条断言，覆盖 ${TABLE.length} 条审计缺陷`);
}

// 审计 R19 的两条教训：
//   ① 写侧不做类型归一 —— 一个字符串就让报告页永久崩（(scope||[]).join 抛 TypeError），
//      一个对象就被 String() 成 "[object Object]"，授权范围永久丢失且没有 op 能改回来；
//   ② 门禁只测 dispatch 不测工具层 —— cleanup 的 NULL 写入在 dispatch 修好之后又活了一轮。
// 这里把「更新类写 op 查不到必须报错」做成**从 WRITE_OPS 现扫**的动态断言：
// 上游以后新增 updateXxx 忘了守规矩，这一组立刻红，不需要有人记得回来加用例。
console.log("[51] R19 写侧类型归一 / 工具与分发等价");  // 回归 test-r19-fixes.mjs
{
  const coreSrc51 = fs.readFileSync(path.join(PKG, "lib/redteam", "store-core.js"), "utf8");
  const setBody = /const WRITE_OPS = new Set\(\[([\s\S]*?)\]\)/.exec(coreSrc51);
  const writeOps51 = setBody ? [...setBody[1].matchAll(/'([A-Za-z0-9]+)'/g)].map((x) => x[1]) : [];
  const updateOps51 = writeOps51.filter((n) => /^update/.test(n));
  if (updateOps51.length < 3) bad(`WRITE_OPS 里只扫到 ${updateOps51.length} 个更新类 op（应 ≥3）`);
  else ok(`WRITE_OPS 现扫到 ${updateOps51.length} 个更新类 op：${updateOps51.join(" / ")}`);

  const tmpRoot51 = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-r19-"));
  try {
    const { RedteamStore, dispatch } = await import(path.join(PKG, "lib/redteam", "store-core.js"));
    const store51 = new RedteamStore(tmpRoot51);
    const eng51 = store51.openEngagement("r19-gate", undefined, { bindCurrent: false });

    /* ① 更新类 op：查不到的 id 不许回 ok:true（否则调用方以为改成功了） */
    const silent51 = [];
    for (const op of updateOps51) {
      const res = dispatch(store51, { op, engagement: eng51.id, id: 99999 });
      if (res && res.ok === true) silent51.push(`${op} → ${JSON.stringify(res).slice(0, 90)}`);
    }
    silent51.length === 0
      ? ok(`${updateOps51.length} 个更新类 op 对不存在的 id 一律 ok:false（不再假成功）`)
      : bad(`更新类 op 假成功：${silent51.join(" · ")}`);

    /* ② scope 写侧归一：对象要被拒绝（否则永久丢失），字符串要被切开（否则报告崩） */
    const objScope51 = dispatch(store51, { op: "openEngagement", name: "r19-obj", scope: [{ cidr: "10.0.0.0/8" }] });
    objScope51.ok === false && /scope/.test(String(objScope51.error || ""))
      ? ok("openEngagement 传对象 scope → ok:false 且指名 scope（不再存成 [object Object]）")
      : bad(`openEngagement 传对象 scope 得到 ${JSON.stringify(objScope51).slice(0, 120)}`);
    !fs.existsSync(path.join(tmpRoot51, "engagements", "r19-obj"))
      ? ok("被拒绝的 scope 没在磁盘上留下半截靶标目录")
      : bad("非法 scope 仍在磁盘上留下了目录");

    const strScope51 = dispatch(store51, { op: "openEngagement", name: "r19-str", scope: "10.0.0.0/8, 192.168.0.0/16" });
    const strScopeArr = strScope51.engagement && strScope51.engagement.scope;
    Array.isArray(strScopeArr) && strScopeArr.length === 2
      ? ok("openEngagement 传字符串 scope → 归一成数组（报告 .join 不会再崩）")
      : bad(`openEngagement 传字符串 scope 得到 ${JSON.stringify(strScope51).slice(0, 120)}`);

    const rep51 = dispatch(store51, { op: "report", engagement: strScope51.engagement.id });
    /授权范围：10\.0\.0\.0\/8, 192\.168\.0\.0\/16/.test(rep51.markdown || "")
      ? ok("字符串 scope 的靶标能出报告，两个网段都在")
      : bad("字符串 scope 的靶标报告里没有网段");

    /* ③ 两条路径等价：同一次部分更新，store 直调与 dispatch 落库结果必须逐字段相同。
       这正是 cleanup NULL 写入能活两轮的原因 —— 两条路径当时确实不一样。 */
    const a51 = store51.openEngagement("r19-a", undefined, { bindCurrent: false });
    const b51 = store51.openEngagement("r19-b", undefined, { bindCurrent: false });
    const seed51 = { target: "x.example.com", location: "/p", kind: "account", title: "T", detail: "D", priority: "high" };
    const ia51 = store51.addCleanup(a51.id, seed51).cleanup_id;
    const ib51 = store51.addCleanup(b51.id, seed51).cleanup_id;
    const viaStore51 = store51.updateCleanup(a51.id, ia51, { detail: "D2" }).cleanup;
    const viaDispatch51 = dispatch(store51, { op: "updateCleanup", engagement: b51.id, id: ib51, detail: "D2" }).cleanup;
    const pick51 = (r) => JSON.stringify([r && r.target, r && r.location, r && r.kind, r && r.title, r && r.priority, r && r.status, r && r.detail]);
    pick51(viaStore51) === pick51(viaDispatch51)
      ? ok("同一次部分更新：store 直调与 dispatch 落库结果逐字段相同")
      : bad(`两条路径结果不同：${pick51(viaStore51)} vs ${pick51(viaDispatch51)}`);
    viaDispatch51 && viaDispatch51.target === "x.example.com" && viaDispatch51.priority === "high"
      ? ok("部分更新没有把没给的字段抹成 NULL（target/priority 都在）")
      : bad(`部分更新抹掉了字段：${pick51(viaDispatch51)}`);
  } catch (e) {
    bad(`R19 运行时探测抛错：${String((e && e.message) || e)}`);
  } finally {
    try { fs.rmSync(tmpRoot51, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
}

console.log("[52] R20 空载荷 / 空壳 / 类型污染 / 返回形状");  // 回归 test-r20-fixes.mjs
{
  const tmpRoot52 = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-r20-"));
  try {
    const { RedteamStore, dispatch } = await import(path.join(PKG, "lib/redteam", "store-core.js"));
    const s52 = new RedteamStore(tmpRoot52);
    const e52 = s52.openEngagement("r20-gate", undefined, { bindCurrent: false });
    const d52 = (body) => dispatch(s52, Object.assign({ engagement: e52.id }, body));

    /* ① 空载荷一律不许落行：这五条以前都返回 ok:true 并写进一条不可用记录 */
    const empty52 = [
      ["addVuln", {}],
      ["addHttpEvidence", {}],
      ["addChainStep", { stage: "recon" }],
      ["addTunnel", { kind: "socks5" }],
      ["addDataProof", { row_count: 1, fields: { a: 1 } }],
    ];
    const leaked52 = empty52.filter(([op, body]) => {
      const r = d52(Object.assign({ op }, body));
      return !r || r.ok !== false;
    }).map(([op]) => op);
    leaked52.length === 0
      ? ok(`5 类空载荷全部 ok:false（${empty52.map(([o]) => o).join(" / ")}）`)
      : bad(`空载荷仍然假成功：${leaked52.join(" / ")}`);

    /* ② 空壳阶段会永久阻断内置定义补种 */
    s52.db(e52.id).prepare("DELETE FROM stage").run();
    d52({ op: "saveStage", code: "internet" });
    const st52 = s52.listStages(e52.id).find((x) => x.code === "internet");
    Array.isArray(st52 && st52.sections) && st52.sections.length >= 3 && st52.name !== "internet"
      ? ok("只给 code 的 saveStage 不会留下空壳阶段（内置定义完整补种）")
      : bad(`internet 阶段被写成空壳：${JSON.stringify(st52 && { name: st52.name, sections: st52.sections })}`);
    const badSec52 = d52({ op: "saveStage", code: "recon", sections: "x" });
    badSec52.ok === false ? ok("saveStage 的 sections 传字符串被拒（攻击链页面不会崩）") : bad("sections 传字符串仍然入库");

    /* ③ 类型污染：对象/字符串被 String() 成 "[object Object]" 或静默归 0 */
    const promptBefore52 = d52({ op: "prompts" }).roles.find((x) => x.role === "recon").content;
    d52({ op: "savePrompt", role: "recon", content: { a: 1 } });
    const promptAfter52 = d52({ op: "prompts" }).roles.find((x) => x.role === "recon").content;
    promptAfter52 === promptBefore52 && !/\[object Object\]/.test(promptAfter52)
      ? ok("savePrompt 收对象 → 提示词一个字节没动")
      : bad("savePrompt 收对象仍然写坏了提示词");
    const sp52 = d52({ op: "saveScorePoint", name: "门禁点", points: "abc" });
    sp52.ok === false ? ok("saveScorePoint 的 points:\"abc\" 被拒（不再静默归 0）") : bad("points 非数字仍然被接受");

    /* ④ 导入：{bundle:{…}} 不许零入库却 ok:true */
    const imp52 = d52({ op: "import", bundle: {} });
    imp52.ok === false ? ok("空 bundle → ok:false（不再零入库报成功）") : bad("空 bundle 仍然 ok:true");

    /* ⑤ 契约：intelStatus 两个数要自洽；intelRefresh 要说清「没下载」 */
    const intel52 = s52.intelStatus();
    intel52.stale_count === intel52.resources.filter((r) => r.stale === true).length
      ? ok("intelStatus：stale_count 与 resources[].stale 口径一致")
      : bad(`intelStatus 自相矛盾：count=${intel52.stale_count} 字段=${intel52.resources.filter((r) => r.stale).length}`);
    const rf52 = s52.intelRefresh();
    rf52.probe_only === true && rf52.downloaded === false
      ? ok("intelRefresh 标注 probe_only / downloaded:false（不再与 safe 同名反义）")
      : bad("intelRefresh 仍然没说明是否真的下载");

    /* ⑥ 报错指向正确的对象：写错 action 时不该说「需要 asset_id」 */
    const cov52 = d52({ op: "assetCoverage", action: "zzz" });
    /未知 action/.test(String(cov52.error || ""))
      ? ok("assetCoverage 写错 action → 报「未知 action」而不是「需要 asset_id」")
      : bad(`assetCoverage 报错指错对象：${JSON.stringify(cov52).slice(0, 100)}`);

    /* ⑦ add / update 返回同一组键；部分更新不抹字段 */
    const add52 = d52({ op: "addCleanup", kind: "webshell", title: "T", target: "10.0.0.9", location: "/a.jsp" });
    const upd52 = d52({ op: "updateCleanup", id: add52.cleanup_id, status: "done", detail: "已删" });
    add52.cleanup_id > 0 && upd52.cleanup_id === add52.cleanup_id && upd52.cleanup && upd52.cleanup.target === "10.0.0.9"
      ? ok("cleanup add/update 都返回 cleanup_id + cleanup，且只改状态不抹 target")
      : bad(`cleanup 返回形状或字段不一致：${JSON.stringify([add52, upd52]).slice(0, 160)}`);

    /* ⑧ 端口要带 provenance：否则「扫出来的」与「被动看到的」无法区分 */
    d52({ op: "import", bundle: { assets: [{ ip: "10.6.6.6", ports: [{ port: 443, banner: "nginx", provenance: "active" }] }] } });
    const assets52 = s52.listAssets(e52.id);
    const a52 = (Array.isArray(assets52) ? assets52 : assets52.items || []).find((x) => x.ip === "10.6.6.6");
    const p52 = a52 ? s52.getAssetCoverage(e52.id, a52.id).asset.ports[0] : null;
    p52 && p52.provenance === "active" && p52.banner === "nginx"
      ? ok("getAssetCoverage().asset.ports 带 provenance / banner")
      : bad(`端口字段缺失：${JSON.stringify(p52)}`);
  } catch (e) {
    bad(`R20 运行时探测抛错：${String((e && e.message) || e)}`);
  } finally {
    try { fs.rmSync(tmpRoot52, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
}

console.log("[53] R21 五条功能面对等（报告 / 模板键 / 计数 / 名额 / 会话图）");  // 回归 test-r21-features.mjs
{
  const tmpRoot53 = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-r21-"));
  /* 配置与靶标库必须分两个根：上面写进 templatesCount 之后，
     intelStatus 会优先用「刷新过的计数」，把磁盘实测值盖掉 —— 那是正确行为，
     但会让这一组测不到磁盘计数。 */
  const tmpRoot53b = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-r21b-"));
  try {
    const { RedteamStore } = await import(path.join(PKG, "lib/redteam", "store-core.js"));
    const platform53 = await import(path.join(PKG, "lib/redteam", "platform-config.js"));
    const live53 = await import(path.join(PKG, "lib/redteam", "live-views.js"));

    /* ① scoreReport 默认带 report（safe 恒带），且与 reportV2 同分 */
    const s53 = new RedteamStore(tmpRoot53b);
    const e53 = s53.openEngagement("r21-gate", "10.0.0.0/8", { bindCurrent: false });
    const rep53 = s53.scoreReport(e53.id);
    const v2_53 = s53.reportV2(e53.id);
    rep53.report && rep53.report.summary && rep53.report.summary.points === v2_53.summary.points
      ? ok("scoreReport 默认带 report，且总分与 reportV2 一致")
      : bad(`scoreReport 的 report 缺失或总分不一致：${JSON.stringify(rep53.report && rep53.report.summary)}`);

    /* ② 4 个 templates* 默认键存在且能落盘 */
    const cfg53 = platform53.platformSummary(tmpRoot53).config || {};
    const four53 = ["templatesRefreshedAt", "templatesCommit", "templatesCount", "templatesLastError"];
    const miss53 = four53.filter((k) => !(k in cfg53));
    miss53.length === 0
      ? ok("platformConfigGet().config 带 4 个 templates* 默认键")
      : bad(`templates* 默认键缺失：${miss53.join(" / ")}`);
    platform53.savePlatformConfig({ templatesCount: 14481, templatesCommit: "abc1234" }, tmpRoot53);
    const back53 = platform53.loadPlatformConfig(tmpRoot53);
    back53.templatesCount === 14481 && back53.templatesCommit === "abc1234"
      ? ok("templates* 写入后能读回（刷新完计数不会停在 0）")
      : bad(`templates* 落盘失败：${JSON.stringify({ c: back53.templatesCount, m: back53.templatesCommit })}`);

    /* ③ intelStatus 的两段计数摘要 */
    const dir53 = path.join(tmpRoot53b, "toolkit", "nuclei-templates");
    fs.mkdirSync(dir53, { recursive: true });
    fs.writeFileSync(path.join(dir53, "a.yaml"), "id: a\n");
    fs.writeFileSync(path.join(dir53, "b.yml"), "id: b\n");
    fs.mkdirSync(path.join(tmpRoot53b, "intel"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot53b, "intel", "kev.json"),
      JSON.stringify({ dateReleased: new Date().toISOString(), vulnerabilities: [{ cveID: "CVE-2021-44228" }] }));
    const intel53 = s53.intelStatus();
    intel53.templates && intel53.templates.count === 2 && intel53.templates.owned === true
      ? ok("intelStatus.templates 计数正确且认出插件自己那份")
      : bad(`templates 摘要不对：${JSON.stringify(intel53.templates)}`);
    intel53.kev && intel53.kev.count === 1 && intel53.kev.available === true
      ? ok("intelStatus.kev 条目数与可用性正确")
      : bad(`kev 摘要不对：${JSON.stringify(intel53.kev)}`);

    /* ④ 名额：挂起的让出名额，且与工具层同判据 */
    const kids53 = [
      { id: "a", parent: "r", activity: "running" },
      { id: "b", parent: "r", activity: "running" },
      { id: "c", parent: "r", activity: "idle" },
    ];
    const split53 = live53.splitRunningParked(kids53, (p, id) => id === "b");
    split53.running.length === 1 && split53.parked.length === 1
      ? ok("waiting/blocked 的智能体不计入 used（面板与工具层同口径）")
      : bad(`名额拆分不对：${JSON.stringify(split53)}`);

    /* ⑤ 会话图：子代理树 + 活动态 + 封顶时主干优先 */
    const base53 = { engagements: [], sessions: [{ id: "s1", engagement: "e1" }, { id: "s2", engagement: "e1" }] };
    const list53 = [
      { id: "s1", header: { activity: "running" } },
      { id: "s2", header: { activity: "idle" } },
      { id: "k1", header: { activity: "running", parentSession: "s1" } },
    ];
    const merged53 = live53.mergeSessionGraphLive(base53, list53);
    merged53.sessions.length === 3 && merged53.sessions.find((x) => x.id === "k1").parent === "s1"
      ? ok("子代理并进图里且父子关系正确")
      : bad(`子代理没进图：${JSON.stringify(merged53.sessions.map((x) => x.id))}`);
    merged53.activity_counts.running === 2 && merged53.activity_counts.idle === 1
      ? ok("活动态计数正确")
      : bad(`活动态计数不对：${JSON.stringify(merged53.activity_counts)}`);
    const many53 = [];
    for (let i = 0; i < 400; i += 1) many53.push({ id: "k" + i, header: { activity: "running", parentSession: "s1" } });
    const capped53 = live53.mergeSessionGraphLive(base53, list53.concat(many53));
    capped53.sessions.length === 300 && capped53.sessions[0].id === "s1" && capped53.sessions[1].id === "s2"
      ? ok("封顶 300 时绑定会话仍排在最前（主干不被枝叶挤掉）")
      : bad(`封顶顺序不对：${capped53.sessions.slice(0, 3).map((x) => x.id).join(",")} / ${capped53.sessions.length}`);
  } catch (e) {
    bad(`R21 运行时探测抛错：${String((e && e.message) || e)}`);
  } finally {
    try { fs.rmSync(tmpRoot53, { recursive: true, force: true }) } catch { /* 忽略 */ }
    try { fs.rmSync(tmpRoot53b, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
}

console.log("[54] R22 safe 2.0.2 op 名兼容 + team-mode 接线 + 挂针契约");  // 回归 test-r22-alias.mjs
{
  const tmp54 = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-r22-"));
  const home54 = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-r22h-"));
  const prevHome54 = process.env.DSH_HOME;
  try {
    const { dispatch, dispatchAsync, RedteamStore } = await import(path.join(PKG, "lib/redteam", "store-core.js"));
    const store54 = new RedteamStore(tmp54);

    /* ① 四个别名必须被 dispatch 认出。
       判据不是「返回 ok」，是**不能是 unknown op** —— 那正是补之前的状态。 */
    const alias54 = ["cveSearch", "cveLookup", "templateCatalogStatus"];
    const unknown54 = alias54.filter((op) => /unknown op/i.test(String((dispatch(store54, { op }) || {}).error || "")));
    unknown54.length === 0
      ? ok("cveSearch / cveLookup / templateCatalogStatus 都已被 dispatch 认出")
      : bad(`这三个 op 仍是 unknown op：${unknown54.join(" / ")}`);

    /* 空库时必须说清「库不在」，不能只回一个空数组让人以为没命中 */
    const s54 = dispatch(store54, { op: "cveSearch", q: "log4j" });
    typeof s54.note === "string" && s54.note.length > 0 && s54.status && s54.status.available === false
      ? ok("空库 cveSearch 带 status.available=false 且附 note 说明原因")
      : bad(`空库 cveSearch 没说清原因：${JSON.stringify({ note: s54.note, status: s54.status })}`);

    /* ② intelSync 没配数据源：skipped + note，不能像同步过了 */
    process.env.DSH_HOME = home54;
    const base54 = process.env.REDTEAM_INTEL_BASE;
    delete process.env.REDTEAM_INTEL_BASE;
    const sync54 = await dispatchAsync(store54, { op: "intelSync" });
    if (base54 !== undefined) process.env.REDTEAM_INTEL_BASE = base54;
    sync54.result && sync54.result.action === "skipped" && /没有联网/.test(String(sync54.note || ""))
      ? ok("intelSync 无数据源 → action=skipped 且明说没联网没落盘")
      : bad(`intelSync 无数据源时没说清：${JSON.stringify(sync54)}`);

    /* ③ team-mode 真的被接线层装上（审计曾误判「零调用方」） */
    const caps54 = await import(path.join(PKG, "lib/plus-capabilities.js"));
    const ctx54 = { on: () => () => {}, get: () => undefined, effect() {}, logger: { info() {}, warn() {} } };
    const rep54 = caps54.installPlusCapabilities(ctx54, {});
    Array.isArray(rep54.installed) && rep54.installed.includes("team-mode")
      ? ok("installPlusCapabilities 把 team-mode 记进 installed（接线不是零调用方）")
      : bad(`能力接线层没装上 team-mode：${JSON.stringify(rep54)}`);

    /* ④ #209：挂针同时认 function 与 string，且非字符串返回值不再被 String() 糊掉 */
    /* 直接 import 补丁表：探针 JSON 只带 id/name/layer 这些字段，
       chainedAfter 与 replacements 不在里面。 */
    const overlay54 = await import(path.join(PKG, "lib/patches", "overlay.mjs"));
    const p209 = (overlay54.OVERLAY_PATCHES || []).find((x) => x.id === 209);
    p209 && p209.chainedAfter === 88
      ? ok("#209 挂在 #88 之后（锚点是 88 的产物）")
      : bad(`#209 缺失或未声明 chainedAfter：${JSON.stringify(p209 && p209.chainedAfter)}`);
    const src209 = p209 && p209.replacements && p209.replacements[0] ? p209.replacements[0].replace : "";
    const run209 = (g) => {
      const body = src209.replace(/\/\*[\s\S]*?\*\//g, "");
      try { return new Function("globalThis", body + "\nreturn dshPurgeHung;")(g); } catch { return "<throw>"; }
    };
    const g54 = {};
    const cases54 = [
      [(() => { g54.__dshPurgeHungPrompt = () => "FN"; return run209(g54); })(), "FN", "function 契约"],
      [(() => { g54.__dshPurgeHungPrompt = "  STR  "; return run209(g54); })(), "STR", "string 契约"],
      [(() => { g54.__dshPurgeHungPrompt = 42; return run209(g54); })(), "", "数字"],
      [(() => { g54.__dshPurgeHungPrompt = () => ({}); return run209(g54); })(), "", "函数返回对象"],
    ];
    const wrong54 = cases54.filter(([got, want]) => got !== want);
    wrong54.length === 0
      ? ok("#209 求值：function / string 都取到正文，数字与对象被丢弃")
      : bad(`#209 求值不符：${JSON.stringify(wrong54)}`);
  } finally {
    if (prevHome54 === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome54;
    try { fs.rmSync(tmp54, { recursive: true, force: true }) } catch { /* 忽略 */ }
    try { fs.rmSync(home54, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
}

console.log("");
if (failed) { console.error(`验收失败：${failed} 项`); process.exit(1); }
console.log("验收通过（本次全程只读，宿主未被修改）。");

// ── helpers ────────────────────────────────────────────────────
/** 按大括号配平取出 `sig` 之后的方法/函数体（含首尾大括号）。
 *  必须先跳过参数表的 `)`：签名里可能有默认值 `options = {}`，
 *  直接从签名后的第一个 `{` 开始配平会立刻闭合，取到的是 `{}` 而不是函数体。 */
function bodyOf(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) return "";
  let i = src.indexOf("(", start);
  if (i < 0) return "";
  let parens = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === "(") parens += 1;
    else if (src[i] === ")") { parens -= 1; if (parens === 0) { i += 1; break; } }
  }
  i = src.indexOf("{", i);
  if (i < 0) return "";
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  return "";
}
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
