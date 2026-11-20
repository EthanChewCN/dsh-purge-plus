// [dsh-purge-plus] 对 vendor/community 的文本编辑清单。
//
// 为什么用「精确锚点 + 失败即报错」而不是 patch -p1：
//   本仓库对上游的改动只有「新增行」和「常量重指」，没有逻辑删改。
//   文本补丁会在上游换行/缩进/引号风格时静默 fuzz 到错误位置；
//   这里 find 必须**恰好命中 N 次**（默认 1），命中数不符立刻失败并打印文件名与锚点，
//   让升级冲突变成一条明确的报错，而不是一个跑得起来但语义错了的包。
//
// 每条：{ file, find, replace, required, count }
//   required: true  → 命中数不符就中止构建（核心接线，缺了插件不完整）
//   required: false → 不符只警告（可选接线，宿主版本差异可接受）
//   count           → 期望命中次数，默认 1；>1 时全部替换

import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const CFG = JSON.parse(fs.readFileSync(path.join(HERE, "repo.json"), "utf8"));

/** 解析本仓库坐标：环境变量优先，其次 overlay/repo.json。 */
export function resolveRepo() {
  const env = process.env.GITHUB_REPO;
  if (env && env.includes("/")) {
    const [owner, repo] = env.split("/");
    return { owner, repo, revision: CFG.revision };
  }
  return { owner: CFG.owner, repo: CFG.repo, revision: CFG.revision };
}

