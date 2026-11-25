#!/usr/bin/env node
// [dsh-purge-plus] 尾部锚点（safe anchor.js）与 mnemon 开关（safe mnemon-settings.js）。
//
// 两项都是「注入层」的开关，错了不会报错、只会让行为悄悄变：
//   · 锚点注册错位置 → 规则块落到模型读不到的地方，等于没写；
//   · 锚点注册两份 → 尾部出现两段互不相同的规则块（本包默认只装子会话那条，
//     因为基座已经用「注入正文落在尾部」占住了 order 10150）；
//   · mnemon 开关读错 → 用户打开开关却发现记忆段还是被摘掉。
// 所以这里用最小 ctx 替身真跑一遍注册与渲染，而不是只查源码里有没有这个词。

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

/** 最小 systemPrompt 替身：记录注册项，并允许按名字取回渲染结果。 */
function makeCtx() {
  const sections = new Map();
  const contexts = new Map();
  const disposers = [];
  const sp = {
    section(spec) {
      sections.set(spec.name, spec);
      const d = () => sections.delete(spec.name);
      disposers.push(d);
      return d;
    },
    context(spec) {
      contexts.set(spec.name, spec);
      const d = () => contexts.delete(spec.name);
      disposers.push(d);
      return d;
    },
  };
  return { ctx: { systemPrompt: sp }, sections, contexts, disposers };
}

const anchorMod = await import(pkgPath("lib/anchor.js"));
const identity = await import(pkgPath("lib/identity.js"));

console.log("[1] 锚点：默认只装子会话那条 context");
{
  const { ctx, sections, contexts } = makeCtx();
  const off = anchorMod.registerAnchor(ctx, { anchorMode: "child" });
  eq(sections.size, 0, "anchorMode=child 时不注册 section（不占 10150）");
  eq(contexts.size, 1, "注册了一条 context");
  const spec = contexts.get(anchorMod.CHILD_ANCHOR_CONTEXT);
  eq(Boolean(spec), true, "context 名是 dsh-purge-plus:child-anchor");
  eq(spec.order, 235, "order 是 235（排在宿主 delegation 120 之后）");
  eq(spec.required, true, "required=true（rc5 的 refreshContext 才不会把它 suppress 掉）");
  eq(typeof spec.text, "function", "text 是函数（按会话渲染，不是常量）");
  eq(typeof off, "function", "返回 disposer");
  off();
  eq(contexts.size, 0, "disposer 摘掉了 context");
}

console.log("[2] 锚点：两种模式 + 关闭");
{
  const both = makeCtx();
  anchorMod.registerAnchor(both.ctx, {});
  eq([both.sections.size, both.contexts.size], [1, 1], "默认模式 section + context 都装");
  eq(both.sections.get(anchorMod.ANCHOR_SECTION).order, anchorMod.ANCHOR_ORDER, "section order 是 10150");
  eq(anchorMod.ANCHOR_ORDER > 10100 && anchorMod.ANCHOR_ORDER < 10200, true, "10150 落在 WEB_SURFACE(10100) 与部署人格(10200) 之间");

  const offed = makeCtx();
  const off = anchorMod.registerAnchor(offed.ctx, { enabled: false });
  eq([offed.sections.size, offed.contexts.size], [0, 0], "enabled:false 时一段都不注册");
  eq(typeof off, "function", "关闭时仍返回可调用的 disposer");

  const modeOff = makeCtx();
  anchorMod.registerAnchor(modeOff.ctx, { anchorMode: "off" });
  eq([modeOff.sections.size, modeOff.contexts.size], [0, 0], "anchorMode:off 同样不注册");

  /* 没有 systemPrompt 的 ctx 不能抛。 */
  let threw = false;
  try { anchorMod.registerAnchor({}, {}); } catch { threw = true; }
  eq(threw, false, "ctx 没有 systemPrompt 时安全返回");
  try { anchorMod.registerAnchor(null, {}); } catch { threw = true; }
  eq(threw, false, "ctx 为 null 时安全返回");
}

console.log("[3] 锚点：只对子会话渲染正文");
{
  const { ctx, contexts } = makeCtx();
  anchorMod.registerAnchor(ctx, { anchorMode: "child" });
  const spec = contexts.get(anchorMod.CHILD_ANCHOR_CONTEXT);

  const childCtx = { agent: { session: { header: { origin: "subagent", delegationDepth: 1 } } } };
  const rootCtx = { agent: { session: { header: { origin: "user", delegationDepth: 0 } } } };
  const text = spec.text(childCtx);
  eq(typeof text, "string", "子会话正文是字符串");
  eq(text.length > 200, true, `子会话正文非空（${text.length} 字符）`);
  eq(/SUBAGENT ANCHOR/.test(text), true, "子会话正文带 SUBAGENT ANCHOR 标记");
  eq(spec.text(rootCtx), "", "主会话拿到空串（主锚点另有一段，不在这里重复）");
  eq(spec.text({}), "", "没有会话上下文时返回空串，不抛");
}

