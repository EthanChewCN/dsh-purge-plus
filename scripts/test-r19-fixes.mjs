#!/usr/bin/env node
// [dsh-purge-plus] R19 回归：四条「会永久丢数据」的缺陷 + 两条读路径副作用。
//
// 为什么单独一个脚本：这六条的共同点是**返回 ok 也算错**。
//   · scope 传对象 → 存成 "[object Object]"，范围永久丢失，没有 op 能改回来；
//   · scope 传字符串 → 报告页 .join 抛 TypeError，靶标从此打不开报告；
//   · updateVuln 查不到 → {ok:true, updated:false}，和 pocGet 的假成功同形；
//   · cleanup 只改 detail → target/title/priority 被写成 NULL；
//   · 查不存在的靶标的提示词 → 磁盘上多出一个幽灵靶标；
//   · 模板索引把 .github/workflows 当成 nuclei 模板。
// 所以每条都断言**磁盘上的最终状态**或**具体字段**，不是断言「有 ok」。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dshpp-r19-${tag}-`));
  tmpRoots.push(dir);
  return dir;
};
const metaPathOf = (store, id) => path.join(store.root, "engagements", id, "engagement.yaml");
const readYaml = (p) => fs.readFileSync(p, "utf8");

/* ── 1. 写侧归一：字符串能收，非字符串一律拒绝且不留半截目录 ─────── */
section("[1] openEngagement 的 scope 写侧归一");
{
  const store = new RedteamStore(tmp("scope-write"));

  const s1 = store.openEngagement("string-scope-target", "10.0.0.0/8, 192.168.0.0/16", { bindCurrent: false });
  ok(Array.isArray(s1.scope), "传字符串 → 返回的是数组", s1.scope);
  ok(s1.scope.length === 2 && s1.scope[0] === "10.0.0.0/8", "按逗号切开了", s1.scope);
  ok(/scope_cidrs: \[10\.0\.0\.0\/8, 192\.168\.0\.0\/16\]/.test(readYaml(metaPathOf(store, s1.id))),
    "YAML 里落的是数组字面量（不是一整串）", readYaml(metaPathOf(store, s1.id)));

  const s2 = store.openEngagement("array-scope-target", ["172.16.0.0/12"], { bindCurrent: false });
  ok(s2.scope.length === 1 && s2.scope[0] === "172.16.0.0/12", "传数组照旧", s2.scope);

  let threw = null;
  try { store.openEngagement("object-scope-target", [{ cidr: "10.1.0.0/16" }], { bindCurrent: false }) } catch (e) { threw = e }
  ok(threw !== null, "数组里是对象 → 抛错（不再 String() 成 [object Object]）", threw === null ? "没有抛" : String(threw.message));
  ok(threw !== null && /scope/.test(threw.message), "错误文案指明是 scope", threw === null ? null : threw.message);
  ok(!fs.existsSync(path.join(store.root, "engagements", "object-scope-target")),
    "抛错时没有留下半截靶标目录（先验类型再 mkdir）");

  let threw2 = null;
  try { store.openEngagement("number-scope-target", 42, { bindCurrent: false }) } catch (e) { threw2 = e }
  ok(threw2 !== null, "传数字 → 抛错", threw2 === null ? "没有抛" : String(threw2.message));
  ok(!fs.existsSync(path.join(store.root, "engagements", "number-scope-target")), "同样不留目录");

  /* 没给 scope 时沿用旧值，且旧值也要过读侧还原 */
  const again = store.openEngagement("string-scope-target", undefined, { bindCurrent: false });
  ok(again.scope.length === 2, "不给 scope 时沿用库里已有的两个网段", again.scope);
}

