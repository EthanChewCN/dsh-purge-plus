#!/usr/bin/env node
// [dsh-purge-plus] 主题开关（dusk / white / system）。
//
// 这块最容易出的错不是"不切换"，而是**切换错了范围**：
//   · 把 data-theme 写到 <html> 上 → 宿主整个界面跟着变（插件不该替用户做全局决定）；
//   · localStorage 被禁时抛异常 → 整个面板白屏；
//   · 容器还没挂载就急着挂按钮 → 面板里出现一个悬空胶囊。
// 所以这里用最小 window/document 替身把真实片段跑起来，断言属性落在**容器**上。

import fs from "node:fs";
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

/* 仓库里读 overlay 原文；装好的包里读随包的 fixtures 副本（发布包不带 overlay/）。 */
const snippetPath = [
  path.join(ROOT, "overlay", "snippets", "theme-toggle.js"),
  path.join(ROOT, "scripts", "fixtures", "theme-toggle.js"),
].find((p) => fs.existsSync(p));
if (!snippetPath) {
  console.error("✗ 找不到 theme-toggle.js（overlay 与 fixtures 都没有）");
  process.exit(1);
}
const snippet = fs.readFileSync(snippetPath, "utf8");

/* ── 最小 DOM 替身 ─────────────────────────────────────────────── */
function makeEl(tag) {
  return {
    tag, id: "", type: "", className: "", textContent: "",
    attrs: {}, children: [], listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    appendChild(child) { this.children.push(child); return child; },
    click() { for (const fn of this.listeners.click || []) fn({}); },
  };
}

function makeDoc({ containers = 2, readyState = "complete" } = {}) {
  const nodes = [];
  for (let i = 0; i < containers; i += 1) nodes.push(makeEl("div"));
  const doc = {
    readyState,
    head: makeEl("head"),
    body: makeEl("body"),
    documentElement: makeEl("html"),
    listeners: {},
    querySelectorAll(sel) { return sel === ".rt-dock,.rt-full" ? nodes.slice() : []; },
    getElementById(id) {
      const all = [doc.head, doc.body, doc.documentElement].concat(doc.head.children, doc.body.children);
      return all.find((el) => el && el.id === id) || null;
    },
    createElement(tag) { return makeEl(tag); },
    addEventListener(type, fn) { (doc.listeners[type] = doc.listeners[type] || []).push(fn); },
  };
  doc.__nodes = nodes;
  return doc;
}

function makeWindow({ light = false, storage = true, storageThrows = false, storageGetterThrows = false } = {}) {
  const map = new Map();
  const win = {
    MutationObserver: class { observe() {} disconnect() {} },
    matchMedia(q) {
      return {
        matches: /light/.test(q) ? light : !light,
        addEventListener() {},
        addListener() {},
      };
    },
  };
  if (storageGetterThrows) {
    /* Safari 隐私模式下 `window.localStorage` 这个**取值本身**就会抛（不是 getItem 抛）。 */
    Object.defineProperty(win, "localStorage", { get() { throw new Error("SecurityError"); } });
  } else if (storage) {
    win.localStorage = {
      getItem(k) { if (storageThrows) throw new Error("denied"); return map.has(k) ? map.get(k) : null; },
      setItem(k, v) { if (storageThrows) throw new Error("denied"); map.set(k, String(v)); },
    };
  }
  win.__map = map;
  return win;
}

/** 把片段跑起来：window / document 作为形参注入，内部引用就解析到替身。 */
function run(win, doc) {
  const fn = new Function("window", "document", snippet);
  fn(win, doc);
  return win.__dshPurgeTheme;
}

console.log("[1] 默认档与属性落点");
{
  const win = makeWindow();
  const doc = makeDoc({ containers: 2 });
  const theme = run(win, doc);
  eq(Boolean(theme), true, "挂出了 window.__dshPurgeTheme");
  eq(theme.get(), "dusk", "默认档是 dusk");
  eq(doc.__nodes.map((n) => n.getAttribute("data-theme")), ["dusk", "dusk"], "两个容器都写了 data-theme=dusk");
  eq(doc.documentElement.getAttribute("data-theme"), undefined, "**没有**写到 <html> 上（不替宿主做全局决定）");
  eq(doc.body.getAttribute("data-theme"), undefined, "**没有**写到 <body> 上");
}

console.log("[2] 切换与持久化");
{
  const win = makeWindow();
  const doc = makeDoc({ containers: 1 });
  const theme = run(win, doc);
  eq(theme.set("white"), "white", "切到 white");
  eq(doc.__nodes[0].getAttribute("data-theme"), "white", "容器属性跟着变");
  eq(win.__map.get("dsh-purge-plus:ui-theme"), "white", "写进了 localStorage（带本包前缀）");

  eq(theme.set("nonsense"), "dusk", "非法档回落到默认");
  eq(theme.set("dusk"), "dusk", "切回 dusk");
}

console.log("[3] system 档要问系统");
{
  const lightWin = makeWindow({ light: true });
  const lightDoc = makeDoc({ containers: 1 });
  const lightTheme = run(lightWin, lightDoc);
  lightTheme.set("system");
  eq(lightTheme.get(), "system", "选中档仍是 system（不是解析后的档）");
  eq(lightTheme.resolved(), "white", "系统是亮色时解析成 white");
  eq(lightDoc.__nodes[0].getAttribute("data-theme"), "white", "容器上写的是解析后的档");

  const darkWin = makeWindow({ light: false });
  const darkDoc = makeDoc({ containers: 1 });
  const darkTheme = run(darkWin, darkDoc);
  darkTheme.set("system");
  eq(darkTheme.resolved(), "dusk", "系统是暗色时解析成 dusk");
}