console.log("[4] isChildAgentContext：只看委派来源与深度");
{
  eq(identity.isChildAgentContext({ agent: { session: { header: { origin: "subagent" } } } }), true, "origin=subagent → 子会话");
  eq(identity.isChildAgentContext({ session: { header: { origin: "teammate" } } }), true, "origin=teammate → 子会话");
  eq(identity.isChildAgentContext({ session: { header: { delegationDepth: 2 } } }), true, "delegationDepth=2 → 子会话");
  eq(identity.isChildAgentContext({ session: { header: { origin: "user", delegationDepth: 0 } } }), false, "普通会话 → 不是子会话");
  eq(identity.isChildAgentContext({}), false, "没有 header → 不是子会话");
  /* 续接/分支出来的会话带 parentSession 但自己是根，不能被判成子会话。 */
  eq(identity.isChildAgentContext({ session: { header: { origin: "user", parentSession: "s-1", delegationDepth: 0 } } }), false,
    "带 parentSession 但 origin=user → 仍判为根（续接会话不误判）");
}

console.log("[5] mnemon 开关：落盘 / 读取 / 容错");
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "plus-mnemon-"));
  try {
    const mod = await import(pkgPath("lib/mnemon-settings.js"));
    eq(mod.loadMnemonSettings(home).keepMnemon, false, "默认 false");
    eq(mod.loadMnemonSettings(home, true).keepMnemon, true, "没有文件时回退到 config 值");
    eq(mod.loadMnemonSettings(home, "yes").keepMnemon, false, "config 值不是布尔时按默认 false");

    const saved = mod.saveMnemonSettings(home, { keepMnemon: true });
    eq([saved.ok, saved.keepMnemon], [true, true], "保存返回新值");
    eq(saved.path, path.join(home, "dsh-purge-plus", "mnemon.json"), "落盘路径在 dsh-purge-plus/ 下");
    eq(JSON.parse(fs.readFileSync(saved.path, "utf8")).keepMnemon, true, "文件内容正确");
    eq(mod.loadMnemonSettings(home).keepMnemon, true, "文件优先于 config");

    fs.writeFileSync(saved.path, "{ 坏掉的 json", "utf8");
    eq(mod.loadMnemonSettings(home, true).keepMnemon, true, "文件坏掉时回退 config，不抛");

    mod.saveMnemonSettings(home, { keepMnemon: false });
    eq(mod.loadMnemonSettings(home).keepMnemon, false, "能改回 false");
    const leftovers = fs.readdirSync(path.dirname(saved.path)).filter((f) => f.endsWith(".tmp"));
    eq(leftovers, [], "原子写没有留下 .tmp 残片");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log("[6] 接线：identity 真的读这个开关");
{
  const src = fs.readFileSync(pkgPath("lib/identity.js"), "utf8");
  eq(/import \{ loadMnemonSettings \} from "\.\/mnemon-settings\.js"/.test(src), true, "identity import 了 loadMnemonSettings");
  eq(/mnemonKeep === true \? false :/.test(src), true, "keepMnemon=true 时强制保留 mnemon 段");
  eq((src.match(/mnemonKeep === true \? false :/g) || []).length, 2, "两个分支（对象入参 / 普通入参）都走同一开关");
  eq(/export function isChildAgentContext/.test(src), true, "identity 导出了 isChildAgentContext");

  const cap = fs.readFileSync(pkgPath("lib/plus-capabilities.js"), "utf8");
  eq(/registerAnchor\(ctx, \{/.test(cap), true, "能力层注册了锚点");
  eq(/anchorMode: cfg\.anchorSection === true \? "both" : "child"/.test(cap), true, "默认只装子会话那条（anchorSection 才两段都装）");
}

console.log("[7] op 接线：mnemonSettings 走异步分发");
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "plus-mnemon-op-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { RedteamStore, dispatchAsync } = await import(pkgPath("lib/redteam/store-core.js"));
    const store = new RedteamStore(path.join(home, "store"));
    const read1 = await dispatchAsync(store, { op: "mnemonSettings" });
    eq([read1.ok, read1.keepMnemon], [true, false], "读：默认 false");
    const wrote = await dispatchAsync(store, { op: "mnemonSettings", keepMnemon: true });
    eq([wrote.ok, wrote.keepMnemon], [true, true], "写：返回新值");
    const read2 = await dispatchAsync(store, { op: "mnemonSettings" });
    eq(read2.keepMnemon, true, "再读拿到 true");
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/* 汇总行格式与其它 test-*.mjs 一致：verify [33] 按「N 通过 / M 失败」汇总断言数 */
console.log(`${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