/* ── 2. 读侧宽容：历史脏数据不再让报告崩 ─────────────────────────── */
section("[2] 历史脏数据（整串 scope）仍然能出报告");
{
  const store = new RedteamStore(tmp("scope-legacy"));
  /* 先正常建库（report 需要 assets.db），再把 meta 改回 R19 之前的坏形状：
     整串字符串 —— (meta.scope_cidrs || []).join 会抛 TypeError。 */
  const opened = store.openEngagement("legacy-target", undefined, { bindCurrent: false });
  const id = opened.id;
  fs.writeFileSync(metaPathOf(store, id),
    "target_name: 历史靶标\nscope_cidrs: 10.0.0.0/8, 172.16.0.0/12\nstatus: active\n", "utf8");

  const listed = store.listEngagements({ includeStats: false }).find((e) => e.id === id);
  ok(listed !== undefined && Array.isArray(listed.scope), "列表里 scope 是数组（不再是字符串）", listed && listed.scope);
  ok(listed && listed.scope.length === 2, "整串被切回两段", listed && listed.scope);

  const rep = dispatch(store, { op: "report", engagement: id });
  ok(rep.ok === true, "report 不再抛 TypeError", rep.ok === false ? rep.error : "ok");
  ok(/授权范围：10\.0\.0\.0\/8, 172\.16\.0\.0\/12/.test(rep.markdown || ""), "报告里两个网段都在", (rep.markdown || "").split("\n").find((l) => l.includes("授权范围")));

  /* 再写一次（不带 scope）→ 旧脏数据被纠正成数组字面量 */
  store.openEngagement("legacy-target", undefined, { bindCurrent: false });
  ok(/scope_cidrs: \[10\.0\.0\.0\/8, 172\.16\.0\.0\/12\]/.test(readYaml(metaPathOf(store, id))),
    "重开后脏数据被写成数组（自愈）", readYaml(metaPathOf(store, id)));

  /* 已经是 "[object Object]" 的历史值：过滤掉，但不崩 */
  const store2 = new RedteamStore(tmp("scope-object"));
  const obj = store2.openEngagement("obj-target", undefined, { bindCurrent: false });
  fs.writeFileSync(metaPathOf(store2, obj.id),
    "target_name: 对象靶标\nscope_cidrs: [[object Object], 10.9.0.0/16]\nstatus: active\n", "utf8");
  const rep2 = dispatch(store2, { op: "report", engagement: obj.id });
  ok(rep2.ok === true, "含 [object Object] 的历史值也不崩", rep2.ok === false ? rep2.error : "ok");
  ok(!/\[object Object\]/.test(rep2.markdown || ""), "报告里不再出现 [object Object]", (rep2.markdown || "").split("\n").find((l) => l.includes("授权范围")));
}

/* ── 3. 写 op 查不到 id 不再假成功 ──────────────────────────────── */
section("[3] updateVuln 查不到 → 报错（不再是 ok:true + updated:false）");
{
  const store = new RedteamStore(tmp("vuln-update"));
  const { id } = store.openEngagement("vuln-target", undefined, { bindCurrent: false });

  const miss = dispatch(store, { op: "updateVuln", engagement: id, id: 99999, patch: { status: "exploited" } });
  ok(miss.ok === false, "dispatch 层 → ok:false", miss);
  ok(/vuln not found: 99999/.test(miss.error || ""), "错误里带上了查的 id", miss.error);

  let threw = null;
  try { store.updateVuln(id, 99999, { status: "exploited" }) } catch (e) { threw = e }
  ok(threw !== null && /not found/.test(threw.message), "store 层直接抛错", threw === null ? "没有抛" : threw.message);

  /* 好路径没被改坏 */
  const added = store.addVuln(id, { title: "演示漏洞", severity: "high", status: "verified" });
  const hit = dispatch(store, { op: "updateVuln", engagement: id, id: added.id, patch: { status: "exploited" } });
  ok(hit.ok === true && hit.updated === true, "存在的 id 仍然能更新", hit);
}

