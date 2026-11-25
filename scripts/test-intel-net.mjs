#!/usr/bin/env node
// [dsh-purge-plus] 情报刷新（真下载路径）：行为回归。
//
// 为什么必须测这一条：`intelUpdate` 是本包**唯一**会发网络请求并写盘的入口，
// 而它此前零自动化测试 —— 18 个测试脚本没有一个碰它。它的坑全在「看起来更新了、
// 其实写坏了」上，而这类坑在没有测试时只能等用户踩：
//   · CISA 返回一页 HTML 错误页 → JSON.parse 抛，但 200 + `{}` 不抛
//   · `{}` 解析成功但 `vulnerabilities` 不存在 → 落盘一个空库，把已有数据盖掉
//   · dest 不以 .json 结尾时 `dest.replace(/\.json$/,'.meta.json')` 返回 dest 本身
//     → 48MB 数据被 11 字节元数据覆盖，函数还返回 updated
//   · 下载没有大小上限 → 一次错误的镜像重定向就能把磁盘写满
//
// 全程零联网：把 globalThis.fetch 换成本地桩，返回构造好的字节。
// 失败路径的验证重点是「已有数据没被破坏」，所以每条失败用例都先放一个已知文件。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
/* 既能在仓库里跑（dist/build/package），也能在**已安装的包里**跑（脚本所在包的根）——
   发布包现在带 test-*.mjs，验收可以对已安装产物复跑（审计 B-5）。 */
const PKG = fs.existsSync(path.join(ROOT, "dist", "build", "package"))
  ? path.join(ROOT, "dist", "build", "package")
  : ROOT;
const MOD = path.join(PKG, "lib", "redteam", "store-core.js");

if (!fs.existsSync(MOD)) {
  console.error("dist/build/package 不存在，先跑 node scripts/build.mjs");
  process.exit(1);
}
const { RedteamStore } = await import(pathToFileURL(MOD).href);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "intel-"));
const store = new RedteamStore(tmp);

/* ---------- fetch 桩 ---------- */
const realFetch = globalThis.fetch;
let scripted = null; // { status, body: Buffer|string, headers }
function stubFetch(reply) {
  scripted = reply;
  globalThis.fetch = async () => {
    const r = typeof reply === "function" ? reply() : reply;
    if (r && r.throw) throw r.throw;
    const buf = Buffer.isBuffer(r.body) ? r.body : Buffer.from(String(r.body ?? ""), "utf8");
    let sent = false;
    return {
      ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
      status: r.status ?? 200,
      statusText: r.statusText ?? "",
      headers: { get: (k) => (r.headers && r.headers[k.toLowerCase()]) || null },
      body: {
        getReader() {
          return {
            async read() {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: new Uint8Array(buf) };
            },
            async cancel() {},
          };
        },
      },
    };
  };
}

const KEV_PATH = path.join(tmp, "intel", "kev.json");
const KEV_META = path.join(tmp, "intel", "kev.meta.json");
const writeSeed = (p, text) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, "utf8");
};
const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
const resetSeed = () => {
  fs.rmSync(path.join(tmp, "intel"), { recursive: true, force: true });
  writeSeed(KEV_PATH, '{"vulnerabilities":[{"cveID":"SEED"}]}');
};

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

const KEV_OK = {
  catalogVersion: "2026.11.25",
  dateReleased: "2026-11-25",
  vulnerabilities: [
    { cveID: "CVE-2021-44228", vendorProject: "Apache" },
    { cveID: "CVE-2023-4966", vendorProject: "Citrix" },
  ],
};

/* ① 正常路径：数据与元数据写到**两个不同的文件** */
check("KEV 正常下载：落盘 + 元数据分开 + 计数正确", async () => {
  resetSeed();
  stubFetch({ body: JSON.stringify(KEV_OK) });
  const out = await store.intelUpdate("kev");
  const r = out.results[0];
  if (r.action !== "updated") throw new Error(`期望 updated，实际 ${r.action}：${r.error || ""}`);
  if (r.count !== 2) throw new Error(`期望 2 条，实际 ${r.count}`);
  if (!fs.existsSync(KEV_PATH)) throw new Error("数据文件没落盘");
  if (!fs.existsSync(KEV_META)) throw new Error("元数据文件没落盘");
  if (fs.readFileSync(KEV_PATH, "utf8") === fs.readFileSync(KEV_META, "utf8")) throw new Error("数据与元数据内容相同 —— 疑似互相覆盖");
  const meta = JSON.parse(fs.readFileSync(KEV_META, "utf8"));
  if (meta.count !== 2) throw new Error("元数据里 count 不对");
  if (!/^[0-9a-f]{64}$/.test(String(meta.sha256))) throw new Error("元数据缺 sha256");
});