/** 生成编辑清单。repo 变化只影响常量重指这几条。 */
export function buildEdits(repo = resolveRepo()) {
  const slug = `${repo.owner}/${repo.repo}`;
  const owner = repo.owner;
  const name = repo.repo;

  return [
    // ══ A. 自有补丁表接进汇总入口 ══════════════════════════════════
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

    // ══ B. 宿主文件键表补 4 项（遥测三件 + office）═══════════════════
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

    // ══ C. 插件入口：围栏 + 改名 ════════════════════════════════════
    {
      file: "lib/index.js",
      required: true,
      find: 'import * as core from "./core.js";',
      replace:
        'import * as core from "./core.js";\n' +
        'import { installSubagentFence } from "./subagent-fence.js"; // [dsh-purge-plus]',
    },
    // 状态目录（~/.dsh/dsh-purge-community/）**故意不改**：
    //   那里存着已有补丁基线、audit.jsonl、preset-migrations。
    //   改名会让所有历史基线变成孤儿，下一次 apply 把官方原文当成"未打过"重打一遍。
    //   两家的 .dshpurge.bak 后缀相同，共用同一份基线反而更安全。
    {
      file: "lib/index.js",
      required: true,
      find: 'export const name = "dsh-purge-community";',
      replace:
        'export const name = "dsh-purge-plus"; // [dsh-purge-plus] 改包名，状态目录仍沿用 community',
    },
    {
      file: "lib/community.js",
      required: true,
      find: 'export const PACKAGE = "dsh-purge-community";',
      replace:
        'export const PACKAGE = "dsh-purge-plus"; // [dsh-purge-plus] 自检包名随仓库改名',
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

    // ══ D. 在线更新通道：从 community 的发布源改指本仓库 ══════════════
    // 不重写更新器（下载/校验/回滚逻辑全部沿用），只把「找谁要新版本」的常量换掉。
    {
      file: "lib/community.js",
      required: true,
      find: 'export const REPOSITORY = "kingcharleslzy-ai/dsh-purge";',
      replace: `export const REPOSITORY = "${slug}"; // [dsh-purge-plus] 在线更新源改指本仓库`,
    },
    // 升级前若依赖写的是「最新版直链」，要认得我们自己的 URL 形状，
    // 否则 fromLatest 判 false，会退化成普通 file: 安装并丢掉 keepDisabled 语义。
    {
      file: "lib/community.js",
      required: true,
      find:
        "/^https:\\/\\/github\\.com\\/kingcharleslzy-ai\\/dsh-purge\\/releases\\/latest\\/download\\/dsh-purge-community(?:-[0-9]+\\.[0-9]+\\.[0-9]+)?\\.tgz$/",
      replace:
        `/^https:\\/\\/github\\.com\\/${owner}\\/${name}\\/releases\\/latest\\/download\\/${name}(?:-[0-9]+\\.[0-9]+\\.[0-9]+(?:-plus\\.[0-9]+)?)?\\.tgz$/`,
    },
    {
      file: "lib/update-net.js",
      required: true,
      find: 'export const SOURCE_REPO = "kingcharleslzy-ai/dsh-purge";',
      replace: `export const SOURCE_REPO = "${slug}"; // [dsh-purge-plus] beta/zip 通道跟随本仓库`,
    },
    // 已安装包的身份校验：认 plus 与 community 两种包名，迁移期不会误报「标识无效」。
    {
      file: "lib/update-targets.js",
      required: true,
      find: "      if (pkg.name !== 'dsh-purge-community' || !pkg.version) throw Error('安装包标识或版本缺失');",
      replace:
        "      if (!['dsh-purge-plus','dsh-purge-community'].includes(pkg.name) || !pkg.version) throw Error('安装包标识或版本缺失'); // [dsh-purge-plus]",
    },
    {
      file: "lib/installed-package.js",
      required: true,
      find: "export const COMMUNITY_PACKAGE = 'dsh-purge-community';",
      replace:
        "export const COMMUNITY_PACKAGE = 'dsh-purge-plus'; // [dsh-purge-plus] 本仓库包名",
    },
    {
      file: "lib/installed-package.js",
      required: true,
      find: "const aliases = [COMMUNITY_PACKAGE, 'dsh-purge'];",
      replace:
        "const aliases = [COMMUNITY_PACKAGE, 'dsh-purge-community', 'dsh-purge']; // [dsh-purge-plus] 迁移期兼容",
    },
    {
      file: "lib/installed-package.js",
      required: true,
      find: "    if (pkg.name !== COMMUNITY_PACKAGE || typeof pkg.version !== 'string'",
      replace:
        "    if (![COMMUNITY_PACKAGE, 'dsh-purge-community'].includes(pkg.name) || typeof pkg.version !== 'string'",
    },
    {
      file: "lib/rollback-transaction.js",
      required: true,
      count: 3,
      find: "['dsh-purge-community','dsh-purge','dsh-purge-panel']",
      replace: "['dsh-purge-plus','dsh-purge-community','dsh-purge','dsh-purge-panel']",
    },
    {
      file: "lib/update.js",
      required: false,
      find: 'throw new Error("未找到已安装的 dsh-purge-community；请先用 dsh plugin add 安装社区版，再使用在线更新");',
      replace:
        'throw new Error("未找到已安装的 dsh-purge-plus；请先用 dsh plugin add 安装本插件，再使用在线更新"); // [dsh-purge-plus]',
    },
    {
      file: "lib/update-http.js",
      required: false,
      find: "'user-agent':'dsh-purge-community-update'",
      replace: "'user-agent':'dsh-purge-plus-update'",
    },
    // 发行 tag 白名单。上游只认 vX.Y.Z；本仓库的版本是 1.7.20-plus.N，
    // 不放宽这一条，releases 列表会把我们自己的 tag 全部过滤掉，
    // 面板「检查更新」永远显示「已是最新」——这是在线升级能不能用的硬闸门。
    {
      file: "lib/update.js",
      required: true,
      find: "const FORK_RELEASE_RE = /^v\\d+\\.\\d+\\.\\d+$/;",
      replace:
        "const FORK_RELEASE_RE = /^v\\d+\\.\\d+\\.\\d+(?:-plus\\.\\d+)?$/; // [dsh-purge-plus] 认 -plus.N 后缀",
    },
    // 同一道闸门在 community.js 里还有两处**内联**正则：一处过滤发行列表，
    // 一处是安装前的 ref 校验。只放宽 update.js 的 FORK_RELEASE_RE 是不够的——
    // 列表能过，但点「安装」会抛「只安装正式发布版本」。
    {
      file: "lib/community.js",
      required: true,
      find: "      (r) => !r.draft && !r.prerelease && /^v\\d+\\.\\d+\\.\\d+$/.test(r.tag_name),",
      replace:
        "      (r) => !r.draft && !r.prerelease && /^v\\d+\\.\\d+\\.\\d+(?:-plus\\.\\d+)?$/.test(r.tag_name), // [dsh-purge-plus] 认 -plus.N 后缀",
    },
    {
      file: "lib/community.js",
      required: true,
      find: 'if (!/^v\\d+\\.\\d+\\.\\d+$/.test(release.ref)) throw Error("只安装正式发布版本");',
      replace:
        'if (!/^v\\d+\\.\\d+\\.\\d+(?:-plus\\.\\d+)?$/.test(release.ref)) throw Error("只安装正式发布版本"); // [dsh-purge-plus]',
    },
    {
      file: "lib/update.js",
      required: false,
      count: 2,
      find: "label: `Purge Community ${version}`,",
      replace: "label: `dsh-purge-plus ${version}`,"
    },
    // UPSTREAM_REPO 现在指向本仓库，于是 listGithubTags()/upstreamHeadItem()
    // 会把自己的 tag 和 master 列成「上游 · 已停止维护」——语义反了。
    // 这两条通道对我们只剩「看提交号」的用处，文案要如实说。
    {
      file: "lib/update.js",
      required: true,
      regex: true,
      // 用正则而不是字面量：这段文案里含上游仓库坐标，而上游坐标可能在
      // vendor 副本里被改名（本仓库基座就是一次 fork），字面量锚点会静默失配。
      find: 'export const UPSTREAM_WARNING =\\s*\\n\\s*"[^"]*?已停止维护[^"]*"\\s*\\+\\s*\\n\\s*"[^"]*";',
      replace:
        'export const UPSTREAM_WARNING = // [dsh-purge-plus] 本仓库自持发布，tag/head 通道只用于对照提交号\n' +
        '  "这是本仓库的 tag / head 通道，只用于对照提交号，不是发行包来源。" +\n' +
        '  "在线升级请走 releases（stable）通道，它会校验 SHA256SUMS.txt。";',
    },
    {
      file: "lib/update.js",
      required: true,
      find: "label: `${versionLabel(name, channel, sha)} · 上游`,",
      replace: "label: `${versionLabel(name, channel, sha)} · 本仓库 tag（仅对照）`, // [dsh-purge-plus]",
    },
    {
      file: "lib/update.js",
      required: true,
      find: "label: `${versionLabel(version, channel, sha)} · 上游 ${ref}（已停止维护）`,",
      replace: "label: `${versionLabel(version, channel, sha)} · 本仓库 ${ref}`, // [dsh-purge-plus]",
    },
    // 基座沿用 community 的状态目录，本机的 version-history.json 里存着社区版的
    // 下载记录（v1.6.67 … v1.7.20）。这些 ref 在本仓库没有对应发行包，列出来
    // 就是一堆点不动的条目——只有当前 releases 里真实存在的才保留。
    {
      file: "lib/update.js",
      required: true,
      find:
        '  for (const item of readHistory()) {\n' +
        '    if (!item || !item.ref || withdrawnVersion(item)) continue;',
      replace:
        '  // [dsh-purge-plus] 历史条目只保留本仓库确实发过的版本，否则面板会列出\n' +
        '  // 一堆装不动的条目（状态目录沿用 community，历史里混着它的记录）。\n' +
        '  const forkRefs = new Set(fork.rows.map((row) => row.ref));\n' +
        '  for (const item of readHistory()) {\n' +
        '    if (!item || !item.ref || withdrawnVersion(item)) continue;\n' +
        '    if (!forkRefs.has(item.ref)) continue;',
    },
    {
      file: "lib/community.js",
      required: true,
      find: "label: `dsh-purge Community ${version}`,",
      replace: "label: `dsh-purge-plus ${version}`, // [dsh-purge-plus]",
    },

    // ══ F. preset-presence：.DS_Store 让探测整体退化成 unknown ═══════
    // ~/.dsh/profiles/ 下通常有 macOS 的 .DS_Store（是文件，不是目录）。
    // 原版遍历 profiles 里的每一项去读 <name>/package.json，读 .DS_Store/package.json
    // 抛 ENOTDIR，而这里只放行 ENOENT → 外层 catch 把整个探测吞成 "unknown"，
    // #76 于是永远无法静态核对（自检面板里「官方身份剥离」这一层显示 unknown）。
    {
      file: "lib/preset-presence.js",
      required: true,
      find: "    for (const name of names) {",
      replace:
        "    for (const name of names) {\n" +
        '      if (name.startsWith(".")) continue; // [dsh-purge-plus] 跳过 .DS_Store 等隐藏项',
    },
    {
      file: "lib/preset-presence.js",
      required: true,
      find: '        if (e.code === "ENOENT") continue;',
      replace:
        '        // [dsh-purge-plus] .DS_Store 是文件，读它的 package.json 抛 ENOTDIR；\n' +
        '        // 只放行 ENOENT 会让整个探测退化成 unknown。\n' +
        '        if (e.code === "ENOENT" || e.code === "ENOTDIR") continue;',
    },
    // F-2：真正的病灶在这里。liangshenRoots 遍历 profiles 下的每一项拼候选路径，
    // profiles 里混着 macOS 的 .DS_Store（文件），拼出来的
    // .DS_Store/node_modules/... 用 lstatSync 探测会抛 ENOTDIR，
    // 而下面的 catch 只放行 ENOENT → 整个 liangshenPresence 退化成 "unknown"。
    {
      file: "lib/preset-presence.js",
      required: true,
      find: "  for (const name of profiles) {",
      replace:
        "  for (const name of profiles) {\n" +
        '    if (name.startsWith(".")) continue; // [dsh-purge-plus] .DS_Store 不是 profile',
    },
    {
      file: "lib/preset-presence.js",
      required: true,
      find: '          if (e.code !== "ENOENT") throw e;',
      replace:
        '          // [dsh-purge-plus] ENOTDIR = 这个「profile」其实是文件（.DS_Store）\n' +
        '          if (e.code !== "ENOENT" && e.code !== "ENOTDIR") throw e;',
    },

    // ══ G. P0：静默失败四件 ══════════════════════════════════════════
    // 共同点：**读代码看不出来，跑起来也不报错**，只是行为悄悄不对。
    // 每条都配了闸门（scripts/verify.mjs 第 [12] 组）。

    // G-1. migrate() 引用了两个根本没定义、也没 import 的常量
    //      schema.js 的 migrate() 用 LEGACY_STAGE_MAP 与 SCOPE_SQL，但本文件只
    //      import 了 parseTargetPort。两处引用都在 try{}catch{} 里，ReferenceError
    //      被 catch 吞成「忽略」→ 老库 stage_code 回填与 asset.scope 回填从未执行。
    //      修法：常量搬进 schema.js（它自称「数据形状唯一定义处」，且是 store-core
    //      的依赖叶子，放这里不产生循环），store-core 改成 import 并保留对外导出。
    {
      file: "lib/redteam/schema.js",
      required: true,
      find: "import { parseTargetPort } from './score-rules.js'",
      replace:
        "import { parseTargetPort } from './score-rules.js'\n" +
        "\n" +
        "/* [dsh-purge-plus] 这两个常量原定义在 store-core.js，却被本文件的 migrate() 引用。\n" +
        "   两处引用都包在 try{}catch{} 里，ReferenceError 被 catch 吞掉 → 迁移静默 no-op。\n" +
        "   搬到这里：schema.js 是「数据形状的唯一定义处」，也是 store-core 的依赖叶子，\n" +
        "   放这里不产生循环依赖。store-core 原样再导出，对外 API 不变。 */\n" +
        "\n" +
        "/**\n" +
        " * 内外网判定（SQL 片段，作用于 asset.ip）：\n" +
        " * RFC1918 私网 + 回环 + 链路本地 + CGNAT 视为内网，其余为外网。\n" +
        " */\n" +
        "export const SCOPE_SQL = `CASE\n" +
        "  WHEN ip LIKE '10.%' OR ip LIKE '192.168.%' OR ip LIKE '127.%' OR ip LIKE '169.254.%'\n" +
        "    OR (ip LIKE '172.%' AND CAST(substr(ip, 5, instr(substr(ip, 5), '.') - 1) AS INTEGER) BETWEEN 16 AND 31)\n" +
        "    OR (ip LIKE '100.%' AND CAST(substr(ip, 5, instr(substr(ip, 5), '.') - 1) AS INTEGER) BETWEEN 64 AND 127)\n" +
        "  THEN 'internal' ELSE 'external' END`\n" +
        "\n" +
        "/** 旧攻击链 stage → 新阶段 code 的兜底映射。 */\n" +
        "export const LEGACY_STAGE_MAP = {\n" +
        "  recon: 'recon', vuln: 'internet', exploit: 'internet',\n" +
        "  access: 'internal', pivot: 'boundary', data: 'internal', other: 'recon',\n" +
        "}",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "/**\n" +
        " * 内外网判定（SQL 片段，作用于 asset.ip）：\n" +
        " * RFC1918 私网 + 回环 + 链路本地 + CGNAT 视为内网，其余为外网。\n" +
        " */\n" +
        "const SCOPE_SQL = `CASE\n" +
        "  WHEN ip LIKE '10.%' OR ip LIKE '192.168.%' OR ip LIKE '127.%' OR ip LIKE '169.254.%'\n" +
        "    OR (ip LIKE '172.%' AND CAST(substr(ip, 5, instr(substr(ip, 5), '.') - 1) AS INTEGER) BETWEEN 16 AND 31)\n" +
        "    OR (ip LIKE '100.%' AND CAST(substr(ip, 5, instr(substr(ip, 5), '.') - 1) AS INTEGER) BETWEEN 64 AND 127)\n" +
        "  THEN 'internal' ELSE 'external' END`",
      replace:
        "/* [dsh-purge-plus] SCOPE_SQL 已移到 schema.js（migrate() 与查询共用同一份定义）。 */",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "/** 旧攻击链 stage → 新阶段 code 的兜底映射。 */\n" +
        "export const LEGACY_STAGE_MAP = {\n" +
        "  recon: 'recon', vuln: 'internet', exploit: 'internet',\n" +
        "  access: 'internal', pivot: 'boundary', data: 'internal', other: 'recon',\n" +
        "}",
      replace:
        "/* [dsh-purge-plus] LEGACY_STAGE_MAP 定义移到 schema.js（migrate() 要用）；\n" +
        "   本文件在 import 之后原样再导出，对外 API 不变。 */",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "import {\n" +
        "  DDL, KNOWLEDGE_DDL, ASSET_FTS_DDL, POC_FTS_DDL, HAS_FTS5,\n" +
        "  POC_CATEGORIES, pocCategoryName, guessPocCategory,\n" +
        "  migrate, migrateKnowledge,\n" +
        "} from './schema.js'",
      replace:
        "import {\n" +
        "  DDL, KNOWLEDGE_DDL, ASSET_FTS_DDL, POC_FTS_DDL, HAS_FTS5,\n" +
        "  POC_CATEGORIES, pocCategoryName, guessPocCategory,\n" +
        "  SCOPE_SQL, LEGACY_STAGE_MAP, // [dsh-purge-plus] 定义已搬到 schema.js\n" +
        "  migrate, migrateKnowledge,\n" +
        "} from './schema.js'\n" +
        "\n" +
        "/* [dsh-purge-plus] 对外 API 不变：原先 `export const LEGACY_STAGE_MAP` 定义在本文件，\n" +
        "   现在从 schema.js 引入后原样再导出，import 它的模块不需要改。 */\n" +
        "export { LEGACY_STAGE_MAP }",
    },

    // G-2/G-3. 无靶标时的写操作判定 + 未知 op 被兜底吞成 ok:true
    //   原版：`const writing = /^(add|save|update|delete|import|assess|open)/.test(op)`
    //   漏了 shotAdd / shotDelete / assetTest / resetPrompts 四条 → 无靶标时它们
    //   走「只读空结果」分支，返回 { ok: true, items: [], ... }，调用方以为写进去了。
    //   更糟的是同一行的兜底 `return { ok:true, items:[], ... }` 对**任何**未知 op
    //   都成立，于是 dispatch 末尾的 `throw new Error('unknown op: ...')` 永远到不了
    //   ——拼错的 op 名静默变成「成功、空结果」。
    //   修法：显式集合；未知 op 在兜底之前就抛。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "export function dispatch(store, req = {}) {\n" +
        "  const op = typeof req.op === 'string' ? req.op.trim() : ''",
      replace:
        "/* [dsh-purge-plus] 需要靶标的 op 分两类。原版用前缀正则判「写」，漏了四条；\n" +
        "   而兜底分支对任何未知 op 都返回 ok:true，把 `unknown op` 的抛错彻底掩盖。 */\n" +
        "const WRITE_OPS = new Set([\n" +
        "  'addVuln', 'updateVuln', 'addCredential', 'addAccess', 'addWebshell', 'updateWebshell',\n" +
        "  'shotAdd', 'shotDelete', 'addTunnel', 'updateTunnel', 'addHttpEvidence', 'addChainStep',\n" +
        "  'assetTest', 'assessAsset', 'saveScorePoint', 'deleteScorePoint', 'addScoreHit',\n" +
        "  'saveStage', 'addAttackFile', 'import', 'savePrompt', 'resetPrompts',\n" +
        "])\n" +
        "\n" +
        "const READ_OPS = new Set([\n" +
        "  'snapshot', 'assets', 'asset', 'graph', 'attackGraph', 'stats', 'vulns', 'vulnStats',\n" +
        "  'credentials', 'access', 'sessions', 'webshells', 'tunnels', 'shots', 'shotData',\n" +
        "  'domains', 'web', 'httpEvidence', 'chain', 'report', 'scores', 'scoreChain', 'scoreReport',\n" +
        "  'activeTests', 'testStats', 'consoleDigest', 'stages', 'reportTargets', 'discoveryTimeline',\n" +
        "  'attackFiles', 'readAttackFile', 'prompts',\n" +
        "])\n" +
        "\n" +
        "export function dispatch(store, req = {}) {\n" +
        "  const op = typeof req.op === 'string' ? req.op.trim() : ''",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      const writing = /^(add|save|update|delete|import|assess|open)/.test(op)\n" +
        "      if (writing) return { ok: false, error: '请先在顶部选择或创建一个靶标' }\n" +
        "      return { ok: true, items: [], total: 0, stats: null, segments: [], stages: [], roles: [] }",
      replace:
        "      // [dsh-purge-plus] 写操作用显式集合判（前缀正则漏了 shotAdd/shotDelete/\n" +
        "      // assetTest/resetPrompts）；未知 op 在兜底之前抛，不再伪装成空结果。\n" +
        "      if (WRITE_OPS.has(op)) return { ok: false, error: '请先在顶部选择或创建一个靶标' }\n" +
        "      if (!READ_OPS.has(op)) throw new Error(`unknown op: ${op}`)\n" +
        "      return { ok: true, items: [], total: 0, stats: null, segments: [], stages: [], roles: [] }",
    },

    // G-4. 模板检索的 category / offset 被静默丢弃，templateStats 缺 byCategory
    //   tools.js 的 redteam_poc_search 调的是
    //     store.searchTemplates(q, limit, 0, category)
    //   而 store 的签名是 searchTemplates(q, limit = 40) —— 第 3、4 个参数进不来，
    //   「按归类筛模板」这个已写进工具 schema 的参数完全无效。
    //   同时面板按 `templates.byCategory` 的 { code, n } 画分类计数，
    //   templateStats() 却只返回 { dir, total, cve } → 分类计数永远是 0。
    //   归类判定复用 guessPocCategory（推测逻辑只有一份），不再写第二套关键词。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "  templateStats() {\n" +
        "    const { dir, items } = this.#nucleiIndex()\n" +
        "    const cve = items.filter((x) => /cve-\\d{4}-\\d+/i.test(x[0])).length\n" +
        "    return { dir: dir || null, total: items.length, cve }\n" +
        "  }",
      replace:
        "  templateStats() {\n" +
        "    const { dir, items } = this.#nucleiIndex()\n" +
        "    const cve = items.filter((x) => /cve-\\d{4}-\\d+/i.test(x[0])).length\n" +
        "    /* [dsh-purge-plus] byCategory：面板按 { code, n } 画分类计数，\n" +
        "       工具侧按 { name, n } 生成文字，两个键都给出。归类复用 guessPocCategory，\n" +
        "       与知识库同一套口径。 */\n" +
        "    const counts = new Map()\n" +
        "    for (const [path, name, , tags] of items) {\n" +
        "      const code = guessPocCategory(path + ' ' + name + ' ' + tags)\n" +
        "      counts.set(code, (counts.get(code) || 0) + 1)\n" +
        "    }\n" +
        "    const byCategory = [...counts.entries()]\n" +
        "      .map(([code, n]) => ({ code, name: pocCategoryName(code), n }))\n" +
        "      .sort((a, b) => b.n - a.n)\n" +
        "    return { dir: dir || null, total: items.length, cve, byCategory }\n" +
        "  }",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "  searchTemplates(q, limit = 40) {\n" +
        "    const { dir, items } = this.#nucleiIndex()\n" +
        "    if (dir === null) return { dir: null, total: 0, items: [] }\n" +
        "    const raw = String(q || '').trim()\n" +
        "    if (raw === '') return { dir, total: items.length, items: [] }\n" +
        "    const needle = raw.toLowerCase()\n" +
        "    const out = []\n" +
        "    for (const [path, name, severity, tags] of items) {\n" +
        "      const hay = (path + ' ' + name + ' ' + tags).toLowerCase()\n" +
        "      if (hay.includes(needle)) out.push({ path, name, severity, tags })\n" +
        "      if (out.length >= limit) break\n" +
        "    }\n" +
        "    return { dir, total: items.length, items: out }\n" +
        "  }",
      replace:
        "  /* [dsh-purge-plus] 补上 offset 与 category：\n" +
        "     · tools.js 的 redteam_poc_search 一直在传 (q, limit, 0, category)，\n" +
        "       原签名只有 (q, limit)，后两个参数被静默丢弃；\n" +
        "     · 面板要 matched / offset 才能显示「第几页 / 命中多少」；\n" +
        "     · 归类判定复用 guessPocCategory，与知识库同一口径。 */\n" +
        "  searchTemplates(q, limit = 40, offset = 0, category = '') {\n" +
        "    const { dir, items } = this.#nucleiIndex()\n" +
        "    if (dir === null) return { dir: null, total: 0, matched: 0, offset: 0, items: [] }\n" +
        "    const cap = Math.min(Number(limit) || 40, 200)\n" +
        "    const skip = Math.max(0, Number(offset) || 0)\n" +
        "    const cat = String(category || '').trim()\n" +
        "    const needle = String(q || '').trim().toLowerCase()\n" +
        "    const out = []\n" +
        "    for (const [path, name, severity, tags] of items) {\n" +
        "      if (cat && guessPocCategory(path + ' ' + name + ' ' + tags) !== cat) continue\n" +
        "      if (needle && !(path + ' ' + name + ' ' + tags).toLowerCase().includes(needle)) continue\n" +
        "      out.push({ path, name, severity, tags })\n" +
        "    }\n" +
        "    return { dir, total: items.length, matched: out.length, offset: skip, items: out.slice(skip, skip + cap) }\n" +
        "  }",
    },
  ];
}

export const EDITS = buildEdits();
