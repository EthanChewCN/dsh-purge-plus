#!/usr/bin/env node
/**
 * /redteam/api 来源校验回归（2026-11-23 收紧回环放行后新增）。
 *
 * 为什么单独一个脚本：这条判据**写在闭包里**，没有任何导出，功能测试碰不到；
 * 而它守的是「浏览器里任意网页能不能向 127.0.0.1 写资产/漏洞/凭据」。
 * 所以这里把判据从产物里**切出来**，配假 req 跑真值表 —— 断言的是行为，
 * 不是「源码里有这行字」。
 *
 * 背景：原判据 `if (loopback) return true` 只看 remoteAddress。浏览器向
 * 127.0.0.1 POST 时 remoteAddress 恒为回环，等于没有来源校验（CSRF）。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const UI = path.join(ROOT, "dist", "build", "package", "lib", "redteam", "ui.js");

let pass = 0;
const fails = [];
const ok = (cond, name) => { if (cond) { pass += 1; } else { fails.push(name); } };

const src = fs.readFileSync(UI, "utf8");

/* 0. 旧判据必须不存在 */
ok(!src.includes("if (loopback) return true"), "旧判据 `if (loopback) return true` 已移除");

/* 1. 切出判据 */
const at = src.indexOf("const remote = req.socket");
const originAt = src.indexOf("const originOk = (() => {", at);
const endAt = src.indexOf("})()", originAt);
ok(at >= 0 && originAt > at && endAt > originAt, "能从产物里切出 originOk 判据块");
if (!(at >= 0 && originAt > at && endAt > originAt)) {
  console.error(`✗ test-redteam-origin：${pass} 通过 / ${fails.length} 失败\n  ` + fails.join("\n  "));
  process.exit(1);
}
const block = src.slice(at, endAt + 4);
const makeJudge = new Function("req", `${block}\n return originOk;`);

const LB = "127.0.0.1";
const req = (remote, headers = {}) => ({ socket: { remoteAddress: remote }, headers });

/* 2. 真值表 */
const cases = [
  // [描述, req, 期望]
  ["回环 + 无 Origin（curl / 插件自身 fetch）", req(LB, {}), true],
  ["回环 + Origin: null（桌面端沙箱渲染进程）", req(LB, { origin: "null" }), true],
  ["回环 + Origin: app://dsh", req(LB, { origin: "app://dsh" }), true],
  ["回环 + Origin: file://", req(LB, { origin: "file://" }), true],
  ["回环 + 同源 http://127.0.0.1:56722", req(LB, { host: "127.0.0.1:56722", origin: "http://127.0.0.1:56722" }), true],
  ["回环 + localhost 与 127.0.0.1 互认", req(LB, { host: "127.0.0.1:56722", origin: "http://localhost:56722" }), true],
  ["回环 + 跨站 https://evil.example（CSRF）", req(LB, { host: "127.0.0.1:56722", origin: "https://evil.example" }), false],
  ["回环 + 局域网 http://192.168.1.5:8080", req(LB, { host: "127.0.0.1:56722", origin: "http://192.168.1.5:8080" }), false],
  ["非回环 + 无 Origin", req("192.168.1.9", {}), false],
  ["非回环 + 同源", req("10.0.0.2", { host: "10.0.0.2:1234", origin: "http://10.0.0.2:1234" }), true],
  ["回环 + 畸形 Origin", req(LB, { host: "127.0.0.1:56722", origin: "http://[bad" }), false],
];

for (const [name, r, want] of cases) {
  let got;
  try { got = makeJudge(r); } catch (e) { got = `throw:${e.message}`; }
  ok(got === want, `${name} → ${want}（实际 ${got}）`);
}

/* 3. 判据必须真的在请求入口被调用（切出来能跑，不等于接上了） */
ok(/if \(!originOk\)[\s\S]{0,120}cross-origin request rejected/.test(src), "originOk 为 false 时返回 403");

if (fails.length) {
  console.error(`✗ test-redteam-origin：${pass} 通过 / ${fails.length} 失败\n  ` + fails.join("\n  "));
  process.exit(1);
}
console.log(`✓ test-redteam-origin：${pass} 通过 / 0 失败`);
