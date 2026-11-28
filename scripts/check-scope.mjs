#!/usr/bin/env node
// [dsh-purge-plus] 作用域闸门：产物里不允许存在「引用了本文件里没声明的名字」。
//
// 为什么需要它：面板的 19 个 snippet 按方言改写（IIFE 内 h2/import_react2/api，
// 顶层 h/import_react/apiUrl）。改写是按名字做的，位置错了产物语法照样合法、
// 构建照样全绿，只在浏览器渲染那一刻炸 ReferenceError —— 已经栽过三次：
//   h2（兜底组件里）· api（待办角标里）· needsAttentionRow（自检分组里）。
// 三次的共同形状：**顶层引用了只在 IIFE 里存在的名字**。语法检查看不见，
// 单测也看不见（测试只加载被单独 import 的函数）。
//
// 判据（AST 级，不靠正则）：
//   1. 解析产物里**每一个** .js/.mjs 的 AST（324 个，不是 2 个）；
//   2. 建作用域树（Program / function / block / catch / for）+ 认 import 绑定；
//   3. 每个标识符引用沿作用域链回溯，回溯不到、且不在全局白名单里 → 失败。
//
// 为什么从 2 个扩到全包：`lib/skills.js:81` 的 `fs.realpathSync` 也是同一个病
// （只 import 了 `promises as fsp`，没声明 `fs`），但它在 `try` 里被
// `catch { return abs }` 吃掉，于是「防顺着软链删穿 skills」的守卫退化成纯字符串
// 比较 —— 判据完全正确，只是覆盖面 2/324。覆盖面本身就是判据的一部分。
//
// 全局白名单只放「宿主或语言真的提供的」名字，不放本文件的任何名字 ——
// 否则这个闸门会退化成「名字出现过就算数」。

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(import.meta.dirname, "..");
// 两种运行位置（与 verify.mjs 同规则）：仓库里用 dist/build/package，装好的包里 ROOT 就是包根。
// DSH_PURGE_PKG 用于变异实验：拿副本跑，不碰真产物。
const BUILD_PKG = path.join(ROOT, "dist", "build", "package");
const PKG = process.env.DSH_PURGE_PKG
  || (fs.existsSync(BUILD_PKG) ? BUILD_PKG : ROOT);

// acorn 由宿主（DeepSeek Harness 的 node_modules）提供：本仓库不装依赖，
// 构建本来就依赖宿主目录里的 vendor/community，多依赖一个解析器不算新增耦合。
const ACORN_BASES = [
  ROOT,
  process.env.DSH_ACORN_BASE,
  "/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh",
  path.join(process.env.HOME || "", "Applications/DeepSeek Harness.app/Contents/Resources/app/dsh"),
].filter(Boolean);

function loadAcorn() {
  for (const base of ACORN_BASES) {
    try {
      const req = createRequire(path.join(base, "scope-probe.js"));
      return req("acorn");
    } catch {
      /* 下一个候选 */
    }
  }
  return null;
}

const acorn = loadAcorn();

// 语言内建 + 浏览器/宿主全局。原则：这里出现的名字，删掉本文件任何一行都不会消失。
const GLOBALS = new Set([
  "undefined", "NaN", "Infinity", "arguments", "globalThis", "eval", "Function",
  "isFinite", "isNaN", "parseInt", "parseFloat", "encodeURIComponent", "decodeURIComponent",
  "encodeURI", "decodeURI", "escape", "unescape",
  "Object", "Array", "String", "Number", "Boolean", "Symbol", "BigInt", "Math", "JSON",
  "Date", "RegExp", "Error", "TypeError", "RangeError", "SyntaxError", "Promise",
  "Map", "Set", "WeakMap", "WeakSet", "Proxy", "Reflect", "Intl", "ArrayBuffer",
  "Uint8Array", "Uint16Array", "Uint32Array", "Int8Array", "Int16Array", "Int32Array",
  "Float32Array", "Float64Array", "DataView", "TextEncoder", "TextDecoder",
  "structuredClone", "queueMicrotask", "reportError", "atob", "btoa", "crypto",
  "window", "document", "navigator", "location", "history", "screen", "performance",
  "localStorage", "sessionStorage", "indexedDB", "caches", "self", "top", "parent",
  "frames", "name", "origin", "open", "close", "focus", "blur", "alert", "confirm",
  "prompt", "print", "scrollTo", "scrollBy", "postMessage", "addEventListener",
  "removeEventListener", "dispatchEvent", "getComputedStyle", "matchMedia",
  "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout",
  "setInterval", "clearInterval", "fetch", "Response", "Request", "Headers",
  "Event", "CustomEvent", "EventTarget", "AbortController", "AbortSignal",
  "URL", "URLSearchParams", "Blob", "File", "FileReader", "FormData", "Image",
  "XMLHttpRequest", "WebSocket", "Worker", "MessageChannel", "Notification",
  "DOMParser", "Node", "Element", "HTMLElement", "DocumentFragment", "CSS",
  "MutationObserver", "IntersectionObserver", "ResizeObserver", "ClipboardItem",
  "process", "console", "require", "module", "exports", "__dirname", "__filename",
  "Buffer", "setImmediate", "clearImmediate", "performance",
  "Atomics", "SharedArrayBuffer", "DOMException",
]);

