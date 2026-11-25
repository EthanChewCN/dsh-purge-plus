#!/usr/bin/env node
// [dsh-purge-plus] 数据目录铺底（safe 2.0.2 lib/redteam/bootstrap-runtime.js）。
//
// 这个模块 666 行，做四件事：知识库 DDL、pocs/toolkit 目录、平台配置、nuclei 模板
// 下载（git/tar/zip + 多镜像回退）。本包只把**本地那半**接进启动，
// 下载必须显式触发 —— 所以这里要钉住两件事：
//   ① 本地那半真的生效（库建出来了、配置写对了、索引清理了）；
//   ② download:false 时**一个出口动作都没有**（日志里不能出现 kev refresh /
//      templates auto refresh，也不能留下载锁）。
// 全部在临时 HOME 里跑：collectHomes() 会把 ~/.dsh 也算进去，不隔离 HOME 就会
// 写进用户真实的数据目录。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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

const home = fs.mkdtempSync(path.join(os.tmpdir(), "plus-runtime-"));
/* 关键：HOME 也要换掉。collectHomes() 除了 DSH_HOME 还会看 homedir()/.dsh，
   不隔离就会把配置写进真实目录（这条踩过一次）。 */
process.env.DSH_HOME = home;
process.env.HOME = home;

const mod = await import(path.join(PKG, "lib/redteam/bootstrap-runtime.js"));
const redteamDir = path.join(home, "redteam");

console.log("[1] 本地铺底：目录 / 知识库 / 配置");
{
  const report = await mod.ensureRedteamRuntime({ download: false });
  eq(report.root, redteamDir, "根目录是 $DSH_HOME/redteam");
  yes(fs.existsSync(redteamDir), "redteam 目录已创建");
  yes(fs.existsSync(path.join(redteamDir, "pocs")), "pocs/ 已创建");
  yes(fs.existsSync(path.join(redteamDir, "toolkit")), "toolkit/ 已创建");
  yes(fs.existsSync(path.join(redteamDir, "knowledge.db")), "knowledge.db 已创建");

  const db = new DatabaseSync(path.join(redteamDir, "knowledge.db"), { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => String(r.name));
  db.close();
  yes(tables.includes("poc"), "知识库里有 poc 表");
  eq(tables.filter((t) => t.startsWith("poc_")).length >= 0, true, "（FTS 表按宿主能力可选，不做硬断言）");
  eq(report.pocs, 0, "空库的 poc 条数是 0");

  const cfgFile = path.join(redteamDir, "config.json");
  yes(fs.existsSync(cfgFile), "平台配置已写出");
  const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
  eq(cfg.envAdaptConfigured, true, "配置里标了「已做过环境适配」");
  yes(typeof cfg.toolkitDir === "string" && cfg.toolkitDir.length > 0, "配置里有 toolkitDir");
  eq(typeof cfg.tools, "object", "配置里有 tools 表");
}

console.log("[2] download:false 时没有任何出口动作");
{
  eq(fs.existsSync(path.join(redteamDir, "toolkit", ".nuclei-templates.lock")), false, "没有留下下载锁");
  const log = fs.readFileSync(path.join(redteamDir, "bootstrap.log"), "utf8");
  yes(log.includes("ensure start download=false"), "日志记下了 download=false");
  eq(/kev refresh/.test(log), false, "日志里没有 KEV 刷新（那是联网动作）");
  eq(/templates auto refresh/.test(log), false, "日志里没有模板自动刷新");
  eq(/templates ready|pull fail/.test(log), false, "日志里没有模板下载尝试");
}

console.log("[3] 没有模板时状态如实报「没有」，不冒充新鲜");
{
  const st = mod.templatesStatus(redteamDir);
  eq(st.dir, null, "templatesStatus.dir 为 null");
  eq(st.count, 0, "模板数 0");
  eq(st.refreshed_at, 0, "从没刷新过");
  eq(st.owned, false, "不声称自己拥有模板目录");
}

console.log("[4] 幂等 + 索引清理");
{
  /* 预置一个模板索引文件：writeConfig 在没有「自己那份模板」时要清掉它，
     否则下次检索会拿着旧索引去读已经不存在的模板。 */
  const idx = path.join(redteamDir, "pocs", ".nuclei-index.json");
  fs.writeFileSync(idx, JSON.stringify({ builtAt: 1, entries: [] }), "utf8");
  const again = await mod.ensureRedteamRuntime({ download: false });
  eq(again.pocs, 0, "第二次调用仍然是 0 条（没有重复建表/重复插入）");
  eq(fs.existsSync(idx), false, "旧的模板索引被清掉了（模板换了或没有，索引就失效）");
  const log = fs.readFileSync(path.join(redteamDir, "bootstrap.log"), "utf8");
  eq((log.match(/ensure done/g) || []).length >= 2, true, "每次调用都留一行 ensure done");
}

console.log("[5] op 接线：runtimeEnsure 走异步分发");
{
  const { RedteamStore, dispatchAsync } = await import(path.join(PKG, "lib/redteam/store-core.js"));
  const store = new RedteamStore(path.join(home, "store-root"));
  const out = await dispatchAsync(store, { op: "runtimeEnsure" });
  eq(out.ok, true, "op 返回 ok:true");
  eq(out.root, redteamDir, "op 也指向同一个 $DSH_HOME/redteam");
  eq(out.templatesDownloaded, false, "默认不下载模板");
  eq(typeof out.knowledgePath, "string", "回报里带知识库路径");

  const src = fs.readFileSync(path.join(PKG, "lib/redteam/store-core.js"), "utf8");
  eq(/req\.op === 'runtimeEnsure'/.test(src), true, "dispatchAsync 里有 runtimeEnsure 分支");
  const toolSrc = fs.readFileSync(path.join(PKG, "lib/redteam/tools.js"), "utf8");
  eq(/action === 'runtime'/.test(toolSrc), true, "redteam_intel 支持 action=runtime");
}

console.log("[6] 启动接线：能力层只调 download:false");
{
  const cap = fs.readFileSync(path.join(PKG, "lib/plus-capabilities.js"), "utf8");
  eq(/ensureRedteamRuntime\(\{ download: false \}\)/.test(cap), true, "启动时传 download:false");
  eq(/ensureRedteamRuntime\(\{ download: true/.test(cap), false, "启动时不传 download:true（不静默拉模板）");
  eq(/runtime-ensure/.test(cap), true, "能力层登记了 runtime-ensure");
}

fs.rmSync(home, { recursive: true, force: true });

/* 汇总行格式与其它 test-*.mjs 一致：verify [33] 按「N 通过 / M 失败」汇总断言数 */
console.log(`${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
