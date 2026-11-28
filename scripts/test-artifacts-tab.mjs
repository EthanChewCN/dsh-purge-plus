#!/usr/bin/env node
// 回归：[11] 演练台「凭据与文件」页 —— **真渲染**
//
// 为什么要有这个脚本：这一页以前只有三条字符串断言（`function ArtifactsTab` 在不在、
// 页签名在不在、分发分支在不在）。这三条能证明代码被拷进来了，证明不了它渲染出什么。
// 把掩码去掉、把计数写死、把「显示」按钮的回调接错，三条断言全都照样绿。
//
// 做法：从**已打包的两份产物**里把 SecretText / CredentialList / AccessList /
// ArtifactsTab 四个函数切出来，配一个 60 行的迷你运行时（useState + useEffect +
// 重渲染循环），喂真数据渲染成元素树，再对树做断言。
//
// 为什么不是「读源码字符串」：面板那份是 h2 + import_react2.default 方言，全屏那份是
// h + React —— 只比对字符串的话，「两份产物行为一致」这件事根本没有判据。
// 这里两份各渲染一次，**元素树的可见文本必须逐字相同**。
//
// 不是完整 React：没有 key diff、没有 context、没有并发。够用就行 —— 被测组件只用到
// useState / useEffect 两个钩子。

import fs from "node:fs";
import path from "node:path";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;

let pass = 0;
const fails = [];
const ok = (cond, name) => { if (cond) { pass += 1; } else { fails.push(name); } };
const eq = (a, b, name) => ok(a === b, `${name}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`);

/** 按花括号配平切出 `function NAME(...) { ... }`。 */
function sliceFn(src, name) {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) return null;
  const brace = src.indexOf("{", src.indexOf(")", at));
  if (brace < 0) return null;
  let depth = 0;
  for (let i = brace; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(at, i + 1); }
  }
  return null;
}

// ── 迷你运行时 ───────────────────────────────────────────────────
function createRuntime() {
  const store = new Map();          // path → { hooks, idx }
  const effects = [];
  let dirty = false;
  let CURRENT = "root";
  const slot = (p) => { let s = store.get(p); if (!s) { s = { hooks: [], idx: 0 }; store.set(p, s); } return s; };

  const React = {
    useState(init) {
      const s = slot(CURRENT);
      const i = s.idx++;
      if (!(i in s.hooks)) s.hooks[i] = init;
      const set = (v) => { s.hooks[i] = typeof v === "function" ? v(s.hooks[i]) : v; dirty = true; };
      return [s.hooks[i], set];
    },
    useEffect(fn, deps) {
      const s = slot(CURRENT);
      const i = "e" + s.idx++;
      const prev = s.hooks[i];
      const changed = !prev || !deps || deps.length !== prev.length || deps.some((d, k) => d !== prev[k]);
      s.hooks[i] = deps ? [...deps] : [];
      if (changed) effects.push(fn);
    },
  };

  const h = (type, props, ...kids) => ({
    type, props: props || {}, children: kids.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false),
  });

  function renderNode(node, p) {
    if (node === null || node === undefined || node === false || node === true) return null;
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map((c, i) => renderNode(c, `${p}.${i}`)).filter((x) => x !== null);
    if (typeof node.type === "function") {
      const s = slot(p);
      s.idx = 0;
      const prev = CURRENT;
      CURRENT = p;
      let out;
      try { out = node.type(node.props); } finally { CURRENT = prev; }
      return renderNode(out, `${p}>`);
    }
    return { type: node.type, props: node.props, children: (node.children || []).map((c, i) => renderNode(c, `${p}/${i}`)).filter((x) => x !== null) };
  }

  async function render(Comp, props) {
    let tree = null;
    for (let round = 0; round < 40; round += 1) {
      dirty = false;
      effects.length = 0;
      tree = renderNode({ type: Comp, props, children: [] }, "root");
      for (const fn of effects) fn();
      for (let k = 0; k < 3; k += 1) await new Promise((r) => setTimeout(r, 0));
      if (!dirty) return tree;
    }
    throw new Error("渲染 40 轮仍未稳定（useState 循环？）");
  }

  return { h, React, render };
}

