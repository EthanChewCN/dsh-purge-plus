#!/usr/bin/env node
/**
 * P26 待办角标 + 「排队四项」同在性回归。
 *
 * 为什么单独一个脚本：角标是**跨页常驻**组件，它挂错位置（挂到页签内部）在功能测试里
 * 看不出来 —— 打开演练台照样能看见，只有「人在别的页面」时才暴露。所以这里断言的是
 * 挂载点本身（shell.overlay 的 PanelOverlays），而不是「组件存在」。
 *
 * 另外三条（态势首页 / 分组导航 / 站内全屏）是前几轮就落地的，这里只做**同在性守卫**：
 * 它们分散在两份产物里，任何一次上游合并都可能悄悄丢掉一条，丢掉时界面上只会「少个东西」，
 * 不会报错。守卫比事后回忆便宜。
 *
 * 不是查字符串：`attnPromptText` 是从产物里**切出来**的真函数，喂假数据跑真值。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const PKG = path.join(ROOT, "dist", "build", "package");
const PANEL = path.join(PKG, "client.js");
const RT = path.join(PKG, "lib", "redteam", "client.js");

let pass = 0;
const fails = [];
const ok = (cond, name) => { if (cond) { pass += 1; } else { fails.push(name); } };
const read = (p) => fs.readFileSync(p, "utf8");

const panel = read(PANEL);
const rt = read(RT);

/** 从源码里切出 `const NAME = (...) => { ... }` 的函数体（花括号配对，不重写）。 */
function sliceArrow(src, name) {
  const at = src.indexOf("const " + name + " = ");
  if (at < 0) return null;
  const bodyStart = src.indexOf("=>", at);
  const braceAt = src.indexOf("{", bodyStart);
  if (bodyStart < 0 || braceAt < 0) return null;
  let depth = 0;
  for (let i = braceAt; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(at, i + 1) + ";";
    }
  }
  return null;
}

