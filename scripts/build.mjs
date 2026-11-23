#!/usr/bin/env node
// [dsh-purge-plus] 构建：vendor/community + overlay → dist/package → dist/*.tgz
//
// 不变式：
//   · vendor/ 永远不被写入（只在构建时读取），升级时整目录替换即可。
//   · overlay 的改动面（计数方法学见 docs/02）：
//       - 新增文件：overlay/files/** + overlay/snippets/**
//       - 锚点编辑：overlay/edits.mjs **179 条**（required 176 / required:false 3）
//       - snippet 注入点：§3c **92 处**（两份产物各一遍）
//       - 品牌文案替换：§3b 4 条；页签修正：§3d
//     这三个数字由 verify [26] 组现场复算守卫，README 与代码不符即硬失败。
//   · 任何锚点命中数 ≠ 1 立刻失败，并打印文件、锚点、实际命中次数。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { buildEdits, resolveRepo } from "../overlay/edits.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const VENDOR = path.join(ROOT, "vendor", "community");
const OVERLAY_FILES = path.join(ROOT, "overlay", "files");
const BUILD = path.join(ROOT, "dist", "build");
const PKG = path.join(BUILD, "package");

const log = (s) => console.log(s);
const die = (s) => { console.error("✗ " + s); process.exit(1); };

// ── 0. 前置检查 ────────────────────────────────────────────────────
if (!fs.existsSync(path.join(VENDOR, "package.json"))) die(`vendor/community 不完整: ${VENDOR}`);
const basePkg = JSON.parse(fs.readFileSync(path.join(VENDOR, "package.json"), "utf8"));
const baseVersion = basePkg.version;
const repo = resolveRepo();
const REPO_SLUG = `${repo.owner}/${repo.repo}`;
const plusRev = Number(process.env.PLUS_REV || repo.revision || basePkg.plus?.revision || 1);
// [dsh-purge-plus] 版本号与基座解耦：`0.1.<overlay 修订号>`。
// 旧方案 `<基座版本>-plus.N` 把上游版本写进了本包版本号里：上游升版会让本包
// 跳一个次版本（1.7.20-plus.9 → 1.7.21-plus.1），而「我们自己改了什么」反而看不出来；
// 上游版本还会跟着版本号散落到面板、徽章、页脚、发行资产名里，上游一更新全都要改。
// 基座版本仍然记进 package.json 的 plus.base 做溯源，不参与版本号。
const version = process.env.PLUS_VERSION || `0.1.${plusRev}`;
if (!/^0\.1\.\d+$/.test(version)) die(`版本号必须形如 0.1.<修订号>，当前 ${version}`);

log(`上游基座  ${basePkg.name}@${baseVersion}（仅溯源，不进版本号）`);
log(`本仓库版  dsh-purge-plus@${version}`);
log(`发布坐标  ${REPO_SLUG}` + (repo.owner === "OWNER" ? "  ⚠ 仍是占位，用 GITHUB_REPO 或 overlay/repo.json 改成真实账号" : ""));

// ── 1. 清空并复制 vendor ───────────────────────────────────────────
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(PKG, { recursive: true });
fs.cpSync(VENDOR, PKG, { recursive: true });
log(`✓ vendor/community → dist/build/package（${countFiles(PKG)} 个文件）`);

// ── 2. 覆盖新增文件 ───────────────────────────────────────────────
fs.cpSync(OVERLAY_FILES, PKG, { recursive: true });
log(`✓ overlay/files 覆盖完成`);

