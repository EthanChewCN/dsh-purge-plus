#!/bin/bash
# [dsh-purge-plus] 上游升级：换 vendor/community → 重放 overlay → 重建 → 验收
#
# 用法:
#   ./scripts/sync-upstream.sh <新版本 tgz 或解包目录> [新版本号]
#
# 例:
#   ./scripts/sync-upstream.sh ~/Downloads/dsh-purge-community-1.7.21.tgz
#   ./scripts/sync-upstream.sh ~/.dsh/dsh-purge-community/pkgs/<hash>/dsh-purge-community-1.7.21.tgz
#
# 设计：vendor 整目录替换，不做 git merge。
#   本仓库对上游的改动面是 176 条锚点编辑（overlay/edits.mjs）+ 86 处
#   snippet 注入，冲突会以「锚点命中 0 次 / 2 次」的形式在 build 阶段
#   硬失败，不会静默跑歪。
#
# 完整性（2026-11-23 新增）：替换 vendor 之前先验明正身 ——
#   (1) 输入是 tgz 时核 tarball sha256（来源证明，对应上游 SHA256SUMS.txt）；
#   (2) 解包后核内容摘要（scripts/content-digest.mjs，内容身份）。
#   两道都要过；无 pin 或不符一律硬失败退出。

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

SRC="${1:?用法: $0 <新版本 tgz 或解包目录> [新版本号]}"
NEWVER="${2:-}"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "=== 0a. 来源校验（输入是 tgz 时先验，解包之前）==="
# 放在解包之前：坏包/换包应该在「读它」之前就被拒，而不是等 tar 报错。
PRE_PIN_KEY=""
if [ -f "$SRC" ]; then
  GOT_TAR_SHA="$(shasum -a 256 "$SRC" | awk '{print $1}')"
  PRE_PIN_KEY="$(node -e "
const p = require('./scripts/upstream-pins.json');
const hit = Object.entries(p.syncInputs || {}).find(([, v]) => v && v.tarballSha256 === '$GOT_TAR_SHA');
process.stdout.write(hit ? hit[0] : '');
")"
  echo "  tarball sha256: $GOT_TAR_SHA"
  if [ -z "$PRE_PIN_KEY" ]; then
    echo "✗ 这个文件不在 upstream-pins.json 的已登记发行物里（拿错包 / 被替换 / 新版本未登记）。"
    echo "  已登记的 tarballSha256："
    node -e "const p=require('./scripts/upstream-pins.json');for(const [k,v] of Object.entries(p.syncInputs||{}))console.log('   ',k,v.tarballSha256||'(无)')"
    exit 1
  fi
  echo "  ✓ 命中已登记发行物：$PRE_PIN_KEY"
fi

echo "=== 0. 解包上游 ==="
if [ -d "$SRC" ]; then
  cp -a "$SRC/." "$STAGE/"
elif [ -f "$SRC" ]; then
  tar -xzf "$SRC" -C "$STAGE"
else
  echo "✗ 找不到 $SRC"; exit 1
fi
# npm/pnpm 打的 tgz 带 package/ 前缀
if [ -f "$STAGE/package/package.json" ]; then
  SRCROOT="$STAGE/package"
else
  SRCROOT="$STAGE"
fi

[ -f "$SRCROOT/package.json" ] || { echo "✗ 解包后没有 package.json：$SRCROOT"; exit 1; }
OLDVER="$(node -e 'console.log(require("./vendor/community/package.json").version)')"
GOTVER="$(node -e "console.log(require('$SRCROOT/package.json').version)")"
echo "  当前 vendor: $OLDVER"
echo "  新上游:      $GOTVER"

if [ "$OLDVER" = "$GOTVER" ] && [ -z "$NEWVER" ]; then
  echo "  同版本，仍继续（用于重放 overlay）。"
fi