/** 切出 `function NAME(...) { ... }`。 */
function sliceFunction(src, name) {
  const at = src.indexOf("function " + name + "(");
  if (at < 0) return null;
  const braceAt = src.indexOf("{", at);
  let depth = 0;
  for (let i = braceAt; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  return null;
}

// ── 1. 角标存在且挂在 shell.overlay 上 ──────────────────────────────
const badgeFn = sliceFunction(panel, "AttentionBadge");
ok(badgeFn !== null, "面板产物里有 AttentionBadge 组件");

const overlays = sliceFunction(panel, "PanelOverlays");
ok(overlays !== null && overlays.includes("h(AttentionBadge"), "角标挂在 PanelOverlays 里（不是某个页签内部）");
ok(overlays !== null && overlays.includes("h(EnvAdaptSendGate)"), "PanelOverlays 原有内容未被替换掉");

// shell.overlay 的注册必须还在 —— 挂载点消失等于角标永不渲染
ok(panel.includes('name: "shell.overlay"') && panel.includes("id: \"dsh-purge-panel-overlays\""),
  "shell.overlay 注册仍在（角标的宿主插槽）");

// ── 2. 角标的行为约束 ───────────────────────────────────────────────
if (badgeFn) {
  ok(badgeFn.includes('op: "attention"'), "角标读的是 attention op");
  ok(badgeFn.includes("session: readSession()"), "带 session：按本会话绑定的靶标算，不落到全局指针");
  ok(badgeFn.includes("limit: 5"), "只取前 5 条：角标是提示，不是队列全量");
  ok(!badgeFn.includes("attentionAck"), "角标不自动收口（收口必须由人决定）");
  ok(badgeFn.includes("document.hidden"), "后台标签页不轮询");
  ok(badgeFn.includes("visibilitychange"), "切回前台立刻补一次");
  ok(panel.includes("ATTN_POLL_MS = 30000"), "轮询间隔 30 秒");
  ok(panel.includes("ATTN_SNOOZE_URGENT_MS = 3 * 60 * 1000"), "受阻/失败时「稍后」只压 3 分钟");
  ok(panel.includes("ATTN_SNOOZE_MS = 10 * 60 * 1000"), "普通「稍后」压 10 分钟");
  ok(badgeFn.includes("if (!r || r.ok === false) return"), "读取失败保留旧队列，不清空成「没人等」");
  ok(badgeFn.includes("hostSetDraft"), "「填入输入框」走宿主草稿入口");
  ok(badgeFn.includes("clipboard"), "拿不到草稿入口时退到剪贴板");
  ok(badgeFn.includes("setDock({ open: true, tab: \"drill\" })"), "「去智能体页」先打开演练台");
  ok(badgeFn.includes("CustomEvent(ATTN_GOTO_EVENT"), "再发一次跳页事件");
  ok(badgeFn.includes("setTimeout(fire, 160)"), "演练台可能还没挂载：补一枪");
  ok(badgeFn.includes("Math.abs(dx) < 4"), "拖拽有 4px 死区，点一下不会被判成拖");
  ok(badgeFn.includes("setPointerCapture"), "拖拽用 pointerCapture");
  ok(badgeFn.includes("attnWritePrefs({ pos: posRef.current })"), "位置只在抬手时落盘");
  ok(badgeFn.includes('ev.key === "Escape"'), "Esc 收起");
  // 早退必须在所有 hook 之后，否则 react 的 hook 顺序会随数据变化
  const hookIdx = badgeFn.lastIndexOf("useEffect");
  const earlyIdx = badgeFn.indexOf("if (!total && !pending) return null");
  ok(hookIdx >= 0 && earlyIdx > hookIdx, "空队列早退在全部 hook 之后（hook 顺序稳定）");
}

// ── 3. 跳页事件两端都在 ─────────────────────────────────────────────
ok(rt.includes("addEventListener('dsh-purge-plus:goto-tab'"), "演练台（独立窗口）监听跳页事件");
ok(panel.includes("addEventListener('dsh-purge-plus:goto-tab'"), "演练台（面板内嵌）监听跳页事件");

// ── 4. attnPromptText 真值 ─────────────────────────────────────────
const promptSrc = sliceArrow(panel, "attnPromptText");
ok(promptSrc !== null, "能从产物里切出 attnPromptText");
if (promptSrc) {
  const ATTN_STATUS = { waiting: "等解答", ready: "等验收", blocked: "受阻", failed: "失败", progress: "在跑" };
  const attnName = (it) => it.label || it.role || String(it.session_id || "");
  const fn = new Function("ATTN_STATUS", "attnName", promptSrc + " return attnPromptText;")(ATTN_STATUS, attnName);

  const text = fn([
    { session_id: "s-1", label: "外网扫描", status: "waiting", reason: "缺 VPN 凭证", needs: ["vpn", "账号"] },
    { session_id: "s-2", role: "host-agent", status: "blocked", reason: "", needs: [] },
  ], 3);

  ok(text.startsWith("以下子智能体在等我的答复"), "开头是给人看的一句交代");
  ok(text.includes("1. [等解答] 外网扫描：缺 VPN 凭证；需要：vpn、账号"), "逐条：序号 + 状态 + 名称 + 原因 + 需要");
  ok(text.includes("2. [受阻] host-agent"), "没有 reason/needs 时不留下空括号");
  ok(!text.includes("null") && !text.includes("undefined"), "缺字段不会漏成 null/undefined");
  ok(text.includes("另有 3 个覆盖度缺口待派单"), "缺口单独一行，不与「在等」混为一谈");

  const empty = fn([], 0);
  ok(empty.split("\n").length === 1, "队列与缺口都为空时只留一句开头，不堆空行");
}

// ── 5. 四项同在性守卫 ──────────────────────────────────────────────
// ② 态势首页：每一路取数都必须自带降级，任何一路挂掉不能让首页整块红掉
const overview = sliceFunction(rt, "OverviewTab");
ok(overview !== null, "演练台有 OverviewTab");
if (overview) {
  const catches = (overview.match(/\.catch\(function \(\) \{ return null \}\)/g) || []).length;
  ok(catches >= 6, "态势首页六路取数各自降级（实测 " + catches + " 处）");
  ok(overview.includes("if (!engagement)"), "没有靶标时给出去建靶标的提示，不是空白页");
  ok(overview.includes("coverage_available === false"), "覆盖度引擎不可用时明说，不把「看不到」说成「没有」");
}
ok(panel.includes("OverviewTab"), "面板产物也有态势首页");

// ③ 分组导航：6 组 + 二级页签 + 键盘漫游 + 组级红点
for (const g of ["工作总览", "资产台账", "协同进度", "成果与报告", "资源中心", "环境与设置"]) {
  ok(rt.includes("label: '" + g + "'"), "分组导航含「" + g + "」");
}
ok(rt.includes("navigateGroupKey"), "分组支持方向键/Home/End");
ok(rt.includes("groupHasUnread"), "组级红点按组内未读算");
ok(rt.includes("aria-selected"), "分组按钮带 aria-selected");
ok(panel.includes("TAB_GROUPS"), "面板产物也有分组导航");

// ④ 站内全屏：钩子 + Esc + CSS 铺满兜底
ok(rt.includes("useWorkbenchFullscreen"), "站内全屏钩子在位");
ok(rt.includes("FULL_REQUEST_EVENT"), "全屏请求事件在位");
ok(rt.includes("requestFullscreen"), "接原生 Fullscreen API");
ok(panel.includes("useWorkbenchFullscreen"), "面板产物也有站内全屏");

// ── 6. 不许出现的东西 ──────────────────────────────────────────────
ok(!panel.includes("__dshPurgeAttentionGo"), "没有退回全局函数式跳页（两个 dock 实例会互相覆盖）");
ok(!/op: "attentionAck"[^}]*\}\s*\)\s*\.then\(\(\)\s*=>\s*\{\}\)/.test(panel), "没有「读了就收口」的自动确认");