/* CVE 底库构建器要跟着包走：redteam_cve 的报错里写的就是「在插件目录跑
   node scripts/build-cve-db.mjs --install」。只拷这一个文件 —— 上游 scripts/
   里那几十个脚本在本包里都是死路径（§4 的剔除规则会把它们从 package.json 摘掉）。 */
{
  const src = path.join(ROOT, "scripts", "build-cve-db.mjs");
  const dst = path.join(PKG, "scripts", "build-cve-db.mjs");
  if (!fs.existsSync(src)) die(`CVE 构建器缺失：${src}`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  log(`✓ scripts/build-cve-db.mjs 已随包分发`);
}

// 包内 README 用本仓库的：vendor 带的是 community 的 README，装完在面板里
// 看到的会是「dsh-purge Community」，用户会以为装的是别人的包。
fs.copyFileSync(path.join(ROOT, "README.md"), path.join(PKG, "README.md"));
log(`✓ README.md 用本仓库版本覆盖`);

// 本仓库的维护文档**不进发行物**（docs/ 已从仓库与包内一并移除，只在本机保留）。
// 合规义务不依赖它：Apache-2.0 §4(b) 的逐文件改动记录在 NOTICE-PLUS.md 第 2 节，
// 随包分发；docs/LICENSING.md 只是同一份记录的扩展清单。
// 这里做的是反向守卫：万一将来有人把 docs 复制回来，构建直接失败。
{
  const localDocs = path.join(ROOT, "docs");
  if (fs.existsSync(localDocs)) {
    const names = fs.readdirSync(localDocs).filter((f) => f.endsWith(".md"));
    const leaked = names.filter((f) => fs.existsSync(path.join(PKG, "docs", f)));
    if (leaked.length) die(`发行物里出现了本仓库维护文档：${leaked.join(", ")}（docs/ 只在本机保留）`);
    log(`✓ 本仓库 docs 未随包分发（本机 ${names.length} 个，包内 0 个）`);
  } else {
    log(`✓ 本仓库 docs 未随包分发（本机无 docs/，跳过）`);
  }
}

// ── 3. 应用精确锚点编辑 ───────────────────────────────────────────
const EDITS = buildEdits(repo);
let applied = 0, warned = 0;
for (const [i, e] of EDITS.entries()) {
  const fp = path.join(PKG, e.file);
  const tag = `#${i + 1} ${e.file}`;
  if (!fs.existsSync(fp)) {
    if (e.required) die(`${tag}: 文件不存在`);
    log(`  ⚠ ${tag}: 文件不存在，跳过`); warned++; continue;
  }
  const src = fs.readFileSync(fp, "utf8");
  const want = e.count || 1;

  // regex: true 时 e.find 是正则源串。用于锚点本身含有「会被上游改名/混淆」的
  // 片段（例如仓库坐标）的情况——字面量锚点一旦上游改名就静默失配。
  let hits;
  let next;
  if (e.regex) {
    const re = new RegExp(e.find, "g");
    hits = (src.match(re) || []).length;
    next = () => src.replace(new RegExp(e.find, "g"), () => e.replace);
  } else {
    hits = countOccurrences(src, e.find);
    next = () => (want === 1 ? src.replace(e.find, () => e.replace) : src.split(e.find).join(e.replace));
  }

  if (hits !== want) {
    const msg = `${tag}: 锚点命中 ${hits} 次（要求恰好 ${want} 次）\n    锚点: ${JSON.stringify(e.find.slice(0, 120))}`;
    if (e.required) die(msg);
    log(`  ⚠ ${msg}`); warned++; continue;
  }
  // 用函数形式做替换：replace 字符串里可能出现 $ 序列（如正则字面量的 $/），
  // 直接传字符串会被 String.replace 当成替换模式解释。
  fs.writeFileSync(fp, next());
  applied++;
  log(`  ✓ ${tag}`);
}
log(`✓ 编辑完成 applied=${applied} warned=${warned}`);

// ── 3b. 用户可见文案里的上游品牌残留 ────────────────────────────────
// 这些不是注释，是面板上真会显示出来的字：兼容性提示、/dsh-purge/community 的
// name 字段、安装失败的报错。改名后还写着「dsh-purge Community / 社区版」会让人
// 以为装错了包。逐条限定命中次数，上游改文案就构建失败，不会静默漏改。
const BRAND_FIXES = [
  ["client.js", "\"dsh-purge Community {version}", "\"dsh-purge-plus {version}", 2],
  ["lib/index.js", 'name:"dsh-purge Community"', 'name:"dsh-purge-plus"', 1],
  ["lib/installed-package.js", "当前 profile 未找到社区版插件安装", "当前 profile 未找到 dsh-purge-plus 安装", 1],
  ["lib/installed-package.js", "当前 profile 有多个社区版安装，无法确定生效入口", "当前 profile 有多个 dsh-purge-plus 安装，无法确定生效入口", 1],
];
for (const [file, from, to, want] of BRAND_FIXES) {
  const fp = path.join(PKG, file);
  if (!fs.existsSync(fp)) die(`品牌残留：${file} 不存在`);
  const src = fs.readFileSync(fp, "utf8");
  const hits = src.split(from).length - 1;
  if (hits !== want) die(`品牌残留：${file} 里 ${JSON.stringify(from.slice(0, 40))} 命中 ${hits} 次（要求 ${want}）`);
  fs.writeFileSync(fp, src.split(from).join(to));
}
log(`✓ 用户可见文案去上游品牌（${BRAND_FIXES.length} 条）`);

// ── 3c. 演练台：移植 safe 的「凭据与文件」页 ────────────────────────
// 代码块放在 overlay/snippets/artifacts-tab.js（长段 JSX，不适合塞进字符串数组）。
//
// 同一个 UI 在本包里有**两份编译产物**：
//   lib/redteam/client.js  独立全屏窗口用，hyperscript 叫 h，hooks 走 React.useState
//   client.js              面板内嵌那份，hyperscript 叫 h2，hooks 走 import_react2.default.useState
// 两份都要改，否则「面板里点开」和「全面浏览新窗口」会看到不一样的页签。
const SNIPPET_DIR = path.join(ROOT, "overlay", "snippets");
const snippetCache = new Map();
function readSnippet(name) {
  const key = name || "artifacts-tab.js";
  if (!snippetCache.has(key)) snippetCache.set(key, fs.readFileSync(path.join(SNIPPET_DIR, key), "utf8"));
  return snippetCache.get(key);
}
const SNIPPET_SRC = readSnippet("artifacts-tab.js");

/** 把 snippet 适配到某一份产物的方言。 */
function adaptSnippet(text, dialect) {
  if (dialect === "redteam") return text;
  // panel：h → h2，React.xxx → import_react2.default.xxx，整体缩进减 2 空格
  const swapped = text
    .replace(/\bReact\./g, "import_react2.default.")
    .replace(/(^|[^\w$.])h\(/g, "$1h2(")
    /* h('div', ...) 里的字符串子节点不受影响；这里只把模板里的 h( 换成 h2( */;
  return swapped
    .split("\n")
    .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
    .join("\n");
}

const SNIPPETS = [
  {
    file: "lib/redteam/client.js", dialect: "redteam", what: "凭据与文件组件",
    anchor: "    function FindingsTab(props) {", mode: "before",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", what: "页签按钮",
    anchor: "        ['chain', '攻击链'], ['scores', '得分目标'], ['report', '报告'],",
    mode: "before", text: "        ['artifacts', '凭据与文件'],\n",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", what: "body 分发",
    anchor: "      else if (st.tab === 'scores') body = h(ScoreTab, { engagement: eng, refreshKey: refreshKey })\n",
    mode: "before",
    text: "      else if (st.tab === 'artifacts') body = h(ArtifactsTab, { engagement: eng, refreshKey: refreshKey })\n",
  },
  {
    file: "client.js", dialect: "panel", what: "凭据与文件组件（面板内嵌版）",
    anchor: "  function FindingsTab(props) {", mode: "before",
  },
  {
    file: "client.js", dialect: "panel", what: "页签按钮（面板内嵌版）",
    anchor: '      ["chain", "', mode: "before", text: '      ["artifacts", "\u51ED\u636E\u4E0E\u6587\u4EF6"],\n',
  },
  {
    file: "client.js", dialect: "panel", what: "body 分发（面板内嵌版）",
    anchor: '    else if (st.tab === "scores")\n', mode: "before",
    text: '    else if (st.tab === "artifacts")\n      body = h2(ArtifactsTab, { engagement: eng, refreshKey });\n',
  },

  // ── P23：清理清单可编辑 + 删除靶标入口 ────────────────────────────
  // 两个入口都放在「凭据与文件」页 / 顶部靶标选择器旁：
  //   清理清单 —— 人也要能登记「这个马还没删」，不能只能跟智能体说话；
  //   删除靶标 —— 之前**根本没有入口**，建错了只能手动 rm 目录。
  {
    file: "lib/redteam/client.js", dialect: "redteam", what: "清理清单组件",
    anchor: "    function FindingsTab(props) {", mode: "before", src: "cleanup-panel.js",
  },
  {
    file: "client.js", dialect: "panel", what: "清理清单组件（面板内嵌版）",
    anchor: "  function FindingsTab(props) {", mode: "before", src: "cleanup-panel.js",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", what: "删除靶标按钮",
    anchor: "          h('div', { className: 'rt-spacer' }),\n          embedded ? null : h(VersionBar, null),",
    mode: "before", src: "engagement-delete-button.js",
  },
  {
    file: "client.js", dialect: "panel", what: "删除靶标按钮（面板内嵌版）",
    anchor: '        h2("div", { className: "rt-spacer" }),\n        embedded ? null : h2(VersionBar, null),',
    mode: "before", src: "engagement-delete-button.js",
  },

  // ── P1：面板跟随「本会话绑定的靶标」 ──────────────────────────────
  // 只改 client.js：宿主上下文（host2 / currentSessionId）只在这份产物里存在，
  // lib/redteam/client.js 是它的可读源形，不含宿主接线。
  {
    file: "client.js", dialect: "panel", what: "会话跟随：状态与取 id 助手",
    anchor: "    const [seen, setSeen] = import_react2.default.useState(null);\n",
    mode: "after",
    text:
      "    /* [dsh-purge-plus] 本会话 → 靶标绑定：启动时问后端「我这个会话绑的是谁」，\n" +
      "       有绑定就切过去。取不到 sessionId 时退化成原来的「跟全局指针」。 */\n" +
      "    const rtSessionId = () => {\n" +
      "      try {\n" +
      "        return props.sessionId || currentSessionId(host2 && host2.sessions) || \"\";\n" +
      "      } catch (e) {\n" +
      "        return \"\";\n" +
      "      }\n" +
      "    };\n" +
      "    const [boundEng, setBoundEng] = import_react2.default.useState(null);\n" +
      "    const [following, setFollowing] = import_react2.default.useState(false);\n",
  },
  {
    file: "client.js", dialect: "panel", what: "会话跟随：启动时优先用绑定",
    anchor:
      "          setEngagements(r.engagements || []);\n" +
      "          const id = r.current || r.engagements && r.engagements[0] && r.engagements[0].id || null;\n" +
      "          if (id) {\n" +
      "            setEng(id);\n" +
      "            loadSnapshot(id);\n" +
      "          }\n",
    mode: "replace",
    text:
      "          setEngagements(r.engagements || []);\n" +
      "          const fallbackId = r.current || r.engagements && r.engagements[0] && r.engagements[0].id || null;\n" +
      "          const applyId = (id) => {\n" +
      "            if (!id) return;\n" +
      "            setEng(id);\n" +
      "            loadSnapshot(id);\n" +
      "          };\n" +
      "          /* [dsh-purge-plus] 本会话绑定优先于全局「当前靶标」指针：\n" +
      "             多会话并行时指针只有一个，跟着它会把别人的靶标显示到自己面板上。 */\n" +
      "          const sid0 = rtSessionId();\n" +
      "          if (!sid0) return applyId(fallbackId);\n" +
      "          api({ op: \"sessionBinding\", session: sid0 }).then((b) => {\n" +
      "            if (b && b.ok === true && b.bound) {\n" +
      "              setBoundEng(b.bound);\n" +
      "              setFollowing(true);\n" +
      "              return applyId(b.bound);\n" +
      "            }\n" +
      "            applyId(fallbackId);\n" +
      "          }).catch(() => applyId(fallbackId));\n",
  },
  {
    file: "client.js", dialect: "panel", what: "会话跟随：切换靶标时一并落盘",
    anchor:
      "              api({\n" +
      "                op: \"activateEngagement\",\n" +
      "                engagement: e.target.value\n" +
      "              }).catch(() => {\n" +
      "              });\n",
    mode: "replace",
    text:
      "              /* [dsh-purge-plus] 带上 session：后端顺手写 sessions.json，\n" +
      "                 重启后面板仍知道「这个会话用的是哪个靶标」。 */\n" +
      "              const sid1 = rtSessionId();\n" +
      "              const picked = (engagements.find((x) => x.id === e.target.value) || {}).name;\n" +
      "              setFollowing(Boolean(sid1));\n" +
      "              setBoundEng(sid1 ? e.target.value : null);\n" +
      "              api({\n" +
      "                op: \"activateEngagement\",\n" +
      "                engagement: e.target.value,\n" +
      "                session: sid1 || void 0,\n" +
      "                name: picked\n" +
      "              }).catch(() => {\n" +
      "              });\n",
  },
  {
    file: "client.js", dialect: "panel", what: "会话跟随：跟随徽章",
    anchor:
      "            (x) => h2(\"option\", { key: x.id, value: x.id }, x.name || x.id || \"\\u672A\\u547D\\u540D\")\n" +
      "          )\n" +
      "        ),\n",
    mode: "after",
    text:
      "        following && boundEng ? h2(\n" +
      "          \"button\",\n" +
      "          {\n" +
      "            className: \"rt-btn\",\n" +
      "            title: \"\\u672C\\u9762\\u677F\\u8DDF\\u968F\\u672C\\u4F1A\\u8BDD\\u7ED1\\u5B9A\\u7684\\u9776\\u6807\\uFF1B\\u70B9\\u4E00\\u4E0B\\u89E3\\u7ED1\\uFF0C\\u6539\\u4E3A\\u8DDF\\u968F\\u5168\\u5C40\\u300C\\u5F53\\u524D\\u9776\\u6807\\u300D\",\n" +
      "            onClick: () => {\n" +
      "              const sid2 = rtSessionId();\n" +
      "              if (sid2) api({ op: \"bindSessionEngagement\", session: sid2, engagement: \"\" }).catch(() => {\n" +
      "              });\n" +
      "              setFollowing(false);\n" +
      "              setBoundEng(null);\n" +
      "            }\n" +
      "          },\n" +
      "          \"\\u8DDF\\u968F\\u672C\\u4F1A\\u8BDD\"\n" +
      "        ) : null,\n",
  },

  // ── P2：会话 → 靶标关系图（SessionMap）────────────────────────────
  {
    file: "lib/redteam/client.js", dialect: "redteam", src: "session-map.js",
    what: "会话关系图组件", anchor: "    function AgentsTab(props) {", mode: "before",
  },
  {
    file: "client.js", dialect: "panel", src: "session-map.js",
    what: "会话关系图组件（面板内嵌版）", anchor: "  function AgentsTab(props) {", mode: "before",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", what: "会话关系图挂进智能体页",
    anchor: "          h(ConcurrencyCard, { concurrency, onSaved: load }),", mode: "before",
    text: "          h(SessionMap, { refreshKey: refreshKey, sessionId: props.sessionId, onPick: props.onPick }),\n",
  },
  {
    file: "client.js", dialect: "panel", what: "会话关系图挂进智能体页（面板内嵌版）",
    anchor: "        h2(ConcurrencyCard, { concurrency, onSaved: load }),", mode: "before",
    text: "        h2(SessionMap, { refreshKey, sessionId: props.sessionId, onPick: props.onPick }),\n",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", src: "session-map.css",
    what: "会话关系图样式", mode: "after",
    anchor: ".rt-tabs{display:flex;flex-wrap:wrap;gap:2px;padding:6px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}\n",
  },
  {
    file: "client.js", dialect: "panel", src: "session-map.css",
    what: "会话关系图样式（面板内嵌版）", mode: "after",
    anchor: ".rt-tabs{display:flex;flex-wrap:wrap;gap:2px;padding:6px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}\n",
  },

  // ── P20：报告文档视图（markdown 就地渲染）──────────────────────────
  {
    file: "lib/redteam/client.js", dialect: "redteam", src: "md-render.js",
    what: "markdown 渲染器", mode: "before",
    anchor: "    function FindingsTab(props) {",
  },
  {
    file: "client.js", dialect: "panel", src: "md-render.js",
    what: "markdown 渲染器（面板内嵌版）", mode: "before",
    anchor: "  function FindingsTab(props) {",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", src: "md-render.css",
    what: "markdown 渲染样式", mode: "after",
    anchor: ".rt-tabs{display:flex;flex-wrap:wrap;gap:2px;padding:6px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}\n",
  },
  {
    file: "client.js", dialect: "panel", src: "md-render.css",
    what: "markdown 渲染样式（面板内嵌版）", mode: "after",
    anchor: ".rt-tabs{display:flex;flex-wrap:wrap;gap:2px;padding:6px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}\n",
  },

  // ── P3：「现在在等谁」卡片 ───────────────────────────────────────
  // 与 SessionMap 同页相邻：一个回答「谁在打哪个靶标」，一个回答「谁卡住了在等我」。
  {
    file: "lib/redteam/client.js", dialect: "redteam", src: "attention-card.js",
    what: "等谁卡片组件", anchor: "    function AgentsTab(props) {", mode: "before",
  },
  {
    file: "client.js", dialect: "panel", src: "attention-card.js",
    what: "等谁卡片组件（面板内嵌版）", anchor: "  function AgentsTab(props) {", mode: "before",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", what: "等谁卡片挂进智能体页",
    anchor: "          h(ConcurrencyCard, { concurrency, onSaved: load }),", mode: "before",
    text: "          h(AttentionCard, { engagement: eng, refreshKey: refreshKey, sessionId: props.sessionId }),\n",
  },
  {
    file: "client.js", dialect: "panel", what: "等谁卡片挂进智能体页（面板内嵌版）",
    anchor: "        h2(ConcurrencyCard, { concurrency, onSaved: load }),", mode: "before",
    text: "        h2(AttentionCard, { engagement: eng, refreshKey, sessionId: props.sessionId }),\n",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", what: "会话关系图：点节点切靶标",
    anchor: "      else if (st.tab === 'agents' || st.tab === 'prompts') body = h(AgentsTab, { engagement: eng, refreshKey: refreshKey })",
    mode: "replace",
    text:
      "      else if (st.tab === 'agents' || st.tab === 'prompts') body = h(AgentsTab, {\n" +
      "        engagement: eng, refreshKey: refreshKey,\n" +
      "        sessionId: (typeof rtSessionId === 'function' ? rtSessionId() : ''),\n" +
      "        /* [dsh-purge-plus] 会话图上的靶标可点：点了就切过去（safe 的图只能看） */\n" +
      "        onPick: (id) => { if (!id) return; setEng(id); loadSnapshot(id) },\n" +
      "      })",
  },
  {
    file: "client.js", dialect: "panel", what: "会话关系图：点节点切靶标（面板内嵌版）",
    anchor: '      body = h2(AgentsTab, { engagement: eng, refreshKey });',
    mode: "replace",
    text:
      "      body = h2(AgentsTab, {\n" +
      "        engagement: eng,\n" +
      "        refreshKey,\n" +
      "        sessionId: (typeof rtSessionId === \"function\" ? rtSessionId() : \"\"),\n" +
      "        /* [dsh-purge-plus] 会话图上的靶标可点：点了就切过去（safe 的图只能看） */\n" +
      "        onPick: (id) => {\n" +
      "          if (!id) return;\n" +
      "          setEng(id);\n" +
      "          loadSnapshot(id);\n" +
      "        }\n" +
      "      });",
  },

  // ── P4：一级导航分组 + 二级页签 ──────────────────────────────────
  // safe 的导航是左侧竖排（rt-nav-groups），依赖 rt-chrome/rt-nav/rt-cmd 三层
  // 布局重写。本包是右侧浮动 dock，默认宽约 420px，竖排导航会吃掉一成多的内容
  // 宽度，所以改成横向 chips：一级一行，组内多页时下面再出一行二级页签。
  //
  // 三处插入点各有讲究：
  //   CSS    追加在 .rt-tabs 规则之后（同一段模板串里，不需要额外 import）
  //   defs   插在 tabs 表之后、const full 之前 —— 要在渲染前就位，也要能用 unreadOf
  //   row    替换页签栏的**开头**，末尾的 `})),` 原样保留：括号因此自动配平
  {
    file: "lib/redteam/client.js", dialect: "redteam", src: "nav-groups.css",
    what: "导航分组样式", mode: "after",
    anchor: ".rt-tabs{display:flex;flex-wrap:wrap;gap:2px;padding:6px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}\n",
  },
  {
    file: "client.js", dialect: "panel", src: "nav-groups.css",
    what: "导航分组样式（面板内嵌版）", mode: "after",
    anchor: ".rt-tabs{display:flex;flex-wrap:wrap;gap:2px;padding:6px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}\n",
  },
  // ── P6：态势首页 ────────────────────────────────────────────────
  // 三处必须一起改，否则会出现「页签在但点开空白」或「分组里有但页签表里没有」：
  //   ① tabs 表（渲染二级页签用）
  //   ② body 分发（真正渲染哪个组件）
  //   ③ 组件本体
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "replace",
    what: "页签表加工作总览",
    anchor: "      const tabs = [\n        ['assets', '资产测绘'], ['env', '环境适配'], ['agents', '智能体'], ['sessions', '会话隧道'],\n",
    text:
      "      const tabs = [\n" +
      "        ['overview', '工作总览'],\n" +
      "        ['assets', '资产测绘'], ['env', '环境适配'], ['agents', '智能体'], ['sessions', '会话隧道'],\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "replace",
    what: "页签表加工作总览（面板内嵌版）",
    anchor: '    const tabs = [\n      ["assets", "\\u8D44\\u4EA7\\u6D4B\\u7ED8"],\n',
    text:
      "    const tabs = [\n" +
      '      ["overview", "\\u5DE5\\u4F5C\\u603B\\u89C8"],\n' +
      '      ["assets", "\\u8D44\\u4EA7\\u6D4B\\u7ED8"],\n',
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", src: "overview-tab.js",
    what: "态势首页组件", mode: "before",
    anchor: "    function FindingsTab(props) {",
  },
  {
    file: "client.js", dialect: "panel", src: "overview-tab.js",
    what: "态势首页组件（面板内嵌版）", mode: "before",
    anchor: "  function FindingsTab(props) {",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "before",
    what: "态势首页分发",
    anchor: "      else if (!eng) {\n",
    text:
      "      /* 首页是全局页：没有靶标也能打开（组件自己会提示去建靶标）。\n" +
      "         放在 !eng 分支之前，否则选中靶标之前点首页什么都不发生。 */\n" +
      "      else if (st.tab === 'overview') body = h(OverviewTab, {\n" +
      "        engagement: eng, refreshKey: refreshKey, onGo: (t) => goTab(t),\n" +
      "      })\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "before",
    what: "态势首页分发（面板内嵌版）",
    anchor: "    else if (!eng) {\n",
    text:
      "    else if (st.tab === \"overview\")\n" +
      "      body = h2(OverviewTab, {\n" +
      "        engagement: eng,\n" +
      "        refreshKey,\n" +
      "        onGo: (t) => goTab(t)\n" +
      "      });\n",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", src: "nav-groups-defs.js",
    what: "导航分组定义", mode: "before",
    anchor: "      const full = isFullWindow()\n",
  },
  {
    file: "client.js", dialect: "panel", src: "nav-groups-defs.js",
    what: "导航分组定义（面板内嵌版）", mode: "before",
    anchor: "    const full = isFullWindow();\n",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", src: "nav-groups-row.js",
    what: "分组行 + 二级页签过滤", mode: "replace",
    anchor: "        h('div', { className: 'rt-tabs', role: 'tablist' }, tabs.map((t) => {",
  },
  {
    file: "client.js", dialect: "panel", src: "nav-groups-row.js",
    what: "分组行 + 二级页签过滤（面板内嵌版）", mode: "replace",
    anchor: '      h2(\n        "div",\n        { className: "rt-tabs", role: "tablist" },\n        tabs.map((t) => {',
  },

  // ── P5：站内全屏 ────────────────────────────────────────────────
  // 顺序有讲究，别调换：
  //   ① 钩子必须插在 Panel **之前**（同作用域，函数声明会提升，但读代码的人先看到定义）
  //   ② `const full = isFullWindow()` 这一行此时还在，下面那条 replace 才匹配得到
  //   ③ shellProps.ref 必须在 return 之前赋值
  {
    file: "lib/redteam/client.js", dialect: "redteam", src: "fullscreen-hook.js",
    what: "站内全屏钩子", mode: "before",
    anchor: "    function Panel(props) {",
  },
  {
    file: "client.js", dialect: "panel", src: "fullscreen-hook.js",
    what: "站内全屏钩子（面板内嵌版）", mode: "before",
    anchor: "  function Panel(props) {",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "after",
    what: "全屏请求事件常量",
    anchor:
      "    const isFullWindow = () => {\n" +
      "      try { return String(window.location.hash || '') === '#redteam-full' } catch { return false }\n" +
      "    }\n",
    text:
      "    /* [dsh-purge-plus] P5：站内全屏请求事件。\n" +
      "       给「别的地方想让工作台铺满」留一个口子（侧栏图标、授权后跳转、引导），\n" +
      "       不用去猜组件内部状态，也不用 props 层层往下传。 */\n" +
      "    const FULL_REQUEST_EVENT = 'rt-open-full'\n" +
      "    /* 请求原地铺满，返回**是否被接住**。事件设成 cancelable，\n" +
      "       工作台挂载时会在监听器里 preventDefault 表示「我处理了」。\n" +
      "       返回 false 说明工作台根本没挂载（比如面板收起了），\n" +
      "       调用方可以据此退回开新窗口，而不是让按钮点了没反应。 */\n" +
      "    const requestInPlaceFull = () => {\n" +
      "      try {\n" +
      "        const ev = new Event(FULL_REQUEST_EVENT, { cancelable: true })\n" +
      "        window.dispatchEvent(ev)\n" +
      "        return Boolean(ev.defaultPrevented)\n" +
      "      } catch (e) { return false }\n" +
      "    }\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "after",
    what: "全屏请求事件常量（面板内嵌版）",
    anchor:
      '  const isFullWindow = () => {\n' +
      '    try {\n' +
      '      return String(window.location.hash || "") === "#redteam-full";\n' +
      '    } catch {\n' +
      '      return false;\n' +
      '    }\n' +
      '  };\n',
    text:
      '  /* [dsh-purge-plus] P5：站内全屏请求事件。 */\n' +
      '  const FULL_REQUEST_EVENT = "rt-open-full";\n' +
      '  /* 请求原地铺满，返回是否被接住（工作台挂载时会 preventDefault）。 */\n' +
      '  const requestInPlaceFull = () => {\n' +
      '    try {\n' +
      '      const ev = new Event(FULL_REQUEST_EVENT, { cancelable: true });\n' +
      '      window.dispatchEvent(ev);\n' +
      '      return Boolean(ev.defaultPrevented);\n' +
      '    } catch (e) {\n' +
      '      return false;\n' +
      '    }\n' +
      '  };\n',
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "replace",
    what: "全屏状态与进出",
    anchor: "      const full = isFullWindow()\n",
    text:
      "      /* [dsh-purge-plus] P5 站内全屏：不再 window.open 开新窗口。\n" +
      "         桌面端开出来的是裸浏览器窗口，宿主的会话、主题变量、事件通道全丢，\n" +
      "         用户点「全面浏览」等于把上下文扔到另一个窗口里。\n" +
      "         shellRef 要挂在**所有形态**的外壳上：钩子在 full 还是 false 的时候\n" +
      "         就要拿它调 requestFullscreen()，只在 full 分支挂 ref 永远拿不到元素。 */\n" +
      "      const shellRef = React.useRef(null)\n" +
      "      const fullscreen = useWorkbenchFullscreen(React, shellRef)\n" +
      "      const full = fullscreen.expanded || isFullWindow()\n" +
      "      /* 接住别处的「铺满」请求：preventDefault 就是在告诉调用方「我处理了」。\n" +
      "         顺带把面板打开 —— 收起状态下铺满一个 display:none 的壳子等于没反应。 */\n" +
      "      React.useEffect(() => {\n" +
      "        const onFull = (event) => {\n" +
      "          try { if (event && event.preventDefault) event.preventDefault() } catch (e) { /* ignore */ }\n" +
      "          setUI({ open: true })\n" +
      "          void fullscreen.enter()\n" +
      "        }\n" +
      "        window.addEventListener(FULL_REQUEST_EVENT, onFull)\n" +
      "        return () => window.removeEventListener(FULL_REQUEST_EVENT, onFull)\n" +
      "      }, [fullscreen.enter])\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "replace",
    what: "全屏状态与进出（面板内嵌版）",
    anchor: "    const full = isFullWindow();\n",
    text:
      "    /* [dsh-purge-plus] P5 站内全屏（面板内嵌版）：同上，只是 hooks 走 import_react2。 */\n" +
      "    const shellRef = import_react2.default.useRef(null);\n" +
      "    const fullscreen = useWorkbenchFullscreen(import_react2.default, shellRef);\n" +
      "    const full = fullscreen.expanded || isFullWindow();\n" +
      "    /* 接住别处的「铺满」请求（preventDefault = 我处理了），顺带把面板打开。 */\n" +
      "    import_react2.default.useEffect(() => {\n" +
      "      const onFull = (event) => {\n" +
      "        try { if (event && event.preventDefault) event.preventDefault(); } catch (e) { /* ignore */ }\n" +
      "        setUI({ open: true });\n" +
      "        void fullscreen.enter();\n" +
      "      };\n" +
      "      window.addEventListener(FULL_REQUEST_EVENT, onFull);\n" +
      "      return () => window.removeEventListener(FULL_REQUEST_EVENT, onFull);\n" +
      "    }, [fullscreen.enter]);\n",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "replace",
    what: "进入全屏",
    anchor:
      "        try { window.open(window.location.href.split('#')[0] + '#redteam-full', '_blank', 'noopener') } catch (e) { setErr('无法打开新窗口：' + ((e && e.message) || e)) }\n",
    text:
      "        void fullscreen.enter()\n" +
      "        /* 嵌入形态没有 CSS 兜底（宿主 .dshpp-native 的 layout containment 会把\n" +
      "           position:fixed 关进右侧栏），原生全屏是唯一手段。浏览器没批的话\n" +
      "           （权限策略、手势丢失），退回开新窗口 —— 至少功能还在，\n" +
      "           而不是点一下什么都不发生。 */\n" +
      "        if (!embedded) return\n" +
      "        setTimeout(() => {\n" +
      "          try {\n" +
      "            if (document.fullscreenElement) return\n" +
      "            void fullscreen.exit()\n" +
      "            window.open(window.location.href.split('#')[0] + '#redteam-full', '_blank', 'noopener')\n" +
      "          } catch (e) { /* 弹窗被拦 */ }\n" +
      "        }, 250)\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "replace",
    what: "进入全屏（面板内嵌版）",
    anchor:
      '      try {\n' +
      '        window.open(\n' +
      '          window.location.href.split("#")[0] + "#redteam-full",\n' +
      '          "_blank",\n' +
      '          "noopener"\n' +
      '        );\n' +
      '      } catch (e) {\n' +
      '        setErr("\\u65E0\\u6CD5\\u6253\\u5F00\\u65B0\\u7A97\\u53E3\\uFF1A" + (e && e.message || e));\n' +
      '      }\n',
    text:
      "      void fullscreen.enter();\n" +
      "      /* 嵌入形态没有 CSS 兜底（宿主 layout containment 会把 fixed 关进右栏），\n" +
      "         原生全屏是唯一手段；没批就退回开新窗口，别让按钮点了没反应。 */\n" +
      "      if (!embedded) return;\n" +
      "      setTimeout(() => {\n" +
      "        try {\n" +
      "          if (document.fullscreenElement) return;\n" +
      "          void fullscreen.exit();\n" +
      '          window.open(window.location.href.split("#")[0] + "#redteam-full", "_blank", "noopener");\n' +
      "        } catch (e) { /* \u5F39\u7A97\u88AB\u62E6 */ }\n" +
      "      }, 250);\n",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "replace",
    what: "退出全屏",
    anchor:
      "        /* 优先关掉脚本打开的窗口；关不掉就退回带侧栏的普通界面 */\n" +
      "        try { window.close() } catch (e) { /* 非脚本打开的窗口无法关闭 */ }\n" +
      "        try {\n" +
      "          if (window.location.hash) {\n" +
      "            window.location.hash = ''\n" +
      "            window.location.reload()\n" +
      "          }\n" +
      "        } catch (e) { /* ignore */ }\n",
    text:
      "        /* [dsh-purge-plus] P5：退出走钩子，原生与 CSS 两层一起收。\n" +
      "           原来那套是 window.close() + 改 hash + reload —— reload 会把当前页签、\n" +
      "           滚动位置、没提交的表单全丢掉，退个全屏不该有这种代价。 */\n" +
      "        void fullscreen.exit()\n" +
      "        if (isFullWindow()) {\n" +
      "          try { window.history.replaceState(null, '', window.location.pathname + window.location.search) } catch (e) { /* ignore */ }\n" +
      "        }\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "replace",
    what: "退出全屏（面板内嵌版）",
    anchor:
      "      try {\n" +
      "        window.close();\n" +
      "      } catch (e) {\n" +
      "      }\n" +
      "      try {\n" +
      "        if (window.location.hash) {\n" +
      '          window.location.hash = "";\n' +
      "          window.location.reload();\n" +
      "        }\n" +
      "      } catch (e) {\n" +
      "      }\n",
    text:
      "      /* [dsh-purge-plus] P5：退出走钩子，原生与 CSS 两层一起收；不再 reload 页面。 */\n" +
      "      void fullscreen.exit();\n" +
      "      if (isFullWindow()) {\n" +
      '        try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch (e) { /* ignore */ }\n' +
      "      }\n",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "replace",
    what: "Escape 归钩子",
    anchor:
      "      React.useEffect(() => {\n" +
      "        if (!full) return undefined\n" +
      "        const onKey = (e) => { if (e.key === 'Escape') exitFull() }\n" +
      "        window.addEventListener('keydown', onKey)\n" +
      "        return () => window.removeEventListener('keydown', onKey)\n" +
      "      }, [full])\n",
    text:
      "      /* Escape 交给钩子统一处理：它会跳过嵌套浮层，\n" +
      "         免得按一次 Esc 把底下的工作台和上面的弹窗一起收掉。\n" +
      "         这里只补钩子管不到的一种情形 —— 直接用 #redteam-full 打开、钩子没展开过。 */\n" +
      "      React.useEffect(() => {\n" +
      "        if (!isFullWindow() || embedded) return undefined\n" +
      "        const onKey = (e) => { if (e.key === 'Escape') exitFull() }\n" +
      "        window.addEventListener('keydown', onKey)\n" +
      "        return () => window.removeEventListener('keydown', onKey)\n" +
      "      }, [embedded])\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "replace",
    what: "Escape 归钩子（面板内嵌版）",
    anchor:
      "    import_react2.default.useEffect(() => {\n" +
      "      if (!full) return void 0;\n" +
      "      const onKey = (e) => {\n" +
      '        if (e.key === "Escape") exitFull();\n' +
      "      };\n" +
      '      window.addEventListener("keydown", onKey);\n' +
      '      return () => window.removeEventListener("keydown", onKey);\n' +
      "    }, [full]);\n",
    text:
      "    /* Escape 交给钩子统一处理（会跳过嵌套浮层）。这里只补 #redteam-full 直开的情形。 */\n" +
      "    import_react2.default.useEffect(() => {\n" +
      "      if (!isFullWindow() || embedded) return void 0;\n" +
      "      const onKey = (e) => {\n" +
      '        if (e.key === "Escape") exitFull();\n' +
      "      };\n" +
      '      window.addEventListener("keydown", onKey);\n' +
      '      return () => window.removeEventListener("keydown", onKey);\n' +
      "    }, [embedded]);\n",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "replace",
    what: "外壳形态：嵌入时不套 .rt-full",
    anchor: "      const shellProps = full\n        ? { className: 'rt-full', style: { display: 'flex' } }\n",
    text:
      "      /* 嵌入形态不套 .rt-full：宿主 .dshpp-native 用了 container-type:inline-size，\n" +
      "         它带的 layout containment 会给 position:fixed 建包含块，.rt-full 于是只铺满\n" +
      "         右侧栏而不是窗口。嵌入形态改用原生全屏（浏览器把它提到 top layer，\n" +
      "         不受包含块影响），CSS 兜底那层对它没有意义。 */\n" +
      "      const shellProps = full && !embedded\n" +
      "        ? { className: 'rt-full', style: { display: 'flex' } }\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "replace",
    what: "外壳形态：嵌入时不套 .rt-full（面板内嵌版）",
    anchor:
      '    const shellProps = full ? { className: "rt-full", style: { display: "flex" } } : embedded ? {\n',
    text:
      "    /* 嵌入形态不套 .rt-full：宿主 .dshpp-native 的 layout containment 会\n" +
      "       把 position:fixed 关进右侧栏。嵌入形态改用原生全屏。 */\n" +
      '    const shellProps = full && !embedded ? { className: "rt-full", style: { display: "flex" } } : embedded ? {\n',
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "before",
    what: "外壳 ref",
    anchor: "      return h('div', shellProps,\n",
    text: "      shellProps.ref = shellRef\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "before",
    what: "外壳 ref（面板内嵌版）",
    anchor: '    return h2(\n      "div",\n      shellProps,\n',
    text: "    shellProps.ref = shellRef;\n",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "replace",
    what: "全屏样式：让开桌面标题栏 + 嵌入原生全屏兜底",
    anchor: ".rt-full{position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;\n",
    text:
      ".rt-full{position:fixed;top:var(--dsh-frame-chrome-top,var(--dsh-frame-top-clearance,var(--dsh-windows-titlebar-height,0px)));right:0;bottom:0;left:0;z-index:60;display:flex;flex-direction:column;\n" +
      "/* 嵌入形态靠原生全屏：Chromium 的 UA 样式会被 .rt-embedded 的 position:relative 压住，\n" +
      "   这里显式把它摆回视口。:-webkit-full-screen 是 Safari 的历史写法，不能省。 */\n" +
      ".rt-dock.rt-embedded:fullscreen,.rt-dock.rt-embedded:-webkit-full-screen{position:fixed;inset:0;width:100%;height:100%;z-index:60;background:var(--dsw-alias-bg-base)}\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "replace",
    what: "全屏样式：让开桌面标题栏 + 嵌入原生全屏兜底（面板内嵌版）",
    anchor: ".rt-full{position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;\n",
    text:
      ".rt-full{position:fixed;top:var(--dsh-frame-chrome-top,var(--dsh-frame-top-clearance,var(--dsh-windows-titlebar-height,0px)));right:0;bottom:0;left:0;z-index:60;display:flex;flex-direction:column;\n" +
      ".rt-dock.rt-embedded:fullscreen,.rt-dock.rt-embedded:-webkit-full-screen{position:fixed;inset:0;width:100%;height:100%;z-index:60;background:var(--dsw-alias-bg-base)}\n",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "replace",
    what: "退出全屏按钮文案",
    anchor:
      "          full ? h('button', { className: 'rt-btn', title: '回到带侧栏的普通界面（或按 Esc）', onClick: exitFull }, '退出全面浏览') : null,\n",
    text:
      "          full ? h('button', { className: 'rt-btn', title: embedded ? '退出全屏（或按 Esc）' : '回到带侧栏的普通界面（或按 Esc）', onClick: exitFull }, embedded ? '退出全屏' : '退出全面浏览') : null,\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "replace",
    what: "退出全屏按钮文案（面板内嵌版）",
    anchor:
      "        full ? h2(\n" +
      '          "button",\n' +
      "          {\n" +
      '            className: "rt-btn",\n' +
      '            title: "\\u56DE\\u5230\\u5E26\\u4FA7\\u680F\\u7684\\u666E\\u901A\\u754C\\u9762\\uFF08\\u6216\\u6309 Esc\\uFF09",\n' +
      "            onClick: exitFull\n" +
      "          },\n" +
      '          "\\u9000\\u51FA\\u5168\\u9762\\u6D4F\\u89C8"\n' +
      "        ) : null,\n",
    text:
      "        full ? h2(\n" +
      '          "button",\n' +
      "          {\n" +
      '            className: "rt-btn",\n' +
      '            title: embedded ? "\\u9000\\u51FA\\u5168\\u5C4F\\uFF08\\u6216\\u6309 Esc\\uFF09" : "\\u56DE\\u5230\\u5E26\\u4FA7\\u680F\\u7684\\u666E\\u901A\\u754C\\u9762\\uFF08\\u6216\\u6309 Esc\\uFF09",\n' +
      "            onClick: exitFull\n" +
      "          },\n" +
      '          embedded ? "\\u9000\\u51FA\\u5168\\u5C4F" : "\\u9000\\u51FA\\u5168\\u9762\\u6D4F\\u89C8"\n' +
      "        ) : null,\n",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "replace",
    what: "进入全屏按钮文案",
    anchor:
      "          (full || embedded) ? null : h('button', { className: 'rt-btn', title: '在新浏览器窗口打开完整控制台', onClick: openFull }, '全面浏览'),\n",
    text:
      "          full ? null : h('button', { className: 'rt-btn', title: embedded ? '用浏览器原生全屏铺满屏幕（Esc 退出）' : '铺满当前窗口，不新开窗口（Esc 退出）', onClick: openFull }, embedded ? '全屏' : '全面浏览'),\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "replace",
    what: "进入全屏按钮文案（面板内嵌版）",
    anchor:
      "        full || embedded ? null : h2(\n" +
      '          "button",\n' +
      "          {\n" +
      '            className: "rt-btn",\n' +
      '            title: "\\u5728\\u65B0\\u6D4F\\u89C8\\u5668\\u7A97\\u53E3\\u6253\\u5F00\\u5B8C\\u6574\\u63A7\\u5236\\u53F0",\n' +
      "            onClick: openFull\n" +
      "          },\n" +
      '          "\\u5168\\u9762\\u6D4F\\u89C8"\n' +
      "        ),\n",
    text:
      "        full ? null : h2(\n" +
      '          "button",\n' +
      "          {\n" +
      '            className: "rt-btn",\n' +
      '            title: embedded ? "\\u7528\\u6D4F\\u89C8\\u5668\\u539F\\u751F\\u5168\\u5C4F\\u94FA\\u6EE1\\u5C4F\\u5E55\\uFF08Esc \\u9000\\u51FA\\uFF09" : "\\u94FA\\u6EE1\\u5F53\\u524D\\u7A97\\u53E3\\uFF0C\\u4E0D\\u65B0\\u5F00\\u7A97\\u53E3\\uFF08Esc \\u9000\\u51FA\\uFF09",\n' +
      "            onClick: openFull\n" +
      "          },\n" +
      '          embedded ? "\\u5168\\u5C4F" : "\\u5168\\u9762\\u6D4F\\u89C8"\n' +
      "        ),\n",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "replace",
    what: "全屏标题角标",
    anchor:
      "            full ? h('span', { className: 'rt-tag', style: { marginLeft: 6 } }, '独立窗口') : null),\n",
    text:
      "            full ? h('span', { className: 'rt-tag', style: { marginLeft: 6 } }, '全屏') : null),\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "replace",
    what: "全屏标题角标（面板内嵌版）",
    anchor:
      "          full ? h2(\n" +
      '            "span",\n' +
      '            { className: "rt-tag", style: { marginLeft: 6 } },\n' +
      '            "\\u72EC\\u7ACB\\u7A97\\u53E3"\n' +
      "          ) : null\n",
    text:
      "          full ? h2(\n" +
      '            "span",\n' +
      '            { className: "rt-tag", style: { marginLeft: 6 } },\n' +
      '            "\\u5168\\u5C4F"\n' +
      "          ) : null\n",
  },

  // ── P5 收口：所有「开新窗口看完整控制台」的入口改走原地铺满 ──────────
  // 只装钩子不改入口 = 功能还在原地，但没人调用它。这三个入口是用户真正会点的：
  //   ① 侧栏图标 FullButton
  //   ② 授权通过后跳「全面浏览」
  //   ③ 授权弹窗里点「同意并全面浏览」
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "replace",
    what: "侧栏全面浏览按钮",
    anchor:
      "        try { window.open(window.location.href.split('#')[0] + '#redteam-full', '_blank', 'noopener') } catch { /* 被浏览器拦截 */ }\n",
    text:
      "        /* [dsh-purge-plus] P5：先请求原地铺满；工作台没挂载才退回开新窗口。 */\n" +
      "        if (requestInPlaceFull()) return\n" +
      "        try { window.open(window.location.href.split('#')[0] + '#redteam-full', '_blank', 'noopener') } catch { /* 被浏览器拦截 */ }\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "replace",
    what: "侧栏全面浏览按钮（面板内嵌版）",
    anchor:
      "    const open = () => {\n" +
      "      try {\n" +
      "        window.open(\n" +
      '          window.location.href.split("#")[0] + "#redteam-full",\n' +
      '          "_blank",\n' +
      '          "noopener"\n' +
      "        );\n" +
      "      } catch {\n" +
      "      }\n" +
      "    };\n",
    text:
      "    const open = () => {\n" +
      "      /* [dsh-purge-plus] P5：先请求原地铺满；工作台没挂载才退回开新窗口。 */\n" +
      "      if (requestInPlaceFull()) return;\n" +
      "      try {\n" +
      "        window.open(\n" +
      '          window.location.href.split("#")[0] + "#redteam-full",\n' +
      '          "_blank",\n' +
      '          "noopener"\n' +
      "        );\n" +
      "      } catch {\n" +
      "      }\n" +
      "    };\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "replace",
    what: "授权后跳全面浏览",
    anchor:
      '    if (pending === "full") {\n' +
      "      try {\n" +
      "        window.open(\n" +
      '          window.location.href.split("#")[0] + "#redteam-full",\n' +
      '          "_blank",\n' +
      '          "noopener"\n' +
      "        );\n" +
      "      } catch {\n" +
      "      }\n" +
      "    }\n",
    text:
      '    if (pending === "full") {\n' +
      "      /* [dsh-purge-plus] P5：授权后跳「全面浏览」也先走原地铺满。 */\n" +
      "      if (!requestInPlaceFull()) {\n" +
      "        try {\n" +
      "          window.open(\n" +
      '            window.location.href.split("#")[0] + "#redteam-full",\n' +
      '            "_blank",\n' +
      '            "noopener"\n' +
      "          );\n" +
      "        } catch {\n" +
      "        }\n" +
      "      }\n" +
      "    }\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "replace",
    what: "授权弹窗「同意并全面浏览」",
    anchor:
      '              if (kind === "full") {\n' +
      "                try {\n" +
      "                  window.open(\n" +
      '                    window.location.href.split("#")[0] + "#redteam-full",\n' +
      '                    "_blank",\n' +
      '                    "noopener"\n' +
      "                  );\n" +
      "                } catch {\n" +
      "                }\n" +
      "              }\n",
    text:
      '              if (kind === "full") {\n' +
      "                /* [dsh-purge-plus] P5：同上，先原地铺满。 */\n" +
      "                if (!requestInPlaceFull()) {\n" +
      "                  try {\n" +
      "                    window.open(\n" +
      '                      window.location.href.split("#")[0] + "#redteam-full",\n' +
      '                      "_blank",\n' +
      '                      "noopener"\n' +
      "                    );\n" +
      "                  } catch {\n" +
      "                  }\n" +
      "                }\n" +
      "              }\n",
  },
  // ── P8 / P12：四段式报告 + 证据账本 ─────────────────────────────
  // 三个页签级别的改动都要**两份产物**一起做，否则「面板里点开」与
  // 「全面浏览新窗口」会看到不一样的页签集合。
  {
    file: "lib/redteam/client.js", dialect: "redteam", src: "report-v2.css",
    what: "四段式报告样式", mode: "after",
    anchor: ".rt-tabs{display:flex;flex-wrap:wrap;gap:2px;padding:6px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}\n",
  },
  {
    file: "client.js", dialect: "panel", src: "report-v2.css",
    what: "四段式报告样式（面板内嵌版）", mode: "after",
    anchor: ".rt-tabs{display:flex;flex-wrap:wrap;gap:2px;padding:6px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}\n",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", src: "evidence-ledger.css",
    what: "证据账本样式", mode: "after",
    anchor: ".rt-tabs{display:flex;flex-wrap:wrap;gap:2px;padding:6px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}\n",
  },
  {
    file: "client.js", dialect: "panel", src: "evidence-ledger.css",
    what: "证据账本样式（面板内嵌版）", mode: "after",
    anchor: ".rt-tabs{display:flex;flex-wrap:wrap;gap:2px;padding:6px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}\n",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", src: "report-v2.js",
    what: "四段式报告组件", mode: "before",
    anchor: "    function FindingsTab(props) {",
  },
  {
    file: "client.js", dialect: "panel", src: "report-v2.js",
    what: "四段式报告组件（面板内嵌版）", mode: "before",
    anchor: "  function FindingsTab(props) {",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", src: "evidence-ledger-tab.js",
    what: "证据账本组件", mode: "before",
    anchor: "    function FindingsTab(props) {",
  },
  {
    file: "client.js", dialect: "panel", src: "evidence-ledger-tab.js",
    what: "证据账本组件（面板内嵌版）", mode: "before",
    anchor: "  function FindingsTab(props) {",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "replace",
    what: "报告页切四段式外层",
    anchor: "body = h(ReportTab, { engagement: eng, refreshKey: refreshKey })",
    text: "body = h(ReportTabPlus, { engagement: eng, refreshKey: refreshKey })",
  },
  {
    file: "client.js", dialect: "panel", mode: "replace",
    what: "报告页切四段式外层（面板内嵌版）",
    anchor: "body = h2(ReportTab, { engagement: eng, refreshKey });",
    text: "body = h2(ReportTabPlus, { engagement: eng, refreshKey });",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "after",
    what: "页签表加证据账本",
    anchor: "        ['artifacts', '凭据与文件'],\n",
    text: "        ['evidence', '证据账本'],\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "after",
    what: "页签表加证据账本（面板内嵌版）",
    anchor: '      ["artifacts", "凭据与文件"],\n',
    text: '      ["evidence", "\\u8BC1\\u636E\\u8D26\\u672C"],\n',
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "after",
    what: "证据账本分发",
    anchor: "      else if (st.tab === 'artifacts') body = h(ArtifactsTab, { engagement: eng, refreshKey: refreshKey })\n",
    text: "      else if (st.tab === 'evidence') body = h(EvidenceTab, { engagement: eng, refreshKey: refreshKey })\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "after",
    what: "证据账本分发（面板内嵌版）",
    anchor: '    else if (st.tab === "artifacts")\n      body = h2(ArtifactsTab, { engagement: eng, refreshKey });\n',
    text: '    else if (st.tab === "evidence")\n      body = h2(EvidenceTab, { engagement: eng, refreshKey });\n',
  },

  // ── P26：待办角标（右下角常驻胶囊）────────────────────────────────
  // 只进面板产物：独立窗口那份整个窗口就是演练台，没有 shell.overlay 可挂，
  // 也没有「我在别的页面看不见」的问题。
  // 挂载点选 shell.overlay 而不是某个页签内部：角标的价值全在「不在这页也看得见」。
  {
    file: "client.js", dialect: "panel", src: "attention-badge.js",
    what: "待办角标组件", mode: "before",
    anchor: "function PanelOverlays() {\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "after",
    what: "待办角标挂载",
    anchor: "    h(EnvAdaptSendGate),\n",
    text: "    h(AttentionBadge, null),\n",
  },

  // ── P27：团队任务板（官方 Agent Teams 的只读视图）──────────────────
  // 组件插在 FindingsTab 之前（与其它页同一个作用域）。
  // 顺序有讲究：先插组件，再改页签表，最后插分发 —— 分发锚点引用的是前面已插入的行。
  // 两份产物都要改，否则「面板里点开」与「全面浏览新窗口」页签不一致。
  {
    file: "lib/redteam/client.js", dialect: "redteam", src: "team-board-tab.js",
    what: "团队任务板组件", mode: "before",
    anchor: "    function FindingsTab(props) {",
  },
  {
    file: "client.js", dialect: "panel", src: "team-board-tab.js",
    what: "团队任务板组件（面板内嵌版）", mode: "before",
    anchor: "  function FindingsTab(props) {",
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "replace",
    what: "页签表加任务板",
    anchor: "        ['skills', '技能库'],\n",
    text: "        ['skills', '技能库'],\n        ['team', '任务板'],\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "replace",
    what: "页签表加任务板（面板内嵌版）",
    anchor: '      ["skills", "\\u6280\\u80FD\\u5E93"]\n',
    text: '      ["skills", "\\u6280\\u80FD\\u5E93"],\n      ["team", "\\u4EFB\\u52A1\\u677F"]\n',
  },
  {
    file: "lib/redteam/client.js", dialect: "redteam", mode: "after",
    what: "任务板分发",
    anchor: "      else if (st.tab === 'evidence') body = h(EvidenceTab, { engagement: eng, refreshKey: refreshKey })\n",
    text: "      else if (st.tab === 'team') body = h(TeamBoardTab, { refreshKey: refreshKey })\n",
  },
  {
    file: "client.js", dialect: "panel", mode: "after",
    what: "任务板分发（面板内嵌版）",
    anchor: '    else if (st.tab === "evidence")\n      body = h2(EvidenceTab, { engagement: eng, refreshKey });\n',
    text: '    else if (st.tab === "team")\n      body = h2(TeamBoardTab, { refreshKey, session: rtSessionId() });\n',
  },
];
for (const sn of SNIPPETS) {
  const fp = path.join(PKG, sn.file);
  const src = fs.readFileSync(fp, "utf8");
  const hits = src.split(sn.anchor).length - 1;
  if (hits !== 1) die(`演练台移植：${sn.what} 锚点命中 ${hits} 次（要求 1 次）`);
  const body = sn.text !== undefined ? sn.text : adaptSnippet(readSnippet(sn.src || "artifacts-tab.js"), sn.dialect);
  const next = sn.mode === "before" ? src.replace(sn.anchor, () => body + sn.anchor)
    : sn.mode === "replace" ? src.replace(sn.anchor, () => body)
    : src.replace(sn.anchor, () => sn.anchor + body);
  fs.writeFileSync(fp, next);
}
log(`✓ 演练台「凭据与文件」页已并入（${SNIPPETS.length} 处，两份产物）`);

