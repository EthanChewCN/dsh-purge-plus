#!/usr/bin/env node
// [dsh-purge-plus] P23 回归：删除靶标 + 资源保鲜徽章点名。
//
// 这两件事都容易「看起来对了但其实是错的」：
//   删除靶标 —— 如果只 rm 目录，会话绑定会指向一个不存在的靶标，重启后面板跟随
//               一个空壳；如果只清绑定不关 sqlite 句柄，rename 在某些文件系统上失败。
//   资源徽章 —— 只说「缺 1 项」时，用户刚点完「更新 KEV / 模板」会以为没生效。
//
// 所以这里跑真目录 + 真 dispatch，不 mock。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
/* 既能在仓库里跑（scripts/../dist/build/package），也能在**已安装的包里**跑
   （发布包现在带 test-*.mjs，脚本所在包的根就是包根；审计 B-5）。
   注意这里用脚本自身位置而不是 ROOT —— 有些测试的 ROOT 是临时库目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = fs.existsSync(path.join(HERE, "..", "dist", "build", "package"))
  ? path.join(HERE, "..", "dist", "build", "package")
  : path.join(HERE, "..");

const MOD = path.join(PKG, "lib", "redteam", "store-core.js");
if (!fs.existsSync(MOD)) {
  console.error("dist/build/package 不存在，先跑 node scripts/build.mjs");
  process.exit(1);
}
const { RedteamStore, dispatch } = await import(pathToFileURL(MOD).href);

let pass = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) { pass += 1; return; }
  fails.push(name + (extra === undefined ? "" : " → " + JSON.stringify(extra)));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "engdel-"));
const store = new RedteamStore(tmp);

/* ── 1. 删除 = 移到 .trash，不是 rm ─────────────────────────── */
const a = store.openEngagement("靶标甲", ["10.0.0.0/24"]).id
const b = store.openEngagement("靶标乙", ["10.1.0.0/24"]).id
ok(fs.existsSync(path.join(tmp, "engagements", b)), "删除前靶标乙目录存在")
const del = store.deleteEngagement(b)
ok(del.ok === true, "deleteEngagement 返回 ok", del)
ok(!fs.existsSync(path.join(tmp, "engagements", b)), "原目录已移走")
ok(fs.existsSync(del.trashed), "回收目录里真的有东西", del.trashed)
ok(del.trashed.includes(path.join(tmp, ".trash")), "回收路径在 .trash 下", del.trashed)
ok(String(del.recover || "").startsWith("mv "), "给了恢复命令", del.recover)
ok(store.listEngagements().map((e) => e.id).join(",") === a, "清单里只剩靶标甲", store.listEngagements().map((e) => e.id))

/* ── 2. 恢复：mv 回去就能再看到（名字还在 meta 里）────────────── */
const c = store.openEngagement("靶标丙", []).id
const delC = store.deleteEngagement(c)
fs.renameSync(delC.trashed, path.join(tmp, "engagements", c))
const back = store.listEngagements().find((e) => e.id === c)
ok(!!back, "恢复后回到清单")
ok(back && back.name === "靶标丙", "恢复后名字没丢", back && back.name)

/* ── 3. 会话绑定被清掉 ────────────────────────────────────── */
const d = store.openEngagement("靶标丁", []).id
ok(store.setSessionBinding("sess-1", d, "靶标丁") === true, "先绑上")
ok(store.sessionBinding("sess-1") === d, "绑定读得回来")
const delD = store.deleteEngagement(d)
ok(delD.unbound === 1, "报告解绑 1 条", delD.unbound)
ok(store.sessionBinding("sess-1") === undefined, "绑定已清（不会指向已删靶标）")
/* 另一条绑到还活着的靶标，不能被误删 */
ok(store.setSessionBinding("sess-2", a, "靶标甲") === true, "第二条绑定写入")
store.deleteEngagement("靶标乙") /* 已删过：走 not found 分支 */
ok(store.sessionBinding("sess-2") === a, "无关绑定不受影响")

