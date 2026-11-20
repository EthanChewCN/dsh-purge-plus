/**
 * [dsh-purge-plus] 子代理禁再派活 —— 叶子节点围栏。
 *
 * 来源：CallMeGuLab/dsh-purge-safe v2.0.0 `lib/tool-gate.js`（Apache-2.0）的
 * `denyDelegation` 部分，见 NOTICE.md。
 *
 * 为什么只搬这一小段：
 *   safe 的 tool-gate 主体是「把 pre-execute 的 ask/deny 降级成 allow、
 *   把 post-execute 的 block 降级成 accept」。在本仓库的基座（community 1.7.20）里
 *   这件事已经由源码补丁完成，而且更彻底 ——
 *     #9  APPROVAL_AUTO_GRANT              直接把 decide() 换成 return "allowed-once"
 *     #59  OFFICIAL_AUTO_REVIEW_PASSTHROUGH 直接改 auto-review 的 tools/pre-execute
 *   再挂一层运行时降级属于重复实现，还会和源码补丁互相盖。
 *   所以这里只保留 community 完全没有的那一个行为：子代理不能再往下派活。
 *
 * 设计取舍（沿用 safe 的判断）：
 *   只对委派类工具动手，其余一律放行且**照常 next()**，不截断链 ——
 *   硬 return allow 会把 dsh-tool-jobs 的输出上限记录、dsh-workspace-changes
 *   的改动快照、dsh-spill-policy 的超长截断一起关掉。
 *
 * 判据不看 `parentSession`：从历史续接/分支出来的会话也带它，那种会话自己是根，
 * 拦了就没法再派活。只看 origin 与 delegationDepth。
 */

/** 能再往下派活的工具名。宿主在 dsh-base/cordis.patch.yml 里配置：
 *  tool-subagent → subagent，tool-subagent-fork → subagent_fork，tool-workflow → workflow。 */
const DELEGATION_TOOLS = new Set(["subagent", "subagent_fork", "workflow"]);

function isLeafAgent(agent) {
  const header = agent?.session?.header;
  if (!header) return false;
  const origin = String(header.origin || "").toLowerCase();
  if (origin === "subagent" || origin === "teammate" || origin === "delegate") return true;
  return Number(header.delegationDepth ?? 0) > 0;
}

function denyDelegation(exec) {
  /* exec 形状见 @deepseek-ai/dsh-tools lib/pipeline.js:createExecution —— 工具名就是 exec.name。 */
  const name = String(exec?.name || exec?.tool?.name || "");
  if (!DELEGATION_TOOLS.has(name)) return null;
  if (!isLeafAgent(exec?.agent)) return null;
  return {
    kind: "deny",
    reason: `子代理是叶子节点，不能再派活（${name}）。直接把当前任务做完并回报。`,
  };
}

/**
 * @param {object} ctx Cordis 插件上下文
 * @param {object} config 插件配置；config.subagentFence === false 时整体关闭
 * @returns {() => void} disposer
 */
export function installSubagentFence(ctx, config = {}) {
  if (config.subagentFence === false) return () => {};
  if (typeof ctx?.on !== "function") return () => {};

  let off = null;
  try {
    // global 必需：宿主是 ctx.waterfall(scopeTarget(this.tools, exec.agent), ...)，跑在
    // agent 作用域里；挂在插件自己的 ctx 上收不到。
    // prepend 必需：本插件在 bundle 末尾最后 apply，prepend 让最后注册的排最外，
    // 才有机会在下游审核链之前做决定。
    off = ctx.on("tools/pre-execute", async (exec, next) => {
      const denial = denyDelegation(exec);
      if (denial) return denial;
      if (typeof next !== "function") return { kind: "allow" };
      try {
        return await next();
      } catch {
        // 下游抛异常时 waterfall 会把整个调用打成 isError；降级成放行，
        // 别让别人的审核器故障变成我们的拒绝。
        return { kind: "allow" };
      }
    }, { global: true, prepend: true });
  } catch {
    /* 老宿主无 tools/pre-execute */
  }

  return () => {
    try { off?.(); } catch { /* 已释放 */ }
  };
}
