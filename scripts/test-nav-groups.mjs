#!/usr/bin/env node
// [dsh-purge-plus] P4 回归：导航分组的**真实逻辑**，不是复制品。
//
// 做法：从构建产物里把 tabs 表、TAB_GROUPS/TAB_ALIASES/groupOf/normalizedTab、
// activateGroup 和分组行那段 h(...) 表达式的**原文**切出来，塞进 new Function 里跑。
// 断言的是装到机器上的那份代码，不是测试里重写一遍的等价物——重写的那份永远会过。
//
// 两段：
//   A 数据与行为：分组完备性、别名归一、未知页签兜底、点分组「留在本组 vs 跳本组第一页」
//   B 渲染：用记录型 h() 跑分组行，检查真渲染出 6 个按钮、选中态与 aria 正确、点了调谁

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 既能在仓库里跑（dist/build/package），也能在**已安装的包里**跑（脚本所在包的根）——
   发布包现在带 test-*.mjs，验收可以对已安装产物复跑（审计 B-5）。 */
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;
const FILES = ["client.js"];

let pass = 0;
let fail = 0;
const ok = (s) => { console.log(`  ✓ ${s}`); pass++; };
const bad = (s) => { console.error(`  ✗ ${s}`); fail++; };

/** 切出 [start, endMarker) 之间的原文；切不到返回 null，调用方必须当失败处理。 */
function slice(src, start, endMarker) {
  const i = src.indexOf(start);
  if (i < 0) return null;
  const j = src.indexOf(endMarker, i);
  if (j < 0) return null;
  return src.slice(i, j);
}

