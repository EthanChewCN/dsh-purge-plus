#!/usr/bin/env node
// [dsh-purge-plus] 克隆重建一致性（R18）
//
// [49] 保证「每个构建输入都被跟踪」。这一条把它兑现成**事实**：从 HEAD 导出一份
// 干净副本（等价于别人 `git clone` 后拿到的树）→ 在副本里跑一次 build → 与本机
// dist/build/package 逐文件比对。
//
// 判据不是 tgz 字节（gzip 头带 mtime，同内容连打两次也不一样，build.mjs 里已写明），
// 而是**内容摘要**：排序后的相对路径 + 每个文件的 sha256，`dsh.generatedAt` 剔除。
// 摘要相同 = 克隆出来的是同一个包。
//
// 要求工作树干净：有未提交改动时，HEAD 里没有它们，比对必然失败 —— 那不是缺陷，
// 是「你还没提交」。所以这里直接拒绝跑，而不是给出一个会被误读的红。
//
// 用法：
//   node scripts/check-rebuild.mjs            # 导出 HEAD → 构建 → 比对
//   node scripts/check-rebuild.mjs --keep     # 保留临时目录（排查用）

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const KEEP = process.argv.includes("--keep");
const LOCAL = path.join(ROOT, "dist", "build", "package");

const die = (m) => { console.error(`✗ ${m}`); process.exit(1); };

if (!fs.existsSync(LOCAL)) die("本机还没有 dist/build/package：先跑 node scripts/build.mjs");
if (!fs.existsSync(path.join(ROOT, ".git"))) {
  console.log("不适用：没有 .git（已安装的包没有版本控制）");
  process.exit(3);
}

/* 工作树必须干净，否则导出的 HEAD 与刚才构建的那份不是同一批输入。 */
const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", "overlay", "scripts"],
  { cwd: ROOT, encoding: "utf8" }).trim();
if (dirty) die(`overlay/ 或 scripts/ 有未提交改动，克隆出来的必然不是这一份：\n${dirty.split("\n").slice(0, 10).join("\n")}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plus-rebuild-"));
try {
  const tar = execFileSync("git", ["archive", "HEAD"], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", tmp], { input: tar });
  console.log(`从 HEAD 导出 ${(tar.length / 1024 / 1024).toFixed(1)} MB → ${tmp}`);

  const out = execFileSync(process.execPath, [path.join(tmp, "scripts", "build.mjs")],
    { cwd: tmp, encoding: "utf8", timeout: 600000, stdio: ["ignore", "pipe", "pipe"] });
  const m = out.match(/内容指纹 ([0-9a-f]+)/);
  console.log(`副本构建完成${m ? `（指纹 ${m[1]}…）` : ""}`);

  const clonePkg = path.join(tmp, "dist", "build", "package");
  if (!fs.existsSync(clonePkg)) die("副本构建没有产出 dist/build/package");

  /* 逐文件比对：先比集合，再比字节。摘要相同还不够 —— 得说清是哪个文件不同。 */
  const list = (dir) => {
    const out = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p); else out.push(path.relative(dir, p).split(path.sep).join("/"));
      }
    };
    walk(dir);
    return out.sort();
  };
  const a = list(LOCAL);
  const b = list(clonePkg);
  const onlyLocal = a.filter((f) => !b.includes(f));
  const onlyClone = b.filter((f) => !a.includes(f));
  const differing = [];
  for (const f of a.filter((x) => b.includes(x))) {
    if (!fs.readFileSync(path.join(LOCAL, f)).equals(fs.readFileSync(path.join(clonePkg, f)))) differing.push(f);
  }

  const problems = [];
  if (onlyLocal.length) problems.push(`只在本机：${onlyLocal.join("、")}`);
  if (onlyClone.length) problems.push(`只在克隆：${onlyClone.join("、")}`);
  if (differing.length) problems.push(`字节不同：${differing.join("、")}`);

  /* 与 build.mjs 的 contentDigest **逐字同一套规则**（排序路径 + 每文件 sha256，
     剔除构建时刻）。自己发明一套的代价本轮已经付过：第一版只剔了 dsh.generatedAt，
     而字段其实在 plus.generatedAt 下 —— 于是这条判据对同一份产物报「摘要不同」，
     差点被当成真的不一致。 */
  const stableBytes = (rel, abs) => {
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
  };
  const digest = (dir) => {
    const h = createHash("sha256");
    for (const f of list(dir)) {
      if (path.basename(f).startsWith("._")) continue;   // macOS AppleDouble
      h.update(f + "\0");
      h.update(createHash("sha256").update(stableBytes(f, path.join(dir, f))).digest("hex"));
      h.update("\n");
    }
    return h.digest("hex");
  };
  const dLocal = digest(LOCAL);
  const dClone = digest(clonePkg);
  if (dLocal !== dClone) problems.push(`内容摘要不同：本机 ${dLocal.slice(0, 16)}… / 克隆 ${dClone.slice(0, 16)}…`);

  console.log(`文件数 ${a.length} vs ${b.length} · 内容摘要 ${dLocal.slice(0, 16)}…`);
  /* 本机摘要必须与 dist/*.tgz.content 侧车一致：不一致说明 dist 落后于源码，
     那就不是「克隆对不对」的问题，而是「本机这份该重建了」。 */
  const sidecars = fs.readdirSync(path.join(ROOT, "dist")).filter((n) => n.endsWith(".tgz.content"));
  const side = sidecars.map((n) => [n, fs.readFileSync(path.join(ROOT, "dist", n), "utf8").trim()])
    .find(([, v]) => v === dLocal);
  if (side) console.log(`与本机侧车一致：dist/${side[0]}`);
  else problems.push(`本机 dist 落后于源码（摘要与任何 .tgz.content 都不一致）：先重跑 build`);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error("克隆重建一致性：FAIL");
    process.exitCode = 1;
  } else {
    console.log(`克隆重建一致性：OK（${a.length} 个文件逐字节一致，仅 package.json 的 generatedAt 不同）`);
  }
} finally {
  if (KEEP) console.log(`临时目录保留：${tmp}`);
  else fs.rmSync(tmp, { recursive: true, force: true });
}
