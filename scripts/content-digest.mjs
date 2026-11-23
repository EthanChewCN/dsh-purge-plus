#!/usr/bin/env node
// [dsh-purge-plus] 目录内容摘要：排序后的相对路径 + 每文件 sha256，再汇总成一个 sha256。
//
// 用途：scripts/sync-upstream.sh 在替换 vendor 之前，用它给「解包后的上游包」
// 算一个与 tar 字节、mtime、压缩参数都无关的内容指纹，再与
// scripts/upstream-pins.json 里该「包名@版本」的 pin 比对。
//
// 为什么还要 pin tgz 的 sha256：发布方给了 SHA256SUMS.txt，那个哈希是**来源证明**
// （证明我们拿到的是官方发布物），内容摘要证明的是**内容身份**（解包后与我们审计过的
// 树一致）。两个都要，前者防「拿错包/被换包」，后者防「同版本号不同内容」。
//
// 用法: node scripts/content-digest.mjs <目录>
// 输出: 一行 sha256 hex；失败非零退出，原因写 stderr。

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`✗ 目录不存在或不是目录：${dir || "(未提供)"}`);
  process.exit(1);
}

const hash = createHash("sha256");
const walk = (rel) => {
  const abs = path.join(dir, rel);
  const entries = fs.readdirSync(abs, { withFileTypes: true })
    .map((d) => d.name)
    .filter((name) => !name.startsWith("._")) // macOS AppleDouble 不属于内容
    .sort();
  for (const name of entries) {
    const childRel = rel ? `${rel}/${name}` : name;
    const childAbs = path.join(dir, childRel);
    if (fs.statSync(childAbs).isDirectory()) walk(childRel);
    else {
      hash.update(`${childRel}\0`);
      hash.update(createHash("sha256").update(fs.readFileSync(childAbs)).digest("hex"));
      hash.update("\n");
    }
  }
};
walk("");
console.log(hash.digest("hex"));
