#!/usr/bin/env node
// 回归：[10] 界面版本一致性 —— **真求值**，不是查字符串
//
// 这一组原来只有「`js.includes("Plus " + version)`」这类断言：版本号写对了没有
// 判据，但**版本不一致时会不会提示**没有。而那条提示是升级后最常见的故障现场
// （面板还是旧包、宿主已经换了新包，设置页看起来「不生效」）。
//
// 做法：从产物里切出 `function VersionNotice({ info })`，喂四种 info 求值，
// 断言它返回 null 还是返回一条带 role="status" 的告警。
//
// 判据的关键一条：**版本相同必须返回 null**。把 `===` 改成 `!==` 会立刻红。

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

const VERSION = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).version;
const src = fs.readFileSync(path.join(PKG, "client.js"), "utf8");

function sliceFn(text, name) {
  const at = text.indexOf(`function ${name}(`);
  if (at < 0) return null;
  const brace = text.indexOf("{", text.indexOf(")", at));
  let depth = 0;
  for (let i = brace; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") { depth -= 1; if (depth === 0) return text.slice(at, i + 1); }
  }
  return null;
}
const h = (type, props, ...kids) => ({ type, props: props || {}, children: kids.flat(Infinity).filter((x) => x != null) });
const textOf = (n) => (n == null ? "" : typeof n === "string" ? n
  : Array.isArray(n) ? n.map(textOf).join("") : (n.children || []).map(textOf).join(""));

const fnSrc = sliceFn(src, "VersionNotice");
ok(Boolean(fnSrc), "从产物里切出 VersionNotice");
if (!fnSrc) {
  console.log(`\n0 通过 / 1 失败`);
  process.exit(1);
}

let VersionNotice;
try {
  VersionNotice = new Function("h", `${fnSrc}; return VersionNotice;`)(h);
  ok(typeof VersionNotice === "function", "VersionNotice 可求值");
} catch (e) {
  ok(false, `VersionNotice 求值失败：${e.message}`);
  console.log(`\n${pass} 通过 / ${fails.length} 失败`);
  process.exit(1);
}

/* 1) 版本相同 → 什么都不显示（否则每次打开设置页都挂一条假告警） */
eq(VersionNotice({ info: { ok: true, plugin_version: VERSION } }), null, `版本一致（${VERSION}）时不提示`);

/* 2) 版本不同 → 两个版本号都要出现，人才知道该升哪一边 */
{
  const tree = VersionNotice({ info: { ok: true, plugin_version: "9.9.9" } });
  const t = textOf(tree);
  ok(tree && tree.props && tree.props.role === "status", "版本不一致时给出 role=status 的告警");
  ok(t.includes("9.9.9") && t.includes(VERSION), `告警里同时写出两个版本（9.9.9 / ${VERSION}）`);
  ok(/[Ww]arn/.test(String(tree && tree.props && tree.props.className)), "告警用 warn 样式");
}

/* 3) 读不到版本（info 为空 / 没有 plugin_version）→ 不提示，不是报错 */
eq(VersionNotice({ info: null }), null, "info 为 null 时不提示");
eq(VersionNotice({ info: {} }), null, "没有 plugin_version 时不提示");
eq(VersionNotice({}), null, "没有 info 参数时不提示");

/* 4) 状态接口失败 → 必须明说「未知」，不能静默 */
{
  const tree = VersionNotice({ info: { ok: false, error: "ECONNREFUSED" } });
  const t = textOf(tree);
  ok(tree && tree.props && tree.props.role === "status", "状态读取失败时给出 role=status 的告警");
  ok(t.includes("ECONNREFUSED"), "告警里带上原始错误");
  ok(t.includes("未知"), "告警里说明「状态未知」，而不是假装正常");
  /* 失败分支的文案要指出下一步（刷新重试），否则人只会来问「怎么办」 */
  ok(t.includes("刷新"), "失败分支给出下一步（刷新重试）");
  /* 失败分支不带版本号 —— 拿不到版本，写一个出来就是编 */
  ok(!t.includes(VERSION), "失败分支不编造版本号");
}
{
  const t = textOf(VersionNotice({ info: { ok: false } }));
  ok(t.includes("接口不可用"), "失败但无 error 字段时给出兜底文案");
}

/* 5) 两份产物（面板 / 全屏）都要有，且行为一致 —— 只修一份是这一页的老毛病 */
{
  const rt = fs.readFileSync(path.join(PKG, "lib", "redteam", "client.js"), "utf8");
  const rtSrc = sliceFn(rt, "VersionNotice");
  if (!rtSrc) {
    /* 全屏那份可能不含设置页；不含就不要求。含了就必须与面板一致。 */
    ok(true, "全屏产物不含 VersionNotice（跳过一致性）");
  } else {
    const RT = new Function("h", `${rtSrc}; return VersionNotice;`)(h);
    eq(RT({ info: { ok: true, plugin_version: VERSION } }), null, "全屏产物：版本一致时不提示");
    const t = textOf(RT({ info: { ok: true, plugin_version: "9.9.9" } }));
    ok(t.includes("9.9.9") && t.includes(VERSION), "全屏产物：版本不一致时提示两个版本");
  }
}

for (const f of fails) console.log(`✗ ${f}`);
console.log(`\n${pass} 通过 / ${fails.length} 失败`);
process.exit(fails.length === 0 ? 0 : 1);
