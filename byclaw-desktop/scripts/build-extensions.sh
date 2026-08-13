#!/bin/bash
# 从 ../byclaw-exe/extensions 构建 ByClaw 扩展并应用 by-framework 补丁
# 用法: bash scripts/build-extensions.sh [输出目录，默认 ../extensions]
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$DESKTOP_DIR")"
OUT_DIR="${1:-$DESKTOP_DIR/extensions}"

EXT_SRC="$REPO_ROOT/byclaw-exe/extensions"
PATCH="$DESKTOP_DIR/patches/by-framework-read-block.patch"
EXTENSIONS=(baiying-enhance byai-channel byclaw-sqlite)

if [ ! -d "$EXT_SRC" ]; then
  echo "ERROR: 未找到扩展源码: $EXT_SRC" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
for ext in "${EXTENSIONS[@]}"; do
  echo ">>> 构建扩展: $ext"
  cd "$EXT_SRC/$ext"
  npm install --no-audit --no-fund >/dev/null 2>&1 || npm install
  npm run build 2>&1 | tail -1
  rm -rf "$OUT_DIR/$ext"
  cp -r "$EXT_SRC/$ext" "$OUT_DIR/$ext"
  chmod -R a-w "$OUT_DIR/$ext"
  chmod -R u+w "$OUT_DIR/$ext/dist" 2>/dev/null || true
done

echo ">>> 应用 by-framework 补丁（任务消费灵敏度）"
for ext in byai-channel baiying-enhance; do
  BF_DIR="$OUT_DIR/$ext/node_modules/@byclaw/by-framework"
  if [ -f "$BF_DIR/dist/runner.js" ]; then
    chmod -R u+w "$BF_DIR/dist" 2>/dev/null || true
    if grep -q "READ_BLOCK_MS" "$BF_DIR/dist/runner.js" 2>/dev/null; then
      echo "  $ext: 补丁已应用，跳过"
    else
      (cd "$BF_DIR" && patch -p1 --forward < "$PATCH") && echo "  $ext: 补丁已应用" || echo "  $ext: 补丁应用失败（可手动检查）"
    fi
  fi
done

echo "完成: $(du -sh "$OUT_DIR" | cut -f1)"
