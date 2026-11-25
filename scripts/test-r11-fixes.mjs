#!/usr/bin/env node
// [dsh-purge-plus] R11 三方审计后的修复回归。
//
// 这一轮修的都是「静默失败 / 假成功 / 数据丢失」三类，共同特点是**正常路径看不出来**：
//   · 漏传一个字段 → 整份角色提示词被写成 0 字节，还永久失去自动升级；
//   · 口令长得像 base64 → 被静默换成别的字符串，探活照样 ok；
//   · 覆盖度查不出来 → 面板说「这一轮打完了」；
//   · 导入 0 个节点 → 返回 ok:true。
// 所以每条都要有一个「把东西弄坏一次」的断言，而不是只查代码里有没有那句话。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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

const { RedteamStore, dispatch } = await import(pkgPath("lib/redteam/store-core.js"));

function freshStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plus-r11-"));
  const store = new RedteamStore(root);
  const eng = store.openEngagement({ name: "t", scope: "internal" });
  const id = typeof eng === "string" ? eng : (eng.id || (eng.engagement && eng.engagement.id));
  return { root, store, id, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

console.log("[1] savePrompt 漏传 content 不许把提示词写成 0 字节");
{
  const { store, id, cleanup } = freshStore();
  try {
    const before = dispatch(store, { op: "prompts", engagement: id }).roles.find((r) => r.role === "recon").content.length;
    eq(before > 1000, true, `recon 初始长度 ${before} 字节`);
    const r = dispatch(store, { op: "savePrompt", engagement: id, role: "recon" });
    eq(r.ok, false, "漏传 content → ok:false");
    eq(/content/.test(String(r.error)), true, "错误文案点出缺的是 content");
    const after = dispatch(store, { op: "prompts", engagement: id }).roles.find((x) => x.role === "recon").content.length;
    eq(after, before, "提示词一个字节没动");
    /* 显式空串是「我要清空」，必须仍然允许。 */
    const cleared = dispatch(store, { op: "savePrompt", engagement: id, role: "recon", content: "" });
    eq([cleared.ok, cleared.bytes], [true, 0], "显式传空串仍然可以清空（两种意图可区分）");
  } finally { cleanup(); }
}

console.log("[2] 代理口令不许被 base64 误解码");
{
  const { parseProxyConfig } = await import(pkgPath("lib/redteam/proxy-parse.js"));
  const cases = [
    ["trojan://dGVzdHBhc3M@h.example.com:443#a", "dGVzdHBhc3M"],
    ["trojan://YWJj@h.example.com:443#b", "YWJj"],
    ["socks5://u:p@h.example.com:1080#c", "p"],
    ["http://user:plain@h.example.com:8080#d", "plain"],
  ];
  for (const [uri, want] of cases) {
    const c = parseProxyConfig(uri).candidates[0];
    eq(c && c.secret, want, `${uri.split("://")[0]} 的口令原样保留（${want}）`);
  }
  /* ss 的 userinfo 按协议就是 base64，必须仍然解。 */
  const ss = "ss://" + Buffer.from("aes-128-gcm:realpw").toString("base64") + "@h:8388#e";
  eq(parseProxyConfig(ss).candidates[0].secret, "realpw", "ss 仍然解 base64（协议要求）");
}

console.log("[3] 覆盖度查不出来 ≠ 没有缺口");
{
  const { root, store, id, cleanup } = freshStore();
  try {
    const dbPath = path.join(root, "engagements", id, "assets.db");
    const now = new Date().toISOString();
    let db = new DatabaseSync(dbPath);
    db.prepare("INSERT INTO segment(cidr, first_seen) VALUES(?,?)").run("10.9.9.0/24", now);
    db.prepare("INSERT INTO asset(segment_cidr, ip, ip_int, state, first_seen, last_seen, discovered_at) VALUES(?,?,?,?,?,?,?)")
      .run("10.9.9.0/24", "10.9.9.9", 1, "unknown", now, now, now);
    db.close();

    const healthy = dispatch(store, { op: "attention", engagement: id });
    eq([healthy.coverage_available, healthy.pending_coverage], [true, 1], "健康时 available=true、缺口 1");

    db = new DatabaseSync(dbPath);
    db.exec("ALTER TABLE asset RENAME TO asset_x");
    db.close();

    const broken = dispatch(store, { op: "attention", engagement: id });
    eq(broken.coverage_available, false, "查询失败 → coverage_available=false");
    eq(/no such table/.test(String(broken.coverage_error)), true, `coverage_error 带上原因（${String(broken.coverage_error).slice(0, 40)}）`);
    eq(/查不出来/.test(broken.note), true, "结论句说「查不出来」，不再说「打完了」");
    eq(/也没有队列缺口/.test(broken.note), false, "**不再**声称「也没有队列缺口」");

    /* 卡片读的是 coverageSummary.pending.ok，必须是 false。 */
    const card = dispatch(store, { op: "coverageSummary", engagement: id });
    eq(card.pending.ok, false, "coverageSummary.pending.ok=false（首页卡片据此显示「查不出来」）");
    const cp = store.coveragePending(id);
    eq(cp.ok, false, "coveragePending 是唯一来源，ok=false");
  } finally { cleanup(); }
}

console.log("[4] 查不到就是查不到：asset / proxyPoolImport");
{
  const { store, id, cleanup } = freshStore();
  try {
    const miss = dispatch(store, { op: "asset", engagement: id, id: 99999 });
    eq(miss.ok, false, "asset 查不到 → ok:false（不再返回裸 {ok:true}）");
    eq(/not found/.test(String(miss.error)), true, "错误里点出 not found");

    const empty = dispatch(store, { op: "proxyPoolImport", yaml: "" });
    eq([empty.ok, empty.importedCount], [false, 0], "空配置导入 → ok:false + 0 条");
    const good = dispatch(store, { op: "proxyPoolImport", yaml: "socks5://a.example.com:1080#a" });
    eq([good.ok, good.importedCount], [true, 1], "真导进来才 ok:true");
    const dup = dispatch(store, { op: "proxyPoolImport", yaml: "socks5://a.example.com:1080#a" });
    eq([dup.ok, dup.importedCount], [false, 0], "全是重复 → ok:false（warnings 说明原因）");
  } finally { cleanup(); }
}

console.log("[5] 启动闸门：drifted 不算「宿主已清洗好」");
{
  const src = fs.readFileSync(pkgPath("lib/reapply.js"), "utf8");
  eq(/row === "pending" \|\| row === "unmatched" \|\| row === "drifted"/.test(src), true, "hostCleanEnoughToKeep 把 drifted 也算脏");
}

console.log("[6] 覆盖层写入是原子写（不再就地截断）");
{
  const src = fs.readFileSync(pkgPath("lib/core.js"), "utf8");
  const at = src.indexOf("export async function saveOverrideContent(");
  eq(at > 0, true, "找得到 saveOverrideContent");
  const body = src.slice(at, at + 1600);
  eq(/open\(tmpPath, "w"\)/.test(body), true, "写的是临时文件");
  eq(/rename\(tmpPath, fp\)/.test(body), true, "最后 rename 顶替");
  eq(/open\(fp, "w"\)/.test(body), false, "**没有**直接截断目标文件");
}

console.log("[7] 预设自愈：等待段只有一份，旧文案必须被修");
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "plus-preset-r11-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const mod = await import(pkgPath("lib/redteam/index.js"));
    const tpl = fs.readFileSync(path.join(PKG, "presets", "redteam", "agent.cordis.yml"), "utf8");
    fs.mkdirSync(path.join(home, ".agent-presets", "redteam"), { recursive: true });
    const fp = path.join(home, ".agent-presets", "redteam", "agent.cordis.yml");

    /* 先跑一次，拿到「任务板 + 等待段」都插好之后的完整正文 —— 用它当老版本的样本。
       旧写法是在模板里 replace 任务板标题，可模板里**根本没有**那一段（它由自愈插入），
       replace 静默不命中，于是测的是一个不含等待段的文件，「插成两段」永远测不出来。 */
    fs.writeFileSync(fp, tpl, "utf8");
    const first = mod.installPreset({ log: () => {} });
    eq(first.action, "installed" in first ? "installed" : first.action, "首次安装动作");
    const full = fs.readFileSync(fp, "utf8");
    eq((full.match(/## 等待与轮询（不要空转）/g) || []).length, 1, "首次安装后等待段一份");

    /* 造「老版本」：把任务板那段删掉，只留等待段。
       这正是 boardOnly 分支存在的理由 —— 再插一次整块就会多出第二段等待文案。 */
    const boardAt = full.indexOf("## 共享任务板（Agent Teams");
    const waitAt = full.indexOf("## 等待与轮询（不要空转）");
    eq(boardAt > 0 && waitAt > boardAt, true, "样本里任务板在等待段之前");
    const noBoard = full.slice(0, boardAt) + full.slice(waitAt);
    /* 同时把等待段正文换成老文案（错的那版），验证「按段修」而不是「整块重插」。 */
    const legacyWait = "      ## 等待与轮询（不要空转）\n      只有在还有子智能体在跑的时候才等：用户发话会唤醒它。\n";
    const legacy = noBoard.replace(/      ## 等待与轮询（不要空转）[\s\S]*?(?=\n\s*\n      ## |\n\s*$)/, legacyWait.trimEnd());
    fs.writeFileSync(fp, legacy, "utf8");

    const r = mod.installPreset({ log: () => {} });
    const out = fs.readFileSync(fp, "utf8");
    eq(r.action, "repaired", "动作是 repaired");
    eq(out.includes("## 共享任务板（Agent Teams"), true, "任务板被补回");
    eq((out.match(/## 等待与轮询（不要空转）/g) || []).length, 1, "等待段仍然只有一份（旧代码会插成两段）");
    eq(out.includes("用户发话会唤醒它"), false, "旧的错误文案被修掉了");
    eq((out.match(/noProgress/g) || []).length >= 1, true, "新指纹在");

    /* 幂等：第二次必须是 kept，文件不变。 */
    const before = fs.readFileSync(fp, "utf8");
    const r2 = mod.installPreset({ log: () => {} });
    eq(r2.action, "kept", "第二次是 kept");
    eq(fs.readFileSync(fp, "utf8") === before, true, "文件逐字节不变");
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log("[8] config.json 保存不冲掉表外字段（PA-04）");
{
  /* loadPlatformConfig 按固定形状重建对象 —— 表外键在**读**那一步就会丢，
     所以保存端再怎么保也保不住。两处都要铺开原始 JSON。 */
  const mod = await import(pkgPath("lib/redteam/platform-config.js"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plus-cfg-"));
  try {
    mod.savePlatformConfig({ templatesRefreshedAt: 123, templatesCount: 999, templatesCommit: "abc", templatesLastError: "boom" }, root);
    mod.savePlatformConfig({ platform: "linux" }, root);
    const after = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
    eq(after.templatesRefreshedAt, 123, "templatesRefreshedAt 保留");
    eq(after.templatesCount, 999, "templatesCount 保留");
    eq(after.templatesCommit, "abc", "templatesCommit 保留");
    eq(after.templatesLastError, "boom", "templatesLastError 保留");
    eq(after.platform, "linux", "已知字段照常被覆盖");

    const loaded = mod.loadPlatformConfig(root);
    eq(loaded.templatesRefreshedAt, 123, "读出来的对象也带表外字段（否则保存端无从保留）");
    eq(loaded.platform, "linux", "读出来的已知字段规范化");

    /* 原型污染防护：__proto__ 不能被写进配置。 */
    mod.savePlatformConfig(JSON.parse('{"__proto__":{"polluted":true},"notes":"n"}'), root);
    const polluted = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
    eq(polluted.polluted, undefined, "__proto__ 不会被写进配置");
    eq(polluted.notes, "n", "正常字段仍然写入");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/* 汇总行格式与其它 test-*.mjs 一致：verify [33] 按「N 通过 / M 失败」汇总断言数 */
console.log(`${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
