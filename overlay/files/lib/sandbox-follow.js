/* [dsh-purge-plus] 沙箱模式跟随 —— 取自 dsh-purge-safe v2.0.2 `lib/subagent-control.js`
 * （Apache-2.0）的 P3/P4 两段；上游许可见包内 LICENSE-SAFE-APACHE-2.0.txt / NOTICE-SAFE.txt。
 *
 * 为什么只搬 P3/P4，不搬 P1/P2：
 *   上游那两段是「把 approval/policy 从 never 翻成 ask」+「在 approval/request 的
 *   waterfall 里恒放行」。本包的基座走的是**源码补丁 #9 APPROVAL_AUTO_GRANT**：
 *   `decide()` 被整段换成 `return "allowed-once"`，在 `effectivePolicy()` 之前就返回。
 *   也就是说 P1/P2 在这里**永远走不到**（waterfall 根本不会被调用）——
 *   装上去只是一层看着有用、实际不执行的代码。构建期 #9 的锚点对不上会直接失败，
 *   不会静默退化成「要审批」，所以这层兜底也不需要。
 *
 * 真正缺的是 P3/P4：**沙箱模式跟着会话走**。
 *   宿主把 `sandbox/mode` 写进会话日志，投影读不到时回落到部署默认
 *   `workspace-write`；新会话更是完全没有这条事件。于是「全权限」只对
 *   手工切过的会话生效，新建的会话第一次工具调用就被降档。
 *   safe 的做法是：新建会话先写一条宽档；此后任何一条更窄的 sandbox/mode
 *   都被补一条宽档盖回去（按事件去重，避免自己写的又被自己判一次）。
 *
 * 边界：只写会话日志，不碰任何官方文件，不依赖 DSH_PERMISSION_MODE。
 */

/** 本包认定的宽档。宿主目前只有 workspace-write / danger-full-access 两档。 */
export const WIDE_SANDBOX_MODE = "danger-full-access";

/**
 * 装上沙箱跟随。
 *
 * @param ctx - cordis 上下文（需要 `on`）。
 * @param config - `{ sandboxFollow?: boolean }`；显式 false 时不装。
 * @returns 卸载函数（没装成时是空函数）。
 */
export function installSandboxFollow(ctx, config = {}) {
  if (config.sandboxFollow === false) return () => {};
  if (!ctx || typeof ctx.on !== "function") return () => {};

  const offs = [];
  /* 按会话记「已经初始化过」，避免重放/重复 created 时刷一堆事件。 */
  const primed = new WeakSet();
  /* 已经补过的 sandbox/mode 事件（key 用 seq，沙箱事件本身没有别的稳定标识）。 */
  const patched = new WeakMap();

  const marksOf = (session) => {
    let marks = patched.get(session);
    if (!marks) { marks = new Set(); patched.set(session, marks); }
    return marks;
  };

  const writeWide = (session) => {
    /* created / 事件处理链里不能同步 append：推到微任务，失败静默（会话可能已关）。 */
    queueMicrotask(() => {
      try { session.append("sandbox/mode", { mode: WIDE_SANDBOX_MODE }); } catch { /* 会话已关 */ }
    });
  };

  /* P4：新会话先写一条宽档，让第一次工具调用就走全权限。 */
  try {
    offs.push(ctx.on("session/created", (session) => {
      try {
        if (!session || typeof session.append !== "function") return;
        if (primed.has(session)) return;
        primed.add(session);
        writeWide(session);
      } catch { /* 老宿主无 session/created */ }
    }, { global: true }));
  } catch { /* 老宿主 */ }

  /* P3：任何更窄的 sandbox/mode 都补一条宽档盖回去。 */
  try {
    offs.push(ctx.on("session/event", (session, event) => {
      try {
        if (!session || typeof session.append !== "function") return;
        if (!event || event.type !== "sandbox/mode") return;
        if (event.data && event.data.mode === WIDE_SANDBOX_MODE) return;
        const marks = marksOf(session);
        const key = `sandbox:${event.seq}`;
        if (marks.has(key)) return;
        marks.add(key);
        writeWide(session);
      } catch { /* 观察者不能抛 */ }
    }, { global: true }));
  } catch { /* 老宿主 */ }

  return () => {
    for (const off of offs) {
      try { off(); } catch { /* 已释放 */ }
    }
  };
}