/* ── 4. cleanup 部分更新不抹字段（工具层与 dispatch 层各一次） ───── */
section("[4] updateCleanup 只改给过的字段");
{
  const store = new RedteamStore(tmp("cleanup-patch"));
  const { id } = store.openEngagement("cleanup-target", undefined, { bindCurrent: false });
  const item = store.addCleanup(id, {
    target: "oa.example.com", location: "/portal", kind: "account",
    title: "默认口令", detail: "admin/admin", priority: "high",
  });
  const itemId = item.cleanup_id !== undefined ? item.cleanup_id : (item.cleanup ? item.cleanup.id : item.id);
  ok(itemId !== undefined, "先建一条清理项作为前提", item);

  /* ⓪ store 层兜底：工具层已经改成「只传给过的键」，但老版本调用方与外部脚本
     仍可能显式传 undefined。这一条是 store 自己的防线，也是唯一能证明
     `&& patch[f] !== undefined` 这半个条件有用的用例（去掉它，下面三条照样绿）。 */
  const rawUndef = store.updateCleanup(id, itemId, {
    detail: "raw-call", target: undefined, title: undefined, priority: undefined,
  });
  ok(rawUndef.cleanup.target === "oa.example.com" && rawUndef.cleanup.title === "默认口令" && rawUndef.cleanup.priority === "high",
    "store 层：显式传 undefined 被当作「没给」，字段原样保留",
    { target: rawUndef.cleanup.target, title: rawUndef.cleanup.title, priority: rawUndef.cleanup.priority });
  ok(rawUndef.cleanup.detail === "raw-call", "store 层：同一调用里给了的字段照常写入", rawUndef.cleanup.detail);

  /* ① 工具层：曾经一次传 6 个键，其中 5 个 undefined */
  const viaTools = store.updateCleanup(id, itemId, { detail: "admin/admin123" });
  ok(viaTools.cleanup.target === "oa.example.com", "store 层：target 没被抹成 NULL", viaTools.cleanup.target);
  ok(viaTools.cleanup.title === "默认口令", "store 层：title 保留", viaTools.cleanup.title);
  ok(viaTools.cleanup.priority === "high", "store 层：priority 保留", viaTools.cleanup.priority);
  ok(viaTools.cleanup.detail === "admin/admin123", "store 层：detail 真的改了", viaTools.cleanup.detail);

  /* ② dispatch 层：面板只发 {status, detail} */
  const viaDispatch = dispatch(store, {
    op: "updateCleanup", engagement: id, id: itemId, status: "done", detail: "已通知客户改密",
  });
  ok(viaDispatch.ok === true, "dispatch 更新成功", viaDispatch);
  ok(viaDispatch.cleanup.target === "oa.example.com", "dispatch 层：target 保留", viaDispatch.cleanup && viaDispatch.cleanup.target);
  ok(viaDispatch.cleanup.location === "/portal", "dispatch 层：location 保留", viaDispatch.cleanup && viaDispatch.cleanup.location);
  ok(viaDispatch.cleanup.priority === "high", "dispatch 层：priority 保留", viaDispatch.cleanup && viaDispatch.cleanup.priority);
  ok(viaDispatch.cleanup.status === "done", "dispatch 层：status 改了", viaDispatch.cleanup && viaDispatch.cleanup.status);

  /* ③ 显式 null 仍然是「清空」——别把修复做成「永远改不掉」 */
  const cleared = dispatch(store, { op: "updateCleanup", engagement: id, id: itemId, priority: null });
  ok(cleared.cleanup && cleared.cleanup.priority === null, "显式传 null 仍然能清空", cleared.cleanup && cleared.cleanup.priority);
  ok(cleared.cleanup && cleared.cleanup.target === "oa.example.com", "清空 priority 不影响 target", cleared.cleanup && cleared.cleanup.target);

  /* ④ 去重键依赖 target：target 一旦被抹成 NULL，键就变成 "kind||location"，
     同一台机器上的第二条会插成重复项。这里用 dedup_key 直接看键里有没有 target。
     （去重只对 status='open' 生效，所以上面那条已经 done 的不参与，另起一对来验。） */
  store.addCleanup(id, { target: "db.example.com", location: "/etc/mysql", kind: "account", title: "库口令", detail: "a" });
  const dup = store.addCleanup(id, { target: "db.example.com", location: "/etc/mysql", kind: "account", title: "库口令", detail: "b" });
  ok(dup.deduped === true, "同 target+location+kind 仍然去重", dup);
  ok(dup.dedup_key === "account|db.example.com|/etc/mysql", "去重键里带着完整的 target（没被抹成空）", dup.dedup_key);
}

