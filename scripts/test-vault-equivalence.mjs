#!/usr/bin/env node
// [dsh-purge-plus] 「保险库 / 自愈」等价性验证。
//
// 背景：上一轮（R7）我写过一句「本包的 revert 是反向文本编辑，没有 .bak」——**那是错的**。
// 当时只 grep 了 lib/patches/（那是补丁表，不是引擎），而引擎在 lib/core.js 里，
// 而且完整实现了：backupAll（建 .dshpurge.bak）、restoreMissingOriginalsFromBak（还原）、
// refreshStaleBaksForUpgrade（宿主升级后刷新备份）、applyPatches 前的 profile 快照。
//
// 所以 safe 的 vault（ensureOfficialSnapshot / writeVaultMeta / listVaultEntries）
// 是**同一件事的第二套实现**，不该搬进来 —— 两套并存只会互相盖。
// 这个脚本的职责就是把这条判断钉在代码里：
//   ① 等价机制真的在（不是我在文档里说说）；
//   ② 还原函数对「坏备份」是拒绝而不是覆盖（覆盖 = 用空文件毁掉原文件）；
//   ③ 没有第二套 vault 被偷偷加进来。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 既能在仓库里跑（dist/build/package），也能在**已安装的包里**跑（脚本所在包的根）——
   发布包现在带 test-*.mjs，验收可以对已安装产物复跑（审计 B-5）。 */
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m) => { fail++; console.error("  ✗ " + m); };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(`${m}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`));

const coreSrc = fs.readFileSync(path.join(PKG, "lib", "core.js"), "utf8");

