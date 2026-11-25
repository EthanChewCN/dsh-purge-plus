#!/usr/bin/env node
// [dsh-purge-plus] P5 站内全屏：行为回归。
//
// 方法：从**构建产物**里把钩子原文切出来跑（marker 之间那段），不是在这里
// 重写一份等价实现。重写的那份永远会过，因为它测的是我脑子里的模型，
// 不是真正装进包里的代码。
//
// 依赖一个极小的 React 驱动：只需要 useState / useRef / useCallback / useEffect
// 四个钩子，且要保证 setter 与 useCallback 的**引用稳定**——否则依赖数组每帧都变，
// 副作用会反复重建，测出来的行为跟真实 React 下不是一回事。

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
/* 既能在仓库里跑（dist/build/package），也能在**已安装的包里**跑（脚本所在包的根）——
   发布包现在带 test-*.mjs，验收可以对已安装产物复跑（审计 B-5）。 */
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;
const SOURCE = path.join(PKG, "lib", "redteam", "client.js");

const BEGIN = "/* [dsh-purge-plus] __RT_FULLSCREEN_BEGIN__ */";
const END = "/* [dsh-purge-plus] __RT_FULLSCREEN_END__ */";

function extract() {
  const src = fs.readFileSync(SOURCE, "utf8");
  const a = src.indexOf(BEGIN);
  const b = src.indexOf(END);
  if (a < 0 || b < 0) throw new Error("构建产物里找不到 P5 marker —— build.mjs 的 P5 片段没落地");
  if (b < a) throw new Error("P5 marker 顺序反了");
  return src.slice(a + BEGIN.length, b);
}

const HOOK_SRC = extract();
// eslint-disable-next-line no-new-func
const HOOKS = new Function(HOOK_SRC + "\nreturn { useWorkbenchFullscreen, rtFullContains, rtFullNativeElement }")();

// ─────────────────────────────────────────────────────────────── 迷你 React
function sameDeps(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * 驱动一个只用「四个钩子」的函数组件。
 * 关键点：useState 的 setter 与 useCallback 的返回值必须跨渲染保持同一引用，
 * 否则依赖数组永远不相等，useEffect 会每帧重跑，测试会测到别的东西。
 */
function createDriver(hookFn, elementRef, options) {
  const states = [];
  const refs = [];
  const callbacks = [];
  const effects = [];
  let cursor = { s: 0, r: 0, c: 0, e: 0 };
  let api = null;
  let pumping = false;
  let dirty = false;
  let unmounted = false;

  const RL = {
    useState(init) {
      const i = cursor.s++;
      if (!(i in states)) {
        states[i] = { v: typeof init === "function" ? init() : init, set: null };
      }
      const cell = states[i];
      if (!cell.set) {
        cell.set = (next) => {
          if (unmounted) return;
          const v = typeof next === "function" ? next(cell.v) : next;
          if (v === cell.v) return;
          cell.v = v;
          pump();
        };
      }
      return [cell.v, cell.set];
    },
    useRef(init) {
      const i = cursor.r++;
      if (!(i in refs)) refs[i] = { current: init };
      return refs[i];
    },
    useCallback(fn, deps) {
      const i = cursor.c++;
      const cur = callbacks[i];
      if (!cur || !sameDeps(cur.deps, deps)) {
        callbacks[i] = { fn, deps: deps ? deps.slice() : null };
      }
      return callbacks[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor.e++;
      const cur = effects[i];
      if (cur && sameDeps(cur.deps, deps)) return;
      if (cur && typeof cur.cleanup === "function") cur.cleanup();
      effects[i] = { fn, deps: deps ? deps.slice() : null, cleanup: null, fresh: true };
    },
  };

  function flush() {
    for (const slot of effects) {
      if (!slot || !slot.fresh) continue;
      slot.fresh = false;
      const cleanup = slot.fn();
      slot.cleanup = typeof cleanup === "function" ? cleanup : null;
    }
  }

  function pump() {
    if (pumping) {
      dirty = true;
      return;
    }
    pumping = true;
    try {
      let guard = 0;
      do {
        dirty = false;
        cursor = { s: 0, r: 0, c: 0, e: 0 };
        api = hookFn(RL, elementRef, options);
        flush();
      } while (dirty && (guard += 1) < 50);
    } finally {
      pumping = false;
    }
  }

  function unmount() {
    unmounted = true;
    for (const slot of effects) {
      if (slot && typeof slot.cleanup === "function") slot.cleanup();
    }
  }

  pump();
  return { get api() { return api; }, unmount };
}

// ─────────────────────────────────────────────────────── 假 DOM / 假浏览器
function createEnv() {
  const listeners = new Map();
  const calls = { request: 0, exit: 0 };

  const doc = {
    fullscreenElement: null,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = listeners.get(type);
      if (set) set.delete(fn);
    },
    exitFullscreen() {
      calls.exit += 1;
      doc.fullscreenElement = null;
      fire("fullscreenchange");
      return Promise.resolve();
    },
  };

  const win = {
    addEventListener: doc.addEventListener,
    removeEventListener: doc.removeEventListener,
  };

  function fire(type, event) {
    const set = listeners.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) fn(event || { type });
  }

  const element = {
    children: new Set(),
    contains(node) {
      return Boolean(node) && (node === element || element.children.has(node));
    },
    getRootNode() {
      return doc;
    },
    matches() {
      return false;
    },
    querySelector(sel) {
      return element.__overlay && sel.indexOf("rt-modal") >= 0 ? element.__overlay : null;
    },
    requestFullscreen() {
      calls.request += 1;
      if (element.__reject) return Promise.reject(new Error("denied"));
      if (element.__defer) {
        return element.__defer.promise.then(() => {
          doc.fullscreenElement = element;
          fire("fullscreenchange");
        });
      }
      doc.fullscreenElement = element;
      fire("fullscreenchange");
      return Promise.resolve();
    },
  };

  return { doc, win, element, calls, fire };
}

