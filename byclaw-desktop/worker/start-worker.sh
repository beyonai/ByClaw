#!/bin/bash
# ByClaw 本地 Agent 启动脚本（OpenClaw gateway + byai-channel worker）
# 用法: bash start-worker.sh  （桌面端/手动均适用）
set -eu

# 本地根目录：默认取脚本上级目录（部署后自动定位），可用 BYCLAW_LOCAL_ROOT 覆盖
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_ROOT="${BYCLAW_LOCAL_ROOT:-$(dirname "$SCRIPT_DIR")}"

# 0. 确保 node/openclaw 可用（兼容 AppImage/桌面端等非交互环境）
# 不 source nvm.sh（与 set -u 不兼容），直接注入 nvm node 目录到 PATH
if ! command -v openclaw >/dev/null 2>&1 && [ -x "$HOME/.nvm/versions/node/v22.23.1/bin/openclaw" ]; then
  export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
fi
if ! command -v openclaw >/dev/null 2>&1; then
  echo "[worker] ERROR: openclaw 不在 PATH（请先 npm install -g openclaw@2026.6.6）" >&2
  exit 127
fi

# 1. 加载配置：优先用户配置目录 ~/.config/byclaw/config.json，回退 legacy online.env
CONFIG_FILE="${BYCLAW_CONFIG_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/byclaw/config.json}"
ENV_FILE="${BYCLAW_ENV_FILE:-${LOCAL_ROOT}/config/online.env}"
if [ -f "$CONFIG_FILE" ]; then
  eval "$(python3 - "$CONFIG_FILE" <<'PYEOF'
import json, sys
cfg = json.load(open(sys.argv[1], encoding='utf-8'))
redis = cfg.get('redis', {}) or {}
worker = cfg.get('worker', {}) or {}
pairs = {
    'BYCLAW_BE_BASE_URL': cfg.get('apiBaseUrl', ''),
    'USER_CODE': cfg.get('userCode', ''),
    'REDIS_HOST': redis.get('host', ''),
    'REDIS_PORT': str(redis.get('port', '') or ''),
    'REDIS_PASSWORD': redis.get('password', '') or '',
    'REDIS_MODE': redis.get('mode', 'standalone') or 'standalone',
    'REDIS_KEY_SCHEMA_VERSION': redis.get('keySchemaVersion', 'v1') or 'v1',
    'BY_FRAMEWORK_READ_BLOCK_MS': str(worker.get('readBlockMs', 100) or 100),
    'BYAI_GROUP_CHAT_CONTEXT_BASE_URL': worker.get('groupChatContextBaseUrl') or cfg.get('apiBaseUrl', ''),
}
local_root = worker.get('localRoot', '')
if local_root:
    pairs['OPENCLAW_STATE_DIR'] = f"{local_root}/runtime"
    pairs['OPENCLAW_CONFIG_PATH'] = f"{local_root}/config/openclaw.json"
for k, v in (cfg.get('env', {}) or {}).items():
    pairs[k] = str(v)
for k, v in pairs.items():
    if v:
        print(f"export {k}={json.dumps(str(v))}")
PYEOF
)"
  echo "[worker] config: $CONFIG_FILE"
elif [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  echo "[worker] config: legacy $ENV_FILE"
else
  echo "[worker] WARN: 配置文件不存在: $CONFIG_FILE（Redis 连接将不可用）" >&2
fi

# 2. 注入 byai-channel / baiying-enhance 需要的环境变量（已由配置设置的保持不变）
export USER_CODE="${USER_CODE:-${TEST_USER_CODE:-}}"
export REDIS_HOST REDIS_PORT REDIS_PASSWORD
export REDIS_MODE="${REDIS_MODE:-standalone}"
export REDIS_KEY_SCHEMA_VERSION="${REDIS_KEY_SCHEMA_VERSION:-v1}"
# 任务消费灵敏度：XREADGROUP 阻塞上限（默认 2000ms → 100ms，减少空等延迟）
export BY_FRAMEWORK_READ_BLOCK_MS="${BY_FRAMEWORK_READ_BLOCK_MS:-100}"
# 群聊上下文查询直连线上网关（默认走 Redis 服务发现→内网 8086，本地不可达会干等 10s 超时）
export BYAI_GROUP_CHAT_CONTEXT_BASE_URL="${BYAI_GROUP_CHAT_CONTEXT_BASE_URL:-${BYCLAW_BE_BASE_URL}}"

# 3. OpenClaw 状态目录与配置文件（不污染 ~/.openclaw）
export OPENCLAW_STATE_DIR="${LOCAL_ROOT}/runtime"
export OPENCLAW_CONFIG_PATH="${LOCAL_ROOT}/config/openclaw.json"

mkdir -p "${OPENCLAW_STATE_DIR}"

echo "[worker] USER_CODE=${USER_CODE} REDIS=${REDIS_HOST}:${REDIS_PORT} mode=${REDIS_MODE}"
echo "[worker] state=${OPENCLAW_STATE_DIR} config=${OPENCLAW_CONFIG_PATH}"

# 4. 启动 gateway（byai-channel 随插件启动，自动注册 BYCLAW_EXE_<userCode> worker）
exec openclaw gateway --bind=loopback --allow-unconfigured --verbose
