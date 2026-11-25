#!/usr/bin/env node
/**
 * 补丁组状态汇总回归（2026-11-23）。
 *
 * 缺陷：上游 1.7.20 的 rollupDisplayStatus 是「组内任一 applied → 整组 applied」。
 * 一个补丁在 2 个目标文件里只命中 1 个（partial）时，面板显示「已生效」——
 * 用户以为打上了，其实只打了一半。上游 master 已改；本仓库留在 1.7.20 基线，
 * 用 overlay 两条编辑补回同一语义，这里守它不再退化。
 *
 * 断言的是**函数真值**，不是源码字符串：直接 import 装配产物的模块跑。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
/* 既能在仓库里跑（scripts/../dist/build/package），也能在**已安装的包里**跑
   （发布包现在带 test-*.mjs，脚本所在包的根就是包根；审计 B-5）。
   注意这里用脚本自身位置而不是 ROOT —— 有些测试的 ROOT 是临时库目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = fs.existsSync(path.join(HERE, "..", "dist", "build", "package"))
  ? path.join(HERE, "..", "dist", "build", "package")
  : path.join(HERE, "..");

const MOD = path.join(PKG, "lib", "core", "verify.mjs");

let pass = 0;
const fails = [];
const ok = (cond, name) => { if (cond) { pass += 1; } else { fails.push(name); } };

const m = await import(pathToFileURL(MOD).href);

const rollupCases = [
  [[], "skipped", "空组"],
  [["applied"], "applied", "全部已生效"],
  [["applied", "already"], "applied", "applied + already"],
  [["skipped", "applied"], "applied", "跳过项不拖累已生效"],
  [["missing_file", "applied"], "applied", "missing_file 属跳过"],
  [["pending", "applied"], "pending", "有 pending 优先 pending"],
  [["unmatched", "applied"], "unmatched", "有 unmatched 优先 unmatched"],
  [["applied", "partial"], "partial", "★ 组内有 partial → 整组 partial（原缺陷）"],
  [["applied", "pattern_not_found"], "partial", "★ 组内有锚点没对上 → 整组 partial"],
  [["applied", "drifted"], "partial", "★ 组内有 drifted → 整组 partial"],
  [["skipped", "partial"], "partial", "只剩跳过项之外的 broken 也要报出来"],
];

for (const [input, want, name] of rollupCases) {
  const got = m.rollupDisplayStatus(input);
  ok(got === want, `${name}：期望 ${want}，实际 ${got}`);
}

/* tallyDisplayPatches：partial 必须算未完成，不能落进 skipped 且计入 ready */
{
  const t = m.tallyDisplayPatches([{ status: "partial" }]);
  ok(t.unmatched === 1, `partial 计入 unmatched（实际 ${JSON.stringify(t)}）`);
  ok(t.ready === 0, "partial 不计入 ready");
  ok(t.skipped === 0, "partial 不计入 skipped");
}
{
  const t = m.tallyDisplayPatches([{ status: "skipped" }]);
  ok(t.skipped === 1 && t.ready === 1, "skipped 仍计入 skipped 且 ready（原行为不变）");
}
{
  const t = m.tallyDisplayPatches([{ status: "applied" }, { status: "partial" }]);
  ok(t.applied === 1 && t.unmatched === 1 && t.ready === 1, "混合组：applied 1 / unmatched 1 / ready 1");
}

if (fails.length) {
  console.error(`✗ test-patch-rollup：${pass} 通过 / ${fails.length} 失败\n  ` + fails.join("\n  "));
  process.exit(1);
}
console.log(`✓ test-patch-rollup：${pass} 通过 / 0 失败`);
