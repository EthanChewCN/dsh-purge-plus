#!/usr/bin/env node
// [dsh-purge-plus] P3 回归：子智能体回报解析 + 「现在在等谁」队列 + 收口。
//
// 为什么单独一个脚本而不是只靠 verify.mjs 的文本断言：
// 这一层的语义（谁排前面、收口之后还回不回来、20 条裁剪会不会把「有人在等」挤掉）
// 全部是**行为**，字符串对不上就等于没验。这里用真的 SQLite 跑一遍。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RedteamStore } from "../dist/build/package/lib/redteam/store-core.js";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "plus-attn-"));
const store = new RedteamStore(ROOT);
let pass = 0;
let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log("  ✓ " + label); return }
  fail += 1;
  console.log("  ✗ " + label + (extra === undefined ? "" : "  ← " + JSON.stringify(extra)));
};
const section = (s) => console.log("\n" + s);

/* ── 1. 回报解析：只认结构化事实，不猜 ─────────────────────────── */
section("[1] parseAgentReport");
const strict = store.parseAgentReport('干完了。\nredteamReport: {"status":"waiting","blocked_reason":"缺 VPN 账号","needs":[{"kind":"credential","detail":"运维 VPN"}]}');
ok(strict && strict.status === "waiting", "严格 JSON：status=waiting");
ok(strict && strict.blocked_reason === "缺 VPN 账号", "严格 JSON：blocked_reason 原样带出");
ok(strict && strict.needs.length === 1 && strict.needs[0].kind === "credential", "严格 JSON：needs 归一化成 {kind,detail}");

const pseudo = store.parseAgentReport("redteamReport: { status: blocked, blocked_reason: 目标没开 443, needs: [凭证] }");
ok(pseudo && pseudo.status === "blocked", "伪 JSON（键值无引号）仍能解析");
ok(pseudo && pseudo.blocked_reason === "目标没开 443", "伪 JSON：blocked_reason 抽得对");
ok(pseudo && pseudo.needs.length === 1 && pseudo.needs[0].detail === "凭证", "伪 JSON：needs 退化成一条字符串");

const asString = store.parseAgentReport('redteamReport: {"status":"ready","needs":"请验收"}');
ok(asString && asString.needs.length === 1 && asString.needs[0].detail === "请验收", "needs 写成字符串也收下");

ok(store.parseAgentReport("没有回报，只是普通结论") === null, "没有 redteamReport → null（不猜）");
ok(store.parseAgentReport('redteamReport: {"status":"乱写"}') === null, "status 不在枚举内 → null");
ok(store.parseAgentReport('redteamReport: {"status":"waiting"') === null, "括号不闭合 → null");
ok(store.parseAgentReport("") === null, "空文本 → null");
/* 正文里先出现一个别的 JSON，回报在最后：必须取最后一个 redteamReport */
const twoBlocks = store.parseAgentReport('{"a":1}\nredteamReport: {"status":"progress"}\nredteamReport: {"status":"failed"}');
ok(twoBlocks && twoBlocks.status === "failed", "多次出现取最后一次（后来的覆盖前面的）");

/* ── 2. 落库与队列排序 ───────────────────────────────────────── */
section("[2] recordAgentReport / attentionQueue");
const eng = store.openEngagement("P3 回归靶标");
store.recordAgentReport(eng.id, { session_id: "s-progress", parent_session: "root", status: "progress", label: "在跑的那个" });
store.recordAgentReport(eng.id, { session_id: "s-failed", parent_session: "root", status: "failed", label: "失败的那个" });
store.recordAgentReport(eng.id, { session_id: "s-wait", parent_session: "root", status: "waiting", label: "等解答的那个", blocked_reason: "缺账号", needs: [{ kind: "credential", detail: "VPN" }] });
store.recordAgentReport(eng.id, { session_id: "s-ready", parent_session: "root", status: "ready", label: "等验收的那个" });

let q = store.attentionQueue(eng.id);
ok(q.total === 4, "四条回报都进队列", q.total);
ok(q.items[0].session_id === "s-wait", "排序：waiting 在最前", q.items.map((x) => x.status));
ok(q.items[1].session_id === "s-ready", "排序：ready 第二");
ok(q.items[2].session_id === "s-failed", "排序：failed 第三");
ok(q.items[3].session_id === "s-progress", "排序：progress 最后");
ok(q.awaiting_person === 3, "awaiting_person 只数 person/* 三个阶段", q.awaiting_person);
ok(q.items[0].stage === "person/answer" && q.items[0].reason === "缺账号", "stage 与 reason 带出");
/* P7 落地后引擎就在场：这里验「在场且缺口为 0」的形态。
   「引擎缺席」的形态在下面用摘掉方法的方式单独验，不靠假设。 */
ok(q.coverage_available === true && q.pending_coverage === 0, "覆盖度引擎在场 → available=true，缺口为 0", q.coverage_available + "/" + q.pending_coverage);

/* 同一会话只认最新一条 */
store.recordAgentReport(eng.id, { session_id: "s-wait", parent_session: "root", status: "progress", label: "等解答的那个" });
q = store.attentionQueue(eng.id);
ok(q.total === 4, "同一会话追加回报不增加队列长度", q.total);
ok(!q.items.some((x) => x.session_id === "s-wait" && x.status === "waiting"), "最新一条是 progress → 不再算「等解答」");

