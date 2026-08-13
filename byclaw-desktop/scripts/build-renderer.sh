#!/bin/bash
# 从 ../byclaw-fe 构建前端产物并拷贝到本工程 renderer/
# 用法: bash scripts/build-renderer.sh [输出目录，默认 ./renderer]
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$DESKTOP_DIR")"
OUT_DIR="${1:-$DESKTOP_DIR/renderer}"

FE_DIR="$REPO_ROOT/byclaw-fe"
if [ ! -d "$FE_DIR" ]; then
  echo "ERROR: 未找到 byclaw-fe: $FE_DIR" >&2
  exit 1
fi

echo ">>> 构建 byclaw-fe..."
cd "$FE_DIR"
pnpm install --no-audit --no-fund >/dev/null 2>&1 || pnpm install
pnpm run build 2>&1 | tail -3

echo ">>> 拷贝产物 -> $OUT_DIR"
mkdir -p "$OUT_DIR"
cp -r "$FE_DIR/dist/"* "$OUT_DIR/"
echo "完成: $(du -sh "$OUT_DIR" | cut -f1)"
