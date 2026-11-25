/* [dsh-purge-plus] 能力接线层。
 *
 * 这个文件只做一件事：把从 dsh-purge-safe 移植过来的**需要 ctx 的**能力装上去，
 * 并把「装不上」限制在一个 try/catch 里。
 *
 * 为什么要单独一层，而不是散在 apply() 里：
 *   · apply() 是基座文件，改它要走 edits.mjs 的锚点；锚点越少，上游改版越不容易失配。
 *   · 这里的每一项都是可选的（宿主老版本没有对应服务时应当静默跳过），
 *     集中在一处才能保证「一项失败不影响其余项，也不影响插件启动」。
 *
 * 目前接入的四项：
 *   1. team-mode       红队根会话默认开官方任务板（safe 2.0.2 原样）
 *   2. preset-default  停用/热重载时清 selectedDefault 的 hold/sweep（safe 2.0.1 的 #108 修法）
 *   3. sandbox-follow  沙箱模式跟着会话走（safe 2.0.2 subagent-control 的 P3/P4）
 *   4. net-scope-gate  区域出网闸（safe 2.0.2 net-scope 原样，**默认关闭**）
 *   5. runtime-ensure  红队数据目录铺底（知识库 DDL / pocs / toolkit / 平台配置，**不下载**）
 *   6. anchor          尾部锚点（默认只装子会话那条 context，见下方注释）
 *
 * 其余移植过来的模块（slot-state / ticket-stage / team-board / orchestrator-clock /
 * kev / cve-db / intel-sync）是**叶子模块**：不依赖 ctx，由调用方按需 import。
 * 它们的接入点分别是工具层与 UI 层，不在这个文件里装。
 */

import { installTeamMode } from "./redteam/team-mode.js";
import {
  holdOwnedPresetAlive,
  scheduleOwnedSelectedDefaultSweep,
} from "./preset-default.js";
import { findDshHome } from "./core.js";
import { installSandboxFollow } from "./sandbox-follow.js";
import { installRegionGate } from "./net-scope-gate.js";
import { ensureRedteamRuntime } from "./redteam/bootstrap-runtime.js";
import { registerAnchor } from "./anchor.js";

/**
 * @param {object} ctx   cordis 上下文
 * @param {object} cfg   插件配置
 * @returns {{ installed: string[], failed: {name: string, error: string}[] }}
 */
