#!/usr/bin/env node
// [dsh-purge-plus] 预设自愈（safe 2.0.2 lib/redteam/index.js 的 6 段修复）。
//
// 这一块原先的形态是「自愈代码存在，但 apply 在预设已存在时直接 kept」——
// 也就是说宿主每次升级把预设弄半坏之后，代码明明能修，却永远不会被调用。
// 所以这里测的不是「函数能不能跑」，而是**整条路通不通**：
//   拿包内模板故意弄坏六处 → 调 installPreset() → 六处都必须修回来；
//   再调一次 → 必须是 kept 且文件一个字节不变（幂等，否则每次启动都重写盘并报 repaired）。
// 全部在临时 DSH_HOME 里跑，不碰真预设。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 既能在仓库里跑（dist/build/package），也能在**已安装的包里**跑（脚本所在包的根）——
   发布包现在带 test-*.mjs，验收可以对已安装产物复跑（审计 B-5）。 */
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m) => { fail++; console.error("  ✗ " + m); };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(`${m}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`));
const yes = (v, m) => eq(Boolean(v), true, m);

const home = fs.mkdtempSync(path.join(os.tmpdir(), "plus-preset-"));
process.env.DSH_HOME = home;
delete process.env.REDTEAM_PRESET_REFRESH;

const mod = await import(path.join(PKG, "lib/redteam/index.js"));
const templatePath = path.join(PKG, "presets", "redteam", "agent.cordis.yml");
const template = fs.readFileSync(templatePath, "utf8");
const presetFile = path.join(home, ".agent-presets", "redteam", "agent.cordis.yml");

console.log("[1] 把模板弄坏六处（模拟宿主升级后的老预设）");
{
  let broken = template;
  /* ① 技能目录还是占位符（落地时没替换 → 整个预设挂载失败） */
  broken = broken.split("dshHomePath('redteam/skills')").join("{{REDTEAM_SKILLS_DIR}}");
  /* ② 工具包名还是老坐标 */
  broken = broken.split("dsh-purge-plus/redteam/tools").join("dsh-purge/redteam/tools");
  /* ③ 0.2.1 已废弃的 toolFilter（留着整份 registered-broken） */
  broken = broken.replace(
    "      modelSelectionSettings: true\n",
    "      modelSelectionSettings: true\n      toolFilter:\n        allow:\n          - subagent\n",
  );
  /* ④ subagent 行被禁用（模板里本来就是 false，改成 true） */
  broken = broken.replace(
    "    - id: tool-subagent\n      name: '@deepseek-ai/dsh-tool-subagent'\n      disabled: false",
    "    - id: tool-subagent\n      name: '@deepseek-ai/dsh-tool-subagent'\n      disabled: true",
  );
  fs.mkdirSync(path.dirname(presetFile), { recursive: true });
  fs.writeFileSync(presetFile, broken, "utf8");

  yes(broken.includes("{{REDTEAM_SKILLS_DIR}}"), "① 占位符已写入");
  yes(broken.includes("dsh-purge/redteam/tools"), "② 老工具包名已写入");
  yes(/toolFilter:/.test(broken), "③ toolFilter 已写入");
  yes(/    - id: tool-subagent\n      name: '@deepseek-ai\/dsh-tool-subagent'\n      disabled: true/.test(broken), "④ subagent 行已禁用");
  yes(!/tool-schedule/.test(broken), "⑤ 缺 tool-schedule 行（模板本来就没有）");
}

