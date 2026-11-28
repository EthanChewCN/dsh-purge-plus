#!/usr/bin/env node
// [dsh-purge-plus] 补丁状态词条与分类回归。
//
// 为什么单独测：补丁详情里每一行都带一个状态胶囊，用户只能靠这句话判断
// 「这条到底打上了没有」。字符串断言（grep 某个 key 存在）挡不住映射重了：
// key 都在，只是两个不同状态印了同一句话。
//
// 1.7.24 把判定搬进 lib/patch-state.mjs，client.js 里的 statusLabel/statusKind/
// patchNotApplicable/patchStateCategory/summarizePatchRows 是它的展示面。
// 本测试从**构建产物**里切出这几个真函数跑，不重写等价实现——
// 重写的那份永远会过。
//
// 与 1.7.24 的差异（有意）：本包不再另立「跳过 / 本端不适用」两套词条。
// 上游的口径是：na 与 skipped 都算「本端不需要」，off/disabled 是「被开关关掉」，
// missing_file 是「缺目标文件」。三者必须印三句不同的话——这是本节的主断言。

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 既能在仓库里跑（dist/build/package），也能在**已安装的包里**跑（脚本所在包的根）。 */
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;
const CLIENT = path.join(PKG, "client.js");

let pass = 0;
let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log("  ✓ " + label); return }
  fail += 1;
  console.log("  ✗ " + label + (extra === undefined ? "" : "  ← " + JSON.stringify(extra)));
};
const section = (s) => console.log("\n" + s);

if (!fs.existsSync(CLIENT)) {
  console.error("✗ 找不到构建产物，先跑 node scripts/build.mjs");
  process.exit(1);
}
const src = fs.readFileSync(CLIENT, "utf8");

/* ── 0. 从产物里切出真函数 ─────────────────────────────────────── */
const from = src.indexOf("function patchNotApplicable(");
const to = src.indexOf("\nvar LAYER_GROUP = {");
if (from < 0 || to < 0 || to < from) {
  console.error("✗ 产物里找不到状态判定簇，宿主结构变了");
  process.exit(1);
}
const bucketSrc = src.slice(from, to);
const B = new Function(
  bucketSrc + "; return { patchNotApplicable, patchStateCategory, summarizePatchRows, statusKind, statusLabel };",
)();
// 用 key 本身当译文：断言的是「映射到哪个词条」，不是文案写得好不好。
const t = (k) => k;

/* ── 1. 三种「没打上」的原因必须印三句不同的话 ─────────────────── */
section("[1] na / skipped / off / missing_file 不再共用一句");
const na = B.statusLabel("na", t);
const skipped = B.statusLabel("skipped", t);
const off = B.statusLabel("off", t);
const disabled = B.statusLabel("disabled", t);
const missing = B.statusLabel("missing_file", t);
ok(na === "health.na", "na → health.na（本端不需要）", na);
ok(skipped === "health.na", "skipped → health.na（本端没有要改的内容）", skipped);
ok(off === "status.skipped", "off → status.skipped（被开关关掉）", off);
ok(disabled === "status.disabled", "disabled → status.disabled", disabled);
ok(missing === "file.missing_file", "missing_file → file.missing_file（缺目标文件）", missing);
ok(new Set([na, off, missing]).size === 3, "「不适用 / 被关掉 / 缺文件」三句互不相同", [na, off, missing]);

/* ── 2. 已生效与未完成的映射 ───────────────────────────────────── */
section("[2] 已生效 / 未完成");
for (const st of ["applied", "already"]) {
  ok(B.statusLabel(st, t) === "status.applied", `${st} → status.applied`);
  ok(B.statusKind(st) === "ok", `${st} 的胶囊是 ok`);
}
for (const st of ["pending"]) {
  ok(B.statusLabel(st, t) === "status.pending", `${st} → status.pending`);
  ok(B.statusKind(st) === "wait", `${st} 的胶囊是 wait`);
}
for (const st of ["unmatched", "partial", "drifted"]) {
  ok(B.statusLabel(st, t) === "status." + st, `${st} → status.${st}`);
  ok(B.statusKind(st) === "bad", `${st} 的胶囊是 bad（必须显眼）`);
}
ok(B.statusKind("na") === "ok", "na 的胶囊是 ok（不需要改，不是失败）");
ok(B.statusKind("skipped") === "miss", "skipped 的胶囊是 miss");