// ── 7. 真渲染冒烟：把角标从产物里整段切出来跑一遍 ──────────────────
// 前面那些断言都还是「源码里有这句话」。这一段是把 `const ATTN_* ... function AttentionBadge`
// 整块从产物里切出来，配上假的 React / api / DOM 真跑一次 render，检查输出树里
// 到底有没有那几个字。挂载点对了、文案错了，用户看到的仍然是个坏角标。
{
  const start = panel.indexOf("const ATTN_LS_KEY");
  const end = panel.indexOf("function PanelOverlays()");
  ok(start > 0 && end > start, "能从产物里切出角标整段（常量 + 组件）");

  if (start > 0 && end > start) {
    const block = panel.slice(start, end);
    const makeReact = (states) => {
      let i = 0;
      return {
        Fragment: "Fragment",
        useState: (init) => {
          const v = i < states.length ? states[i] : (typeof init === "function" ? init() : init);
          i += 1;
          return [v, () => {}];
        },
        useEffect: () => {},
        useRef: (v) => ({ current: v }),
      };
    };
    const render = (states) => {
      const R = makeReact(states);
      const h2 = (tag, props, ...kids) => ({ tag, props: props || {}, kids: kids.flat(9).filter((k) => k !== null && k !== undefined && k !== false) });
      const store = new Map();
      const win = {
        localStorage: {
          getItem: (k) => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => { store.set(k, String(v)); },
        },
        innerWidth: 1200, innerHeight: 800,
        setInterval: () => 0, clearInterval: () => {},
        setTimeout: () => 0, clearTimeout: () => {},
        dispatchEvent: () => true,
      };
      const doc = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };
      const factory = new Function(
        "import_react2", "h2", "api", "currentSessionId", "host2", "hostSetDraft", "setDock",
        "window", "document", "navigator", "CustomEvent",
        block + "\nreturn AttentionBadge;",
      );
      const Badge = factory(
        { default: R }, h2,
        () => Promise.resolve(null),
        () => "sess-1", {}, () => false, () => {},
        win, doc, { clipboard: { writeText: () => {} } }, function CustomEvent() {},
      );
      return Badge();
    };
    const texts = (node, acc = []) => {
      if (node === null || node === undefined) return acc;
      if (typeof node === "string" || typeof node === "number") { acc.push(String(node)); return acc; }
      if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
      if (node.kids) node.kids.forEach((n) => texts(n, acc));
      return acc;
    };
    const flat = (node) => texts(node).join("|");

    const items = [
      { session_id: "s-1", label: "外网扫描", status: "waiting", reason: "缺 VPN 凭证", needs: ["vpn"] },
      { session_id: "s-2", role: "host-agent", status: "blocked", reason: "", needs: [] },
    ];
    const data = { ok: true, total: 2, items, pending_coverage: 1, note: "按「最需要人」排序" };

    /* 收起态：只有胶囊 */
    const closed = render([data, false, 0, null, "", Date.now()]);
    ok(closed !== null, "有队列时渲染出节点（不是 null）");
    const closedText = flat(closed);
    ok(closedText.includes("2") && closedText.includes("人在等"), "收起态显示「2 人在等」");
    ok(!closedText.includes("现在在等谁"), "收起态不展开卡片");

    /* 展开态：卡片 + 三条动作 */
    const opened = render([data, true, 0, null, "", Date.now()]);
    const openText = flat(opened);
    ok(openText.includes("现在在等谁"), "展开态出现卡片标题");
    ok(openText.includes("外网扫描") && openText.includes("host-agent"), "展开态逐条列出在等的会话");
    ok(openText.includes("缺 VPN 凭证"), "展开态显示卡住的原因");
    ok(openText.includes("去智能体页") && openText.includes("填入输入框"), "展开态有两条动作按钮");
    ok(openText.includes("稍后 3 分钟"), "有受阻项时「稍后」是 3 分钟（不是 10 分钟）");
    ok(openText.includes("另有 1 个覆盖度缺口"), "缺口单独提示");

    /* 只有缺口、没有人在等：角标仍然出现，但不假装「有人在等」 */
    const gapOnly = render([{ ok: true, total: 0, items: [], pending_coverage: 3, note: "" }, false, 0, null, "", Date.now()]);
    const gapText = flat(gapOnly);
    ok(gapText.includes("缺口待派"), "只有缺口时提示「缺口待派」");
    ok(!gapText.includes("人在等"), "只有缺口时不说「人在等」");

    /* 全空：不渲染任何东西（不能在屏幕上留一个 0） */
    const empty = render([{ ok: true, total: 0, items: [], pending_coverage: 0, note: "" }, false, 0, null, "", Date.now()]);
    ok(empty === null, "队列与缺口都空时返回 null，不占屏幕");

    /* 数据还没到时也不能崩 */
    const noData = render([null, false, 0, null, "", Date.now()]);
    ok(noData === null, "首次取数未回时返回 null（不渲染 0）");
  }
}

// ── 重新输出（第 7 节可能新增失败）────────────────────────────────
if (fails.length) {
  console.error("✗ test-attention-badge：" + pass + " 通过 / " + fails.length + " 失败");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("✓ test-attention-badge：" + pass + " 通过 / 0 失败");
