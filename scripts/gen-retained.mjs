#!/usr/bin/env node
// [dsh-purge-plus] 生成 overlay/files/lib/patches/retained.mjs。
//
// 背景：community 1.7.24 把 14 条执行边界补丁（#6/#7/#8/#9/#10/#13/#14/#15/#16/
// #35/#51/#59/#60/#62）从 ALL_PATCHES 里整体删掉，宿主补丁 88 → 74。本包的
// <dsh_boost> 承诺依赖这一层（沙箱 confine、审批门、升级提权、fs fence），
// 所以把它们接成自有补丁保留。
//
// 数据必须来自 1.7.20 的 ALL_PATCHES 原样导出，不能手抄：字段顺序、正则转义、
// 多行锚点的制表符都会在抄写时漂。这个脚本从 git 历史里取那一版 vendor 树，
// 导入后按 id 过滤，序列化成可读的 JS 字面量。
//
//   node scripts/gen-retained.mjs            # 默认从 tag v0.1.180 取
//   node scripts/gen-retained.mjs <git-ref>  # 指定 ref
//
// 生成后不需要手工编辑；若将来上游又把某条加回来，改 WANT 列表并重跑。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "overlay", "files", "lib", "patches", "retained.mjs");
const REF = process.argv[2] || "v0.1.180";
const WANT = [6, 7, 8, 9, 10, 13, 14, 15, 16, 35, 51, 59, 60, 62];

function header(ref) {
  return `// [dsh-purge-plus] 上游 1.7.24 退役的 14 条执行边界补丁（本仓库保留）。
//
// 为什么保留：community 1.7.24 把 #6/#7/#8/#9/#10/#13/#14/#15/#16/#35/#51/#59/#60/#62
// 整体下线（宿主补丁 88 → 74），理由是「改写宿主执行边界最脆弱，边界交回宿主配置」，
// 替代物是 lib/inject-config.js 的注入层开关。那条路只控制「注入到不到模型」，
// 不改变 bash/pwsh 的沙箱与审批判定——本包的 <dsh_boost> 承诺依赖后者，
// 所以这 14 条在本包里改为自有补丁保留，语义与 1.7.20 逐字一致。
//
// 数据来源：git ref ${ref} 的 vendor/community@1.7.20 的 ALL_PATCHES 原样导出，
// 字段顺序与值不变，不是重写。复现：node scripts/gen-retained.mjs ${ref}
//
// 配套改动：lib/retired-permissions.mjs 的 rules 被置空（见 overlay/edits.mjs），
// 否则 1.7.24 的升级迁移会在 backupAll 时把这 14 条从宿主文件里擦掉。

export const RETAINED_PATCHES = `;
}

const q = (s) => JSON.stringify(s);
function serialize(v, ind = 0) {
  const pad = "  ".repeat(ind);
  const pad1 = "  ".repeat(ind + 1);
  if (v instanceof RegExp) return `/${v.source}/${v.flags}`;
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    const flat = `[${v.map(q).join(", ")}]`;
    if (v.every((x) => typeof x === "string") && flat.length <= 90) return flat;
    return `[\n${v.map((x) => pad1 + serialize(x, ind + 1)).join(",\n")},\n${pad}]`;
  }
  if (v && typeof v === "object") {
    return `{\n${Object.keys(v)
      .map((k) => `${pad1}${/^[A-Za-z_$][\w$]*$/.test(k) ? k : q(k)}: ${serialize(v[k], ind + 1)}`)
      .join(",\n")},\n${pad}}`;
  }
  if (typeof v === "string") return q(v);
  return String(v);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plus-retained-"));
  try {
    const tar = execFileSync("git", ["archive", REF, "vendor/community"], {
      cwd: ROOT,
      maxBuffer: 256 * 1024 * 1024,
    });
    execFileSync("tar", ["-x", "-C", tmp], { input: tar });
    const mod = await import(path.join(tmp, "vendor", "community", "lib", "patches", "index.mjs"));
    const picks = mod.ALL_PATCHES.filter((p) => WANT.includes(p.id));
    if (picks.length !== WANT.length) {
      throw new Error(`期望 ${WANT.length} 条，实际 ${picks.length} 条；ref=${REF}`);
    }
    fs.writeFileSync(OUT, header(REF) + serialize(picks, 0) + ";\n");
    console.log(`✓ ${path.relative(ROOT, OUT)}  ${picks.length} 条  ref=${REF}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

await main();
