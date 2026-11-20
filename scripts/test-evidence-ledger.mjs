#!/usr/bin/env node
// [dsh-purge-plus] P12 回归：证据账本 op（面板的数据源）。
//
// 这一页最怕的不是报错，是**假绿灯**：把「还没开始记账」和「全部核实完毕」
// 画成同一个样子。所以三条断言专门守这个：
//   ① 空账本必须 empty=true（而不是 unresolved=0 就当成完成）；
//   ② 有未闭环声称时 unresolved_claims>0，闭环之后归零；
//   ③ 账本被改过（哈希对不上）时降级展示 + degraded=true，而不是白屏或假装正常。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RedteamStore, dispatch } from "../dist/build/package/lib/redteam/store-core.js";
import { EvidenceLedger, UnknownRegistry } from "../dist/build/package/lib/redteam/evidence-ledger.mjs";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "plus-ledger-"));
const store = new RedteamStore(ROOT);
let pass = 0;
let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log("  ✓ " + label); return }
  fail += 1;
  console.log("  ✗ " + label + (extra === undefined ? "" : "  ← " + JSON.stringify(extra)));
};
const section = (s) => console.log("\n" + s);
const op = (req) => dispatch(store, req);

const eng = store.openEngagement("账本回归");

/* ── 1. 空账本 ─────────────────────────────────────────────── */
section("[1] 空账本");
const empty = op({ op: "evidenceLedger", engagement: eng.id });
ok(empty.ok === true, "op 可用", empty.error);
ok(empty.empty === true, "空账本 empty=true（不是「全部核实完毕」）");
ok(empty.total === 0, "total=0");
ok(empty.unresolved_claims === 0, "unresolved_claims=0");
ok(Array.isArray(empty.items) && empty.items.length === 0, "items 是空数组而不是 null");
ok(Array.isArray(empty.unknowns) && empty.unknowns.length === 0, "unknowns 是空数组");

/* ── 2. 记一条声称（claimed）───────────────────────────────── */
section("[2] claimed 进账本");
const ledger = new EvidenceLedger(store.db(eng.id));
const rec = ledger.record({
  operation: "nmap_scan",
  parameters: { target: "10.1.2.3" },
  result: { open: [22, 80] },
  confidence: "claimed",
  authority: "subagent-report",
  recorded_by: "sub-1",
  source_agent: "vuln-scan",
  engagement_id: eng.id,
});
ok(rec.ok === true, "记录成功", rec);
const afterClaim = op({ op: "evidenceLedger", engagement: eng.id });
ok(afterClaim.empty === false, "有记录后 empty=false");
ok(afterClaim.total === 1, "total=1", afterClaim.total);
ok(afterClaim.unresolved_claims === 1, "一条未闭环声称", afterClaim.unresolved_claims);
ok(afterClaim.unverified === 1, "unverified 也是 1", afterClaim.unverified);
ok(afterClaim.items[0].confidence === "claimed", "条目带置信度");
ok(afterClaim.items[0].ev_id === rec.ev_id, "条目 ev_id 与写入一致");

/* 置信度过滤 */
ok(op({ op: "evidenceLedger", engagement: eng.id, confidence: "observed" }).items.length === 0, "按 observed 过滤 → 0 条");
ok(op({ op: "evidenceLedger", engagement: eng.id, confidence: "claimed" }).items.length === 1, "按 claimed 过滤 → 1 条");

/* ── 3. 闭环：upgrade 成 observed ──────────────────────────── */
section("[3] 闭环");
const up = ledger.upgrade({ claimed_ev_id: rec.ev_id, verified_by: "coordinator", verified_result: { open: [22, 80], verified: true } });
ok(up.ok === true, "upgrade 成功", up);
const afterUp = op({ op: "evidenceLedger", engagement: eng.id });
ok(afterUp.unresolved_claims === 0, "闭环后未闭环数归零", afterUp.unresolved_claims);
ok(afterUp.total === 2, "账本里现在是 2 条（声称 + 观察）", afterUp.total);
ok(afterUp.empty === false, "仍然 empty=false（有内容）");

/* ── 4. 未解决问题 ─────────────────────────────────────────── */
section("[4] 未解决问题");
const unk = new UnknownRegistry(store.db(eng.id));
const u1 = unk.record({ question: "22 端口是不是 SSH？", severity: "high", domain: "internal", engagement_id: eng.id });
ok(u1.ok === true, "登记未解决问题", u1);
const u2 = unk.record({ question: "22 端口是不是 SSH？", severity: "high", domain: "internal", engagement_id: eng.id });
ok(u2.duplicate === true, "同 question+domain 去重", u2);
const withUnk = op({ op: "evidenceLedger", engagement: eng.id });
ok(withUnk.unknown_total === 1, "unknown_total=1", withUnk.unknown_total);
ok(withUnk.unknowns[0].question === "22 端口是不是 SSH？", "未解决问题带问题原文");
ok(withUnk.empty === false, "只有未解决问题也算「有内容」");

/* ── 5. 账本被改过：降级而不是白屏 ─────────────────────────── */
section("[5] 篡改检测");
store.db(eng.id).prepare("UPDATE evidence SET result = ? WHERE ev_id = ?")
  .run(JSON.stringify({ open: [22, 80, 3306] }), rec.ev_id);
const tampered = op({ op: "evidenceLedger", engagement: eng.id });
ok(tampered.ok === true, "篡改后 op 仍返回 ok（页面不该整页崩）");
ok(tampered.degraded === true, "degraded=true 明确标出降级");
ok((tampered.errors || []).some((e) => e.startsWith("list:")), "错误里点名 list 失败", tampered.errors);
ok(tampered.items.length > 0, "降级后仍能列出条目（原始列）");
ok(tampered.items.every((x) => x.integrity === "unverified"), "降级条目带 integrity=unverified");

/* ── 6. 边界 ───────────────────────────────────────────────── */
section("[6] 边界");
/* 省略 engagement 时会回落到「当前靶标」指针（与 attention 同口径）。
   这里要验的是这个回落**真的发生了**，而不是悄悄返回空账本。 */
const fallback = op({ op: "evidenceLedger" });
ok(fallback.ok === true && fallback.engagement === eng.id, "省略 engagement 时回落到当前靶标", fallback.engagement);

/* 真的一个靶标都没有：必须报错，不能返回一个空账本当成功 */
const freshRoot = fs.mkdtempSync(path.join(os.tmpdir(), "plus-ledger-bare-"));
const bare = new RedteamStore(freshRoot);
const noEng = dispatch(bare, { op: "evidenceLedger" });
ok(noEng.ok === false && typeof noEng.error === "string", "一个靶标都没有时明确报错", noEng.error);

console.log("\n" + (fail === 0 ? "全部通过" : "失败 " + fail + " 项") + "：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