console.log("[1] 原件备份机制：建 / 还 / 刷");
{
  eq(/const BAK_SUFFIX = "\.dshpurge\.bak"/.test(coreSrc), true, "备份后缀是 .dshpurge.bak");
  eq(/export async function backupAll\(/.test(coreSrc), true, "有 backupAll（建备份）");
  /* 建备份必须发生在写文件之前：applyPatchesAllHosts 里先 backupAll，再逐补丁写。 */
  const allHostsAt = coreSrc.indexOf("export async function applyPatchesAllHosts(");
  const backupCallAt = coreSrc.indexOf("const backups = await backupAll(aiBase)", allHostsAt);
  eq(backupCallAt > allHostsAt, true, "applyPatchesAllHosts 里先 backupAll 再写");
  eq(/Host backup failed[\s\S]{0,80}patch writes cancelled/.test(coreSrc), true, "备份失败就中止写入（不会在没有备份的情况下改宿主）");

  eq(/export function restoreMissingOriginalsFromBak\(/.test(coreSrc), true, "有 restoreMissingOriginalsFromBak（还原）");
  const applyAt = coreSrc.indexOf("export async function applyPatches(");
  const restoreCallAt = coreSrc.indexOf("restoreMissingOriginalsFromBak(aiBase)", applyAt);
  eq(restoreCallAt > applyAt, true, "applyPatches 会先补回缺失的原件");

  eq(/export function refreshStaleBaksForUpgrade\(/.test(coreSrc), true, "有 refreshStaleBaksForUpgrade（宿主升级后刷新备份）");
  const refreshCallAt = coreSrc.indexOf("refreshStaleBaksForUpgrade(aiBase)", applyAt);
  eq(refreshCallAt > applyAt, true, "applyPatches 会刷新过期备份");

  /* profile 级快照：整份写入前先备份整个 profile。 */
  const snapAt = coreSrc.indexOf('.backup("before-host-patches")', applyAt);
  eq(snapAt > applyAt, true, "applyPatches 前有 profile 级快照");
}

console.log("[2] 自愈：重复函数声明折叠");
{
  eq(/collapseDuplicateLegacyApplyPath/.test(coreSrc), true, "有 collapseDuplicateLegacyApplyPath（重复声明折叠）");
  const shared = fs.readFileSync(path.join(PKG, "lib", "core", "shared.mjs"), "utf8");
  eq(/export function collapseDuplicateLegacyApplyPath/.test(shared), true, "实现落在 core/shared.mjs");
}

console.log("[3] 还原函数：坏备份必须拒绝，不能覆盖");
{
  const { restoreBackupFileSync } = await import(path.join(PKG, "lib", "restore-backup.js"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plus-vault-"));
  try {
    const target = path.join(dir, "x.js");
    const bak = target + ".dshpurge.bak";
    fs.writeFileSync(target, "PATCHED", "utf8");
    fs.writeFileSync(bak, "ORIGINAL", "utf8");
    restoreBackupFileSync(target, bak);
    eq(fs.readFileSync(target, "utf8"), "ORIGINAL", "正常备份能还原");

    fs.writeFileSync(target, "PATCHED AGAIN", "utf8");
    fs.writeFileSync(bak, "", "utf8");
    let threw = false;
    try { restoreBackupFileSync(target, bak); } catch { threw = true; }
    eq(threw, true, "空备份被拒绝（抛错）");
    eq(fs.readFileSync(target, "utf8"), "PATCHED AGAIN", "拒绝时原文件一个字节没动");

    fs.rmSync(bak, { force: true });
    threw = false;
    try { restoreBackupFileSync(target, bak); } catch { threw = true; }
    eq(threw, true, "备份不存在时报错，不静默成功");

    /* 符号链接目标：拒绝（防止通过链接把别处的文件覆盖掉）。 */
    const real = path.join(dir, "real.js");
    fs.writeFileSync(real, "REAL", "utf8");
    const link = path.join(dir, "link.js");
    fs.symlinkSync(real, link);
    fs.writeFileSync(bak, "FROM-BAK", "utf8");
    threw = false;
    try { restoreBackupFileSync(link, bak); } catch { threw = true; }
    eq(threw, true, "目标是符号链接时拒绝还原");
    eq(fs.readFileSync(real, "utf8"), "REAL", "链接指向的真实文件没被写");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log("[4] 没有第二套 vault 被搬进来");
{
  /* safe 的 vault 符号：一旦有人把它们搬进 lib/，就说明两套机制并存的开始。 */
  const SAFE_VAULT = ["ensureOfficialSnapshot", "writeVaultMeta", "listVaultEntries", "vaultBakPath", "hostBakVaultRoot"];
  const libFiles = [];
  const walk = (rel) => {
    for (const ent of fs.readdirSync(path.join(PKG, rel), { withFileTypes: true })) {
      const r = path.join(rel, ent.name);
      if (ent.isDirectory()) walk(r);
      else if (/\.(js|mjs)$/.test(ent.name)) libFiles.push(r);
    }
  };
  walk("lib");
  const hits = [];
  for (const rel of libFiles) {
    const src = fs.readFileSync(path.join(PKG, rel), "utf8");
    for (const sym of SAFE_VAULT) {
      if (new RegExp(`function ${sym}\\b`).test(src)) hits.push(`${rel}:${sym}`);
    }
  }
  eq(hits, [], `没有引入 safe 的 vault 实现（命中：${hits.join("、") || "无"}）`);
}

console.log("[5] 接线：这三条不是死代码");
{
  /* 定义存在 ≠ 会被调用。上一条已经查了调用点，这里再确认函数本身被 export。 */
  const { default: _ } = { default: null };
  const core = await import(path.join(PKG, "lib", "core.js"));
  eq(typeof core.backupAll, "function", "backupAll 可导入");
  eq(typeof core.restoreMissingOriginalsFromBak, "function", "restoreMissingOriginalsFromBak 可导入");
  eq(typeof core.refreshStaleBaksForUpgrade, "function", "refreshStaleBaksForUpgrade 可导入");
  eq(typeof core.applyPatches, "function", "applyPatches 可导入");
}

/* 汇总行格式与其它 test-*.mjs 一致：verify [33] 按「N 通过 / M 失败」汇总断言数 */
console.log(`${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