/* ── 4. 当前指针被清掉 ────────────────────────────────────── */
const e = store.openEngagement("靶标戊", []).id
store.setActiveEngagement(e)
ok(store.activeEngagementId() === e, "指针指向靶标戊")
const delE = store.deleteEngagement(e)
ok(delE.current_cleared === true, "报告清了指针", delE.current_cleared)
ok(!fs.existsSync(path.join(tmp, "current")), "current 文件已删")
const nowActive = store.activeEngagementId()
ok(nowActive !== e && !!nowActive, "指针回退到还存在的靶标", nowActive)

/* ── 5. 不存在的靶标：明确报错，不静默成功 ──────────────────── */
const missing = store.deleteEngagement("根本没有这个靶标")
ok(missing.ok === false && /not found/.test(missing.error), "不存在时报 not found", missing)
const again = store.deleteEngagement(b)
ok(again.ok === false, "重复删除报 not found（不是 ok:true）", again)
const empty = store.deleteEngagement("")
ok(empty.ok === false && /需要靶标 id/.test(empty.error), "空 id 被拒", empty)

/* ── 6. op 层：没有 confirm 不许删 ─────────────────────────── */
const g = store.openEngagement("靶标己", []).id
const noConfirm = dispatch(store, { op: "deleteEngagement", engagement: g })
ok(noConfirm.ok === false && /confirm/.test(noConfirm.error), "缺 confirm 被拒", noConfirm)
ok(fs.existsSync(path.join(tmp, "engagements", g)), "被拒时目录没动")
const withConfirm = dispatch(store, { op: "deleteEngagement", engagement: g, confirm: true })
ok(withConfirm.ok === true, "带 confirm 才删", withConfirm)
const noId = dispatch(store, { op: "deleteEngagement" })
ok(noId.ok === false && /需要 engagement/.test(noId.error), "缺 engagement 被拒", noId)

/* ── 7. 资源徽章：缺失必须点名 ─────────────────────────────── */
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "home-"));
const savedHome = process.env.HOME;
process.env.HOME = fakeHome;
try {
  const s2 = new RedteamStore(fs.mkdtempSync(path.join(os.tmpdir(), "intel-")))
  const all = s2.intelStatus()
  ok(all.missing_count === 3, "三样都缺", all.missing_count)
  ok(Array.isArray(all.missing_labels) && all.missing_labels.length === 3, "missing_labels 有 3 项", all.missing_labels)
  ok(all.badge.includes("KEV") && all.badge.includes("nuclei") && all.badge.includes("字典库"),
    "徽章点名三个资源", all.badge)
  /* 只补上字典库 → 徽章只剩两项，且不再提字典库 */
  fs.mkdirSync(path.join(s2.root, "wordlists"), { recursive: true })
  const partial = s2.intelStatus()
  ok(partial.missing_count === 2, "补上字典库后缺 2 项", partial.missing_count)
  ok(!partial.badge.includes("字典库"), "徽章不再提字典库", partial.badge)
  ok(partial.badge.includes("、"), "多项之间用顿号连接", partial.badge)
} finally {
  process.env.HOME = savedHome;
}

/* ── 8. 构建产物里真的接上了（UI 不是 mock）─────────────────── */
const panel = fs.readFileSync(path.join(PKG, "client.js"), "utf8");
const full = fs.readFileSync(path.join(PKG, "lib", "redteam", "client.js"), "utf8");
for (const [name, src] of [["面板内嵌", panel], ["独立窗口", full]]) {
  ok(src.includes("function CleanupPanel(props)"), name + "：有 CleanupPanel")
  ok(/CleanupPanel, \{ engagement: eng/.test(src), name + "：CleanupPanel 被挂进凭据与文件页")
  ok(src.includes("deleteEngagement"), name + "：有删除靶标按钮")
  ok(/op: ['"]deleteEngagement['"]/.test(src), name + "：按钮真的调 op")
  if (name === "面板内嵌") {
    ok(src.includes("基于 dsh-purge Community + dsh-purge safe 独立维护"), name + "：页脚血缘已更新")
    ok(!src.includes("1.1.71 独立维护"), name + "：页脚不再写 1.1.71")
    ok(!/基于 dsh-purge Community [\d]/.test(src), name + "：页脚不含上游版本号")
  }
}

console.log(`\n${pass} 通过 / ${fails.length} 失败`);
if (fails.length) {
  for (const f of fails) console.log("  ✗ " + f);
  process.exit(1);
}
