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
#   本仓库对上游只有 6 处锚点插入（overlay/edits.mjs），冲突会以
#   「锚点命中 0 次 / 2 次」的形式在 build 阶段硬失败，不会静默跑歪。

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

SRC="${1:?用法: $0 <新版本 tgz 或解包目录> [新版本号]}"
NEWVER="${2:-}"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

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