/* ② dest 不以 .json 结尾：元数据必须落在 dest+'.meta.json'，绝不能覆盖数据 */
check("KEV dest 非 .json 结尾：元数据不覆盖数据（回归 R-02）", async () => {
  const odd = path.join(tmp, "intel", "kev-dump");
  stubFetch({ body: JSON.stringify(KEV_OK) });
  const out = await store.intelUpdate("kev", { dest: odd });
  if (out.results[0].action !== "updated") throw new Error("应成功");
  const data = readIf(odd);
  if (data === null) throw new Error("数据文件没落盘");
  if (!data.includes("CVE-2021-44228")) throw new Error("数据文件被元数据覆盖了");
  if (!fs.existsSync(odd + ".meta.json")) throw new Error("元数据没落到 dest+'.meta.json'");
});

/* ③ 错误页：200 + HTML 必须被拒，且已有数据不被破坏 */
check("KEV 返回 HTML 错误页：拒绝落盘且保留旧数据", async () => {
  resetSeed();
  const before = readIf(KEV_PATH);
  stubFetch({ body: "<html><body>Service Unavailable</body></html>" });
  const r = (await store.intelUpdate("kev")).results[0];
  if (r.action !== "failed") throw new Error(`期望 failed，实际 ${r.action}`);
  if (!/不是 JSON/.test(r.error)) throw new Error(`错误文案没说清原因：${r.error}`);
  if (readIf(KEV_PATH) !== before) throw new Error("旧数据被改动了");
});

/* ④ 200 + `{}`：JSON 解析成功但形状不对 —— 这是最容易被吞的一类 */
check("KEV 返回 {}：形状不对必须拒绝（JSON.parse 不抛的那一类）", async () => {
  resetSeed();
  const before = readIf(KEV_PATH);
  stubFetch({ body: "{}" });
  const r = (await store.intelUpdate("kev")).results[0];
  if (r.action !== "failed") throw new Error(`期望 failed，实际 ${r.action}`);
  if (!/vulnerabilities/.test(r.error)) throw new Error(`错误文案没点出缺哪个字段：${r.error}`);
  if (readIf(KEV_PATH) !== before) throw new Error("旧数据被改动了");
});

/* ⑤ 空数组：拒绝用空目录覆盖已有数据 */
check("KEV 空 vulnerabilities：拒绝覆盖", async () => {
  resetSeed();
  const before = readIf(KEV_PATH);
  stubFetch({ body: JSON.stringify({ vulnerabilities: [] }) });
  const r = (await store.intelUpdate("kev")).results[0];
  if (r.action !== "failed") throw new Error(`期望 failed，实际 ${r.action}`);
  if (readIf(KEV_PATH) !== before) throw new Error("旧数据被清空了");
});

/* ⑥ 条目缺 cveID：形状校验要落到每条，不只是顶层 */
check("KEV 条目缺 cveID：拒绝落盘", async () => {
  resetSeed();
  stubFetch({ body: JSON.stringify({ vulnerabilities: [{ vendorProject: "x" }] }) });
  const r = (await store.intelUpdate("kev")).results[0];
  if (r.action !== "failed") throw new Error(`期望 failed，实际 ${r.action}`);
  if (!/cveID/.test(r.error)) throw new Error(`错误文案没点出 cveID：${r.error}`);
});

/* ⑦ dry_run：校验通过但不落盘 */
check("KEV dry_run：校验通过且一个字节都不写", async () => {
  resetSeed();
  const before = readIf(KEV_PATH);
  stubFetch({ body: JSON.stringify(KEV_OK) });
  const r = (await store.intelUpdate("kev", { dry_run: true })).results[0];
  if (r.action !== "dry-run") throw new Error(`期望 dry-run，实际 ${r.action}`);
  if (r.count !== 2) throw new Error("dry-run 也要报条数");
  if (readIf(KEV_PATH) !== before) throw new Error("dry_run 写了盘");
});

/* ⑧ 大小上限：超限立刻中断，不把内存吃满 */
check("KEV 超过大小上限：中断并报错", async () => {
  resetSeed();
  const saved = RedteamStore.INTEL_SOURCES.kev.max_bytes;
  RedteamStore.INTEL_SOURCES.kev.max_bytes = 64;
  try {
    stubFetch({ body: JSON.stringify(KEV_OK) });
    const r = (await store.intelUpdate("kev")).results[0];
    if (r.action !== "failed") throw new Error(`期望 failed，实际 ${r.action}`);
    if (!/上限/.test(r.error)) throw new Error(`错误文案没点出上限：${r.error}`);
  } finally {
    RedteamStore.INTEL_SOURCES.kev.max_bytes = saved;
  }
});

