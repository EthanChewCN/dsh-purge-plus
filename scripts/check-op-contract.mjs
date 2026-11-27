#!/usr/bin/env node
// ── op 契约门禁 ──────────────────────────────────────────────────────
// 「覆盖社区版与 safe 版的全部能力」这句话的分母是**后端 op**，不是 UI。
//
// 证据：
//   · vendor/community/lib/redteam/store-core.js  dispatch() 是扁平
//     `if (op === 'x')` 链 —— op 名就是能力名；UI 只是它的消费者
//     （client.js:828 `api = (req) => fetch('/redteam/api', {body: req})`）。
//   · safe 的 dispatch 是 community 的严格超集（community-only 0 条），
//     所以「两家并集」就是 safe 的 op 表。
//
// 本门禁锁三件事：
//   A. 两家上游的每一条 op 都必须在我们产物的 redteam dispatch 里
//      —— 丢一条 = 丢一项能力，而界面上只会「少个按钮」，不会报错。
//   B. 产物 UI 里出现的每一个字面量 op 名都必须**在某处被处理**。
//      写错 op 名时后端返回 unknown op，而 UI 的 catch 会把它当成
//      「面板要重启」（client.js:1346），用户看到的是空白 —— 这类错
//      必须在构建期红，而不是等用户点。
//   C. 我们新增的 op 必须登记在 overlay/op-ledger.json，写清覆盖什么。
//
// 用法：node scripts/check-op-contract.mjs [--json]
// 退出码：0 通过；1 不通过；2 前置缺失（未构建）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILT = path.join(ROOT, "dist", "build", "package");
const LEDGER = path.join(ROOT, "overlay", "op-ledger.json");

/** dispatch() 里的 `op === 'x'`（含 `|| op === 'y'` 链）。 */
function dispatchOps(file) {
  const src = fs.readFileSync(file, "utf8");
  const at = src.indexOf("export function dispatch(");
  const body = at >= 0 ? src.slice(at) : src;
  const out = new Set();
  for (const m of body.matchAll(/op\s*===\s*(?:'([^']+)'|"([^"]+)")/g)) out.add(m[1] || m[2]);
  return out;
}

/** 产物里**任何**形式的 op 处理器：`op === 'x'`、`op !== 'x'`、
 *  `['a','b'].includes(request.op)`、`body.op==="x"` 都算。
 *  判据：同一行里出现 `.op` 或 `op ==`/`op !=`，且带字符串字面量。
 *  宁可放宽（漏报一次拼写错误）也不要误报 —— 误报会训练人忽略红灯。 */
function handledOps(dir) {
  const out = new Map(); // op -> file
  const walk = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const fp = path.join(p, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(fp);
      } else if (e.isFile() && e.name.endsWith(".js")) {
        const rel = path.relative(dir, fp);
        const LIT = `(?:'([A-Za-z][\\w.]*)'|"([A-Za-z][\\w.]*)")`;
        for (const line of fs.readFileSync(fp, "utf8").split("\n")) {
          /* 只收「参与 op 比较的那个字面量」。
             以前只要行里出现 `.op` 就把**整行所有字符串**登记成 op：
             `if (request.op === 'x') return { ok:false, error:'中文文案' }`
             会把 x / ok / error / 整条文案都算成「已处理的 op」，
             任何与常见字段名撞名的拼写错误都能蒙混过关（审计 B-7）。 */
          for (const m of line.matchAll(new RegExp(`\\bop\\s*[!=]==\\s*${LIT}`, "g"))) {
            const op = m[1] || m[2];
            if (op && !out.has(op)) out.set(op, rel);
          }
          /* ['a','b'].includes(op) —— 只收方括号里的那组字面量 */
          const inc = line.match(new RegExp(`\\[([^\\]]*)\\]\\s*\\.includes\\(\\s*[\\w.]*op\\b`));
          if (inc) {
            for (const m of inc[1].matchAll(new RegExp(LIT, "g"))) {
              const op = m[1] || m[2];
              if (op && !out.has(op)) out.set(op, rel);
            }
          }
          /* switch (op) { case 'x': } */
          const cs = line.match(new RegExp(`\\bcase\\s+${LIT}\\s*:`));
          if (cs && /switch\s*\(\s*[\w.]*op\s*\)/.test(line)) {
            const op = cs[1] || cs[2];
            if (op && !out.has(op)) out.set(op, rel);
          }
        }
      }
    }
  };
  walk(dir);
  return out;
}