/* ── 5. 只读 op 不落盘：查幽灵靶标的提示词不该造目录 ─────────────── */
section("[5] prompts 读路径不建目录");
{
  const store = new RedteamStore(tmp("prompts-ghost"));
  const ghost = path.join(store.root, "engagements", "ghost-target");
  const res = dispatch(store, { op: "prompts", engagement: "ghost-target" });
  ok(res.ok === true, "查不存在的靶标仍然返回 ok（不报错）", res.ok);
  ok(!fs.existsSync(ghost), "磁盘上没有多出幽灵靶标目录", fs.existsSync(ghost));
  ok(Array.isArray(res.roles) && res.roles.length > 0, "返回了角色列表", res.roles && res.roles.length);
  ok(res.roles.every((r) => typeof r.content === "string" && r.content.length > 0),
    "每个角色都有内容（内置默认），不是空字符串", res.roles.map((r) => r.role + ":" + r.content.length));

  /* 真靶标：文件被人删了，读一次不该把它写回来（读不写盘） */
  const { id } = store.openEngagement("real-target", undefined, { bindCurrent: false });
  const planFile = path.join(store.root, "engagements", id, "agents", "plan.md");
  ok(fs.existsSync(planFile), "openEngagement 会把默认提示词落盘（写路径照旧）", planFile);
  fs.rmSync(planFile);
  const after = dispatch(store, { op: "prompts", engagement: id });
  ok(after.ok === true, "读一次成功", after.ok);
  ok(!fs.existsSync(planFile), "读操作没有把删掉的文件写回来", fs.existsSync(planFile));
  const plan = after.roles.find((r) => r.role === "plan");
  ok(plan && plan.content.length > 0, "读不到文件时回内置默认内容", plan && plan.content.length);
}