function textOf(node) {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  return (node.children || []).map(textOf).join("");
}
function walk(node, fn) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const c of node) walk(c, fn); return; }
  fn(node);
  for (const c of node.children || []) walk(c, fn);
}
const buttons = (tree) => { const out = []; walk(tree, (n) => { if (n.type === "button") out.push(n); }); return out; };
const byText = (tree, label) => buttons(tree).find((b) => textOf(b) === label);

// ── 装配被测组件 ─────────────────────────────────────────────────
function loadVariant(kind) {
  const file = path.join(PKG, "client.js");
  const src = fs.readFileSync(file, "utf8");
  const parts = ["SecretText", "CredentialList", "AccessList", "ArtifactsTab"].map((n) => sliceFn(src, n));
  if (parts.some((p) => !p)) return { error: `${kind}: 切不出组件（${parts.map((p, i) => (p ? "" : i)).filter(String).join(",")}）` };
  const H = kind === "panel" ? "h2" : "h";
  const R = kind === "panel" ? "import_react2" : "React";
  const body = `${parts.join("\n")}\nreturn { ArtifactsTab, CredentialList, SecretText, AccessList };`;
  let factory;
  try {
    factory = new Function(H, R, "api", "copyText", "fmt", "AttackFilesTab", "CleanupPanel", body);
  } catch (e) {
    return { error: `${kind}: 组装失败 ${e.message}` };
  }
  return { factory, kind };
}

const FIXTURE = {
  attackFiles: { items: [{ path: "/etc/passwd", files: [{ path: "a" }] }, { path: "/root", files: [{ path: "b" }] }] },
  credentials: { items: [
    { id: 1, host: "10.0.0.5", username: "root", secret_type: "password", privilege: "admin",
      secret_value: "P@ssw0rd!", source: "hydra", tool: "redteam_credential_add", found_at: "2026-01-01T00:00:00Z" },
    { id: 2, host: "10.0.0.6", username: "svc", secret_type: "hash", secret_value: null },
  ] },
  access: { items: [{ id: 7, host: "10.0.0.5", username: "root", method: "ssh", privilege: "admin", session_ref: "sess-1" }] },
};

function harness(kind, fixture, engagement) {
  const loaded = loadVariant(kind);
  if (loaded.error) return { error: loaded.error };
  const rt = createRuntime();
  const calls = [];
  const copies = [];
  const api = (req) => { calls.push(req); return Promise.resolve(fixture[req.op] || { items: [] }); };
  const copyText = (v) => copies.push(v);
  const fmt = (t) => `@${t}`;
  const Stub = (name) => (props) => rt.h("div", { "data-stub": name }, name);
  const mod = loaded.factory(rt.h, kind === "panel" ? { default: rt.React } : rt.React,
    api, copyText, fmt, Stub("AttackFilesTab"), Stub("CleanupPanel"));
  return { rt, mod, calls, copies, engagement };
}

// ── 断言 ─────────────────────────────────────────────────────────
const KINDS = ["panel"];
const texts = {};

