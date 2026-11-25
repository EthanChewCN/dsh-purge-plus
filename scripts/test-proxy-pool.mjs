#!/usr/bin/env node
// [dsh-purge-plus] 代理池子系统（12 个 op）的回归测试。
//
// 背景：safe 2.0.2 的代理池**只有前端** —— 12 个 op 在它的服务端 dispatch 里
// 一条都不存在，调用只会得到 `unknown op`。所以这一块没有上游实现可移植，
// 是从零写的。既然没有「上游行为」可以对照，这里就把我们自己的契约钉死：
//   · 解析：认不出的条目必须逐条报警并跳过，绝不猜一个能用的值；
//   · 落盘：口令只写本机，接口只回 passwordSet；
//   · 连通性：真连 TCP（本机起一个 server），连不上就 ok:false 且**不切换**生效节点；
//   · 不假成功：connect 失败后 activeId 必须还是原值。
// 全部离线，只碰 127.0.0.1。

import fs from "node:fs";
import net from "node:net";
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

function pkgPath(rel) {
  const p = path.join(PKG, rel);
  if (fs.existsSync(p)) return p;
  return path.join(ROOT, "overlay", "files", rel);
}

const { parseProxyConfig } = await import(pkgPath("lib/redteam/proxy-parse.js"));
const { RedteamStore, dispatch, dispatchAsync } = await import(pkgPath("lib/redteam/store-core.js"));

console.log("[1] 解析：Clash 块式 / 流式");
{
  const block = [
    "port: 7890",
    "proxies:",
    "  - name: 香港-01",
    "    type: ss",
    "    server: hk1.example.com",
    "    port: 8443",
    "    cipher: aes-256-gcm",
    "    password: s3cret",
    "  - name: 落地-02",
    "    type: trojan",
    "    server: 203.0.113.9",
    "    port: 443",
    "    password: tj-pass",
    "  - name: wg",
    "    type: wireguard",
    "    server: 198.51.100.1",
    "    port: 51820",
    "rules:",
    "  - DOMAIN-SUFFIX,example.com,DIRECT",
  ].join("\n");
  const got = parseProxyConfig(block);
  eq(got.format, "clash", "识别为 clash");
  eq(got.candidates.length, 2, "两个可用节点（wireguard 被跳过）");
  eq(got.candidates[0].name, "香港-01", "名称原样保留");
  eq([got.candidates[0].protocol, got.candidates[0].host, got.candidates[0].port], ["ss", "hk1.example.com", 8443], "ss 三元组正确");
  eq(got.candidates[0].secret, "s3cret", "口令从 password 读出来");
  eq(got.candidates[0].kind, "direct", "ss 归为 direct（可直连改命令行参数）");
  yes(got.warnings.some((w) => /wireguard/.test(w)), "不支持的协议逐条报警");
  yes(!got.candidates.some((c) => c.name === "rules"), "rules 段不会被当成节点");

  const flow = parseProxyConfig('proxies:\n  - {name: a, type: socks5, server: 10.0.0.1, port: 1080}\n');
  eq(flow.candidates.length, 1, "流式写法也能解析");
  eq([flow.candidates[0].host, flow.candidates[0].port], ["10.0.0.1", 1080], "流式字段正确");
}