echo
echo "=== 0b. 完整性校验（来源 + 内容）==="
PKGNAME="$(node -e "console.log(require('$SRCROOT/package.json').name)")"
PINKEY="$PKGNAME@$GOTVER"
PIN_JSON="$(node -e "
const p = require('./scripts/upstream-pins.json');
const e = (p.syncInputs || {})['$PINKEY'] || null;
process.stdout.write(JSON.stringify(e || null));
")"
if [ "$PIN_JSON" = "null" ]; then
  echo "✗ upstream-pins.json 里没有 $PINKEY 的 pin，拒绝替换 vendor。"
  echo "  先人工核对这个包的来源，再把 tarballSha256 与 contentDigest 填进"
  echo "  scripts/upstream-pins.json 的 syncInputs[\"$PINKEY\"] 后重跑。"
  exit 1
fi
if [ -n "$PRE_PIN_KEY" ] && [ "$PRE_PIN_KEY" != "$PINKEY" ]; then
  echo "✗ 包的自我声明（$PINKEY）与来源命中（$PRE_PIN_KEY）不一致 —— 拒绝继续。"
  exit 1
fi
if [ -f "$SRC" ]; then
  GOT_TAR_SHA="$(shasum -a 256 "$SRC" | awk '{print $1}')"
  PIN_TAR_SHA="$(node -e "console.log(($PIN_JSON).tarballSha256 || '')")"
  echo "  tarball sha256: $GOT_TAR_SHA"
  if [ -z "$PIN_TAR_SHA" ]; then
    echo "✗ pin 里没有 tarballSha256，但输入是 tgz —— 无法证明来源，拒绝继续。"
    exit 1
  fi
  if [ "$GOT_TAR_SHA" != "$PIN_TAR_SHA" ]; then
    echo "✗ tarball sha256 与 pin 不符（拿错包，或包被替换过）。"
    echo "  pin: $PIN_TAR_SHA"
    exit 1
  fi
  echo "  ✓ 来源校验通过（与上游 release 的 SHA256SUMS.txt 同口径）"
fi
GOT_DIGEST="$(node scripts/content-digest.mjs "$SRCROOT")"
PIN_DIGEST="$(node -e "console.log(($PIN_JSON).contentDigest || '')")"
echo "  内容摘要: $GOT_DIGEST"
if [ -z "$PIN_DIGEST" ]; then
  echo "✗ pin 里没有 contentDigest，拒绝替换 vendor。"
  exit 1
fi
if [ "$GOT_DIGEST" != "$PIN_DIGEST" ]; then
  echo "✗ 内容摘要与 pin 不符（同版本号不同内容，或解包不完整）。"
  echo "  pin: $PIN_DIGEST"
  exit 1
fi
echo "  ✓ 内容校验通过"

echo
echo "=== 1. 备份旧 vendor ==="
BK="$ROOT/.upstream-backup/$OLDVER-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK"
cp -a vendor/community "$BK/"
echo "  $BK"

echo
echo "=== 2. 替换 vendor/community ==="
rm -rf vendor/community
mkdir -p vendor/community
cp -a "$SRCROOT/." vendor/community/
find vendor/community -name '.DS_Store' -delete 2>/dev/null || true
echo "  $(find vendor/community -type f | wc -l | tr -d ' ') 个文件"

echo
echo "=== 3. 重建（锚点冲突会在这里硬失败）==="
if ! node scripts/build.mjs; then
  echo
  echo "✗ 构建失败。多数情况是上游改了锚点附近的代码："
  echo "  1) 打开 overlay/edits.mjs，找到报错里标出的那一条"
  echo "  2) 用 git diff 对比 $BK/community 与新 vendor/community 的对应文件"
  echo "  3) 更新 find 字符串；若上游已自行实现同一语义，改为 required:false 或删除该条"
  echo "  4) 重跑本脚本"
  exit 1
fi

echo
echo "=== 4. 验收 ==="
node scripts/verify.mjs

echo
echo "=== 5. 汇总 ==="
NEWLOCAL="$(node -e 'console.log(require("./dist/build/package/package.json").version)')"
echo "  上游 $OLDVER → $GOTVER"
echo "  本仓库 $NEWLOCAL"
echo
echo "下一步："
echo "  · 复核 docs/PORT-MATRIX.md 里标 '已漂移' 的行"
echo "  · git add -A && git commit -m 'chore: sync upstream $GOTVER'"
echo "  · 把 dist/dsh-purge-plus-$NEWLOCAL.tgz 装进 DSH 实测面板与 --status"