/* ── 6. 模板索引：.github/workflows 不是 nuclei 模板 ─────────────── */
section("[6] 模板索引排除 CI 配置");
{
  const root = tmp("nuclei");
  const dir = path.join(root, "toolkit", "nuclei-templates");
  fs.mkdirSync(path.join(dir, "http"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
  /* 真模板：顶层 id: */
  fs.writeFileSync(path.join(dir, "http", "real-template.yaml"),
    "id: real-template\n\ninfo:\n  name: Real Template\n  severity: high\n", "utf8");
  /* CI 配置：只有缩进的 step id（这正是被误收的那 4 个文件的样子） */
  fs.writeFileSync(path.join(dir, ".github", "workflows", "tests.yml"),
    "name: Tests\n\non:\n  push:\n\njobs:\n  test:\n    steps:\n      - name: Run\n        id: run-tests\n", "utf8");
  fs.writeFileSync(path.join(dir, ".github", "workflows", "kev-update.yml"),
    "name: KEV Update\n\njobs:\n  kev:\n    steps:\n      - id: kev\n        run: echo\n", "utf8");

  const store = new RedteamStore(root);
  const stats = store.templateStats();
  ok(stats.total === 1, "只数到 1 个真模板（CI 配置不算）", stats.total);
  const found = store.searchTemplates("", 20);
  const paths = (found.items || []).map((i) => String(i.path || i[0] || ""));
  ok(paths.length === 1 && paths[0] === "http/real-template.yaml", "索引里只有真模板", paths);
  ok(!paths.some((p) => p.startsWith(".github/")), "没有 .github/ 开头的条目", paths);
}

/* ── 7. 工具层实调（需要宿主 @deepseek-ai/dsh-tools） ────────────── */
section("[7] 工具层实调：cleanup update / vuln update");
{
  /* tools.js 在 import 时就要解析宿主的 @deepseek-ai/dsh-tools：
     它按 argv / PURGE_DSH_CLI / DSH_HOME / **cwd** 找宿主包。桌面版的宿主包在
     app/dsh 下，所以先按原样 import，失败就把 cwd 临时切到宿主目录重试一次
     （URL 带 ?retry，否则 ESM 会把上一次的失败缓存住）。 */
  const HOST_CWD = "/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh";
  const toolsUrl = "file://" + path.join(PKG, "lib/redteam/tools.js");
  let mod = null;
  try {
    mod = await import(toolsUrl);
  } catch {
    if (fs.existsSync(path.join(HOST_CWD, "package.json"))) {
      const prev = process.cwd();
      try {
        process.chdir(HOST_CWD);
        mod = await import(toolsUrl + "?retry=1");
      } catch { mod = null } finally { process.chdir(prev) }
    }
  }
  if (mod === null || typeof mod.apply !== "function") {
    console.log("  · SKIP：宿主 @deepseek-ai/dsh-tools 解析不到（不算失败，改走结构断言）");
    const src = fs.readFileSync(path.join(PKG, "lib/redteam/tools.js"), "utf8");
    ok(/if \(args\[k\] !== undefined\) patch\[k\] = args\[k\]/.test(src), "结构断言：cleanup 工具只传真的给了的字段");
    ok(/listPrompts\(id, \{ materialize: false \}\)/.test(src), "结构断言：prompt 工具读路径不落盘");
  } else {
    const tools = [];
    const store = new RedteamStore(tmp("tools-live"));
    const opened = store.openEngagement("tools-target", undefined, { bindCurrent: false });
    const id = opened.id;
    const item = store.addCleanup(id, {
      target: "app.example.com", location: "/login", kind: "account",
      title: "弱口令", detail: "root/root", priority: "high",
    });
    const itemId = item.cleanup_id !== undefined ? item.cleanup_id : (item.cleanup ? item.cleanup.id : item.id);
    const vuln = store.addVuln(id, { title: "工具层漏洞", severity: "high", status: "verified" });

    const ctx = {
      tools: { register: (t) => tools.push(t) },
      get: (n) => (n === "redteam" ? store : undefined),
      redteam: store,
      effect: () => {}, on: () => () => {},
      logger: { warn() {}, info() {}, error() {} },
      subagents: { listChildren: async () => ({ children: [] }) },
    };
    mod.apply(ctx);
    const exec = { agent: { session: { id: "MAIN" } } };
    const call = async (name, args) => {
      const t = tools.find((x) => x.name === name);
      if (t === undefined) return { ok: false, error: "tool not registered: " + name };
      return JSON.parse(await t.execute(args, exec));
    };

    const upd = await call("redteam_cleanup", { action: "update", id: itemId, detail: "root/root -> 已改密" });
    ok(upd.ok === true, "工具 update 成功", upd);
    ok(upd.cleanup && upd.cleanup.target === "app.example.com", "工具层：target 没被抹掉", upd.cleanup && upd.cleanup.target);
    ok(upd.cleanup && upd.cleanup.title === "弱口令", "工具层：title 保留", upd.cleanup && upd.cleanup.title);
    ok(upd.cleanup && upd.cleanup.priority === "high", "工具层：priority 保留", upd.cleanup && upd.cleanup.priority);

    const badVuln = await call("redteam_vuln_update", { id: 99999, status: "exploited" });
    ok(badVuln.ok === false, "工具层：更新不存在的漏洞 → ok:false", badVuln);
    ok(badVuln.error_kind === "bad_input", "工具层：归类为 bad_input（模型会先 list 再重试）", badVuln.error_kind);

    const goodVuln = await call("redteam_vuln_update", { id: vuln.id, status: "exploited" });
    ok(goodVuln.ok === true, "工具层：存在的漏洞仍然能更新", goodVuln);

    const noArg = await call("redteam_cleanup", { action: "update", detail: "x" });
    ok(noArg.ok === false && /需要 id/.test(noArg.error || ""), "工具层：缺 id 给出可执行的提示", noArg);
  }
}

for (const dir of tmpRoots) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
}

console.log("\n" + (fail === 0 ? "全部通过" : "有失败") + `：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
