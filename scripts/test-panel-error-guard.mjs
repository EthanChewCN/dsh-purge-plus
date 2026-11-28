#!/usr/bin/env node
/**
 * 面板崩溃兜底回归（0.1.182）。
 *
 * 背景：0.1.181 在真机上出现「重启后 Purge 面板打不开」——面板位置一片空白，
 * 控制台里没有任何用户能拿到的东西，最后只能回退版本。根因至今未复现，
 * 但那次白屏暴露了一个确定的问题：**渲染期抛错时我们什么也不告诉用户**。
 *
 * 这个脚本守两件事：
 *   1) 面板唯一挂载点（DetailSettings）真的被边界包住了 —— 查的是产物里的调用形态；
 *   2) 边界本身是活的 —— 从产物里切出类，喂假 React 跑 getDerivedStateFromError /
 *      render，断言「没异常时原样返回 children」「有异常时画出错误文本」。
 *
 * 第 2 条不是字符串断言：它真的会调用 render()，把返回的元素树拍平成文本再查。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;
const PANEL = path.join(PKG, "client.js");

let pass = 0;
const fails = [];
const ok = (cond, name) => { if (cond) { pass += 1; } else { fails.push(name); } };

const panel = fs.readFileSync(PANEL, "utf8");

/* ── 1. 挂载点被包住 ─────────────────────────────────────────────── */
ok(panel.includes('h(PurgeErrorBoundary, null, h(PurgePage))'), "DetailSettings 用边界包住 PurgePage");
ok(!panel.includes('className: "dshpp-detail-settings" }, h(PurgePage))'), "旧的裸挂载点已不存在");
ok(panel.includes("class PurgeErrorBoundary extends __PurgeComponent"), "边界是真类组件（不是空壳函数）");

/* ── 2. 把边界从产物里切出来，喂假 React 真跑 ────────────────────── */
const START = "const __purgeErrLog =";
const END = "if (typeof window !== \"undefined\") window.__dshPurgeErrorLog = __purgeErrLog;";
const at = panel.indexOf(START);
const end = panel.indexOf(END);
ok(at > 0 && end > at, "能从产物里切出兜底代码块");

const source = at > 0 && end > at ? panel.slice(at, end + END.length) : "";

/** 极简元素树：h(tag, props, ...children)。 */
const h = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat() });
/** 假 React：只要 Component 能被子类化、能拿到 props/state 即可。 */
class FakeComponent {
  constructor(props) { this.props = props || {}; }
  setState(next) { this.state = { ...this.state, ...next }; }
}
const import_react = { default: { Component: FakeComponent } };

const listeners = {};
const fakeWindow = {
  __dshPurgeErrors: undefined,
  addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }
};

const factory = new Function(
  "import_react", "h", "h2", "window", "document",
  `${source}\nreturn { PurgeErrorBoundary, __purgeErrLog, __purgeRecordError };`
);
let mod = null;
let threw = null;
try {
  mod = factory(import_react, h, h, fakeWindow, undefined);
} catch (e) {
  threw = e;
}
ok(!threw, `兜底代码块可求值${threw ? "（" + threw.message + "）" : ""}`);

const Boundary = mod && mod.PurgeErrorBoundary;

/** 把元素树拍平成可见文本。 */
function textOf(node) {
  if (node === null || node === undefined || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  return textOf(node.children);
}

if (Boundary) {
  /* 无异常：children 原样返回（不能因为加了兜底改变正常渲染） */
  const child = { tag: "div", props: {}, children: ["正常内容"] };
  const b1 = new Boundary({ children: child });
  b1.state = { error: null };
  ok(b1.render() === child, "无异常时原样返回 children（不改变正常渲染）");

  /* 有异常：画出错误文本，而不是返回空 */
  const err = new Error("boom-in-panel");
  const derived = Boundary.getDerivedStateFromError(err);
  ok(derived && derived.error === err, "getDerivedStateFromError 收下错误对象");

  const b2 = new Boundary({ children: child });
  b2.state = derived;
  const tree = b2.render();
  const text = textOf(tree);
  ok(text.includes("Purge 面板渲染失败"), "异常时画出标题");
  ok(text.includes("boom-in-panel"), "异常时把错误原文画出来");
  ok(text.includes("__dshPurgeErrors"), "异常时告诉用户错误记在哪");
  ok(!text.includes("正常内容"), "异常时不渲染原 children（避免半渲染状态）");

  /* componentDidCatch 必须把错误记进环形缓冲 */
  b2.componentDidCatch(err);
  ok(Array.isArray(fakeWindow.__dshPurgeErrors) && fakeWindow.__dshPurgeErrors.length === 1, "componentDidCatch 写入错误缓冲");
  ok(String(fakeWindow.__dshPurgeErrors[0].message).includes("boom-in-panel"), "缓冲里存的是错误原文");

  /* 环形缓冲上限 20，不能无限涨 */
  for (let i = 0; i < 40; i += 1) mod.__purgeRecordError("render", new Error("e" + i));
  ok(fakeWindow.__dshPurgeErrors.length === 20, "错误缓冲封顶 20 条");
  ok(String(fakeWindow.__dshPurgeErrors[19].message).includes("e39"), "缓冲保留最新的一条");
}

/* ── 3. window 上的全局错误入口真的注册了 ────────────────────────── */
ok(typeof listeners.error?.[0] === "function", "注册了 window error 监听");
ok(typeof listeners.unhandledrejection?.[0] === "function", "注册了 unhandledrejection 监听");
if (listeners.error?.[0]) {
  listeners.error[0]({ error: new Error("global-boom") });
  ok(fakeWindow.__dshPurgeErrors.some((r) => String(r.message).includes("global-boom")), "全局 error 进缓冲");
}

/* ── 结果 ───────────────────────────────────────────────────────── */
if (fails.length) {
  console.error(`\n面板崩溃兜底：${pass} 通过 / ${fails.length} 失败`);
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`面板崩溃兜底：${pass} 通过 / 0 失败`);
