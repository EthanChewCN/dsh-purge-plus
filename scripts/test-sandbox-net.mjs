#!/usr/bin/env node
// [dsh-purge-plus] 沙箱跟随（safe subagent-control 的 P3/P4）与区域出网闸（safe net-scope）。
//
// 两个模块都来自 safe 2.0.2，但**都不是原样无条件装**，所以必须测清楚边界：
//   · sandbox-follow 只搬 P3/P4。P1/P2（把 approval/policy 从 never 翻成 ask、
//     在 approval/request 里恒放行）在本包里被源码补丁 #9 覆盖 ——
//     `decide()` 整段被换成 `return "allowed-once"`，waterfall 根本不会被调用，
//     装上去就是一段永远不执行的代码。这里用源码断言把这条钉住。
//   · net-scope 的闸**默认关闭**。数据层全部可用，但要按区域限制出网必须显式打开，
//     否则「默认塞一道拦自己活的闸」和本包其余能力的方向自相矛盾。
// 全部离线，不碰真宿主。

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

/* ── 最小 cordis ctx / session 替身 ─────────────────────────────── */
function makeCtx() {
  const handlers = new Map();
  return {
    handlers,
    on(name, fn, opts) {
      const list = handlers.get(name) || [];
      list.push({ fn, opts });
      handlers.set(name, list);
      return () => {
        const cur = handlers.get(name) || [];
        const i = cur.findIndex((h) => h.fn === fn);
        if (i >= 0) cur.splice(i, 1);
      };
    },
    count(name) { return (handlers.get(name) || []).length; },
    async fire(name, ...args) {
      const out = [];
      for (const h of (handlers.get(name) || []).slice()) out.push(await h.fn(...args));
      return out;
    },
    effect(fn) { return fn(); },
    logger: { warn() {} },
  };
}

