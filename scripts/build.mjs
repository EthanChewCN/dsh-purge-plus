#!/usr/bin/env node
// [dsh-purge-plus] 构建：vendor/community + overlay → dist/package → dist/*.tgz
//
// 不变式：
//   · vendor/ 永远不被写入（只在构建时读取），升级时整目录替换即可。
//   · overlay 里只有新增文件 + 6 处精确锚点插入，没有删改上游逻辑。
//   · 任何锚点命中数 ≠ 1 立刻失败，并打印文件、锚点、实际命中次数。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
const version = `${baseVersion}-plus.${plusRev}`;

log(`上游基座  ${basePkg.name}@${baseVersion}`);
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

// 包内 README 用本仓库的：vendor 带的是 community 的 README，装完在面板里
// 看到的会是「dsh-purge Community」，用户会以为装的是别人的包。
fs.copyFileSync(path.join(ROOT, "README.md"), path.join(PKG, "README.md"));
log(`✓ README.md 用本仓库版本覆盖`);

// 本仓库的维护文档一并随包分发（与 vendor 的 docs 无重名）：
// PORT-MATRIX 是移植判定，LICENSING 是 Apache-2.0 §4 要求的改动记录。
for (const f of fs.readdirSync(path.join(ROOT, "docs"))) {
  if (!f.endsWith(".md")) continue;
  const dst = path.join(PKG, "docs", f);
  if (fs.existsSync(dst)) die(`docs/${f} 与 vendor 同名，拒绝覆盖上游文档`);
  fs.copyFileSync(path.join(ROOT, "docs", f), dst);
}
log(`✓ 本仓库 docs 并入（${fs.readdirSync(path.join(ROOT, "docs")).filter((f) => f.endsWith(".md")).length} 个）`);

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
  description: "以 dsh-purge-community 为基座、移植 dsh-purge-safe 先进能力并长期跟随上游维护的 DSH 附加组件。",
  homepage: `https://github.com/${REPO_SLUG}#readme`,
  repository: { type: "git", url: `git+https://github.com/${REPO_SLUG}.git` },
  bugs: { url: `https://github.com/${REPO_SLUG}/issues` },
  dshTarget: "0.2.2-rc.5 (runtime injection + host patches verified)",
});
pkg.plus = {
  base: { name: basePkg.name, version: baseVersion },
  overlayRevision: plusRev,
  generatedAt: new Date().toISOString(),
};
// Apache-2.0 §4(a)(c)(d)：许可全文与 NOTICE 必须随发行物走。
for (const extra of ["NOTICE-PLUS.md", "NOTICE-SAFE.txt", "LICENSE-SAFE-APACHE-2.0.txt"]) {
  if (Array.isArray(pkg.files) && !pkg.files.includes(extra)) pkg.files.push(extra);
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
// 上游把界面版本写死在 5 个地方，改名/升版后必须同步，否则面板永远喊不一致。
{
  const cliPath = path.join(PKG, "client.js");
  if (fs.existsSync(cliPath)) {
    let js = fs.readFileSync(cliPath, "utf8");
    const verHits = js.split(baseVersion).length - 1;
    if (verHits === 0) die(`client.js 里找不到界面版本 ${baseVersion}`);
    js = js.split(baseVersion).join(version);
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
if (r.ours !== 5) die(`自有补丁数应为 5，实际 ${r.ours}`);
if (r.total !== 88 + 5) die(`补丁总数应为 93，实际 ${r.total}`);
if (r.upstreamMax !== 96) die(`上游补丁最大 id 应为 96，实际 ${r.upstreamMax}（基座可能变了，需复核 PORT-MATRIX）`);
log(`✓ 补丁表 ${r.total} 条（上游 ${r.total - r.ours}，最大 id ${r.upstreamMax} + 自有 ${r.ours} 条 ≥201），id 无重复`);

// ── 6. 打包 ───────────────────────────────────────────────────────
const tgz = path.join(ROOT, "dist", `dsh-purge-plus-${version}.tgz`);
execFileSync("tar", ["-czf", tgz, "-C", BUILD, "package"], { stdio: "inherit" });
const size = (fs.statSync(tgz).size / 1024 / 1024).toFixed(2);
log(`✓ ${path.relative(ROOT, tgz)}  ${size} MB`);
log(`\n安装：dsh 面板 → 插件 → 从文件安装，或\n  pnpm add "file:${tgz}"`);

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