for (const f of FILES) {
  console.log(`\n${f}`);
  const src = fs.readFileSync(path.join(PKG, f), "utf8");

  const tabsBlock = slice(src, "const tabs = [", "const TAB_GROUPS");
  /* 切到 goTab 之前：这样 groupHasUnread 也一起带出来（分组行要用它） */
  const defsBlock = slice(src, "const TAB_GROUPS = [", "const goTab = (tab) => {");
  const actIdx = src.indexOf("const activateGroup =");
  const actLine = actIdx < 0 ? null : src.slice(actIdx, src.indexOf("\n", actIdx));

  /* 分组行表达式：redteam 用 h()，面板那份是 h2() */
  const rowHead = src.includes("h2('div', { className: 'rt-groups'")
    ? "h2('div', { className: 'rt-groups'"
    : "h('div', { className: 'rt-groups'";
  const rowIdx = src.indexOf(rowHead);
  const rowEnd = rowIdx < 0 ? -1 : src.indexOf(": null)))", rowIdx);
  const rowExpr = rowIdx < 0 || rowEnd < 0 ? null : src.slice(rowIdx, rowEnd + ": null)))".length);

  if (!tabsBlock || !defsBlock || !actLine || !rowExpr) {
    bad(`切片失败 tabs=${!!tabsBlock} defs=${!!defsBlock} activate=${!!actLine} row=${!!rowExpr}`);
    continue;
  }

  const prelude = (extra) => [
    "const st = { tab: TAB };",
    `const unreadOf = (t) => UNREAD.indexOf(t) !== -1;`,
    "let picked = null;",
    "const goTab = (t) => { picked = t; };",
    "const navigateGroupKey = () => {};",
    "const h = (tag, props, ...kids) => ({ tag, props: props || {}, kids });",
    "const h2 = h;",
    tabsBlock,
    defsBlock,
    actLine,
    extra,
  ].join("\n");

  /* ── A 数据与行为 ─────────────────────────────────────────── */
  let make;
  try {
    make = new Function("TAB", "UNREAD", prelude(
      "return { TAB_GROUPS, TAB_ALIASES, groupOf, activeGroup, normalizedTab, tabs," +
      "         pick(g) { picked = null; activateGroup(g); return picked; } };"
    ));
    make("assets", []); /* 先试跑：语法坏了在这里就该炸 */
  } catch (e) {
    bad(`真实逻辑无法求值：${e.message}`);
    continue;
  }

  const base = make("assets", []);
  const tabIds = base.tabs.map((t) => t[0]);

  base.TAB_GROUPS.length === 6
    ? ok("分组 6 个（P4 的 5 组 + P6 的「工作总览」）")
    : bad(`分组应为 6，实际 ${base.TAB_GROUPS.length}`);

  /* 完备性：漏一个 → 那个页签从界面上消失（它不会渲染在任何二级行里）；
     重复 → 同一页签在两行里各出现一次。 */
  const seen = new Map();
  for (const g of base.TAB_GROUPS) for (const t of g.tabs) {
    if (!tabIds.includes(t)) bad(`分组 ${g.key} 引用了不存在的页签 ${t}`);
    seen.set(t, (seen.get(t) || 0) + 1);
  }
  const missing = tabIds.filter((t) => !seen.has(t));
  const dup = [...seen.entries()].filter(([, n]) => n > 1).map(([t]) => t);
  missing.length === 0 && dup.length === 0
    ? ok(`${tabIds.length} 个页签全部覆盖且无重复`)
    : bad(`未覆盖 ${JSON.stringify(missing)} / 重复 ${JSON.stringify(dup)}`);

  const keys = base.TAB_GROUPS.map((g) => g.key);
  new Set(keys).size === keys.length ? ok("分组 key 唯一") : bad(`key 重复 ${JSON.stringify(keys)}`);

  /* 别名归一：normalizedTab 归到的是**真实页签名**（artifacts），分组是它所属的组（results）。
     两者都要对：只对分组、页签高亮就会全灭。 */
  for (const [alias, wantGroup, wantTab] of [
    ["testing", "assets", "assets"],
    ["attackfiles", "results", "artifacts"],
    ["prompts", "collaboration", "agents"],
  ]) {
    const m = make(alias, []);
    m.activeGroup.key === wantGroup && m.normalizedTab === wantTab
      ? ok(`别名 ${alias} → 组 ${wantGroup} / 页签 ${wantTab}`)
      : bad(`别名 ${alias} 落到组 ${m.activeGroup.key} / 页签 ${m.normalizedTab}（应为 ${wantGroup} / ${wantTab}）`);
  }

  const bogus = make("__nope__", []);
  bogus.activeGroup && bogus.activeGroup.key === base.TAB_GROUPS[0].key
    ? ok("未知页签兜底到第一组")
    : bad(`未知页签落到 ${bogus.activeGroup && bogus.activeGroup.key}`);

  const gAssets = base.TAB_GROUPS.find((g) => g.key === "assets");
  const gResults = base.TAB_GROUPS.find((g) => g.key === "results");
  make("findings", []).pick(gAssets) === "assets"
    ? ok("点「资产台账」：从漏洞战果跳过去")
    : bad(`点「资产台账」去了 ${make("findings", []).pick(gAssets)}`);
  make("findings", []).pick(gResults) === "findings"
    ? ok("点「成果与报告」：正在看漏洞战果就不甩掉")
    : bad(`点「成果与报告」把当前页换成了 ${make("findings", []).pick(gResults)}`);
  make("testing", []).pick(gAssets) === "assets"
    ? ok("在 testing（别名页）点本组：归一后留在 assets")
    : bad(`testing 点本组去了 ${make("testing", []).pick(gAssets)}`);

  gResults.tabs.includes("artifacts")
    ? ok("artifacts 归「成果与报告」（safe 放在资源中心）")
    : bad("artifacts 不在成果组");

  /* ── B 渲染 ───────────────────────────────────────────────── */
  let render;
  try {
    render = new Function("TAB", "UNREAD", prelude(`return (${rowExpr});`));
  } catch (e) {
    bad(`分组行无法求值：${e.message}`);
    continue;
  }

  /* 没有任何未读：一行 6 个按钮，选中的那个 on */
  const tree = render("findings", []);
  const btns = Array.isArray(tree.kids[0]) ? tree.kids[0] : [];
  btns.length === 6
    ? ok("渲染出 6 个分组按钮")
    : bad(`渲染出 ${btns.length} 个分组按钮`);

  const on = btns.filter((b) => /(^| )on( |$)/.test(b.props.className));
  on.length === 1 && on[0].props.className === "rt-group on"
    ? ok("有且只有一个分组是选中态")
    : bad(`选中态按钮数 ${on.length}：${btns.map((b) => b.props.className).join(" | ")}`);

  btns.every((b) => b.tag === "button" && b.props.role === "tab")
    ? ok("每个分组都是 <button role=tab>（键盘 Enter/Space 原生可用）")
    : bad("分组按钮不是 button/role=tab");

  const sel = btns.map((b) => b.props["aria-selected"]);
  sel.filter((v) => v === "true").length === 1
    ? ok("aria-selected 恰好一个 true")
    : bad(`aria-selected 分布 ${JSON.stringify(sel)}`);

  /* tabIndex：只有选中的那个是 0，其余 -1 —— 这是 roving tabindex 的标准做法 */
  const ti = btns.map((b) => b.props.tabIndex);
  ti[ti.indexOf(0)] === 0 && ti.filter((v) => v === 0).length === 1
    ? ok("roving tabindex：只有选中项可 Tab 进入")
    : bad(`tabIndex 分布 ${JSON.stringify(ti)}`);

  /* 点「成果与报告」：必须调 activateGroup 并落到 findings（当前页在本组） */
  const target = btns.find((b) => b.props.className.indexOf("on") === -1);
  let clicked = null;
  try {
    /* activateGroup 是真实实现，goTab 是桩：点完 picked 应该是本组第一页 */
    btns[1].props.onClick();
    clicked = "ok";
  } catch (e) {
    clicked = e.message;
  }
  clicked === "ok" ? ok("onClick 可调用（不抛）") : bad(`onClick 抛错：${clicked}`);

  /* 未读点：组内有未读且不是当前组才出现 */
  const withUnread = render("assets", ["findings"]);
  const dotBtns = (withUnread.kids[0] || []).filter((b) => b.kids.some((k) => k && k.props && k.props.className === "rt-tab-dot"));
  dotBtns.length === 1
    ? ok("未读只在「非当前组」上点红点")
    : bad(`带红点的分组数 ${dotBtns.length}（应为 1：成果组有未读、且不是当前组）`);
  const selfUnread = render("findings", ["findings"]);
  const selfDot = (selfUnread.kids[0] || []).filter((b) => b.kids.some((k) => k && k.props && k.props.className === "rt-tab-dot"));
  selfDot.length === 0
    ? ok("当前组自己有未读时不点红点（正在看，点了也没意义）")
    : bad(`当前组仍点红点：${selfDot.length}`);
  void target;
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