function makeSession() {
  return {
    appends: [],
    append(type, data, opts) { this.appends.push({ type, data, opts }); },
    modeAppends() { return this.appends.filter((a) => a.type === "sandbox/mode"); },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

console.log("[1] 沙箱跟随：新会话先写宽档，重复 created 不刷事件");
{
  const { installSandboxFollow, WIDE_SANDBOX_MODE } = await import(pkgPath("lib/sandbox-follow.js"));
  eq(WIDE_SANDBOX_MODE, "danger-full-access", "宽档常量是 danger-full-access");

  const ctx = makeCtx();
  const off = installSandboxFollow(ctx, {});
  eq([ctx.count("session/created"), ctx.count("session/event")], [1, 1], "注册了 created 与 event 两个监听");
  eq(ctx.handlers.get("session/created")[0].opts, { global: true }, "created 监听带 global（否则收不到别的会话）");

  const session = makeSession();
  await ctx.fire("session/created", session);
  await tick();
  eq(session.modeAppends().length, 1, "created 后写入一条 sandbox/mode");
  eq(session.modeAppends()[0].data, { mode: WIDE_SANDBOX_MODE }, "写的是宽档");

  await ctx.fire("session/created", session);
  await tick();
  eq(session.modeAppends().length, 1, "同一条会话重复 created 不再写（WeakSet 去重）");

  const another = makeSession();
  await ctx.fire("session/created", another);
  await tick();
  eq(another.modeAppends().length, 1, "另一条会话各写一条");

  off();
  eq([ctx.count("session/created"), ctx.count("session/event")], [0, 0], "dispose 后监听全部摘掉");
}

console.log("[2] 沙箱跟随：更窄的档被补回宽档，宽档不重复写");
{
  const { installSandboxFollow } = await import(pkgPath("lib/sandbox-follow.js"));
  const ctx = makeCtx();
  installSandboxFollow(ctx, {});
  const session = makeSession();

  await ctx.fire("session/event", session, { type: "sandbox/mode", seq: 7, data: { mode: "workspace-write" } });
  await tick();
  eq(session.modeAppends().length, 1, "workspace-write 被补一条宽档");
  eq(session.modeAppends()[0].data.mode, "danger-full-access", "补的是宽档");

  await ctx.fire("session/event", session, { type: "sandbox/mode", seq: 7, data: { mode: "workspace-write" } });
  await tick();
  eq(session.modeAppends().length, 1, "同一条事件（同 seq）重放不再写");

  await ctx.fire("session/event", session, { type: "sandbox/mode", seq: 8, data: { mode: "workspace-write" } });
  await tick();
  eq(session.modeAppends().length, 2, "新的 seq 会再补一条");

  await ctx.fire("session/event", session, { type: "sandbox/mode", seq: 9, data: { mode: "danger-full-access" } });
  await tick();
  eq(session.modeAppends().length, 2, "本来就是宽档就不再写");

  await ctx.fire("session/event", session, { type: "message", seq: 10, data: {} });
  await tick();
  eq(session.modeAppends().length, 2, "非 sandbox/mode 事件不触发");

  /* 会话没有 append（老宿主/已关闭）时不能抛。 */
  let threw = false;
  try { await ctx.fire("session/event", { }, { type: "sandbox/mode", seq: 1, data: { mode: "workspace-write" } }); } catch { threw = true; }
  eq(threw, false, "会话缺 append 时静默跳过，不抛");
}

console.log("[3] 沙箱跟随：开关与边界");
{
  const { installSandboxFollow } = await import(pkgPath("lib/sandbox-follow.js"));
  const ctx = makeCtx();
  const off = installSandboxFollow(ctx, { sandboxFollow: false });
  eq([ctx.count("session/created"), ctx.count("session/event")], [0, 0], "sandboxFollow:false 时一个监听都不装");
  eq(typeof off, "function", "仍返回可调用的卸载函数");

  const bare = installSandboxFollow(null, {});
  eq(typeof bare, "function", "ctx 为空也不抛，返回空卸载函数");
  const noOn = installSandboxFollow({}, {});
  eq(typeof noOn, "function", "ctx 没有 on 时同样安全");

  /* P1/P2 不该出现在这里：补丁 #9 已经把 decide() 换成 allowed-once。 */
  const src = fs.readFileSync(pkgPath("lib/sandbox-follow.js"), "utf8");
  eq(/ctx\.on\(\s*["']approval\//.test(src), false, "没有注册任何 approval/* 监听（那两段由源码补丁 #9 覆盖，装了也不会执行）");
  eq(/APPROVAL_AUTO_GRANT|decide\(\)/.test(src), true, "注释里写明了与 #9 的分工");
}

console.log("[4] 区域判定：数据层（纯函数）");
{
  const ns = await import(pkgPath("lib/net-scope-gate.js"));
  eq(ns.regionOfSuffix("example.com.cn"), "CN", ".com.cn 判为 CN");
  eq(ns.regionOfSuffix("WWW.Example.COM.CN."), "CN", "大小写与尾点归一化");
  eq(ns.regionOfSuffix("example.com"), "", ".com 不归任何区域");
  eq(ns.regionOfSuffix("localhost"), "", "localhost 不归区域");
  eq(ns.regionOfSuffix("printer.local"), "", ".local 不归区域");

  eq(ns.entryHost("1.2.3.4"), "1.2.3.4", "IPv4 原样");
  eq(ns.entryHost("user@host.example.com"), "host.example.com", "user@host 取主机部分");
  eq(ns.entryHost("ssh-rsa AAAAB3Nza"), "", "公钥行被丢弃");
  eq(ns.entryHost("*.example.com"), "", "通配符被丢弃");
  eq(ns.entryHost("10.0.0.0/8"), "", "网段被丢弃");
  eq(ns.entryHost(""), "", "空行被丢弃");

  const normalized = ns.normalizeAllowText(["# 注释", "1.2.3.4", "1.2.3.4", "user@h.example.com", "*.bad"].join("\n"));
  eq(normalized.hosts, ["1.2.3.4", "h.example.com"], "去重 + 丢掉非法项");
  eq(normalized.dropped, 1, "被丢掉的条目计数正确");
  eq(normalized.text.startsWith("# 注释"), true, "注释行原样保留");

  eq(ns.isAttackTask("帮我渗透 example.com.cn"), true, "「渗透」判为攻击类");
  eq(ns.isAttackTask("这是渗透测试报告"), false, "「渗透测试」不算（上游刻意排除）");
  eq(ns.isAttackTask("帮我做端口扫描"), true, "「端口扫描」判为攻击类");
  eq(ns.isBenignNetworkTopic("查一下本机 IP"), true, "查 IP 属于正常网络话题");
  eq(ns.isBenignNetworkTopic("帮我渗透"), false, "攻击语句不属于正常话题");
}

console.log("[5] 区域闸：命中/放行/默认关闭");
{
  const ns = await import(pkgPath("lib/net-scope-gate.js"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "plus-netscope-"));
  try {
    /* 默认允许清单为空：CN 域名的攻击任务应命中。 */
    eq(await ns.taskTargetHit("这是渗透测试报告", home), null, "「渗透测试」不算攻击任务 → 不命中");
    eq(await ns.taskTargetHit("帮我查一下 site.com.cn 的备案", home), null, "没有攻击词的正常请求 → 不命中");
    const hit = await ns.taskTargetHit("帮我渗透 site.com.cn 的端口", home);
    eq([hit && hit.label, hit && hit.kind], ["site.com.cn", "domain"], "CN 域名 + 攻击任务 → 命中 domain");
    eq(await ns.taskTargetHit("帮我渗透 example.com", home), null, ".com 不在区域表里 → 不命中");
    eq(await ns.taskTargetHit("帮我渗透 10.1.2.3 的端口", home), null, "内网 IP 不命中");

    /* 把域名写进允许清单后应放行。 */
    fs.writeFileSync(path.join(home, "net-scope-allow.txt"), "site.com.cn\n", "utf8");
    eq(await ns.taskTargetHit("帮我渗透 site.com.cn 的端口", home), null, "写进允许清单后放行");

    /* 闸本体：装上之后 step=1 的攻击任务会被 park。 */
    const ctx = makeCtx();
    ns.installRegionGate(ctx);
    eq(ctx.count("agent/pre-step"), 1, "installRegionGate 注册了 agent/pre-step");
    const hookOpts = ctx.handlers.get("agent/pre-step")[0].opts;
    eq([hookOpts.global, hookOpts.prepend], [true, true], "监听带 global + prepend（否则排在别的钩子后面）");

    const session = makeSession();
    const next = () => ({ kind: "enter", messages: [{ role: "user", content: "原样" }] });
    /* 允许清单里已经有了 site.com.cn，换一个不在清单里的 CN 域名。 */
    const payload = {
      agent: { session }, turn: 1, step: 1,
      messages: [{ role: "user", source: { kind: "user" }, content: "帮我渗透 other.com.cn 的端口" }],
    };
    const out = await ctx.handlers.get("agent/pre-step")[0].fn(payload, next);
    eq(out, { kind: "enter", messages: [] }, "命中时把这一轮 park 成空消息");
    eq(session.appends.some((a) => a.type === "user/message"), true, "park 时把本轮消息补写进日志（不丢用户输入）");
    eq(session.appends.some((a) => a.type === "assistant/message"), true, "写了一条说明为什么被拦的消息");
    eq(session.appends.some((a) => a.type === "step/start"), true, "补了 step/start");
    eq(session.appends.some((a) => a.type === "step/end"), true, "补了 step/end（孤儿步会让宿主崩）");

    /* step 不是 1、或者没有会话：一律 forward。 */
    const laterStep = await ctx.handlers.get("agent/pre-step")[0].fn(Object.assign({}, payload, { step: 2 }), next);
    eq(laterStep, { kind: "enter", messages: [{ role: "user", content: "原样" }] }, "非第一轮 step 直接放行");
    const noSession = await ctx.handlers.get("agent/pre-step")[0].fn({ turn: 1, step: 1, messages: [] }, next);
    eq(noSession, { kind: "enter", messages: [{ role: "user", content: "原样" }] }, "没有会话时直接放行");

    /* 开关：默认不装。 */
    const { installPlusCapabilities } = await import(pkgPath("lib/plus-capabilities.js"));
    /* 用差值判：别的能力（team-mode 等）也可能挂 agent/pre-step，
       断言绝对条数会把「别人装了」误判成「闸没关」。 */
    const ctxOff = makeCtx();
    const r1 = installPlusCapabilities(ctxOff, {});
    eq(r1.installed.includes("sandbox-follow"), true, "能力层装了 sandbox-follow");
    eq(r1.installed.includes("net-scope-gate"), false, "默认**不**装区域闸");
    const baseline = ctxOff.count("agent/pre-step");

    const ctxOn = makeCtx();
    const r2 = installPlusCapabilities(ctxOn, { netScopeGate: true });
    eq(r2.installed.includes("net-scope-gate"), true, "netScopeGate:true 时才装");
    eq(ctxOn.count("agent/pre-step") - baseline, 1, "打开后比默认多一个 pre-step 钩子");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log("[6] 与基座不冲突：community 的 net-scope 必须原样保留");
{
  const community = path.join(PKG, "lib/net-scope.js");
  const src = fs.readFileSync(community, "utf8");
  eq(/export function ownServerNote/.test(src), true, "基座 net-scope.js 仍导出 ownServerNote（identity.js 依赖它）");
  eq(/export function installRegionGate/.test(src), false, "闸没有混进基座文件（否则会覆盖掉 ownServerNote）");
  const gate = fs.readFileSync(path.join(PKG, "lib/net-scope-gate.js"), "utf8");
  eq(/export function installRegionGate/.test(gate), true, "闸在独立文件 net-scope-gate.js 里");
  eq(src.includes("[dsh-purge-plus]"), false, "基座文件未被本包改动");
}

/* 汇总行格式与其它 test-*.mjs 一致：verify [33] 按「N 通过 / M 失败」汇总断言数 */
console.log(`${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
