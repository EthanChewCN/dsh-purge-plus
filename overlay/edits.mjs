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

/**
 * 读一段长代码块。
 *
 * 为什么要读文件而不是继续拼字符串：新增的后端逻辑（回报解析 / 排队 / 收口）
 * 有引号、模板串、正则，塞进 "..." + "..." 的拼接里极易出错，而且 diff 不可读。
 * 放成 .js 文件后，编辑器能直接语法检查，评审时看到的也是最终形态。
 */
const SNIP = (name) => fs.readFileSync(path.join(HERE, "snippets", name), "utf8");

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
    // 发行 tag 白名单。上游只认 vX.Y.Z；本仓库当前是 0.1.N（本来就匹配），
    // 但历史发行是 `v1.7.20-plus.N`，不放宽这一条，releases 列表会把那些
    // tag 全部过滤掉，面板「检查更新」永远显示「已是最新」——硬闸门。
    {
      file: "lib/update.js",
      required: true,
      find: "const FORK_RELEASE_RE = /^v\\d+\\.\\d+\\.\\d+$/;",
      replace:
        "const FORK_RELEASE_RE = /^v\\d+\\.\\d+\\.\\d+(?:-plus\\.\\d+)?$/; // [dsh-purge-plus] 认 -plus.N 后缀",
    },
    // 版本号换轨（0.1.N）之后，历史 `1.7.20-plus.N` 的 tag 在**数字序**上反而更高
    // （1.7.20-plus.4 > 0.1.37）。混在同一张表里比较，面板会把「旧版本」当成
    // 「有更新」推给用户——实测 checkUpdate 返回 remoteVersion=1.7.20-plus.4。
    // 规则：本包版本不带 `-plus.` 时，列表里也不收带 `-plus.` 的 tag。
    // 不写死 1.7.20：换轨后的下一个方案照样适用。
    {
      file: "lib/update.js",
      required: true,
      find: "const FORK_CACHE_TTL = 60_000;",
      replace:
        "// [dsh-purge-plus] 旧版本号方案（`<基座>-plus.N`）的 tag 不参与版本比较。\n" +
        "const LEGACY_TAG_RE = /-plus\\.\\d+$/;\n" +
        "const tagAllowed = (ref, local = localVersion()) =>\n" +
        "  FORK_RELEASE_RE.test(ref) && (!LEGACY_TAG_RE.test(ref) || LEGACY_TAG_RE.test(local));\n\n" +
        "const FORK_CACHE_TTL = 60_000;",
    },
    {
      file: "lib/update.js",
      required: true,
      find: "rows.map(forkReleaseItem).filter((item) => FORK_RELEASE_RE.test(item.ref))",
      replace: "rows.map(forkReleaseItem).filter((item) => tagAllowed(item.ref))",
    },
    {
      file: "lib/update.js",
      required: true,
      find: "  if (!FORK_RELEASE_RE.test(ref)) return null;",
      replace: "  if (!tagAllowed(ref)) return null;",
    },
    {
      file: "lib/update.js",
      required: true,
      find:
        "        warning: UPSTREAM_WARNING,\n      };\n    })\n    .filter(Boolean);\n}",
      replace:
        "        warning: UPSTREAM_WARNING,\n      };\n    })\n    .filter(Boolean)\n" +
        "    .filter((item) => tagAllowed(item.ref)); // [dsh-purge-plus] 旧方案的 tag 不再参与比较\n}",
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

    // ══ H. P1：会话 → 靶标绑定层（sessions.json）═════════════════════
    // 上游 community 的绑定是**进程内 Map**：dsh 一重启就全没了，面板也无从知道
    // 「我这个会话绑的是谁」，只能永远跟全局指针。safe 把它落成了 sessions.json，
    // 但用 writeFileSync 直接覆盖 —— 崩在写一半会留下半截 JSON，而读取侧把坏
    // JSON 当作「还没绑过」，于是**全部绑定静默消失**。
    // 这里照搬它的表结构，改用 atomicWriteSync（临时文件 + rename）。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: 'import { removeTreeNoFollowSync } from "../remove-tree.js";',
      replace:
        'import { removeTreeNoFollowSync } from "../remove-tree.js";\n' +
        "import { atomicWriteSync } from '../atomic-files.js' // [dsh-purge-plus] 会话绑定表原子写",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "  /** 切换当前靶标（界面切换或智能体绑定时调用）。 */\n" +
        "  setActiveEngagement(id) {\n" +
        "    if (!id || !existsSync(this.dbPathOf(id))) return false\n" +
        "    mkdirSync(this.root, { recursive: true })\n" +
        "    writeFileSync(this.currentPath(), String(id), 'utf8')\n" +
        "    return true\n" +
        "  }",
      replace:
        "  /** 切换当前靶标（界面切换或智能体绑定时调用）。 */\n" +
        "  setActiveEngagement(id) {\n" +
        "    if (!id || !existsSync(this.dbPathOf(id))) return false\n" +
        "    mkdirSync(this.root, { recursive: true })\n" +
        "    writeFileSync(this.currentPath(), String(id), 'utf8')\n" +
        "    return true\n" +
        "  }\n" +
        "\n" +
        "  /* ---------- [dsh-purge-plus] 会话 → 靶标绑定 ---------- */\n" +
        "\n" +
        "  /** 绑定表落盘路径：与 `current` 同级，纯文本 JSON，方便人工核对与备份。 */\n" +
        "  sessionBindingsPath() { return join(this.root, 'sessions.json') }\n" +
        "\n" +
        "  /**\n" +
        "   * 读出全部会话绑定。形状 `{ v: 1, agents: { <会话 id>: { engagement, name, at } } }`。\n" +
        "   *\n" +
        "   * 容错口径：文件缺失、半截 JSON、字段类型不对，一律当作「还没绑过」。\n" +
        "   * 绑定表是**加速器不是事实来源**——它坏了只该退化成「面板不跟随」，\n" +
        "   * 不该让面板打不开，更不该让工具调不动。\n" +
        "   */\n" +
        "  sessionBindings() {\n" +
        "    let parsed = null\n" +
        "    try { parsed = JSON.parse(readFileSync(this.sessionBindingsPath(), 'utf8')) } catch { parsed = null }\n" +
        "    const agents = parsed && parsed.agents && typeof parsed.agents === 'object' ? parsed.agents : {}\n" +
        "    const out = {}\n" +
        "    for (const [key, value] of Object.entries(agents)) {\n" +
        "      if (!value || typeof value !== 'object') continue\n" +
        "      const engagement = typeof value.engagement === 'string' ? value.engagement : ''\n" +
        "      if (!engagement) continue\n" +
        "      out[key] = {\n" +
        "        engagement,\n" +
        "        name: typeof value.name === 'string' && value.name ? value.name : engagement,\n" +
        "        at: typeof value.at === 'string' ? value.at : null,\n" +
        "      }\n" +
        "    }\n" +
        "    return out\n" +
        "  }\n" +
        "\n" +
        "  /** 某个会话绑定的靶标 id（没绑过返回 undefined）。 */\n" +
        "  sessionBinding(sessionId) {\n" +
        "    if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined\n" +
        "    const entry = this.sessionBindings()[sessionId]\n" +
        "    return entry ? entry.engagement : undefined\n" +
        "  }\n" +
        "\n" +
        "  /**\n" +
        "   * 写入一条会话绑定。\n" +
        "   *\n" +
        "   * 写入方三处，都只写**根会话 id**（子智能体沿父链继承，写子会话只会让表变脏）：\n" +
        "   * 智能体工具（open / session_bind 解析出靶标时）、面板切下拉（带 session 时）、\n" +
        "   * 以及 activateEngagement。\n" +
        "   *\n" +
        "   * 与上游 safe 的差异：safe 用 writeFileSync 直接覆盖，进程崩在写一半会留下\n" +
        "   * 半截 JSON，而读取侧把坏 JSON 当作「还没绑过」→ 全部绑定静默消失。\n" +
        "   * 这里用 atomicWriteSync（写临时文件 + rename），读到的一定是旧内容或新内容。\n" +
        "   *\n" +
        "   * @returns 是否写入成功（靶标不存在时不写，避免留下指向已删靶标的绑定）。\n" +
        "   */\n" +
        "  setSessionBinding(sessionId, engagement, name) {\n" +
        "    if (typeof sessionId !== 'string' || sessionId.length === 0) return false\n" +
        "    if (typeof engagement !== 'string' || engagement.length === 0) return false\n" +
        "    if (!existsSync(this.dbPathOf(engagement))) return false\n" +
        "    const all = this.sessionBindings()\n" +
        "    all[sessionId] = { engagement, name: typeof name === 'string' && name ? name : engagement, at: nowIso() }\n" +
        "    /* 只留最近 200 条、且靶标还存在的：表是加速器，无限增长没有意义 */\n" +
        "    const pruned = {}\n" +
        "    const rows = Object.entries(all)\n" +
        "      .sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)))\n" +
        "      .slice(0, 200)\n" +
        "    for (const [key, value] of rows) {\n" +
        "      if (existsSync(this.dbPathOf(value.engagement))) pruned[key] = value\n" +
        "    }\n" +
        "    mkdirSync(this.root, { recursive: true })\n" +
        "    try {\n" +
        "      atomicWriteSync(this.sessionBindingsPath(), JSON.stringify({ v: 1, agents: pruned }, null, 2))\n" +
        "    } catch { return false }\n" +
        "    return true\n" +
        "  }\n" +
        "\n" +
        "  /** 解绑（面板「不再跟随」用）。返回是否真的删掉了。 */\n" +
        "  clearSessionBinding(sessionId) {\n" +
        "    if (typeof sessionId !== 'string' || sessionId.length === 0) return false\n" +
        "    const all = this.sessionBindings()\n" +
        "    if (!Object.prototype.hasOwnProperty.call(all, sessionId)) return false\n" +
        "    delete all[sessionId]\n" +
        "    try {\n" +
        "      atomicWriteSync(this.sessionBindingsPath(), JSON.stringify({ v: 1, agents: all }, null, 2))\n" +
        "      return true\n" +
        "    } catch { return false }\n" +
        "  }",
    },
    // activateEngagement 带上 session 时顺带落盘：面板切下拉的那一刻就记住，
    // 而不是等下一次工具调用。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    if (op === 'activateEngagement') {\n" +
        "      const activated = store.setActiveEngagement(req.engagement)\n" +
        "      return { ok: activated, current: store.activeEngagementId() }\n" +
        "    }",
      replace:
        "    if (op === 'activateEngagement') {\n" +
        "      const activated = store.setActiveEngagement(req.engagement)\n" +
        "      /* [dsh-purge-plus] 面板切换时带上 session：这一刻就记住「这个会话用这个靶标」，\n" +
        "         重启后面板仍能跟随。不带 session 的老调用方行为不变。 */\n" +
        "      if (activated && typeof req.session === 'string' && req.session) {\n" +
        "        try { store.setSessionBinding(req.session, req.engagement, req.name) } catch { /* 绑定失败不影响切换 */ }\n" +
        "      }\n" +
        "      return { ok: activated, current: store.activeEngagementId() }\n" +
        "    }\n" +
        "    /* [dsh-purge-plus] 会话 ↔ 靶标绑定：落盘在 sessions.json，重启后仍在。\n" +
        "       三个 op 都不依赖「当前靶标」，所以和知识库一样放在全局段。 */\n" +
        "    if (op === 'sessionBinding' || op === 'sessionBindings') {\n" +
        "      const rawSession = typeof req.session === 'string' ? req.session : ''\n" +
        "      let root = rawSession\n" +
        "      if (rawSession && typeof req.resolveRoot === 'function') {\n" +
        "        try {\n" +
        "          const resolved = req.resolveRoot(rawSession)\n" +
        "          if (typeof resolved === 'string' && resolved) root = resolved\n" +
        "        } catch { /* 解析器坏掉时按原样处理 */ }\n" +
        "      }\n" +
        "      const bound = root ? store.sessionBinding(root) : undefined\n" +
        "      const meta = bound ? store.listEngagements().find((e) => e.id === bound) : undefined\n" +
        "      const base = {\n" +
        "        ok: true,\n" +
        "        session: rawSession || null,\n" +
        "        root_session: root || null,\n" +
        "        bound: bound || null,\n" +
        "        name: bound ? ((meta && meta.name) || bound) : null,\n" +
        "        current: store.activeEngagementId() || null,\n" +
        "      }\n" +
        "      if (op === 'sessionBinding') return base\n" +
        "      const agents = store.sessionBindings()\n" +
        "      const existing = new Set(store.listEngagements().map((e) => e.id))\n" +
        "      const cleaned = {}\n" +
        "      for (const [key, value] of Object.entries(agents)) if (existing.has(value.engagement)) cleaned[key] = value\n" +
        "      return Object.assign(base, { agents: cleaned })\n" +
        "    }\n" +
        "    if (op === 'bindSessionEngagement') {\n" +
        "      const sid = typeof req.session === 'string' ? req.session : ''\n" +
        "      if (!sid) return { ok: false, error: 'session required' }\n" +
        "      /* engagement 为空 = 解绑（面板上的「不再跟随」） */\n" +
        "      if (!req.engagement) return { ok: store.clearSessionBinding(sid), session: sid, bound: null }\n" +
        "      const written = store.setSessionBinding(sid, req.engagement, req.name)\n" +
        "      return { ok: written, session: sid, bound: written ? req.engagement : null }\n" +
        "    }",
    },
    // 工具侧的显式绑定也要落盘，否则智能体绑完、面板还是不知道。
    {
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "function bindKeysOf(exec) {\n" +
        "  const { rootId, sessionId, chain } = bindingKeyOf(exec)\n" +
        "  return Array.from(new Set([rootId, sessionId, ...chain].filter(Boolean)))\n" +
        "}",
      replace:
        "function bindKeysOf(exec) {\n" +
        "  const { rootId, sessionId, chain } = bindingKeyOf(exec)\n" +
        "  return Array.from(new Set([rootId, sessionId, ...chain].filter(Boolean)))\n" +
        "}\n" +
        "\n" +
        "/**\n" +
        " * [dsh-purge-plus] 把「根会话 → 靶标」落盘（sessions.json）。\n" +
        " *\n" +
        " * 进程内的 bindings Map 只活到 dsh 重启：重启后各会话都得重新绑一次，面板也\n" +
        " * 无从知道「我这个会话绑的是谁」。落一份到磁盘，面板据此跟随、重启后仍在。\n" +
        " * 只写根会话；失败只影响「面板跟不跟随」，所以不抛错。\n" +
        " */\n" +
        "function persistRootBinding(store, exec, engagement, name) {\n" +
        "  try {\n" +
        "    const { rootId } = bindingKeyOf(exec)\n" +
        "    if (!rootId) return\n" +
        "    store.setSessionBinding(rootId, engagement, name)\n" +
        "  } catch { /* 绑定表是加速器，不是事实来源 */ }\n" +
        "}",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find: "      for (const key of keys) bindings.set(key, engagement.id)",
      replace:
        "      for (const key of keys) bindings.set(key, engagement.id)\n" +
        "      persistRootBinding(store, exec, engagement.id, engagement.name) // [dsh-purge-plus]",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find: "      for (const key of keys) bindings.set(key, hit.id)",
      replace:
        "      for (const key of keys) bindings.set(key, hit.id)\n" +
        "      persistRootBinding(store, exec, hit.id, hit.name) // [dsh-purge-plus]",
    },

    // ── P3：子智能体回报 + 「现在在等谁」────────────────────────────────
    // 数据源是 agent_report 表：子智能体在最后一条消息里写 redteamReport，
    // subagent/end 时解析落库，attentionQueue 按「最需要人」排序。
    // 没有这张表，队列只能靠读自然语言猜「它是不是在等人」，那是 safe 明确否掉的做法。
    {
      file: "lib/redteam/schema.js",
      required: true,
      find: "CREATE INDEX IF NOT EXISTS ix_asset_segment ON asset(segment_cidr);",
      replace:
        "/* 子智能体结构化回报：判断「现在在等谁」的唯一事实来源。\n" +
        "   一条回报 = 一次 subagent/end 时解析出的 redteamReport（status 必填）。\n" +
        "   acknowledged_at 非空 = 这条已经被人/主会话处理过，不再进「有人在等」队列。\n" +
        "   没有这一列，一条 waiting 就是永生的：队列每轮都重新把它算成有人在等，\n" +
        "   同一段提示词会无限次被重新生成、重新发进对话。 */\n" +
        "CREATE TABLE IF NOT EXISTS agent_report (\n" +
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,\n" +
        "  session_id TEXT NOT NULL,\n" +
        "  parent_session TEXT,\n" +
        "  role TEXT,\n" +
        "  label TEXT,\n" +
        "  status TEXT NOT NULL,\n" +
        "  blocked_reason TEXT,\n" +
        "  needs TEXT,\n" +
        "  summary TEXT,\n" +
        "  created_at TEXT,\n" +
        "  acknowledged_at TEXT\n" +
        ");\n" +
        "CREATE INDEX IF NOT EXISTS ix_agent_report_session ON agent_report(session_id);\n" +
        "CREATE INDEX IF NOT EXISTS ix_agent_report_parent ON agent_report(parent_session, id);\n" +
        "\n" +
        "CREATE INDEX IF NOT EXISTS ix_asset_segment ON asset(segment_cidr);",
    },
    {
      file: "lib/redteam/schema.js",
      required: true,
      find: "  ensure('tunnel', 'entry_kind', 'TEXT')",
      replace:
        "  ensure('tunnel', 'entry_kind', 'TEXT')\n" +
        "  /* 回报的「已处理」标记：老库（曾装过 safe）可能有表但没有这一列 */\n" +
        "  ensure('agent_report', 'acknowledged_at', 'TEXT')",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "  /* ---------- 路径 ---------- */",
      replace: SNIP("store-attention.js") + "\n  /* ---------- 路径 ---------- */",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      const written = store.setSessionBinding(sid, req.engagement, req.name)\n" +
        "      return { ok: written, session: sid, bound: written ? req.engagement : null }\n" +
        "    }",
      replace:
        "      const written = store.setSessionBinding(sid, req.engagement, req.name)\n" +
        "      return { ok: written, session: sid, bound: written ? req.engagement : null }\n" +
        "    }\n" +
        SNIP("store-attention-ops.js"),
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "function persistRootBinding(store, exec, engagement, name) {\n" +
        "  try {\n" +
        "    const { rootId } = bindingKeyOf(exec)\n" +
        "    if (!rootId) return\n" +
        "    store.setSessionBinding(rootId, engagement, name)\n" +
        "  } catch { /* 绑定表是加速器，不是事实来源 */ }\n" +
        "}",
      replace:
        "function persistRootBinding(store, exec, engagement, name) {\n" +
        "  try {\n" +
        "    const { rootId } = bindingKeyOf(exec)\n" +
        "    if (!rootId) return\n" +
        "    store.setSessionBinding(rootId, engagement, name)\n" +
        "  } catch { /* 绑定表是加速器，不是事实来源 */ }\n" +
        "}\n" +
        "\n" +
        "/**\n" +
        " * [dsh-purge-plus] 把宿主给的「最后一条助手消息」压成纯文本。\n" +
        " *\n" +
        " * 形状不固定：字符串、内容块数组（{type:'text',text}）、{content:[...]}、{text}。\n" +
        " * 只取文本块，其它类型（tool_use / image）直接跳过 —— 回报是模型写的自然语言，\n" +
        " * 工具调用参数里出现的 redteamReport 不算回报。\n" +
        " */\n" +
        "function textOfAssistantMessage(message) {\n" +
        "  if (!message) return ''\n" +
        "  if (typeof message === 'string') return message\n" +
        "  const blocks = Array.isArray(message) ? message : (Array.isArray(message.content) ? message.content : null)\n" +
        "  if (blocks !== null) {\n" +
        "    return blocks.map((b) => {\n" +
        "      if (typeof b === 'string') return b\n" +
        "      if (b && typeof b.text === 'string') return b.text\n" +
        "      return ''\n" +
        "    }).join('\\n')\n" +
        "  }\n" +
        "  if (typeof message.text === 'string') return message.text\n" +
        "  return ''\n" +
        "}",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "        if (rootId === undefined) return\n" +
        "        if (childId !== undefined && dropReservation(rootId, childId)) return",
      replace:
        "        if (rootId === undefined) return\n" +
        SNIP("tools-report-hook.js") +
        "        if (childId !== undefined && dropReservation(rootId, childId)) return",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find: "  ctx.tools.register(withStructuredErrors(defineTool({\n    name: 'redteam_engagement_open',",
      replace: SNIP("tools-attention-tool.js") + "\n  ctx.tools.register(withStructuredErrors(defineTool({\n    name: 'redteam_engagement_open',",
    },

    // ══ H. P7 覆盖度引擎：3 表 + 4 op + 6 工具 ═══════════════════════
    // 列名与 safe 2.0.0 完全一致，老库（曾装过 safe）能直接接上已有数据。
    // 三处必须同时改，缺一处就是「有表没接口」或「有接口没表」：
    //   schema DDL（新库） / schema 迁移（老库） / store + op + tools
    {
      file: "lib/redteam/schema.js",
      required: true,
      find: "CREATE INDEX IF NOT EXISTS ix_agent_report_session ON agent_report(session_id);",
      replace:
        "/* 外部资产深挖覆盖度：按单资产记 surface/web/auth/cve/app 五项是否做完。\n" +
        "   驱动「单个资产挖到底」，避免批量扫完就交。 */\n" +
        "CREATE TABLE IF NOT EXISTS asset_coverage (\n" +
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,\n" +
        "  asset_id INTEGER NOT NULL UNIQUE,\n" +
        "  surface TEXT DEFAULT 'untested',\n" +
        "  web TEXT DEFAULT 'untested',\n" +
        "  auth TEXT DEFAULT 'untested',\n" +
        "  cve TEXT DEFAULT 'untested',\n" +
        "  app TEXT DEFAULT 'untested',\n" +
        "  status TEXT DEFAULT 'open',\n" +
        "  blocked_reason TEXT,\n" +
        "  note TEXT,\n" +
        "  updated_by TEXT,\n" +
        "  updated_at TEXT\n" +
        ");\n" +
        "\n" +
        "/* 主机覆盖度：拿到内网入口后，按资产记 文件/凭据/提权/Web/DB/横向 是否做过。\n" +
        "   这是「下一动作」队列的数据源，避免打一个点就收口。 */\n" +
        "CREATE TABLE IF NOT EXISTS host_coverage (\n" +
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,\n" +
        "  asset_id INTEGER NOT NULL UNIQUE,\n" +
        "  access TEXT DEFAULT 'none',\n" +
        "  files TEXT DEFAULT 'untested',\n" +
        "  credentials INTEGER DEFAULT 0,\n" +
        "  privesc TEXT DEFAULT 'untested',\n" +
        "  web TEXT DEFAULT 'untested',\n" +
        "  db TEXT DEFAULT 'untested',\n" +
        "  lateral TEXT DEFAULT 'untested',\n" +
        "  status TEXT DEFAULT 'open',\n" +
        "  blocked_reason TEXT,\n" +
        "  updated_by TEXT,\n" +
        "  updated_at TEXT\n" +
        ");\n" +
        "\n" +
        "/* 主机侧结构化发现：文件/凭据/提权/横向/Web/DB。用于驱动下一步，不是自由文本。 */\n" +
        "CREATE TABLE IF NOT EXISTS host_finding (\n" +
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,\n" +
        "  asset_id INTEGER NOT NULL,\n" +
        "  kind TEXT NOT NULL,\n" +
        "  title TEXT,\n" +
        "  detail TEXT,\n" +
        "  evidence_ref TEXT,\n" +
        "  created_by TEXT,\n" +
        "  created_at TEXT\n" +
        ");\n" +
        "\n" +
        "CREATE INDEX IF NOT EXISTS ix_host_finding_asset ON host_finding(asset_id, id);\n" +
        "CREATE INDEX IF NOT EXISTS ix_asset_cov_status ON asset_coverage(status);\n" +
        "CREATE INDEX IF NOT EXISTS ix_host_cov_status ON host_coverage(status);\n" +
        "\n" +
        "CREATE INDEX IF NOT EXISTS ix_agent_report_session ON agent_report(session_id);",
    },
    {
      file: "lib/redteam/schema.js",
      required: true,
      find: "  ensure('agent_report', 'acknowledged_at', 'TEXT')",
      replace:
        "  ensure('agent_report', 'acknowledged_at', 'TEXT')\n" +
        "  /* 覆盖度三表：新库由 DDL 建好，老库（先装 community/safe 再换本包）这里补建。\n" +
        "     单独一段 try：建不出来不该拦住整个 migrate —— 覆盖度是增强，不是启动前提。 */\n" +
        "  try {\n" +
        "    db.exec(`CREATE TABLE IF NOT EXISTS asset_coverage (\n" +
        "      id INTEGER PRIMARY KEY AUTOINCREMENT,\n" +
        "      asset_id INTEGER NOT NULL UNIQUE,\n" +
        "      surface TEXT DEFAULT 'untested',\n" +
        "      web TEXT DEFAULT 'untested',\n" +
        "      auth TEXT DEFAULT 'untested',\n" +
        "      cve TEXT DEFAULT 'untested',\n" +
        "      app TEXT DEFAULT 'untested',\n" +
        "      status TEXT DEFAULT 'open',\n" +
        "      blocked_reason TEXT,\n" +
        "      note TEXT,\n" +
        "      updated_by TEXT,\n" +
        "      updated_at TEXT\n" +
        "    )`)\n" +
        "    db.exec(`CREATE TABLE IF NOT EXISTS host_coverage (\n" +
        "      id INTEGER PRIMARY KEY AUTOINCREMENT,\n" +
        "      asset_id INTEGER NOT NULL UNIQUE,\n" +
        "      access TEXT DEFAULT 'none',\n" +
        "      files TEXT DEFAULT 'untested',\n" +
        "      credentials INTEGER DEFAULT 0,\n" +
        "      privesc TEXT DEFAULT 'untested',\n" +
        "      web TEXT DEFAULT 'untested',\n" +
        "      db TEXT DEFAULT 'untested',\n" +
        "      lateral TEXT DEFAULT 'untested',\n" +
        "      status TEXT DEFAULT 'open',\n" +
        "      blocked_reason TEXT,\n" +
        "      updated_by TEXT,\n" +
        "      updated_at TEXT\n" +
        "    )`)\n" +
        "    db.exec(`CREATE TABLE IF NOT EXISTS host_finding (\n" +
        "      id INTEGER PRIMARY KEY AUTOINCREMENT,\n" +
        "      asset_id INTEGER NOT NULL,\n" +
        "      kind TEXT NOT NULL,\n" +
        "      title TEXT,\n" +
        "      detail TEXT,\n" +
        "      evidence_ref TEXT,\n" +
        "      created_by TEXT,\n" +
        "      created_at TEXT\n" +
        "    )`)\n" +
        "    db.exec('CREATE INDEX IF NOT EXISTS ix_host_finding_asset ON host_finding(asset_id, id)')\n" +
        "  } catch { /* 建不出来不影响其它能力 */ }",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "  /* ---------- 路径 ---------- */",
      replace: SNIP("store-coverage.js") + "\n  /* ---------- 路径 ---------- */",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      if (ackOut.error) return Object.assign({ ok: false, engagement: ackId }, ackOut)\n" +
        "      return Object.assign({ ok: true, engagement: ackId }, ackOut, store.attentionQueue(ackId, { limit: req.limit }))\n" +
        "    }",
      replace:
        "      if (ackOut.error) return Object.assign({ ok: false, engagement: ackId }, ackOut)\n" +
        "      return Object.assign({ ok: true, engagement: ackId }, ackOut, store.attentionQueue(ackId, { limit: req.limit }))\n" +
        "    }\n" +
        SNIP("store-coverage-ops.js"),
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find: "  ctx.tools.register(withStructuredErrors(defineTool({\n    name: 'redteam_engagement_open',",
      replace: SNIP("tools-coverage.js") + "\n  ctx.tools.register(withStructuredErrors(defineTool({\n    name: 'redteam_engagement_open',",
    },

    // ══ I. P9 清理清单：1 表 + 4 op + 1 工具 ═════════════════════════
    // 演练结束前要回答「我们留下了什么」。这张表不是发现，是待办：
    // 每条都有 status，收口前必须逐条给结论（done / wontfix + 原因）。
    {
      file: "lib/redteam/schema.js",
      required: true,
      find: "CREATE INDEX IF NOT EXISTS ix_host_finding_asset ON host_finding(asset_id, id);",
      replace:
        "/* 清理清单：我们留下的 webshell / 自建账号 / 上传文件 / 改过的配置 / 隧道。\n" +
        "   不是「发现」，是「待办」—— 每条都要给结论，否则报告里的收尾段是空的。 */\n" +
        "CREATE TABLE IF NOT EXISTS cleanup_item (\n" +
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,\n" +
        "  asset_id INTEGER,\n" +
        "  target TEXT,\n" +
        "  kind TEXT NOT NULL,\n" +
        "  title TEXT,\n" +
        "  detail TEXT,\n" +
        "  evidence_ref TEXT,\n" +
        "  status TEXT DEFAULT 'open',\n" +
        "  priority TEXT DEFAULT 'medium',\n" +
        "  created_by TEXT,\n" +
        "  created_at TEXT,\n" +
        "  updated_by TEXT,\n" +
        "  updated_at TEXT\n" +
        ");\n" +
        "\n" +
        "CREATE INDEX IF NOT EXISTS ix_cleanup_status ON cleanup_item(status, kind);\n" +
        "CREATE INDEX IF NOT EXISTS ix_cleanup_asset ON cleanup_item(asset_id);\n" +
        "\n" +
        "CREATE INDEX IF NOT EXISTS ix_host_finding_asset ON host_finding(asset_id, id);",
    },
    {
      file: "lib/redteam/schema.js",
      required: true,
      find: "    db.exec('CREATE INDEX IF NOT EXISTS ix_host_finding_asset ON host_finding(asset_id, id)')",
      replace:
        "    db.exec(`CREATE TABLE IF NOT EXISTS cleanup_item (\n" +
        "      id INTEGER PRIMARY KEY AUTOINCREMENT,\n" +
        "      asset_id INTEGER,\n" +
        "      target TEXT,\n" +
        "      kind TEXT NOT NULL,\n" +
        "      title TEXT,\n" +
        "      detail TEXT,\n" +
        "      evidence_ref TEXT,\n" +
        "      status TEXT DEFAULT 'open',\n" +
        "      priority TEXT DEFAULT 'medium',\n" +
        "      created_by TEXT,\n" +
        "      created_at TEXT,\n" +
        "      updated_by TEXT,\n" +
        "      updated_at TEXT\n" +
        "    )`)\n" +
        "    db.exec('CREATE INDEX IF NOT EXISTS ix_cleanup_status ON cleanup_item(status, kind)')\n" +
        "    db.exec('CREATE INDEX IF NOT EXISTS ix_host_finding_asset ON host_finding(asset_id, id)')",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "  /* ---------- 路径 ---------- */",
      replace: SNIP("store-cleanup.js") + "\n  /* ---------- 路径 ---------- */",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      if (ackOut.error) return Object.assign({ ok: false, engagement: ackId }, ackOut)\n" +
        "      return Object.assign({ ok: true, engagement: ackId }, ackOut, store.attentionQueue(ackId, { limit: req.limit }))\n" +
        "    }",
      replace:
        "      if (ackOut.error) return Object.assign({ ok: false, engagement: ackId }, ackOut)\n" +
        "      return Object.assign({ ok: true, engagement: ackId }, ackOut, store.attentionQueue(ackId, { limit: req.limit }))\n" +
        "    }\n" +
        SNIP("store-cleanup-ops.js"),
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find: "  ctx.tools.register(withStructuredErrors(defineTool({\n    name: 'redteam_engagement_open',",
      replace: SNIP("tools-cleanup.js") + "\n  ctx.tools.register(withStructuredErrors(defineTool({\n    name: 'redteam_engagement_open',",
    },

    // ══ J. P10 资源保鲜：2 op + 1 工具 ═══════════════════════════════
    // 只做本地探针 + 记录检查时间，**不联网**：真去下载 KEV / 更新 nuclei 模板
    // 是另一件事（要出口、要代理、要确认授权范围），塞进读探针会变成副作用。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "  /* ---------- 路径 ---------- */",
      replace: SNIP("store-intel.js") + "\n  /* ---------- 路径 ---------- */",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      if (ackOut.error) return Object.assign({ ok: false, engagement: ackId }, ackOut)\n" +
        "      return Object.assign({ ok: true, engagement: ackId }, ackOut, store.attentionQueue(ackId, { limit: req.limit }))\n" +
        "    }",
      replace:
        "      if (ackOut.error) return Object.assign({ ok: false, engagement: ackId }, ackOut)\n" +
        "      return Object.assign({ ok: true, engagement: ackId }, ackOut, store.attentionQueue(ackId, { limit: req.limit }))\n" +
        "    }\n" +
        SNIP("store-intel-ops.js"),
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find: "  ctx.tools.register(withStructuredErrors(defineTool({\n    name: 'redteam_engagement_open',",
      replace: SNIP("tools-intel.js") + "\n  ctx.tools.register(withStructuredErrors(defineTool({\n    name: 'redteam_engagement_open',",
    },

    // ══ K. P8 数据证明 + 四段式报告：1 表 + 2 op + 1 工具 + reportV2 ═══
    // 表结构与 safe 2.0.0 一致（列名逐字对齐），老库能直接接上。
    {
      file: "lib/redteam/schema.js",
      required: true,
      find: "\nCREATE TABLE IF NOT EXISTS cleanup_item (",
      replace:
        "/* 敏感数据的结构化证明：字段 / 条数 / 脱敏样本 / 可复现查询。\n" +
        "   自由文本 evidence 没法核对「到底多少条、哪些字段」，验收时只能听我们说；\n" +
        "   这张表让「P1 数据成果」变成别人能自己数一遍的东西。 */\n" +
        "CREATE TABLE IF NOT EXISTS data_proof (\n" +
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,\n" +
        "  asset_id INTEGER, vuln_id INTEGER, target TEXT,\n" +
        "  source TEXT, interface TEXT, fields TEXT,\n" +
        "  row_count INTEGER, sample TEXT, query TEXT,\n" +
        "  evidence_ref TEXT, pii_type TEXT, note TEXT,\n" +
        "  created_by TEXT, created_at TEXT\n" +
        ");\n" +
        "\n" +
        "\nCREATE TABLE IF NOT EXISTS cleanup_item (",
    },
    {
      file: "lib/redteam/schema.js",
      required: true,
      find: "    db.exec('CREATE INDEX IF NOT EXISTS ix_host_finding_asset ON host_finding(asset_id, id)')",
      replace:
        "    db.exec(`CREATE TABLE IF NOT EXISTS data_proof (\n" +
        "      id INTEGER PRIMARY KEY AUTOINCREMENT,\n" +
        "      asset_id INTEGER, vuln_id INTEGER, target TEXT,\n" +
        "      source TEXT, interface TEXT, fields TEXT,\n" +
        "      row_count INTEGER, sample TEXT, query TEXT,\n" +
        "      evidence_ref TEXT, pii_type TEXT, note TEXT,\n" +
        "      created_by TEXT, created_at TEXT\n" +
        "    )`)\n" +
        "    db.exec('CREATE INDEX IF NOT EXISTS ix_host_finding_asset ON host_finding(asset_id, id)')",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "  /* ---------- 路径 ---------- */",
      replace: SNIP("store-report-v2.js") + "\n  /* ---------- 路径 ---------- */",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      if (ackOut.error) return Object.assign({ ok: false, engagement: ackId }, ackOut)\n" +
        "      return Object.assign({ ok: true, engagement: ackId }, ackOut, store.attentionQueue(ackId, { limit: req.limit }))\n" +
        "    }",
      replace:
        "      if (ackOut.error) return Object.assign({ ok: false, engagement: ackId }, ackOut)\n" +
        "      return Object.assign({ ok: true, engagement: ackId }, ackOut, store.attentionQueue(ackId, { limit: req.limit }))\n" +
        "    }\n" +
        SNIP("store-report-v2-ops.js"),
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find: "  ctx.tools.register(withStructuredErrors(defineTool({\n    name: 'redteam_engagement_open',",
      replace: SNIP("tools-data-proof.js") + "\n  ctx.tools.register(withStructuredErrors(defineTool({\n    name: 'redteam_engagement_open',",
    },

    // ══ L. P11 复合工具入口：2 store 方法 + 8 工具 ════════════════════
    // 范围核对与隧道实测放 store（IP 数学与 raw socket 只该有一份实现），
    // 工具层只负责把事实讲成人话。
    {
      // 锚点用 static INTEL_RESOURCES 而不是「路径」标记：verify 会切出
      // 「资源保鲜不许联网」的代码段，插在它上面才不会把隧道实测算进那段里。
      file: "lib/redteam/store-core.js",
      required: true,
      find: "  static INTEL_RESOURCES = [",
      replace: SNIP("store-scope-probe.js") + "\n  static INTEL_RESOURCES = [",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find: "  ctx.tools.register(withStructuredErrors(defineTool({\n    name: 'redteam_engagement_open',",
      replace: SNIP("tools-composite.js") + "\n  ctx.tools.register(withStructuredErrors(defineTool({\n    name: 'redteam_engagement_open',",
    },

    // ══ M. P12 证据账本 op：账本类在 evidence-ledger.mjs，store-core 没有 import ══
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "} from './ip-utils.js'",
      replace:
        "} from './ip-utils.js'\n" +
        "/* [dsh-purge-plus] P12：面板要能读证据账本，op 在 store-core 里派发，\n" +
        "   所以这两个类必须在这里可见（tools.js 早就 import 了它们）。 */\n" +
        "import { EvidenceLedger, UnknownRegistry } from './evidence-ledger.mjs'",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      if (ackOut.error) return Object.assign({ ok: false, engagement: ackId }, ackOut)\n" +
        "      return Object.assign({ ok: true, engagement: ackId }, ackOut, store.attentionQueue(ackId, { limit: req.limit }))\n" +
        "    }",
      replace:
        "      if (ackOut.error) return Object.assign({ ok: false, engagement: ackId }, ackOut)\n" +
        "      return Object.assign({ ok: true, engagement: ackId }, ackOut, store.attentionQueue(ackId, { limit: req.limit }))\n" +
        "    }\n" +
        SNIP("store-evidence-ops.js"),
    },

    // ══ I. T5：补丁 #53 的 web-app-lib 目标永久假漂移 ═════════════════
    // core.js 的 filePatchOutcome() 判定顺序是「marker 不在 → 锚点全灭 →
    // 非自标记 → drifted」。补丁 #53 的 file 是双布局覆盖：0.2.1 起 Web 面
    // 文案已搬进 dsh-harness-dev-context（core.js:2882 的注释自己写着），
    // 于是 web-app/lib/index.js 上锚点必然 0 命中 → 永远报 drifted。
    //
    // 同一模式在 #32 上不出问题，因为 #32 声明了 fileOptional；core.js 里
    // 「outcome === 'drifted' && fileOptional.includes(key) → skipped」这一条
    // 就是为这种「逻辑已搬走」的情形准备的。
    //
    // 只降级 web-app-lib 一个目标：将来宿主若把文案再搬走一次，
    // harness-dev-context（非 optional）会同步漂移，告警信号不丢。
    {
      file: "lib/patches/new-tools.mjs",
      required: true,
      find:
        '    desc: "网页端提示词去掉身份句和禁止另开服务器 / drop web identity and do-not-start",\n' +
        '    file: ["harness-dev-context", "web-app-lib"],\n' +
        "    optional: true,",
      replace:
        '    desc: "网页端提示词去掉身份句和禁止另开服务器 / drop web identity and do-not-start",\n' +
        '    file: ["harness-dev-context", "web-app-lib"],\n' +
        "    // [dsh-purge-plus] T5：0.2.1 起 Web 面文案已搬进 harness-dev-context，\n" +
        "    // web-app-lib 在 rc.5 上只剩服务端胶水，锚点必然 0 命中。不标 optional\n" +
        "    // 会让这个目标永久报「锚点漂移」，训练人忽略漂移指示器。\n" +
        '    fileOptional: ["web-app-lib"],\n' +
        "    optional: true,",
    },

    // ══ I. 状态词条：三种「不适用」必须显示成三句不同的话 ════════════
    // 用户反馈：补丁详情里「本端不适用」既是绿色又是灰色，看不出差别。
    //
    // 根因是**文案丢信息、颜色留信息**：
    //   statusLabel() 把 na / skipped / missing_file 三个状态全映射到 health.na
    //   同一句话，而 statusKind() 给的是两种色（ok / miss）。于是同一句文案出现
    //   两种颜色，颜色成了唯一线索，但没有任何地方解释颜色。
    //
    // 三个状态的真实含义完全不同，必须分开说：
    //   na           补丁自己声明 optional，本机本来就没有这个组件
    //                → 绿「本端不需要」，永远不用管
    //   skipped      补丁声明目标可缺（fileOptional / silentWhenMissing），
    //                或 hooks-deny 那条「本机没被改过」的降级
    //                → 灰「跳过」，没落地但也不是问题
    //   missing_file **必需**补丁的目标文件不在本安装里
    //                → 灰「缺目标文件」，这个补丁在本机实际没生效
    //
    // 顺带修掉一处老碰撞：off 与 skipped 都走 status.skipped（都显示「跳过」）。
    // status.off（已关闭）一直存在于 locale 里但没人用，这里把它接上。
    {
      file: "client.js",
      required: true,
      find: '  if (st === "off") return t("status.skipped");',
      replace: '  if (st === "off") return t("status.off"); // [dsh-purge-plus] 与 skipped 区分',
    },
    {
      file: "client.js",
      required: true,
      find: '  if (st === "skipped") return t("health.na");',
      replace: '  if (st === "skipped") return t("status.skipped"); // [dsh-purge-plus]',
    },
    {
      file: "client.js",
      required: true,
      find: '  if (st === "missing_file") return t("health.na");',
      replace: '  if (st === "missing_file") return t("status.missing_file"); // [dsh-purge-plus]',
    },
    {
      file: "client.js",
      required: true,
      find: '  if (st === "na") return t("health.na");',
      replace: '  if (st === "na") return t("status.na"); // [dsh-purge-plus]',
    },
    // 中文词条：status.missing_file 原来不存在，新增。缺=7F3A 目=76EE 标=6807
    // 文=6587 件=4EF6。
    {
      file: "client.js",
      required: true,
      find: '  "status.na": "\\u672C\\u7AEF\\u4E0D\\u9700\\u8981",\n',
      replace:
        '  "status.na": "\\u672C\\u7AEF\\u4E0D\\u9700\\u8981",\n' +
        '  "status.missing_file": "\\u7F3A\\u76EE\\u6807\\u6587\\u4EF6",\n',
    },
    // 英文词条
    {
      file: "client.js",
      required: true,
      find: '  "status.na": "Not for this host",\n',
      replace:
        '  "status.na": "Not for this host",\n' +
        '  "status.missing_file": "Target missing",\n',
    },

    // ══ J. 补丁明细首列：#35 被挤成竖排三行 ═════════════════════════
    // 截图里「#3 / 5」竖着排，是因为 .dshpp-id 定宽 42px 而页面样式把 td 的
    // 左右内边距加到 15px：内容盒只剩 12px，再加上 td 上的 overflow-wrap:anywhere，
    // 「#35」被允许在任意字符间断行，于是断成三行。
    // 修法：列宽给到 64px 并禁止断行。窄屏那条容器查询也同步放宽，
    // 否则 ≤640px 时会被它压回 44px。
    {
      file: "client.js",
      required: true,
      find: ".dshpp-id {\\n  font-family: var(--dshpp-mono);\\n  opacity: 0.75;\\n  width: 42px;\\n}",
      replace:
        ".dshpp-id {\\n  font-family: var(--dshpp-mono);\\n  opacity: 0.75;\\n  width: 64px;\\n" +
        "  white-space: nowrap;\\n  overflow-wrap: normal;\\n}",
    },
    {
      file: "client.js",
      required: true,
      find: ".dshpp-page .dshpp-table :is(th, td):first-child {\\n    width: 44px;\\n  }",
      replace: ".dshpp-page .dshpp-table :is(th, td):first-child {\\n    width: 60px;\\n  }",
    },

    // ══ K. 「本端不需要」不再和「已生效」同色 ═══════════════════════
    // 上一轮把三种「不适用」拆成了三句话，但 na 仍然是绿胶囊——和 applied 同色。
    // 于是「已生效」与「本机根本没这个组件」在视觉上仍然等价，只能靠读字区分。
    //
    // 语义上这两件事完全不是一类：
    //   applied  → 绿  ：补丁真的写进去了，重启生效
    //   na       → 灰虚线：补丁声明 optional，本机没这个组件，**永远不会生效**
    // 一个「做完了」，一个「无事可做」。同色会让「一片绿」看起来像「全打上了」。
    //
    // 做法：给 na 单独一个 tone（不是复用 miss），这样：
    //   · 灰 = 没落地（na / skipped / missing_file 一致）
    //   · 虚线 = 额外区分「本来就不需要」与「需要但没成」
    // 与已有的 .dshpp-tile.is-na（四格指标里那格）保持同一套视觉语汇。
    {
      file: "client.js",
      required: true,
      find: '  if (st === "na") return "ok";',
      replace: '  if (st === "na") return "na"; // [dsh-purge-plus] 灰虚线：本端不需要 ≠ 已生效',
    },
    // 基础胶囊样式：is-miss 之后补 is-na（灰 + 虚线）
    {
      file: "client.js",
      required: true,
      find: ".dshpp-pill.is-miss {\\n  color: var(--dshpp-mute);\\n}",
      replace:
        ".dshpp-pill.is-miss {\\n  color: var(--dshpp-mute);\\n}\\n" +
        ".dshpp-pill.is-na {\\n  color: var(--dshpp-mute);\\n  border-style: dashed;\\n}",
    },
    // 页面作用域那份：它给 is-ok / is-wait / is-bad 各自定了描边色，
    // 但没定 is-na，会退回 .dshpp-page .dshpp-pill 的实线灰——虚线就丢了。
    {
      file: "client.js",
      required: true,
      find:
        ".dshpp-page .dshpp-pill.is-bad {\\n  color: var(--dshpp-bad);\\n" +
        "  border-color: color-mix(in srgb, var(--dshpp-bad) 40%, transparent);\\n}",
      replace:
        ".dshpp-page .dshpp-pill.is-bad {\\n  color: var(--dshpp-bad);\\n" +
        "  border-color: color-mix(in srgb, var(--dshpp-bad) 40%, transparent);\\n}\\n" +
        ".dshpp-page .dshpp-pill.is-na {\\n  color: var(--dshpp-mute);\\n  border-style: dashed;\\n}",
    },

    // ══ L. 状态胶囊的列位置 + 「跳过」的原因文案 ═════════════════════
    // 用户截图反馈两件事：
    //   ① 状态列太宽，胶囊贴在左边，右边空一大片（表头「状态」也在最左，两者
    //      之间看不出是同一列）。
    //   ② #35 显示灰字「跳过」，但下面那行小字写的是「目标文件不在本安装里」——
    //      而那个文件明明在。
    //
    // ① 的根因：宽屏下 table-layout 是 auto（只有 ≤640px 的容器查询才改成
    //    fixed），于是状态列作为最后一列把**全部剩余宽度**吞掉。760px 容器实测
    //    246px 宽，胶囊 53~88px，右侧空 158px。修法是给最后一列定宽并禁止胶囊换行。
    //    必须放在 `@container (min-width: 641px)` 里：直接写在页面 CSS 末尾会盖掉
    //    ≤640px 那条 88px 的规则（同选择器、同特异性，靠源序决胜）。
    //
    // ② 的根因：hint.skipped 与 hint.missing_file 是**同一句话**，而 skipped 的
    //    成因里根本没有「文件不存在」——它是「文件在，但没有可应用的锚点」：
    //      · silentWhenMissing：补丁自己声明「找不到就是正确状态」
    //      · settleWhenAbsent：撤销型补丁，宿主里本来没加过 = 已经到位
    //      · fileOptional：这段逻辑在新版宿主里已经搬走
    //    #35 属于第三种情况的变体：它的锚点已被同效的 #14（整函数换成 return mode）
    //    吃掉，行为到位了，却因为认不出 #14 的标记而被报成「跳过」。
    {
      file: "client.js",
      required: true,
      find: "letter-spacing: 0.01em;\\n}\\n';",
      replace:
        "letter-spacing: 0.01em;\\n}\\n" +
        "/* [dsh-purge-plus] 宽屏：状态列定宽，不再吞掉剩余宽度 */\\n" +
        "@container purge-page (min-width: 641px) {\\n" +
        "  .dshpp-page .dshpp-table :is(th, td):last-child {\\n" +
        "    width: 120px;\\n" +
        "  }\\n" +
        "  .dshpp-page .dshpp-table .dshpp-pill {\\n" +
        "    white-space: nowrap;\\n" +
        "  }\\n" +
        "}\\n';",
    },
    // 「跳过」不再是「文件不在」的同义词。中文词条。
    {
      file: "client.js",
      required: true,
      find: '  "hint.skipped": "\\u76EE\\u6807\\u6587\\u4EF6\\u4E0D\\u5728\\u672C\\u5B89\\u88C5\\u91CC\\u3002",',
      replace: '  "hint.skipped": "\\u672C\\u673A\\u6CA1\\u6709\\u8FD9\\u6761\\u8865\\u4E01\\u8981\\u5904\\u7406\\u7684\\u5185\\u5BB9\\uFF0C\\u5DF2\\u58F0\\u660E\\u53EF\\u8DF3\\u8FC7\\u3002",',
    },
    {
      file: "client.js",
      required: true,
      find: '  "hint.skipped": "Target file is not part of this install.",',
      replace: '  "hint.skipped": "Nothing for this patch to change on this host; declared skippable.",',
    },
    // #35 与 #14 是同效补丁：#14 把整个 approveEscalation 换成 return mode，
    // #35 要替换的那段 switch 随之消失，于是「锚点没了」被判成 skipped。
    // 行为其实已经到位，不认这条同效标记就会把「已生效」报成「没生效」——
    // 这是**假阴性**，比假阳性更危险：用户会以为保护没上。
    // markers 默认要求全部命中，所以必须同时给 markersAny。
    {
      file: "lib/patches/new-tools.mjs",
      required: true,
      find: '    markers: ["[dsh-purge] escalation never rejected"],',
      replace:
        "    // [dsh-purge-plus] #14 已把整个 approveEscalation 换成 return mode，本条锚点随之消失。\n" +
        "    // 两者效果相同（升级永不拒绝），任一标记命中即算到位。\n" +
        "    markersAny: true,\n" +
        "    markers: [\n" +
        '      "[dsh-purge] escalation never rejected",\n' +
        '      "[dsh-purge] escalation bypass: every escalation request is granted.",\n' +
        "    ],",
    },
    // ══ N. 状态胶囊在行内垂直居中 ═══════════════════════════════════
    // 用户截图：三行高的行（中文名 + 英文标识 + 原因）里，胶囊贴在行的顶端。
    //
    // 根因不是胶囊自己的 margin 或 align-items —— 基础样式 .dshpp-table td 本来
    // 就是 vertical-align: middle，是**页面作用域**那条 (th, td) 规则把它改成了
    // top。行越高，偏得越明显：单行行看不出来，三行行能差出一整个胶囊的高度。
    //
    // 只改最后一列：它是状态列，内容只有胶囊（partial 行再加一行小字）。
    // 首列 #35 保持 top —— 它该和标题首行对齐，居中了反而像浮在行中间。
    // 特异性 (0,3,1) 高于被覆盖的 (0,2,1)，不依赖源序。
    {
      file: "client.js",
      required: true,
      find: "  vertical-align: top;\\n  overflow-wrap: anywhere;\\n}",
      replace:
        "  vertical-align: top;\\n  overflow-wrap: anywhere;\\n}\\n" +
        "/* [dsh-purge-plus] 状态列在行内垂直居中；首列仍 top，与标题首行对齐 */\\n" +
        ".dshpp-page .dshpp-table td:last-child {\\n  vertical-align: middle;\\n}",
    },

    // ══ O. 两处「不适用」计数对不上（85/87·6 vs 85/85·8）═════════════
    // 用户截图：顶部条「85/87 · 6 条本机不适用」，健康度卡片「85/85 全部就位
    // + 本端不适用 8」。同一台机器、同一时刻，两个数不一样。
    //
    // 根因不是算错，是**两套定义**：
    //   顶部条  走服务端 gatherState：na 只算 status==="na"，
    //           分母 = 93 - 6 = 87（skipped 算在分母里）
    //   健康度  走客户端 patchGroupCounts：isNaRow() 把 skipped / missing_file
    //           一起塞进 na 桶，于是 na=8，分母 = 93 - 8 = 85
    //
    // 后果比数字丑更严重：85/85 配上「宿主补丁全部就位」，而实际有 2 条
    // 补丁（#76 #80）什么都没写。**「跳过」被伪装成「不需要」，缺口从界面上消失。**
    //
    // 定一条口径，两边都按它走：
    //   na          本机没有这个组件            → 不进分母，灰虚线，永远 0 工作量
    //   skipped     本机没有这条补丁要改的内容  → **留在分母里**，单独一格，不算失败
    //   missing_file 必需补丁的目标文件不在     → 同上（这一条是真缺口，更不能藏）
    {
      file: "client.js",
      required: true,
      find: 'function isNaRow(row) {\n  return row.st === "na" || row.st === "skipped" || row.st === "missing_file";\n}',
      replace:
        'function isNaRow(row) {\n  return row.st === "na";\n}\n' +
        '/* [dsh-purge-plus] 「跳过」与「本端不适用」是两件事，必须分开计 */\n' +
        'function isSkipRow(row) {\n  return row.st === "skipped" || row.st === "missing_file";\n}',
    },
    {
      file: "client.js",
      required: true,
      find: "  const out = { applied: 0, pending: 0, off: 0, na: 0, total: 0, denom: 0 };",
      replace: "  const out = { applied: 0, pending: 0, off: 0, skipped: 0, na: 0, total: 0, denom: 0 };",
    },
    {
      file: "client.js",
      required: true,
      find: "    else if (row.st === \"applied\" || row.st === \"already\") out.applied += 1;\n    else out.pending += 1;\n  }\n  out.denom = out.total - out.na;",
      replace:
        "    else if (row.st === \"applied\" || row.st === \"already\") out.applied += 1;\n" +
        "    else if (isSkipRow(row)) out.skipped += 1;\n" +
        "    else out.pending += 1;\n" +
        "  }\n" +
        "  out.denom = out.total - out.na;",
    },
    // 分组小计也把 na 单列，否则「跳过 n」里会混进 6 条真正不适用
    {
      file: "client.js",
      required: true,
      // 两处：tallyPatches 的初值 + 概览卡片里 !located 的兜底对象，都要有 na
      count: 2,
      find: "    disabled: 0,\n    skipped: 0,\n    total: 0\n  };",
      replace: "    disabled: 0,\n    skipped: 0,\n    na: 0,\n    total: 0\n  };",
    },
    {
      file: "client.js",
      required: true,
      find: "    else if (row.st === \"disabled\") out.disabled += 1;\n    else out.skipped += 1;",
      replace: "    else if (row.st === \"disabled\") out.disabled += 1;\n    else if (row.st === \"na\") out.na += 1;\n    else out.skipped += 1;",
    },
    // 结论句：有跳过就不能说「全部就位」
    {
      file: "client.js",
      required: true,
      find: '  const verdict = counts.pending ? t("health.verdict.pending", { n: counts.pending }) : t("health.verdict.ok");',
      replace:
        "  const verdict = counts.pending\n" +
        '    ? t("health.verdict.pending", { n: counts.pending })\n' +
        "    : counts.skipped\n" +
        '      ? t("health.verdict.skipped", { n: counts.skipped })\n' +
        '      : t("health.verdict.ok");',
    },
    // 进度条补一段「跳过」
    {
      file: "client.js",
      required: true,
      find: '      h("i", {\n        className: "is-off",\n        style: { width: pct(counts.off) + "%" }\n      })',
      replace:
        '      h("i", {\n        className: "is-off",\n        style: { width: pct(counts.off) + "%" }\n      }),\n' +
        '      h("i", {\n        className: "is-skip",\n        style: { width: pct(counts.skipped) + "%" }\n      })',
    },
    // 第四格之前插一格「跳过」：85 + 0 + 0 + 2 + 6 = 93，能对上总数
    {
      file: "client.js",
      required: true,
      find: '      h(Tile, {\n        kind: "na",\n        label: t("health.na"),\n        value: counts.na,\n        title: t("health.na"),\n        text: t("health.hint.na")\n      })',
      replace:
        '      h(Tile, {\n        kind: "skip",\n        label: t("health.skipped"),\n        value: counts.skipped,\n        title: t("health.skipped"),\n        text: t("health.hint.skipped")\n      }),\n' +
        '      h(Tile, {\n        kind: "na",\n        label: t("health.na"),\n        value: counts.na,\n        title: t("health.na"),\n        text: t("health.hint.na")\n      })',
    },
    // 过滤条：「跳过」要有自己的按钮，否则那 2 条只能靠翻「全部」找
    {
      file: "client.js",
      required: true,
      find: 'var FILTERS = ["all", "pending", "off", "na"];',
      replace: 'var FILTERS = ["all", "pending", "off", "skipped", "na"];',
    },
    {
      file: "client.js",
      required: true,
      find: "  const filterCount = {\n    all: counts.total,\n    pending: counts.pending,\n    off: counts.off,\n    na: counts.na\n  };",
      replace: "  const filterCount = {\n    all: counts.total,\n    pending: counts.pending,\n    off: counts.off,\n    skipped: counts.skipped,\n    na: counts.na\n  };",
    },
    {
      file: "client.js",
      required: true,
      find: '    if (filter === "off") return row.st === "disabled";\n    if (filter === "na") return isNaRow(row);',
      replace:
        '    if (filter === "off") return row.st === "disabled";\n' +
        '    if (filter === "skipped") return isSkipRow(row);\n' +
        '    if (filter === "na") return isNaRow(row);',
    },
    {
      file: "client.js",
      required: true,
      find: '    if (filter === "pending")\n      return !isNaRow(row) && row.st !== "disabled" && row.st !== "applied" && row.st !== "already";',
      replace:
        '    if (filter === "pending")\n' +
        '      return !isNaRow(row) && !isSkipRow(row) && row.st !== "disabled" && row.st !== "applied" && row.st !== "already";',
    },
    // 组头小字：补上「跳过 n」
    {
      file: "client.js",
      required: true,
      find: '      if (tally.disabled)\n        notes.push(t("metric.disabledShort", { n: tally.disabled }));',
      replace:
        '      if (tally.disabled)\n        notes.push(t("metric.disabledShort", { n: tally.disabled }));\n' +
        '      if (tally.skipped)\n        notes.push(t("metric.skipShort", { n: tally.skipped }));',
    },
    // 概览卡片那行原本拿 tally.skipped 冒充「本端不适用」，改成各归各的
    {
      file: "client.js",
      required: true,
      find: '  if (tally.skipped)\n    metricNotes.push(t("metric.naShort", { n: tally.skipped }));',
      replace:
        '  if (tally.na)\n    metricNotes.push(t("metric.naShort", { n: tally.na }));\n' +
        '  if (tally.skipped)\n    metricNotes.push(t("metric.skipShort", { n: tally.skipped }));',
    },
    {
      file: "client.js",
      required: true,
      find: "  const counts = located ? patchGroupCounts(allRows) : { applied: 0, pending: 0, off: 0, na: 0, total: 0, denom: 0 };",
      replace: "  const counts = located ? patchGroupCounts(allRows) : { applied: 0, pending: 0, off: 0, skipped: 0, na: 0, total: 0, denom: 0 };",
    },
    // 顶部条：文案统一成「本端不适用」，并把「跳过」也报出来（85+2+6=93 能对上）
    {
      file: "client.js",
      required: true,
      find: '        info?.patches_na > 0 ? ` \\xB7 ${info.patches_na} \\u6761\\u672C\\u673A\\u4E0D\\u9002\\u7528` : ""',
      replace:
        '        (info?.patches_na > 0 ? ` \\xB7 ${info.patches_na} \\u6761\\u672C\\u7AEF\\u4E0D\\u9002\\u7528` : "") +\n' +
        '          (info?.patches_skipped > 0 ? ` \\xB7 ${info.patches_skipped} \\u6761\\u8DF3\\u8FC7` : "")',
    },
    {
      file: "client.js",
      required: true,
      find: "\\u9700\\u8981\\u91CD\\u65B0\\u5B9A\\u4F4D\\u951A\\u70B9\\u3002`",
      replace: "\\u9700\\u8981\\u91CD\\u65B0\\u5B9A\\u4F4D\\u951A\\u70B9\\u3002\\u8DF3\\u8FC7\\uFF1A\\u672C\\u673A\\u6CA1\\u6709\\u8FD9\\u6761\\u8865\\u4E01\\u8981\\u6539\\u7684\\u5185\\u5BB9\\uFF0C\\u7559\\u5728\\u5206\\u6BCD\\u91CC\\uFF0C\\u4E0D\\u8BA1\\u5931\\u8D25\\u3002`",
    },
    // 中文词条
    {
      file: "client.js",
      required: true,
      find: '  "health.verdict.ok": "\\u5BBF\\u4E3B\\u8865\\u4E01\\u5168\\u90E8\\u5C31\\u4F4D",',
      replace:
        '  "health.verdict.ok": "\\u5BBF\\u4E3B\\u8865\\u4E01\\u5168\\u90E8\\u5C31\\u4F4D",\n' +
        '  "health.skipped": "\\u8DF3\\u8FC7",\n' +
        '  "health.hint.skipped": "\\u672C\\u673A\\u6CA1\\u6709\\u8FD9\\u6761\\u8865\\u4E01\\u8981\\u6539\\u7684\\u5185\\u5BB9\\uFF08\\u5DF2\\u88AB\\u522B\\u7684\\u8865\\u4E01\\u8986\\u76D6 / \\u5BBF\\u4E3B\\u7248\\u672C\\u6CA1\\u6709\\u8FD9\\u6BB5\\u4EE3\\u7801 / \\u58F0\\u660E\\u53EF\\u8DF3\\u8FC7\\uFF09\\u3002\\u7559\\u5728\\u5206\\u6BCD\\u91CC\\uFF0C\\u4F46\\u4E0D\\u8BA1\\u5931\\u8D25\\u3002",\n' +
        '  "health.verdict.skipped": "{n} \\u6761\\u8DF3\\u8FC7\\uFF08\\u672C\\u673A\\u6CA1\\u6709\\u8981\\u6539\\u7684\\u5185\\u5BB9\\uFF09",',
    },
    {
      file: "client.js",
      required: true,
      find: '  "filter.na": "\\u672C\\u7AEF\\u4E0D\\u9002\\u7528",',
      replace: '  "filter.na": "\\u672C\\u7AEF\\u4E0D\\u9002\\u7528",\n  "filter.skipped": "\\u8DF3\\u8FC7",',
    },
    {
      file: "client.js",
      required: true,
      find: '  "health.hint.na": "\\u8FD9\\u53F0\\u5BBF\\u4E3B\\u6CA1\\u6709\\u5BF9\\u5E94\\u7EC4\\u4EF6\\u6216\\u6587\\u4EF6\\uFF0C\\u8FDB\\u4E86\\u4E5F\\u4E0D\\u8FDB\\u5206\\u6BCD\\u3002\\u6C38\\u8FDC 0 \\u5DE5\\u4F5C\\u91CF\\u3002",',
      replace: '  "health.hint.na": "\\u8FD9\\u53F0\\u5BBF\\u4E3B\\u6CA1\\u6709\\u5BF9\\u5E94\\u7EC4\\u4EF6\\uFF0C\\u8FDB\\u4E86\\u4E5F\\u4E0D\\u8FDB\\u5206\\u6BCD\\u3002\\u6C38\\u8FDC 0 \\u5DE5\\u4F5C\\u91CF\\u3002",',
    },
    {
      file: "client.js",
      required: true,
      find: '  "steps.foot": "\\u300C\\u672C\\u7AEF\\u4E0D\\u9002\\u7528\\u300D\\u4E0D\\u8FDB\\u5206\\u6BCD\\uFF0C\\u4E5F\\u4E0D\\u8BA1\\u5165\\u4EFB\\u4F55\\u5931\\u8D25\\u8BA1\\u6570\\u3002",',
      replace: '  "steps.foot": "\\u300C\\u672C\\u7AEF\\u4E0D\\u9002\\u7528\\u300D\\u4E0D\\u8FDB\\u5206\\u6BCD\\uFF1B\\u300C\\u8DF3\\u8FC7\\u300D\\u7559\\u5728\\u5206\\u6BCD\\u91CC\\uFF0C\\u4F46\\u4E24\\u8005\\u90FD\\u4E0D\\u8BA1\\u5165\\u4EFB\\u4F55\\u5931\\u8D25\\u8BA1\\u6570\\u3002",',
    },
    // 英文词条
    {
      file: "client.js",
      required: true,
      find: '  "health.verdict.ok": "All host patches in place",',
      replace:
        '  "health.verdict.ok": "All host patches in place",\n' +
        '  "health.skipped": "Skipped",\n' +
        '  "health.hint.skipped": "Nothing for this patch to change here (already covered by another patch, absent from this host version, or declared skippable). Stays in the denominator; not counted as failure.",\n' +
        '  "health.verdict.skipped": "{n} skipped (nothing to change on this host)",',
    },
    {
      file: "client.js",
      required: true,
      find: '  "filter.na": "Not for this host",',
      replace: '  "filter.na": "Not for this host",\n  "filter.skipped": "Skipped",',
    },
    {
      file: "client.js",
      required: true,
      find: '  "health.hint.na": "This host has no such component or file. Excluded from the denominator; zero work.",',
      replace: '  "health.hint.na": "This host has no such component. Excluded from the denominator; zero work.",',
    },
    {
      file: "client.js",
      required: true,
      find: '  "steps.foot": \'"Not for this host" is excluded from the denominator and from every failure count.\',',
      replace: '  "steps.foot": \'"Not for this host" is excluded from the denominator; "Skipped" stays in it. Neither counts as a failure.\',',
    },
    // 五格：4 列固定宽会把第五格挤到下一行，改成自适应
    {
      file: "client.js",
      required: true,
      find: ".dshpp-tiles {\\n  display: grid;\\n  grid-template-columns: repeat(4, minmax(0, 1fr));\\n  gap: 10px;\\n}",
      replace: ".dshpp-tiles {\\n  display: grid;\\n  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));\\n  gap: 10px;\\n}",
    },
    {
      file: "client.js",
      required: true,
      find: ".dshpp-tile.is-off .dshpp-tile-v,\\n.dshpp-tile.is-na .dshpp-tile-v {\\n  color: var(--dshpp-mute);\\n}",
      replace: ".dshpp-tile.is-off .dshpp-tile-v,\\n.dshpp-tile.is-skip .dshpp-tile-v,\\n.dshpp-tile.is-na .dshpp-tile-v {\\n  color: var(--dshpp-mute);\\n}",
    },
    {
      file: "client.js",
      required: true,
      find: ".dshpp-bar .is-off {\\n  background: var(--dshpp-mute);\\n  opacity: 0.45;\\n}",
      replace: ".dshpp-bar .is-off {\\n  background: var(--dshpp-mute);\\n  opacity: 0.45;\\n}\\n.dshpp-bar .is-skip {\\n  background: var(--dshpp-mute);\\n  opacity: 0.7;\\n}",
    },

    // ══ P. 运行时缺陷审计（AUDIT-BUGS.md）十项 ══════════════════════
    // 全部是「静默失败」：返回成功但结果不对，或错误被吞成正常值。
    // 这类缺陷靠读代码看不出来，靠「有返回就算过」的测试也看不出来。

    // ── H-1 `pocGet` 查不到时摊成 `{ok:true}` ────────────────────────
    // `Object.assign({ok:true}, undefined)` === `{ok:true}`。
    // 同一份代码里 pocUpdate / pocDelete / markPocUsed 查不到都报错，
    // pocGet 是唯一例外——于是「查到了但字段全空」和「压根没这条」无法区分。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "    if (op === 'pocGet') return Object.assign({ ok: true }, store.getPoc(req.id !== undefined ? req.id : req.code))",
      replace:
        "    if (op === 'pocGet') {\n" +
        "      const key = req.id !== undefined ? req.id : req.code\n" +
        "      const hit = store.getPoc(key)\n" +
        "      /* [dsh-purge-plus] 查不到必须报错：摊成 {ok:true} 与「字段全空」同形 */\n" +
        "      if (hit === undefined || hit === null) return { ok: false, error: `poc not found: ${key}` }\n" +
        "      return Object.assign({ ok: true }, hit)\n" +
        "    }",
    },
    // ── M-1 `readAttackFile` 同类假成功 ─────────────────────────────
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "    if (op === 'readAttackFile') return Object.assign({ ok: true }, store.readAttackFile(id, req.id))",
      replace:
        "    if (op === 'readAttackFile') {\n" +
        "      const hit = store.readAttackFile(id, req.id)\n" +
        "      if (hit === undefined || hit === null) return { ok: false, error: `attack file not found: ${req.id}` }\n" +
        "      return Object.assign({ ok: true }, hit)\n" +
        "    }",
    },
    // 读盘失败原本只把消息拼进 content 文本，调用方分不出「文件是空的」和「读不出来」
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    } catch (error) {\n" +
        "      content = '\uff08\u62d2\u7edd\u6216\u8bfb\u53d6\u5931\u8d25\uff1a' + (error && error.message ? error.message : String(error)) + '\uff09'\n" +
        "    }\n" +
        "    return { ...row, content }",
      replace:
        "    } catch (error) {\n" +
        "      content = '\uff08\u62d2\u7edd\u6216\u8bfb\u53d6\u5931\u8d25\uff1a' + (error && error.message ? error.message : String(error)) + '\uff09'\n" +
        "      /* [dsh-purge-plus] 读不出来要给结构化字段，不能只塞进正文让人以为文件本来是空的 */\n" +
        "      return { ...row, content, content_error: String((error && error.message) || error) }\n" +
        "    }\n" +
        "    return { ...row, content }",
    },
    // ── M-4 `deletePoc` 删盘失败静默 ────────────────────────────────
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "    let removedFiles = 0\n    try {\n      const dir = join(this.pocsDirOf(), row.code)",
      replace: "    let removedFiles = 0\n    let removedError = ''\n    try {\n      const dir = join(this.pocsDirOf(), row.code)",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    } catch { /* \u5ffd\u7565 */ }\n" +
        "    return { ok: true, id: row.id, code: row.code, deleted: true, removed_files: removedFiles }",
      replace:
        "      /* [dsh-purge-plus] 删盘失败不能静默：库行已删、目录还在，残留的通常就是 payload */\n" +
        "    } catch (error) { removedError = String((error && error.message) || error) }\n" +
        "    return removedError\n" +
        "      ? { ok: true, id: row.id, code: row.code, deleted: true, removed_files: removedFiles, removed_error: removedError }\n" +
        "      : { ok: true, id: row.id, code: row.code, deleted: true, removed_files: removedFiles }",
    },
    // ── L-1 模板索引把 `.github/` 下的 CI 文件当模板 ────────────────
    // 真 nuclei 模板必有顶层 `id:`。这 21 个条目 severity 全为空串，
    // 智能体「先查本机现成 POC」时会拿到 `.github/workflows/ci.yml` 当命中。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "        if (!/\\.ya?ml$/i.test(e.name)) continue\n" +
        "        let head = ''\n" +
        "        try { head = readFileSync(join(base, next), 'utf8').slice(0, 2000) } catch { continue }",
      replace:
        "        if (!/\\.ya?ml$/i.test(e.name)) continue\n" +
        "        let head = ''\n" +
        "        try { head = readFileSync(join(base, next), 'utf8').slice(0, 2000) } catch { continue }\n" +
        "        /* [dsh-purge-plus] 没有顶层 id 的不是 nuclei 模板（.github/workflows 之类） */\n" +
        "        if (!/^\\s*id:\\s*\\S+/m.test(head)) continue",
    },
    // 索引缓存要作废重算，否则新过滤规则对已有 .nuclei-index.json 不生效
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "        const fresh = cached && cached.dir === dir && Array.isArray(cached.items)\n" +
        "          && (Date.now() - Number(cached.built_at || 0) < 7 * 24 * 3600 * 1000)",
      replace:
        "        const fresh = cached && cached.dir === dir && Array.isArray(cached.items)\n" +
        "          && Number(cached.v || 0) === 2 /* [dsh-purge-plus] 过滤规则变了要重建 */\n" +
        "          && (Date.now() - Number(cached.built_at || 0) < 7 * 24 * 3600 * 1000)",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "      writeFileSync(cachePath, JSON.stringify({ built_at: Date.now(), dir, items }), 'utf8')",
      replace: "      writeFileSync(cachePath, JSON.stringify({ v: 2, built_at: Date.now(), dir, items }), 'utf8')",
    },
    // ── L-2 `consoleDigest` 把 SQL 异常吞成 0 ───────────────────────
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    const count = (sql) => {\n" +
        "      try { return Number(db.prepare(sql).get()?.n ?? 0) || 0 } catch { return 0 }\n" +
        "    }\n" +
        "    const at = (sql) => {\n" +
        "      try { return db.prepare(sql).get()?.t ?? null } catch { return null }\n" +
        "    }",
      replace:
        "    /* [dsh-purge-plus] SQL 失败不能静默归零：schema 漂移时「每页签 0 条」与\n" +
        "       「确实没有新内容」完全同形，红点永不亮且没有任何提示。 */\n" +
        "    const digestErrors = []\n" +
        "    const noteError = (sql, error) => {\n" +
        "      const message = String((error && error.message) || error || 'unknown error')\n" +
        "      if (!digestErrors.some((e) => e.message === message)) {\n" +
        "        digestErrors.push({ message, sql: String(sql).slice(0, 120) })\n" +
        "      }\n" +
        "    }\n" +
        "    const count = (sql) => {\n" +
        "      try { return Number(db.prepare(sql).get()?.n ?? 0) || 0 } catch (error) { noteError(sql, error); return 0 }\n" +
        "    }\n" +
        "    const at = (sql) => {\n" +
        "      try { return db.prepare(sql).get()?.t ?? null } catch (error) { noteError(sql, error); return null }\n" +
        "    }",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "    return { engagement: id, at: nowIso(), sections }",
      replace: "    return { engagement: id, at: nowIso(), sections, errors: digestErrors }",
    },
    // ── M-2 无靶标时 31 个只读 op 塌成同一个空壳 ────────────────────
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "      return { ok: true, items: [], total: 0, stats: null, segments: [], stages: [], roles: [] }",
      replace:
        "      /* [dsh-purge-plus] 不再给一份通用空壳冒充 31 个形状各异的 op 的契约。\n" +
        "         ok:false 才让「没选靶标」与「选了靶标但真的没数据」可区分；\n" +
        "         保留 items/total 是为了旧调用方读数组时不炸。 */\n" +
        "      return { ok: false, no_target: true, error: '\u8bf7\u5148\u5728\u9876\u90e8\u9009\u62e9\u6216\u521b\u5efa\u4e00\u4e2a\u9776\u6807', items: [], total: 0 }",
    },
    // ── L-4 `null` body 把 V8 异常文本当 400 返回 ───────────────────
    {
      file: "lib/redteam/ui.js",
      required: true,
      find: "        const request = raw.trim() ? JSON.parse(raw) : {}",
      replace:
        "        /* [dsh-purge-plus] `null` 会被 JSON.parse 成 null，随后 request.op 抛\n" +
        "           TypeError 并把 V8 原文吐给调用方；非对象一律当空请求。 */\n" +
        "        const parsed = raw.trim() ? JSON.parse(raw) : {}\n" +
        "        const request = parsed && typeof parsed === 'object' ? parsed : {}",
    },
    // ── M-3 符号链接形态的技能被静默跳过 ───────────────────────────
    // Dirent 的 isDirectory()/isFile() 对软链都返回 false，
    // `ln -s ~/dev/my-skill ~/.dsh/skills/my-skill` 这种常见装法直接掉出去。
    {
      file: "lib/skills.js",
      required: true,
      find: '    if (entry.isDirectory()) {\n      const fp = path.join(dir, entry.name, "SKILL.md");',
      replace:
        "    /* [dsh-purge-plus] 软链的 Dirent 既非 isDirectory 也非 isFile，会被静默跳过。\n" +
        "       按目标真实类型判；死链 stat 失败就当它不存在（那是数据问题，不是判定问题）。 */\n" +
        "    let entryIsDir = entry.isDirectory();\n" +
        "    let entryIsFile = entry.isFile();\n" +
        "    if (!entryIsDir && !entryIsFile && entry.isSymbolicLink()) {\n" +
        "      try {\n" +
        "        const st = await fsp.stat(path.join(dir, entry.name));\n" +
        "        entryIsDir = st.isDirectory();\n" +
        "        entryIsFile = st.isFile();\n" +
        "      } catch { /* 死链 */ }\n" +
        "    }\n" +
        '    if (entryIsDir) {\n      const fp = path.join(dir, entry.name, "SKILL.md");',
    },
    {
      file: "lib/skills.js",
      required: true,
      find: '    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "SKILL.md") continue;',
      replace: '    if (!entryIsFile || !entry.name.endsWith(".md") || entry.name === "SKILL.md") continue;',
    },
    {
      file: "lib/skills.js",
      required: true,
      find: '    if (!entry.isDirectory() || entry.name === ".system") continue;',
      replace:
        "    /* [dsh-purge-plus] 同 listSkills：软链不算目录，按目标判 */\n" +
        "    let entryIsDir = entry.isDirectory();\n" +
        "    if (!entryIsDir && entry.isSymbolicLink()) {\n" +
        "      try { entryIsDir = (await fsp.stat(path.join(dir, entry.name))).isDirectory(); } catch { entryIsDir = false; }\n" +
        "    }\n" +
        '    if (!entryIsDir || entry.name === ".system") continue;',
    },
    {
      file: "lib/redteam/skill-availability.js",
      required: true,
      find: "import { existsSync, readFileSync, readdirSync } from 'node:fs'",
      replace: "import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'",
    },
    {
      file: "lib/redteam/skill-availability.js",
      required: true,
      find:
        "    if (entry.isDirectory()) {\n" +
        "      filePath = join(dir, entry.name, 'SKILL.md')\n" +
        "      name = entry.name\n" +
        "    } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'SKILL.md') {\n" +
        "      filePath = join(dir, entry.name)\n" +
        "      name = entry.name.slice(0, -3)\n" +
        "    } else {\n" +
        "      continue\n" +
        "    }",
      replace:
        "    /* [dsh-purge-plus] 软链的 Dirent 两个判定都是 false，会掉进 else 被 continue。\n" +
        "       按目标真实类型判；死链 stat 失败按不存在处理。 */\n" +
        "    let isDir = entry.isDirectory()\n" +
        "    let isFile = entry.isFile()\n" +
        "    if (!isDir && !isFile && entry.isSymbolicLink()) {\n" +
        "      try {\n" +
        "        const st = statSync(join(dir, entry.name))\n" +
        "        isDir = st.isDirectory()\n" +
        "        isFile = st.isFile()\n" +
        "      } catch { /* 死链 */ }\n" +
        "    }\n" +
        "    if (isDir) {\n" +
        "      filePath = join(dir, entry.name, 'SKILL.md')\n" +
        "      name = entry.name\n" +
        "    } else if (isFile && entry.name.endsWith('.md') && entry.name !== 'SKILL.md') {\n" +
        "      filePath = join(dir, entry.name)\n" +
        "      name = entry.name.slice(0, -3)\n" +
        "    } else {\n" +
        "      continue\n" +
        "    }",
    },
    // ── L-5 selfcheck 顶层 ok:false 却没有任何可执行项 ──────────────
    // 「权限选择 = inferred（宿主推导为完全访问，但没显式固定）」被算成失败，
    // 于是自检红着、needsApply 却是 false——用户找不到任何可以点的东西。
    // 推断态不是失败，但也不能当没发生：单独放进 warnings。
    {
      file: "lib/selfcheck.js",
      required: true,
      find: "  const failed = layers.filter((layer) => !layer.ok);",
      replace:
        "  /* [dsh-purge-plus] inferred（宿主推导值，未显式固定）不是失败：\n" +
        "     它没有可执行的修复动作，算进 ok 会让自检永远红着而无可点项。 */\n" +
        "  const inferredLayers = layers.filter((layer) => layer.state === \"inferred\");\n" +
        "  const failed = layers.filter((layer) => !layer.ok && layer.state !== \"inferred\");",
    },
    // 推断态不是失败，但也要能看见：单独放进 warnings（hints 只放可执行的修复）
    {
      file: "lib/selfcheck.js",
      required: true,
      find: "    hints: failed.map((layer) => ({",
      replace:
        "    warnings: inferredLayers.map((layer) => ({ title: layer.title, note: layer.note || layer.why || \"\" })),\n" +
        "    hints: failed.map((layer) => ({",
    },
    // ── consoleDigest 缺三段：三个页签的红点永远不会亮 ─────────────
    // safe 的 sections 有 15 个键，我们只有 12 个。「凭据与文件」「态势首页」
    // 「环境适配」三个页签读的是 artifacts / overview / env，
    // 拿不到就当 0 → 新内容进来也不亮红点（静默失效的又一例）。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      attackfiles: {\n" +
        "        count: count('SELECT COUNT(*) AS n FROM attack_file'),\n" +
        "        at: at('SELECT MAX(created_at) AS t FROM attack_file'),\n" +
        "      },",
      replace:
        "      attackfiles: {\n" +
        "        count: count('SELECT COUNT(*) AS n FROM attack_file'),\n" +
        "        at: at('SELECT MAX(created_at) AS t FROM attack_file'),\n" +
        "      },\n" +
        "      /* [dsh-purge-plus] 下面三段 safe 有、我们漏了：缺了它们，\n" +
        "         「凭据与文件」「态势首页」「环境适配」三个页签的红点永不亮。 */\n" +
        "      artifacts: {\n" +
        "        count: count('SELECT COUNT(*) AS n FROM attack_file')\n" +
        "          + count('SELECT COUNT(*) AS n FROM credential')\n" +
        "          + count('SELECT COUNT(*) AS n FROM access_session'),\n" +
        "        at: maxOf(\n" +
        "          at('SELECT MAX(created_at) AS t FROM attack_file'),\n" +
        "          maxOf(\n" +
        "            at('SELECT MAX(found_at) AS t FROM credential'),\n" +
        "            at('SELECT MAX(obtained_at) AS t FROM access_session'),\n" +
        "          ),\n" +
        "        ),\n" +
        "      },\n" +
        "      overview: { count: count(hits), at: at(hitsAt) },\n" +
        "      env: { count: 0, at: null },",
    },
    // ══ Q. 社区版审计（AUDIT-COMMUNITY.md）四项 ══════════════════════

    // ── B1（高）`updateCleanup` 把没传的字段静默写成 NULL ────────────
    // 分发处无条件塞 6 个键（`status: req.status` 等），store 侧用
    // `hasOwnProperty` 判「这个字段要改」——于是 undefined 也命中，
    // 落库变成 NULL。只改 detail 时还会因为 status:undefined 校验失败而报错。
    // 后果：target 清空 → addCleanup 的去重键失效 → 重复项；报告收尾段丢字段。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "        if (op === 'updateCleanup') {\n" +
        "          if (req.id === undefined || req.id === null) return { ok: false, error: 'updateCleanup 需要 id' }\n" +
        "          return Object.assign({ ok: true, engagement: cid }, store.updateCleanup(cid, req.id, {\n" +
        "            status: req.status, detail: req.detail, evidence_ref: req.evidence_ref,\n" +
        "            priority: req.priority, target: req.target, title: req.title, location: req.location,\n" +
        "          }, req.actor))\n" +
        "        }",
      replace:
        "        if (op === 'updateCleanup') {\n" +
        "          if (req.id === undefined || req.id === null) return { ok: false, error: 'updateCleanup 需要 id' }\n" +
        "          /* [dsh-purge-plus] 只传调用方**真的给过**的字段。store 用 hasOwnProperty\n" +
        "             判「要不要改」，无条件塞 undefined 会把 target/title/detail/priority\n" +
        "             静默写成 NULL（target 一空，addCleanup 的去重键就失效了）。 */\n" +
        "          const patch = {}\n" +
        "          for (const f of ['status', 'detail', 'evidence_ref', 'priority', 'target', 'title', 'location']) {\n" +
        "            if (req[f] !== undefined) patch[f] = req[f]\n" +
        "          }\n" +
        "          return Object.assign({ ok: true, engagement: cid }, store.updateCleanup(cid, req.id, patch, req.actor))\n" +
        "        }",
    },
    // ── B2（中）离线时版本历史被过滤光，回滚目标消失 ────────────────
    // `fork.rows` 拿不到（断网/限流）就是空数组，于是「不在 fork 列表里就丢」
    // 把本机装过的历史版本全删了——而那正是唯一还能回滚的目标。
    {
      file: "lib/update.js",
      required: true,
      find:
        "  const forkRefs = new Set(fork.rows.map((row) => row.ref));\n" +
        "  for (const item of readHistory()) {\n" +
        "    if (!item || !item.ref || withdrawnVersion(item)) continue;\n" +
        "    if (!forkRefs.has(item.ref)) continue;",
      replace:
        "  const forkRefs = new Set(fork.rows.map((row) => row.ref));\n" +
        "  /* [dsh-purge-plus] 只有在**真拿到了**发行列表时才按它过滤。\n" +
        "     断网/限流时 fork.rows 为空，照过滤会把本机装过的历史版本全删光，\n" +
        "     而那正是唯一还能回滚的目标。 */\n" +
        "  const forkKnown = fork.rows.length > 0;\n" +
        "  for (const item of readHistory()) {\n" +
        "    if (!item || !item.ref || withdrawnVersion(item)) continue;\n" +
        "    if (forkKnown && !forkRefs.has(item.ref)) continue;",
    },
    // ── B4（低）`stage_code` 回填只在建列那一次跑 ───────────────────
    // 回填被包在 `if (ensure(...))` 里：列已存在就整段跳过，于是社区版升上来的
    // 老库（列在、值全 NULL）永远不回填。改成：ensure 只管建列，回填单独跑，
    // 并且只补空值（不覆盖智能体手写的 stage_code）。
    {
      file: "lib/redteam/schema.js",
      required: true,
      find:
        "  if (ensure('attack_step', 'stage_code', 'TEXT')) {\n" +
        "    try {\n" +
        "      const stmt = db.prepare('UPDATE attack_step SET stage_code = ? WHERE stage = ?')\n" +
        "      for (const [legacy, code] of Object.entries(LEGACY_STAGE_MAP)) stmt.run(code, legacy)\n" +
        "    } catch { /* 忽略 */ }\n" +
        "  }",
      replace:
        "  ensure('attack_step', 'stage_code', 'TEXT');\n" +
        "  /* [dsh-purge-plus] 回填不能只在建列那次跑：老库列已在、值全 NULL，\n" +
        "     ensure 返回 false 就整段跳过 → stage_code 永远补不上。\n" +
        "     只补空值，不覆盖智能体手写过的值。 */\n" +
        "  try {\n" +
        "    const stmt = db.prepare(\"UPDATE attack_step SET stage_code = ? WHERE stage = ? AND (stage_code IS NULL OR stage_code = '')\")\n" +
        "    for (const [legacy, code] of Object.entries(LEGACY_STAGE_MAP)) stmt.run(code, legacy)\n" +
        "  } catch { /* 忽略 */ }",
    },

    // ══ R. 补丁明细里「代码」组永远是展开的 ══════════════════════════
    // 用户问：为什么一点进插件，「代码」那一块就是展开状态？
    //
    // 因为初始状态是**硬编码**的：useState({ code: true })。
    // 作者按自己的偏好指定了一组默认展开，其余全收。
    //
    // 而本机 93 条的真实分布是：
    //   代码   54 条，54/54 全绿      ← 唯一默认展开的，恰好是最不需要看的一组
    //   提示词 27 条，24 applied + 1 skipped(#76) + 2 na
    //   工具    9 条， 4 applied + 1 skipped(#80) + 4 na
    //   兼容    3 条，全绿
    // 也就是**默认视图正好展示最不需要看的那一组**，而真正没落地的两条
    // （#76 #80）藏在收起的组里。
    //
    // 改成由数据决定：组内只要有一条没落地就展开，全绿则收起。
    //   disabled 不算（用户主动关的），na 不算（本机没有这个组件）。
    // open 为 null 表示「还没手动点过」，跟随这个默认；点过之后按用户的选择走，
    // 并且第一次点击时把当时的默认状态整体复制下来，避免「点一个组、别的组全收」。
    {
      file: "client.js",
      required: true,
      find:
        '/* [dsh-purge-plus] 「跳过」与「本端不适用」是两件事，必须分开计 */\n' +
        'function isSkipRow(row) {\n  return row.st === "skipped" || row.st === "missing_file";\n}',
      replace:
        '/* [dsh-purge-plus] 「跳过」与「本端不适用」是两件事，必须分开计 */\n' +
        'function isSkipRow(row) {\n  return row.st === "skipped" || row.st === "missing_file";\n}\n' +
        '/* [dsh-purge-plus] 这一行「需要人看一眼」吗？决定所属分组默认展开与否。\n' +
        '   disabled 不算（用户主动关的），na 不算（本机没有这个组件）。 */\n' +
        'function needsAttentionRow(row) {\n' +
        '  return row.st === "pending" || row.st === "unmatched" || row.st === "drifted" ||\n' +
        '    row.st === "partial" || isSkipRow(row);\n' +
        '}',
    },
    {
      file: "client.js",
      required: true,
      find: "  const [open, setOpen] = useState({ code: true });",
      replace:
        "  /* [dsh-purge-plus] 不再硬编码「代码组默认展开」；null = 还没手动点过，\n" +
        "     此时跟随数据默认（有未写入项的组才展开）。 */\n" +
        "  const [open, setOpen] = useState(null);",
    },
    {
      file: "client.js",
      required: true,
      find:
        '  const grouped = /* @__PURE__ */ new Map();\n' +
        '  for (const row of kept) {\n' +
        '    const key = LAYER_GROUP[row.layer] || "code";\n' +
        '    if (!grouped.has(key)) grouped.set(key, []);\n' +
        '    grouped.get(key).push(row);\n' +
        '  }',
      replace:
        '  const grouped = /* @__PURE__ */ new Map();\n' +
        '  for (const row of kept) {\n' +
        '    const key = LAYER_GROUP[row.layer] || "code";\n' +
        '    if (!grouped.has(key)) grouped.set(key, []);\n' +
        '    grouped.get(key).push(row);\n' +
        '  }\n' +
        '  /* [dsh-purge-plus] 默认展开哪一组由数据决定，不由作者偏好决定：\n' +
        '     组内只要有一条没落地就展开，全部已应用（或本机不需要）就收起。 */\n' +
        '  const autoOpen = {};\n' +
        '  for (const [key, rows] of grouped) {\n' +
        '    if (rows.some((row) => needsAttentionRow(row))) autoOpen[key] = true;\n' +
        '  }\n' +
        '  const effectiveOpen = open || autoOpen;',
    },
    {
      file: "client.js",
      required: true,
      find: "      const expanded = !!open[key];",
      replace: "      const expanded = !!effectiveOpen[key];",
    },
    {
      file: "client.js",
      required: true,
      find: "            onClick: () => setOpen((prev) => Object.assign({}, prev, { [key]: !prev[key] }))",
      replace:
        "            onClick: () => setOpen((prev) => {\n" +
        "              /* 第一次点击：把当时的默认展开状态整体复制下来再翻转，\n" +
        "                 否则点一个组会把其余自动展开的组一起收掉。 */\n" +
        "              const base = prev || autoOpen;\n" +
        "              return Object.assign({}, base, { [key]: !base[key] });\n" +
        "            })",
    },

    // ══ M. P20/P21：字段级对齐 + 会话关系图 + 情报刷新 ═══════════════
    // 这一段的每一项都是「上游有、我们缺」的具体字段或能力，逐条都有对照。

    // M1. 新代码要用的 fs / path / child_process 成员
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "import {\n" +
        "  mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync, statSync,\n" +
        "  copyFileSync,\n" +
        "} from 'node:fs'\n" +
        "import { join, basename, isAbsolute, resolve, win32 } from 'node:path'",
      replace:
        "import {\n" +
        "  mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync, statSync,\n" +
        "  copyFileSync, appendFileSync, renameSync, cpSync,\n" +
        "} from 'node:fs'\n" +
        "import { execFileSync } from 'node:child_process'\n" +
        "import { join, basename, isAbsolute, resolve, win32, dirname } from 'node:path'",
    },

    // M2. scoreReport 支持 layout='simple'（safe 有、我们没有）：
    //     调用方拿得到结构化 report + 同一份 markdown，而不是只有 markdown。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "    return { items: items2, stages, summary, markdown: md.join('\\n'), target: targetName }",
      replace:
        "    /* [dsh-purge-plus] layout='simple'：交付报告直接给四段式（reportV2），\n" +
        "       与 reportV2 op 是**同一实现**，分值一个都不重算 —— 两套算法并存必然\n" +
        "       出现「报告 350、面板 320」这种无法解释的差。\n" +
        "       递归保护：reportV2 内部会回调 scoreReport，这里显式降级成 legacy。 */\n" +
        "    if (String(options.layout || '') === 'simple') {\n" +
        "      const built = this.reportV2(id, Object.assign({}, options, { layout: 'legacy' }))\n" +
        "      const report = Object.assign({}, built)\n" +
        "      delete report.markdown\n" +
        "      return {\n" +
        "        items: items2, stages, summary, report: report,\n" +
        "        markdown: built.markdown || '', target: targetName, layout: 'simple',\n" +
        "      }\n" +
        "    }\n" +
        "    return { items: items2, stages, summary, markdown: md.join('\\n'), target: targetName, layout: 'legacy' }",
    },

    // M3. bootstrap 的 engagements 带 stats（safe 带、我们传了 includeStats:false）
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      const engagements = store.listEngagements({ includeStats: false })\n" +
        "      /* 优先沿用「当前靶标」指针，其次才是最近创建的靶标 */",
      replace:
        "      /* [dsh-purge-plus] includeStats:true —— 面板一进来就要显示每个靶标的资产/漏洞/得分，\n" +
        "         不带 stats 等于让调用方再发 N 个请求（N = 靶标数）。stats 内部有 try/catch，\n" +
        "         单个靶标的库坏掉只会在那一条上留 stats_error，不影响整份清单。 */\n" +
        "      const engagements = store.listEngagements({ includeStats: true })\n" +
        "      /* 优先沿用「当前靶标」指针，其次才是最近创建的靶标 */",
    },

    // M4. 会话关系图：store 方法
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "  /* ---------- 路径 ---------- */",
      replace: SNIP("store-session-graph.js") + "\n  /* ---------- 路径 ---------- */",
    },

    // M5. 会话关系图：op（与 sessionBindings 同段，全局）
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      const written = store.setSessionBinding(sid, req.engagement, req.name)\n" +
        "      return { ok: written, session: sid, bound: written ? req.engagement : null }\n" +
        "    }",
      replace:
        "      const written = store.setSessionBinding(sid, req.engagement, req.name)\n" +
        "      return { ok: written, session: sid, bound: written ? req.engagement : null }\n" +
        "    }\n" +
        SNIP("store-session-graph-ops.js"),
    },

    // M6. 情报刷新：走异步分发（真网络请求，sync 路径里做不了）
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "  return dispatch(store, req)\n}",
      replace:
        "  /* [dsh-purge-plus] 情报刷新：真发网络请求、真落盘。\n" +
        "     与 intelStatus 分开的理由：只读探针一旦联网，「看一眼状态」就变成了出口动作。 */\n" +
        "  if (req.op === 'intelUpdate') {\n" +
        "    try {\n" +
        "      const out = await store.intelUpdate(req.target || 'all', {\n" +
        "        dry_run: req.dry_run === true, dest: typeof req.dest === 'string' && req.dest ? req.dest : undefined,\n" +
        "      })\n" +
        "      return Object.assign({ ok: true }, out)\n" +
        "    } catch (e) {\n" +
        "      return { ok: false, error: String((e && e.message) || e) }\n" +
        "    }\n" +
        "  }\n" +
        "  return dispatch(store, req)\n}",
    },

    // M7. cleanup_item 补 location 列（safe 有、我们没有）：DDL 两处 + 老库迁移 + 写入
    //     注意 find 匹配的是**生成后**的 schema.js 正文（真换行），不是 edits.mjs 里的字符串拼接。
    {
      file: "lib/redteam/schema.js",
      required: true,
      find: `CREATE TABLE IF NOT EXISTS cleanup_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER,
  target TEXT,`,
      replace: `CREATE TABLE IF NOT EXISTS cleanup_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER,
  target TEXT,
  location TEXT,`,
    },
    {
      file: "lib/redteam/schema.js",
      required: true,
      find: `CREATE TABLE IF NOT EXISTS cleanup_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER,
      target TEXT,`,
      replace: `CREATE TABLE IF NOT EXISTS cleanup_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER,
      target TEXT,
      location TEXT,`,
    },
    {
      file: "lib/redteam/schema.js",
      required: true,
      find: `    db.exec('CREATE INDEX IF NOT EXISTS ix_cleanup_status ON cleanup_item(status, kind)')`,
      replace: `    db.exec('CREATE INDEX IF NOT EXISTS ix_cleanup_status ON cleanup_item(status, kind)')
    /* [dsh-purge-plus] 老库补 location：safe 的清理项带「具体位置」（文件路径 / 账号 / 隧道端口），
       只有 target（主机）说不清要删哪一样东西。ensure 自带「有这列就跳过」。 */
    ensure('cleanup_item', 'location', 'TEXT')`,
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    db.prepare('INSERT INTO cleanup_item(asset_id, target, kind, title, detail, evidence_ref, status, priority, created_by, created_at) ' +\n" +
        "      'VALUES(?,?,?,?,?,?,?,?,?,?)').run(\n" +
        "      item.asset_id === undefined || item.asset_id === null ? null : Number(item.asset_id),\n" +
        "      target === '' ? null : target, kind, title,",
      replace:
        "    db.prepare('INSERT INTO cleanup_item(asset_id, target, location, kind, title, detail, evidence_ref, status, priority, created_by, created_at) ' +\n" +
        "      'VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(\n" +
        "      item.asset_id === undefined || item.asset_id === null ? null : Number(item.asset_id),\n" +
        "      target === '' ? null : target, location === '' ? null : location, kind, title,",
    },

    // M8. 情报刷新的 store 方法
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "  /** 重新探一遍并记录检查时间。不下载、不联网、不改任何资源文件。 */",
      replace: SNIP("store-intel-net.js") + "\n  /** 重新探一遍并记录检查时间。不下载、不联网、不改任何资源文件。 */",
    },

    // ══ P23. 删除靶标（Q5）═══════════════════════════════════════
    // 之前**没有任何删除入口**：建错一个靶标只能手动 rm 目录，而目录里躺着
    // 它自己的 knowledge.db。这里补 op + store 方法，口径是「只移不删」。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "  /* ---------- 当前靶标 ---------- */",
      replace: SNIP("store-engagement-delete.js") + "  /* ---------- 当前靶标 ---------- */",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      return { ok: activated, current: store.activeEngagementId() }\n" +
        "    }",
      replace:
        "      return { ok: activated, current: store.activeEngagementId() }\n" +
        "    }\n" +
        SNIP("store-engagement-delete-op.js"),
    },

    // ══ P23. 资源保鲜徽章点名缺哪一项（Q7）════════════════════════
    // 「缺 1 项资源」在用户刚点完「更新 KEV / 模板」之后尤其误导：缺的其实是
    // 第三项（字典库），跟 KEV 无关。徽章必须说出名字。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      /* 一句话结论，界面徽章直接用，不再让每个调用方自己拼 */\n" +
        "      badge: missingCount > 0\n" +
        "        ? '缺 ' + missingCount + ' 项资源'\n" +
        "        : staleCount > 0 ? staleCount + ' 项资源过期' : '资源新鲜',",
      replace:
        "      /* 一句话结论，界面徽章直接用，不再让每个调用方自己拼。\n" +
        "         缺失必须点名：只说「缺 1 项」时，用户刚点完「更新 KEV / 模板」会以为\n" +
        "         更新没生效，实际缺的是第三项（字典库），和 KEV 一点关系都没有。 */\n" +
        "      missing_labels: out.filter((r) => r.missing).map((r) => r.label),\n" +
        "      badge: missingCount > 0\n" +
        "        ? '缺 ' + missingCount + ' 项资源（' + out.filter((r) => r.missing).map((r) => r.label).join('、') + '）'\n" +
        "        : staleCount > 0 ? staleCount + ' 项资源过期' : '资源新鲜',",
    },

    // ══ P23. 兼容清单补 0.2.2-rc.5 ═══════════════════════════════
    // 上一轮补的是 0.2.1-rc.5（当时宿主是 rc.5 那一代），宿主升到 0.2.2-rc.5 后
    // 面板又常年挂黄点。依据不是「版本号看着新」：rc.5 上逐条跑过 patch_status，
    // 93 条 = 85 applied + 2 skipped（#76 预设形态不符 / #80 官方预设自带，均已知）
    // + 6 na（本机没装 hooks 插件）。这就是回归证据，够格进清单。
    {
      file: "lib/community.js",
      required: true,
      find: 'export const QUALIFIED_HOST_VERSIONS = Object.freeze(["0.2.2-rc.3",',
      replace: 'export const QUALIFIED_HOST_VERSIONS = Object.freeze(["0.2.2-rc.5", "0.2.2-rc.3",',
    },
    // ══ P24. 版本换轨后技能页整页空白 ════════════════════════════
    // 上游把「技能页是否可见」写成了 1.x 语义的版本比较：
    //   主版本 ≠ 1 → 只返回「是否 > 1」；次版本 ≠ 1 → 同理；最后才比补丁号 ≥ 12。
    // 本仓库版本从 1.7.20-plus.N 换成 0.1.N 后，0.1.39 走「0 > 1」= false，
    // SkillsSection 直接 `if (!onBeta) return null` —— 整个页签渲染成 null，
    // 连「暂无用户 Skill」都不显示，用户看到的就是一块空白。
    // 技能接口是否存在本来就由 skillsRouteMissing 在调用时判（err.skills.needRestart），
    // 这层版本门槛在本仓库没有存在意义：只看「状态载荷拿到了没有」。
    {
      file: "client.js",
      required: true,
      find:
        '  const ver = String(d.plugin_version || d.localVersion || "").replace(\n' +
        "    /^v/i,\n" +
        '    ""\n' +
        "  );\n" +
        "  if (/^1\\.1\\.11(?:-|$)/.test(ver)) return false;\n" +
        "  const parts = ver.match(/^(\\d+)\\.(\\d+)\\.(\\d+)/);\n" +
        "  if (!parts) return false;\n" +
        "  if (+parts[1] !== 1) return +parts[1] > 1;\n" +
        "  if (+parts[2] !== 1) return +parts[2] > 1;\n" +
        "  return +parts[3] >= 12;",
      replace:
        "  /* [dsh-purge-plus] 原判定按上游 1.x 语义写死（主版本≠1 时只比是否 >1）。\n" +
        "     本仓库换成 0.1.N 方案后 0.1.x 一律被判成「低于 1.1.12」，\n" +
        "     技能页 return null → 整页空白。接口可用性由 skillsRouteMissing 判，\n" +
        "     这里只确认状态载荷拿到了。 */\n" +
        '  return typeof d === "object" && d !== null && (d.ok === undefined || d.ok === true);',
    },
    // 空态要能说出「为什么是空的」：listSkills 按设计跳过死链，但目录里
    // 全是死链时，只说「暂无用户 Skill」等于让人以为自己清空了技能库。
    {
      file: "client.js",
      required: true,
      find: "      if (d && d.ok) setSt({ ok: true, skills: d.skills || [] });",
      replace:
        "      if (d && d.ok) setSt({ ok: true, skills: d.skills || [], dead: d.skills_dead || 0 });",
    },
    {
      file: "client.js",
      required: true,
      find: '    list = h("p", { className: "dshpp-empty" }, t("skills.empty"));',
      replace:
        "    /* [dsh-purge-plus] 死链被跳过后要说出来，否则空态文案会误导 */\n" +
        "    list = h(\n" +
        '      "p",\n' +
        '      { className: "dshpp-empty" },\n' +
        '      st && st.dead ? t("skills.empty") + " · " + t("skills.dead", { count: st.dead }) : t("skills.empty")\n' +
        "    );",
    },
    {
      file: "client.js",
      required: true,
      find: '  "skills.empty": "\\u6682\\u65E0\\u7528\\u6237 Skill",',
      replace:
        '  "skills.empty": "\\u6682\\u65E0\\u7528\\u6237 Skill",\n' +
        '  "skills.dead": "{count} \\u4E2A\\u5931\\u6548\\u94FE\\u63A5\\u5DF2\\u8DF3\\u8FC7",',
    },
    {
      file: "client.js",
      required: true,
      find: '  "skills.empty": "No user skills",',
      replace:
        '  "skills.empty": "No user skills",\n' +
        '  "skills.dead": "{count} broken symlink(s) skipped",',
    },
    // 后端：把死链数量报给面板（listSkills 跳过死链是对的，但跳过要可见）
    {
      file: "lib/skills.js",
      required: true,
      find: "export async function skillsStatus(dshHome) {\n  const listed = await listSkills(dshHome);",
      replace:
        "/* [dsh-purge-plus] 死链统计。listSkills 按设计跳过死链（数据问题不等于判定问题），\n" +
        "   但「跳过」必须让人看见：目录里全是死链时，空态得说明为什么是空的。 */\n" +
        "export async function deadSkillLinks(dshHome) {\n" +
        "  const dir = skillsDir(dshHome);\n" +
        "  let entries = [];\n" +
        "  try {\n" +
        "    entries = await fsp.readdir(dir, { withFileTypes: true });\n" +
        "  } catch {\n" +
        "    return [];\n" +
        "  }\n" +
        "  const dead = [];\n" +
        "  for (const entry of entries) {\n" +
        "    if (!entry.isSymbolicLink()) continue;\n" +
        "    try { await fsp.stat(path.join(dir, entry.name)); } catch { dead.push(entry.name); }\n" +
        "  }\n" +
        "  return dead.sort();\n" +
        "}\n" +
        "\n" +
        "export async function skillsStatus(dshHome) {\n" +
        "  const listed = await listSkills(dshHome);",
    },
    {
      file: "lib/skills.js",
      required: true,
      find:
        "      path: displayUnderHome(dshHome, item.path),\n" +
        "    })),\n" +
        "  };\n" +
        "}",
      replace:
        "      path: displayUnderHome(dshHome, item.path),\n" +
        "    })),\n" +
        "    skills_dead: await deadSkillLinks(dshHome),\n" +
        "  };\n" +
        "}",
    },
  ];
}

export const EDITS = buildEdits();