console.log("[2] 解析：URI 列表（vmess / ss 两种 / trojan / socks5 / http）");
{
  const vmessJson = { v: "2", ps: "vm-东京", add: "vm.example.com", port: "443", id: "11111111-2222-3333-4444-555555555555", net: "ws", tls: "tls" };
  const vmess = "vmess://" + Buffer.from(JSON.stringify(vmessJson)).toString("base64");
  const ssB64 = "ss://" + Buffer.from("aes-128-gcm:sspass").toString("base64") + "@ss.example.com:8388#ss-新";
  const ssLegacy = "ss://" + Buffer.from("chacha20-ietf-poly1305:legacypass@old.example.com:8389").toString("base64") + "#ss-旧";
  const trojan = "trojan://tjpass@tj.example.com:443?sni=x#tj";
  const socks = "socks5://user1:pw1@socks.example.com:1080#s5";
  const http = "http://h.example.com:8080#hp";
  const got = parseProxyConfig([vmess, ssB64, ssLegacy, trojan, socks, http].join("\n"));
  eq(got.format, "uri-list", "识别为 uri-list");
  eq(got.candidates.length, 6, "六条全部解析出来");
  const byName = Object.fromEntries(got.candidates.map((c) => [c.name, c]));
  eq([byName["vm-东京"].protocol, byName["vm-东京"].host, byName["vm-东京"].port], ["vmess", "vm.example.com", 443], "vmess 从 base64 JSON 取三元组");
  eq(byName["vm-东京"].username, "11111111-2222-3333-4444-555555555555", "vmess 的 uuid 记在 username");
  eq(byName["vm-东京"].kind, "mihomo", "vmess 需要引擎 → kind=mihomo");
  eq([byName["ss-新"].cipher, byName["ss-新"].secret], ["aes-128-gcm", "sspass"], "ss（userinfo base64）拆出 cipher/secret");
  eq([byName["ss-旧"].cipher, byName["ss-旧"].secret], ["chacha20-ietf-poly1305", "legacypass"], "ss（整体 base64）同样拆对");
  eq([byName.tj.secret, byName.tj.username], ["tjpass", ""], "trojan 的口令进 secret，不占 username");
  eq([byName.s5.username, byName.s5.secret], ["user1", "pw1"], "socks5 的账号口令拆开");
  eq(byName.hp.protocol, "http", "http 协议识别");
}

console.log("[3] 解析：base64 订阅包装 / 非法条目 / 去重");
{
  const inner = "socks5://127.0.0.1:1080#a\nsocks5://127.0.0.1:1081#b";
  const wrapped = Buffer.from(inner).toString("base64");
  const got = parseProxyConfig(wrapped);
  eq(got.format, "uri-list+base64", "base64 包装能自动解开");
  eq(got.candidates.length, 2, "解开后两条节点");

  const badOnes = parseProxyConfig("socks5://host-with-slash/x:1080\nsocks5://ok.example.com:99999\nfoo://bar:1");
  eq(badOnes.candidates.length, 0, "非法条目一条都不产出");
  eq(badOnes.ok, false, "一条都认不出时 ok=false");
  yes(badOnes.warnings.length >= 3, "每条非法条目各有一条 warning");

  const dup = parseProxyConfig("socks5://a.example.com:1080#one\nsocks5://a.example.com:1080#two");
  eq(dup.candidates.length, 1, "同协议+主机+端口+账号只留一条");
  yes(dup.warnings.some((w) => /重复/.test(w)), "去重有 warning");

  const empty = parseProxyConfig("   ");
  eq([empty.ok, empty.format], [false, "empty"], "空内容 ok=false 且 format=empty");
}