/* ⑨ 网络异常：fetch 抛错要被收成 failed，不能冒泡打断 all */
check("网络异常：收成 failed，不打断 all 的其它资源", async () => {
  resetSeed();
  stubFetch({ throw: new Error("ECONNREFUSED") });
  const out = await store.intelUpdate("all", { dest: path.join(tmp, "intel", "kev.json") });
  /* all 现在含三项：kev / nuclei / cve。第三项（CVE 整库）没配 REDTEAM_INTEL_BASE
     时必须是 skipped/disabled —— 不是 failed，也不该冒泡打断前两项。 */
  if (!Array.isArray(out.results) || out.results.length !== 3) throw new Error("all 应当返回三条结果（kev/nuclei/cve）");
  if (out.results[0].action !== "failed") throw new Error("KEV 应失败");
  if (out.results[1].action !== "failed") throw new Error("nuclei 也应失败");
  if (out.results[2].key !== "cve") throw new Error("第三项应是 cve");
  if (out.results[2].action !== "skipped" || out.results[2].reason !== "disabled") throw new Error("没配数据源时 cve 应为 skipped/disabled");
  if (!out.results.slice(0, 2).every((r) => typeof r.error === "string" && r.error)) throw new Error("失败项必须带 error 文案");
});

/* ⑩ nuclei 的 gzip 魔数：200 + HTML 也会超过 1024 字节，靠 tar 报错太晚 */
check("nuclei 非 gzip 内容：拒绝解压（错误页防线）", async () => {
  stubFetch({ body: Buffer.concat([Buffer.from("<html>"), Buffer.alloc(2048, 0x20)]) });
  const r = (await store.intelUpdate("nuclei", { dest: path.join(tmp, "nuclei-x") })).results[0];
  if (r.action !== "failed") throw new Error(`期望 failed，实际 ${r.action}`);
  if (!/gzip/.test(r.error)) throw new Error(`错误文案没点出 gzip：${r.error}`);
  if (fs.existsSync(path.join(tmp, "nuclei-x"))) throw new Error("失败路径不应创建目标目录");
});

/* ⑪ nuclei 内容过小：不像模板包 */
check("nuclei 内容过小：拒绝", async () => {
  stubFetch({ body: Buffer.from([0x1f, 0x8b, 0x08]) });
  const r = (await store.intelUpdate("nuclei", { dest: path.join(tmp, "nuclei-y") })).results[0];
  if (r.action !== "failed") throw new Error(`期望 failed，实际 ${r.action}`);
  if (!/过小/.test(r.error)) throw new Error(`错误文案没点出过小：${r.error}`);
});

/* ⑫ 未知目标与 wordlists：要说清是「跳过」还是「不认识」，不能静默成功 */
check("未知目标：failed 且列出可选值；wordlists：skipped 且说明原因", async () => {
  const bad = (await store.intelUpdate("__nope__")).results[0];
  if (bad.action !== "failed") throw new Error("未知目标必须 failed");
  if (!/kev\/nuclei\/cve\/wordlists/.test(bad.error)) throw new Error("错误文案没列可选值（应含 cve）");
  const wl = (await store.intelUpdate("wordlists")).results[0];
  if (wl.action !== "skipped") throw new Error("wordlists 应为 skipped");
  if (!wl.reason) throw new Error("skipped 必须给原因");
});

/* ⑬ 更新日志：成功与失败都留痕（谁在什么时候把什么换成了什么） */
check("更新日志：成功与失败各留一行", async () => {
  /* 前面的用例各自 resetSeed 过（resetSeed 会连 intel/ 一起清掉），
     所以这里先自己造一次成功 + 一次失败，再断言两类记录都在。 */
  stubFetch({ body: JSON.stringify(KEV_OK) });
  const okRun = (await store.intelUpdate("kev")).results[0];
  if (okRun.action !== "updated") throw new Error("造成功记录失败：" + okRun.error);
  stubFetch({ body: "{}" });
  await store.intelUpdate("kev");
  const logPath = path.join(tmp, "intel", "update-log.jsonl");
  if (!fs.existsSync(logPath)) throw new Error("没有 update-log.jsonl");
  const lines = fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (!lines.some((x) => x.action === "updated")) throw new Error("没有成功记录");
  if (!lines.some((x) => x.action === "failed")) throw new Error("没有失败记录");
  if (!lines.every((x) => typeof x.at === "string" && x.at)) throw new Error("记录缺时间戳");
});

/* ⑭ 临时文件不残留：中途失败不能在 intel/ 下留 .tmp-* */
check("失败路径不残留临时文件", async () => {
  const intelDir = path.join(tmp, "intel");
  const leftovers = fs.readdirSync(intelDir).filter((n) => n.includes(".tmp-") || n.startsWith(".nuclei-stage-"));
  if (leftovers.length) throw new Error(`残留：${leftovers.join(",")}`);
});

/* ---------- 跑 ---------- */
let pass = 0;
const fails = [];
for (const t of tests) {
  try {
    await t.fn();
    pass += 1;
    console.log(`  ✓ ${t.name}`);
  } catch (e) {
    fails.push(`${t.name} → ${e && e.message ? e.message : e}`);
    console.log(`  ✗ ${t.name} → ${e && e.message ? e.message : e}`);
  }
}
globalThis.fetch = realFetch;
fs.rmSync(tmp, { recursive: true, force: true });

console.log(fails.length ? `\n✗ test-intel-net：${pass} 通过 / ${fails.length} 失败` : `\n✓ test-intel-net：${pass} 通过 / 0 失败`);
process.exit(fails.length ? 1 : 0);
