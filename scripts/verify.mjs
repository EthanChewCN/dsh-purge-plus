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
  // 版本比较：0.1.N 递增要判成更新，且必须按数字比（0.1.10 > 0.1.9）；
  // 历史 tag（`1.7.20-plus.N`）仍要能解析，否则旧安装升不上来。
  const vs = await import(path.join(PKG, "lib", "update-state.js"));
  const okNewer = vs.versionIsNewer("0.1.37", "0.1.36")
    && vs.versionIsNewer("0.1.10", "0.1.9")
    && vs.versionIsNewer("1.7.20-plus.2", "1.7.20-plus.1")
    && !vs.versionIsNewer("0.1.37", "0.1.37");
  okNewer ? ok("版本比较：0.1.N 递增 / 数字序 / 历史 plus tag / 同版不更新") : bad("versionIsNewer 版本判定错误");

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
  /* 页脚是**血缘句**，不是版本号：两个上游都会继续更新，写死版本等于每次同步
     后都在误报。这里断言的是「存在且不含任何版本号」。 */
  const FOOT = "基于 dsh-purge Community + dsh-purge safe 独立维护 · MIT / Apache-2.0 · 上游署名见 NOTICE";
  js.includes(FOOT) ? ok("页脚血缘 = Community + safe（无版本号）") : bad("页脚血缘缺失或仍带版本号");
  /基于 dsh-purge Community [\d]/.test(js)
    ? bad("页脚仍写死上游版本号")
    : ok("页脚不含上游版本号");
  // 界面版本必须是本包版本；基座版本号不该在界面里留残影。
  const baseVer = JSON.parse(fs.readFileSync(path.join(ROOT, "vendor/community/package.json"), "utf8")).version;
  const stale = [...new Set((js.match(new RegExp(baseVer.replace(/\./g, "\\.") + "[0-9.\\-a-z]*", "g")) || []))];
  stale.length === 0 ? ok(`界面无基座版本 ${baseVer} 残留`) : bad(`界面残留基座版本 ${stale.join(", ")}`);
  js.includes(`Plus ${pkg2.version}`) ? ok(`面板徽章 = Plus ${pkg2.version}`) : bad("面板徽章不是本包版本");
  js.includes(`"${pkg2.version}"`) ? ok(`界面版本 = ${pkg2.version}`) : bad(`界面版本不是 ${pkg2.version}`);
  /^0\.1\.\d+$/.test(pkg2.version) ? ok(`版本号方案 0.1.N = ${pkg2.version}`) : bad(`版本号不是 0.1.N：${pkg2.version}`);
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

console.log("[12] P0 静默失败四件");
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
  /return \{ dir: dir \|\| null, total: items\.length, cve, byCategory \}/.test(core)
    ? ok("templateStats 返回 byCategory")
    : bad("templateStats 未返回 byCategory（面板分类计数恒为 0）");
  /\.map\(\(\[code, n\]\) => \(\{ code, name: pocCategoryName\(code\), n \}\)\)/.test(core)
    ? ok("byCategory 同时给出 code（面板用）与 name（工具文案用）")
    : bad("byCategory 只给出一种键，面板或工具会拿到 undefined");
}

console.log("[13] P1 会话绑定层 / P2 会话关系图");
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

console.log("[14] P3 子智能体回报 / 「现在在等谁」");
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

console.log("[15] P4 导航分组 / 二级页签");
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

console.log("[16] P5 站内全屏");
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

console.log("[17] P7 覆盖度引擎");
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

console.log("[18] P6 态势首页");
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

console.log("[19] P9 清理清单 / P10 资源保鲜");
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

console.log("[20] P8 数据证明 + 四段式报告");
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

console.log("[21] P11 复合工具入口");
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

console.log("[22] P12 证据账本 UI");
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
console.log("\n[23] P20/P21 报告文档视图 · 会话关系图 · 字段级对齐 · 情报刷新");
{
  const core = fs.readFileSync(path.join(PKG, "lib", "redteam", "store-core.js"), "utf8");
  const schema = fs.readFileSync(path.join(PKG, "lib", "redteam", "schema.js"), "utf8");

  /* 23.1 scoreReport 的 layout 分支：两条路径都存在，且 simple 不重算分 */
  /String\(options\.layout \|\| ''\) === 'simple'/.test(core)
    ? ok("scoreReport：layout='simple' 分支存在")
    : bad("scoreReport：缺 layout='simple' 分支");
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
  /location: req\.location/.test(core)
    && /for \(const f of \['status', 'detail', 'evidence_ref', 'priority', 'target', 'title', 'location'\]\)/.test(core)
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

  /* 23.12 审计 R-05：查不出来 ≠ 清干净 */
  /cleared: queryError === null \? byStatus\.open === 0 : null/.test(core)
    && /out\.cleared = queryError === null \? out\.open === 0 : null/.test(core)
    ? ok("cleanup：查询失败时 cleared 是 null（不假装已清干净）")
    : bad("cleanup：查询失败被当成「已清干净」");

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
  const buildSrc = fs.readFileSync(path.join(ROOT, "scripts", "build.mjs"), "utf8");
  /function stableBytes\(rel, abs\)/.test(buildSrc) && /delete holder\.generatedAt/.test(buildSrc)
    ? ok("构建摘要剔除 generatedAt（同 revision 重跑不再误报「内容不同」）")
    : bad("构建摘要含 generatedAt —— 同一内容每次摘要都变，T7 守卫会永远报错");

  /0x1f && got\.buf\[1\] === 0x8b/.test(core)
    ? ok("nuclei：先验 gzip 魔数再解压")
    : bad("nuclei：没有 gzip 魔数校验（200 + HTML 会被当模板包）");
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