/* ── 3. 分类与分母：谁算「这条不用管」 ─────────────────────────── */
section("[3] patchNotApplicable / patchStateCategory");
for (const [patch, status, want, label] of [
  [null, "na", true, "na 一律不适用"],
  [null, "off", true, "off 一律不适用"],
  [null, "disabled", true, "disabled 一律不适用"],
  [{ id: 76 }, "not_needed", true, "#76 的 not_needed 视为不适用"],
  [{ id: 1 }, "not_needed", false, "其它 id 的 not_needed 不算不适用"],
  [{ optional: true }, "missing_file", true, "optional 的 missing_file 不适用"],
  [{ optional: false }, "missing_file", false, "非 optional 的 missing_file 算坏"],
  [{ settleWhenAbsent: true }, "skipped", true, "settleWhenAbsent 的 skipped 不适用"],
  [{ settleWhenAbsent: false }, "skipped", false, "未声明的 skipped 仍要可见"],
  [null, "applied", false, "applied 当然不是不适用"],
]) {
  ok(B.patchNotApplicable(patch, status) === want, label);
}
for (const [status, want] of [
  ["applied", "applied"], ["already", "applied"], ["pending", "pending"],
  ["na", "inactive"], ["unknown", "unknown"], ["unreadable", "unknown"],
  ["partial", "broken"], ["unmatched", "broken"], ["pattern_not_found", "broken"],
]) {
  ok(B.patchStateCategory(null, status) === want, `patchStateCategory(${status}) = ${want}`);
}

section("[4] summarizePatchRows 的分母");
{
  const s = B.summarizePatchRows([
    { status: "applied" },
    { status: "pending" },
    { status: "na" },
    { status: "skipped", settleWhenAbsent: true },
    { status: "partial" },
  ]);
  ok(s.all === 5, `all 统计全部行（实际 ${s.all}）`);
  ok(s.total === 3, `total 只算需要处理的（实际 ${s.total}，期望 3 = applied + pending + partial）`);
  ok(s.not_applicable === 2, `not_applicable = 2（实际 ${s.not_applicable}）`);
  ok(s.applied === 1 && s.pending === 1 && s.broken === 1, "applied / pending / broken 各 1");
}
{
  const s = B.summarizePatchRows([]);
  ok(s.all === 0 && s.total === 0, "空输入不炸，两个计数都是 0");
}

/* ── 5. 两套语言表都要有被引用到的 key ─────────────────────────── */
section("[5] 中英词条齐全");
const zhStart = src.indexOf("var zh = {");
const enStart = src.indexOf("var en = {");
const zhSrc = src.slice(zhStart, enStart);
const enSrc = src.slice(enStart, src.indexOf("\nvar LAYER_GROUP", enStart));
const used = new Set(
  // 只查带命名空间的 key；t("unknown") 是 statusLabel 的裸兜底，
  // 只在状态为 undefined 时才会走到，不在词条表里。
  [...bucketSrc.matchAll(/t\("([^"]+)"\)/g)].map((m) => m[1]).filter((k) => k.includes(".")),
);
ok(used.size >= 8, `从判定簇里扫到 ${used.size} 个词条 key`);
for (const key of used) {
  ok(zhSrc.includes(`"${key}"`), `中文表有 ${key}`);
  ok(enSrc.includes(`"${key}"`), `英文表有 ${key}`);
}

if (fail) {
  console.error(`\n✗ test-status-labels：${pass} 通过 / ${fail} 失败`);
  process.exit(1);
}
console.log(`\n✓ test-status-labels：${pass} 通过 / 0 失败`);
