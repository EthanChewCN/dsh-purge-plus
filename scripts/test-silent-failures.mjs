#!/usr/bin/env node
// [dsh-purge-plus] 静默失败回归：返回成功但结果不对、或错误被吞成正常值。
//
// 为什么单独测：这类缺陷**不会**让任何东西报错。`pocGet` 查不到返回 `{ok:true}`、
// 无靶标时 31 个 op 塌成同一个空壳、删盘失败还报 `deleted:true`——全部是
// 「有返回就算过」的测试放过去的。这里对每一条都断言**具体字段**，不是断言「有 ok」。

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
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log("  ✓ " + label); return }
  fail += 1;
  console.log("  ✗ " + label + (extra === undefined ? "" : "  ← " + JSON.stringify(extra)));
};
const section = (s) => console.log("\n" + s);

if (!fs.existsSync(path.join(PKG, "lib/redteam/store-core.js"))) {
  console.error("✗ 找不到构建产物，先跑 node scripts/build.mjs");
  process.exit(1);
}
const core = await import(path.join(PKG, "lib/redteam/store-core.js"));
const { dispatch, RedteamStore } = core;

const tmpRoots = [];
const tmp = (tag) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dshpp-${tag}-`));
  tmpRoots.push(dir);
  return dir;
};

/* ── 1. 按键取一条：查不到必须报错 ─────────────────────────────── */
section("[1] pocGet / readAttackFile 查不到不再返回 {ok:true}");
const missStore = {
  getPoc: () => undefined,
  readAttackFile: () => undefined,
  root: "/tmp",
  knowledgePath: () => "/tmp/kb.db",
  activeEngagementId: () => "",
};
const pocMiss = dispatch(missStore, { op: "pocGet", id: 99999 });
ok(pocMiss.ok === false, "pocGet 未命中 → ok:false", pocMiss);
ok(/poc not found/.test(pocMiss.error || ""), "错误文案指明 poc not found", pocMiss.error);
ok(pocMiss.error.includes("99999"), "错误里带上了查的键", pocMiss.error);
const pocHit = dispatch({ ...missStore, getPoc: () => ({ id: 7, code: "CVE-2021-44228" }) }, { op: "pocGet", id: 7 });
ok(pocHit.ok === true && pocHit.code === "CVE-2021-44228", "命中时仍然正常返回（没有把好路径改坏）", pocHit);

const fileMiss = dispatch(missStore, { op: "readAttackFile", engagement: "e1", id: 7 });
ok(fileMiss.ok === false && /attack file not found/.test(fileMiss.error || ""), "readAttackFile 未命中 → ok:false", fileMiss);
const fileHit = dispatch({ ...missStore, readAttackFile: () => ({ id: 7, content: "x" }) }, { op: "readAttackFile", engagement: "e1", id: 7 });
ok(fileHit.ok === true && fileHit.content === "x", "命中时仍然正常返回", fileHit);

/* ── 2. 无靶标：不许用通用空壳冒充 31 个 op 的契约 ──────────────── */
section("[2] 无靶标时不再给通用空壳");
const sample = ["snapshot", "graph", "attackGraph", "asset", "consoleDigest", "scoreReport", "shotData", "sessions"];
const shells = sample.map((op) => [op, dispatch(missStore, { op })]);
for (const [op, res] of shells) {
  ok(res.ok === false && res.no_target === true, `${op} → ok:false + no_target`, res);
}
ok(shells.every(([, r]) => r.error === "请先在顶部选择或创建一个靶标"), "统一给出「先选靶标」的提示");
// 旧调用方读数组不能炸：items 仍然在
ok(shells.every(([, r]) => Array.isArray(r.items)), "保留 items: [] 兼容旧调用方");
// 写操作仍走自己那条（不受影响）
const w = dispatch(missStore, { op: "addVuln", title: "x" });
ok(w.ok === false && !w.no_target, "写操作仍是原来那条错误（没被这条改动带偏）", w);

/* ── 3. deletePoc：删盘失败要报出来 ────────────────────────────── */
section("[3] deletePoc 删盘失败带 removed_error");
{
  const store = new RedteamStore(tmp("poc"));
  const saved = store.savePoc({ code: "CVE-TEST-0001", title: "t", body: "x" });
  const id = saved && saved.poc && saved.poc.id;
  ok(id !== undefined, "先存一条 POC 作为前提", saved);
  if (id !== undefined) {
    const dir = path.join(store.pocsDirOf(), "CVE-TEST-0001");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "payload.txt"), "p");
    fs.chmodSync(dir, 0o500); // 目录不可写 → 删不掉里面的文件
    const res = store.deletePoc(id);
    fs.chmodSync(dir, 0o700);
    ok(res.ok === true && res.deleted === true, "库行照删（数据一致性不受影响）", res);
    ok(typeof res.removed_error === "string" && res.removed_error.length > 0,
      "删盘失败必须带 removed_error（不能与「本来就没落盘文件」同形）", res);
    const res2 = store.deletePoc(999999);
    ok(res2.ok === false && /poc not found/.test(res2.error || ""), "删不存在的 POC 仍然报错", res2);
  }
}

/* ── 4. 技能软链：不能静默跳过 ─────────────────────────────────── */
section("[4] 符号链接形态的技能按目标类型识别");
{
  const home = tmp("skills");
  const skillsDir = path.join(home, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  // ① 真目录（基准）
  fs.mkdirSync(path.join(skillsDir, "plain-skill"));
  fs.writeFileSync(path.join(skillsDir, "plain-skill", "SKILL.md"), "---\nname: plain-skill\ndescription: d\n---\nbody\n");
  // ② 指向真目录的软链（这次要能列出来）
  const outside = tmp("outside");
  fs.mkdirSync(path.join(outside, "linked-skill"));
  fs.writeFileSync(path.join(outside, "linked-skill", "SKILL.md"), "---\nname: linked-skill\ndescription: d\n---\nbody\n");
  fs.symlinkSync(path.join(outside, "linked-skill"), path.join(skillsDir, "linked-skill"));
  // ③ 死链（目标不存在，应当被跳过而不是报错）
  fs.symlinkSync(path.join(outside, "gone"), path.join(skillsDir, "dead-skill"));

  const { listSkills } = await import(path.join(PKG, "lib/skills.js"));
  const listed = await listSkills(home);
  const ids = listed.map((s) => s.id);
  ok(ids.includes("plain-skill"), "真目录仍然列出（没改坏）", ids);
  ok(ids.includes("linked-skill"), "软链技能被列出（原来会被静默跳过）", ids);
  ok(!ids.includes("dead-skill"), "死链被跳过且不抛错", ids);

  process.env.DSH_HOME = home;
  const { officialSkillSummaries } = await import(path.join(PKG, "lib/redteam/skill-availability.js"));
  const official = officialSkillSummaries().map((s) => s.name);
  ok(official.includes("linked-skill"), "skillCatalog 的 official 库也认软链", official);
  ok(!official.includes("dead-skill"), "死链不进 official 库", official);
}

/* ── 5. 模板索引：`.github/` 下的 CI 文件不是模板 ───────────────── */
section("[5] nuclei 模板索引过滤掉非模板 YAML");
const storeSrc = fs.readFileSync(path.join(PKG, "lib/redteam/store-core.js"), "utf8");
ok(/if \(!\/\^id:\\s\*\\S\+\/m\.test\(full\)\) continue/.test(storeSrc),
  "walk() 只认**顶层** id:（正则不能再带 \\s* 前缀）");
/* 索引版本升到 4 的原因：过滤规则从「任意缩进的 id:」收紧成「顶层 id:」，
   旧缓存里的 4 个 .github 条目必须作废重算。 */
ok(/Number\(cached\.v \|\| 0\) === 4/.test(storeSrc), "旧索引缓存会作废重算（否则新规则不生效）");
{
  /* 判据必须和产物用同一条正则 —— 之前这里写的是 /^\s*id:/，
     于是「缩进的 step id」在断言里也被当成顶层 id，4 个 CI 文件在门禁眼皮底下混进索引。 */
  const hasId = (head) => /^id:\s*\S+/m.test(head);
  ok(hasId("id: CVE-2021-44228\ninfo:\n  name: x\n") === true, "真模板（有 id:）保留");
  ok(hasId("name: CI\non: [push]\njobs:\n  build:\n") === false, ".github/workflows/ci.yml 被排除");
  ok(hasId("jobs:\n  build:\n    steps:\n      - name: Run\n        id: run-tests\n") === false,
    "缩进的 step id 不算顶层 id（这正是那 4 个文件混进来的原因）");
  ok(hasId("name: Enhancement Request\ndescription: x\n") === false, ".github/ISSUE_TEMPLATE 被排除");
}

/* ── 6. consoleDigest：SQL 失败不再静默归零 ─────────────────────── */
section("[6] consoleDigest 的 SQL 异常带 errors");
{
  const store = new RedteamStore(tmp("digest"));
  const opened = store.openEngagement("审计靶标", "10.0.0.0/24");
  const id = opened && (opened.id || (opened.engagement && opened.engagement.id));
  ok(!!id, "先建一个靶标作为前提", opened && Object.keys(opened));
  if (id) {
    const clean = store.consoleDigest(id);
    ok(Array.isArray(clean.errors) && clean.errors.length === 0, "schema 正常时 errors 为空", clean.errors);
    ok(clean.sections && typeof clean.sections.assets === "object", "sections 仍然照常给出", Object.keys(clean.sections || {}));
    // safe 有 15 段；缺 artifacts/overview/env 时，「凭据与文件」「态势首页」
    // 「环境适配」三个页签的红点永远不会亮。
    for (const key of ["artifacts", "overview", "env"]) {
      ok(clean.sections && clean.sections[key] !== undefined, `sections 含 ${key}（三个页签的红点靠它）`, Object.keys(clean.sections || {}));
    }
    ok(Object.keys(clean.sections || {}).length === 15, "sections 共 15 段，与 safe 对齐", Object.keys(clean.sections || {}).length);
    // 制造 schema 漂移：把 vuln 表改名
    store.db(id).exec("ALTER TABLE vuln RENAME TO vuln_gone");
    const broken = store.consoleDigest(id);
    ok(Array.isArray(broken.errors) && broken.errors.length > 0,
      "schema 漂移时 errors 非空（原来会静默报 0）", broken.errors);
    ok(broken.errors.some((e) => /vuln/.test(e.sql || "")), "错误里带上了出问题的 SQL 片段", broken.errors);
    store.db(id).exec("ALTER TABLE vuln_gone RENAME TO vuln");
  }
}

/* ── 7. selfcheck：推断态不算失败 ───────────────────────────────── */
section("[7] selfcheck 的 inferred 不再把整体判成失败");
const selfSrc = fs.readFileSync(path.join(PKG, "lib/selfcheck.js"), "utf8");
ok(/const failed = layers\.filter\(\(layer\) => !layer\.ok && layer\.state !== "inferred"\)/.test(selfSrc),
  "汇总时排除 inferred");
ok(/warnings: inferredLayers\.map/.test(selfSrc), "推断态进 warnings（不能当没发生）");

/* ── 8. 请求体：null 不许外泄 V8 文本 ──────────────────────────── */
section("[8] 非对象请求体一律当空请求");
const uiSrc = fs.readFileSync(path.join(PKG, "lib/redteam/ui.js"), "utf8");
ok(/const request = parsed && typeof parsed === 'object' \? parsed : \{\}/.test(uiSrc),
  "JSON.parse 结果不是对象时兜成 {}");
ok(!/const request = raw\.trim\(\) \? JSON\.parse\(raw\) : \{\}/.test(uiSrc),
  "旧的裸解析已移除（null 会一路传下去抛 TypeError）");

/* ── 9. updateCleanup：没传的字段不许被写成 NULL ────────────────── */
section("[9] updateCleanup 只改真的给过的字段");
{
  const store = new RedteamStore(tmp("cleanup"));
  const opened = store.openEngagement("清理靶标", "10.0.0.0/24");
  const id = opened && (opened.id || (opened.engagement && opened.engagement.id));
  const added = dispatch(store, {
    op: "addCleanup", engagement: id, kind: "webshell", target: "10.0.0.5:80",
    title: "冰蝎马", detail: "shell.php", priority: "high",
  });
  ok(added.ok === true && added.cleanup_id, "先加一条清理项", added);
  const itemId = added.cleanup_id;
  // 只改 detail：status 没给，不能被当成「把 status 改成 undefined」
  const onlyDetail = dispatch(store, { op: "updateCleanup", engagement: id, id: itemId, detail: "shell2.php" });
  ok(onlyDetail.ok === true, "只改 detail 不报错（原来会因为 status:undefined 校验失败）", onlyDetail);
  const row = onlyDetail.cleanup || {};
  ok(row.detail === "shell2.php", "detail 已改", row.detail);
  ok(row.status === "open", "status 没被写成 NULL（原来会变 null）", row.status);
  ok(row.target === "10.0.0.5:80", "target 没被清空", row.target);
  ok(row.title === "冰蝎马", "title 没被清空", row.title);
  ok(row.priority === "high", "priority 没被清空", row.priority);
  // 去重键还在：同 kind+target 再加一条应当被合并
  const again = dispatch(store, {
    op: "addCleanup", engagement: id, kind: "webshell", target: "10.0.0.5:80", title: "冰蝎马",
  });
  ok(again.deduped === true, "target 保住了，去重仍然生效（原来会插出重复项）", again);
  // 显式传 null 才是「清空」
  const cleared = dispatch(store, { op: "updateCleanup", engagement: id, id: itemId, detail: null });
  ok(cleared.ok === true && (cleared.cleanup || {}).detail === null, "显式 null 仍然能清空字段", cleared);
}

/* ── 10. stage_code 回填：老库（列在、值空）也要补 ──────────────── */
section("[10] attack_step.stage_code 老库回填");
{
  const { migrate } = await import(path.join(PKG, "lib/redteam/schema.js"));
  const Database = (await import("node:sqlite")).DatabaseSync;
  const dir = tmp("legacy");
  const file = path.join(dir, "e.db");
  const db = new Database(file);
  // 造一个「列已存在但值全空」的老库：模拟从社区版升上来
  db.exec("CREATE TABLE attack_step (id INTEGER PRIMARY KEY AUTOINCREMENT, stage TEXT, action TEXT, stage_code TEXT)")
  db.exec("INSERT INTO attack_step(stage, action, stage_code) VALUES ('vuln','scan',NULL),('access','login',''),('pivot','tunnel','kept')")
  migrate(db);
  const rows = db.prepare("SELECT stage, stage_code FROM attack_step ORDER BY id").all()
  ok(rows[0].stage_code === "internet", "vuln → internet（原来列已存在就整段跳过）", rows[0]);
  ok(rows[1].stage_code === "internal", "access → internal", rows[1]);
  ok(rows[2].stage_code === "kept", "已有值不被覆盖", rows[2]);
  db.close();
}

for (const dir of tmpRoots) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
}

console.log("\n" + (fail === 0 ? "全部通过" : "有失败") + `：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
