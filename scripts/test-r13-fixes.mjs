#!/usr/bin/env node
// [dsh-purge-plus] R13 修复的回归：模板 CVE 索引、agent_report 任务关联、
// 漂移判定、回滚前刷新备份、0 字节 bak。
//
// 五条都是「静默错」：不报错、数字看着正常，但结论是错的。所以断言全部落在
// 「同一输入下结论是否与事实一致」，而不是「函数有没有被调用」。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 既能在仓库里跑（dist/build/package），也能在**已安装的包里**跑（脚本所在包的根）——
   发布包带 test-*.mjs，故障注入门禁还会把它整份复制到临时目录再跑一遍。 */
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m) => { fail++; console.error("  ✗ " + m); };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(`${m}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`));

const { RedteamStore } = await import(path.join(PKG, "lib", "redteam", "store-core.js"));
const verifyMod = await import(path.join(PKG, "lib", "core", "verify.mjs"));
const core = await import(path.join(PKG, "lib", "core.js"));

console.log("[1] PA-06：CVE 只写在正文里的模板，按编号也要能搜到");
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "r13-tpl-"));
  try {
    const dir = path.join(root, "toolkit", "nuclei-templates", "http");
    fs.mkdirSync(dir, { recursive: true });
    /* 真实模板库就是这样：文件名里没有 CVE 编号，只在正文/描述里提到 */
    fs.writeFileSync(path.join(dir, "apache-solr-log4j-rce.yaml"),
      "id: apache-solr-log4j-rce\n\ninfo:\n  name: Apache Solr Log4j RCE\n  severity: critical\n  tags: log4j,rce\n\n# CVE-2021-44228\n", "utf8");
    fs.writeFileSync(path.join(dir, "CVE-2022-1111-x.yaml"),
      "id: cve-2022-1111\ninfo:\n  name: Some CVE\n  severity: high\n  tags: x\n", "utf8");
    const store = new RedteamStore(root);
    const got = store.searchTemplates("CVE-2021-44228");
    eq(got.matched, 1, "按 CVE-2021-44228 命中 1 条（文件名里没有这个编号）");
    eq(got.items[0].path, "http/apache-solr-log4j-rce.yaml", "命中的是 log4j 那条");
    eq(typeof got.items[0].cves, "string", "返回行里带 cves 字段");
    const st = store.templateStats();
    eq(st.cve, 2, "stats.cve = 有 CVE 列的模板数（2 条都有）");
    eq(st.cve_ids, 2, "stats.cve_ids = 去重后的编号个数");
    /* 反向：不该命中的不能被 cves 带出来 */
    eq(store.searchTemplates("CVE-1999-0001").matched, 0, "不存在的编号仍然 0 条");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("[2] PA-03/32：回报里点名的任务 id 一路落到库、并能按任务分组");
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "r13-ar-"));
  try {
    const store = new RedteamStore(root);
    const eng = store.openEngagement({ name: "r13", scope: [] });
    const id = eng && eng.id ? eng.id : String(eng);

    const parsed = store.parseAgentReport('redteamReport {"status":"waiting","needs":["vps"],"task_id":"task-3"}');
    eq(parsed.team_task_id, "task-3", "解析出 task_id → team_task_id");
    const parsed2 = store.parseAgentReport('redteamReport {"status":"progress","team_task_id":"task-9"}');
    eq(parsed2.team_task_id, "task-9", "也认 team_task_id 写法");
    const parsed3 = store.parseAgentReport('redteamReport {"status":"progress","team_task_id":"   "}');
    eq(parsed3.team_task_id, undefined, "空白 id 归一成 undefined（不写空串进库）");

    store.recordAgentReport(id, { session_id: "s1", parent_session: "r1", status: "waiting", needs: parsed.needs, team_task_id: parsed.team_task_id });
    store.recordAgentReport(id, { session_id: "s1", parent_session: "r1", status: "progress", team_task_id: "task-4" });
    eq(store.latestAgentReports(id, "r1", { byTask: true }).map((r) => r.team_task_id), ["task-4", "task-3"],
      "byTask：同一会话的两张卡各留一条");
    eq(store.latestAgentReports(id, "r1").map((r) => r.team_task_id), ["task-4"],
      "默认按会话：只留最新一条（旧行为不变）");

    /* team-board.js 的精确匹配分支现在有真数据可用了 */
    const board = await import(path.join(PKG, "lib", "redteam", "team-board.js"));
    const rows = board.mergeTeamBoardTasks(
      [{ id: "task-3", status: "in_progress", ownerId: "s1", root: "r1" }],
      [{ session_id: "s1", root: "r1", team_task_id: "task-3", status: "waiting", created_at: new Date().toISOString() }],
      { now: Date.now() },
    );
    eq(rows[0].reportLinkedBy, "task", "任务板按 task id 精确关联（不再是启发式）");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("[3] CM-01/03：漂移不能报成 skipped，多目标半漂移是 partial");
{
  const base = { applied: 0, already: 0, missing: 0, notFound: 0, keyCount: 1 };
  eq(verifyMod.rollupPatchStatus({ ...base }), "skipped", "没有漂移时仍是 skipped（旧行为不变）");
  eq(verifyMod.rollupPatchStatus({ ...base, drifted: 1 }), "drifted", "有漂移 → drifted，不是 skipped");
  eq(verifyMod.rollupPatchStatus({ ...base, applied: 1, drifted: 1 }), "partial", "一个目标打上、一个漂移 → partial");
  eq(verifyMod.rollupPatchStatus({ ...base, applied: 1 }), "applied", "无漂移时 applied 仍是 applied");
  eq(verifyMod.rollupPatchStatus({ ...base, already: 1, drifted: 1 }), "already", "已经打上的 + 漂移 → 保持 already（already 优先）");
  /* drifted 不能被当成软成功 */
  eq(verifyMod.isPatchResultSoftOk({ status: "drifted" }), false, "drifted 不是软成功");
}

console.log("[4] CM-04：用户触发回滚前会先刷新过期备份");
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "r13-rv-"));
  try {
    const ai = path.join(root, "ai");
    const file = path.join(ai, "dsh-user-approval", "lib", "index.js");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    /* 内容里不能出现任何补丁的 replace 文本，否则会被判成「我们打过的」——
       这是 fixture 的坑，上一版我用 "OFFICIAL" 就踩了。 */
    fs.writeFileSync(file, "ZZZ_NEW_HOST_022", "utf8");
    fs.writeFileSync(file + ".dshpurge.bak", "ZZZ_OLD_HOST_021", "utf8");
    const out = await core.revertAll(ai);
    const after = fs.readFileSync(file, "utf8");
    eq(after, "ZZZ_NEW_HOST_022", "回滚没有把新版宿主写回旧版");
    eq(out.downgradeBlocked, [file], "被判定成「还原会降级」，记在 downgradeBlocked 里");
    eq(fs.existsSync(file + ".dshpurge.bak"), false, "bak 已被消费掉（没有残留）");

    /* 反向：文件确实带我们的替换文本时，必须照常还原。 */
    const file2 = path.join(ai, "dsh-user-approval", "lib", "index.js");
    fs.writeFileSync(file2, 'return "allowed-once";\n\t\t// [dsh-purge] approval bypass: every approval request is auto-granted', "utf8");
    fs.writeFileSync(file2 + ".dshpurge.bak", "ZZZ_PRISTINE_ORIGINAL", "utf8");
    const out2 = await core.revertAll(ai);
    eq(fs.readFileSync(file2, "utf8"), "ZZZ_PRISTINE_ORIGINAL", "带我们痕迹的文件正常还原");
    eq(out2.reverted.includes(file2), true, "还原记在 reverted 里");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("[5] CM-10：0 字节 bak 不再永久毒化备份");
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "r13-bak-"));
  try {
    const ai = path.join(root, "ai");
    const file = path.join(ai, "dsh-user-approval", "lib", "index.js");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "ORIGINAL CONTENT", "utf8");
    /* 模拟「崩在占位与写入之间」 */
    fs.writeFileSync(file + ".dshpurge.bak", "", "utf8");
    const out = await core.backupAll(ai);
    eq(out.errors, [], "没有报错");
    eq(fs.statSync(file + ".dshpurge.bak").size > 0, true, "空 bak 被重写成真备份");
    eq(fs.readFileSync(file + ".dshpurge.bak", "utf8"), "ORIGINAL CONTENT", "备份内容就是当前文件");
    eq(out.made.length >= 1, true, "backupAll 报出了它做的备份（不再静默返回 0 条）");

    /* 已经有效的大 bak 不能被无谓重写 */
    fs.writeFileSync(file + ".dshpurge.bak", "EARLIER OFFICIAL", "utf8");
    const again = await core.backupAll(ai);
    eq(fs.readFileSync(file + ".dshpurge.bak", "utf8"), "EARLIER OFFICIAL", "有效备份保持不动");
    eq(again.made.length, 0, "第二次没有重复备份");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/* 汇总行格式与其它 test-*.mjs 一致：verify [33] 按「N 通过 / M 失败」汇总断言数 */
console.log(`${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