/** 产物 UI 里 `op: "x"` 形式的调用点。 */
function uiOpRefs(dir) {
  const refs = new Map();
  const walk = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const fp = path.join(p, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(fp);
      } else if (e.isFile() && e.name.endsWith(".js")) {
        fs.readFileSync(fp, "utf8")
          .split("\n")
          .forEach((line, i) => {
            for (const m of line.matchAll(/\bop\s*:\s*(?:"([A-Za-z][\w.]*)"|'([A-Za-z][\w.]*)')/g)) {
              const op = m[1] || m[2];
              if (!refs.has(op)) refs.set(op, []);
              refs.get(op).push(`${path.relative(dir, fp)}:${i + 1}`);
            }
          });
      }
    }
  };
  walk(dir);
  return refs;
}

/** 由**默认分支**处理的 op：没有显式比较，所以上面的扫描看不见。
 *  目前只有一条，且必须写清出处 —— 这个表一旦膨胀，就说明「无人处理的 op」
 *  这类错误又被放行了。 */
const IMPLICIT_OPS = {
  // lib/update.js:1390 `const op = String(body.op || (body.auto ? 'auto' : 'apply'))`
  // 之后是 if 链；没有 `op === 'apply'` 分支，apply 落到链尾的默认返回。
  // 面板 doUpdate 发的就是 op:'apply'（client.js:13577）。
  apply: "lib/update.js:1390 默认分支（无显式比较）",
};

const fail = (msg) => {
  console.error(`FAIL  ${msg}`);
  process.exitCode = 1;
};

const cFile = path.join(ROOT, "vendor", "community", "lib", "redteam", "store-core.js");
const sFile = path.join(ROOT, "vendor", "safe", "lib", "redteam", "store-core.js");
const bFile = path.join(BUILT, "lib", "redteam", "store-core.js");
for (const f of [cFile, sFile]) {
  if (!fs.existsSync(f)) {
    console.error(`SKIP  op 契约：缺少 ${path.relative(ROOT, f)}`);
    process.exit(2);
  }
}
if (!fs.existsSync(bFile)) {
  console.error("SKIP  op 契约：产物未构建（dist/build/package 不存在）");
  process.exit(2);
}

const C = dispatchOps(cFile);
const S = dispatchOps(sFile);
const B = dispatchOps(bFile);
const union = new Set([...C, ...S]);

// A. 上游能力必须全部在产物里
const missing = [...union].filter((op) => !B.has(op)).sort();
for (const op of missing) fail(`上游 op 在产物中缺失：${op}`);

// B. UI 引用的 op 必须有人处理
const handled = handledOps(BUILT);
const refs = uiOpRefs(BUILT);
const phantom = [...refs.keys()]
  .filter((op) => !handled.has(op) && !B.has(op) && !IMPLICIT_OPS[op])
  .sort();
for (const op of phantom) {
  fail(`UI 引用了无人处理的 op：${op}（${refs.get(op).slice(0, 3).join(", ")}）`);
}

// C. 自有 op 必须登记
//
// `ops` 是「我们多出来的能力」，`aliases` 是「上游有、我们换了名字但保留了同名入口」。
// 两类都必须登记：前者防止死代码，后者防止「名字没了却没人发现」。
// 两者都做**反向**校验（登记了但产物里没有 → 红），否则删掉实现时台账会一直留着假条目。
const ours = [...B].filter((op) => !union.has(op)).sort();
const ledgerFile = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : {};
const ledger = { ...(ledgerFile.aliases || {}), ...(ledgerFile.ops || {}) };
for (const op of ours.filter((o) => !ledger[o])) {
  fail(`新增 op 未登记到 overlay/op-ledger.json：${op}`);
}
for (const op of Object.keys(ledger).filter((o) => !B.has(o)).sort()) {
  fail(`op-ledger.json 登记的 op 在产物中不存在：${op}`);
}

// 报告
const covered = union.size - missing.length;
if (process.argv.includes("--json")) {
  console.log(
    JSON.stringify(
      {
        community: C.size,
        safe: S.size,
        union: union.size,
        built: B.size,
        coverage: `${covered}/${union.size}`,
        ours,
        missing,
        phantom,
      },
      null,
      2,
    ),
  );
} else {
  console.log(
    `op 契约：community ${C.size} · safe ${S.size} · union ${union.size} · 产物 ${B.size}`,
  );
  console.log(
    `  覆盖 ${covered}/${union.size}${missing.length ? `（缺 ${missing.join(", ")}）` : ""}` +
      ` · 自有 ${ours.length} 条${ours.length ? `（${ours.join(", ")}）` : ""}`,
  );
  console.log(
    `  UI 引用 ${refs.size} 个 op${phantom.length ? `，无人处理 ${phantom.length}` : "，全部可解析"}`,
  );
}
if (process.exitCode) console.error("op 契约：不通过");
else console.log("op 契约：OK");
