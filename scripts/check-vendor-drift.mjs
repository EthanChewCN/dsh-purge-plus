#!/usr/bin/env node
// [dsh-purge-plus] 上游漂移检查（只读）：vendor/community 或 vendor/safe 对一份外部源码。
//
// 用法:
//   node scripts/check-vendor-drift.mjs community <上游源码目录>
//   node scripts/check-vendor-drift.mjs safe      <上游源码目录>
//
// 为什么需要它：vendor 是**审计过的快照**，上游会继续走。没有这个脚本时，
// 「我们钉在哪、上游走到哪、差多少」只能靠记忆；有了它，每次上游发版跑一遍
// 就有可复核的数字。它绝不写入 vendor，也绝不自动追平 —— 追平是人的决定。
//
// community 的排除清单 = 本仓库 vendor 有意不带的上游目录/文件（packages、
// test、market、.github 等），否则「新增」列表里全是构建期不需要的噪声。
// 退出码：0 = 无漂移；1 = 有漂移（报告照常打印完）；2 = 用法/目录错误。

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "..");
const which = process.argv[2];
const target = process.argv[3];

const TARGETS = {
  community: {
    vendor: path.join(ROOT, "vendor", "community"),
    exclude: [
      ".github/", "packages/", "test/", "market/",
      "package-lock.json", "release-notes.md", "NATIVE-PANEL.md", ".gitignore", ".npmignore",
    ],
  },
  safe: { vendor: path.join(ROOT, "vendor", "safe"), exclude: [] },
};

if (!which || !TARGETS[which]) {
  console.error("✗ 用法: node scripts/check-vendor-drift.mjs <community|safe> <上游源码目录>");
  process.exit(2);
}
if (!target || !fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
  console.error(`✗ 目录不存在或不是目录：${target || "(未提供)"}`);
  process.exit(2);
}
const { vendor: VENDOR, exclude } = TARGETS[which];
if (!fs.existsSync(VENDOR)) {
  console.error(`✗ vendor 目录不存在：${VENDOR}`);
  process.exit(2);
}

const sha256 = (fp) => createHash("sha256").update(fs.readFileSync(fp)).digest("hex");
const excluded = (rel) => exclude.some((p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p));

function inventory(dir) {
  const map = new Map();
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (e.name.startsWith("._") || e.name === ".DS_Store") continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (excluded(child)) continue;
      if (e.isDirectory()) walk(child);
      else map.set(child, sha256(path.join(dir, child)));
    }
  };
  walk("");
  return map;
}

const vend = inventory(VENDOR);
const ext = inventory(target);
const drift = [];
const added = [];
const missing = [];
for (const [rel, h] of ext) {
  if (!vend.has(rel)) added.push(rel);
  else if (vend.get(rel) !== h) drift.push(rel);
}
for (const rel of vend.keys()) if (!ext.has(rel)) missing.push(rel);

const pkg = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
console.log(`vendor/${which} ${vend.size} 个文件 ｜ 外部 ${ext.size} 个文件（${pkg.name}@${pkg.version}）`);
console.log(`漂移 ${drift.length}（两边都有、内容不同）：`);
for (const f of drift.sort()) console.log(`  ~ ${f}`);
console.log(`新增 ${added.length}（外部有、vendor 没有）：`);
for (const f of added.sort()) console.log(`  + ${f}`);
console.log(`缺失 ${missing.length}（vendor 有、外部没有）：`);
for (const f of missing.sort()) console.log(`  - ${f}`);

const total = drift.length + added.length + missing.length;
if (total === 0) {
  console.log("✓ 无漂移：vendor 与外部源码逐字节一致");
  process.exit(0);
}
console.log(`\n共 ${total} 处差异。vendor 是审计快照，是否追平由人决定（见 docs/UPSTREAM.md）。`);
process.exit(1);