console.log("[2] installPreset()：六处全部修回来");
{
  const logs = [];
  const result = mod.installPreset({ log: (m) => logs.push(m) });
  eq(result.action, "repaired", "动作是 repaired（不是 kept / installed）");
  const text = fs.readFileSync(presetFile, "utf8");

  eq(text.includes("{{REDTEAM_SKILLS_DIR}}"), false, "① 占位符被替换掉");
  yes(/dshHomePath\(\s*['"]redteam\/skills['"]\s*\)/.test(text), "① 技能目录改成 dshHomePath('redteam/skills')");
  eq(text.includes("dsh-purge/redteam/tools"), false, "② 老工具包名被改掉");
  yes(text.includes("dsh-purge-plus/redteam/tools"), "② 工具包名是本包坐标");
  eq(/^\s*toolFilter:/m.test(text), false, "③ toolFilter 被剥掉（连嵌套的 allow 一起）");
  eq(/toolFilter/.test(text), false, "③ 整个 toolFilter 键都不在了（嵌套内容不会单独残留）");
  const rowBlock = text.slice(text.indexOf("- id: tool-subagent\n"), text.indexOf("- id: tool-subagent-fork"));
  eq(/^\s+allow:/m.test(rowBlock), false, "③ subagent 行里没有残留 allow: 列表");
  const subagentBlock = text.slice(text.indexOf("- id: tool-subagent\n"), text.indexOf("- id: tool-subagent-fork"));
  eq(/disabled:\s*true/.test(subagentBlock), false, "④ subagent 行重新启用");
  yes(/^- id: tool-schedule$/m.test(text), "⑤ 补上了 tool-schedule 行");
  yes(text.includes("@deepseek-ai/dsh-tool-schedule"), "⑤ 行里带官方包名");

  /* 组合修复：本机没有宿主包 → workflow 那几行必须关掉，
     否则 Cordis 会一直 pending，把整个模式下拉抽空。 */
  const workflowBlock = text.slice(text.indexOf("- id: workflow-ptc"), text.indexOf("- id: tool-workflow") + 200);
  yes(/disabled:\s*true/.test(workflowBlock), "⑥ 缺宿主包时 workflow 行被关掉（模式下拉不会被抽空）");

  yes(Array.isArray(result.repaired) || typeof result.repaired === "string", "返回值带 repaired 标记");
  yes(logs.some((l) => /预设/.test(l)), "有可读的修复日志");
}

console.log("[3] 幂等：第二次必须是 kept，文件一个字节不变");
{
  const before = fs.readFileSync(presetFile, "utf8");
  const result = mod.installPreset({ log: () => {} });
  const after = fs.readFileSync(presetFile, "utf8");
  eq(result.action, "kept", "第二次动作是 kept");
  eq(after === before, true, "文件内容没有变化（不会每次启动都重写盘）");
  eq(result.repaired, undefined, "kept 时不带 repaired 标记");
}

console.log("[4] 技能目录落地 + 预设正文里的路径都指向本机");
{
  const skillsDir = path.join(home, "redteam", "skills");
  yes(fs.existsSync(skillsDir), "随包技能已落到 DSH_HOME/redteam/skills");
  const count = fs.readdirSync(skillsDir).filter((f) => f.endsWith(".md")).length;
  eq(count, 40, "技能 40 个");
  const text = fs.readFileSync(presetFile, "utf8");
  eq(text.includes(home), false, "预设正文里不写死本机绝对路径（用 dshHomePath）");
}

console.log("[5] 接线：apply 不再走「已存在就 kept」的捷径");
{
  const src = fs.readFileSync(path.join(PKG, "lib/redteam/index.js"), "utf8");
  eq(/const exists = existsSync\(join\(dir, 'agent\.cordis\.yml'\)\)/.test(src), false, "apply 里没有「预设存在」的探测分支了");
  eq(/result = installPreset\(\{ force: process\.env\.REDTEAM_PRESET_REFRESH === '1', ctx,/.test(src), true, "apply 无条件调用 installPreset 并传入 ctx");
  eq(/action: 'kept', dir, skillsDir: skills\.path/.test(src), false, "不再直接返回 kept");
}

fs.rmSync(home, { recursive: true, force: true });

/* 汇总行格式与其它 test-*.mjs 一致：verify [33] 按「N 通过 / M 失败」汇总断言数 */
console.log(`${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
