#!/usr/bin/env bash
set -Eeuo pipefail

OPEN_DESIGN_ROOT="${OPEN_DESIGN_ROOT:-/opt/open-design}"

export OD_BASE_PATH="${OD_BASE_PATH:-/openDesign}"
export OD_HOST="${OD_HOST:-0.0.0.0}"
export OD_BIND_HOST="${OD_BIND_HOST:-0.0.0.0}"
export OD_ALLOW_PUBLIC_BIND_WITHOUT_TOKEN="${OD_ALLOW_PUBLIC_BIND_WITHOUT_TOKEN:-1}"
export OD_PORT="${OD_PORT:-17456}"
export OD_DATA_DIR="${OD_DATA_DIR:-/by/.od}"
export OD_MEDIA_CONFIG_DIR="${OD_MEDIA_CONFIG_DIR:-$OD_DATA_DIR}"
export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$OD_DATA_DIR/claude}"
export CLAUDE_BIN="${CLAUDE_BIN:-/usr/local/bin/claude}"
export OPEN_DESIGN_USER="${OPEN_DESIGN_USER:-open-design}"
export OPEN_DESIGN_HOME="${OPEN_DESIGN_HOME:-$OD_DATA_DIR/home}"
export OPEN_DESIGN_AGENT_ID="${OPEN_DESIGN_AGENT_ID:-claude}"
export OPEN_DESIGN_CLAUDE_MODEL="${OPEN_DESIGN_CLAUDE_MODEL:-sonnet}"

is_writable_as_open_design() {
    local dir="$1"

    if [ "$(id -u)" = "0" ]; then
        runuser -u "$OPEN_DESIGN_USER" -- test -w "$dir" -a -x "$dir"
    else
        test -w "$dir" -a -x "$dir"
    fi
}

prepare_open_design_dir() {
    local dir="$1"
    local parent

    if [ -z "$dir" ] || [ "$dir" = "/" ]; then
        echo "[open-design] refusing to use '$dir' as a writable data directory" >&2
        exit 64
    fi

    parent="$(dirname "$dir")"
    mkdir -p "$parent" "$dir"

    if [ "$(id -u)" = "0" ]; then
        chown "$OPEN_DESIGN_USER:$OPEN_DESIGN_USER" "$parent" 2>/dev/null || true
        chmod u+rwx,go+rx "$parent" 2>/dev/null || true
        chown -R "$OPEN_DESIGN_USER:$OPEN_DESIGN_USER" "$dir" 2>/dev/null || true
        chmod -R u+rwX "$dir" 2>/dev/null || true
    fi

    if ! is_writable_as_open_design "$dir"; then
        echo "[open-design] $dir is not writable as $OPEN_DESIGN_USER" >&2
        ls -ld "$parent" "$dir" >&2 || true
        echo "[open-design] refusing to run Open Design as root because Claude Code rejects root/sudo privileges" >&2
        exit 1
    fi
}

prepare_open_design_dir "$OD_DATA_DIR"
prepare_open_design_dir "$OD_MEDIA_CONFIG_DIR"
prepare_open_design_dir "$CLAUDE_CONFIG_DIR"
prepare_open_design_dir "$OPEN_DESIGN_HOME"

app_config_file="$OD_DATA_DIR/app-config.json"
if command -v codex >/dev/null 2>&1; then
    export OPEN_DESIGN_CODEX_AVAILABLE=1
else
    export OPEN_DESIGN_CODEX_AVAILABLE=0
fi

APP_CONFIG_FILE="$app_config_file" node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const file = process.env.APP_CONFIG_FILE;
const agentId = process.env.OPEN_DESIGN_AGENT_ID || 'claude';
const claudeModel = process.env.OPEN_DESIGN_CLAUDE_MODEL || 'sonnet';
let config = {};

if (file && fs.existsSync(file)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      config = parsed;
    }
  } catch {
    config = {};
  }
}

