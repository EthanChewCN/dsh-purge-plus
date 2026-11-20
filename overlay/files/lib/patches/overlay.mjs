// [dsh-purge-plus] 本仓库自有补丁表。
//
// 设计约束（见 docs/PORT-MATRIX.md）：
//   1. id 从 201 起，永不复用 1..96 —— 上游 community 与 safe 在那一段的语义冲突。
//   2. 只放「上游 community 没有、且已在本机 0.2.2-rc.5 验证锚点存在」的补丁。
//   3. 每条必须 optional + skipIfMarked，宿主升级后锚点消失只报 drifted，不阻断其余 88 条。
//   4. marker 前缀统一 [dsh-purge-plus]，与两家的 [dsh-purge] / [dsh-purge-safe] 区分开。
//
// 来源标注：safe = CallMeGuLab/dsh-purge-safe v2.0.0（Apache-2.0），已按 NOTICE.md 保留署名。

export const OVERLAY_PATCHES = [
  // ── 201 产品埋点默认关闭 ────────────────────────────────────────────
  // 来源 safe #93。锚点实测：dsh-client-product-analytics/lib/index.js:313
  // 语义：collector 拿不到任何行为事件；显式 enabled:true 仍可开。
  {
    id: 201,
    name: "PRODUCT_ANALYTICS_DEFAULT_OFF",
    layer: "代码",
    layer_en: "Code",
    desc: "产品埋点默认关闭，不再向 collector 送行为事件 / product analytics off by default",
    file: ["product-analytics"],
    optional: true,
    skipIfMarked: true,
    replacements: [
      {
        pattern: "enabled: z.boolean().default(true).volatile(),",
        replace:
          "enabled: z.boolean().default(false).volatile(), // [dsh-purge-plus] product analytics off (from safe #93)",
      },
    ],
    markers: ["[dsh-purge-plus] product analytics off"],
  },

  // ── 202 产品遥测 OTLP 导出器变空实现 ────────────────────────────────
  // 来源 safe #94。锚点实测：dsh-host-product-telemetry-otel/lib/index.js:41-42
  //
  // 与 safe 原版的差异（有意改进，见 PORT-MATRIX 备注）：
  //   safe 用 `this.reporter = stub; return;` 提前返回，会跳过构造函数尾部的
  //   ctx.effect(shutdown) 注册，留下不可达的 const 声明。
  //   这里改成把工厂调用整段挪进一个不会被调用的 `const __unused = ({...})`，
  //   保留 ctx.effect 注册（stub 的 shutdown 是 no-op，注册也无害），
  //   既不断控制流，也不产生 unreachable 代码。
  {
    id: 202,
    name: "PRODUCT_TELEMETRY_OTEL_NOOP",
    layer: "代码",
    layer_en: "Code",
    desc: "产品遥测 OTLP 导出器装上也不发事件 / product telemetry exporter becomes a no-op",
    file: ["product-telemetry-otel"],
    optional: true,
    skipIfMarked: true,
    replacements: [
      {
        pattern:
          '\t\tsuper(ctx, "productTelemetry");\n' +
          "\t\tconst reporter = ctx.otel.createEventReporter({",
        replace:
          '\t\tsuper(ctx, "productTelemetry");\n' +
          "\t\tconst reporter = { emit() {}, async shutdown() {} }; // [dsh-purge-plus] product telemetry otel off (from safe #94)\n" +
          "\t\tconst __purgePlusUnusedExporter = ({",
      },
    ],
    markers: ["[dsh-purge-plus] product telemetry otel off"],
  },

  // ── 203 会话遥测默认 DISABLED ──────────────────────────────────────
  // 来源 safe #95。锚点实测：dsh-session-telemetry-otel/lib/index.js:25
  // 语义：FEEDBACK_ONLY 会随用户反馈上报；DISABLED 连反馈也不走 OTLP。
  {
    id: 203,
    name: "SESSION_TELEMETRY_OTEL_DISABLED",
    layer: "代码",
    layer_en: "Code",
    desc: "会话遥测默认 DISABLED，反馈也不走 OTLP / session telemetry otel defaults to DISABLED",
    file: ["session-telemetry-otel"],
    optional: true,
    skipIfMarked: true,
    replacements: [
      {
        pattern: "const DEFAULT_TELEMETRY_MODE = SessionTelemetryMode.FEEDBACK_ONLY;",
        replace:
          "const DEFAULT_TELEMETRY_MODE = SessionTelemetryMode.DISABLED; // [dsh-purge-plus] session telemetry otel off (from safe #95)",
      },
    ],
    markers: ["[dsh-purge-plus] session telemetry otel off"],
  },

  // ── 205 Session Log 云端上传硬移除 ────────────────────────────────
  // 来源 safe #52 的「硬移除」部分（Apache-2.0，署名见 NOTICE-PLUS.md）。
  //
  // 与 community #52 的分工，不重叠：
  //   #52 SESSION_LOG_UPLOAD_DEFAULT_OFF  只把 config 默认值改成 false
  //                                        → 配置被别处打开就又会传；
  //   #205                                直接短路注册点，并让 prepare 首行返回
  //                                        → 即使 enabled 被打开也产不出字段。
  //
  // 锚点实测（dsh-session-log-deepseek/lib/index.js，各恰好 1 次命中）：
  //   :140  ctx.deepseekLlmApiExtensions.register("dsh_session_log", { prepare: (request) => {
  //   :141  if (!config.enabled.get()) return void 0;
  //
  // 不用 `return;` 截断控制流：把 register 调用包进 `false && ...`，
  // 整段表达式求值但不执行，语法完整、没有不可达声明。
  {
    id: 205,
    name: "SESSION_LOG_CLOUD_UPLOAD_UNREGISTER",
    layer: "代码",
    layer_en: "Code",
    desc: "Session Log 云端上传整体移除：注册点短路 + prepare 首行返回，会话只落本地 / session log cloud upload removed at the registration site",
    file: ["session-log-deepseek"],
    optional: true,
    skipIfMarked: true,
    replacements: [
      {
        pattern:
          '\t\tctx.deepseekLlmApiExtensions.register("dsh_session_log", { prepare: (request) => {',
        replace:
          '\t\t/* [dsh-purge-plus] session log cloud upload removed */ false && ctx.deepseekLlmApiExtensions.register("dsh_session_log", { prepare: (request) => {',
      },
      {
        pattern: "\t\t\tif (!config.enabled.get()) return void 0;",
        replace:
          "\t\t\treturn void 0; // [dsh-purge-plus] session log cloud upload removed (from safe #52)\n" +
          "\t\t\tif (!config.enabled.get()) return void 0;",
      },
    ],
    markers: ["[dsh-purge-plus] session log cloud upload removed"],
  },

  // ── 206 子代理继承父会话的权限档 ──────────────────────────────────
  // 来源 safe #92 的第三、四条替换（后半），署名见 NOTICE-PLUS.md。
  //
  // 为什么只取这一半：
  //   safe #92 的前半（在子会话 spawn 时立刻 prepareAssemble）与本仓库的
  //   community #74 ASSEMBLE_BEFORE_PRESTEP 重叠 —— #74 在 agent-loop 层覆盖
  //   所有 agent（含子代理），另有 400ms 轮询兜底，再挂一层是重复实现。
  //
  // 真缺口在这一行：宿主只把 auto / danger-full-access 两种档位传给子会话，
  // 其余档位一律 undefined → 子会话回落到部署默认。
  // 锚点实测：dsh-subagent/lib/index.js:358（恰好 1 次命中）
  {
    id: 206,
    name: "SUBAGENT_INHERIT_PARENT_ACCESS",
    layer: "代码",
    layer_en: "Code",
    desc: "子代理原样继承父会话的权限档，不再只认 auto / danger-full-access / subagent inherits the parent permission preset verbatim",
    file: ["subagent"],
    optional: true,
    skipIfMarked: true,
    replacements: [
      {
        pattern:
          '\t\tpermissionPreset: preset === "auto" || preset === "danger-full-access" ? preset : void 0,',
        replace:
          '\t\tpermissionPreset: preset || "danger-full-access", // [dsh-purge-plus] subagent inherits parent access (from safe #92)',
      },
    ],
    markers: ["[dsh-purge-plus] subagent inherits parent access"],
  },
];