// ── 3d. 授权弹窗「不同意」把面板留在非法页签 ────────────────────────
// dockBus 的初始值是 tab:"clean"，而 "clean" 既不在页签表也没有 body 分支，
// 点「不同意」后整块面板是空的。落到 status 才是合法状态。
{
  const fp = path.join(PKG, "client.js");
  const src = fs.readFileSync(fp, "utf8");
  const hits = src.split('tab: "clean"').length - 1;
  if (hits !== 2) die(`tab:"clean" 命中 ${hits} 次（要求 2 次）`);
  fs.writeFileSync(fp, src.split('tab: "clean"').join('tab: "status"'));
  log('✓ 非法页签 "clean" → "status"（2 处）');
}

// ── 4. 重写 package.json ──────────────────────────────────────────
const pkgPath = path.join(PKG, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
Object.assign(pkg, {
  name: "dsh-purge-plus",
  version,
  description: "基于 dsh-purge Community + dsh-purge safe 独立维护的 DSH 附加组件。",
  homepage: `https://github.com/${REPO_SLUG}#readme`,
  repository: { type: "git", url: `git+https://github.com/${REPO_SLUG}.git` },
  bugs: { url: `https://github.com/${REPO_SLUG}/issues` },
  dshTarget: "0.2.2-rc.5 (runtime injection + host patches verified)",
});
// [dsh-purge-plus] 兼容级别表要包含我们真正验证过的那个宿主版本。
// 上游表停在 0.2.2-rc.3，而 dshTarget 写的是 rc.5 —— 面板查不到 rc.5 就报
// 「未验证版本」，于是一台跑得好好的机器常年挂着警告（用户截图里那个黄点）。
// 这里把 rc.5 标成 compatible：verify 22 组 + 380 条回归就是在这个版本上跑的。
pkg.dsh = pkg.dsh || {};
pkg.dsh.compatibility = pkg.dsh.compatibility || {};
pkg.dsh.compatibility.dshReleases = {
  ...(pkg.dsh.compatibility.dshReleases || {}),
  "0.2.2-rc.5": "compatible",
};
pkg.plus = {
  base: { name: basePkg.name, version: baseVersion },
  overlayRevision: plusRev,
  generatedAt: new Date().toISOString(),
  // [dsh-purge-plus] 兼容性口径（2026-11-23）：rc.5 的 compatible 断言保留，
  // 因为本机确实在 0.2.2-rc.5 上跑过验收与全量回归；但把「证据在哪」写清楚，
  // 不让它看起来像仓库内可复核的结论。降格成「未验证」会把用户面板的
  // 未验证警告重新点亮，那是拿可用性换一句更保守的话，不划算。
  dshCompat: {
    host: "0.2.2-rc.5",
    claim: "compatible",
    verifiedOn: "author machine (this repo's verify + full regression)",
    evidenceInRepo: false,
  },
};
// Apache-2.0 §4(a)(c)(d)：许可全文与 NOTICE 必须随发行物走。
for (const extra of ["NOTICE-PLUS.md", "NOTICE-SAFE.txt", "LICENSE-SAFE-APACHE-2.0.txt", "LICENSE-PLUS.txt", "NOTICE"]) {
  if (Array.isArray(pkg.files) && !pkg.files.includes(extra)) pkg.files.push(extra);
}
// [dsh-purge-plus] 剔除装配包里的死脚本。
// vendor 快照不含 test/ 与 packages/purge-panel/，但基座 package.json 的
// scripts 里 test / build:client / test:ui / check:client / test:linux /
// test:next-host 等都指向这些不存在的路径 —— 装到用户机器上点哪条炸哪条。
// 规则是通用的（脚本里引用的相对路径必须在装配目录真实存在），不逐条点名；
// 剔除后再复查一遍，仍有残留即构建失败。verify [27] 组在验收侧守同一条规则。
{
  const SCRIPT_PATH_RE = /(?<![\w/.-])((?:test|packages|scripts|bin|lib|docs|locale|presets|skills)\/[^\s"']+)/g;
  const refsOf = (cmd) => [...String(cmd).matchAll(SCRIPT_PATH_RE)].map((m) => m[1]);
  const kept = {};
  const dropped = [];
  for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
    const missing = refsOf(cmd).filter((r) => !fs.existsSync(path.join(PKG, r)));
    if (missing.length) dropped.push(`${name}（缺 ${missing.join(", ")}）`);
    else kept[name] = cmd;
  }
  pkg.scripts = kept;
  for (const [name, cmd] of Object.entries(kept)) {
    const missing = refsOf(cmd).filter((r) => !fs.existsSync(path.join(PKG, r)));
    if (missing.length) die(`package.json 脚本 ${name} 仍引用不存在的路径：${missing.join(", ")}`);
  }
  if (dropped.length) log(`✓ package.json 剔除死脚本 ${dropped.length} 条：${dropped.join("；")}`);
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
log(`✓ package.json 重写：${pkg.name}@${pkg.version}  dshTarget=${pkg.dshTarget}`);

// ── 4b. 重写 cordis.patch.yml 里的插件名 ────────────────────────────
// 宿主的 cordis.patch.yml 用 `name:` 声明要加载哪个包，然后走
// createRequire(profile).resolve(name) 去解析。上游 community 的包名是
// basePkg.name，本仓库改名后如果这里不改，宿主会 MODULE_NOT_FOUND
// 并**静默跳过整个 bundle** —— 面板上看起来装了，实际一条补丁都不打。
{
  const ymlPath = path.join(PKG, "cordis.patch.yml");
  const baseName = basePkg.name;
  if (fs.existsSync(ymlPath) && baseName && baseName !== pkg.name) {
    const yml = fs.readFileSync(ymlPath, "utf8");
    const hits = yml.split(baseName).length - 1;
    if (hits === 0) die(`cordis.patch.yml 里找不到 ${baseName}，插件名重写无法进行`);
    fs.writeFileSync(ymlPath, yml.split(baseName).join(pkg.name));
    log(`✓ cordis.patch.yml 插件名 ${baseName} → ${pkg.name}（${hits} 处）`);
  }
}

// ── 4b-2. 重写 presets/**/*.yml 里的插件名 ─────────────────────────
// 预设的 agent.cordis.yml 里有 `name: dsh-purge-community/redteam/tools`
// 这种**子路径**引用。宿主按名解析不到该包 → 子条目 `never started` →
// 整份预设被标 broken。而客户端的模式下拉只列 `broken === undefined` 的行
// （dsh-client-ui-agent-preset/lib/client.js 的 presetOptions），
// 于是整份预设从下拉里**彻底消失**——比「装了不生效」更隐蔽：
// 状态文件写着 registered，界面上什么都没有。
{
  const baseName = basePkg.name;
  if (baseName && baseName !== pkg.name) {
    const root = path.join(PKG, "presets");
    let files = 0;
    let hits = 0;
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(fp); continue; }
        if (!/\.ya?ml$/.test(entry.name)) continue;
        const text = fs.readFileSync(fp, "utf8");
        const n = text.split(baseName).length - 1;
        if (n === 0) continue;
        fs.writeFileSync(fp, text.split(baseName).join(pkg.name));
        files += 1;
        hits += n;
      }
    };
    walk(root);
    if (hits === 0) log("✓ presets 无上游包名引用");
    else log(`✓ presets 插件名 ${baseName} → ${pkg.name}（${files} 个文件 / ${hits} 处）`);
  }
}