/** 从 `typeof X === "function"` / `"function" === typeof X` 里取出 X。 */
function typeofGuardName(test) {
  if (!test || test.type !== "BinaryExpression") return null;
  const eq = test.operator === "===" || test.operator === "==";
  if (!eq) return null;
  const pairs = [[test.left, test.right], [test.right, test.left]];
  for (const [side, other] of pairs) {
    if (side && side.type === "UnaryExpression" && side.operator === "typeof"
      && side.argument && side.argument.type === "Identifier"
      && other && other.type === "Literal" && other.value === "function") {
      return side.argument.name;
    }
  }
  return null;
}

/** 建作用域树 + 收集引用。返回 [{name, line, column, scopeChain}] 形式的未解析引用。 */
function analyse(source, filename, sourceType = "script") {
  const ast = acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType,
    locations: true,
    allowHashBang: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  });

  const declared = new Map();          // scope -> Set(names)
  const parentOf = new Map();          // scope -> parent scope
  let nextScope = 0;
  const rootScope = nextScope++;
  declared.set(rootScope, new Set());
  parentOf.set(rootScope, null);

  const newScope = (parent, kind) => {
    const id = nextScope++;
    declared.set(id, new Set());
    parentOf.set(id, parent);
    kinds.set(id, kind);
    return id;
  };
  const kinds = new Map([[rootScope, "program"]]);

  const declare = (scope, name) => {
    if (!name) return;
    declared.get(scope).add(name);
  };

  /** var 提升到最近的函数作用域；let/const/class 留在当前块。 */
  const hoistTarget = (scope) => {
    let s = scope;
    while (s !== null && kinds.get(s) === "block") s = parentOf.get(s);
    return s === null ? rootScope : s;
  };

  const references = [];

  function patternNames(node, out) {
    if (!node) return;
    switch (node.type) {
      case "Identifier": out.push(node.name); break;
      case "ObjectPattern":
        for (const p of node.properties) {
          if (p.type === "RestElement") patternNames(p.argument, out);
          else patternNames(p.value, out);
        }
        break;
      case "ArrayPattern": for (const el of node.elements) patternNames(el, out); break;
      case "RestElement": patternNames(node.argument, out); break;
      case "AssignmentPattern": patternNames(node.left, out); break;
      default: break;
    }
  }

  function isReference(node, parent) {
    if (!parent) return true;
    switch (parent.type) {
      case "MemberExpression": return parent.object === node;
      case "Property": return parent.computed ? parent.key !== node : parent.value === node;
      case "MethodDefinition":
      case "PropertyDefinition": return parent.computed ? parent.key !== node : parent.value === node;
      case "LabeledStatement":
      case "BreakStatement":
      case "ContinueStatement": return false;
      case "VariableDeclarator": return parent.init === node;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression": return parent.body === node || (parent.params || []).includes(node) === false && parent.body === node;
      case "ClassDeclaration":
      case "ClassExpression": return parent.superClass === node;
      case "ExportSpecifier":
      case "ImportSpecifier":
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier": return false;
      case "CatchClause": return parent.param !== node;
      // typeof 的操作数永不抛 ReferenceError，属有意防御，不算越界
      case "UnaryExpression": return !(parent.operator === "typeof");
      default: return true;
    }
  }

  function walk(node, scope, parent, guarded = null) {
    if (!node || typeof node.type !== "string") return;

    switch (node.type) {
      case "Program": {
        for (const stmt of node.body) walk(stmt, scope, node, guarded);
        return;
      }
      case "ImportDeclaration": {
        // ESM 绑定算声明：`import { promises as fsp } from "node:fs"` 之后
        // `fsp` 是合法的，`fs` 不是 —— 这正是 lib/skills.js 那处幽灵的形状。
        for (const sp of node.specifiers || []) {
          if (sp.local && sp.local.name) declare(rootScope, sp.local.name);
        }
        return;
      }
      case "ExportNamedDeclaration": {
        if (node.declaration) walk(node.declaration, scope, node, guarded);
        return;
      }
      case "ExportDefaultDeclaration": {
        const d = node.declaration;
        if (d && (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration")) walk(d, scope, node, guarded);
        else if (d) walk(d, scope, node, guarded);
        return;
      }
      case "ExportAllDeclaration": return;
      // `import.meta` 是语法节点，不是对标识符 import 的引用
      case "MetaProperty": return;
      case "VariableDeclaration": {
        const target = node.kind === "var" ? hoistTarget(scope) : scope;
        for (const d of node.declarations) {
          const names = [];
          patternNames(d.id, names);
          for (const n of names) declare(target, n);
          if (d.init) walk(d.init, scope, d);
        }
        return;
      }
      case "FunctionDeclaration": {
        declare(scope, node.id && node.id.name);
        const fnScope = newScope(scope, "function");
        for (const p of node.params) {
          const names = [];
          patternNames(p, names);
          for (const n of names) declare(fnScope, n);
        }
        // 默认参数在函数作用域内求值
        for (const p of node.params) walk(p, fnScope, node);
        if (node.body.type === "BlockStatement") {
          for (const stmt of node.body.body) walk(stmt, fnScope, node.body);
        } else walk(node.body, fnScope, node);
        return;
      }
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        const fnScope = newScope(scope, "function");
        if (node.id) declare(fnScope, node.id.name);
        for (const p of node.params) {
          const names = [];
          patternNames(p, names);
          for (const n of names) declare(fnScope, n);
        }
        for (const p of node.params) walk(p, fnScope, node);
        if (node.body.type === "BlockStatement") {
          for (const stmt of node.body.body) walk(stmt, fnScope, node.body);
        } else walk(node.body, fnScope, node);
        return;
      }
      case "BlockStatement": {
        const blockScope = newScope(scope, "block");
        for (const stmt of node.body) walk(stmt, blockScope, node);
        return;
      }
      case "CatchClause": {
        const catchScope = newScope(scope, "block");
        const names = [];
        patternNames(node.param, names);
        for (const n of names) declare(catchScope, n);
        walk(node.body, catchScope, node);
        return;
      }
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        const forScope = newScope(scope, "block");
        for (const key of ["init", "left", "right", "test", "update", "body"]) {
          if (node[key]) walk(node[key], forScope, node);
        }
        return;
      }
      case "ClassDeclaration": {
        declare(scope, node.id && node.id.name);
        if (node.superClass) walk(node.superClass, scope, node);
        walk(node.body, scope, node);
        return;
      }
      case "ClassExpression": {
        const clsScope = newScope(scope, "block");
        if (node.id) declare(clsScope, node.id.name);
        if (node.superClass) walk(node.superClass, clsScope, node);
        walk(node.body, clsScope, node);
        return;
      }
      case "ConditionalExpression": {
        // `typeof NAME === "function" ? NAME(...) : ...` —— 守卫分支里的 NAME
        // 只会在它确实是函数时执行，永不抛 ReferenceError，按设计放行。
        const guardedName = typeofGuardName(node.test);
        walk(node.test, scope, node, guarded);
        if (guardedName !== null) {
          const inner = new Set(guarded || []);
          inner.add(guardedName);
          walk(node.consequent, scope, node, inner);
        } else {
          walk(node.consequent, scope, node, guarded);
        }
        walk(node.alternate, scope, node, guarded);
        return;
      }
      case "Identifier": {
        if (isReference(node, parent)) {
          references.push({ name: node.name, line: node.loc.start.line, column: node.loc.start.column + 1, scope, guarded: guarded !== null && guarded.has(node.name) });
        }
        return;
      }
      default: break;
    }

    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === "string") walk(child, scope, node, guarded);
        }
      } else if (value && typeof value.type === "string") {
        walk(value, scope, node, guarded);
      }
    }
  }

  walk(ast, rootScope, null);

  const resolves = (scope, name) => {
    let s = scope;
    while (s !== null && s !== undefined) {
      if (declared.get(s).has(name)) return true;
      s = parentOf.get(s);
    }
    return false;
  };

  const unresolved = [];
  for (const ref of references) {
    if (resolves(ref.scope, ref.name)) continue;
    if (GLOBALS.has(ref.name)) continue;
    if (ref.guarded) continue;
    unresolved.push(ref);
  }
  return { unresolved, referenceCount: references.length, scopeCount: nextScope };
}

