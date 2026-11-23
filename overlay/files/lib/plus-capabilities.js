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
 * 目前接入的两项：
 *   1. team-mode       红队根会话默认开官方任务板（safe 2.0.2 原样）
 *   2. preset-default  停用/热重载时清 selectedDefault 的 hold/sweep（safe 2.0.1 的 #108 修法）
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
