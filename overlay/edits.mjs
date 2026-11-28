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
        "import { OVERLAY_PATCHES } from './overlay.mjs'; // [dsh-purge-plus]\n" +
        "import { RETAINED_PATCHES } from './retained.mjs'; // [dsh-purge-plus] 上游 1.7.24 退役的执行边界层",
    },
    {
      file: "lib/patches/index.mjs",
      required: true,
      find:
        "export const ALL_PATCHES = [...PATCHES, ...CODE_PATCHES, ...ENGINE_PATCHES, ...NEW_TOOL_PATCHES, ...OPT_IN_PATCHES, ...STABILITY_PATCHES];",
      replace:
        "export const ALL_PATCHES = [...PATCHES, ...CODE_PATCHES, ...ENGINE_PATCHES, ...NEW_TOOL_PATCHES, ...OPT_IN_PATCHES, ...STABILITY_PATCHES, ...OVERLAY_PATCHES, ...RETAINED_PATCHES]; // [dsh-purge-plus]",
    },

    // ══ A2. 禁用 1.7.24 的「退役补丁剥离」迁移 ══════════════════════
    // 1.7.24 删掉 14 条执行边界补丁后，backupAll() 会先跑 inspectRetiredPermissions，
    // 把宿主文件里这 14 条留下的痕迹按 digest 逐段还原成官方原文——也就是在每次
    // 备份前主动把它们擦掉。本包把这 14 条接成自有补丁（retained.mjs），
    // 迁移必须停掉，否则「打了又被擦」会在状态页表现为 14 条永远未应用。
    // 只清空 rules 数组：inspectRetiredPermissions 遍历 rules、retiredRulesFor 过滤 rules，
    // 两处同时变空操作，模块其余导出与 import 保持可用。
    {
      file: "lib/retired-permissions.mjs",
      required: true,
      find:
        'const rules = JSON.parse(\n' +
        '  fs.readFileSync(new URL("./retired-permissions.json", import.meta.url)),\n' +
        ');',
      replace:
        'const rules = []; // [dsh-purge-plus] 14 条退役补丁在本包保留，禁用剥离迁移（见 patches/retained.mjs 头注释）',
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
        'import { installSubagentFence } from "./subagent-fence.js"; // [dsh-purge-plus]\n' +
        'import { installPlusCapabilities } from "./plus-capabilities.js"; // [dsh-purge-plus] 能力接线层',
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
        "  try { installSubagentFence(ctx, cfg); } catch { /* 老宿主无 tools/pre-execute */ }\n" +
        "  // [dsh-purge-plus] safe 能力接线：team-mode（红队根会话默认开任务板）+\n" +
        "  // preset-default（停用/热重载时清 selectedDefault）。逐项 try/catch，一项失败不影响启动。\n" +
        "  try { installPlusCapabilities(ctx, cfg); } catch { /* 能力层可选 */ }",
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
    // F-2：真正的病灶在这里。liangshenRoots 遍历 profiles 下的每一项拼候选路径，
    // profiles 里混着 macOS 的 .DS_Store（文件），拼出来的
    // .DS_Store/node_modules/... 用 lstatSync 探测会抛 ENOTDIR，
    // 而下面的 catch 只放行 ENOENT → 整个 liangshenPresence 退化成 "unknown"。

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
        "      /* [dsh-purge-plus] 写失败必须说清原因：旧返回 {ok:false, bound:null} 没有 error 字段，\n" +
        "         面板只能显示「失败」，而真正的原因是靶标不存在（或绑定表写不进去）。 */\n" +
        "      if (!written) {\n" +
        "        const known = store.listEngagements().some((e) => e.id === req.engagement)\n" +
        "        return {\n" +
        "          ok: false, session: sid, bound: null,\n" +
        "          error: known\n" +
        "            ? '绑定写入失败：' + String(req.engagement) + ' 存在，但 sessions.json 写不进去（检查磁盘权限）'\n" +
        "            : 'engagement not found: ' + String(req.engagement),\n" +
        "        }\n" +
        "      }\n" +
        "      return { ok: true, session: sid, bound: req.engagement }\n" +
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
        "      return { ok: true, session: sid, bound: req.engagement }\n" +
        "    }",
      replace:
        "      return { ok: true, session: sid, bound: req.engagement }\n" +
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
      /* R22：safe 2.0.2 的三个只读 op 名。能力早就在（redteam_cve 工具的三个 action
         调的就是同一批函数），缺的只是同名 op —— 外部自动化按 safe 的名字调会拿到
         unknown op，看起来像「少了 CVE 检索」。 */
      file: "lib/redteam/store-core.js",
      required: true,
      find: "\n    /* ---------- [dsh-purge-plus] P9 清理清单 op ---------- */",
      replace: "\n" + SNIP("store-safe-alias-ops.js") + "\n    /* ---------- [dsh-purge-plus] P9 清理清单 op ---------- */",
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
    // 中文词条：status.missing_file 原来不存在，新增。缺=7F3A 目=76EE 标=6807
    // 文=6587 件=4EF6。
    // 英文词条

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
    // 基础胶囊样式：is-miss 之后补 is-na（灰 + 虚线）
    // 页面作用域那份：它给 is-ok / is-wait / is-bad 各自定了描边色，
    // 但没定 is-na，会退回 .dshpp-page .dshpp-pill 的实线灰——虚线就丢了。

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
    // #35 与 #14 是同效补丁：#14 把整个 approveEscalation 换成 return mode，
    // #35 要替换的那段 switch 随之消失，于是「锚点没了」被判成 skipped。
    // 行为其实已经到位，不认这条同效标记就会把「已生效」报成「没生效」——
    // 这是**假阴性**，比假阳性更危险：用户会以为保护没上。
    // markers 默认要求全部命中，所以必须同时给 markersAny。
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
    // 分组小计也把 na 单列，否则「跳过 n」里会混进 6 条真正不适用
    // 结论句：有跳过就不能说「全部就位」
    // 进度条补一段「跳过」
    // 第四格之前插一格「跳过」：85 + 0 + 0 + 2 + 6 = 93，能对上总数
    // 过滤条：「跳过」要有自己的按钮，否则那 2 条只能靠翻「全部」找
    // 组头小字：补上「跳过 n」
    // 概览卡片那行原本拿 tally.skipped 冒充「本端不适用」，改成各归各的
    // 顶部条：文案统一成「本端不适用」，并把「跳过」也报出来（85+2+6=93 能对上）
    // 中文词条
    // 英文词条
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
    // ── 幽灵引用：`fs` 未 import，防软链删穿的守卫是死的 ──────────
    // 上游只 import 了 `promises as fsp`，`fs.realpathSync` 抛 ReferenceError
    // 被同一个 try 的 `catch { return abs }` 吃掉 → toReal() 退化成 path.resolve，
    // 注释明写「只 resolve 不解 symlink 会把 skills 删穿」，而防它的那行代码从未执行。
    {
      file: "lib/skills.js",
      required: true,
      find: 'import { promises as fsp } from "node:fs";',
      replace: 'import { promises as fsp, realpathSync } from "node:fs"; // [dsh-purge-plus] realpathSync 原先只被引用未导入',
    },
    {
      file: "lib/skills.js",
      required: true,
      find: "    try { return fs.realpathSync.native ? fs.realpathSync.native(abs) : fs.realpathSync(abs); }",
      replace: "    try { return realpathSync.native ? realpathSync.native(abs) : realpathSync(abs); }",
    },
    // ── hashbang 不在第 1 行：整个脚本 `node --check` 直接失败 ──────
    // 社区血统那份把 import 放在了 shebang 前面；safe 那份顺序是对的。
    {
      file: "scripts/export-engagement-report.mjs",
      required: true,
      find: 'import { removeTreeNoFollowSync } from "../lib/remove-tree.js";\n#!/usr/bin/env node',
      replace: '#!/usr/bin/env node\nimport { removeTreeNoFollowSync } from "../lib/remove-tree.js";',
    },
    // ── 面板权限组：写死空数组 + 文案否认，与 14 条真实补丁矛盾 ──────
    // PERMISSION_PATCH_IDS 是空数组、desc 写「本构建已移除全部权限补丁」，
    // 而 ALL_PATCHES 里 permissionOverride 实测 14 条且宿主文件上已生效 →
    // 面板的 chip 恒显示「0 条」，替一条真实行为做否认（01-upstream S1）。
    {
      file: "client.js",
      required: true,
      find: "var PERMISSION_PATCH_IDS = [];",
      replace:
        "/* [dsh-purge-plus] 这 14 条由 tuning.permissionPatches 总闸控制，宿主上已生效。\n" +
        "   以前这里写 [] 且文案说「已移除全部权限补丁」——面板在替真实行为做否认。\n" +
        "   verify 断言这份清单 == ALL_PATCHES.filter(p => p.permissionOverride) 的 id 集。 */\n" +
        "var PERMISSION_PATCH_IDS = [6,7,8,9,10,13,14,15,16,35,51,59,60,62];",
    },
    {
      file: "client.js",
      required: true,
      find: '"\\u672C\\u6784\\u5EFA\\u5DF2\\u79FB\\u9664\\u5168\\u90E8\\u6743\\u9650/\\u6C99\\u7BB1/\\u5BA1\\u6279\\u8865\\u4E01\\u3002\\u6743\\u9650\\u8BF7\\u76F4\\u63A5\\u7528 DSH \\u539F\\u751F\\u8BBE\\u7F6E\\uFF08danger-full-access\\u3001approval policy\\uFF09\\u3002"',
      replace: '"\\u6743\\u9650/\\u6C99\\u7BB1/\\u5BA1\\u6279\\u5171 14 \\u6761\\u8865\\u4E01\\uFF0C\\u7531\\u8FD9\\u4E2A\\u603B\\u95F8\\u63A7\\u5236\\uFF1B\\u5173\\u6389\\u5373\\u5168\\u90E8\\u56DE\\u6EDA\\u6210\\u5BBF\\u4E3B\\u539F\\u6837\\u3002\\u6743\\u9650\\u6863\\u4F4D\\u672C\\u8EAB\\u4ECD\\u7531 DSH \\u539F\\u751F\\u8BBE\\u7F6E\\u51B3\\u5B9A\\u3002"',
    },
    {
      file: "client.js",
      required: true,
      find: '"This build ships no permission / sandbox / approval patches. Use the native DSH settings instead (danger-full-access, approval policy)."',
      replace: '"14 permission / sandbox / approval patches sit behind this master switch. Turn it off and all of them roll back to the host original. The permission level itself still comes from the native DSH settings."',
    },
    // 分组改成优先信后端下发的 permission / context 标记，硬编码表只作退路
    {
      file: "client.js",
      required: true,
      find:
        'function patchGroupOf(id) {\n' +
        '  const n = Number(id);\n' +
        '  if (PERMISSION_SET.has(n)) return "permission";\n' +
        '  if (CONTEXT_SET.has(n)) return "context";\n' +
        '  return "normal";\n' +
        '}',
      replace:
        'function patchGroupOf(id) {\n' +
        '  const n = Number(id);\n' +
        '  if (PERMISSION_SET.has(n)) return "permission";\n' +
        '  if (CONTEXT_SET.has(n)) return "context";\n' +
        '  return "normal";\n' +
        '}\n' +
        '/* [dsh-purge-plus] 后端 patch_rows 现在带 permission / context 标记，\n' +
        '   分组以后端为准，硬编码集合只作旧响应的退路 —— 两处口径不会再分叉。 */\n' +
        'function rowGroup(r) {\n' +
        '  if (r && r.permission === true) return "permission";\n' +
        '  if (r && r.context === true) return "context";\n' +
        '  return patchGroupOf(r && r.id);\n' +
        '}',
    },
    {
      file: "client.js",
      required: true,
      find:
        '  const permApplied = rows.filter(\n' +
        '    (r) => patchGroupOf(r.id) === "permission" && r.st === "applied"\n' +
        '  ).length;\n' +
        '  const permPending = rows.filter(\n' +
        '    (r) => patchGroupOf(r.id) === "permission" && r.st === "pending"\n' +
        '  ).length;\n' +
        '  const ctxApplied = rows.filter(\n' +
        '    (r) => patchGroupOf(r.id) === "context" && r.st === "applied"\n' +
        '  ).length;',
      replace:
        '  /* [dsh-purge-plus] 分母取自真实行数，不再用写死的 PERMISSION_PATCH_IDS.length\n' +
        '     （那是 0，chip 恒显示「0 条」）。 */\n' +
        '  const permRows = rows.filter((r) => rowGroup(r) === "permission");\n' +
        '  const permTotal = permRows.length || PERMISSION_PATCH_IDS.length;\n' +
        '  const permApplied = permRows.filter((r) => r.st === "applied").length;\n' +
        '  const permPending = permRows.filter((r) => r.st === "pending").length;\n' +
        '  const ctxApplied = rows.filter((r) => rowGroup(r) === "context" && r.st === "applied").length;',
    },
    {
      file: "client.js",
      required: true,
      find:
        '        chip: kind !== "detail" ? t("evidence." + kind) : permOn ? t("sw.chip.on", {\n' +
        '          n: PERMISSION_PATCH_IDS.length,\n' +
        '          written: permApplied,\n' +
        '          pending: permPending\n' +
        '        }) : t("sw.chip.off", { n: PERMISSION_PATCH_IDS.length }),',
      replace:
        '        chip: kind !== "detail" ? t("evidence." + kind) : permOn ? t("sw.chip.on", {\n' +
        '          n: permTotal,\n' +
        '          written: permApplied,\n' +
        '          pending: permPending\n' +
        '        }) : t("sw.chip.off", { n: permTotal }),',
    },
    {
      file: "client.js",
      required: true,
      find:
        '        optional: p.optional === true,\n' +
        '        settleWhenAbsent: p.settleWhenAbsent === true\n' +
        '      }))',
      replace:
        '        optional: p.optional === true,\n' +
        '        settleWhenAbsent: p.settleWhenAbsent === true,\n' +
        '        permission: p.permission === true, // [dsh-purge-plus] 分组用后端真值\n' +
        '        context: p.context === true\n' +
        '      }))',
    },
    {
      file: "lib/index.js",
      required: true,
      find:
        '                optional: !!p.optional,\n' +
        '                settleWhenAbsent: !!p.settleWhenAbsent,\n' +
        '              })),\n' +
        '              patch_names,',
      replace:
        '                optional: !!p.optional,\n' +
        '                settleWhenAbsent: !!p.settleWhenAbsent,\n' +
        '                permission: !!p.permissionOverride, // [dsh-purge-plus] 面板按这个分组\n' +
        '                context: !!p.disabledByDefault,\n' +
        '              })),\n' +
        '              patch_names,',
    },
    // ── 文档/注释与行为相反：permissionPatches 其实是 14 条的总闸 ──
    // lib/core.js:3930 实测 `if (patch.permissionOverride) return t.permissionPatches !== false`，
    // 即 true→启用 14 条 / false→0 条。原注释说「本字段不再影响任何补丁」（01-upstream S2）。
    {
      file: "lib/tuning.js",
      required: true,
      find: "  permissionPatches: true, // 兼容字段：权限补丁已从本构建移除，本字段不再影响任何补丁",
      replace:
        "  permissionPatches: true, // 14 条权限/沙箱/审批补丁（retained.mjs）的总闸：false 即全部回滚成宿主原样",
    },
    {
      file: "docs/releases/1.7.24.md",
      required: true,
      find: "`tuning.permissionPatches` 保留但**不再影响任何补丁**——那 14 条已经不存在。读到该字段不会报错，也不会产生效果。",
      replace:
        "`tuning.permissionPatches` 是那 14 条权限/沙箱/审批补丁的**总闸**：本包把它们接成 `lib/patches/retained.mjs` 保留下来，`true` 启用全部、`false` 全部回滚成宿主原样。",
    },
    // 自检层数：文档写 25，实测静态层 17 + 动态层上限 22、实跑 20
    {
      file: "docs/troubleshooting.md",
      required: true,
      find: "| `selfcheck [--json]` | 是 | 25 层 `state`；`broken` 才退出 1 |",
      replace: "| `selfcheck [--json]` | 是 | 静态 17 层 + 动态层（合计上限 22，本机实跑 20）`state`；`broken` 才退出 1 |",
    },
    // ── 自检层缺了自有 8 条：宿主升级后 #207/#208 漂移会静默复发 ──────
    // 04-behavior 实测：把克隆宿主里的 #206/#207 拆成 pending 后，
    // 17 个宿主层仍全绿、broken=0、零提示。api-session-controller 的锚点一漂，
    // 「选红队模式发一句话又变回标准」就会复发而面板说「一切正常」。
    {
      file: "lib/selfcheck.js",
      required: true,
      find:
        '  { ids: [82, 83, 84], optionalIds: [82, 83, 84], title: "桌面宿主启动兜底", kind: "host",\n' +
        '    why: "缺 DSH_PROFILE 也能定位 profile；host 被信号杀或正常退出不弹崩溃框" },\n' +
        ']);',
      replace:
        '  { ids: [82, 83, 84], optionalIds: [82, 83, 84], title: "桌面宿主启动兜底", kind: "host",\n' +
        '    why: "缺 DSH_PROFILE 也能定位 profile；host 被信号杀或正常退出不弹崩溃框" },\n' +
        '  /* [dsh-purge-plus] 自有 8 条（≥201）原先不在任何自检层里：\n' +
        '     宿主升级让 api-session-controller 的锚点漂移时，面板仍然全绿。 */\n' +
        '  { ids: [201, 202, 203, 205, 206, 207, 208, 209], title: "自有补丁（≥201）", kind: "host",\n' +
        '    why: "埋点/遥测/剪贴板/会话复用/挂起提示：宿主升级让锚点漂移时必须看得出来" },\n' +
        ']);',
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
    // R19 起改在源头修：`overlay/snippets/store-cleanup-ops.js` 只把调用方真的给过的
    // 字段交给 store，`overlay/snippets/store-cleanup.js` 把 undefined 当「没给」。
    // 原先在这里用文本补丁重写同一段逻辑 —— 源头一改锚点就失配，而且补丁只该补
    // 上游 vendor，不该回头改写自己的片段。

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
        '    if (rows.some((row) => ["pending", "unknown", "broken"].includes(patchStateCategory(row, row.st)))) autoOpen[key] = true;\n' +
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
    // 锚点是上一条编辑**插入后**的尾部：绑定失败分支已带 error 字段，
    // 这里只负责把会话图 op 接到它后面。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      return { ok: true, session: sid, bound: req.engagement }\n" +
        "    }",
      replace:
        "      return { ok: true, session: sid, bound: req.engagement }\n" +
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
      find: "  intelRefresh() {\n",
      replace: SNIP("store-intel-net.js") + "\n  intelRefresh() {\n",
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
    // ── 安全：/redteam/api 的回环放行（2026-11-23 复核确认的 CSRF 面）─────
    // 原判据是「来源地址是回环就放行」。但浏览器里的任意网页向 127.0.0.1
    // POST 时，服务端看到的 remoteAddress **恒为回环** —— 这个判据对浏览器
    // 攻击等于不存在，而 /redteam/api 的 op 集合包含写资产/漏洞/凭据与改
    // 平台配置。修法：保留桌面端形态（无 Origin / null / app: / file:）放行，
    // 只拒绝明确的跨站 http(s) 来源；同源与回环同源继续放行。
    {
      file: "lib/redteam/ui.js",
      required: true,
      find:
        "      /* 来源校验：本机回环一律放行（官方桌面端 Origin 常是 app:// / file://，\n" +
        "         旧逻辑会把 Origin.host 判空后直接 403，导致技能库/知识库/SQL 全挂）。\n" +
        "         非回环才要求 Origin 与 Host 同源。 */\n",
      replace:
        "      /* 来源校验（[dsh-purge-plus] 2026-11-23 收紧）：\n" +
        "         桌面端 Origin 常是 app:// / file:// / null，旧逻辑把 Origin.host 判空\n" +
        "         后直接 403，导致技能库/知识库/SQL 全挂 —— 这部分保留放行。\n" +
        "         但「回环来源一律放行」等于没有校验：任意网页向 127.0.0.1 POST 时\n" +
        "         remoteAddress 恒为回环，写 op 可被跨站触发（CSRF）。\n" +
        "         现判据：无 Origin / null / app: / file: → 放行；http(s) Origin 必须是\n" +
        "         回环主机或与 Host 同源；其余一律 403。 */\n",
    },
    {
      file: "lib/redteam/ui.js",
      required: true,
      find: "      const originOk = (() => {\n        if (loopback) return true\n",
      replace:
        "      const originOk = (() => {\n" +
        "        if (loopback) {\n" +
        "          if (origin === undefined || origin === '' || origin === 'null') return true\n" +
        "          if (typeof origin === 'string' && /^(app|file):/i.test(origin)) return true\n" +
        "          try {\n" +
        "            const oh = new URL(origin)\n" +
        "            return /^(localhost|127\\.0\\.0\\.1|\\[::1\\]|::1)$/i.test(oh.hostname)\n" +
        "          } catch { return false }\n" +
        "        }\n",
    },
    // ── 补丁组状态汇总：组内有一条没打上，就不能报「已生效」────────────
    // 上游 1.7.20 的 rollupDisplayStatus 是「组内任一 applied → 整组 applied」，
    // 于是一个补丁在两个目标文件里只命中一个（partial）时，面板照样显示已生效。
    // 上游 master（e519253）已改成逐状态判定；本仓库留在 1.7.20 基线，
    // 用这两条编辑把同一语义补回来（不整棵替换 vendor）。
    {
      file: "lib/redteam/tools.js",
      required: true,
      find: "  ctx.tools.register(withStructuredErrors(defineTool({\n    name: 'redteam_engagement_open',",
      replace: SNIP("tools-cve.js") + "\n  ctx.tools.register(withStructuredErrors(defineTool({\n    name: 'redteam_engagement_open',",
    },

    // ══ Z. 团队任务板（官方 Agent Teams）面板入口 ════════════════════
    // 数据面放在 lib/redteam/ui.js：只有那里有 ctx，能拿到 sessions 与 agentTeams。
    // 任务本身是根会话日志里的 `team/task` 事件，由宿主的 sessionProjections 折叠；
    // store-core 是无 Cordis 依赖的纯模块（只拿得到 root 目录），硬塞进去只能靠猜
    // 日志路径，宿主观影一改就静默变成空白表 —— 那正是本包反复要避免的假绿灯。
    {
      file: "lib/redteam/ui.js",
      required: true,
      find: "async function handleAgentsOp(ctx, request) {",
      replace: SNIP("team-board-ui.js") + "\nasync function handleAgentsOp(ctx, request) {",
    },
    {
      file: "lib/redteam/ui.js",
      required: true,
      find: "        const agentsResult = await handleAgentsOp(ctx, request)\n",
      replace:
        "        /* [dsh-purge-plus] 团队任务板：在 store 分发之前拦，因为数据不在 store 里。 */\n" +
        "        const teamBoardResult = await handleTeamBoardOp(ctx, store, request)\n" +
        "        if (teamBoardResult !== undefined) {\n" +
        "          sendJson(res, 200, teamBoardResult)\n" +
        "          return\n" +
        "        }\n" +
        "        const agentsResult = await handleAgentsOp(ctx, request)\n",
    },

    // ══ AA. 缺参文案：把 `undefined` 从用户可见的错误里赶出去 ═════════
    // 审计实测：不带 id 调 pocGet/pocUpdate/pocDelete/pocUse/shotData/readAttackFile，
    // 返回的是 `poc not found: undefined` —— 把 JS 的 undefined 拼进了提示文案。
    // 调用方看不出是"你没给 id"还是"这个 id 不存在"，而这两件事的修法完全不同。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      const key = req.id !== undefined ? req.id : req.code\n" +
        "      const hit = store.getPoc(key)\n",
      replace:
        "      const key = req.id !== undefined ? req.id : req.code\n" +
        "      /* [dsh-purge-plus] 缺参和查无此条是两件事：不分开报，调用方只能看到 undefined */\n" +
        "      if (key === undefined || key === null || key === '') {\n" +
        "        return { ok: false, error: 'pocGet 需要 id 或 code' }\n" +
        "      }\n" +
        "      const hit = store.getPoc(key)\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    if (op === 'pocUpdate') return { ok: true, poc: store.updatePoc(req.id !== undefined ? req.id : req.code, req.patch || req) }\n" +
        "    if (op === 'pocDelete') return Object.assign({ ok: true }, store.deletePoc(req.id !== undefined ? req.id : req.code))\n" +
        "    if (op === 'pocUse') return Object.assign({ ok: true }, store.markPocUsed(req.id !== undefined ? req.id : req.code, req.used_on))\n",
      replace:
        "    /* [dsh-purge-plus] 三个写 op 的缺参守卫：先判参数，再判存在。 */\n" +
        "    if (op === 'pocUpdate') {\n" +
        "      const key = req.id !== undefined ? req.id : req.code\n" +
        "      if (key === undefined || key === null || key === '') return { ok: false, error: 'pocUpdate 需要 id 或 code' }\n" +
        "      return { ok: true, poc: store.updatePoc(key, req.patch || req) }\n" +
        "    }\n" +
        "    if (op === 'pocDelete') {\n" +
        "      const key = req.id !== undefined ? req.id : req.code\n" +
        "      if (key === undefined || key === null || key === '') return { ok: false, error: 'pocDelete 需要 id 或 code' }\n" +
        "      return Object.assign({ ok: true }, store.deletePoc(key))\n" +
        "    }\n" +
        "    if (op === 'pocUse') {\n" +
        "      const key = req.id !== undefined ? req.id : req.code\n" +
        "      if (key === undefined || key === null || key === '') return { ok: false, error: 'pocUse 需要 id 或 code' }\n" +
        "      return Object.assign({ ok: true }, store.markPocUsed(key, req.used_on))\n" +
        "    }\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "    if (op === 'shotData') return Object.assign({ ok: true }, store.readShot(id, req.id !== undefined ? req.id : req.shot_id))\n",
      replace:
        "    if (op === 'shotData') {\n" +
        "      const shot = req.id !== undefined ? req.id : req.shot_id\n" +
        "      if (shot === undefined || shot === null || shot === '') return { ok: false, error: 'shotData 需要 id 或 shot_id' }\n" +
        "      return Object.assign({ ok: true }, store.readShot(id, shot))\n" +
        "    }\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "      const hit = store.readAttackFile(id, req.id)\n",
      replace:
        "      /* [dsh-purge-plus] 缺参先报缺参，别把 undefined 当成「这个 id 不存在」 */\n" +
        "      if (req.id === undefined || req.id === null || req.id === '') {\n" +
        "        return { ok: false, error: 'readAttackFile 需要 id' }\n" +
        "      }\n" +
        "      const hit = store.readAttackFile(id, req.id)\n",
    },
    // activateEngagement 是"选择靶标"本身，要求已有靶标是循环依赖，所以它不能进
    // WRITE_OPS（那里是"必须已有靶标才能动"的守卫）。但缺参时它返回的
    // `{ok:false, current:…}` 没有 error 字段，面板上就是一条空白提示 —— 补上。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      const activated = store.setActiveEngagement(req.engagement)\n",
      replace:
        "      if (req.engagement === undefined || req.engagement === null || req.engagement === '') {\n" +
        "        return { ok: false, error: 'activateEngagement 需要 engagement' }\n" +
        "      }\n" +
        "      const activated = store.setActiveEngagement(req.engagement)\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "      return { ok: activated, current: store.activeEngagementId() }\n",
      replace:
        "      return activated\n" +
        "        ? { ok: true, current: store.activeEngagementId() }\n" +
        "        : { ok: false, error: `engagement not found: ${req.engagement}`, current: store.activeEngagementId() }\n",
    },

    // ── 名额挂起（slot-state）：safe 2.0.2 的行为，本包原先只移植了模块没接线 ──
    // 见 docs/audit/AUDIT-3WAY-2026-11-25.md §4。四条接线缺一条，parked 就永远是空集合：
    //   ① 导入；② 实时并发扣掉挂起的；③ 子智能体结束摘标记；④ 回报 blocked/waiting 时挂起。
    {
      file: "lib/redteam/tools.js",
      required: true,
      find: "import { maxAgentsOf, DEFAULT_MAX_AGENTS, MAX_AGENTS_LIMIT } from './settings.js'\n",
      replace:
        "import { maxAgentsOf, DEFAULT_MAX_AGENTS, MAX_AGENTS_LIMIT } from './settings.js'\n" +
        "/* [dsh-purge-plus] 名额挂起：工具层写、面板层读，共用一份（safe 2.0.2 slot-state.js） */\n" +
        "import { isParked, parkAgent, unparkAgent } from './slot-state.js'\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "    const running = rows.filter((e) => e && e.kind === 'child' && e.activity === 'running')\n" +
        "    return {\n" +
        "      available: true,\n" +
        "      running: running.length,\n" +
        "      running_labels: running.map((e) => e.label || e.id).slice(0, 20),\n" +
        "      total_children: rows.filter((e) => e && e.kind === 'child').length,\n" +
        "    }\n",
      replace:
        "    const runningAll = rows.filter((e) => e && e.kind === 'child' && e.activity === 'running')\n" +
        "    /* [dsh-purge-plus] 挂起（回报 blocked/waiting 等人）的不占名额：它没在干活，\n" +
        "       占着名额等于把并发锁死。口径与 safe 2.0.2 tools.js:313 一致。 */\n" +
        "    const running = runningAll.filter((e) => !isParked(rootSessionId, e.id))\n" +
        "    const parkedRows = runningAll.filter((e) => isParked(rootSessionId, e.id))\n" +
        "    return {\n" +
        "      available: true,\n" +
        "      running: running.length,\n" +
        "      running_labels: running.map((e) => e.label || e.id).slice(0, 20),\n" +
        "      parked: parkedRows.length,\n" +
        "      parked_labels: parkedRows.map((e) => e.label || e.id).slice(0, 20),\n" +
        "      total_children: rows.filter((e) => e && e.kind === 'child').length,\n" +
        "    }\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "        const childId = info && info.id !== undefined ? String(info.id) : undefined\n" +
        "        if (rootId === undefined) return\n",
      replace:
        "        const childId = info && info.id !== undefined ? String(info.id) : undefined\n" +
        "        if (rootId === undefined) return\n" +
        "        /* [dsh-purge-plus] 结束即摘挂起标记，否则同一 id 复活后会被误判成还在等 */\n" +
        "        if (childId !== undefined) unparkAgent(rootId, childId)\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "      action: { type: 'string', required: true, enum: ['status', 'acquire', 'release'], description: 'status 查看 / acquire 占用 / release 释放' },\n",
      replace:
        "      action: { type: 'string', required: true, enum: ['status', 'acquire', 'release'], description: 'status 查看 / acquire 占用 / release 释放' },\n" +
        "      status: { type: 'string', enum: ['progress', 'ready', 'blocked', 'waiting'], description: '【只有执行子智能体填】blocked/waiting 表示在等人给 key/VPS/范围 —— 会**让出名额**，不占并发；progress/ready 收回名额。主会话不要填。' },\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "      const live = await liveRunningChildren(ctx, owner)\n" +
        "      const reserved = reservationList(owner)\n",
      replace:
        "      /* [dsh-purge-plus] 子智能体自报状态：在等人时让出名额（safe 2.0.2 tools.js:949）。\n" +
        "         主会话填 status 一律拒绝 —— 它不占名额，填了只会把数字搅乱。 */\n" +
        "      const selfChild = sessionId !== undefined && sessionId !== owner ? sessionId : undefined\n" +
        "      const reportStatus = typeof args.status === 'string' ? args.status : ''\n" +
        "      if (reportStatus !== '') {\n" +
        "        if (selfChild === undefined) {\n" +
        "          return JSON.stringify({ ok: false, error: 'status 只由执行子智能体填写；主会话用 label/key 操作名额。' }, null, 2)\n" +
        "        }\n" +
        "        if (reportStatus === 'blocked' || reportStatus === 'waiting') parkAgent(owner, selfChild)\n" +
        "        else if (reportStatus === 'progress' || reportStatus === 'ready') unparkAgent(owner, selfChild)\n" +
        "      }\n" +
        "      const live = await liveRunningChildren(ctx, owner)\n" +
        "      const reserved = reservationList(owner)\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find: "        running_from_registry: live.running,\n",
      replace:
        "        running_from_registry: live.running,\n" +
        "        parked: live.parked ?? 0,\n" +
        "        parked_labels: live.parked_labels ?? [],\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "      const dropped = dropReservation(owner, typeof args.key === 'string' && args.key.trim() !== '' ? args.key.trim() : undefined)\n",
      replace:
        "      const wanted = typeof args.key === 'string' && args.key.trim() !== '' ? args.key.trim() : undefined\n" +
        "      const dropped = dropReservation(owner, wanted)\n" +
        "      /* 同一轮里 status=blocked/waiting 才刚挂起自己，这里不能顺手摘掉 */\n" +
        "      const holding = reportStatus === 'blocked' || reportStatus === 'waiting'\n" +
        "      if (selfChild !== undefined && !holding) unparkAgent(owner, selfChild)\n",
    },
    // ══ AB. 观察时钟 + 任务板合并接线（AUDIT-3WAY §4 的第 3、4 项）════════
    // 两个模块此前只移植、从未接线。接线后多出两件真实能力：
    //   ① stall 判定：ticket-stage 的 staleMs 分支原先永远走不到 —— 调用方既没传
    //      staleMs，也没有任何地方产出 claimedAt；
    //   ② 回报按 root+engagement 作用域匹配，不同根会话的同名 task-N 不互串。
    // 时钟只在读任务板时推进（不起定时器）：面板轮询几次后判定才生效，
    // 这一点写进返回值的 clock.advanced_by，不假装它是实时监控。
    {
      file: "lib/redteam/ui.js",
      required: true,
      find:
        "  let stageOf = null\n" +
        "  try {\n" +
        "    const mod = await import('./ticket-stage.js')\n" +
        "    if (mod && typeof mod.taskStage === 'function') stageOf = mod.taskStage\n" +
        "  } catch { stageOf = null }\n",
      replace:
        "  let stageOf = null\n" +
        "  try {\n" +
        "    const mod = await import('./ticket-stage.js')\n" +
        "    if (mod && typeof mod.taskStage === 'function') stageOf = mod.taskStage\n" +
        "  } catch { stageOf = null }\n" +
        "\n" +
        "  /* [dsh-purge-plus] 观察时钟 + 任务板合并（safe 2.0.2 orchestrator-clock.js /\n" +
        "     team-board.js）。两个模块原先只移植、没人 import —— 见 AUDIT-3WAY §4。 */\n" +
        "  let clockMod = null\n" +
        "  try {\n" +
        "    const mod = await import('./orchestrator-clock.js')\n" +
        "    if (mod && typeof mod.sweepStalled === 'function' && typeof mod.claimedAt === 'function') clockMod = mod\n" +
        "  } catch { clockMod = null }\n" +
        "  let boardMod = null\n" +
        "  try {\n" +
        "    const mod = await import('./team-board.js')\n" +
        "    if (mod && typeof mod.mergeTeamBoardTasks === 'function') boardMod = mod\n" +
        "  } catch { boardMod = null }\n" +
        "\n" +
        "  /* stall 阈值来自设置文件（与 maxAgents 同一个 settings.json）。\n" +
        "     读不到/坏掉都退成「关闭」，绝不因为诊断项把任务板打挂。 */\n" +
        "  let clockCfg = { minutes: 0, enabled: false }\n" +
        "  if (clockMod) {\n" +
        "    let settings = {}\n" +
        "    try {\n" +
        "      const mod = await import('./settings.js')\n" +
        "      if (mod && typeof mod.readSettings === 'function') settings = mod.readSettings(store && store.root ? store.root : '.')\n" +
        "    } catch { settings = {} }\n" +
        "    clockCfg = clockMod.clockConfig(settings)\n" +
        "  }\n" +
        "\n" +
        "  /* 快照补 root：team-board.js 用 root 做作用域键，缺了它 claimedAt 会退化成\n" +
        "     「全局同名 task-N」——两个根会话各有一个 task-1 时会互相污染。 */\n" +
        "  const boardTasks = keptTasks.map((task) => {\n" +
        "    const row = Object.assign({}, task, { root: String(target.id) })\n" +
        "    const r = reports && task.ownerId ? reports[String(task.ownerId)] : null\n" +
        "    if (r && r.created_at) row.reportAt = r.created_at\n" +
        "    return row\n" +
        "  })\n" +
        "  const boardById = new Map(boardTasks.map((row) => [String(row.id), row]))\n" +
        "  const boardReports = reports === null ? [] : Object.keys(reports).map((sid) => {\n" +
        "    const r = reports[sid]\n" +
        "    return Object.assign({ root: String(target.id) }, r && typeof r === 'object' ? r : {})\n" +
        "  })\n" +
        "\n" +
        "  const now = Date.now()\n" +
        "  if (clockMod) {\n" +
        "    /* 只记录「首次看到某条 in_progress 任务且没有回报」的时刻；不派活、不发消息。 */\n" +
        "    try { clockMod.sweepStalled(boardTasks, clockCfg, now) } catch { /* 诊断时钟不影响主路径 */ }\n" +
        "  }\n" +
        "  let mergedRows = null\n" +
        "  if (boardMod) {\n" +
        "    try {\n" +
        "      mergedRows = boardMod.mergeTeamBoardTasks(boardTasks, boardReports, {\n" +
        "        claimedAt: clockMod ? (task) => clockMod.claimedAt(task) : undefined,\n" +
        "        staleMs: clockCfg.enabled ? clockCfg.minutes * 60000 : 0,\n" +
        "        now,\n" +
        "      })\n" +
        "    } catch { mergedRows = null }\n" +
        "  }\n" +
        "  const mergedById = new Map((Array.isArray(mergedRows) ? mergedRows : []).map((row) => [String(row.id), row]))\n",
    },
    // 并发名额：面板与工具层必须共用同一份「挂起」状态
    //   slot-state.js 的注释写着「工具层写、面板层读，两边共用一个 Map 才不会出现
    //   『工具说还有名额、面板说满了』」—— 但我们只移植了工具层那一半，
    //   ui.js 从没 import isParked，于是 blocked/waiting 的智能体照样占名额。
    // 并发名额：子会话记录必须带 id，否则挂起判定恒假
    //   slot-state 的键是子会话 id，而这里过去只 push 了 parent/label/activity/mode。
    //   isParked(parent, undefined) → String(undefined) → 永远查不到 → parked 恒 0，
    //   于是「waiting/blocked 让出名额」这整段逻辑一行都没生效（R21 审计 RB-01）。
    {
      file: "lib/redteam/ui.js",
      required: true,
      find:
        "          if (k && k.kind === 'child') children.push({ parent: String(root.id), label: k.label || String(k.id), activity: k.activity, mode: k.mode })\n",
      replace:
        "          if (k && k.kind === 'child') children.push({ id: String(k.id), parent: String(root.id), label: k.label || String(k.id), activity: k.activity, mode: k.mode })\n",
    },
    {
      file: "lib/redteam/ui.js",
      required: true,
      find: "import { maxAgentsOf, maxAgentsSourceOf, saveMaxAgents, DEFAULT_MAX_AGENTS, MAX_AGENTS_LIMIT } from './settings.js'\n",
      replace:
        "import { maxAgentsOf, maxAgentsSourceOf, saveMaxAgents, DEFAULT_MAX_AGENTS, MAX_AGENTS_LIMIT } from './settings.js'\n" +
        "/* [dsh-purge-plus] 与工具层同一份挂起状态：回报 waiting/blocked 的执行智能体已让出名额，\n" +
        "   面板不能再把它们算进 used，否则工具说「还有名额」、面板说「满了」。 */\n" +
        "import { isParked } from './slot-state.js'\n" +
        "/* [dsh-purge-plus] 会话图 / 并发名额的判定逻辑（纯函数，可单独测）。 */\n" +
        "import { mergeSessionGraphLive, splitRunningParked } from './live-views.js'\n",
    },
    {
      file: "lib/redteam/ui.js",
      required: true,
      find:
        "  const running = children.filter((c) => c.activity === 'running')\n" +
        "  return {\n" +
        "    ok: true, max, used: running.length, free: Math.max(max - running.length, 0),\n" +
        "    running: running.slice(0, 20), total_children: children.length,\n" +
        "    source: maxAgentsSourceOf(root, process.env),\n" +
        "    limit: MAX_AGENTS_LIMIT,\n" +
        "    default_max: DEFAULT_MAX_AGENTS,\n" +
        "    note: '同一会话（靶标）同时最多 ' + max + ' 个执行智能体；默认顺序派活。',\n" +
        "  }\n",
      replace:
        "  /* [dsh-purge-plus] 挂起的（在等人给 key / VPS / 范围）只显示，不占名额 ——\n" +
        "     与 tools.js 的 runningAll.filter(!isParked) 同一判据。 */\n" +
        "  const split = splitRunningParked(children, isParked)\n" +
        "  const runningRows = split.running.map((c) => ({ parent: c.parent, label: c.label, activity: c.activity, mode: c.mode }))\n" +
        "  const parkedRows = split.parked.map((c) => ({ parent: c.parent, label: c.label, activity: c.activity, mode: c.mode }))\n" +
        "  return {\n" +
        "    ok: true, max, used: runningRows.length, free: Math.max(max - runningRows.length, 0),\n" +
        "    running: runningRows.slice(0, 20), total_children: children.length,\n" +
        "    parked: parkedRows.length, parked_labels: parkedRows.map((p) => p.label).slice(0, 20),\n" +
        "    source: maxAgentsSourceOf(root, process.env),\n" +
        "    limit: MAX_AGENTS_LIMIT,\n" +
        "    default_max: DEFAULT_MAX_AGENTS,\n" +
        "    note: '同一会话（靶标）同时最多 ' + max + ' 个执行智能体；默认顺序派活。'\n" +
        "      + (parkedRows.length ? '（另有 ' + parkedRows.length + ' 个在等人给资源，已让出名额）' : ''),\n" +
        "  }\n",
    },
    {
      file: "lib/redteam/ui.js",
      required: true,
      find:
        "  const now = Date.now()\n" +
        "  const items = (Array.isArray(hostView) ? hostView : keptTasks).map((task) => {\n" +
        "    const report = (reports && task.ownerId) ? reports[String(task.ownerId)] || null : null\n" +
        "    let stage = ''\n" +
        "    let needs = []\n" +
        "    let reason = ''\n" +
        "    if (stageOf) {\n" +
        "      try {\n" +
        "        const got = stageOf({ task, report, tasks: allTasks, now })\n" +
        "        stage = String(got.stage || '')\n" +
        "        needs = Array.isArray(got.needs) ? got.needs : []\n" +
        "        reason = String(got.reason || '')\n" +
        "      } catch { stage = '' }\n" +
        "    }\n",
      replace:
        "  const items = (Array.isArray(hostView) ? hostView : keptTasks).map((task) => {\n" +
        "    const report = (reports && task.ownerId) ? reports[String(task.ownerId)] || null : null\n" +
        "    /* 优先用 team-board.js 的合并结果；模块缺失才退回内联的 ticket-stage 调用。 */\n" +
        "    const merged = mergedById.get(String(task.id)) || null\n" +
        "    const boardRow = boardById.get(String(task.id)) || task\n" +
        "    let stage = ''\n" +
        "    let needs = []\n" +
        "    let reason = ''\n" +
        "    let mergedReportAt = ''\n" +
        "    let linkedBy = ''\n" +
        "    if (merged) {\n" +
        "      stage = String(merged.stage || '')\n" +
        "      needs = Array.isArray(merged.needs) ? merged.needs : []\n" +
        "      reason = String(merged.stageReason || '')\n" +
        "      mergedReportAt = merged.reportAt ? String(merged.reportAt) : ''\n" +
        "      linkedBy = merged.reportLinkedBy ? String(merged.reportLinkedBy) : ''\n" +
        "    } else if (stageOf) {\n" +
        "      try {\n" +
        "        const got = stageOf({\n" +
        "          task: boardRow,\n" +
        "          report,\n" +
        "          tasks: boardTasks,\n" +
        "          now,\n" +
        "          staleMs: clockCfg.enabled ? clockCfg.minutes * 60000 : 0,\n" +
        "          claimedAt: clockMod ? clockMod.claimedAt(boardRow) : NaN,\n" +
        "        })\n" +
        "        stage = String(got.stage || '')\n" +
        "        needs = Array.isArray(got.needs) ? got.needs : []\n" +
        "        reason = String(got.reason || '')\n" +
        "      } catch { stage = '' }\n" +
        "    }\n",
    },
    {
      file: "lib/redteam/ui.js",
      required: true,
      find:
        "    if (!stage) stage = readyOf(task) ? 'idle' : 'queued'\n" +
        "    return {\n",
      replace:
        "    if (!stage) stage = readyOf(task) ? 'idle' : 'queued'\n" +
        "    /* stall 单独算一次，不靠 reason 文案匹配：判据是「in_progress + 没有回报 +\n" +
        "       首次观察至今 ≥ staleMs」，与 ticket-stage 里那条分支同源。 */\n" +
        "    let stalled = false\n" +
        "    if (clockMod && clockCfg.enabled && task.status === 'in_progress' && !report) {\n" +
        "      const since = clockMod.claimedAt(boardRow)\n" +
        "      if (Number.isFinite(since) && now - since >= clockCfg.minutes * 60000) stalled = true\n" +
        "    }\n" +
        "    return {\n",
    },
    {
      file: "lib/redteam/ui.js",
      required: true,
      find: "      report_at: report ? String(report.created_at || '') : '',\n",
      replace:
        "      report_at: mergedReportAt || (report ? String(report.created_at || '') : ''),\n" +
        "      report_linked_by: linkedBy,\n" +
        "      stalled,\n",
    },
    {
      file: "lib/redteam/ui.js",
      required: true,
      find: "    waiting_person: items.filter((t) => t.stage.indexOf('person/') === 0).length,\n  }\n",
      replace:
        "    waiting_person: items.filter((t) => t.stage.indexOf('person/') === 0).length,\n" +
        "    stalled: items.filter((t) => t.stalled === true).length,\n" +
        "  }\n",
    },
    {
      file: "lib/redteam/ui.js",
      required: true,
      find:
        "    view_source: Array.isArray(hostView) ? 'host' : 'projection',\n" +
        "    reports_available: reports !== null,\n",
      replace:
        "    view_source: Array.isArray(hostView) ? 'host' : 'projection',\n" +
        "    /* 派生字段从哪来：team-board.js（含 stall）/ ticket-stage（退回）/ none（都缺） */\n" +
        "    stage_source: mergedRows ? 'team-board' : (stageOf ? 'ticket-stage' : 'none'),\n" +
        "    clock: {\n" +
        "      enabled: clockCfg.enabled,\n" +
        "      minutes: clockCfg.minutes,\n" +
        "      stale_ms: clockCfg.enabled ? clockCfg.minutes * 60000 : 0,\n" +
        "      /* 时钟只在读任务板时推进，不额外起定时器：面板轮询几次后 stall 才判得出来。 */\n" +
        "      advanced_by: 'teamBoard',\n" +
        "    },\n" +
        "    reports_available: reports !== null,\n",
    },

    // ══ AC. CVE 底库远端同步接线（AUDIT-3WAY §4 的第 5 项）═══════════════
    // 审计当时判 intel-sync.js 为「冗余，可删」。逐行读过之后这个判断是错的：
    //   · store-intel-net.js 下载的是 CISA KEV + nuclei 模板；
    //   · intel-sync.js 同步的是 **cve.db.gz 整库**（清单 → sha256 → 解压校验 → 原子顶替）。
    // 两件事不重叠。本包原先只有「本地构建底库」（scripts/build-cve-db.mjs），
    // 没有任何「换一份新的」的路径 —— 所以正确做法是接线，不是删除。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "import { EvidenceLedger, UnknownRegistry } from './evidence-ledger.mjs'\n",
      replace:
        "import { EvidenceLedger, UnknownRegistry } from './evidence-ledger.mjs'\n" +
        "/* [dsh-purge-plus] CVE 底库远端同步（safe 2.0.2 intel-sync.js）：清单 → sha256 →\n" +
        "   解压校验 → 原子顶替。与 store-intel-net（KEV / nuclei 模板）不是同一件事。 */\n" +
        "import { intelSyncStatus, syncIntel } from './intel-sync.js'\n" +
        "/* [dsh-purge-plus] R22：safe 2.0.2 的三个只读 op 名（cveSearch / cveLookup /\n" +
        "   templateCatalogStatus）直接复用底库读取层。cve-db.js 本来就已被 intel-sync.js\n" +
        "   载入，这里只是把符号拿到本文件可见，不增加任何 IO。 */\n" +
        "import { cveDbStatus, lookupCve, searchCve, templateCatalogStatus } from './cve-db.js'\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "      missing_count: missingCount,\n",
      replace:
        "      missing_count: missingCount,\n" +
        "      /* CVE 底库的同步状态：只读本机状态文件，**不联网**（与 intelStatus 的定位一致）。 */\n" +
        "      cve_sync: intelSyncStatus(this.root),\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "  async intelUpdate(target, options = {}) {\n" +
        "    const want = String(target || 'all').trim()\n" +
        "    const keys = want === 'all' ? ['kev', 'nuclei'] : [want]\n",
      replace:
        "  async intelUpdate(target, options = {}) {\n" +
        "    const want = String(target || 'all').trim()\n" +
        "    const keys = want === 'all' ? ['kev', 'nuclei', 'cve'] : [want]\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      else if (key === 'nuclei') results.push(await this.#updateNuclei(options))\n" +
        "      else if (key === 'wordlists') {\n",
      replace:
        "      else if (key === 'nuclei') results.push(await this.#updateNuclei(options))\n" +
        "      else if (key === 'cve') results.push(await this.#updateCveDb(options))\n" +
        "      else if (key === 'wordlists') {\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "        results.push({ key: key, action: 'failed', error: '未知资源：' + key + '（kev/nuclei/wordlists/all）' })\n",
      replace: "        results.push({ key: key, action: 'failed', error: '未知资源：' + key + '（kev/nuclei/cve/wordlists/all）' })\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "  async #updateKev(options = {}) {\n",
      replace:
        "  /**\n" +
        "   * CVE 底库整体替换（safe 2.0.2 intel-sync.js）。\n" +
        "   *\n" +
        "   * 纪律全在 syncIntel 里：sha256 与体积双校验、先解压到临时文件再验 SQLite\n" +
        "   * 结构、最后 rename 原子顶替；任何一步失败都保留旧库。这里只负责把它接进\n" +
        "   * intelUpdate 的 results 形状，并记一行更新日志。\n" +
        "   *\n" +
        "   * 没有配 REDTEAM_INTEL_BASE 时返回 skipped/disabled —— 不猜数据源，也不报错。\n" +
        "   */\n" +
        "  async #updateCveDb(options = {}) {\n" +
        "    try {\n" +
        "      const got = await syncIntel(this.root, {\n" +
        "        base: typeof options.base === 'string' && options.base ? options.base : undefined,\n" +
        "        force: options.force === true,\n" +
        "        dryRun: options.dry_run === true,\n" +
        "        allowDowngrade: options.allow_downgrade === true,\n" +
        "        timeoutMs: options.timeout_ms,\n" +
        "      })\n" +
        "      const action = got && got.action ? String(got.action) : 'failed'\n" +
        "      this.#intelLog({ key: 'cve', action, reason: got && got.reason, bytes: got && got.bytes })\n" +
        "      return Object.assign({ key: 'cve' }, got)\n" +
        "    } catch (error) {\n" +
        "      const msg = String((error && error.message) || error)\n" +
        "      this.#intelLog({ key: 'cve', action: 'failed', error: msg })\n" +
        "      return { key: 'cve', action: 'failed', error: msg }\n" +
        "    }\n" +
        "  }\n" +
        "\n" +
        "  async #updateKev(options = {}) {\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      const out = await store.intelUpdate(req.target || 'all', {\n" +
        "        dry_run: req.dry_run === true, dest: typeof req.dest === 'string' && req.dest ? req.dest : undefined,\n" +
        "      })\n",
      replace:
        "      const out = await store.intelUpdate(req.target || 'all', {\n" +
        "        dry_run: req.dry_run === true, dest: typeof req.dest === 'string' && req.dest ? req.dest : undefined,\n" +
        "        /* cve 底库专用：base 是自托管镜像地址，force 忽略节流与「本地更新」判断 */\n" +
        "        base: typeof req.base === 'string' && req.base ? req.base : undefined,\n" +
        "        force: req.force === true,\n" +
        "        allow_downgrade: req.allow_downgrade === true,\n" +
        "      })\n",
    },
    {
      /* 两个工具（redteam_intel 与 composite 版）各有一份同名参数，锚点必须带上下文区分。 */
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "      target: { type: 'string', description: 'update 时刷哪个：kev / nuclei / all，默认 all' },\n" +
        "      dry_run: { type: 'boolean', description: 'update 时只校验、不落盘' },\n" +
        "    },\n",
      replace:
        "      target: { type: 'string', description: 'update 时刷哪个：kev / nuclei / cve（整库，需配 REDTEAM_INTEL_BASE）/ all，默认 all' },\n" +
        "      dry_run: { type: 'boolean', description: 'update 时只校验、不落盘' },\n" +
        "    },\n",
      count: 2,
    },
    // 代理池工具：与 12 个 op 同一套方法，智能体侧不用自己拼 op 名。
    {
      file: "lib/redteam/tools.js",
      required: true,
      find: "  ctx.tools.register(withStructuredErrors(defineTool({\n    name: 'redteam_engagement_open',",
      replace: SNIP("tools-proxy.js") + "\n  ctx.tools.register(withStructuredErrors(defineTool({\n    name: 'redteam_engagement_open',",
    },

    // toolFilter 的剥离统一交给 safe 那一版。
    // 基座这版只跳「`- ` 开头」和「`deny:`」，`allow:` 会被留下 —— 结果是
    // `toolFilter:` 键没了、它的子键还在 config 里，等于把「整份预设 registered-broken」
    // 换成了「一个未知配置键」。而且它先跑，safe 的 stripDeprecatedToolFilter 就再也
    // 看不到 `toolFilter:`，永远不会触发。
    {
      file: "lib/redteam/index.js",
      required: true,
      find:
        "function repairToolFilter(text) {\n" +
        "  const source = String(text || '');\n" +
        "  if (!source.includes('toolFilter')) return { text: source, changed: false };\n" +
        "  const kept = [];\n" +
        "  let skipping = false;\n" +
        "  for (const line of source.split('\\n')) {\n" +
        "    if (/^\\s*toolFilter:\\s*$/.test(line)) {\n" +
        "      skipping = true;\n" +
        "      continue;\n" +
        "    }\n" +
        "    if (skipping) {\n" +
        "      if (/^\\s*deny:\\s*$/.test(line) || /^\\s*-\\s/.test(line) || line.trim() === '') continue;\n" +
        "      skipping = false;\n" +
        "    }\n" +
        "    kept.push(line);\n" +
        "  }\n" +
        "  return { text: kept.join('\\n'), changed: true };\n" +
        "}\n",
      replace:
        "/**\n" +
        " * [dsh-purge-plus] 剥离 toolFilter —— 统一走 safe 的 stripDeprecatedToolFilter。\n" +
        " *\n" +
        " * 基座这一版按「`- ` 开头」和「`deny:`」判子键，`allow:` 不在其列，于是\n" +
        " * `toolFilter:` 被摘掉、`allow:` 却留在 config 里：从「整份预设 registered-broken」\n" +
        " * 变成「一个未知配置键」，而 safe 的 stripDeprecatedToolFilter 因为看不到\n" +
        " * `toolFilter:` 永远不会触发。两版按缩进跳过的规则必须只有一处。\n" +
        " */\n" +
        "function repairToolFilter(text) {\n" +
        "  return stripDeprecatedToolFilter(text)\n" +
        "}\n",
    },

    // 老预设里的工具包名映射到**本包**坐标。
    // 基座这里写的是 `dsh-purge-community/redteam/tools` —— 那是 community 自己的名字，
    // 在本包里解析不到（包名是 dsh-purge-plus），老用户升级上来后 tools 行会直接失效。
    {
      file: "lib/redteam/index.js",
      required: true,
      count: 2,
      find: "'dsh-purge-community/redteam/tools'",
      replace: "'dsh-purge-plus/redteam/tools'",
    },
    {
      file: "lib/redteam/index.js",
      required: true,
      find: "+ '工具包名已改为 dsh-purge-community/redteam/tools'",
      replace: "+ '工具包名已改为 dsh-purge-plus/redteam/tools'",
    },

    // ══ AE. 预设自愈（safe 2.0.2 lib/redteam/index.js 的 6 段修复）══════════
    // 本包的 apply 原先在「预设已存在」时直接 kept —— 自愈代码存在，但**永远走不到**。
    // 宿主每次升级都会让已部署的红队预设半失效（toolFilter 废弃 / list_agents 子路径
    // 没了 / workflow 行指向不存在的包 / 子代理不许选模型 / 缺 tool-schedule 行）。
    // 下面四步：① 基座那段改名成 Core；② 去掉 list-agents 的强制启用（会与自愈打架）；
    //          ③ 插入 safe 的 6 段 + 组合入口；④ apply 去掉 kept 捷径。
    {
      file: "lib/redteam/index.js",
      required: true,
      find: "function repairDelegation(text) {\n",
      replace: "function repairDelegationCore(text) {\n",
    },
    {
      file: "lib/redteam/index.js",
      required: true,
      find:
        "  for (const id of [\n" +
        "    \"tool-subagent-control\",\n" +
        "    \"tool-subagent-list-agents\",\n" +
        "    \"tool-subagent\",\n" +
        "    \"tool-subagent-fork\",\n" +
        "  ]) {\n",
      replace:
        "  /* [dsh-purge-plus] tool-subagent-list-agents 不在这里强制启用：它的去留由\n" +
        "     disableUnavailableListAgents 按「宿主是否导出该子路径」决定。两处都管会互相\n" +
        "     覆盖，结果是每次启动都报 repaired 并重写一次盘（safe 2.0.2 的原注释）。 */\n" +
        "  for (const id of [\n" +
        "    \"tool-subagent-control\",\n" +
        "    \"tool-subagent\",\n" +
        "    \"tool-subagent-fork\",\n" +
        "  ]) {\n",
    },
    {
      file: "lib/redteam/index.js",
      required: true,
      find: "import { fileURLToPath } from 'node:url'\n",
      replace:
        "import { fileURLToPath } from 'node:url'\n" +
        "/* [dsh-purge-plus] 预设自愈需要按宿主真实安装位置解析包（createRequire）\n" +
        "   与解析可执行文件真实路径（realpathSync） */\n" +
        "import { createRequire } from 'node:module'\n",
    },
    {
      file: "lib/redteam/index.js",
      required: true,
      find: "import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'\n",
      replace: "import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'\n",
    },
    {
      file: "lib/redteam/index.js",
      required: true,
      find: "export function installPreset(options = {}) {\n",
      replace: SNIP("preset-repair.js") + "\nexport function installPreset(options = {}) {\n",
    },
    {
      file: "lib/redteam/index.js",
      required: true,
      find:
        "    const dir = join(userPresetRoot(), 'redteam')\n" +
        "    const exists = existsSync(join(dir, 'agent.cordis.yml')) || existsSync(join(dir, 'preset.yml'))\n" +
        "    if (exists && process.env.REDTEAM_PRESET_REFRESH !== '1') {\n" +
        "      const skills = installBundledSkills()\n" +
        "      result = { action: 'kept', dir, skillsDir: skills.path, skills: skills.copied }\n" +
        "    } else {\n" +
        "      result = installPreset({ force: process.env.REDTEAM_PRESET_REFRESH === '1',\n" +
        "        log: (msg) => ctx.logger?.info?.('redteam-mode: ' + msg) })\n" +
        "    }\n",
      replace:
        "    const dir = join(userPresetRoot(), 'redteam')\n" +
        "    /* [dsh-purge-plus] 不再「已存在就 kept」。installPreset 在非 force 时**只做自愈**\n" +
        "       （占位符 / 工具包名 / toolFilter / 子代理锁模型 / workflow 组合 / 定时行 /\n" +
        "       任务板文案），不整份覆盖用户内容。原先的 kept 捷径让这段自愈永远走不到 ——\n" +
        "       宿主一升级，已部署的预设就半失效，而且没有任何地方会告诉你。\n" +
        "       ctx 传进去：组合修复要读宿主有没有 ptcRuntime 服务（读不到就退回包探测）。 */\n" +
        "    result = installPreset({ force: process.env.REDTEAM_PRESET_REFRESH === '1', ctx,\n" +
        "      log: (msg) => ctx.logger?.info?.('redteam-mode: ' + msg) })\n",
    },

    // ══ AD. 代理池子系统（12 个 op）═══════════════════════════════════
    // safe 2.0.2 的代理池**只有前端**：12 个 op 在它的服务端 dispatch 里一条都不存在，
    // 调用只会得到 `unknown op: proxyPoolGet`（AUDIT-3WAY-R3 §1 有复现）。
    // 所以这一块是从零写的，字段名对齐 safe 前端以便将来直接接它那套界面。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "import { intelSyncStatus, syncIntel } from './intel-sync.js'\n",
      replace:
        "import { intelSyncStatus, syncIntel } from './intel-sync.js'\n" +
        "/* [dsh-purge-plus] 代理配置解析（纯函数，零依赖）：Clash proxies / URI 列表 / base64 订阅 */\n" +
        "import { parseProxyConfig } from './proxy-parse.js'\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "  /* ---------- 路径 ---------- */",
      replace: SNIP("store-proxy.js") + "\n  /* ---------- 路径 ---------- */",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    /* 没选靶标时：提示词回内置默认；只读查询回空结果。不要抛英文 engagement required。 */\n",
      replace: SNIP("store-proxy-ops.js") + "\n    /* 没选靶标时：提示词回内置默认；只读查询回空结果。不要抛英文 engagement required。 */\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "  return dispatch(store, req)\n}",
      replace:
        SNIP("store-safe-alias-async.js") +
        "  /* [dsh-purge-plus] 代理池：要真连 TCP 的 4 个 op。同步 dispatch 里做不了网络等待，\n" +
        "     所以放异步路径；失败一律 ok:false + 原因，不返回「已连接」。 */\n" +
        "  if (req.op === 'proxyProfileTest') {\n" +
        "    try { return Object.assign({ ok: true }, await store.proxyProfileTest(req.id, { timeoutMs: req.timeout_ms })) }\n" +
        "    catch (e) { return { ok: false, error: String((e && e.message) || e) } }\n" +
        "  }\n" +
        "  if (req.op === 'proxyPoolTest') {\n" +
        "    try { return Object.assign({ ok: true }, await store.proxyPoolTest(req.ids, { timeoutMs: req.timeout_ms })) }\n" +
        "    catch (e) { return { ok: false, error: String((e && e.message) || e) } }\n" +
        "  }\n" +
        "  if (req.op === 'proxyProfileConnect') {\n" +
        "    try { return Object.assign({ ok: true }, await store.proxyProfileConnect(req.id, { timeoutMs: req.timeout_ms })) }\n" +
        "    catch (e) { return { ok: false, error: String((e && e.message) || e) } }\n" +
        "  }\n" +
        "  if (req.op === 'proxyPoolConnect') {\n" +
        "    try { return Object.assign({ ok: true }, await store.proxyPoolConnect({ ids: req.ids, timeoutMs: req.timeout_ms })) }\n" +
        "    catch (e) { return { ok: false, error: String((e && e.message) || e) } }\n" +
        "  }\n" +
        "  return dispatch(store, req)\n}",
    },
    // ══ AF. 数据目录铺底（safe 2.0.2 bootstrap-runtime.js）═════════════════
    // 666 行的编排：知识库 DDL、pocs/toolkit、平台配置、nuclei 模板三种协议
    // （git/tar/zip）+ 多镜像回退、CISA KEV 保鲜。
    // 本包把它接成 op：**默认只做本地那半**，下载必须显式 download:true ——
    // 启动不该有不可见的出口动作（与上游 apply 里 background 下载的做法不同）。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "  return dispatch(store, req)\n}",
      replace:
        "  /* [dsh-purge-plus] 数据目录铺底：知识库 DDL / pocs / toolkit / 平台配置，\n" +
        "     可选顺带下载 nuclei 模板（download:true）。默认不联网。 */\n" +
        "  if (req.op === 'runtimeEnsure') {\n" +
        "    try {\n" +
        "      const mod = await import('./bootstrap-runtime.js')\n" +
        "      const report = await mod.ensureRedteamRuntime({\n" +
        "        download: req.download === true,\n" +
        "        timeoutMs: Number(req.timeout_ms) > 0 ? Number(req.timeout_ms) : undefined,\n" +
        "      })\n" +
        "      return Object.assign({ ok: true }, report)\n" +
        "    } catch (e) { return { ok: false, error: String((e && e.message) || e) } }\n" +
        "  }\n" +
        "  return dispatch(store, req)\n}",
    },
    // ══ AG. 尾部锚点 + mnemon 开关（safe 2.0.2 anchor.js / mnemon-settings.js）══
    // anchor.js 需要 identity 的「是不是子会话」判据；基座没有导出它，
    // 只有一份私有的 inheritsParentPrompt（要求有 parentSession，续接会话会误判）。
    {
      file: "lib/identity.js",
      required: true,
      find: "function inheritsParentPrompt(session) {\n",
      replace:
        "/**\n" +
        " * [dsh-purge-plus] 子会话判据（safe 2.0.2 identity.js:476）。\n" +
        " *\n" +
        " * 只认委派来源 / 委派深度，**不看 parentSession** —— 从历史续接/分支出来的会话\n" +
        " * 也带 parentSession，但那种会话自己是根，判成子会话会让它拿不到主锚点。\n" +
        " */\n" +
        "export function isChildAgentContext(context) {\n" +
        "  const header = sessionOfContext(context)?.header\n" +
        "  if (!header) return false\n" +
        "  const origin = String(header.origin || '').toLowerCase()\n" +
        "  if (origin === 'subagent' || origin === 'teammate' || origin === 'delegate') return true\n" +
        "  return (header.delegationDepth ?? 0) > 0\n" +
        "}\n" +
        "\n" +
        "function inheritsParentPrompt(session) {\n",
    },
    // mnemon 开关：identity 默认会把宿主的 mnemon（记忆层）那一段从注入里摘掉，
    // 打开 keepMnemon 就保留它。两处 dropMnemon 都要走同一个开关。
    {
      file: "lib/identity.js",
      required: true,
      find: "import { CAPABILITY_SECTION, capabilityProtocolText } from \"./capability-protocol.js\";\n",
      replace:
        "import { CAPABILITY_SECTION, capabilityProtocolText } from \"./capability-protocol.js\";\n" +
        "/* [dsh-purge-plus] mnemon 开关（safe 2.0.2 mnemon-settings.js） */\n" +
        "import { loadMnemonSettings } from \"./mnemon-settings.js\";\n" +
        "import { findDshHome } from \"./core.js\";\n",
    },
    {
      file: "lib/identity.js",
      required: true,
      find:
        "function normalizeRewriteOptions(fallbackInject, options) {\n" +
        "  if (fallbackInject && typeof fallbackInject === \"object\" && !Array.isArray(fallbackInject)) {\n",
      replace:
        "function normalizeRewriteOptions(fallbackInject, options) {\n" +
        "  /* 设置文件优先：keepMnemon=true 时无论调用方怎么说都保留 mnemon 段。\n" +
        "     读不到就回退调用方的判断（绝不因为设置文件坏掉而改变默认行为）。 */\n" +
        "  let mnemonKeep = null\n" +
        "  try {\n" +
        "    const home = findDshHome()\n" +
        "    if (home) mnemonKeep = loadMnemonSettings(home).keepMnemon\n" +
        "  } catch { /* 回退调用方 */ }\n" +
        "  if (fallbackInject && typeof fallbackInject === \"object\" && !Array.isArray(fallbackInject)) {\n",
    },
    {
      file: "lib/identity.js",
      required: true,
      find: "      dropMnemon: fallbackInject.dropMnemon !== false,\n",
      replace: "      dropMnemon: mnemonKeep === true ? false : (fallbackInject.dropMnemon !== false),\n",
    },
    {
      file: "lib/identity.js",
      required: true,
      find: "    dropMnemon: options?.dropMnemon !== false,\n",
      replace: "    dropMnemon: mnemonKeep === true ? false : (options?.dropMnemon !== false),\n",
    },
    // mnemon 开关的读写 op（面板/工具不用手改 JSON）。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "  return dispatch(store, req)\n}",
      replace:
        "  /* [dsh-purge-plus] mnemon 开关：读/写 $DSH_HOME/dsh-purge-plus/mnemon.json。\n" +
        "     keepMnemon=true 时 identity 的 prompt 改写会保留宿主的 mnemon（记忆层）那一段。 */\n" +
        "  if (req.op === 'mnemonSettings') {\n" +
        "    try {\n" +
        "      const mod = await import('../mnemon-settings.js')\n" +
        "      const home = process.env.DSH_HOME || join(homedir(), '.dsh')\n" +
        "      if (req.keepMnemon === undefined) return Object.assign({ ok: true }, mod.loadMnemonSettings(home))\n" +
        "      return Object.assign({ ok: true }, mod.saveMnemonSettings(home, { keepMnemon: req.keepMnemon === true }))\n" +
        "    } catch (e) { return { ok: false, error: String((e && e.message) || e) } }\n" +
        "  }\n" +
        "  return dispatch(store, req)\n}",
    },
    // ══ AH. savePrompt：漏传 content 不等于「清空」 ══════════════════════
    // safe 2.0.2 审计（R11-safe SF-03）实测：`{op:'savePrompt', engagement, role:'recon'}`
    // 不传 content → `String(content ?? '')` 把 13KB 角色提示词写成 0 字节，
    // 并且 manifest 里那条被删掉 → 此后永远判成「用户自写」，再也不会随版本自动升级。
    // 一次字段名写错就永久毁掉一份提示词，且没有备份。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "  savePrompt(id, role, content) {\n" +
        "    if (!ROLE_TITLES[role]) throw new Error(`unknown role: ${role}`)\n",
      replace:
        "  savePrompt(id, role, content) {\n" +
        "    if (!ROLE_TITLES[role]) throw new Error(`unknown role: ${role}`)\n" +
        "    /* [dsh-purge-plus] 漏传 content ≠ 清空：`undefined` 会把整份角色提示词写成 0 字节，\n" +
        "       并删掉 manifest 里那条，之后永远判成「用户自写」、不再随版本升级。\n" +
        "       要清空请显式传空串。 */\n" +
        "    if (content === undefined) throw new Error('savePrompt 需要 content（要清空请显式传空字符串）')\n",
    },
    // ══ AI. 覆盖度查不出来 ≠ 没有缺口 ══════════════════════════════════
    // 原实现把 hostNextActions / assetNextActions 的异常 catch 成 0，而 coverage_available
    // 仍然是 true。一次表损坏就能让面板与 redteam_attention 同时宣布
    // 「没有人等、也没有队列缺口：这一轮打完了」—— 操作者会提前收工。
    // 实测（R11-ours PL-01）：把 asset_coverage 改名后，pending_coverage 从 1 变 0、note 变成「打完了」。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    const coverage = (() => {\n" +
        "      const fns = ['hostNextActions', 'assetNextActions']\n" +
        "      const present = fns.filter((fn) => typeof this[fn] === 'function')\n" +
        "      if (present.length === 0) return { available: false, pending: 0 }\n" +
        "      let pending = 0\n" +
        "      for (const fn of present) {\n" +
        "        try { pending += Number(this[fn](id, { limit: 1 }).total) || 0 } catch { /* 单个失败不影响另一个 */ }\n" +
        "      }\n" +
        "      return { available: present.length === fns.length, pending }\n" +
        "    })()\n",
      replace:
        "    const coverage = (() => {\n" +
        "      const fns = ['hostNextActions', 'assetNextActions']\n" +
        "      const present = fns.filter((fn) => typeof this[fn] === 'function')\n" +
        "      if (present.length === 0) return { available: false, engine: false, pending: 0, error: '' }\n" +
        "      /* [dsh-purge-plus] 查不出来 ≠ 没有缺口：把失败单独收集，available 跟着变 false。\n" +
        "         单个队列失败不拖累另一个，但整条结论不再声称「收口了」。 */\n" +
        "      let pending = 0\n" +
        "      const errors = []\n" +
        "      for (const fn of present) {\n" +
        "        try { pending += Number(this[fn](id, { limit: 1 }).total) || 0 } catch (e) { errors.push(fn + ': ' + String((e && e.message) || e)) }\n" +
        "      }\n" +
        "      return { available: present.length === fns.length && errors.length === 0, engine: true, pending, error: errors.join('; ') }\n" +
        "    })()\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      ? (coverage.pending > 0\n" +
        "        ? '没有智能体在等人，但还有 ' + coverage.pending + ' 个覆盖度缺口 —— 该派下一个智能体了。'\n" +
        "        : coverage.available\n" +
        "          ? '没有人等、也没有队列缺口：这一轮打完了。'\n" +
        "          : '没有人等。覆盖度引擎未移植，无法判断是否还有缺口 —— 这条结论只覆盖「智能体回报」这一路。')\n",
      replace:
        "      ? (coverage.pending > 0\n" +
        "        ? '没有智能体在等人，但还有 ' + coverage.pending + ' 个覆盖度缺口 —— 该派下一个智能体了。'\n" +
        "        : coverage.available\n" +
        "          ? '没有人等、也没有队列缺口：这一轮打完了。'\n" +
        "          : coverage.engine === false\n" +
        "            ? '没有人等。覆盖度引擎未移植，无法判断是否还有缺口 —— 这条结论只覆盖「智能体回报」这一路。'\n" +
        "            : '没有人等，但**覆盖度查不出来**（' + (coverage.error || '未知错误') + '）：不能据此认为这一轮打完了。')\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "  coveragePending(id) {\n" +
        "    const out = { external: 0, internal: 0, total: 0 }\n" +
        "    try { out.external = Number(this.assetNextActions(id, { limit: 30 }).total) || 0 } catch { out.external = 0 }\n" +
        "    try { out.internal = Number(this.hostNextActions(id, { limit: 30 }).total) || 0 } catch { out.internal = 0 }\n" +
        "    out.total = out.external + out.internal\n" +
        "    return out\n" +
        "  }\n",
      replace:
        "  coveragePending(id) {\n" +
        "    /* [dsh-purge-plus] 同上：把「查不出来」和「没有缺口」分开。\n" +
        "       返回里的 ok=false 时 total 不能当成 0 用。 */\n" +
        "    const out = { external: 0, internal: 0, total: 0, ok: true, error: '' }\n" +
        "    const errors = []\n" +
        "    try { out.external = Number(this.assetNextActions(id, { limit: 30 }).total) || 0 } catch (e) { out.external = 0; errors.push('asset: ' + String((e && e.message) || e)) }\n" +
        "    try { out.internal = Number(this.hostNextActions(id, { limit: 30 }).total) || 0 } catch (e) { out.internal = 0; errors.push('host: ' + String((e && e.message) || e)) }\n" +
        "    out.total = out.external + out.internal\n" +
        "    out.ok = errors.length === 0\n" +
        "    out.error = errors.join('; ')\n" +
        "    return out\n" +
        "  }\n",
    },
    // ══ AJ. 覆盖度：一个定义 + 失败可被 UI 看见 ══════════════════════════
    // 上一笔（AI）只修了 attention 的结论句，还有三处漏的（R11-ours 复核指出）：
    //   (a) 首页卡片读 cov.pending.total，查询失败时仍显示「待办缺口 0」；
    //   (b) attentionQueue 内联重算了一遍 coveragePending，注释说「只有一个定义」是假的；
    //   (c) 只看数字的调用方拿不到「不知道」这个信息。
    // 这一笔把三处一起关掉：coveragePending 加 limit 参数并成为唯一定义，
    // attention 返回里补 coverage_error，卡片按 ok===false 显示「查不出来」。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "  coveragePending(id) {\n" +
        "    /* [dsh-purge-plus] 同上：把「查不出来」和「没有缺口」分开。\n" +
        "       返回里的 ok=false 时 total 不能当成 0 用。 */\n" +
        "    const out = { external: 0, internal: 0, total: 0, ok: true, error: '' }\n" +
        "    const errors = []\n" +
        "    try { out.external = Number(this.assetNextActions(id, { limit: 30 }).total) || 0 } catch (e) { out.external = 0; errors.push('asset: ' + String((e && e.message) || e)) }\n" +
        "    try { out.internal = Number(this.hostNextActions(id, { limit: 30 }).total) || 0 } catch (e) { out.internal = 0; errors.push('host: ' + String((e && e.message) || e)) }\n",
      replace:
        "  coveragePending(id, opts = {}) {\n" +
        "    /* [dsh-purge-plus] 缺口总数的**唯一**定义：首页卡片、attention、工具三处都走这里。\n" +
        "       ok=false 表示「查不出来」，此时 total 不能当成 0 用（UI 要显示「查不出来」）。\n" +
        "       limit 可调：attention 只要 1 条就能拿到 total，卡片要 30 条明细。 */\n" +
        "    const limit = Math.min(Math.max(Number(opts && opts.limit) || 30, 1), 200)\n" +
        "    const out = { external: 0, internal: 0, total: 0, ok: true, error: '' }\n" +
        "    const errors = []\n" +
        "    try { out.external = Number(this.assetNextActions(id, { limit }).total) || 0 } catch (e) { out.external = 0; errors.push('asset: ' + String((e && e.message) || e)) }\n" +
        "    try { out.internal = Number(this.hostNextActions(id, { limit }).total) || 0 } catch (e) { out.internal = 0; errors.push('host: ' + String((e && e.message) || e)) }\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      let pending = 0\n" +
        "      const errors = []\n" +
        "      for (const fn of present) {\n" +
        "        try { pending += Number(this[fn](id, { limit: 1 }).total) || 0 } catch (e) { errors.push(fn + ': ' + String((e && e.message) || e)) }\n" +
        "      }\n" +
        "      return { available: present.length === fns.length && errors.length === 0, engine: true, pending, error: errors.join('; ') }\n",
      replace:
        "      /* 只有一个定义：走 coveragePending（首页卡片读的也是它）。 */\n" +
        "      const cp = this.coveragePending(id, { limit: 1 })\n" +
        "      return { available: cp.ok === true, engine: true, pending: cp.total, error: cp.error }\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      pending_coverage: coverage.pending,\n" +
        "      coverage_available: coverage.available,\n" +
        "      note,\n",
      replace:
        "      pending_coverage: coverage.pending,\n" +
        "      coverage_available: coverage.available,\n" +
        "      /* 查不出来时的原因：让只看数字的调用方也有办法判断「0 是真的 0 还是不知道」 */\n" +
        "      coverage_error: coverage.available ? '' : String(coverage.error || ''),\n" +
        "      note,\n",
    },
    // ══ AL. 把「只改过 dist」的修复收回仓库（构建可复现）══════════════════
    // R11–R14 有一批改动是直接改 dist/build/package 再打包的：装出来的包有，
    // 仓库里没有。重跑一次构建就会静默丢功能（templateOffset / cve 检索 / 补列 /
    // 降级保护 / 原子写 …）。这一段把它们全部收回 edits，构建与已发布包可逐字节对比。
    {
      file: "lib/core.js",
      required: true,
      find:
        "      if (e && e.code === \"EEXIST\") continue;\n" +
        "      errors.push([fp, String(e)]);\n" +
        "      continue;\n",
      replace:
        "      if (e && e.code === \"EEXIST\") {\n" +
        "        /* [dsh-purge-plus] 0 字节 bak = 崩在「占位」与「写入」之间留下的。\n" +
        "           留着它：backupAll 永远 EEXIST 跳过、revertAll 永远读不出内容 ——\n" +
        "           备份形同不存在，而且全程不报错。当成没有备份重写一份。 */\n" +
        "        let size = -1;\n" +
        "        try { size = fs.statSync(bak).size; } catch { size = -1; }\n" +
        "        if (size !== 0) continue;\n" +
        "      } else {\n" +
        "        errors.push([fp, String(e)]);\n" +
        "        continue;\n" +
        "      }\n",
    },
    {
      file: "lib/core.js",
      required: true,
      find:
        "    try { fs.closeSync(placeholderFd); } catch { /* ignore */ }\n",
      replace:
        "    if (placeholderFd !== undefined) { try { fs.closeSync(placeholderFd); } catch { /* ignore */ } }\n",
    },
    {
      file: "lib/core.js",
      required: true,
      find:
        "\n" +
        "export async function revertAll(aiBase, options = {}) {\n",
      replace:
        "\n" +
        "/** [dsh-purge-plus] 当前文件是否还带着本插件写的痕迹（marker 或任意一处 replace 文本）。\n" +
        " *\n" +
        " * 用途：区分「我们打过的文件」与「宿主升级后的原始文件」——两者都可能没有补丁锚点，\n" +
        " * 但只有前者可以安全还原备份。判定不出来时返回 true（保守：宁可不动）。\n" +
        " */\n" +
        "function currentLooksPatched(fp, buf, aiBase) {\n" +
        "  let text\n" +
        "  try { text = asLf(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf)) } catch { return true }\n" +
        "  if (text.includes(DSH_PURGE_MARKER_NEEDLE)) return true\n" +
        "  let files\n" +
        "  try { files = targetFiles(aiBase, findDshHome()) } catch { return true }\n" +
        "  const wanted = path.normalize(fp)\n" +
        "  const keys = []\n" +
        "  for (const [key, value] of Object.entries(files)) {\n" +
        "    for (const cand of Array.isArray(value) ? value : [value]) {\n" +
        "      if (typeof cand === 'string' && cand && path.normalize(cand) === wanted) keys.push(key)\n" +
        "    }\n" +
        "  }\n" +
        "  if (keys.length === 0) return true\n" +
        "  for (const p of ALL_PATCHES) {\n" +
        "    if (!fileKeysOf(p).some((key) => keys.includes(key))) continue\n" +
        "    for (const { replace } of patchReplacements(p)) {\n" +
        "      if (typeof replace === 'string' && replace && text.includes(replace)) return true\n" +
        "    }\n" +
        "  }\n" +
        "  return false\n" +
        "}\n" +
        "\n" +
        "export async function revertAll(aiBase, options = {}) {\n",
    },
    {
      file: "lib/core.js",
      required: true,
      find:
        "  const errors = [];\n" +
        "  restoreMissingOriginalsFromBak(aiBase, {errors});\n",
      replace:
        "  const errors = [];\n" +
        "  /* [dsh-purge-plus] 先刷新过期备份：宿主升级后老 bak 记的是上一版官方文件，\n" +
        "     直接还原等于把新版写回旧版。启动路径一直有这一步，用户触发的三个入口没有。 */\n" +
        "  try { refreshStaleBaksForUpgrade(aiBase); } catch { /* 刷新失败不挡回滚，逐文件错误照报 */ }\n" +
        "  restoreMissingOriginalsFromBak(aiBase, {errors});\n",
    },
    {
      file: "lib/core.js",
      required: true,
      find:
        "  const preservedUser = [];\n" +
        "  const preserveClientBundles = options.preserveClientBundles === true;\n",
      replace:
        "  const preservedUser = [];\n" +
        "  /* [dsh-purge-plus] 被判定成「官方新版，还原会降级」而只丢 bak 的文件 */\n" +
        "  const downgradeBlocked = [];\n" +
        "  const preserveClientBundles = options.preserveClientBundles === true;\n",
    },
    {
      file: "lib/core.js",
      required: true,
      find:
        "        }\n" +
        "        await restoreBackupFile(fp, bak);\n",
      replace:
        "        }\n" +
        "        /* [dsh-purge-plus] 当前文件看起来是**原始官方**（没有我们的 marker，\n" +
        "           也不含任何一处本补丁的替换文本）而 bak 又和它不同 → 宿主升级过了。\n" +
        "           这时候还原就是把新版写回旧版（新旧混码直接崩），只丢掉 bak、不动文件。 */\n" +
        "        if (fs.existsSync(fp) && !currentLooksPatched(fp, fs.readFileSync(fp), aiBase)) {\n" +
        "          await fsp.unlink(bak);\n" +
        "          downgradeBlocked.push(fp);\n" +
        "          continue;\n" +
        "        }\n" +
        "        await restoreBackupFile(fp, bak);\n",
    },
    {
      file: "lib/core.js",
      required: true,
      find:
        "  return { reverted, skipped, preservedUser, dropped, errors };\n",
      replace:
        "  return { reverted, skipped, preservedUser, dropped, downgradeBlocked, errors };\n",
    },
    {
      file: "lib/core.js",
      required: true,
      find:
        "// A deletion leaves no marker. Replay it on the original backup to verify older installs too.\n" +
        "function deletionStatus(text, patch, fp) {\n",
      replace:
        "// A deletion leaves no marker. Replay it on the original backup to verify older installs too.\n" +
        "/** [dsh-purge-plus] 备份里是否还有这个补丁的锚点。\n" +
        " *\n" +
        " *  有 → 说明这份代码本来是应该被改的，现在没了 = 被升级覆盖（drifted）。\n" +
        " *  没有 → 这个宿主版本本来就没有这段代码，跳过是对的。\n" +
        " * 没有备份（从未打过）一律按「没有」处理，避免把新装宿主报成漂移。 */\n" +
        "function backupHadAnchor(fp, patch) {\n" +
        "  const bak = fp + BAK_SUFFIX\n" +
        "  try {\n" +
        "    if (!fs.lstatSync(bak).isFile()) return false\n" +
        "    const original = fs.readFileSync(bak, 'utf8')\n" +
        "    if (!original.length) return false\n" +
        "    return patchHasRemainingWork(original, patch, fp)\n" +
        "  } catch { return false }\n" +
        "}\n" +
        "\n" +
        "function deletionStatus(text, patch, fp) {\n",
    },
    {
      file: "lib/core.js",
      required: true,
      find:
        "    let notFound = 0;\n" +
        "    let lastError = null;\n",
      replace:
        "    let notFound = 0;\n" +
        "    let drifted = 0;\n" +
        "    let lastError = null;\n",
    },
    {
      file: "lib/core.js",
      required: true,
      find:
        "          notFound += 1;\n" +
        "        }\n",
      replace:
        "          notFound += 1;\n" +
        "        } else if (backupHadAnchor(fp, p)) {\n" +
        "          /* [dsh-purge-plus] 备份里有锚点、现在没了 = 我们打过的代码被升级覆盖。\n" +
        "             这是 drifted，不是 skipped —— skipped 是软成功，会把漂移藏起来。 */\n" +
        "          drifted += 1;\n" +
        "        }\n",
    },
    {
      file: "lib/core.js",
      required: true,
      find:
        "      applied, already, missing, notFound, lastError, keyCount: keys.length,\n",
      replace:
        "      applied, already, missing, notFound, drifted, lastError, keyCount: keys.length,\n",
    },
    {
      file: "lib/core.js",
      required: true,
      find:
        "  const handle = await nodeFs.promises.open(fp, \"w\");\n",
      replace:
        "  /* [dsh-purge-plus] 原子写：直接 open(fp,\"w\") 会先把文件截成 0 字节，\n" +
        "     崩在 writeFile 之前/之中就把用户提示词清空了（磁盘满、进程被杀都能触发）。\n" +
        "     先写同目录临时文件再 rename —— 与这个文件里其它写路径一致。 */\n" +
        "  const tmpPath = fp + '.tmp-' + process.pid + '-' + Date.now();\n" +
        "  const handle = await nodeFs.promises.open(tmpPath, \"w\");\n",
    },
    {
      file: "lib/core.js",
      required: true,
      find:
        "  } finally {\n" +
        "    await handle.close();\n",
      replace:
        "  } catch (error) {\n" +
        "    try { await handle.close(); } catch { /* 已关 */ }\n" +
        "    try { await nodeFs.promises.unlink(tmpPath); } catch { /* 没建出来 */ }\n" +
        "    throw error;\n",
    },
    {
      file: "lib/core.js",
      required: true,
      find:
        "  }\n" +
        "  rememberCommittedOverride(home, incoming);\n",
      replace:
        "  }\n" +
        "  await handle.close();\n" +
        "  await nodeFs.promises.rename(tmpPath, fp);\n" +
        "  rememberCommittedOverride(home, incoming);\n",
    },
    {
      file: "lib/core/verify.mjs",
      required: true,
      find:
        "export function rollupPatchStatus({ applied, already, missing, notFound, lastError, keyCount, layoutSoft, strictFiles, requireAllTargets }) {\n",
      replace:
        "export function rollupPatchStatus({ applied, already, missing, notFound, drifted = 0, lastError, keyCount, layoutSoft, strictFiles, requireAllTargets }) {\n",
    },
    {
      file: "lib/core/verify.mjs",
      required: true,
      find:
        "  if (requireAllTargets && missing > 0 && missing < keyCount) return \"partial\";\n" +
        "  if (applied > 0) return \"applied\";\n",
      replace:
        "  if (requireAllTargets && missing > 0 && missing < keyCount) return \"partial\";\n" +
        "  /* [dsh-purge-plus] 多目标补丁：一个目标打上、另一个漂移，整条只能是 partial。\n" +
        "     先于 applied 判，否则「一个文件命中 = 整条 applied」会把漂移吞掉（CM-03）。 */\n" +
        "  if (applied > 0 && drifted > 0) return \"partial\";\n" +
        "  if (applied > 0) return \"applied\";\n",
    },
    {
      file: "lib/core/verify.mjs",
      required: true,
      find:
        "  if (lastError) return lastError;\n" +
        "  // 文件在，但这份原文不在：列表里本来就是跳过，不能再把整次应用判失败。\n",
      replace:
        "  if (lastError) return lastError;\n" +
        "  /* [dsh-purge-plus] 备份里有过锚点、现在没了 = 漂移，不能报成 skipped（软成功）。 */\n" +
        "  if (drifted > 0) return \"drifted\";\n" +
        "  // 文件在，但这份原文不在：列表里本来就是跳过，不能再把整次应用判失败。\n",
    },
    {
      file: "lib/reapply.js",
      required: true,
      find:
        "  return !Object.values(status).some((row) => row === \"pending\" || row === \"unmatched\");\n",
      replace:
        "  /* [dsh-purge-plus] drifted 也算「没清洗干净」：它的语义就是「补丁痕迹还在、锚点却烂了」。\n" +
        "     漏掉它会让第一次漂移被永久固化 —— 盖上 applied 戳之后每次启动都不再 reapply。 */\n" +
        "  return !Object.values(status).some((row) => row === \"pending\" || row === \"unmatched\" || row === \"drifted\");\n",
    },
    {
      file: "lib/redteam/cve-db.js",
      required: true,
      find:
        "    where.push(\"cves LIKE ? ESCAPE '\\\\'\"); args.push('%' + cve + '%')\n",
      replace:
        "    /* [dsh-purge-plus] 必须走 likePattern：SQL 带 ESCAPE，裸拼 %cve% 时\n" +
        "       值里的 % / _ 会被当通配符，反斜杠会让整条语句报错（一个坏值炸掉整批导入）。 */\n" +
        "    where.push(\"cves LIKE ? ESCAPE '\\\\'\"); args.push(likePattern(cve))\n",
    },
    {
      file: "lib/redteam/platform-config.js",
      required: true,
      find:
        "    return {\n",
      replace:
        "    /* [dsh-purge-plus] 先铺开原始 JSON，再用规范化后的已知字段覆盖。\n" +
        "       否则 templatesRefreshedAt 这类「表外但重要」的键在读这一步就丢了。 */\n" +
        "    return Object.assign({}, raw, {\n",
    },
    {
      file: "lib/redteam/platform-config.js",
      required: true,
      find:
        "      exists: true,\n" +
        "    }\n" +
        "  } catch (error) {\n",
      replace:
        "      exists: true,\n" +
        "    })\n" +
        "  } catch (error) {\n",
    },
    {
      file: "lib/redteam/platform-config.js",
      required: true,
      find:
        "  const next = {\n",
      replace:
        "  /* [dsh-purge-plus] 先铺开旧配置，再覆盖已知字段：\n" +
        "     表外的键（templatesRefreshedAt / templatesCount / templatesCommit /\n" +
        "     templatesLastError …）必须原样留下，否则面板保存一次就把模板保鲜状态冲掉。 */\n" +
        "  const next = Object.assign({}, prev, {\n",
    },
    {
      file: "lib/redteam/platform-config.js",
      required: true,
      find:
        "  /* 用户在环境适配里保存/文件夹分配过一次 */\n" +
        "  envAdaptConfigured: false,\n",
      replace:
        "  /* [dsh-purge-plus] 模板保鲜的四个键必须是**默认值的一部分**，不能只在用户刷新过\n" +
        "     之后才出现。safe 的 EMPTY() 就带这四个键，于是 platformConfigGet().config 的\n" +
        "     键集是稳定的；我们缺了它们，按 safe 写的调用方（读 cfg.templatesCount）在新机器上\n" +
        "     拿到 undefined，环境适配页只能显示「未安装」而不是「0 个」。\n" +
        "     只做提示与节流，不参与任何判定 —— 读不到就是 0，不影响开工。 */\n" +
        "  templatesRefreshedAt: 0,\n" +
        "  templatesCommit: '',\n" +
        "  templatesCount: 0,\n" +
        "  templatesLastError: '',\n" +
        "  /* 用户在环境适配里保存/文件夹分配过一次 */\n" +
        "  envAdaptConfigured: false,\n",
    },
    {
      file: "lib/redteam/platform-config.js",
      required: true,
      find:
        "    envAdaptConfigured: patch.envAdaptConfigured !== undefined\n" +
        "      ? !!patch.envAdaptConfigured\n" +
        "      : !!prev.envAdaptConfigured,\n" +
        "    updated_at: new Date().toISOString(),\n",
      replace:
        "    envAdaptConfigured: patch.envAdaptConfigured !== undefined\n" +
        "      ? !!patch.envAdaptConfigured\n" +
        "      : !!prev.envAdaptConfigured,\n" +
        "    /* [dsh-purge-plus] 模板保鲜四个键必须**显式**写进来。\n" +
        "       它们现在是 EMPTY() 的默认键，于是 save 的「表外键兜底」循环里\n" +
        "       `!(k in next)` 恒假（next 继承自 prev 已有该键），patch 里的新值\n" +
        "       永远落不了盘 —— 刷新完模板，计数仍是 0。 */\n" +
        "    templatesRefreshedAt: patch.templatesRefreshedAt === undefined\n" +
        "      ? (Number(prev.templatesRefreshedAt) || 0)\n" +
        "      : (Number(patch.templatesRefreshedAt) || 0),\n" +
        "    templatesCount: patch.templatesCount === undefined\n" +
        "      ? (Number(prev.templatesCount) || 0)\n" +
        "      : (Number(patch.templatesCount) || 0),\n" +
        "    templatesCommit: patch.templatesCommit === undefined\n" +
        "      ? String(prev.templatesCommit || '')\n" +
        "      : String(patch.templatesCommit || ''),\n" +
        "    templatesLastError: patch.templatesLastError === undefined\n" +
        "      ? String(prev.templatesLastError || '')\n" +
        "      : String(patch.templatesLastError || ''),\n" +
        "    updated_at: new Date().toISOString(),\n",
    },
    {
      file: "lib/redteam/platform-config.js",
      required: true,
      find:
        "    updated_at: new Date().toISOString(),\n" +
        "  }\n",
      replace:
        "    updated_at: new Date().toISOString(),\n" +
        "  })\n" +
        "  /* 表外键也要从 patch 里带过来（templatesRefreshedAt 这类由 bootstrap-runtime 写入、\n" +
        "     面板并不认识，但必须在保存后仍然存在）。 */\n" +
        "  for (const [k, v] of Object.entries(patch && typeof patch === 'object' ? patch : {})) {\n" +
        "    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue\n" +
        "    if (!(k in next)) next[k] = v\n" +
        "  }\n" +
        "  /* [dsh-purge-plus] 元字段不进配置文件：path / exists / error 是 load 时给调用方\n" +
        "     看的，不是配置。它们随 prev 一起被 Object.assign 带进来，于是每次保存都把\n" +
        "     「上次那条错误」写回磁盘 —— 清不掉，且下次 load 又原样读回来（R21 审计 RB-08）。 */\n" +
        "  delete next.path\n" +
        "  delete next.exists\n" +
        "  delete next.error\n",
    },
    {
      file: "lib/redteam/schema.js",
      required: true,
      find:
        "  summary TEXT,\n" +
        "  created_at TEXT,\n",
      replace:
        "  summary TEXT,\n" +
        "  /* [dsh-purge-plus] 子智能体回报里点名的任务 id（team_task_id / task_id）。\n" +
        "     team-board.js 用它做精确匹配；没有这一列就只能启发式猜。 */\n" +
        "  team_task_id TEXT,\n" +
        "  created_at TEXT,\n",
    },
    {
      file: "lib/redteam/schema.js",
      required: true,
      find:
        "CREATE INDEX IF NOT EXISTS ix_cleanup_asset ON cleanup_item(asset_id);\n",
      replace:
        "/* [dsh-purge-plus] 这个索引不能写在 DDL 常量里：老库的 cleanup_item 可能没有\n" +
        "   asset_id 列，IF NOT EXISTS 只保护索引不保护列，建索引会整段抛错。\n" +
        "   挪到 migrate 的补列之后建（见下方 ensure 段）。 */\n",
    },
    {
      file: "lib/redteam/schema.js",
      required: true,
      find:
        "  ensure('agent_report', 'acknowledged_at', 'TEXT')\n" +
        "  /* 覆盖度三表：新库由 DDL 建好，老库（先装 community/safe 再换本包）这里补建。\n",
      replace:
        "  ensure('agent_report', 'acknowledged_at', 'TEXT')\n" +
        "  ensure('agent_report', 'team_task_id', 'TEXT')\n" +
        "  /* 覆盖度三表：新库由 DDL 建好，老库（先装 community/safe 再换本包）这里补建。\n",
    },
    {
      file: "lib/redteam/schema.js",
      required: true,
      find:
        "    ensure('cleanup_item', 'location', 'TEXT')\n" +
        "    db.exec(`CREATE TABLE IF NOT EXISTS data_proof (\n",
      replace:
        "    ensure('cleanup_item', 'location', 'TEXT')\n" +
        "    /* [dsh-purge-plus] safe 的 cleanup_item 只有 9 列。除了 location，还缺这 5 列；\n" +
        "       少一列，对应的写入/索引就会在「老库」上整条失败。ensure 自带「有这列就跳过」。 */\n" +
        "    for (const [col, type] of [\n" +
        "      ['asset_id', 'INTEGER'], ['title', 'TEXT'], ['evidence_ref', 'TEXT'],\n" +
        "      ['priority', 'TEXT'], ['updated_by', 'TEXT'],\n" +
        "    ]) ensure('cleanup_item', col, type)\n" +
        "    /* 列补齐之后才建索引 —— 顺序反了就是 PA-01。 */\n" +
        "    db.exec('CREATE INDEX IF NOT EXISTS ix_cleanup_asset ON cleanup_item(asset_id)')\n" +
        "    db.exec(`CREATE TABLE IF NOT EXISTS data_proof (\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      const q = req.q || req.query || req.cve || req.component || ''\n" +
        "      const templates = q\n",
      replace:
        "      const q = req.q || req.query || req.cve || req.component || ''\n" +
        "      /* [dsh-purge-plus] templateOffset 必须传下去：面板翻页参数一直在发，\n" +
        "         丢掉的后果是「下一页」永远是同一页，而返回 ok:true 看不出来。 */\n" +
        "      const tplOffset = Math.max(Number(req.templateOffset) || 0, 0)\n" +
        "      const templates = q\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "        ? store.searchTemplates(q, Math.min(Number(req.templateLimit) || 20, 100))\n",
      replace:
        "        ? store.searchTemplates(q, Math.min(Number(req.templateLimit) || 20, 100), tplOffset)\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    if (op === 'templateSearch') return Object.assign({ ok: true }, store.searchTemplates(req.q, Math.min(Number(req.limit) || 40, 200)))\n",
      replace:
        "    if (op === 'templateSearch') {\n" +
        "      /* [dsh-purge-plus] cve 与 q 同义（模板库的 haystack 已含 cves 列）：\n" +
        "         只认 q 的话，调用方传 {cve:'CVE-…'} 会拿到全库 14441 条，看着像「搜到了」。 */\n" +
        "      const tq = req.q || req.cve || ''\n" +
        "      const toff = Math.max(Number(req.offset) || 0, 0)\n" +
        "      return Object.assign({ ok: true }, store.searchTemplates(tq, Math.min(Number(req.limit) || 40, 200), toff))\n" +
        "    }\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      return Object.assign({ ok: true }, store.proxyPoolImport(typeof req.yaml === 'string' ? req.yaml : '', { replace: req.replace === true }))\n",
      replace:
        "      const imported = store.proxyPoolImport(typeof req.yaml === 'string' ? req.yaml : '', { replace: req.replace === true })\n" +
        "      /* [dsh-purge-plus] ok 要反映「有没有真的导进来」：空配置或全部重复时\n" +
        "         原先也回 ok:true，面板会显示「已加入 0 个节点」像是成功了。\n" +
        "         warnings 里已经逐条说明原因。 */\n" +
        "      return Object.assign({}, imported, { ok: imported.importedCount > 0 })\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    if (op === 'asset') return { ok: true, asset: store.getAsset(id, req.id) }\n",
      replace:
        "    if (op === 'asset') {\n" +
        "      /* [dsh-purge-plus] 查不到必须 ok:false：`{ok:true, asset:undefined}` 序列化后\n" +
        "         就是 `{ok:true}`，和「查到了但没字段」同形，调用方分不出来。 */\n" +
        "      const one = store.getAsset(id, req.id)\n" +
        "      return one ? { ok: true, asset: one } : { ok: false, error: 'asset not found: ' + String(req.id) }\n" +
        "    }\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      }\n" +
        "      if (obj.status === undefined) return null\n",
      replace:
        "      }\n" +
        "      /* [dsh-purge-plus] 回报可以点名自己在做哪张任务卡（safe 2.0.2 同款两种写法） */\n" +
        "      const taskRef = field('team_task_id') ?? field('task_id')\n" +
        "      if (taskRef !== undefined) obj.team_task_id = taskRef\n" +
        "      if (obj.status === undefined) return null\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      needs,\n" +
        "    }\n",
      replace:
        "      needs,\n" +
        "      /* 空串按「没点名」处理：写进库的是 NULL，不是 ''，否则精确匹配会拿空串去比 */\n" +
        "      team_task_id: typeof (obj.team_task_id ?? obj.task_id) === 'string'\n" +
        "        ? ((obj.team_task_id ?? obj.task_id).trim() || undefined) : undefined,\n" +
        "    }\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    db.prepare('INSERT INTO agent_report(session_id, parent_session, role, label, status, blocked_reason, needs, summary, created_at) ' +\n" +
        "      'VALUES(?,?,?,?,?,?,?,?,?)').run(\n",
      replace:
        "    db.prepare('INSERT INTO agent_report(session_id, parent_session, role, label, status, blocked_reason, needs, summary, team_task_id, created_at) ' +\n" +
        "      'VALUES(?,?,?,?,?,?,?,?,?,?)').run(\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      f.summary === undefined || f.summary === null ? null : String(f.summary).slice(0, 2000),\n" +
        "      nowIso(),\n",
      replace:
        "      f.summary === undefined || f.summary === null ? null : String(f.summary).slice(0, 2000),\n" +
        "      typeof f.team_task_id === 'string' ? (f.team_task_id.trim() || null) : null,\n" +
        "      nowIso(),\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200)\n" +
        "    const rows = db.prepare(\n",
      replace:
        "    const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200)\n" +
        "    /* [dsh-purge-plus] byTask：按「会话 + 任务」分组取最新一条。\n" +
        "       一个子智能体可能先后报两张卡，只按会话分组会把前一张卡的回报吃掉。 */\n" +
        "    const group = opts.byTask === true ? \"session_id, COALESCE(team_task_id, '')\" : 'session_id'\n" +
        "    const rows = db.prepare(\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      'JOIN (SELECT session_id, MAX(id) AS max_id FROM agent_report WHERE parent_session = ? GROUP BY session_id) m ' +\n",
      replace:
        "      'JOIN (SELECT ' + group + ' AS gk, MAX(id) AS max_id FROM agent_report WHERE parent_session = ? GROUP BY ' + group + ') m ' +\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      + \" ORDER BY CASE COALESCE(a.priority,'medium') WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, a.id ASC LIMIT 400\").all(...args)\n" +
        "    const actions = []\n" +
        "    for (const a of rows) {\n" +
        "      if (scopeOfIp(a.ip) !== 'internal') continue\n",
      replace:
        "      + \" ORDER BY CASE COALESCE(a.priority,'medium') WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, a.id ASC LIMIT 400\").all(...args)\n" +
        "    const actions = []\n" +
        "    /* [dsh-purge-plus] abandoned（被封 >3 次）与 no_surface（已判定没面）不该再进队列：\n" +
        "       提示词里明确写「直接跳过」，队列却把它们排在前面，等于让模型反复去啃已放弃的主机。 */\n" +
        "    const SKIP_STATUS = new Set(['abandoned', 'no_surface'])\n" +
        "    for (const a of rows) {\n" +
        "      if (scopeOfIp(a.ip) !== 'internal') continue\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      if (scopeOfIp(a.ip) !== 'internal') continue\n" +
        "      let cov\n",
      replace:
        "      if (scopeOfIp(a.ip) !== 'internal') continue\n" +
        "      if (SKIP_STATUS.has(String(a.test_status || ''))) continue\n" +
        "      let cov\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    const title = String(item.title === undefined || item.title === null ? '' : item.title).trim()\n" +
        "    if (title === '') throw new Error('title 不能为空：清理项必须一句话说清要删什么')\n",
      replace:
        "    /* [dsh-purge-plus] 缺 title 不再抛错，按 kind/target/location 生成一句。\n" +
        "       safe 2.0.2 只要求 kind，从 safe 迁移过来的调用方一律不带 title；\n" +
        "       硬抛等于让它们全部失败。生成的是**可读**标题，不是空占位。 */\n" +
        "    let title = String(item.title === undefined || item.title === null ? '' : item.title).trim()\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    const location = String(item.location === undefined || item.location === null ? '' : item.location).trim()\n" +
        "    /* 同 kind + 同 target + **同 location** + 还没收口的才算重复。\n",
      replace:
        "    const location = String(item.location === undefined || item.location === null ? '' : item.location).trim()\n" +
        "    if (title === '') {\n" +
        "      const where2 = [target, location].filter((v) => v !== '').join(' ')\n" +
        "      title = `${kind}${where2 ? ' @ ' + where2 : ''}（自动生成）`\n" +
        "    }\n" +
        "    /* 同 kind + 同 target + **同 location** + 还没收口的才算重复。\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    } catch (e) { rows = []; queryError = String((e && e.message) || e) }\n" +
        "    const byStatus = { open: 0, done: 0, wontfix: 0 }\n",
      replace:
        "    } catch (e) { rows = []; queryError = String((e && e.message) || e) }\n" +
        "    /* [dsh-purge-plus] total 用 COUNT(*)：rows 带了 LIMIT，拿它的长度当总数\n" +
        "       会让「超过一页」的清单永远翻不到第二页（3 条 limit=2 时报 total 2）。 */\n" +
        "    let total = rows.length\n" +
        "    if (queryError === null) {\n" +
        "      try {\n" +
        "        total = Number(db.prepare('SELECT COUNT(*) AS n FROM cleanup_item'\n" +
        "          + (where.length ? ' WHERE ' + where.join(' AND ') : '')).get(...args).n) || 0\n" +
        "      } catch { total = rows.length }\n" +
        "    }\n" +
        "    /* [dsh-purge-plus] 统计口径是**筛选后全量**，不是当前这一页：\n" +
        "       rows 带 LIMIT，按它算 by_status 会让第 2 页显示 0；\n" +
        "       而 cleared 更不能按筛选算 —— 只看 status=done 时 open 恒为 0，\n" +
        "       于是「还有 20 条没删」也会被报成「已清干净」。 */\n" +
        "    const byStatus = { open: 0, done: 0, wontfix: 0 }\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    for (const r of rows) {\n" +
        "      if (byStatus[r.status] !== undefined) byStatus[r.status] += 1\n" +
        "      byKind[r.kind] = (byKind[r.kind] || 0) + 1\n",
      replace:
        "    let openTotal = null\n" +
        "    if (queryError === null) {\n" +
        "      try {\n" +
        "        /* 统计用**整表**、不带筛选：它和 cleared 是同一句结论的两半，\n" +
        "           一个带筛选一个不带，会出现「by_status.open=0 但 cleared=false」的自相矛盾。 */\n" +
        "        const agg = db.prepare('SELECT status, kind, COUNT(*) AS n FROM cleanup_item GROUP BY status, kind').all()\n" +
        "        for (const r of agg) {\n" +
        "          if (byStatus[r.status] !== undefined) byStatus[r.status] += Number(r.n) || 0\n" +
        "          byKind[r.kind] = (byKind[r.kind] || 0) + (Number(r.n) || 0)\n" +
        "        }\n" +
        "      } catch { /* 聚合失败就留空，不假装 0 */ }\n" +
        "      try { openTotal = Number(db.prepare(\"SELECT COUNT(*) AS n FROM cleanup_item WHERE status = 'open'\").get().n) || 0 } catch { openTotal = null }\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      total: rows.length,\n",
      replace:
        "      total,\n" +
        "      returned: rows.length,\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      cleared: queryError === null ? byStatus.open === 0 : null,\n",
      replace:
        "      cleared: queryError === null && openTotal !== null ? openTotal === 0 : null,\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    const before = Object.assign({}, state.policy)\n" +
        "    state.policy = {\n",
      replace:
        "    const before = Object.assign({}, state.policy)\n" +
        "    /* [dsh-purge-plus] 只改调用方**真的给过**的字段。\n" +
        "       无条件按 `=== true` 取值，会让「只调超时」把连接开关和引擎路径一起清空 ——\n" +
        "       面板上表现为「保存超时后自动连接自己关了」，而且返回 ok:true。 */\n" +
        "    const has = (k) => Object.prototype.hasOwnProperty.call(settings, k)\n" +
        "    state.policy = {\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      enabled: settings.enabled === true,\n" +
        "      autoConnect: settings.autoConnect === true,\n",
      replace:
        "      enabled: has('enabled') ? settings.enabled === true : state.policy.enabled,\n" +
        "      autoConnect: has('autoConnect') ? settings.autoConnect === true : state.policy.autoConnect,\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      enginePath: String(settings.enginePath || '').trim(),\n",
      replace:
        "      enginePath: has('enginePath') ? String(settings.enginePath || '').trim() : state.policy.enginePath,\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    if (String(options.layout || '') === 'simple') {\n",
      replace:
        "    /* [dsh-purge-plus] 默认 simple：与 safe 2.0.2 一致。legacy 仍可用 layout:'legacy' 显式要。 */\n" +
        "    if (String(options.layout || 'simple') !== 'legacy') {\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "          && Number(cached.v || 0) === 2 /* [dsh-purge-plus] 过滤规则变了要重建 */\n",
      replace:
        "          && Number(cached.v || 0) === 3 /* [dsh-purge-plus] 过滤规则变了要重建 */\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "        if (!/\\.ya?ml$/i.test(e.name)) continue\n" +
        "        let head = ''\n",
      replace:
        "        if (!/\\.ya?ml$/i.test(e.name)) continue\n" +
        "        /* 整份读：只看前 2000 字节会丢掉 info 块后半段的 metadata，\n" +
        "           也会漏掉只在 examples/description 里出现的 CVE 编号（safe 2.0.2 同口径）。 */\n" +
        "        let full = ''\n" +
        "        try { full = readFileSync(join(base, next), 'utf8') } catch { continue }\n" +
        "        /* [dsh-purge-plus] 没有顶层 id 的不是 nuclei 模板（.github/workflows 之类） */\n" +
        "        if (!/^\\s*id:\\s*\\S+/m.test(full)) continue\n" +
        "        /* 优先在 info: 块里找字段；找不到再退回整份（有些模板把 name 写在别处）。 */\n" +
        "        const infoStart = /^info:\\s*\\n/m.exec(full)\n" +
        "        let head = ''\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "        try { head = readFileSync(join(base, next), 'utf8').slice(0, 2000) } catch { continue }\n" +
        "        /* [dsh-purge-plus] 没有顶层 id 的不是 nuclei 模板（.github/workflows 之类） */\n" +
        "        if (!/^\\s*id:\\s*\\S+/m.test(head)) continue\n" +
        "        const pick = (re) => { const m = re.exec(head); return m === null ? '' : String(m[1]).trim().replace(/^[\"']|[\"']$/g, '') }\n",
      replace:
        "        if (infoStart) {\n" +
        "          const rest = full.slice(infoStart.index + infoStart[0].length)\n" +
        "          const nextTop = rest.search(/^\\S/m)\n" +
        "          head = nextTop >= 0 ? rest.slice(0, nextTop) : rest\n" +
        "        } else {\n" +
        "          head = full\n" +
        "        }\n" +
        "        const pick = (re) => {\n" +
        "          const m = re.exec(head) || re.exec(full)\n" +
        "          return m === null ? '' : String(m[1]).trim().replace(/^[\"']|[\"']$/g, '')\n" +
        "        }\n" +
        "        /* CVE 编号：文件名 + 整份正文都扫，大写归一。这是「按 CVE 找模板」的唯一依据。 */\n" +
        "        const cves = new Set()\n" +
        "        for (const cve of (e.name + '\\n' + full).match(/CVE-\\d{4}-\\d{4,7}/gi) || []) cves.add(cve.toUpperCase())\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "          pick(/^\\s*tags:\\s*(.+)$/m),\n" +
        "        ])\n",
      replace:
        "          pick(/^\\s*tags:\\s*(.+)$/m),\n" +
        "          [...cves].join(' '),\n" +
        "        ])\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      writeFileSync(cachePath, JSON.stringify({ v: 2, built_at: Date.now(), dir, items }), 'utf8')\n",
      replace:
        "      writeFileSync(cachePath, JSON.stringify({ v: 3, built_at: Date.now(), dir, items }), 'utf8')\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    const cve = items.filter((x) => /cve-\\d{4}-\\d+/i.test(x[0])).length\n",
      replace:
        "    /* [dsh-purge-plus] cve 的口径与 safe 对齐：有 CVE 列的模板数（不是「文件名里有 CVE」）。\n" +
        "       另外给 cve_ids = 去重后的编号个数，面板用它显示「覆盖多少个 CVE」。 */\n" +
        "    const cve = items.filter((x) => String(x[4] || '') !== '').length\n" +
        "    const cveIdSet = new Set()\n" +
        "    for (const item of items) for (const id of String(item[4] || '').split(/\\s+/)) if (id) cveIdSet.add(id)\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    return { dir: dir || null, total: items.length, cve, byCategory }\n",
      replace:
        "    return { dir: dir || null, total: items.length, cve, cve_ids: cveIdSet.size, byCategory }\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    for (const [path, name, severity, tags] of items) {\n",
      replace:
        "    for (const [path, name, severity, tags, cves] of items) {\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      if (needle && !(path + ' ' + name + ' ' + tags).toLowerCase().includes(needle)) continue\n" +
        "      out.push({ path, name, severity, tags })\n",
      replace:
        "      /* [dsh-purge-plus] haystack 必须含 cves 列（safe 2.0.2 同口径）：\n" +
        "         否则「按 CVE 编号找模板」只能命中文件名里恰好带编号的那几条。 */\n" +
        "      if (needle && !(path + ' ' + name + ' ' + tags + ' ' + String(cves || '')).toLowerCase().includes(needle)) continue\n" +
        "      out.push({ path, name, severity, tags, cves: String(cves || '') })\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "                needs: parsed.needs,\n" +
        "                summary: reportText.slice(-1500),\n",
      replace:
        "                needs: parsed.needs,\n" +
        "                team_task_id: parsed.team_task_id,\n" +
        "                summary: reportText.slice(-1500),\n",
    },
    // ══ AK. 无靶标口径 / 并发闸门回报契约 / 清理清单翻页（R15）══════════════
    // 三条都是「返回 ok:true、数字看着正常，错在语义」的形状，
    // 每条都配了能构造故障的回归（scripts/mutate-check.mjs 会把它改坏一次）。
    {
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "const text = (value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]\n",
      replace:
        "const text = (value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]\n" +
        "\n" +
        "/**\n" +
        " * 没有靶标时的统一回执。\n" +
        " *\n" +
        " * 口径必须与 op 层（store-core `dispatch` 的无靶标分支）一致：`ok:false` + `no_target:true`。\n" +
        " * 工具层此前对 11 个只读工具返回 `ok:true, note:'还没有靶标'` —— 模型看到成功、看到空数组，\n" +
        " * 会当成「这个靶标确实没有数据」继续往下走，而不是「我还没选靶标」。\n" +
        " *\n" +
        " * 这条分支正常不可达（`resolveEngagement` 会先抛），留着是为了解析器将来一旦改成\n" +
        " * 「返回空串表示没靶标」，失败要响亮而不是静默。\n" +
        " */\n" +
        "function noTarget(extra) {\n" +
        "  return JSON.stringify(Object.assign({\n" +
        "    ok: false,\n" +
        "    no_target: true,\n" +
        "    error: '还没有靶标：先 redteam_engagement_open 新建/打开，或 redteam_session_bind 绑定已有靶标。',\n" +
        "  }, extra || {}), null, 2)\n" +
        "}\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "      if (!bound) return JSON.stringify({ ok: true, total: 0, awaiting_person: 0, items: [], pending_coverage: 0, coverage_available: false, note: '还没有靶标' }, null, 2)\n",
      replace:
        "      if (!bound) return noTarget({ total: 0, awaiting_person: 0, items: [], pending_coverage: 0, coverage_available: false })\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      count: 4,
      find:
        "      if (!t.id) return JSON.stringify({ ok: true, note: '还没有靶标' }, null, 2)\n",
      replace:
        "      if (!t.id) return noTarget()\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "      if (!t.id) return JSON.stringify({ ok: true, total: 0, findings: [], note: '还没有靶标' }, null, 2)\n",
      replace:
        "      if (!t.id) return noTarget({ total: 0, findings: [] })\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "      if (!t.id) return JSON.stringify({ ok: true, external: { total: 0, actions: [] }, internal: { total: 0, actions: [] }, note: '还没有靶标' }, null, 2)\n",
      replace:
        "      if (!t.id) return noTarget({ external: { total: 0, actions: [] }, internal: { total: 0, actions: [] } })\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      count: 2,
      find:
        "      if (!t.id) return JSON.stringify({ ok: true, total: 0, items: [], note: '还没有靶标' }, null, 2)\n",
      replace:
        "      if (!t.id) return noTarget({ total: 0, items: [] })\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      count: 2,
      find:
        "      if (!t.id) return JSON.stringify({ ok: true, items: [], total: 0, note: '还没有靶标' }, null, 2)\n",
      replace:
        "      if (!t.id) return noTarget({ items: [], total: 0 })\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      count: 5,
      find:
        "      if (!t.id) return JSON.stringify({ ok: false, error: '还没有靶标' }, null, 2)\n",
      replace:
        "      if (!t.id) return noTarget()\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "    description: '【主会话派活前后用】执行智能体的并发闸门：同一靶标**最多同时 3 个**在跑（可用 REDTEAM_MAX_AGENTS 配置）。action=status 看还剩几个名额与谁在跑；action=acquire 占一个名额（满了会直接拒绝，**不要重试硬塞**）；action=release 释放（子智能体结束时服务端也会自动释放）。',\n" +
        "    parameters: {\n" +
        "      action: { type: 'string', required: true, enum: ['status', 'acquire', 'release'], description: 'status 查看 / acquire 占用 / release 释放' },\n" +
        "      status: { type: 'string', enum: ['progress', 'ready', 'blocked', 'waiting'], description: '【只有执行子智能体填】blocked/waiting 表示在等人给 key/VPS/范围 —— 会**让出名额**，不占并发；progress/ready 收回名额。主会话不要填。' },\n",
      replace:
        "    description: '【主会话派活前后 / 子智能体卡住时用】执行智能体的并发闸门：同一靶标**最多同时 3 个**在跑（可用 REDTEAM_MAX_AGENTS 配置）。action=status 看还剩几个名额与谁在跑；action=acquire 占一个名额（满了会直接拒绝，**不要重试硬塞**）；action=release 释放（子智能体结束时服务端也会自动释放）。**子智能体回报自己的状态用 report=...（不必再传 action）**：blocked/waiting 表示在等人给 key/VPS/范围，会让出名额；progress/ready 收回；failed/dropped 表示这一轮结束，同样不再占名额。',\n" +
        "    parameters: {\n" +
        "      /* action 不再是必填：子智能体只回报状态时不必再编一个动作名。\n" +
        "         同时把「查看」与「回报」拆开 —— 旧写法 action=status + status=blocked 把两件事压在一个字段上，\n" +
        "         读代码的人无法判断调用方到底想要哪一种。 */\n" +
        "      action: { type: 'string', enum: ['status', 'report', 'acquire', 'release'], description: 'status 查看（省略时的默认）/ report 回报自己状态（等价于只传 report）/ acquire 占用 / release 释放' },\n" +
        "      report: { type: 'string', enum: ['progress', 'ready', 'blocked', 'waiting', 'failed', 'dropped'], description: '【只有执行子智能体填】本次回报的状态：blocked/waiting 会让出名额；progress/ready 收回；failed/dropped 表示这轮结束，同样让出名额。' },\n" +
        "      /* 旧名保留：已经写进提示词/预设的调用不该因为改名而失败。 */\n" +
        "      status: { type: 'string', enum: ['progress', 'ready', 'blocked', 'waiting', 'failed', 'dropped'], description: '（旧名，等价 report；保留兼容。新调用请用 report）' },\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "      /* [dsh-purge-plus] 子智能体自报状态：在等人时让出名额（safe 2.0.2 tools.js:949）。\n" +
        "         主会话填 status 一律拒绝 —— 它不占名额，填了只会把数字搅乱。 */\n" +
        "      const selfChild = sessionId !== undefined && sessionId !== owner ? sessionId : undefined\n" +
        "      const reportStatus = typeof args.status === 'string' ? args.status : ''\n" +
        "      if (reportStatus !== '') {\n" +
        "        if (selfChild === undefined) {\n" +
        "          return JSON.stringify({ ok: false, error: 'status 只由执行子智能体填写；主会话用 label/key 操作名额。' }, null, 2)\n" +
        "        }\n" +
        "        if (reportStatus === 'blocked' || reportStatus === 'waiting') parkAgent(owner, selfChild)\n" +
        "        else if (reportStatus === 'progress' || reportStatus === 'ready') unparkAgent(owner, selfChild)\n" +
        "      }\n",
      replace:
        "      /* [dsh-purge-plus] 子智能体自报状态：在等人时让出名额（safe 2.0.2 tools.js:949）。\n" +
        "         主会话填 report/status 一律拒绝 —— 它不占名额，填了只会把数字搅乱。\n" +
        "\n" +
        "         与 safe 的差异（有意）：safe 的 action 必填且只认 status/acquire/release，\n" +
        "         子智能体想报 failed/dropped 会被参数校验直接拒掉（枚举里没有这两个值），\n" +
        "         于是「失败了」这件事根本传不回来。这里补齐六个值，并让 action 可省略。 */\n" +
        "      const selfChild = sessionId !== undefined && sessionId !== owner ? sessionId : undefined\n" +
        "      const reportStatus = typeof args.report === 'string' && args.report !== ''\n" +
        "        ? args.report\n" +
        "        : (typeof args.status === 'string' ? args.status : '')\n" +
        "      const legacyReport = args.report === undefined && reportStatus !== ''\n" +
        "      const action = typeof args.action === 'string' && args.action !== '' ? args.action : ''\n" +
        "      if (reportStatus !== '') {\n" +
        "        if (selfChild === undefined) {\n" +
        "          return JSON.stringify({ ok: false, error: 'report 只由执行子智能体填写；主会话用 label/key 操作名额。' }, null, 2)\n" +
        "        }\n" +
        "        if (reportStatus === 'blocked' || reportStatus === 'waiting') parkAgent(owner, selfChild)\n" +
        "        /* failed / dropped 是「这轮结束了」：不解除挂起就会永远占着一个 parked 名额 */\n" +
        "        else unparkAgent(owner, selfChild)\n" +
        "      }\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "      if (args.action === 'status') {\n" +
        "        return JSON.stringify(Object.assign(base, {\n" +
        "          hint: free === 0\n",
      replace:
        "      if (action === '' || action === 'status' || action === 'report') {\n" +
        "        const viewed = Object.assign(base, {\n" +
        "          hint: free === 0\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find:
        "            : '还有 ' + free + ' 个名额。默认一个一个派；只有确实互不依赖的活才并行。',\n" +
        "        }), null, 2)\n" +
        "      }\n" +
        "      if (args.action === 'acquire') {\n",
      replace:
        "            : '还有 ' + free + ' 个名额。默认一个一个派；只有确实互不依赖的活才并行。',\n" +
        "        })\n" +
        "        if (reportStatus !== '') {\n" +
        "          viewed.reported = reportStatus\n" +
        "          viewed.parked = reportStatus === 'blocked' || reportStatus === 'waiting'\n" +
        "          if (legacyReport) viewed.deprecated = 'status 已改名 report（action 也可省略）；旧写法仍可用。'\n" +
        "        }\n" +
        "        return JSON.stringify(viewed, null, 2)\n" +
        "      }\n" +
        "      if (action === 'acquire') {\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "            status: req.status, kind: req.kind, asset_id: req.asset_id, limit: req.limit,\n",
      replace:
        "            status: req.status, kind: req.kind, asset_id: req.asset_id, limit: req.limit, offset: req.offset,\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "  listCleanup(id, f = {}) {\n" +
        "    const db = this.db(id)\n" +
        "    const limit = Math.min(Math.max(Number(f.limit) || 100, 1), 500)\n",
      replace:
        "  listCleanup(id, f = {}) {\n" +
        "    const db = this.db(id)\n" +
        "    const limit = Math.min(Math.max(Number(f.limit) || 100, 1), 500)\n" +
        "    /* [dsh-purge-plus] 翻页要 offset：只把 total 改成 COUNT(*) 但 SQL 不认 offset，\n" +
        "       调用方拿到「总数 3」却永远只能看前 2 条 —— 与「总数报错」是同一个毛病的两半。 */\n" +
        "    const offset = Math.max(Number(f.offset) || 0, 0)\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "\"CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id DESC LIMIT ?\").all(...args, limit)\n",
      replace:
        "\"CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id DESC LIMIT ? OFFSET ?\").all(...args, limit, offset)\n",
    },

    /* ==================== R19：范围类型 / 写 op 存在性 / 读路径副作用 ==================== */
    // 归一函数放模块级：写侧一处校验，读侧六处共用（见 scope-normalize.js 头注释）。
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "export function dispatch(store, req = {}) {",
      replace: SNIP("scope-normalize.js") + "export function dispatch(store, req = {}) {",
    },
    // 先验类型再落盘：非法 scope 不能留下半截目录（R19-02 的修复顺序）
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "  openEngagement(name, scope, options = {}) {\n" +
        "    const id = slugify(name)\n" +
        "    mkdirSync(this.dirOf(id), { recursive: true })\n",
      replace:
        "  openEngagement(name, scope, options = {}) {\n" +
        "    /* [dsh-purge-plus] 先验类型再建目录：非法 scope 不该留下半截靶标目录 */\n" +
        "    const nextScope = normalizeScope(scope)\n" +
        "    const id = slugify(name)\n" +
        "    mkdirSync(this.dirOf(id), { recursive: true })\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    const existing = readMeta(this.metaPathOf(id))\n" +
        "    writeMeta(this.metaPathOf(id), {\n" +
        "      target_name: name,\n" +
        "      scope_cidrs: scope || (existing && existing.scope_cidrs) || [],\n",
      replace:
        "    const existing = readMeta(this.metaPathOf(id))\n" +
        "    /* [dsh-purge-plus] 写侧归一：字符串按逗号/空白切成 CIDR 列表，数组里出现非字符串直接拒绝。\n" +
        "       归一之前：字符串被原样写进 YAML → report 的 .join 抛 TypeError（报告页永久崩）；\n" +
        "       对象被 String() 成 \"[object Object]\" → 授权范围永久丢失，且当时没有任何 op 能改回来。\n" +
        "       没给 scope（undefined/null）时沿用库里的旧值，但旧值也要过一遍读侧还原。 */\n" +
        "    const effectiveScope = nextScope !== null ? nextScope : scopeList(existing && existing.scope_cidrs)\n" +
        "    writeMeta(this.metaPathOf(id), {\n" +
        "      target_name: name,\n" +
        "      scope_cidrs: effectiveScope,\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "    return { id, name, scope: scope || [] }\n",
      replace: "    return { id, name, scope: effectiveScope }\n",
    },
    // 读侧六处：历史脏数据不再让报告抛错、也不再被当成「没记范围」
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "        scope: meta.scope_cidrs || [], status: meta.status || 'active',\n",
      replace: "        scope: scopeList(meta.scope_cidrs), status: meta.status || 'active',\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "        id, name: meta.target_name || id, scope: meta.scope_cidrs || [],\n",
      replace: "        id, name: meta.target_name || id, scope: scopeList(meta.scope_cidrs),\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "      engagement: { id, name: meta.target_name || id, scope: meta.scope_cidrs || [] },\n",
      replace: "      engagement: { id, name: meta.target_name || id, scope: scopeList(meta.scope_cidrs) },\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "    push(`- 授权范围：${(meta.scope_cidrs || []).join(', ') || '（未记录）'}`)\n",
      replace: "    push(`- 授权范围：${scopeList(meta.scope_cidrs).join(', ') || '（未记录）'}`)\n",
    },
    // R19-03：写 op 对不存在的 id 不能再假成功
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    const current = db.prepare('SELECT * FROM vuln WHERE id = ?').get(Number(vulnId))\n" +
        "    if (current === undefined) return { updated: false }\n",
      replace:
        "    const current = db.prepare('SELECT * FROM vuln WHERE id = ?').get(Number(vulnId))\n" +
        "    /* [dsh-purge-plus] 查不到就是查不到：曾经 return {updated:false}，dispatch 用\n" +
        "       Object.assign({ok:true}, …) 一包就变成「成功但没改」，与 pocGet 的假成功同形。\n" +
        "       抛错后 dispatch 归一成 {ok:false,error}，工具层归一成 bad_input 并提示先 list。 */\n" +
        "    if (current === undefined) throw new Error('vuln not found: ' + vulnId)\n",
    },
    // 幽灵靶标：只读 op 不能在磁盘上造目录
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "  listPrompts(id) {\n" +
        "    const dir = this.promptsDirOf(id)\n" +
        "    mkdirSync(dir, { recursive: true })\n" +
        "    this.refreshDefaultPrompts(id)\n",
      replace:
        "  listPrompts(id, options = {}) {\n" +
        "    const dir = this.promptsDirOf(id)\n" +
        "    /* [dsh-purge-plus] 读路径不落盘：`prompts` 是只读 op，却会 mkdir + 灌 6 份默认提示词，\n" +
        "       于是「查一个不存在的靶标的提示词」会在磁盘上造出一个幽灵靶标。\n" +
        "       materialize:false 时目录不存在就只回内置默认值，一个字节都不写。 */\n" +
        "    const materialize = options.materialize !== false\n" +
        "    if (materialize) {\n" +
        "      mkdirSync(dir, { recursive: true })\n" +
        "      this.refreshDefaultPrompts(id)\n" +
        "    }\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "        content: exists ? readFileSync(p, 'utf8') : '',\n" +
        "        updated_at: exists ? statSync(p).mtime.toISOString() : null,\n",
      replace:
        "        content: exists ? readFileSync(p, 'utf8') : (materialize ? '' : (DEFAULT_PROMPTS[role] || '')),\n" +
        "        updated_at: exists ? statSync(p).mtime.toISOString() : null,\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "    if (op === 'prompts') return { ok: true, roles: store.listPrompts(id) }\n",
      replace: "    if (op === 'prompts') return { ok: true, roles: store.listPrompts(id, { materialize: false }) }\n",
    },
    {
      file: "lib/redteam/tools.js",
      required: true,
      find: "      const found = store.listPrompts(id).find((p) => p.role === args.role)\n",
      replace: "      const found = store.listPrompts(id, { materialize: false }).find((p) => p.role === args.role)\n",
    },
    // 模板索引：`^\s*id:` 会命中 .github/workflows 里缩进的 step id
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "        if (!/^\\s*id:\\s*\\S+/m.test(full)) continue\n",
      replace: "        if (!/^id:\\s*\\S+/m.test(full)) continue\n",
    },
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "          && Number(cached.v || 0) === 3 /* [dsh-purge-plus] 过滤规则变了要重建 */\n",
      replace: "          && Number(cached.v || 0) === 4 /* [dsh-purge-plus] 过滤规则变了要重建 */\n",
    },

    /* ==================== R20：空载荷 / 空壳 / 假成功 / 类型污染 ==================== */
    // R19-04：空载荷不再落一条 title=NULL 的漏洞行
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "  addVuln(id, v = {}) {\n" +
        "    const db = this.db(id)\n" +
        "    const severity = SEVERITIES.includes(v.severity) ? v.severity : 'info'\n",
      replace:
        "  addVuln(id, v = {}) {\n" +
        "    const db = this.db(id)\n" +
        "    /* [dsh-purge-plus] 空载荷会落一条 title=NULL 的漏洞行：它被 vulnStats / 报告 /\n" +
        "       覆盖率一起数进去，报告里只能显示「(无标题)」，既不能复现也不能处置。\n" +
        "       至少要有 title 或 cve —— 两者都没有的调用一定是参数拼错了。 */\n" +
        "    if (String(v.title ?? '').trim() === '' && String(v.cve ?? '').trim() === '') {\n" +
        "      throw new Error('vuln 至少需要 title 或 cve：空载荷会落一条没有标题的漏洞行，污染漏洞表与统计')\n" +
        "    }\n" +
        "    const severity = SEVERITIES.includes(v.severity) ? v.severity : 'info'\n",
    },
    // R19-06 / R19-14：空壳阶段会永久阻断内置定义补种；sections 非数组会让攻击链页崩
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "  saveStage(id, patch = {}) {\n" +
        "    const db = this.db(id)\n" +
        "    if (!patch.code) throw new Error('stage.code required')\n" +
        "    const cur = db.prepare('SELECT * FROM stage WHERE code = ?').get(String(patch.code))\n",
      replace:
        "  saveStage(id, patch = {}) {\n" +
        "    const db = this.db(id)\n" +
        "    if (!patch.code) throw new Error('stage.code required')\n" +
        "    /* [dsh-purge-plus] sections 必须是数组：写成字符串会被 JSON.stringify 成 \"x\"，\n" +
        "       listStages 原样返回字符串，redteam_attack_chain 的 (st.sections||[]).map 直接崩。 */\n" +
        "    if (patch.sections !== undefined && !Array.isArray(patch.sections)) {\n" +
        "      throw new TypeError('stage.sections 必须是数组，收到 ' + (typeof patch.sections)\n" +
        "        + '（写字符串会让攻击链页面与工具一起崩）')\n" +
        "    }\n" +
        "    /* [dsh-purge-plus] 空壳阶段会永久阻断补种：seedStages 只看 code 在不在，\n" +
        "       先插一条 name=code / sections=[] 的行，内置定义（互联网资产权限 / 3 段手段 /\n" +
        "       工具 / 过渡语）就再也不会补回来。所以库里没有这个 code 时先补种，再判断。 */\n" +
        "    if (db.prepare('SELECT code FROM stage WHERE code = ?').get(String(patch.code)) === undefined) {\n" +
        "      this.seedStages(id)\n" +
        "    }\n" +
        "    const cur = db.prepare('SELECT * FROM stage WHERE code = ?').get(String(patch.code))\n" +
        "    if (cur === undefined && patch.sections === undefined) {\n" +
        "      throw new Error('stage 不存在且没给 sections：这会插入一个空壳阶段并阻止内置定义补种（内置 code：'\n" +
        "        + DEFAULT_STAGES.map((s) => s.code).join('/') + '）')\n" +
        "    }\n",
    },
    // R19-13：角色提示词被写成 "[object Object]" 还返回 ok:true
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    mkdirSync(this.promptsDirOf(id), { recursive: true })\n" +
        "    const text = String(content ?? '')\n",
      replace:
        "    /* [dsh-purge-plus] 非字符串 content 曾被 String() 写成 \"[object Object]\"（15 字节），\n" +
        "       还会因为「与默认不一致」被从 manifest 删掉 → 此后永不随版本升级，而返回 ok:true。\n" +
        "       角色提示词是给智能体的指令，写坏了整轮行为都歪，所以必须拒绝。 */\n" +
        "    if (typeof content !== 'string') {\n" +
        "      throw new TypeError('prompt content 必须是字符串，收到 '\n" +
        "        + (content === null ? 'null' : typeof content))\n" +
        "    }\n" +
        "    mkdirSync(this.promptsDirOf(id), { recursive: true })\n" +
        "    const text = content\n",
    },
    // R19-15：points:"abc" 被静默归 0 并返回 ok:true（更新自建得分点）
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "      if (name === '') throw new Error('score point name required')\n" +
        "      const points = Number.isFinite(Number(point.points)) ? Number(point.points) : 0\n" +
        "      db.prepare(`UPDATE score_point SET name = ?, category = ?, points = ?, description = ?, enabled = ?,\n",
      replace:
        "      if (name === '') throw new Error('score point name required')\n" +
        "      /* [dsh-purge-plus] 给了 points 但不是数字时必须拒绝：旧行为静默归 0 并回 ok:true，\n" +
        "         调用方以为写了分值，报告里这一条却是 0 分。 */\n" +
        "      if (point.points !== undefined && point.points !== null && !Number.isFinite(Number(point.points))) {\n" +
        "        throw new TypeError('score point points 必须是数字，收到 ' + JSON.stringify(point.points))\n" +
        "      }\n" +
        "      const points = Number.isFinite(Number(point.points)) ? Number(point.points) : 0\n" +
        "      db.prepare(`UPDATE score_point SET name = ?, category = ?, points = ?, description = ?, enabled = ?,\n",
    },
    // R19-15：同上（新增自建得分点）
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "    if (name === '') throw new Error('score point name required')\n" +
        "    const points = Number.isFinite(Number(point.points)) ? Number(point.points) : 0\n" +
        "    const next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM score_point').get().n\n",
      replace:
        "    if (name === '') throw new Error('score point name required')\n" +
        "    if (point.points !== undefined && point.points !== null && !Number.isFinite(Number(point.points))) {\n" +
        "      throw new TypeError('score point points 必须是数字，收到 ' + JSON.stringify(point.points))\n" +
        "    }\n" +
        "    const points = Number.isFinite(Number(point.points)) ? Number(point.points) : 0\n" +
        "    const next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM score_point').get().n\n",
    },
    // R19-11：HTTP 证据空载荷
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "  addHttpEvidence(id, e = {}) {\n" +
        "    const db = this.db(id)\n" +
        "    const result = db.prepare(`INSERT INTO http_evidence(vuln_id, asset_id, label, method, url, status, request, response, note, captured_by, captured_at)\n",
      replace:
        "  addHttpEvidence(id, e = {}) {\n" +
        "    const db = this.db(id)\n" +
        "    /* [dsh-purge-plus] 没有 url / 报文 / 标签的「证据」不能入库：\n" +
        "       报告里它会显示成一行空白，验收时既不能重放也不能说明任何事。 */\n" +
        "    if ([e.url, e.request, e.response, e.label].every((x) => String(x ?? '').trim() === '')) {\n" +
        "      throw new Error('http 证据至少要给 url / request / response / label 之一')\n" +
        "    }\n" +
        "    const result = db.prepare(`INSERT INTO http_evidence(vuln_id, asset_id, label, method, url, status, request, response, note, captured_by, captured_at)\n",
    },
    // R19-11：攻击链空载荷
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "  addChainStep(id, s = {}) {\n" +
        "    const db = this.db(id)\n" +
        "    const next = (db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM attack_step').get() || { n: 1 }).n\n",
      replace:
        "  addChainStep(id, s = {}) {\n" +
        "    const db = this.db(id)\n" +
        "    /* [dsh-purge-plus] 没有标题的步骤在报告里就是一条空行 —— 攻击链的意义正是\n" +
        "       「这一步做了什么」，title 缺失时整条记录不可读。 */\n" +
        "    if (String(s.title ?? '').trim() === '') {\n" +
        "      throw new Error('attack step 需要 title：报告按它展示「这一步做了什么」')\n" +
        "    }\n" +
        "    const next = (db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM attack_step').get() || { n: 1 }).n\n",
    },
    // R19-11：隧道空载荷
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find:
        "  addTunnel(id, t = {}) {\n" +
        "    const db = this.db(id)\n" +
        "    const ts = nowIso()\n",
      replace:
        "  addTunnel(id, t = {}) {\n" +
        "    const db = this.db(id)\n" +
        "    /* [dsh-purge-plus] 既没有监听地址、也没有入口/可达网段/建立命令的「隧道」\n" +
        "       在扫描器侧无法使用、在报告里无法复现，只会在边界突破统计里占一行。 */\n" +
        "    if ([t.listen, t.entry, t.reach, t.command].every((x) => String(x ?? '').trim() === '')) {\n" +
        "      throw new Error('tunnel 至少要给 listen / entry / reach / command 之一')\n" +
        "    }\n" +
        "    const ts = nowIso()\n",
    },
    // R19-08：import 把整个 req 当 bundle → 传 {bundle:{…}} 时零入库却 ok:true
    {
      file: "lib/redteam/store-core.js",
      required: true,
      find: "    if (op === 'import') return Object.assign({ ok: true }, store.importBundle(id, req))\n",
      replace:
        "    if (op === 'import') {\n" +
        "      /* [dsh-purge-plus] 兼容 {bundle:{…}}：旧实现把整个 req 当 bundle，于是\n" +
        "         按直觉传 bundle 的调用方 counts 全 0、一条没入库，还拿到 ok:true。 */\n" +
        "      const explicit = req.bundle && typeof req.bundle === 'object' && !Array.isArray(req.bundle)\n" +
        "      const imported = store.importBundle(id, explicit ? req.bundle : req)\n" +
        "      const total = Object.values(imported.counts || {}).reduce((a, b) => a + Number(b || 0), 0)\n" +
        "      if (explicit && total === 0) {\n" +
        "        return {\n" +
        "          ok: false, counts: imported.counts,\n" +
        "          error: 'import 没有导入任何记录：bundle 里 segments/assets/edges 都是空的（检查键名与嵌套层级）',\n" +
        "        }\n" +
        "      }\n" +
        "      return Object.assign({ ok: true }, imported)\n" +
        "    }\n",
    },
    // R19-09：顶部靶标下拉切换失败时界面已换、服务端指针没换
    {
      file: "lib/redteam/client.js",
      required: true,
      find:
        "              setEng(e.target.value)\n" +
        "              loadSnapshot(e.target.value)\n" +
        "              /* 同步「当前靶标」：原生 skill 目录按它解析技能根 */\n" +
        "              api({ op: 'activateEngagement', engagement: e.target.value }).catch(() => {})\n",
      replace:
        "              /* [dsh-purge-plus] 切换失败必须回滚：旧写法先改界面再 .catch(()=>{})，\n" +
        "                 既不判 ok:false 也不提示 —— 界面显示 B、服务端指针仍是 A，\n" +
        "                 之后所有读写都打在 A 上，而用户以为切过去了。\n" +
        "                 与「点会话图里的靶标节点」那条路径保持同一口径。 */\n" +
        "              const nextEng = e.target.value\n" +
        "              const prevEng = eng\n" +
        "              setEng(nextEng)\n" +
        "              loadSnapshot(nextEng)\n" +
        "              /* 同步「当前靶标」：原生 skill 目录按它解析技能根 */\n" +
        "              api({ op: 'activateEngagement', engagement: nextEng }).then((r) => {\n" +
        "                if (r && r.ok === false) {\n" +
        "                  setEng(prevEng)\n" +
        "                  loadSnapshot(prevEng)\n" +
        "                  setErr('切换靶标失败：' + ((r && r.error) || '服务端未确认') + '（已回滚到上一个靶标）')\n" +
        "                } else {\n" +
        "                  setErr(null)\n" +
        "                }\n" +
        "              }, (err2) => {\n" +
        "                setEng(prevEng)\n" +
        "                loadSnapshot(prevEng)\n" +
        "                setErr('切换靶标失败：' + String((err2 && err2.message) || err2) + '（已回滚到上一个靶标）')\n" +
        "              })\n",
    },
    // 会话关系图：把宿主的真实活动态与父子关系并进图里
    //   store.sessionGraph() 只有「会话 → 靶标」这一层，因为 store 拿不到宿主服务。
    //   ui.js 有 ctx，能取 sessions / subagents —— safe 那张图回答的正是
    //   「谁是谁的子代理、现在在干什么」，这一层过去是缺的。
    {
      file: "lib/redteam/ui.js",
      required: true,
      find: "  return assignToolkitFolder(request.dir, root)\n}\n",
      replace:
        "  return assignToolkitFolder(request.dir, root)\n" +
        "}\n" +
        "\n" +
        "/**\n" +
        " * 会话关系图 op（在 store 分发之前拦）：把宿主里真实存在的会话的**活动态与父子关系**\n" +
        " * 并进 store.sessionGraph()。\n" +
        " *\n" +
        " * 为什么不直打 /api/session/list：那个 rpcId/method 没有版本承诺，宿主升级后会静默\n" +
        " * 变成空白图且不报错（safe 就是这样坏的）。这里走 ctx 的 sessions 服务，取不到就\n" +
        " * 退回只有绑定关系的图，并显式标 live:false —— 「没有实时数据」和「没有会话」不同。\n" +
        " *\n" +
        " * 子代理的处理：绑定过靶标的会话，它的后代即使自己没绑靶标也画出来（继承祖先的\n" +
        " * 靶标），否则「子代理在干什么」永远看不到。总数仍受前端 300 节点上限约束。\n" +
        " */\n" +
        "async function handleSessionMapOp(ctx, store, request) {\n" +
        "  if (!request || request.op !== 'sessionGraph') return undefined\n" +
        "  let base\n" +
        "  try { base = store.sessionGraph() } catch (error) {\n" +
        "    return { ok: false, error: '读会话绑定失败：' + (error && error.message ? error.message : String(error)) }\n" +
        "  }\n" +
        "  const sessions = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : undefined\n" +
        "  if (sessions === undefined || sessions === null || typeof sessions.list !== 'function') {\n" +
        "    return Object.assign({ ok: true, live: false }, base)\n" +
        "  }\n" +
        "  let list = []\n" +
        "  let listOk = true\n" +
        "  try { list = sessions.list() || [] } catch { list = []; listOk = false }\n" +
        "  /* 取数失败必须显式降级：过去吞掉异常后照样返回 live:true，于是所有会话\n" +
        "     变成 activity:'unknown'，面板显示「跑 0 · 闲 0」—— 那是「不知道」，\n" +
        "     不是「都在闲着」（R21 审计 RB-02）。 */\n" +
        "  if (!listOk) {\n" +
        "    return Object.assign({ ok: true, live: false, live_error: '宿主 sessions.list() 读取失败，图里只有绑定关系' }, base)\n" +
        "  }\n" +
        "  /* 判定逻辑在 live-views.js 里（纯函数），这里只负责取数与拼装。 */\n" +
        "  const merged = mergeSessionGraphLive(base, list)\n" +
        "  return Object.assign({ ok: true, live: true }, base, merged)\n" +
        "}\n",
    },
    {
      file: "lib/redteam/ui.js",
      required: true,
      find:
        "        const platformResult = handlePlatformOp(store, request)\n" +
        "        if (platformResult !== undefined) {\n" +
        "          sendJson(res, 200, platformResult)\n" +
        "          return\n" +
        "        }\n",
      replace:
        "        const platformResult = handlePlatformOp(store, request)\n" +
        "        if (platformResult !== undefined) {\n" +
        "          sendJson(res, 200, platformResult)\n" +
        "          return\n" +
        "        }\n" +
        "        /* [dsh-purge-plus] 会话关系图：先并宿主的活动态/父子关系，再交给前端。 */\n" +
        "        const sessionMapResult = await handleSessionMapOp(ctx, store, request)\n" +
        "        if (sessionMapResult !== undefined) {\n" +
        "          sendJson(res, 200, sessionMapResult)\n" +
        "          return\n" +
        "        }\n",
    },
    // 面板崩溃兜底：DetailSettings 是面板唯一挂载点，抛错就整页空白。
    // 包一层边界后，渲染期异常会画在页面上并留痕，不再需要靠重装绕过。
    {
      file: "client.js",
      required: true,
      find: '  return h("div", { className: "dshpp-detail-settings" }, h(PurgePage));\n',
      replace:
        '  return h("div", { className: "dshpp-detail-settings" }, h(PurgeErrorBoundary, null, h(PurgePage)));\n',
    },
    // 面板空白兜底：apply 里任何一步抛错，后面的 slots.inject 全都不执行，
    // 界面表现是「侧栏有 Purge、点进去空白」。改成先注册插槽、副作用逐步隔离。
    {
      file: "client.js",
      required: true,
      regex: true,
      find: "function apply\\(ctx\\) \\{[\\s\\S]*?\\n\\}\\n",
      replace: "function apply(ctx) {\n  /* [dsh-purge-plus] \u63d2\u69fd\u5148\u6ce8\u518c\uff0c\u526f\u4f5c\u7528\u540e\u6267\u884c\uff0c\u6bcf\u4e00\u6b65\u72ec\u7acb\u9694\u79bb\u3002\n     \u539f\u56e0\uff1aapply \u91cc\u4efb\u4f55\u4e00\u6b65\u629b\u9519\uff0c\u540e\u9762\u7684 slots.inject \u5c31\u5168\u90fd\u4e0d\u4f1a\u6267\u884c\uff0c\n     \u754c\u9762\u4e0a\u8868\u73b0\u4e3a\u300c\u4fa7\u680f\u6709 Purge\u3001\u70b9\u8fdb\u53bb\u4e00\u7247\u7a7a\u767d\u300d\uff0c\u800c\u4e14\u6ca1\u6709\u4efb\u4f55\u9519\u8bef\u53ef\u770b\u3002\n     \u73b0\u5728\u5931\u8d25\u53ea\u8bb0\u8fdb window.__dshPurgeErrors + console.error\uff0c\u9875\u9762\u7167\u5e38\u6e32\u67d3\u3002 */\n  const guard = (label, fn) => {\n    try {\n      return fn();\n    } catch (err) {\n      __purgeRecordError(label, err);\n      try {\n        console.error(\"[dsh-purge-plus] \" + label + \" \u5931\u8d25:\", err);\n      } catch (e) {\n      }\n      return void 0;\n    }\n  };\n  const t = guard(\"locale bind\", () => ctx.locale.bind(NS)) || ((key) => key);\n  guard(\"locale register\", () => ctx.locale.register(NS, { zh, en }));\n  setTranslate(t);\n  guard(\"slot shell.overlay\", () => ctx.slots.inject(\"shell.overlay\", () => ctx.slots.register({\n    name: \"shell.overlay\",\n    id: \"dsh-purge-panel-overlays\",\n    order: 60\n  }, PanelOverlays)));\n  guard(\"slot sidebar.panellist\", () => ctx.slots.inject(\"sidebar.panellist\", () => ctx.slots.register({\n    name: \"sidebar.panellist\",\n    id: \"dsh-purge\",\n    order: 30,\n    label: \"Purge\",\n    inject: () => ({ t })\n  }, PurgeGlyphIcon)));\n  guard(\"slot main\", () => ctx.slots.inject(\"main\", () => ctx.slots.register({\n    name: \"main\",\n    key: \"dsh-purge\",\n    inject: () => ({ t })\n  }, PurgePageGuarded)));\n  guard(\"slot plugins.bundle.config\", () => ctx.slots.inject(\"plugins.bundle.config\", () => ctx.slots.register({\n    name: \"plugins.bundle.config\",\n    key: \"dsh-purge-plus\",\n    inject: () => ({ t })\n  }, DetailSettings)));\n  guard(\"slot plugins.row.config\", () => ctx.slots.inject(\"plugins.row.config\", () => ctx.slots.register({\n    name: \"plugins.row.config\",\n    key: name + \"#dsh-purge\",\n    inject: () => ({ t })\n  }, DetailSettings)));\n  guard(\"legacy visibility\", () => ctx.effect(() => installLegacyVisibility(), \"panel legacy visibility\"));\n  guard(\"session context\", () => ctx.inject([\"sessions\", \"uiWorkspace\"], (host3) => {\n    host3.effect(() => bindSessionContext(host3), \"panel session context\");\n  }));\n  guard(\"preset menu\", () => ctx.inject([\"remote\", \"remote.agentPresets\"], (host3) => host3.effect(() => bindPresetMenu(document, () => host3.remote.agentPresets.list()), \"preset menu aliases\")));\n  guard(\"grant sync\", () => ctx.effect(startGrantSync, \"panel grant sync\"));\n  guard(\"rewind draft sync\", () => ctx.inject([\"sessions\", \"uiWorkspace\", \"conversation\"], (host3) => installRewindDraftSync(host3)));\n}\n",
    },
    {
      file: "client.js",
      required: true,
      find: "function DetailSettings({ view } = {}) {",
      replace: "function PurgePageGuarded() {\n  return h(PurgeErrorBoundary, null, h(PurgePage));\n}\nfunction DetailSettings({ view } = {}) {",
    },
  ];
}

export const EDITS = buildEdits();