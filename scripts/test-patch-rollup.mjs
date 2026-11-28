#!/usr/bin/env node
/**
 * 补丁组状态汇总回归。
 *
 * 历史：1.7.20 的 rollupDisplayStatus 是「组内任一 applied → 整组 applied」，
 * 一个补丁在两个目标文件里只命中一个（partial）时面板仍显示「已生效」。
 * 本仓库当时用 overlay 两条编辑补回该语义。
 *
 * 1.7.24 把整套状态判定搬进 lib/patch-state.mjs，rollup 与 tally 都重写了，
 * 上面那两条 overlay 编辑随之删除（见 overlay/edits.mjs 的 A 段注释）。
 * 这个测试因此改为**守住新契约**，重点是那条老缺陷不许回来：
 * 组内只要有一条没落地，整组就不许报 applied。
 *
 * 断言的是**函数真值**，不是源码字符串：直接 import 装配产物的模块跑。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* 既能在仓库里跑（scripts/../dist/build/package），也能在**已安装的包里**跑
   （发布包现在带 test-*.mjs，脚本所在包的根就是包根；审计 B-5）。 */
const PKG = fs.existsSync(path.join(HERE, "..", "dist", "build", "package"))
  ? path.join(HERE, "..", "dist", "build", "package")
  : path.join(HERE, "..");

const MOD = path.join(PKG, "lib", "core", "verify.mjs");

let pass = 0;
const fails = [];
const ok = (cond, name) => { if (cond) { pass += 1; } else { fails.push(name); } };

const m = await import(pathToFileURL(MOD).href);

/* 1.7.24 契约：空组 unknown；全同取该值；坏状态按优先级浮现；
   组内任一条未落地都不许汇总成 applied。 */
const rollupCases = [
  [[], "unknown", "空组 → unknown（不再谎报 skipped）"],
  [["applied"], "applied", "全部已生效"],
  [["applied", "already"], "applied", "applied + already 同属已生效"],
  [["pending", "applied"], "pending", "有 pending 优先 pending"],
  [["unmatched", "applied"], "unmatched", "有 unmatched 优先 unmatched"],
  [["missing_file", "applied"], "missing_file", "missing_file 在坏状态优先表里"],
  [["drifted", "applied"], "drifted", "drifted 在坏状态优先表里"],
  [["applied", "partial"], "partial", "★ 组内有 partial → 整组 partial（原缺陷）"],
  [["applied", "pattern_not_found"], "pattern_not_found", "★ 锚点没对上 → 不许汇总成 applied"],
  [["skipped", "partial"], "partial", "★ 坏状态比 skipped 优先"],
  [["skipped", "applied"], "skipped", "未声明 settleWhenAbsent 的 skipped 保持可见"],
];

for (const [input, want, name] of rollupCases) {
  const got = m.rollupDisplayStatus(input);
  ok(got === want, `${name}：期望 ${want}，实际 ${got}`);
}

/* 核心不变式：只要组里有任何一个非 applied/already 的值，就绝不返回 applied。 */
for (const bad of ["partial", "pattern_not_found", "unmatched", "drifted", "pending", "skipped"]) {
  const got = m.rollupDisplayStatus(["applied", bad]);
  ok(got !== "applied", `不变式：applied + ${bad} 不许汇总成 applied（实际 ${got}）`);
}

/* tallyDisplayPatches：partial 必须算未完成，不能落进 skipped 且计入 ready */
{
  const t = m.tallyDisplayPatches([{ status: "partial" }]);
  ok(t.unmatched === 1, `partial 计入 unmatched（实际 ${JSON.stringify(t)}）`);
  ok(t.ready === 0, "partial 不计入 ready");
  ok(t.skipped === 0, "partial 不计入 skipped");
}
/* 未声明 settleWhenAbsent 的 skipped：留在分母里、不算 ready（1.7.24 的新口径） */
{
  const t = m.tallyDisplayPatches([{ status: "skipped" }]);
  ok(t.skipped === 1, "skipped 计入 skipped");
  ok(t.ready === 0, "skipped 不计入 ready");
  ok(t.total === 1, "未声明 settleWhenAbsent 的 skipped 仍在分母里");
}
/* 声明了 settleWhenAbsent 的 skipped：整条退出分母 */
{
  const t = m.tallyDisplayPatches([{ status: "skipped", settleWhenAbsent: true }]);
  ok(t.total === 0, `settleWhenAbsent 的 skipped 退出分母（实际 total=${t.total}）`);
  ok(t.ready === 0, "退出分母的 skipped 也不计入 ready");
}
/* optional 的 missing_file 同样退出分母；非 optional 的留在分母里 */
{
  const opt = m.tallyDisplayPatches([{ status: "missing_file", optional: true }]);
  const req = m.tallyDisplayPatches([{ status: "missing_file" }]);
  ok(opt.total === 0, "optional 的 missing_file 退出分母");
  ok(req.total === 1, "非 optional 的 missing_file 留在分母里");
}
{
  const t = m.tallyDisplayPatches([{ status: "applied" }, { status: "partial" }]);
  ok(t.applied === 1 && t.unmatched === 1 && t.ready === 1, "混合组：applied 1 / unmatched 1 / ready 1");
}
/* patchStatusReady：只有 applied 与 inactive 算就绪 */
for (const [st, patch, want] of [
  ["applied", null, true],
  ["na", null, true],
  ["skipped", { settleWhenAbsent: true }, true],
  ["skipped", null, false],
  ["pending", null, false],
  ["partial", null, false],
]) {
  ok(m.patchStatusReady(st, patch) === want, `patchStatusReady(${st}${patch ? "+settle" : ""}) = ${want}`);
}

if (fails.length) {
  console.error(`✗ test-patch-rollup：${pass} 通过 / ${fails.length} 失败\n  ` + fails.join("\n  "));
  process.exit(1);
}
console.log(`✓ test-patch-rollup：${pass} 通过 / 0 失败`);
