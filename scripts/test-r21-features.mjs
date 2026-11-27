#!/usr/bin/env node
// [dsh-purge-plus] R21 回归：五条「功能面对等」的实装。
//
// 这五条过去被记作「部分覆盖」，共同点是：**能力在，但字段/交互缺一块**，
// 于是按 safe 写的调用方拿不到它以为存在的东西。
//   ① scoreReport 默认带 report（safe 恒带）—— 由 verify [3x] 组守，这里只做交叉确认
//   ② platformConfigGet().config 的 4 个 templates* 默认键
//   ③ 环境适配页的计数：intelStatus 带 templates / kev 两段摘要
//   ④ 并发名额：waiting/blocked 的智能体让出名额（面板与工具层同口径）
//   ⑤ 会话关系图：宿主的活动态 + 子代理树并进图里
//
// 纪律与 R19/R20 相同：断言**具体字段与数值**，不断言「有 ok」。

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
const { dispatch, RedteamStore } = await import(path.join(PKG, "lib/redteam/store-core.js"));
const platform = await import(path.join(PKG, "lib/redteam/platform-config.js"));
const live = await import(path.join(PKG, "lib/redteam/live-views.js"));

const tmpRoots = [];
const tmp = (tag) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dshpp-r21-${tag}-`));
  tmpRoots.push(dir);
  return dir;
};
const fresh = (tag) => {
  const store = new RedteamStore(tmp(tag));
  const eng = store.openEngagement(`${tag}-靶标`, "10.0.0.0/8", { bindCurrent: false });
  return { store, id: eng.id };
};
const call = (store, id, body) => dispatch(store, Object.assign({ engagement: id }, body));

try {
  /* ── ① scoreReport 默认带 report ─────────────────────────────────── */
  section("[1] scoreReport 默认带 report（safe 同形），且与 reportV2 同源");
  {
    const { store, id } = fresh("report");
    call(store, id, { op: "addVuln", title: "后台弱口令", severity: "high" });
    const r = store.scoreReport(id);
    ok(r.report !== undefined && r.report !== null, "默认返回 report 对象", Object.keys(r));
    ok(r.report && r.report.summary !== undefined, "report.summary 存在");
    ok(r.report && Array.isArray(r.report.stage_summary), "report.stage_summary 是数组");
    ok(r.report && r.report.asset_proof !== undefined, "report.asset_proof 存在");
    const v2 = store.reportV2(id);
    ok(r.report && v2 && r.report.summary && v2.summary
      && r.report.summary.points === v2.summary.points, "两处总分一致（不出现 350 / 320）",
      { a: r.report && r.report.summary && r.report.summary.points, b: v2.summary && v2.summary.points });
    const legacy = store.scoreReport(id, { layout: "legacy" });
    ok(legacy.report === undefined, "layout:'legacy' 仍可显式退回不带 report", Object.keys(legacy));
    /* safe 契约：summary 是计分汇总（count/withRequests/…），不只是报告字段 */
    ok(r.report.summary.count !== undefined && r.report.summary.withRequests !== undefined,
      "report.summary 带计分汇总键（safe 同形）", Object.keys(r.report.summary));
    /* safe 契约：四个阶段恒有行、stage_tables 四个键恒在 */
    ok(Array.isArray(r.report.stage_summary) && r.report.stage_summary.length >= 4,
      "stage_summary 四个阶段恒有行", r.report.stage_summary && r.report.stage_summary.length);
    const fourKeys = ["internet", "boundary", "internal", "target"];
    ok(fourKeys.every((k) => Array.isArray(r.report.stage_tables[k])),
      "stage_tables 四个键恒在（空阶段是空数组）", Object.keys(r.report.stage_tables));
  }

  /* ── ①b safe 的包装参数（item / proof）─────────────────────────── */
  section("[1b] addCleanup / addDataProof 接受 safe 的 {item} / {proof} 包装");
  {
    const { store, id } = fresh("wrap");
    const c1 = call(store, id, { op: "addCleanup", item: { kind: "webshell", title: "T", target: "10.0.0.9" } });
    ok(c1.ok === true, "addCleanup 收 {item:{…}}", c1);
    const d1 = call(store, id, {
      op: "addDataProof",
      proof: { row_count: 12, fields: "姓名/手机号", target: "10.0.0.9", source: "user", interface: "api" },
    });
    ok(d1.ok === true, "addDataProof 收 {proof:{…}}", d1);
    /* 直接传也要继续工作 */
    const c2 = call(store, id, { op: "addCleanup", kind: "file", title: "T2" });
    ok(c2.ok === true, "addCleanup 直接传仍然可用", c2);
  }

  /* ── ② 4 个 templates* 默认键 ────────────────────────────────────── */
  section("[2] platformConfigGet().config 带 4 个 templates* 默认键");
  {
    const root = tmp("cfg");
    const summary = platform.platformSummary(root);
    const cfg = summary.config || {};
    ok(cfg.templatesRefreshedAt === 0, "templatesRefreshedAt 默认 0", cfg.templatesRefreshedAt);
    ok(cfg.templatesCommit === "", "templatesCommit 默认空串", cfg.templatesCommit);
    ok(cfg.templatesCount === 0, "templatesCount 默认 0", cfg.templatesCount);
    ok(cfg.templatesLastError === "", "templatesLastError 默认空串", cfg.templatesLastError);
    /* 保存后必须落盘，且只改给的键 */
    platform.savePlatformConfig({ templatesRefreshedAt: 1730000000000, templatesCount: 14481, templatesCommit: "abc1234" }, root);
    const after = platform.loadPlatformConfig(root);
    ok(after.templatesRefreshedAt === 1730000000000, "刷新时间写进配置", after.templatesRefreshedAt);
    ok(after.templatesCount === 14481, "模板计数写进配置", after.templatesCount);
    ok(after.templatesCommit === "abc1234", "提交号写进配置", after.templatesCommit);
    ok(after.templatesLastError === "", "没给的键保持原值（不被清空成 undefined）", after.templatesLastError);
    platform.savePlatformConfig({ templatesLastError: "git pull failed" }, root);
    const after2 = platform.loadPlatformConfig(root);
    ok(after2.templatesLastError === "git pull failed", "错误信息写进配置", after2.templatesLastError);
    ok(after2.templatesCount === 14481, "只改错误信息时计数没被重置", after2.templatesCount);
  }

  /* ── ③ intelStatus 的 templates / kev 摘要 ───────────────────────── */
  section("[3] intelStatus 带 templates / kev 两段计数摘要");
  {
    const { store } = fresh("intel");
    /* 造一个模板目录：3 个 yaml + 1 个非 yaml + 1 层子目录里的 yaml */
    const dir = path.join(store.root, "toolkit", "nuclei-templates")
    fs.mkdirSync(path.join(dir, "http"), { recursive: true });
    fs.writeFileSync(path.join(dir, "a.yaml"), "id: a\n");
    fs.writeFileSync(path.join(dir, "b.yml"), "id: b\n");
    fs.writeFileSync(path.join(dir, "readme.txt"), "not a template\n");
    fs.writeFileSync(path.join(dir, "http", "c.yaml"), "id: c\n");
    /* 造一份 KEV */
    fs.mkdirSync(path.join(store.root, "intel"), { recursive: true });
    fs.writeFileSync(path.join(store.root, "intel", "kev.json"), JSON.stringify({
      dateReleased: new Date().toISOString(),
      vulnerabilities: [{ cveID: "CVE-2021-44228" }, { cveID: "CVE-2023-4966" }],
    }))
    const st = store.intelStatus();
    ok(st.templates !== undefined && st.kev !== undefined, "两个摘要对象都在", Object.keys(st));
    ok(st.templates.count === 3, "模板计数 = 3 个 yaml（不含 txt）", st.templates.count);
    ok(st.templates.dir !== null, "模板目录被识别", st.templates.dir);
    ok(typeof st.templates.age_hours === "number" || st.templates.age_hours === null, "age_hours 是数字或 null", st.templates.age_hours);
    ok(st.templates.owned === true, "插件自己那份标 owned", st.templates.owned);
    ok(st.kev.count === 2, "KEV 条目数 = 2", st.kev.count);
    ok(st.kev.available === true, "KEV 可用", st.kev.available);
    ok(String(st.kev.note || "").length > 0, "KEV 带一句说明", st.kev.note);
    /* 缓存不能把「文件变了」也缓存住 */
    fs.writeFileSync(path.join(store.root, "intel", "kev.json"), JSON.stringify({
      dateReleased: new Date().toISOString(), vulnerabilities: [{ cveID: "CVE-2021-44228" }],
    }))
    const st2 = store.intelStatus();
    ok(st2.kev.count === 1, "KEV 文件变了计数跟着变（缓存按 mtime/size）", st2.kev.count);
    /* 老调用方只看 resources[]，不能被新字段破坏 */
    ok(Array.isArray(st.resources) && st.resources.length === 3, "resources[] 仍是三项", st.resources.length);
  }

  /* ── ④ 并发名额：挂起的让出名额 ──────────────────────────────────── */
  section("[4] 并发名额：waiting/blocked 的智能体让出名额");
  {
    const children = [
      { id: "c1", parent: "r1", label: "跑着的", activity: "running" },
      { id: "c2", parent: "r1", label: "在等人给 key", activity: "running" },
      { id: "c3", parent: "r1", label: "已经闲了", activity: "idle" },
    ]
    const parkedSet = new Set(["c2"])
    const split = live.splitRunningParked(children, (parent, id) => parent === "r1" && parkedSet.has(id));
    ok(split.running.length === 1, "running 只算真在跑的", split.running.map((c) => c.id));
    ok(split.parked.length === 1, "parked 单独一列", split.parked.map((c) => c.id));
    ok(split.running[0].id === "c1", "让出名额的是 c2 不是 c1", split.running[0]);
    /* 空闲的不进任何一列（used 只数 running） */
    ok(split.running.concat(split.parked).every((c) => c.id !== "c3"), "idle 不算占用");
    /* 没有挂起时行为不变 */
    const plain = live.splitRunningParked(children, () => false);
    ok(plain.running.length === 2 && plain.parked.length === 0, "没有挂起时 running 是 2", plain);
  }

  /* ── ⑤ 会话图：活动态 + 子代理树 ─────────────────────────────────── */
  section("[5] 会话关系图：活动态与子代理树并进图里");
  {
    const base = {
      engagements: [{ id: "e1", name: "靶标一" }],
      sessions: [
        { id: "s1", short: "s1", engagement: "e1", name: "", at: "2026-11-27T10:00:00Z", waiting: null },
        { id: "s2", short: "s2", engagement: "e1", name: "", at: "2026-11-27T10:01:00Z", waiting: { status: "waiting" } },
      ],
      count_by_engagement: { e1: 2 },
    }
    const list = [
      { id: "s1", header: { activity: "running", parentSession: null, label: "主会话" } },
      { id: "s2", header: { activity: "idle", parentSession: null, label: "另一个" } },
      /* 子代理：自己没绑靶标，父是 s1 */
      { id: "k1", header: { activity: "running", parentSession: "s1", label: "子代理-侦察" } },
      { id: "k2", header: { activity: "unknown", parentSession: "k1", label: "孙代理" } },
    ]
    const merged = live.mergeSessionGraphLive(base, list);
    const byId = new Map(merged.sessions.map((s) => [s.id, s]));
    ok(merged.sessions.length === 4, "绑定 2 个 + 后代 2 个 = 4", merged.sessions.map((s) => s.id));
    ok(byId.get("k1") && byId.get("k1").parent === "s1", "子代理的 parent 指向父会话", byId.get("k1"));
    ok(byId.get("k1") && byId.get("k1").engagement === "e1", "子代理继承祖先的靶标", byId.get("k1") && byId.get("k1").engagement);
    ok(byId.get("k2") && byId.get("k2").depth === 2, "孙代理 depth=2", byId.get("k2") && byId.get("k2").depth);
    ok(byId.get("s1").activity === "running", "活动态来自宿主", byId.get("s1").activity);
    ok(byId.get("k2").activity === "unknown", "缺失活动态记 unknown 而不是 idle", byId.get("k2").activity);
    ok(byId.get("s2").waiting !== null, "绑定会话的 waiting 保留", byId.get("s2").waiting);
    ok(merged.activity_counts.running === 2 && merged.activity_counts.idle === 1 && merged.activity_counts.unknown === 1,
      "活动态计数正确", merged.activity_counts);
    /* 宿主里查不到的绑定会话：仍要出现，标 live:false */
    const orphan = live.mergeSessionGraphLive({ engagements: [], sessions: [{ id: "sx", engagement: "e1" }] }, []);
    ok(orphan.sessions.length === 1 && orphan.sessions[0].live === false, "宿主里没有的绑定会话标 live:false", orphan.sessions[0]);
    /* 300 上限：主干优先，后代不会把绑定会话挤掉 */
    const many = [];
    for (let i = 0; i < 400; i += 1) many.push({ id: "k" + i, header: { activity: "running", parentSession: "s1" } });
    const capped = live.mergeSessionGraphLive(base, list.concat(many));
    ok(capped.sessions.length === 300, "节点封顶 300", capped.sessions.length);
    ok(capped.sessions[0].id === "s1" && capped.sessions[1].id === "s2", "绑定会话排在最前，没被后代挤掉",
      capped.sessions.slice(0, 3).map((s) => s.id));
  }

  /* ── ⑥ 前端：四处交互真的进了产物 ────────────────────────────────── */
  section("[6] 会话图前端：缩放 / 暂停 / 全屏 / 活动态筛选都在产物里");
  {
    const client = fs.readFileSync(path.join(PKG, "client.js"), "utf8");
    ok(client.includes("rt-sm-activity"), "活动态下拉在产物里");
    ok(/setZoom\(/.test(client), "缩放状态在产物里");
    ok(/requestFullscreen/.test(client), "全屏在产物里");
    ok(/setPaused\(/.test(client) && /5000/.test(client), "暂停与 5 秒轮询在产物里");
    ok(client.includes("is-subagent"), "子代理节点样式在产物里");
    /* 缩放必须同时改外层尺寸，否则缩小时右下角留空白 */
    ok(/Math\.round\(graph\.width \* zoom\)/.test(client), "缩放同时改外层尺寸");
    /* 缩放不为 1 时拖拽必须按 zoom 折算：节点坐标在 scale 层里，clientX 是屏幕像素 */
    ok(/const dx = \(ev\.clientX - drag\.startX\) \/ scale/.test(client), "拖拽位移按 zoom 折算（缩放后不偏）");
    /* 滚轮缩放必须走原生 non-passive 监听器，否则 preventDefault 无效 */
    ok(/addEventListener\('wheel', onWheel, \{ passive: false \}\)/.test(client), "滚轮缩放用非 passive 原生监听器");
  }
} finally {
  for (const dir of tmpRoots) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响结论 */ }
  }
}

console.log(`\nR21：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