console.log("[4] cycle：暗 → 亮 → 跟随 → 暗");
{
  const win = makeWindow();
  const doc = makeDoc({ containers: 1 });
  const theme = run(win, doc);
  eq(theme.get(), "dusk", "起点 dusk");
  eq(theme.cycle(), "white", "第一次切到 white");
  eq(theme.cycle(), "system", "第二次切到 system");
  eq(theme.cycle(), "dusk", "第三次回到 dusk");
}

console.log("[5] 坏环境不能把面板搞崩");
{
  /* localStorage 直接抛（隐私模式 / 被策略禁）。 */
  const win = makeWindow({ storageThrows: true });
  const doc = makeDoc({ containers: 1 });
  let threw = false;
  let theme = null;
  try { theme = run(win, doc); } catch { threw = true; }
  eq(threw, false, "localStorage 抛异常时不冒泡");
  eq(Boolean(theme), true, "仍然挂出 API");
  eq(theme.get(), "dusk", "取不到存值就走默认");
  eq(theme.set("white"), "white", "存不进去也照样切换（只是不持久）");
  eq(doc.__nodes[0].getAttribute("data-theme"), "white", "容器属性仍然生效");

  /* localStorage 的**取值**就抛（Safari 隐私模式）。这条才是 storage() 那个 try 的用途。 */
  const getterWin = makeWindow({ storageGetterThrows: true });
  const getterDoc = makeDoc({ containers: 1 });
  let getterThrew = false;
  let getterTheme = null;
  try { getterTheme = run(getterWin, getterDoc); } catch { getterThrew = true; }
  eq(getterThrew, false, "localStorage 取值抛异常时不冒泡");
  /* 每次调用都包一层：storage() 的 try 被拿掉时这里要报 ✗，而不是让整个脚本崩掉。 */
  const safeCall = (label, fn) => {
    try { return { ok: true, value: fn() }; } catch (e) { bad(`${label} 抛异常（${String(e && e.message || e)}）`); return { ok: false }; }
  };
  const gotMode = safeCall("get()", () => getterTheme.get());
  if (gotMode.ok) eq(gotMode.value, "dusk", "取不到存储就走默认档");
  const setOk = safeCall("set('white')", () => getterTheme.set("white"));
  if (setOk.ok) eq(setOk.value, "white", "仍然能切换");
  eq(getterDoc.__nodes[0].getAttribute("data-theme"), "white", "容器属性仍然生效");

  /* 完全没有 localStorage。 */
  const bare = makeWindow({ storage: false });
  const bareDoc = makeDoc({ containers: 1 });
  const bareTheme = run(bare, bareDoc);
  eq(bareTheme.get(), "dusk", "没有 localStorage 也能取默认档");

  /* 存了非法值。 */
  const junk = makeWindow();
  junk.__map.set("dsh-purge-plus:ui-theme", "neon");
  const junkDoc = makeDoc({ containers: 1 });
  eq(run(junk, junkDoc).get(), "dusk", "存了不认识的档按默认处理");
}

console.log("[6] 容器还没挂载：不挂悬空按钮");
{
  const win = makeWindow();
  const doc = makeDoc({ containers: 0 });
  const theme = run(win, doc);
  eq(Boolean(theme), true, "API 仍然可用");
  eq(doc.body.children.length, 0, "没有容器时**不**往 body 塞按钮");
  eq(doc.head.children.length, 0, "也没有注入样式");

  /* 容器出现后再 apply 一次就能写进去。 */
  doc.__nodes.push(makeEl("div"));
  theme.apply();
  eq(doc.__nodes[0].getAttribute("data-theme"), "dusk", "补挂容器后 apply 能写进去");
}

console.log("[7] 有容器时按钮就位，点击能切");
{
  const win = makeWindow();
  const doc = makeDoc({ containers: 1 });
  const theme = run(win, doc);
  const pill = doc.body.children.find((el) => el.id === "dshpp-theme-pill");
  eq(Boolean(pill), true, "按钮挂到了 body");
  eq(pill.textContent, "暗", "初始文案是「暗」");
  eq(pill.getAttribute("data-mode"), "dusk", "按钮带 data-mode");
  eq(doc.head.children.some((el) => el.tag === "style"), true, "样式注入到 head");
  pill.click();
  eq(theme.get(), "white", "点一下切到 white");
  eq(pill.textContent, "亮", "文案跟着变");
  pill.click();
  eq(theme.get(), "system", "再点切到 system");
  eq(pill.textContent, "跟随", "文案是「跟随」");
}

console.log("[8] 接线：产物带、且不在 html 上写属性");
{
  for (const rel of ["client.js"]) {
    const src = fs.readFileSync(path.join(PKG, rel), "utf8");
    eq(src.includes("dshpp-theme-pill"), true, `${rel} 带主题按钮`);
    eq(src.includes("dsh-purge-plus:ui-theme"), true, `${rel} 用带前缀的存储键`);
  }
  eq(/documentElement\.setAttribute\('data-theme'/.test(snippet), false, "片段里没有往 <html> 写 data-theme");
}

/* 汇总行格式与其它 test-*.mjs 一致：verify [33] 按「N 通过 / M 失败」汇总断言数 */
console.log(`${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