// ─────────────────────────────────────────────────────────────────── 断言
const tests = [];
function check(name, fn) {
  tests.push({ name, fn });
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label || "值"}: 期望 ${b}，实际 ${a}`);
}
function ok(value, label) {
  if (!value) throw new Error(`${label || "断言"}不成立`);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function mount(opts) {
  const env = createEnv();
  const elementRef = { current: env.element };
  const driver = createDriver(HOOKS.useWorkbenchFullscreen, elementRef, {
    document: env.doc,
    window: env.win,
    ...(opts || {}),
  });
  return { env, elementRef, driver, fs: () => driver.api };
}

// ───────────────────────────────────────────────────────────── 1. 进入全屏
check("enter() 同步置位（不等原生 promise）", () => {
  const { driver, fs } = mount();
  ok(fs().expanded === false, "初始应为 false");
  void fs().enter();
  ok(fs().expanded === true, "调用后应当立刻为 true（CSS 兜底先行）");
  driver.unmount();
});

check("enter() 会真的调 requestFullscreen", async () => {
  const { env, driver, fs } = mount();
  void fs().enter();
  eq(env.calls.request, 1, "requestFullscreen 调用次数");
  driver.unmount();
});

check("原生拒绝时仍留在铺满状态", async () => {
  const { env, driver, fs } = mount();
  env.element.__reject = true;
  await fs().enter();
  await tick();
  ok(fs().expanded === true, "被拒后 expanded 应为 true（CSS 兜底）");
  eq(env.doc.fullscreenElement, null, "原生全屏元素");
  driver.unmount();
});

// ───────────────────────────────────────────────────────────── 2. 退出全屏
check("exit() 清状态并调 exitFullscreen", async () => {
  const { env, driver, fs } = mount();
  await fs().enter();
  await tick();
  ok(fs().expanded === true, "进入后应为 true");
  await fs().exit();
  await tick();
  ok(fs().expanded === false, "退出后应为 false");
  ok(env.calls.exit >= 1, "应当调用过 exitFullscreen");
  driver.unmount();
});

check("别人占着全屏时不动别人的全屏", async () => {
  const { env, driver, fs } = mount();
  // 不调 enter()：这里要的是「我们没进过全屏，但别人占着」这一种。
  // 真浏览器里对我们自己元素调 requestFullscreen 会把别人的顶掉，
  // 所以那一步会把场景变成「我们占着」，测不出这条。
  env.doc.fullscreenElement = { id: "shot-zoom" };
  env.fire("fullscreenchange");
  await fs().exit();
  await tick();
  eq(env.calls.exit, 0, "不应调用 exitFullscreen");
  ok(fs().expanded === false, "自己的状态要清掉");
  driver.unmount();
});

// ─────────────────────────────────────────────────────── 3. 连点（过期请求）
check("进入后立刻退出：迟到的原生批准不能把界面拽回全屏", async () => {
  const { env, driver, fs } = mount();
  let release;
  env.element.__defer = { promise: new Promise((r) => { release = r; }) };
  const entering = fs().enter();
  await fs().exit();
  await tick();
  ok(fs().expanded === false, "退出后应为 false");
  release();
  await entering;
  await tick();
  ok(fs().expanded === false, "迟到的批准不得把状态改回 true");
  ok(env.calls.exit >= 1, "迟到的批准要顺手把原生全屏收掉");
  driver.unmount();
});

// ──────────────────────────────────────────────────── 4. fullscreenchange 同步
check("外部触发全屏 → 状态跟上", async () => {
  const { env, driver, fs } = mount();
  ok(fs().expanded === false, "初始 false");
  env.doc.fullscreenElement = env.element;
  env.fire("fullscreenchange");
  ok(fs().expanded === true, "应同步为 true");
  driver.unmount();
});

check("子元素全屏 → 不动外层状态", async () => {
  const { env, driver, fs } = mount();
  const child = { id: "session-map" };
  env.element.children.add(child);
  env.doc.fullscreenElement = child;
  env.fire("fullscreenchange");
  ok(fs().expanded === false, "子元素全屏不应点亮外层");
  driver.unmount();
});

check("无关元素全屏 → 不动外层状态", async () => {
  const { env, driver, fs } = mount();
  env.doc.fullscreenElement = { id: "somewhere-else" };
  env.fire("fullscreenchange");
  ok(fs().expanded === false, "无关元素全屏不应点亮外层");
  driver.unmount();
});

// ────────────────────────────────────────────────────────────── 5. Escape
check("Escape 退出", async () => {
  const { env, driver, fs } = mount();
  await fs().enter();
  await tick();
  ok(fs().expanded === true, "进入后 true");
  let prevented = false;
  env.fire("keydown", { key: "Escape", preventDefault() { prevented = true; }, stopPropagation() {} });
  await tick();
  ok(fs().expanded === false, "Escape 后应为 false");
  ok(prevented, "应当 preventDefault");
  driver.unmount();
});

check("有模态浮层时 Escape 不退出", async () => {
  const { env, driver, fs } = mount();
  env.element.__overlay = { id: "modal" };
  await fs().enter();
  await tick();
  env.fire("keydown", { key: "Escape", preventDefault() {}, stopPropagation() {} });
  await tick();
  ok(fs().expanded === true, "浮层开着时不该把工作台收掉");
  driver.unmount();
});

check("没展开时 Escape 什么也不做", async () => {
  const { env, driver, fs } = mount();
  let prevented = false;
  env.fire("keydown", { key: "Escape", preventDefault() { prevented = true; }, stopPropagation() {} });
  await tick();
  ok(fs().expanded === false, "状态不变");
  ok(!prevented, "不该 preventDefault");
  driver.unmount();
});

// ───────────────────────────────────────────────────────────── 6. 卸载清理
check("卸载时收掉自己占的原生全屏", async () => {
  const { env, driver, fs } = mount();
  await fs().enter();
  await tick();
  ok(env.calls.exit === 0, "此时还没退出过");
  driver.unmount();
  await tick();
  ok(env.calls.exit >= 1, "卸载应调用 exitFullscreen");
});

check("卸载时若全屏不是自己的，不动", async () => {
  const { env, driver, fs } = mount();
  await fs().enter();
  await tick();
  env.doc.fullscreenElement = { id: "stranger" };
  const before = env.calls.exit;
  driver.unmount();
  await tick();
  eq(env.calls.exit, before, "不应调用 exitFullscreen");
});

// ───────────────────────────────────────────────────────────── 7. 纯函数
check("rtFullContains 只管「包含子节点」，同节点必须为 false", () => {
  const child = { id: "child" };
  const el = { contains(node) { return node === child; } };
  ok(HOOKS.rtFullContains(el, el) === false, "同节点必须为 false —— 否则 Escape 会被当成有子浮层而失效");
  ok(HOOKS.rtFullContains(el, child) === true, "子节点应为 true");
  ok(HOOKS.rtFullContains(null, el) === false, "null 父节点");
  ok(HOOKS.rtFullContains(el, null) === false, "null 子节点");
});

check("rtFullNativeElement 优先读 target 自己的 root", () => {
  const target = {
    getRootNode() { return { fullscreenElement: "shadow-full" }; },
    matches() { return false; },
  };
  const doc = { fullscreenElement: "document-full" };
  eq(HOOKS.rtFullNativeElement(doc, target), "shadow-full", "应读 root 而非 document");
});

check("rtFullNativeElement 无 root 时退回 document", () => {
  const target = { getRootNode() { return null; }, matches() { return false; } };
  eq(HOOKS.rtFullNativeElement({ fullscreenElement: "document-full" }, target), "document-full");
});

// ───────────────────────────────────────────────────────────────── 汇总
let pass = 0;
const failures = [];
for (const t of tests) {
  try {
    await t.fn();
    pass += 1;
  } catch (e) {
    failures.push(`${t.name} → ${e && e.message ? e.message : e}`);
  }
}

if (failures.length) {
  console.error(`\n✗ test-fullscreen：${failures.length} 条失败 / ${pass + failures.length} 条\n`);
  for (const f of failures) console.error("  · " + f);
  process.exit(1);
}
console.log(`✓ test-fullscreen：${pass} 通过 / 0 失败`);