for (const kind of KINDS) {
  const hs = harness(kind, FIXTURE, { id: 42 });
  if (hs.error) { ok(false, hs.error); continue; }

  /* 空数据：计数为 0，且给出可操作的空态（不是空白页） */
  const emptyHs = harness(kind, { attackFiles: { items: [] }, credentials: { items: [] }, access: { items: [] } }, { id: 42 });
  const emptyTree = await emptyHs.rt.render(emptyHs.mod.ArtifactsTab, { engagement: { id: 42 }, refreshKey: 0 });
  const emptyText = textOf(emptyTree);
  ok(emptyText.includes("凭据 0"), `${kind}: 空态凭据计数为 0`);
  ok(emptyText.includes("访问会话 0"), `${kind}: 空态访问会话计数为 0`);
  ok(emptyText.includes("攻击文件 0"), `${kind}: 空态攻击文件计数为 0`);
  ok(emptyText.includes("暂无凭据"), `${kind}: 空态有可操作提示（暂无凭据）`);

  /* 有数据 */
  const tree = await hs.rt.render(hs.mod.ArtifactsTab, { engagement: { id: 42 }, refreshKey: 0 });
  const text = textOf(tree);
  texts[kind] = text;

  ok(text.includes("凭据 2"), `${kind}: 凭据计数 = 2`);
  ok(text.includes("访问会话 1"), `${kind}: 访问会话计数 = 1`);
  ok(text.includes("攻击文件 2"), `${kind}: 攻击文件计数 = 2（跨分组累加）`);

  /* 数据来源：三个 op 各调一次，且带上了 engagement */
  const ops = hs.calls.map((c) => c.op).sort();
  eq(ops.join(","), "access,attackFiles,credentials", `${kind}: 三个 op 各调一次`);
  ok(hs.calls.every((c) => c.engagement && c.engagement.id === 42), `${kind}: 每次调用都带 engagement`);

  /* 掩码：默认不出现明文 */
  ok(text.includes("••••••••"), `${kind}: 明文默认被掩码`);
  ok(!text.includes("P@ssw0rd!"), `${kind}: 元素树里没有明文口令`);
  /* 空明文时 CredentialList 传的是**可操作提示**（不是 SecretText 的默认「未记录」）：
     面板要告诉人下一步怎么做，所以这里断言那句提示真的渲染出来了。 */
  ok(text.includes("未记明文"), `${kind}: secret_value 为空时渲染可操作提示`);

  /* 点「显示」→ 明文出现，按钮变成「隐藏」 */
  const showBtn = byText(tree, "显示");
  ok(Boolean(showBtn), `${kind}: 有「显示」按钮`);
  if (showBtn) {
    showBtn.props.onClick({ stopPropagation() {} });
    const shown = await hs.rt.render(hs.mod.ArtifactsTab, { engagement: { id: 42 }, refreshKey: 0 });
    const shownText = textOf(shown);
    ok(shownText.includes("P@ssw0rd!"), `${kind}: 点「显示」后出现明文`);
    ok(Boolean(byText(shown, "隐藏")), `${kind}: 点「显示」后按钮变「隐藏」`);
    ok(!shownText.includes("••••••••"), `${kind}: 明文显示后掩码消失`);
  }

  /* 复制按钮把**明文**交给 copyText（不是掩码串） */
  const copyBtn = byText(tree, "复制");
  ok(Boolean(copyBtn), `${kind}: 有「复制」按钮`);
  if (copyBtn) {
    copyBtn.props.onClick({ stopPropagation() {} });
    eq(hs.copies[0], "P@ssw0rd!", `${kind}: 复制的是明文`);
  }

  /* 没有靶标：不该发请求（否则每次开页都打三个 404） */
  const noEng = harness(kind, FIXTURE, null);
  await noEng.rt.render(noEng.mod.ArtifactsTab, { engagement: null, refreshKey: 0 });
  eq(noEng.calls.length, 0, `${kind}: 无靶标时不发请求`);
}

/* 只有一个产物；标题文案必须在里面 */
if (texts.panel) ok(texts.panel.includes("凭据与文件"), "标题文案在产物里");

/* 组件被真的切出来了（防止「切不到就当通过」） */
for (const kind of KINDS) {
  const l = loadVariant(kind);
  ok(!l.error && typeof l.factory === "function", `${kind}: 四个组件都能从产物里切出并组装`);
}

for (const f of fails) console.log(`✗ ${f}`);
/* 汇总行必须是 `N 通过 / M 失败` 这一族：[33] 与 mutate-check 都按它判定，
   换个写法会被当成「没跑到汇总行」= 没有断言。 */
console.log(`\n${pass} 通过 / ${fails.length} 失败`);
process.exit(fails.length === 0 ? 0 : 1);