// 覆盖面就是判据的一部分：审计前这里只写死 client.js + lib/redteam/client.js，
// 324 个文件覆盖 2 个（0.6%），而 lib/skills.js 那处死守卫正是被漏掉的那一类。
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "vendor", "out", "build"]);
// overlay/snippets/* 是**注入片段**，按设计只在大文件里的特定位置成立，
// 单独拿出来本来就不是完整程序（顶层 return / 半截对象字面量）。它们由
// 注入后的产物覆盖 —— 那才是要查的对象。
const SKIP_PATHS = [/^overlay\/snippets\//];

function discoverTargets(root) {
  const out = [];
  const walkDir = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walkDir(path.join(dir, e.name), childRel);
      } else if (e.isFile() && /\.(?:js|mjs|cjs)$/.test(e.name)) {
        if (SKIP_PATHS.some((re) => re.test(childRel))) continue;
        out.push(childRel);
      }
    }
  };
  walkDir(root, "");
  return out.sort();
}

const TARGETS = discoverTargets(PKG);

// 没有 acorn 时的退路：只查「IIFE 内的名字被顶层引用」这一种形状。
// 三个历史 bug 里 h2 / api 属于这种；needsAttentionRow（全文件无声明）需要 AST 才看得见。
function fallbackIIFELeak(source, rel) {
  const end = source.indexOf("\n// src/state/dock.js");
  const start = end < 0 ? -1 : source.lastIndexOf("var __dshPurgeDrill = (() => {", end);
  if (start < 0) return { leaks: [], note: "找不到演练台 IIFE，跳过" };
  const inner = source.slice(start, end);
  const outer = source.slice(0, start) + source.slice(end);
  const names = new Set();
  const re = /(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(inner)) !== null) names.add(m[1]);
  const leaks = [];
  for (const name of names) {
    if (GLOBALS.has(name)) continue;
    const use = new RegExp(`(?<![.\\w$])${name.replace(/\$/g, "\\$")}\\s*[(=.,;)\\]}]`, "g");
    let hit;
    while ((hit = use.exec(outer)) !== null) {
      const line = outer.slice(0, hit.index).split("\n").length;
      leaks.push({ name, line, column: 1, rel });
    }
  }
  return { leaks };
}