// ── 4c. 重写 client.js 的浏览器模块 id ──────────────────────────────
// 宿主 dsh-client-modules 的规则：**manifest 的包名就是浏览器模块名**
// （dsh-client-modules/lib/index.js:150 "The manifest package name identifies
// the browser module"）。预构建的 client.js 里 `__ModuleLoader__.load({id:...})`
// 仍是上游包名时，宿主按新包名找不到模块 → 整个 UI 静默不挂载：
// 侧栏没有按钮、插件详情页没有配置项，但服务端 HTTP 接口一切正常。
// 三处都要改：模块 id、panel 名、详情页 slot key。
{
  const cliPath = path.join(PKG, "client.js");
  if (fs.existsSync(cliPath)) {
    const js = fs.readFileSync(cliPath, "utf8");
    const hits = js.split(basePkg.name).length - 1;
    if (hits === 0) die("client.js 里找不到上游包名，浏览器模块 id 无法重写");
    fs.writeFileSync(cliPath, js.split(basePkg.name).join(pkg.name));
    log(`✓ client.js 浏览器模块名 ${basePkg.name} → ${pkg.name}（${hits} 处）`);
  }
}

// ── 4c-2. 重写 client.js 里的界面版本 ───────────────────────────────
// 宿主把「服务端报告的版本」和「界面自己写的版本」对比，不一致就在面板顶部
// 挂一条黄色告警（client.js 里那段 \u5B98\u65B9\u7248\u672C … \u754C\u9762 …）。
// 上游把界面版本写死在 6 个地方（面板标题 / 一致性比对基准 / 告警文案 /
// 徽章 / 详情页标题），必须同步成本包版本，否则面板永远喊不一致。
// 注意：这里替换的是**基座版本号**（上游写死的那串），换成本包的 0.1.N。
{
  const cliPath = path.join(PKG, "client.js");
  if (fs.existsSync(cliPath)) {
    let js = fs.readFileSync(cliPath, "utf8");
    const verHits = js.split(baseVersion).length - 1;
    if (verHits === 0) die(`client.js 里找不到界面版本 ${baseVersion}`);
    js = js.split(baseVersion).join(version);
    // 基座版本号不该在界面里留任何残影：面板上出现 1.7.20 会被误读成
    // 「本插件还是社区版」或「版本没升上去」。
    if (js.includes(baseVersion)) die(`client.js 仍有基座版本 ${baseVersion} 残留`);
    // 面板徽章：\u793E\u533A\u7248 <ver> → Plus <ver>
    const badgeOld = `\\u793E\\u533A\\u7248 ${version}`;
    const badgeHits = js.split(badgeOld).length - 1;
    if (badgeHits) js = js.split(badgeOld).join(`Plus ${version}`);
    // 更新按钮：\u68C0\u67E5\u793E\u533A\u7248\u66F4\u65B0 → \u68C0\u67E5\u66F4\u65B0
    const btnOld = "\\u68C0\\u67E5\\u793E\\u533A\\u7248\\u66F4\\u65B0";
    const btnHits = js.split(btnOld).length - 1;
    if (btnHits) js = js.split(btnOld).join("\\u68C0\\u67E5\\u66F4\\u65B0");
    fs.writeFileSync(cliPath, js);
    log(`✓ client.js 界面版本 ${baseVersion} → ${version}（${verHits} 处）· 徽章 ${badgeHits} 处 · 按钮 ${btnHits} 处`);
  }
}

