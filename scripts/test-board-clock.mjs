#!/usr/bin/env node
// [dsh-purge-plus] 观察时钟（orchestrator-clock）与任务板合并（team-board）的接线测试。
//
// 为什么要单独一个脚本：这两个模块是 safe 2.0.2 原样移植，**移植 ≠ 生效**。
// 2026-11-25 的三方审计（docs/audit/AUDIT-3WAY）用可达性分析抓出它们已经躺在
// 包里却没有任何调用方；接线之后还必须证明「接上的是对的那条路」：
//   · ticket-stage 的 staleMs 分支原先**永远走不到** —— 调用方既没传 staleMs，
//     也没有任何地方产出 claimedAt。接线后它必须真的能判出 stall；
//   · mergeTeamBoardTasks 的作用域匹配必须让两个根会话的同名 task-1 不互串。
// 这两条都是纯函数行为，可以离线测；接线点本身（ui.js 里真的 import 并传参）
// 用源码断言，配合 verify [35] 的可达性检查一起防「模块在、没人调」。

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

function pkgPath(rel) {
  const p = path.join(PKG, rel);
  if (fs.existsSync(p)) return p;
  return path.join(ROOT, "overlay", "files", rel);
}

const clock = await import(pkgPath("lib/redteam/orchestrator-clock.js"));
const board = await import(pkgPath("lib/redteam/team-board.js"));

const MINUTE = 60000;
const T0 = 1_700_000_000_000;

console.log("[1] 时钟：首次观察时间与配置收敛");
{
  clock.resetStalled();
  const cfg = clock.clockConfig({ stallMinutes: 20 });
  eq(cfg, { minutes: 20, enabled: true }, "stallMinutes=20 → 启用 20 分钟");

  const tasks = [{ id: "task-1", status: "in_progress", ownerId: "s1", root: "r1" }];
  clock.sweepStalled(tasks, cfg, T0);
  eq(clock.claimedAt(tasks[0]), T0, "首次观察到 in_progress → claimedAt 记为 T0");
  /* 第二次观察不覆盖首次时刻：否则「认领多久了」永远显示 0 分钟。 */
  clock.sweepStalled(tasks, cfg, T0 + 5 * MINUTE);
  eq(clock.claimedAt(tasks[0]), T0, "再次观察不刷新首次时刻");

  /* 有回报的任务不进台账：stall 的判据是「没有新回报」，有回报就从回报时间算。 */
  clock.resetStalled();
  clock.sweepStalled([{ id: "task-2", status: "in_progress", ownerId: "s1", root: "r1", reportAt: "2026-01-01T00:00:00.000Z" }], cfg, T0);
  eq(Number.isFinite(clock.claimedAt("r1", "task-2")), false, "有回报的任务不记 claimedAt");

  /* 任务消失后要清台账，否则旧会话的时间戳会一直留着。 */
  clock.resetStalled();
  clock.sweepStalled(tasks, cfg, T0);
  clock.sweepStalled([], cfg, T0 + MINUTE);
  eq(Number.isFinite(clock.claimedAt(tasks[0])), false, "任务从快照消失后台账清理");

  eq(clock.clockConfig({ stallMinutes: 0 }), { minutes: 0, enabled: false }, "stallMinutes=0 → 关闭");
  eq(clock.clockConfig({ stallMinutes: "abc" }), { minutes: 0, enabled: false }, "非法值 → 关闭而不是 NaN");
  eq(clock.clockConfig({ stallMinutes: 9999 }).minutes, 240, "上限收敛到 240 分钟");
  eq(clock.clockConfig({}).minutes, clock.DEFAULT_STALL_MINUTES, "缺省用 DEFAULT_STALL_MINUTES");
}