console.log("[4] 池子：保存策略 / 校验 / 口令不回传");
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plus-proxy-"));
  try {
    const store = new RedteamStore(root);

    const empty = dispatch(store, { op: "proxyPoolGet" });
    eq([empty.ok, empty.total, empty.activeId], [true, 0, ""], "空池快照形状正确");
    eq(empty.note.includes("不修改本机网络"), true, "快照里写明边界（不改本机网络）");

    const saved = dispatch(store, { op: "proxyPoolSave", settings: { enabled: true, autoConnect: true, timeoutMs: 100, enginePath: "/opt/mihomo" } });
    eq([saved.enabled, saved.autoConnect, saved.timeoutMs], [true, true, 500], "timeoutMs 下界收敛到 500");
    const saved2 = dispatch(store, { op: "proxyPoolSave", settings: { timeoutMs: 999999 } });
    eq(saved2.timeoutMs, 60000, "timeoutMs 上界收敛到 60000");
    /* [dsh-purge-plus] R14：只改传过来的字段。旧行为是「未传就重置成 false」，
       面板上表现为「只调超时，自动连接自己关了」。 */
    eq(saved2.enabled, true, "未传 enabled 时保持原值（不再重置成关闭）");

    eq(dispatch(store, { op: "proxyProfileSave", profile: { host: "", port: 1080 } }).ok, false, "缺主机 → ok:false");
    eq(dispatch(store, { op: "proxyProfileSave", profile: { host: "a.com", port: 0 } }).ok, false, "端口 0 → ok:false");
    eq(dispatch(store, { op: "proxyProfileSave", profile: { host: "a.com", port: 70000 } }).ok, false, "端口越界 → ok:false");
    eq(dispatch(store, { op: "proxyProfileSave", profile: { host: "http://a.com/x", port: 80 } }).ok, false, "主机带 scheme → ok:false");

    const first = dispatch(store, { op: "proxyProfileSave", profile: { name: "本地", protocol: "socks5", host: "127.0.0.1", port: 1080, username: "u", secret: "topsecret" } });
    eq(first.ok, true, "合法节点保存成功");
    eq(first.profiles[0].passwordSet, true, "回传 passwordSet=true");
    eq(Object.prototype.hasOwnProperty.call(first.profiles[0], "secret"), false, "**不**回传 secret 字段");

    const kept = dispatch(store, { op: "proxyProfileSave", profile: { id: first.savedId, host: "127.0.0.1", port: 1080, name: "改名" } });
    eq(kept.profiles[0].passwordSet, true, "省略 secret 时保留旧口令");
    const cleared = dispatch(store, { op: "proxyProfileSave", profile: { id: first.savedId, host: "127.0.0.1", port: 1080, secret: "" } });
    eq(cleared.profiles[0].passwordSet, false, "显式传空串才清空口令");
    eq(cleared.profiles[0].name, "改名", "改名生效（name 缺省时保留旧值）");

    eq(dispatch(store, { op: "proxyProfileSave", profile: { id: "p-nope", host: "a.com", port: 1 } }).ok, false, "更新不存在的 id → ok:false");

    /* 落盘必须是合法 JSON，且口令只在盘上。 */
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, "proxy", "pool.json"), "utf8"));
    eq(onDisk.profiles.length, 1, "磁盘上一份节点");
    yes(typeof onDisk.profiles[0].secret === "string", "口令落盘（只在本机文件里）");
    yes(Array.isArray(onDisk.log) && onDisk.log.length >= 1, "日志有记录");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("[5] 导入：去重 / 上限 / 预览不写盘");
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plus-proxy-"));
  try {
    const store = new RedteamStore(root);
    const preview = dispatch(store, { op: "proxyConfigImport", yaml: "socks5://a.example.com:1080#a" });
    eq([preview.ok, preview.candidates.length], [true, 1], "预览返回候选");
    eq(dispatch(store, { op: "proxyPoolGet" }).total, 0, "预览不写盘");

    const one = dispatch(store, { op: "proxyPoolImport", yaml: "socks5://a.example.com:1080#a" });
    eq(one.importedCount, 1, "首次导入 1 条");
    const again = dispatch(store, { op: "proxyPoolImport", yaml: "socks5://a.example.com:1080#a2" });
    eq(again.importedCount, 0, "重复导入 0 条");
    yes(again.warnings.some((w) => /已存在/.test(w)), "重复导入有 warning");

    /* 上限：一次塞 205 条，只应进 200 条（含已有的 1 条）。 */
    const many = Array.from({ length: 205 }, (_, i) => `socks5://h${i}.example.com:1080#n${i}`).join("\n");
    const capped = dispatch(store, { op: "proxyPoolImport", yaml: many });
    eq(dispatch(store, { op: "proxyPoolGet" }).total, 200, "节点数封顶 200");
    yes(capped.warnings.some((w) => /上限/.test(w)), "触顶有 warning");

    const big = dispatch(store, { op: "proxyConfigImport", yaml: "x".repeat(1024 * 1024 + 1) });
    eq(big.ok, false, "超过 1MB 的配置被拒");
    yes(/上限/.test(String(big.error)), "拒绝原因写明上限");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("[6] 连通性：真连 TCP，连不上就不切换");
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plus-proxy-"));
  const server = net.createServer((socket) => socket.destroy());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const livePort = server.address().port;
  const deadPort = await new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => { const p = probe.address().port; probe.close(() => resolve(p)); });
  });
  try {
    const store = new RedteamStore(root);
    dispatch(store, { op: "proxyPoolSave", settings: { timeoutMs: 800 } });
    const a = dispatch(store, { op: "proxyProfileSave", profile: { name: "alive", protocol: "socks5", host: "127.0.0.1", port: livePort } });
    const b = dispatch(store, { op: "proxyProfileSave", profile: { name: "dead", protocol: "socks5", host: "127.0.0.1", port: deadPort } });

    const good = await dispatchAsync(store, { op: "proxyProfileTest", id: a.savedId });
    eq(good.ok, true, "活端口探测成功");
    yes(Number.isFinite(good.latencyMs) && good.latencyMs >= 0, "回报延迟毫秒数");
    const goodRow = good.profiles.find((p) => p.id === a.savedId);
    eq([goodRow.status, Number.isFinite(goodRow.latencyMs)], ["ok", true], "节点状态写回 ok + 延迟");

    const dead = await dispatchAsync(store, { op: "proxyProfileTest", id: b.savedId });
    eq(dead.ok, false, "死端口探测失败");
    yes(/ECONNREFUSED|timeout/.test(String(dead.error)), `失败原因具体（实际「${dead.error}」）`);

    /* connect 失败必须不切换生效节点 —— 这是「不假成功」的核心。 */
    const bad = await dispatchAsync(store, { op: "proxyProfileConnect", id: b.savedId });
    eq(bad.ok, false, "连不上时 connect 返回 ok:false");
    eq(dispatch(store, { op: "proxyPoolGet" }).activeId, "", "失败后生效节点仍为空（没有偷偷切换）");

    const connected = await dispatchAsync(store, { op: "proxyProfileConnect", id: a.savedId });
    eq(connected.ok, true, "活节点 connect 成功");
    eq(dispatch(store, { op: "proxyPoolGet" }).activeId, a.savedId, "生效节点已切换");
    yes(String(connected.proxy_hint).startsWith("socks5://127.0.0.1:"), "给出可直接用的 --proxy 值");

    const batch = await dispatchAsync(store, { op: "proxyPoolTest" });
    eq([batch.testSummary.total, batch.testSummary.passed, batch.testSummary.failed], [2, 1, 1], "批量探测统计正确");

    const best = await dispatchAsync(store, { op: "proxyPoolConnect" });
    eq(best.ok, true, "poolConnect 选出一个可用节点");
    eq(best.activeId, a.savedId, "选中的是唯一活的那个");

    const off = dispatch(store, { op: "proxyPoolDisconnect" });
    eq([off.ok, off.activeId, off.previous], [true, "", a.savedId], "disconnect 清空并回报原值");

    const none = await dispatchAsync(store, { op: "proxyPoolConnect", ids: [b.savedId] });
    eq(none.ok, false, "全部失败时 poolConnect 不返回成功");
    yes(/没有可用节点/.test(String(none.error)), "错误说明没有可用节点");

    eq(dispatch(store, { op: "proxyProfileDelete", id: "p-nope" }).ok, false, "删除不存在的节点 → ok:false");
    eq(dispatch(store, { op: "proxyProfileDelete", id: a.savedId }).deleted, 1, "删除成功");
    eq(dispatch(store, { op: "proxyProfilesDelete", ids: [b.savedId] }).deleted, 1, "批量删除成功");
    eq(dispatch(store, { op: "proxyProfilesDelete", ids: [] }).ok, false, "空 ids → ok:false");
    eq(dispatch(store, { op: "proxyPoolGet" }).total, 0, "删完池子为空");
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("[7] 12 个 op 全部有分发（不是只写了方法）");
{
  const src = fs.readFileSync(path.join(PKG, "lib/redteam/store-core.js"), "utf8");
  const ops = [
    "proxyPoolGet", "proxyPoolSave", "proxyProfileSave", "proxyProfileDelete", "proxyProfilesDelete",
    "proxyPoolImport", "proxyConfigImport", "proxyProfileTest", "proxyPoolTest",
    "proxyProfileConnect", "proxyPoolConnect", "proxyPoolDisconnect",
  ];
  const missing = ops.filter((op) => !new RegExp(`req\\.op === '${op}'|op === '${op}'`).test(src));
  eq(missing, [], `12 个 op 全部有分支（缺：${missing.join("、") || "无"}）`);
}

/* 汇总行格式与其它 test-*.mjs 一致：verify [33] 按「N 通过 / M 失败」汇总断言数 */
console.log(`${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
