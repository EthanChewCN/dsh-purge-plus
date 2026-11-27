#!/usr/bin/env node
// [dsh-purge-plus] R20 回归：空载荷 / 空壳 / 假成功 / 类型污染 共 12 条。
//
// 与 R19 同一套纪律：断言**磁盘上的最终状态**或**具体字段**，不是断言「有 ok」。
// 这些缺陷的共同点是「返回 ok:true，但写进去的东西不可用或不可逆」：
//   · 空载荷落一条 title=NULL 的漏洞行；
//   · 只给 code 的 saveStage 插入空壳阶段，永久阻断内置定义补种；
//   · savePrompt 收对象 → 写成 "[object Object]"；
//   · points:"abc" → 静默归 0；
//   · {bundle:{…}} 导入零条却 ok:true；
//   · intelRefresh 名字像「刷新资源」，实际一个字节都不下载。
// 另外三条是契约问题：intelStatus 自相矛盾、assetCoverage 报错指错对象、
// add/update 返回形状不一致。

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

const tmpRoots = [];
const tmp = (tag) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dshpp-r20-${tag}-`));
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
  /* ── 1. addVuln 空载荷 ───────────────────────────────────────────── */
  section("[1] addVuln 空载荷不再落一条 title=NULL 的漏洞行");
  {
    const { store, id } = fresh("vuln");
    const before = store.vulnStats(id).total;
    const r = call(store, id, { op: "addVuln" });
    ok(r.ok === false, "空载荷 → ok:false", r);
    ok(/title|cve/.test(String(r.error)), "错误文案点出缺 title 或 cve", r.error);
    ok(store.vulnStats(id).total === before, "漏洞表条数没变", store.vulnStats(id).total);
    const onlyCve = call(store, id, { op: "addVuln", cve: "CVE-2021-44228" });
    ok(onlyCve.ok === true, "只给 cve 仍然可以入库", onlyCve);
    const onlyTitle = call(store, id, { op: "addVuln", title: "后台弱口令" });
    ok(onlyTitle.ok === true, "只给 title 仍然可以入库", onlyTitle);
  }

  /* ── 2. saveStage 空壳 + sections 类型 ───────────────────────────── */
  section("[2] saveStage：空壳阶段不再阻断内置定义补种；sections 非数组被拒");
  {
    const { store, id } = fresh("stage");
    /* 先清空 stage 表，模拟「种子还没跑」的老库 */
    store.db(id).prepare("DELETE FROM stage").run();
    /* 只给内置 code：现在先补种再写，等于一次幂等 no-op —— 关键是**不能**留下空壳。
       真正该拒绝的是「库里没有、又没给 sections」的自造 code。 */
    const r = call(store, id, { op: "saveStage", code: "internet" });
    ok(r.ok === true, "只给内置 code → 幂等成功（先补种，不插空壳）", r);
    const stages = store.listStages(id);
    const internet = stages.find((s) => s.code === "internet");
    ok(internet !== undefined, "内置 internet 阶段被补种出来", stages.map((s) => s.code));
    const unknown = call(store, id, { op: "saveStage", code: "zzz-unknown" });
    ok(unknown.ok === false, "库里没有、又没给 sections 的自造 code → ok:false", unknown);
    ok(!store.listStages(id).some((s2) => s2.code === "zzz-unknown"), "没有插入空壳阶段",
      store.listStages(id).map((s2) => s2.code));
    ok(Array.isArray(internet.sections) && internet.sections.length >= 3,
      "补种的是完整定义（3 段手段），不是空壳", internet && internet.sections);
    ok(internet.name !== "internet", "name 是内置标题而不是 code", internet && internet.name);

    const bad = call(store, id, { op: "saveStage", code: "recon", sections: "x" });
    ok(bad.ok === false, "sections 传字符串 → ok:false", bad);
    ok(/数组/.test(String(bad.error)), "错误文案说明必须是数组", bad.error);
    const stored = store.listStages(id).find((s) => s.code === "recon");
    ok(Array.isArray(stored.sections), "库里的 recon.sections 仍然是数组", stored && typeof stored.sections);
  }

  /* ── 3. savePrompt 非字符串 ─────────────────────────────────────── */
  section("[3] savePrompt 收对象不再写成 \"[object Object]\"");
  {
    const { store, id } = fresh("prompt");
    const before = call(store, id, { op: "prompts" }).roles.find((x) => x.role === "recon").content;
    const r = call(store, id, { op: "savePrompt", role: "recon", content: { a: 1 } });
    ok(r.ok === false, "content 传对象 → ok:false", r);
    const after = call(store, id, { op: "prompts" }).roles.find((x) => x.role === "recon").content;
    ok(after === before, "磁盘上的提示词一个字节没动", { before: before.length, after: after.length });
    ok(!/\[object Object\]/.test(after), "没有出现 [object Object]", after.slice(0, 40));
    const arr = call(store, id, { op: "savePrompt", role: "recon", content: ["x"] });
    ok(arr.ok === false, "content 传数组 → ok:false", arr);
    const empty = call(store, id, { op: "savePrompt", role: "recon", content: "" });
    ok(empty.ok === true && empty.bytes === 0, "显式空串仍然可以清空", empty);
  }

  /* ── 4. saveScorePoint points 类型 ──────────────────────────────── */
  section("[4] saveScorePoint：points:\"abc\" 不再静默归 0");
  {
    const { store, id } = fresh("score");
    const added = call(store, id, { op: "saveScorePoint", name: "自建点", points: 30 });
    ok(added.ok === true, "先正常新增一个自建点", added);
    const bad = call(store, id, { op: "saveScorePoint", id: added.id, name: "自建点", points: "abc" });
    ok(bad.ok === false, "更新时 points 传字符串 → ok:false", bad);
    ok(/数字/.test(String(bad.error)), "错误文案说明必须是数字", bad.error);
    const listed = store.listScorePoints(id);
    const row = (Array.isArray(listed) ? listed : listed.items || []).find((p) => p.id === added.id);
    ok(Number(row.points) === 30, "分值仍然是 30，没有被归 0", row && row.points);
    const badNew = call(store, id, { op: "saveScorePoint", name: "另一个点", points: "abc" });
    ok(badNew.ok === false, "新增时 points 传字符串 → ok:false", badNew);
  }

  /* ── 5. 证据 / 步骤 / 隧道 空载荷 ───────────────────────────────── */
  section("[5] 证据 / 攻击链 / 隧道 空载荷被拒");
  {
    const { store, id } = fresh("empty");
    const e = call(store, id, { op: "addHttpEvidence" });
    ok(e.ok === false, "HTTP 证据空载荷 → ok:false", e);
    ok(store.listHttpEvidence(id).length === 0, "证据表没有多出空行", store.listHttpEvidence(id).length);
    const e2 = call(store, id, { op: "addHttpEvidence", url: "http://x/a" });
    ok(e2.ok === true, "给了 url 仍然可以入库", e2);

    const c = call(store, id, { op: "addChainStep", stage: "recon" });
    ok(c.ok === false, "攻击链缺 title → ok:false", c);
    const c2 = call(store, id, { op: "addChainStep", title: "扫到后台", stage: "recon" });
    ok(c2.ok === true, "给了 title 仍然可以入库", c2);

    const t = call(store, id, { op: "addTunnel", kind: "socks5" });
    ok(t.ok === false, "隧道没有任何可用字段 → ok:false", t);
    const t2 = call(store, id, { op: "addTunnel", kind: "socks5", listen: "127.0.0.1:1080" });
    ok(t2.ok === true, "给了 listen 仍然可以入库", t2);
  }

  /* ── 6. import 兼容 {bundle:{…}} ────────────────────────────────── */
  section("[6] import 传 {bundle:{…}} 不再零入库却 ok:true");
  {
    const { store, id } = fresh("import");
    const empty = call(store, id, { op: "import", bundle: {} });
    ok(empty.ok === false, "空 bundle → ok:false", empty);
    ok(/没有导入/.test(String(empty.error)), "错误文案说明零入库", empty.error);
    const real = call(store, id, { op: "import", bundle: { assets: [{ ip: "10.9.9.9", ports: [{ port: 80 }] }] } });
    ok(real.ok === true, "真 bundle → ok:true", real);
    ok(real.counts && real.counts.assets === 1, "资产入库 1 条", real.counts);
    const assets = store.listAssets(id);
    const assetRows = Array.isArray(assets) ? assets : assets.items || [];
    ok(assetRows.some((a) => a.ip === "10.9.9.9"), "库里有这台资产", assetRows.map((a) => a.ip));
  }

  /* ── 7. bindSessionEngagement 失败要说原因 ──────────────────────── */
  section("[7] 会话绑定失败必须带 error");
  {
    const { store, id } = fresh("bind");
    const r = dispatch(store, { op: "bindSessionEngagement", session: "sess-x", engagement: "no-such-eng" });
    ok(r.ok === false, "绑到不存在的靶标 → ok:false", r);
    ok(/engagement not found/.test(String(r.error)), "错误文案点明靶标不存在", r.error);
    const good = dispatch(store, { op: "bindSessionEngagement", session: "sess-x", engagement: id });
    ok(good.ok === true && good.bound === id, "绑到存在的靶标 → ok:true 且 bound 是它", good);
  }

  /* ── 8. intelStatus 口径 + intelRefresh 语义 ─────────────────────── */
  section("[8] intelStatus 不再自相矛盾；intelRefresh 明说「只探测不下载」");
  {
    const store = new RedteamStore(tmp("intel"));
    const st = store.intelStatus();
    const staleByField = st.resources.filter((r) => r.stale === true).length;
    ok(st.stale_count === staleByField, "stale_count 与 resources[].stale 口径一致",
      { count: st.stale_count, byField: staleByField });
    ok(st.resources.every((r) => !(r.stale === true && r.missing === true)),
      "缺失的资源不再同时标 stale", st.resources.map((r) => [r.key, r.stale, r.missing]));
    ok(st.missing_count > 0, "全新目录下确实有缺失项", st.missing_count);
    const rf = store.intelRefresh();
    ok(rf.probe_only === true && rf.downloaded === false, "intelRefresh 明确标注只探测、未下载", {
      probe_only: rf.probe_only, downloaded: rf.downloaded,
    });
    ok(/intelUpdate/.test(String(rf.note)), "note 指向真下载的 op", rf.note);
  }

  /* ── 9. coverage 未知 action 的报错顺序 ─────────────────────────── */
  section("[9] assetCoverage / hostCoverage：写错 action 时报「未知 action」");
  {
    const { store, id } = fresh("cov");
    const a = call(store, id, { op: "assetCoverage", action: "zzz" });
    ok(a.ok === false && /未知 action/.test(String(a.error)), "assetCoverage 缺 asset_id 也报未知 action", a.error);
    const h = call(store, id, { op: "hostCoverage", action: "zzz" });
    ok(h.ok === false && /未知 action/.test(String(h.error)), "hostCoverage 同上", h.error);
  }

  /* ── 10. addDataProof fields 类型 ───────────────────────────────── */
  section("[10] addDataProof 收对象 fields 被拒");
  {
    const { store, id } = fresh("proof");
    const bad = call(store, id, { op: "addDataProof", row_count: 10, fields: { a: 1 } });
    ok(bad.ok === false, "fields 传对象 → ok:false", bad);
    ok(store.listDataProofs(id).total === 0, "没有落 [object Object] 行", store.listDataProofs(id).total);
    const good = call(store, id, { op: "addDataProof", row_count: 10, fields: ["姓名", "手机号"] });
    ok(good.ok === true && good.fields.length === 2, "字符串数组照旧", good);
  }

  /* ── 11. cleanup add/update 返回形状一致 ────────────────────────── */
  section("[11] cleanup 的 add 与 update 返回同一组键");
  {
    const { store, id } = fresh("cleanup");
    const add = call(store, id, { op: "addCleanup", kind: "webshell", title: "删掉 a.jsp", target: "10.0.0.5", location: "/var/www/a.jsp" });
    ok(add.ok === true && add.cleanup_id > 0, "add 返回 cleanup_id", add);
    ok(add.cleanup && add.cleanup.id === add.cleanup_id, "add 同时返回 cleanup 对象", add.cleanup && add.cleanup.id);
    const upd = call(store, id, { op: "updateCleanup", id: add.cleanup_id, status: "done", detail: "已删" });
    ok(upd.ok === true && upd.cleanup_id === add.cleanup_id, "update 也返回 cleanup_id", upd);
    ok(upd.cleanup && upd.cleanup.status === "done", "update 返回更新后的行", upd.cleanup && upd.cleanup.status);
    ok(upd.cleanup && upd.cleanup.target === "10.0.0.5" && upd.cleanup.title === "删掉 a.jsp",
      "只改状态没有抹掉 target/title", upd.cleanup && [upd.cleanup.target, upd.cleanup.title]);
  }

  /* ── 12. 覆盖度端口带 provenance / banner ──────────────────────── */
  section("[12] getAssetCoverage().asset.ports 带 provenance / banner");
  {
    const { store, id } = fresh("ports");
    call(store, id, { op: "import", bundle: { assets: [{ ip: "10.7.7.7", ports: [{ port: 8080, banner: "nginx/1.24", provenance: "active" }] }] } });
    const listed2 = store.listAssets(id);
    const asset = (Array.isArray(listed2) ? listed2 : listed2.items || []).find((a) => a.ip === "10.7.7.7");
    const cov = store.getAssetCoverage(id, asset.id);
    const p = cov.asset.ports[0];
    ok(p !== undefined, "资产端口取到了", cov.asset.ports);
    ok(p && p.provenance === "active", "端口带 provenance", p && p.provenance);
    ok(p && p.banner === "nginx/1.24", "端口带 banner", p && p.banner);
    ok(cov.ports.length === cov.asset.ports.length, "顶层 ports 与 asset.ports 是同一份", {
      top: cov.ports.length, nested: cov.asset.ports.length,
    });
  }
} finally {
  for (const dir of tmpRoots) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 尽力而为 */ }
  }
}

console.log(`\n${fail === 0 ? "✓" : "✗"} R20 回归：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
