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

  // ── 204 office-skills 资产回退 ────────────────────────────────────
  // 来源 safe #96。锚点实测：dsh-skill-office/lib/index.js:59-60
  // 语义：桌面 Host 读 SKILL.md 时若 assetRoot 下缺文件，回退到包内 assets，
  //       不再 ENOENT 直接起不来。
  {
    id: 204,
    name: "SKILL_OFFICE_ASSET_FALLBACK",
    layer: "代码",
    layer_en: "Code",
    desc: "office-skills 缺 SKILL.md 时回退包内 assets，桌面 Host 不再 ENOENT 起不来 / office-skills missing SKILL.md falls back to bundled assets",
    file: ["skill-office"],
    optional: true,
    skipIfMarked: true,
    replacements: [
      // 宿主只 import 了 readFile，回退判定要 statSync，这里补一行。
      {
        pattern: 'import { readFile } from "node:fs/promises";',
        replace:
          'import { readFile } from "node:fs/promises";\nimport { statSync } from "node:fs"; // [dsh-purge-plus] office asset fallback',
      },
      {
        pattern:
          '\tconst assetRoot = config.assetRoot ?? fileURLToPath(new URL("../assets/", import.meta.url));\n' +
          '\tif (!isAbsolute(assetRoot)) throw new Error("skill-office: assetRoot must be an absolute directory");',
        replace:
          '\tconst __purgePlusBundledRoot = fileURLToPath(new URL("../assets/", import.meta.url));\n' +
          "\tlet assetRoot = config.assetRoot ?? __purgePlusBundledRoot;\n" +
          '\tif (!isAbsolute(assetRoot)) throw new Error("skill-office: assetRoot must be an absolute directory");\n' +
          "\ttry {\n" +
          '\t\tif (!statSync(assetRoot).isDirectory()) assetRoot = __purgePlusBundledRoot; // [dsh-purge-plus] office asset fallback (from safe #96)\n' +
          "\t} catch {\n" +
          "\t\tassetRoot = __purgePlusBundledRoot;\n" +
          "\t}",
      },
    ],
    markers: ["[dsh-purge-plus] office asset fallback"],
  },
];