// ── 4c-3. 页脚血缘 ──────────────────────────────────────────────────
// 页脚还写着「基于 …/dsh-purge 1.1.71」—— 上游 2025 年的版本号，而本包是
// community 为基座 + 移植 safe，留着这句等于每个页面底部都在误报血缘。
// **血缘句不写任何版本号**：两个上游都会继续更新，写死 1.7.20 / 2.0.0 只会
// 在下次同步后变成一句假话；具体版本记在 NOTICE-PLUS.md 与 package.json 的
// plus.base 里，需要溯源的人去那里看。
{
  const cliPath = path.join(PKG, "client.js");
  if (!fs.existsSync(cliPath)) die("页脚：client.js 不存在");
  let js = fs.readFileSync(cliPath, "utf8");
  const oldFoot = '"\\u57FA\\u4E8E YuJunZhiXue/dsh-purge 1.1.71 \\u72EC\\u7ACB\\u7EF4\\u62A4 \\xB7 MIT \\xB7 \\u4FDD\\u7559\\u539F\\u4F5C\\u8005\\u7F72\\u540D"';
  const hits = js.split(oldFoot).length - 1;
  if (hits !== 1) die(`页脚：上游血缘串命中 ${hits} 次（要求 1 次）`);
  js = js.split(oldFoot).join('"基于 dsh-purge Community + dsh-purge safe 独立维护 · MIT / Apache-2.0 · 上游署名见 NOTICE"');
  fs.writeFileSync(cliPath, js);
  log("✓ 页脚血缘：Community + safe（不写版本号，署名义务转 NOTICE）");
}

