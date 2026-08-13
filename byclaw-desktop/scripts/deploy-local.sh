#!/bin/bash
# 一键部署 byclaw-desktop 到本地运行目录
#   - 构建前端产物 + 扩展（含补丁）
#   - 安装桌面端依赖
#   - 生成运行时配置（openclaw.json 渲染 + config.json 模板）
# 用法: bash scripts/deploy-local.sh
# 环境: BYCLAW_LOCAL_ROOT 覆盖本地根目录（默认 ~/.local/share/byclaw）
#       BYCLAW_SKIP_BUILD=1 跳过构建（仅配置生成）
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
LOCAL_ROOT="${BYCLAW_LOCAL_ROOT:-$HOME/.local/share/byclaw}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/byclaw"
# 优先使用 nvm 的 node（>=22.19，与 openclaw/byclaw 兼容；conda 等环境 node 可能版本不符）
NODE_BIN=""
for cand in "$HOME/.nvm/versions/node/v22.23.1/bin/node" "$HOME/.nvm/versions/node/v22.19.0/bin/node" "$(command -v node || true)"; do
  if [ -n "$cand" ] && [ -x "$cand" ]; then
    NODE_BIN="$cand"
    break
  fi
done
[ -n "$NODE_BIN" ] || NODE_BIN="node"

echo "=== ByClaw 桌面端部署 ==="
echo "  本地根目录: $LOCAL_ROOT"
echo "  配置目录:   $CONFIG_DIR"

mkdir -p "$LOCAL_ROOT"/{runtime,logs,worker,extensions,desktop}

# 1. 构建前端 + 扩展（可跳过）
if [ "${BYCLAW_SKIP_BUILD:-0}" != "1" ]; then
  echo ">>> 构建前端产物"
  bash "$SCRIPT_DIR/build-renderer.sh" "$LOCAL_ROOT/desktop/renderer"
  echo ">>> 构建扩展（含补丁）"
  bash "$SCRIPT_DIR/build-extensions.sh" "$LOCAL_ROOT/extensions"
else
  echo ">>> 跳过构建（BYCLAW_SKIP_BUILD=1）"
fi

# 2. 部署说明（worker 为纯 JS 启动器，随仓库运行，无需复制）
echo ">>> worker 启动器（worker/worker-launcher.mjs，随仓库 npm install 即可）"

# 3. 渲染 openclaw.json
echo ">>> 生成 openclaw.json"
mkdir -p "$LOCAL_ROOT/config"
sed -e "s|<LOCAL_ROOT>|$LOCAL_ROOT|g" \
    -e "s|<NODE_BIN>|$NODE_BIN|g" \
    "$DESKTOP_DIR/config/openclaw.json.example" > "$LOCAL_ROOT/config/openclaw.json"

# 4. 用户配置（首次生成模板）
if [ ! -f "$CONFIG_DIR/config.json" ]; then
  echo ">>> 生成用户配置模板: $CONFIG_DIR/config.json（请填写后重启桌面端）"
  mkdir -p "$CONFIG_DIR"
  cp "$DESKTOP_DIR/config/config.json.example" "$CONFIG_DIR/config.json"
else
  echo ">>> 用户配置已存在: $CONFIG_DIR/config.json"
fi

# 5. 桌面端依赖
echo ">>> 安装桌面端依赖"
cd "$DESKTOP_DIR"
npm install --no-audit --no-fund 2>&1 | tail -1

echo ""
echo "=== 部署完成 ==="
echo "下一步："
echo "  1. 编辑 $CONFIG_DIR/config.json（apiBaseUrl / userCode / redis / auth）"
echo "  2. 确保 openclaw 已全局安装: npm install -g openclaw@2026.6.6"
echo "  3. 启动: cd $DESKTOP_DIR && npx electron ."
echo "     （或打包: npx electron-builder --linux AppImage）"