let failed = 0;
let totalRefs = 0;
let totalScopes = 0;
let scanned = 0;
const parseFailures = [];
const usingAst = acorn !== null;

if (!usingAst) {
  console.log("· 未找到 acorn，退化为 IIFE 泄漏检查（只覆盖 h2/api 这一种形状）");
}

/** 先按 ESM 解析，失败再按脚本解析：两种方言都在产物里存在。 */
function parseEither(source, rel) {
  const looksEsm = /^\s*(?:import|export)\b/m.test(source);
  const order = looksEsm ? ["module", "script"] : ["script", "module"];
  let lastError = null;
  for (const st of order) {
    try {
      return { result: analyse(source, rel, st), sourceType: st };
    } catch (e) {
      lastError = e;
    }
  }
  return { error: lastError };
}

for (const rel of TARGETS) {
  const file = path.join(PKG, rel);
  if (!fs.existsSync(file)) {
    console.error(`✗ 缺少产物：${rel}`);
    process.exit(1);
  }
  const source = fs.readFileSync(file, "utf8");

  if (!usingAst) {
    const { leaks, note } = fallbackIIFELeak(source, rel);
    if (note) console.log(`· ${rel}：${note}`);
    if (leaks.length === 0) {
      console.log(`✓ ${rel}：顶层未引用 IIFE 局部名`);
      continue;
    }
    failed += leaks.length;
    console.error(`✗ ${rel}：${leaks.length} 处顶层引用了 IIFE 局部名`);
    for (const r of leaks) console.error(`    ${rel}:${r.line}  ${r.name}`);
    continue;
  }

  const parsed = parseEither(source, rel);
  if (parsed.error) {
    // 解析不了的文件本身就是坏产物（例如 hashbang 不在第 1 行）。
    parseFailures.push({ rel, message: parsed.error.message });
    continue;
  }
  const result = parsed.result;
  scanned += 1;
  totalRefs += result.referenceCount;
  totalScopes += result.scopeCount;
  const seen = new Set();
  const bad = result.unresolved.filter((r) => {
    const key = `${r.name}@${r.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (bad.length === 0) continue;

  failed += bad.length;
  console.error(`✗ ${rel}：${bad.length} 处引用了本文件没有声明的名字`);
  const lines = source.split("\n");
  for (const r of bad) {
    console.error(`    ${rel}:${r.line}:${r.column}  ${r.name}`);
    console.error(`      ${(lines[r.line - 1] || "").trim().slice(0, 140)}`);
  }
}

for (const p of parseFailures) {
  console.error(`✗ ${p.rel} 解析失败：${p.message}`);
}
failed += parseFailures.length;

if (failed > 0) {
  console.error(`\n✗ 作用域闸门：${failed} 处问题（扫了 ${scanned}/${TARGETS.length} 个文件，共 ${totalRefs} 个引用）`);
  process.exit(1);
}
console.log(usingAst
  ? `✓ 作用域闸门：${scanned} 个文件 · ${totalRefs} 个标识符引用 · ${totalScopes} 个作用域 · 0 个越界`
  : "✓ 作用域闸门：退化模式通过");