/* ── 3. 收口：摘掉之后不能自己回来 ───────────────────────────── */
section("[3] acknowledgeAgentReports");
const ack1 = store.acknowledgeAgentReports(eng.id, { session_id: "s-ready" });
ok(ack1.acknowledged === 1, "按 session_id 收口一条", ack1);
q = store.attentionQueue(eng.id);
ok(q.total === 3, "收口后队列少一条", q.total);
ok(!q.items.some((x) => x.session_id === "s-ready"), "被收口的那条不再出现");

const ack2 = store.acknowledgeAgentReports(eng.id, { session_id: "s-ready" });
ok(ack2.acknowledged === 0, "重复收口是幂等的（changes=0，不报错）", ack2);

const ackIds = store.acknowledgeAgentReports(eng.id, { ids: [1] });
ok(ackIds.acknowledged === 1, "按行号精确收口", ackIds);

const ackAll = store.acknowledgeAgentReports(eng.id, { all: true });
ok(ackAll.acknowledged >= 1, "整条队列收口", ackAll);
q = store.attentionQueue(eng.id);
ok(q.total === 0, "全部收口后队列为空", q.total);
ok(/没有人等/.test(q.note), "空队列的 note 是人话", q.note);
/* 覆盖度引擎在 P7 落地之后就是「存在」的，所以这里要**分别**验两条分支，
   不能只验一条然后假设另一条。做法：临时摘掉两个队列函数再问一次 —— 
   这正是 attentionQueue 里那个能力探测要处理的情形。 */
ok(/这一轮打完了/.test(q.note), "引擎在场且无缺口：note 说这一轮打完了", q.note);
{
  /* 用 undefined 覆盖自己的属性来遮住原型方法 —— delete 删不掉原型上的东西，
     第一版就是这么写的，结果三次断言全绿（假绿）：引擎其实还在场。 */
  const saved = { a: store.assetNextActions, h: store.hostNextActions };
  store.assetNextActions = undefined;
  store.hostNextActions = undefined;
  const q2 = store.attentionQueue(eng.id);
  ok(q2.coverage_available === false, "引擎缺席时 coverage_available 必须是 false", q2.coverage_available);
  ok(/只覆盖/.test(q2.note), "引擎缺席时 note 明说结论只覆盖智能体回报这一路", q2.note);
  store.assetNextActions = saved.a;
  store.hostNextActions = saved.h;
  const q3 = store.attentionQueue(eng.id);
  ok(q3.coverage_available === true, "恢复后应当重新报 true", q3.coverage_available);
}

const noArg = store.acknowledgeAgentReports(eng.id, {});
ok(noArg.error !== undefined, "不给 session_id/ids/all → 明确报错，不静默成功", noArg);

/* ── 4. 20 条裁剪不丢「有人在等」 ────────────────────────────── */
section("[4] 历史裁剪");
const eng2 = store.openEngagement("P3 裁剪靶标");
store.recordAgentReport(eng2.id, { session_id: "s-long", parent_session: "root", status: "waiting", label: "最早那条在等人" });
for (let i = 0; i < 40; i += 1) {
  store.recordAgentReport(eng2.id, { session_id: "s-long", parent_session: "root", status: "progress", label: "第 " + i + " 轮" });
}
const rows = store.db(eng2.id).prepare("SELECT COUNT(*) AS n FROM agent_report WHERE session_id = 's-long'").get().n;
ok(rows === 20, "同一会话只留 20 条（库不会无限涨）", rows);
const q2 = store.attentionQueue(eng2.id);
ok(q2.total === 1 && q2.items[0].status === "progress", "被挤掉的是被取代的历史，队列看的是最新那条", q2.items);
/* 最新那条若是 waiting，必须还在 */
store.recordAgentReport(eng2.id, { session_id: "s-long", parent_session: "root", status: "waiting", label: "现在在等人" });
const q3 = store.attentionQueue(eng2.id);
ok(q3.total === 1 && q3.items[0].status === "waiting", "最新的 waiting 永远在队列里（裁剪按 id DESC，最新必留）", q3.items);

/* ── 5. 参数边界 ────────────────────────────────────────────── */
section("[5] 参数边界");
let threw = false;
try { store.recordAgentReport(eng2.id, { status: "progress" }) } catch { threw = true }
ok(threw, "缺 session_id → 抛错（不写一条没有归属的回报）");
threw = false;
try { store.recordAgentReport(eng2.id, { session_id: "x", status: "乱写" }) } catch { threw = true }
ok(threw, "status 不在枚举内 → 抛错");
ok(store.attentionQueue(eng2.id, { limit: 1 }).items.length <= 1, "limit 生效");
ok(store.attentionQueue(eng2.id, { limit: 99999 }).items.length <= 100, "limit 上限 100（不因为传大数就全给）");

/* ── 6. 未建表的库不能让整个面板挂掉 ─────────────────────────── */
section("[6] 降级");
const eng3 = store.openEngagement("P3 空靶标");
store.db(eng3.id).exec("DROP TABLE agent_report");
const q4 = store.attentionQueue(eng3.id);
ok(q4.total === 0, "表被删掉时返回空队列而不是抛错", q4);

fs.rmSync(ROOT, { recursive: true, force: true });
console.log("\n" + (fail === 0 ? "全部通过" : "有失败") + `：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