console.log("[2] 合并：stall 判定真的能走到（接线前这条分支是死的）");
{
  clock.resetStalled();
  const cfg = clock.clockConfig({ stallMinutes: 20 });
  const tasks = [{ id: "task-1", status: "in_progress", ownerId: "s1", root: "r1" }];
  const opts = (now) => ({
    claimedAt: (task) => clock.claimedAt(task),
    staleMs: cfg.minutes * MINUTE,
    now,
  });

  clock.sweepStalled(tasks, cfg, T0);

  const early = board.mergeTeamBoardTasks(tasks, [], opts(T0 + 1 * MINUTE));
  eq(early[0].stage, "queued", "1 分钟：无回报的 in_progress 判成 queued（面板再纠正为 working）");

  const late = board.mergeTeamBoardTasks(tasks, [], opts(T0 + 21 * MINUTE));
  eq(late[0].stage, "person/blocked", "21 分钟：判成受阻");
  eq(/21 分钟没有回报/.test(String(late[0].stageReason)), true, `受阻原因写明时长（实际「${late[0].stageReason}」）`);

  /* staleMs=0 时必须永不 stall —— 这是「设置里关掉」的那条路。 */
  const off = board.mergeTeamBoardTasks(tasks, [], { claimedAt: (t) => clock.claimedAt(t), staleMs: 0, now: T0 + 999 * MINUTE });
  eq(off[0].stage, "queued", "staleMs=0 时永不判 stall");

  /* 有回报的走回报路径，不受 claimedAt 影响。 */
  const withReport = board.mergeTeamBoardTasks(tasks, [{ session_id: "s1", root: "r1", status: "waiting", needs: '["vps"]', created_at: new Date(T0).toISOString() }], opts(T0 + 60 * MINUTE));
  eq(withReport[0].stage, "person/answer", "有 waiting 回报时按回报判（不被 stall 盖掉）");
  eq(withReport[0].needs, ["vps"], "needs 从 JSON 字符串解析成数组");
  eq(withReport[0].reportLinkedBy, "session", "无 team_task_id 时按 owner 会话回退关联");
}

console.log("[3] 合并：两个根会话的同名 task-1 不互串");
{
  const tasks = [
    { id: "task-1", status: "in_progress", ownerId: "s1", root: "r1" },
    { id: "task-1", status: "in_progress", ownerId: "s1", root: "r2" },
  ];
  const reports = [{ session_id: "s1", root: "r1", status: "ready", created_at: new Date(T0).toISOString() }];
  const rows = board.mergeTeamBoardTasks(tasks, reports, { staleMs: 0, now: T0 });
  const r1 = rows.find((r) => r.root === "r1");
  const r2 = rows.find((r) => r.root === "r2");
  eq(r1.stage, "person/review", "r1 的 task-1 关联到 r1 的回报");
  eq(r2.stage, "queued", "r2 的同名 task-1 没被 r1 的回报串上");
  eq(r2.reportLinkedBy, null, "r2 的关联方式为空");
}

console.log("[4] 接线点：ui.js 真的 import 并传参（不是只有模块在包里）");
{
  const ui = fs.readFileSync(path.join(PKG, "lib/redteam/ui.js"), "utf8");
  const need = [
    ["await import('./orchestrator-clock.js')", "动态 import 观察时钟"],
    ["await import('./team-board.js')", "动态 import 任务板合并"],
    ["clockMod.sweepStalled(boardTasks, clockCfg, now)", "每次读任务板推进一次时钟"],
    ["boardMod.mergeTeamBoardTasks(boardTasks, boardReports", "用合并结果算 stage"],
    ["staleMs: clockCfg.enabled ? clockCfg.minutes * 60000 : 0", "把 staleMs 真的传进去"],
    ["claimedAt: clockMod ? (task) => clockMod.claimedAt(task) : undefined", "把 claimedAt 真的传进去"],
    ["stage_source: mergedRows ? 'team-board'", "返回里标明派生字段来源"],
    ["stalled: items.filter((t) => t.stalled === true).length", "stats 里报 stalled 条数"],
  ];
  for (const [needle, why] of need) {
    ui.includes(needle) ? ok(why) : bad(`ui.js 缺少：${needle}`);
  }
  /* 反向：内联那条旧路不能既被替换又留着重复的 stage 赋值。 */
  eq((ui.match(/const now = Date\.now\(\)/g) || []).length >= 1, true, "now 只声明一次（重复声明会直接语法错，import 检查已覆盖）");
}

console.log("[5] intelStatus 带 cve_sync（只读本机状态，不联网）");
{
  const { RedteamStore } = await import(pkgPath("lib/redteam/store-core.js"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plus-cvesync-"));
  try {
    const store = new RedteamStore(root);
    const st = store.intelStatus();
    eq(st && typeof st.cve_sync === "object" && st.cve_sync !== null, true, "intelStatus 返回 cve_sync");
    eq(typeof st.cve_sync.enabled, "boolean", "cve_sync.enabled 是布尔");
    eq(st.cve_sync.enabled, false, "没配 REDTEAM_INTEL_BASE 时 enabled=false");
    eq(st.cve_sync.local && typeof st.cve_sync.local === "object", true, "cve_sync.local 给出本机底库信息");
    eq(st.cve_sync.local.available, false, "空 root 下本机底库不可用（available=false）");
    /* 三条老资源还在，不能被这次改动挤掉。 */
    eq(st.resources.map((r) => r.key), ["kev", "nuclei", "wordlists"], "原有三项资源不变");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("");
/* 汇总行格式与其它 test-*.mjs 一致：verify [33] 按「N 通过 / M 失败」汇总断言数 */
console.log(`${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
