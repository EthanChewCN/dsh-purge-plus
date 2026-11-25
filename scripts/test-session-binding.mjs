#!/usr/bin/env node
// [dsh-purge-plus] P1 会话绑定层：行为回归（R17）
//
// 为什么单独一个脚本：验收 [13] 一直声明「P1 会话绑定层 / P2 会话关系图」由
// test-silent-failures.mjs 守着，但那条脚本里**一条 sessionBinding / setSessionBinding /
// sessionGraph 的断言都没有** —— 声明与测试对不上，正是这一轮在 [25] 上抓到的同形缺陷。
//
// 这里补的是「写路径」：绑定、覆盖、解绑、悬空绑定清理、坏文件容错、图里能看到。
// 每一条都落在**结论**上（读完再读一次、图里有没有这个节点），不是「函数被调用过」。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 既能在仓库里跑（dist/build/package），也能在**已安装的包里**跑（脚本所在包的根）。 */
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m) => { fail++; console.error("  ✗ " + m); };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(`${m}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`));

const { RedteamStore, dispatch } = await import(path.join(PKG, "lib", "redteam", "store-core.js"));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "p1-binding-"));
const store = new RedteamStore(root);
const eng = store.openEngagement("外网扫描", ["10.0.0.0/24"]);
const eng2 = store.openEngagement("内网横向", ["192.168.1.0/24"]);
const SESS = path.join(root, "sessions.json");

console.log("[1] 绑定 → 读回：写进去的必须能原样读出来");
{
  eq(store.setSessionBinding("s1", eng.id, "外网扫描"), true, "setSessionBinding 返回 true");
  eq(store.sessionBinding("s1"), eng.id, "sessionBinding(s1) 读回同一个靶标");
  const all = store.sessionBindings();
  eq(all.s1 && all.s1.engagement, eng.id, "sessionBindings() 里有这条");
  eq(all.s1 && all.s1.name, "外网扫描", "名字一并落盘（面板下拉要显示）");
  eq(typeof (all.s1 && all.s1.at), "string", "带绑定时刻");
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(SESS, "utf8")); } catch { parsed = null; }
  eq(parsed && parsed.v, 1, "落盘形状 { v: 1 }");
  eq(parsed && parsed.agents && parsed.agents.s1 && parsed.agents.s1.engagement, eng.id, "落盘内容与读回一致");
}

console.log("[2] 改绑 / 解绑");
{
  eq(store.setSessionBinding("s1", eng2.id, "内网横向"), true, "改绑到第二个靶标");
  eq(store.sessionBinding("s1"), eng2.id, "改绑后读到的是新靶标（不是两条并存）");
  eq(Object.keys(store.sessionBindings()).filter((k) => k === "s1").length, 1, "同一会话只留一条");
  eq(store.clearSessionBinding("s1"), true, "clearSessionBinding 返回 true");
  eq(store.sessionBinding("s1"), undefined, "解绑后读不到");
  eq(store.clearSessionBinding("s1"), false, "再解绑一次返回 false（没东西可删）");
}

console.log("[3] 拒绝写入：不许留下指向不存在靶标的绑定");
{
  eq(store.setSessionBinding("s2", "eng-不存在", "x"), false, "靶标不存在 → false");
  eq(store.sessionBinding("s2"), undefined, "被拒绝的写入没有落盘");
  eq(store.setSessionBinding("", eng.id, "x"), false, "空会话 id → false");
  eq(store.setSessionBinding("s3", "", "x"), false, "空靶标 id → false");
  eq(store.sessionBinding(""), undefined, "空会话 id 读不到东西");
}

console.log("[4] dispatch：面板用的三个 op");
{
  const bound = dispatch(store, { op: "bindSessionEngagement", session: "s4", engagement: eng.id });
  eq(bound.ok, true, "bindSessionEngagement ok");
  eq(bound.bound, eng.id, "回执里带 bound");
  const read = dispatch(store, { op: "sessionBinding", session: "s4" });
  eq(read.ok, true, "sessionBinding ok");
  eq(read.bound, eng.id, "读到绑定的靶标");
  eq(read.name, "外网扫描", "name 取靶标名");
  const unbound = dispatch(store, { op: "bindSessionEngagement", session: "s4" });
  eq(unbound.ok, true, "不传 engagement = 解绑，且 ok");
  eq(unbound.bound, null, "解绑回执 bound=null");
  eq(store.sessionBinding("s4"), undefined, "解绑真的删掉了");
  eq(dispatch(store, { op: "bindSessionEngagement" }).ok, false, "缺 session → ok:false");
  const list = dispatch(store, { op: "sessionBindings" });
  eq(list.ok, true, "sessionBindings ok");
  eq(typeof list.agents, "object", "回执里带 agents 表");
}

console.log("[5] 坏文件容错：绑定表是加速器，坏了只能退化成「没绑过」");
{
  store.setSessionBinding("s5", eng.id, "外网扫描");
  fs.writeFileSync(SESS, '{"v":1,"agents":{"s5":{"engag', "utf8"); /* 半截 JSON */
  let threw = null;
  let all = null;
  try { all = store.sessionBindings(); } catch (e) { threw = e; }
  eq(threw, null, "半截 JSON 不抛错");
  eq(all, {}, "半截 JSON 读成空表（不是整块炸掉）");
  eq(store.setSessionBinding("s6", eng.id, "外网扫描"), true, "坏文件之后仍然写得进去（重建成合法 JSON）");
  eq(store.sessionBinding("s6"), eng.id, "重写后读得到");
  fs.writeFileSync(SESS, JSON.stringify({ v: 1, agents: { s7: { engagement: eng.id, name: 123 } } }), "utf8");
  const coerced = store.sessionBindings();
  eq(coerced.s7 && coerced.s7.name, eng.id, "name 不是字符串时退回靶标 id（不写 undefined）");
}

console.log("[6] 悬空绑定：靶标删了，绑定不该继续占位");
{
  const doomed = store.openEngagement("待删靶标", []);
  store.setSessionBinding("s8", doomed.id, "待删靶标");
  fs.rmSync(path.join(root, "engagements", doomed.id), { recursive: true, force: true });
  eq(store.sessionBinding("s8"), doomed.id, "删除后仍能从表里读到（表本身不主动清理）");
  store.setSessionBinding("s9", eng.id, "外网扫描");
  eq(store.sessionBinding("s8"), undefined, "下一次写入时悬空条目被剪掉");
  eq(store.sessionBinding("s9"), eng.id, "同一次写入保留有效条目");
}

console.log("[7] 会话关系图：图里看得见靶标与绑定");
{
  const graph = store.sessionGraph();
  eq(Array.isArray(graph.engagements), true, "engagements 是数组");
  eq(graph.engagements.some((e) => e.id === eng.id), true, "图里有外网扫描这个靶标");
  const node = graph.sessions.find((s) => s.id === "s9");
  eq(Boolean(node), true, "图里有 s9 这个会话节点");
  eq(node && node.engagement, eng.id, "会话节点挂在正确的靶标下");
  eq((graph.count_by_engagement[eng.id] || 0) >= 1, true, "按靶标计数 ≥ 1");
  const viaDispatch = dispatch(store, { op: "sessionGraph", session: "s9" });
  eq(viaDispatch.ok, true, "dispatch sessionGraph ok");
  const mine = (viaDispatch.sessions || []).find((s) => s.id === "s9");
  eq(mine && mine.current, true, "当前会话在回执里被标成 current");
  eq(viaDispatch.root_session, "s9", "root_session 原样带回");
}

store.close();
fs.rmSync(root, { recursive: true, force: true });

console.log(`${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