// ── 4d. 安装元数据指向本仓库 ────────────────────────────────────────
// dsh.install 里的 tarball / git 仍指向上游，面板的「重新安装」会把人带回
// community。改成自己的发行地址。
if (pkg.dsh?.install) {
  const rel = `https://github.com/${REPO_SLUG}`;
  pkg.dsh.install = {
    ...pkg.dsh.install,
    tarball: `${rel}/releases/download/v${version}/dsh-purge-plus-${version}.tgz`,
    git: `${rel}.git`,
  };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  log(`✓ dsh.install 指向 ${REPO_SLUG}`);
}

// ── 5. 语法与补丁表自检 ───────────────────────────────────────────
const probe = `
import { ALL_PATCHES } from "./lib/patches/index.mjs";
const ids = ALL_PATCHES.map(p => p.id);
const dup = ids.filter((v,i) => ids.indexOf(v) !== i);
const upstream = ids.filter(id => id < 201);
const ours = ids.filter(id => id >= 201);
console.log(JSON.stringify({ total: ids.length, ours: ours.length, upstreamMax: Math.max(...upstream), dup }));
`;
let probeOut;
try {
  probeOut = execFileSync(process.execPath, ["--input-type=module", "-e", probe], { cwd: PKG, encoding: "utf8" }).trim();
} catch (err) {
  die(`补丁表无法 import：\n${err.stderr || err.message}`);
}
const r = JSON.parse(probeOut);
if (r.dup.length) die(`补丁 id 重复: ${r.dup.join(",")}`);
if (r.ours !== 7) die(`自有补丁数应为 7，实际 ${r.ours}`);
if (r.total !== 88 + 7) die(`补丁总数应为 95，实际 ${r.total}`);
if (r.upstreamMax !== 96) die(`上游补丁最大 id 应为 96，实际 ${r.upstreamMax}（基座可能变了，需复核 PORT-MATRIX）`);
log(`✓ 补丁表 ${r.total} 条（上游 ${r.total - r.ours}，最大 id ${r.upstreamMax} + 自有 ${r.ours} 条 ≥201），id 无重复`);