const selectedAgent = typeof config.agentId === 'string' ? config.agentId.trim() : '';
const codexUnavailable = selectedAgent === 'codex' && process.env.OPEN_DESIGN_CODEX_AVAILABLE !== '1';
const forceAgent = process.env.OPEN_DESIGN_FORCE_AGENT === '1';
if (forceAgent || !selectedAgent || codexUnavailable) {
  config.agentId = agentId;
}

config.agentCliEnv = config.agentCliEnv && typeof config.agentCliEnv === 'object' && !Array.isArray(config.agentCliEnv)
  ? config.agentCliEnv
  : {};
config.agentCliEnv.claude = {
  ...(config.agentCliEnv.claude && typeof config.agentCliEnv.claude === 'object' ? config.agentCliEnv.claude : {}),
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR || '/by/.od/claude',
  CLAUDE_BIN: process.env.CLAUDE_BIN || '/usr/local/bin/claude',
};

config.agentModels = config.agentModels && typeof config.agentModels === 'object' && !Array.isArray(config.agentModels)
  ? config.agentModels
  : {};
config.agentModels.claude = {
  ...(config.agentModels.claude && typeof config.agentModels.claude === 'object' ? config.agentModels.claude : {}),
  model: claudeModel,
};

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
NODE

claude_api_key="${ZHIPU_API_KEY:-${ANTHROPIC_AUTH_TOKEN:-${ANTHROPIC_API_KEY:-}}}"

if [ -n "$claude_api_key" ]; then
    cat > "$CLAUDE_CONFIG_DIR/settings.json" <<EOF
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "$claude_api_key",
    "ANTHROPIC_BASE_URL": "${ANTHROPIC_BASE_URL:-https://open.bigmodel.cn/api/anthropic}",
    "API_TIMEOUT_MS": "${API_TIMEOUT_MS:-3000000}",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1,
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "${ANTHROPIC_DEFAULT_HAIKU_MODEL:-GLM-4.5-air}",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "${ANTHROPIC_DEFAULT_SONNET_MODEL:-GLM-5.1}",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "${ANTHROPIC_DEFAULT_OPUS_MODEL:-GLM-5.1}"
  }
}
EOF
else
    echo "[claude] ZHIPU_API_KEY/ANTHROPIC_AUTH_TOKEN/ANTHROPIC_API_KEY is not set; Claude Code may require existing auth under $CLAUDE_CONFIG_DIR" >&2
fi

if [ "$(id -u)" = "0" ]; then
    chown -R "$OPEN_DESIGN_USER:$OPEN_DESIGN_USER" "$OD_DATA_DIR" "$OD_MEDIA_CONFIG_DIR" "$CLAUDE_CONFIG_DIR" "$OPEN_DESIGN_HOME" 2>/dev/null || true
fi

if [ "$#" -eq 0 ]; then
    echo "[combined] missing OpenClaw command" >&2
    exit 64
fi

echo "[open-design] root: $OPEN_DESIGN_ROOT"
echo "[open-design] url: http://${OD_BIND_HOST}:${OD_PORT}${OD_BASE_PATH}"

cd "$OPEN_DESIGN_ROOT"

