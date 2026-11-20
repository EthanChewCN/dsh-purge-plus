// [dsh-purge-plus] 对 vendor/community 的文本编辑清单。
//
// 为什么用「精确锚点 + 失败即报错」而不是 patch -p1：
//   本仓库对上游的改动只有 4 处、共 6 个锚点，全是新增行，没有删改。
//   文本补丁会在上游换行/缩进/引号风格时静默 fuzz 到错误位置；
//   这里 find 必须**恰好命中一次**，命中 0 次或多次都立刻失败并打印文件名与锚点，
//   让升级冲突变成一条明确的报错，而不是一个跑得起来但语义错了的包。
//
// 每条：{ file, find, replace, required }
//   required: true  → 找不到就中止构建（核心接线，缺了插件不完整）
//   required: false → 找不到只警告（可选接线，宿主版本差异可接受）

export const EDITS = [
  // ── 1. 把自有补丁表接进汇总入口 ─────────────────────────────────
  {
    file: "lib/patches/index.mjs",
    required: true,
    find: "import { STABILITY_PATCHES } from './stability.mjs';",
    replace:
      "import { STABILITY_PATCHES } from './stability.mjs';\n" +
      "import { OVERLAY_PATCHES } from './overlay.mjs'; // [dsh-purge-plus]",
  },
  {
    file: "lib/patches/index.mjs",
    required: true,
    find:
      "export const ALL_PATCHES = [...PATCHES, ...CODE_PATCHES, ...ENGINE_PATCHES, ...NEW_TOOL_PATCHES, ...OPT_IN_PATCHES, ...STABILITY_PATCHES];",
    replace:
      "export const ALL_PATCHES = [...PATCHES, ...CODE_PATCHES, ...ENGINE_PATCHES, ...NEW_TOOL_PATCHES, ...OPT_IN_PATCHES, ...STABILITY_PATCHES, ...OVERLAY_PATCHES]; // [dsh-purge-plus]",
  },

  // ── 2. 宿主文件键表补 4 项（遥测三件 + office）────────────────────
  {
    file: "lib/core.js",
    required: true,
    find:
      '    "auto-review": allExisting([\n' +
      '      ...nestedPkg(aiBase, "dsh-experimental-auto-review", "lib", "index.js"),\n' +
      "    ]),",
    replace:
      '    "auto-review": allExisting([\n' +
      '      ...nestedPkg(aiBase, "dsh-experimental-auto-review", "lib", "index.js"),\n' +
      "    ]),\n" +
      "    // [dsh-purge-plus] 上游 safe 2.0.0 移植所需的宿主文件键\n" +
      '    "product-analytics": allExisting([\n' +
      '      ...nestedPkg(aiBase, "dsh-client-product-analytics", "lib", "index.js"),\n' +
      "    ]),\n" +
      '    "product-telemetry-otel": allExisting([\n' +
      '      ...nestedPkg(aiBase, "dsh-host-product-telemetry-otel", "lib", "index.js"),\n' +
      "    ]),\n" +
      '    "session-telemetry-otel": allExisting([\n' +
      '      ...nestedPkg(aiBase, "dsh-session-telemetry-otel", "lib", "index.js"),\n' +
      "    ]),\n" +
      '    "skill-office": allExisting([\n' +
      '      ...nestedPkg(aiBase, "dsh-skill-office", "lib", "index.js"),\n' +
      "    ]),",
  },

  // ── 3. 接进插件入口 ───────────────────────────────────────────
  {
    file: "lib/index.js",
    required: true,
    find: 'import * as core from "./core.js";',
    replace:
      'import * as core from "./core.js";\n' +
      'import { installSubagentFence } from "./subagent-fence.js"; // [dsh-purge-plus]',
  },
  // ── 3b. 改名：包名 / 插件名 / 自检常量保持一致 ─────────────────
  // 状态目录（~/.dsh/dsh-purge-community/）**故意不改**：
  //   那里存着已有补丁基线、audit.jsonl、preset-migrations。
  //   改名会让所有历史基线变成孤儿，下一次 apply 把官方原文当成"未打过"重打一遍。
  //   两家的 .dshpurge.bak 后缀相同，共用同一份基线反而更安全。
  {
    file: "lib/index.js",
    required: true,
    find: 'export const name = "dsh-purge-community";',
    replace: 'export const name = "dsh-purge-plus"; // [dsh-purge-plus] 改包名，状态目录仍沿用 community',
  },
  {
    file: "lib/community.js",
    required: true,
    find: 'export const PACKAGE = "dsh-purge-community";',
    replace: 'export const PACKAGE = "dsh-purge-plus"; // [dsh-purge-plus] 自检包名随仓库改名',
  },

  {
    file: "lib/index.js",
    required: true,
    find: "export function apply(ctx, config) {\n  const cfg = { ...DEFAULTS, ...(config || {}) };",
    replace:
      "export function apply(ctx, config) {\n" +
      "  const cfg = { ...DEFAULTS, ...(config || {}) };\n" +
      "  // [dsh-purge-plus] 叶子节点围栏（来源 safe tool-gate.denyDelegation）。\n" +
      "  // 与 #9/#59 的源码补丁不重叠：那两条管审批与审核放行，这条只管子代理别再派活。\n" +
      "  try { installSubagentFence(ctx, cfg); } catch { /* 老宿主无 tools/pre-execute */ }",
  },
];