// ── 6. 打包 ───────────────────────────────────────────────────────
// 守卫（账本 T4/T6 的教训）：同名 tgz 已存在、内容却不同 → 拒绝覆盖。
//
// 为什么比的是「解包内容摘要」而不是 tgz 的字节：gzip 头里带 mtime，
// 同样的内容连打两次字节就不一样（实测 f07d3e… vs 50287b…），
// 拿 tgz 哈希当指纹会每次重跑都误报。摘要按「排序后的 相对路径 + 文件哈希」算，
// 与时间、压缩参数无关。
//
// 为什么必须拦：pnpm 见到同一个 specifier + 同一个版本号就直接复用已解包的副本，
// 哪怕 --force 也不重新解包。于是「同名不同内容」会静默装出旧代码——
// 版本号对得上、内容对不上，比版本号写错更难发现。
const tgz = path.join(ROOT, "dist", `dsh-purge-plus-${version}.tgz`);
const sidecar = tgz + ".content";
const digest = contentDigest(PKG);
if (fs.existsSync(tgz)) {
  const recorded = fs.existsSync(sidecar) ? fs.readFileSync(sidecar, "utf8").trim() : "";
  if (recorded !== digest) {
    die(
      `dist/${path.basename(tgz)} 已存在，但内容不同\n` +
        `    已记录 ${recorded ? recorded.slice(0, 16) + "…" : "（无 .content 指纹，无法判定）"}\n` +
        `    本次   ${digest.slice(0, 16)}…\n` +
        `    同名不同内容会让 pnpm 认「版本没变」直接复用旧副本（账本 T4/T6）。\n` +
        `    改 overlay/repo.json 的 revision 后重跑；确认要覆盖就手动删掉旧 tgz 和 .content。`
    );
  }
  log(`✓ dist/${path.basename(tgz)} 内容未变（${digest.slice(0, 16)}…），未覆盖`);
} else {
  // [dsh-purge-plus] 打包必须剥掉 macOS 的 xattr 元数据。
  // BSD tar 默认给每个成员写 LIBARCHIVE.xattr.com.apple.provenance（本机
  // provenance token），pnpm 的 hoisted 链接器解包时会把它落成 AppleDouble
  // 边车文件：一个 403 成员的包装完变成 787 个文件，连 skills/ 和 presets/
  // 里都是 `._xxx`。既是污染，也把本机标识写进了公开产物。
  execFileSync("tar", ["--no-xattrs", "--no-mac-metadata", "-czf", tgz, "-C", BUILD, "package"], {
    stdio: "inherit",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  fs.writeFileSync(sidecar, digest + "\n");
  const size = (fs.statSync(tgz).size / 1024 / 1024).toFixed(2);
  log(`✓ ${path.relative(ROOT, tgz)}  ${size} MB · 内容指纹 ${digest.slice(0, 16)}…`);
}
log(`\n安装：dsh 面板 → 插件 → 从文件安装，或\n  pnpm add "file:${tgz}"`);

/** 构建产物的确定性内容摘要：排序路径 + 每个文件的 sha256。 */
function contentDigest(dir) {
  const hash = createHash("sha256");
  const walk = (rel) => {
    const abs = path.join(dir, rel);
    const entries = fs.readdirSync(abs, { withFileTypes: true })
      .map((d) => d.name)
      .sort();
    for (const name of entries) {
      if (name.startsWith("._")) continue; // macOS AppleDouble，不在产物里
      const childRel = rel ? rel + "/" + name : name;
      const childAbs = path.join(dir, childRel);
      if (fs.statSync(childAbs).isDirectory()) walk(childRel);
      else {
        hash.update(childRel + "\0");
        hash.update(createHash("sha256").update(stableBytes(childRel, childAbs)).digest("hex"));
        hash.update("\n");
      }
    }
  };
  walk("");
  return hash.digest("hex");
}

/**
 * 读文件字节；package.json 里的 `dsh.generatedAt` 是构建时刻，必须从摘要里剔除。
 *
 * 不剔除的后果（本轮实测）：同一个 revision 连跑两次，内容摘要每次都变，
 * 于是 T7 的守卫**永远**报「同名不同内容」—— 守卫一旦常红就没人再看它，
 * 等于没有守卫。摘要要回答的是「代码变了没有」，不是「什么时候构建的」。
 */
function stableBytes(rel, abs) {
  const buf = fs.readFileSync(abs);
  if (rel !== "package.json") return buf;
  try {
    const parsed = JSON.parse(buf.toString("utf8"));
    /* 构建时刻可能出现在顶层 / dsh / plus 任意一处，全部剔除 */
    for (const holder of [parsed, parsed && parsed.dsh, parsed && parsed.plus]) {
      if (holder && typeof holder === "object") delete holder.generatedAt;
    }
    return Buffer.from(JSON.stringify(parsed, null, 2) + "\n", "utf8");
  } catch {
    return buf;
  }
}

// ── helpers ──────────────────────────────────────────────────────
function countOccurrences(hay, needle) {
  if (!needle) return 0;
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}
function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? countFiles(p) : 1;
  }
  return n;
}