if [ "$(id -u)" = "0" ]; then
    runuser -u "$OPEN_DESIGN_USER" -- \
        env NODE_ENV=production \
        NODE_OPTIONS="${OD_NODE_OPTIONS:---max-old-space-size=192}" \
        OD_BASE_PATH="$OD_BASE_PATH" \
        OD_HOST="$OD_HOST" \
        OD_BIND_HOST="$OD_BIND_HOST" \
        OD_ALLOW_PUBLIC_BIND_WITHOUT_TOKEN="$OD_ALLOW_PUBLIC_BIND_WITHOUT_TOKEN" \
        OD_PORT="$OD_PORT" \
        OD_DATA_DIR="$OD_DATA_DIR" \
        OD_MEDIA_CONFIG_DIR="$OD_MEDIA_CONFIG_DIR" \
        HOME="$OPEN_DESIGN_HOME" \
        XDG_CONFIG_HOME="$OPEN_DESIGN_HOME/.config" \
        XDG_CACHE_HOME="$OPEN_DESIGN_HOME/.cache" \
        XDG_DATA_HOME="$OPEN_DESIGN_HOME/.local/share" \
        USER="$OPEN_DESIGN_USER" \
        LOGNAME="$OPEN_DESIGN_USER" \
        CLAUDE_CONFIG_DIR="$CLAUDE_CONFIG_DIR" \
        CLAUDE_BIN="$CLAUDE_BIN" \
        ZHIPU_API_KEY="${ZHIPU_API_KEY:-}" \
        ANTHROPIC_AUTH_TOKEN="${ANTHROPIC_AUTH_TOKEN:-}" \
        ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
        ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-https://open.bigmodel.cn/api/anthropic}" \
        API_TIMEOUT_MS="${API_TIMEOUT_MS:-3000000}" \
        ANTHROPIC_DEFAULT_HAIKU_MODEL="${ANTHROPIC_DEFAULT_HAIKU_MODEL:-GLM-4.5-air}" \
        ANTHROPIC_DEFAULT_SONNET_MODEL="${ANTHROPIC_DEFAULT_SONNET_MODEL:-GLM-5.1}" \
        ANTHROPIC_DEFAULT_OPUS_MODEL="${ANTHROPIC_DEFAULT_OPUS_MODEL:-GLM-5.1}" \
        node apps/daemon/dist/cli.js --no-open &
else
    env NODE_ENV=production \
        NODE_OPTIONS="${OD_NODE_OPTIONS:---max-old-space-size=192}" \
        OD_BASE_PATH="$OD_BASE_PATH" \
        OD_HOST="$OD_HOST" \
        OD_BIND_HOST="$OD_BIND_HOST" \
        OD_ALLOW_PUBLIC_BIND_WITHOUT_TOKEN="$OD_ALLOW_PUBLIC_BIND_WITHOUT_TOKEN" \
        OD_PORT="$OD_PORT" \
        OD_DATA_DIR="$OD_DATA_DIR" \
        OD_MEDIA_CONFIG_DIR="$OD_MEDIA_CONFIG_DIR" \
        HOME="$OPEN_DESIGN_HOME" \
        XDG_CONFIG_HOME="$OPEN_DESIGN_HOME/.config" \
        XDG_CACHE_HOME="$OPEN_DESIGN_HOME/.cache" \
        XDG_DATA_HOME="$OPEN_DESIGN_HOME/.local/share" \
        USER="$OPEN_DESIGN_USER" \
        LOGNAME="$OPEN_DESIGN_USER" \
        CLAUDE_CONFIG_DIR="$CLAUDE_CONFIG_DIR" \
        CLAUDE_BIN="$CLAUDE_BIN" \
        node apps/daemon/dist/cli.js --no-open &
fi
open_design_pid=$!

health_url="http://127.0.0.1:${OD_PORT}${OD_BASE_PATH}/api/health"
open_design_ready=0

for _ in $(seq 1 60); do
    if node -e "fetch(process.argv[1]).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" "$health_url"; then
        open_design_ready=1
        break
    fi
    sleep 1
done

if [ "$open_design_ready" != "1" ]; then
    echo "[open-design] health check failed: $health_url" >&2
    kill "$open_design_pid" 2>/dev/null || true
    exit 1
fi

echo "[open-design] ready: $health_url"
echo "[openclaw] starting: $*"

cd /app

"$@" &
openclaw_pid=$!

shutdown() {
    echo "[combined] shutting down"
    kill "$openclaw_pid" "$open_design_pid" 2>/dev/null || true
}

trap shutdown TERM INT

wait -n "$openclaw_pid" "$open_design_pid"
status=$?

shutdown
wait "$openclaw_pid" 2>/dev/null || true
wait "$open_design_pid" 2>/dev/null || true

exit "$status"