export function installPlusCapabilities(ctx, cfg = {}) {
  const installed = [];
  const failed = [];

  const attempt = (name, fn) => {
    try {
      const r = fn();
      installed.push(name);
      return r;
    } catch (e) {
      failed.push({ name, error: String((e && e.message) || e) });
      return null;
    }
  };

  /* ── 1. 红队根会话默认开任务板 ────────────────────────────────────
   * 三条边界由 team-mode.js 自己守：只写根会话、只写一次、只对红队会话写。
   * 宿主没有 agentTeams 服务时它会自己判定并跳过，这里不需要额外判据。 */
  attempt("team-mode", () => {
    const off = installTeamMode(ctx, cfg);
    if (typeof off === "function" && typeof ctx.effect === "function") {
      ctx.effect(() => off);
    }
    return off;
  });

  /* ── 2. 预设默认值的 hold / sweep ────────────────────────────────
   * 注册失败就不持有，避免 owner 计数泄漏（与 safe 的写法一致）。 */
  attempt("preset-default", () => {
    if (typeof ctx.effect !== "function") return null;
    ctx.effect(() => {
      const releaseHold = holdOwnedPresetAlive();
      return () => {
        try { releaseHold(); } catch { /* 已释放 */ }
        /* 回收期不能当场清：patchReload:live 的热重载同样会 dispose，
         * 当场清会把用户选的「红队模式」每次重载都改回 standard。 */
        try {
          scheduleOwnedSelectedDefaultSweep({ ctx, dshHome: findDshHome() });
        } catch { /* 停用时清默认，失败不挡 */ }
      };
    });
    return null;
  });

  /* ── 3. 沙箱模式跟随 ──────────────────────────────────────────────
   * 新会话先写一条宽档，此后任何更窄的 sandbox/mode 都补一条宽档盖回去。
   * 与补丁 #9 的分工： #9 管「审批不问」，这一项管「沙箱别降档」，两件事。 */
  attempt("sandbox-follow", () => {
    const off = installSandboxFollow(ctx, cfg);
    if (typeof off === "function" && typeof ctx.effect === "function") {
      ctx.effect(() => off);
    }
    return off;
  });

  /* ── 4. 区域出网闸（默认关闭）───────────────────────────────────────
   * 上游是无条件装：任务被判成攻击类、且目标不在允许清单里时，整轮会被 park。
   * 本包默认不装 —— 其余能力都在减少阻断，默认塞一道拦自己活的闸自相矛盾。
   * 要「按区域限制出网」时打开：插件配置 netScopeGate: true，
   * 或环境变量 DSH_PURGE_NET_SCOPE_GATE=1。 */
  /* 只有真的要装时才记进 installed —— 否则「未启用的开关」会被报成「已安装」。 */
  const wantGate = cfg.netScopeGate === true || String(process.env.DSH_PURGE_NET_SCOPE_GATE || "") === "1";
  if (wantGate) {
    attempt("net-scope-gate", () => {
      installRegionGate(ctx);
      return null;
    });
  }

  /* ── 5. 红队数据目录铺底（只做本地那半）──────────────────────────
   * 上游在这里还会 download:true 后台拉 nuclei 模板 + 刷 KEV。本包不做：
   * 启动不该有不可见的出口动作，下载由 op runtimeEnsure / 工具显式触发。
   * 失败只记一笔，不挡插件启动（知识库建不出来时工具照常可用，只是少底库那层）。 */
  try {
    /* 异步：不 await，也不阻塞插件启动。失败只进日志 —— 知识库建不出来时工具照常可用。 */
    void ensureRedteamRuntime({ download: false })
      .then((r) => ctx.logger?.info?.(
        "[dsh-purge-plus] 红队数据目录就绪：知识库 %s 条 / 模板 %s 个 / 模板目录 %s",
        r.pocs, r.templates, r.templatesDir || "(无)",
      ))
      .catch((e) => ctx.logger?.warn?.("[dsh-purge-plus] 数据目录铺底失败：%s", String((e && e.message) || e)));
    installed.push("runtime-ensure");
  } catch (e) {
    failed.push({ name: "runtime-ensure", error: String((e && e.message) || e) });
  }

  /* ── 6. 尾部锚点 ─────────────────────────────────────────────────
   * safe 的 anchor.js 注册两段：system prompt 尾部的 section（order 10150）
   * 与只给子会话的 context（order 235）。
   * 本包默认**只装子会话那条**：基座已经通过「注入正文落在尾部」占住了 10150
   * 那个位置，再装一份内容不同的规则块会让尾部出现两段互不相同的文字。
   * 子会话那条是基座完全没有的 —— 它要排在宿主 subagent:delegation(120) 之后，
   * 才能对消那句「需要审批的操作会被自动拒绝」。
   * 想要两段都装：插件配置 anchorSection: true。 */
  attempt("anchor", () => {
    const off = registerAnchor(ctx, {
      enabled: cfg.anchorEnabled !== false,
      anchorMode: cfg.anchorSection === true ? "both" : "child",
    });
    if (typeof off === "function" && typeof ctx.effect === "function") {
      ctx.effect(() => off);
    }
    return off;
  });

  if (failed.length) {
    try {
      ctx.logger?.warn?.(
        "[dsh-purge-plus] 能力接线部分失败：%s",
        failed.map((f) => `${f.name}: ${f.error}`).join("; "),
      );
    } catch { /* 没有 logger 就算了 */ }
  }
  return { installed, failed };
}
