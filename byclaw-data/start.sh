#!/bin/sh
if [ "${1:-}" != "--__bash__" ]; then
  exec bash "$0" --__bash__ "$@"
fi
shift

# byclaw-data — DataCloud MCP + Gateway Worker 启动（Linux / macOS）
#
# 默认同时启动：
# 1. byclaw_data.mcp（FastAPI / MCP，封装 datacloud_data_service）
# 2. byclaw_data.main（Gateway worker）
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENV_DIR="${SCRIPT_DIR}/.venv"
VENV_BIN_DIR="${VENV_DIR}/bin"

load_env_file() {
  local env_file="$1"
  local line=""
  local key=""
  local value=""
  if [[ -f "$env_file" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%$'\r'}"
      if [[ "$line" =~ ^[[:space:]]*$ ]] || [[ "$line" =~ ^[[:space:]]*# ]]; then
        continue
      fi
      if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
        key="${BASH_REMATCH[2]}"
        value="${BASH_REMATCH[3]}"
        if [[ "$value" =~ ^\"(.*)\"$ ]]; then
          value="${BASH_REMATCH[1]}"
        elif [[ "$value" =~ ^\'(.*)\'$ ]]; then
          value="${BASH_REMATCH[1]}"
        fi
        export "${key}=${value}"
      fi
    done < "$env_file"
  fi
}

bool_from_env() {
  local raw="${1:-}"
  local fallback="${2:-true}"
  local normalized=""
  if [[ -z "$raw" ]]; then
    raw="$fallback"
  fi
  normalized="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$normalized" in
    1|true|yes|on) return 0 ;;
    0|false|no|off) return 1 ;;
    *)
      echo "[error] invalid boolean value: $raw" >&2
      exit 2
      ;;
  esac
}

set_if_absent() {
  local target="$1"
  local value="${2:-}"
  if [[ -z "$value" ]]; then
    return 0
  fi
  if [[ -z "${!target:-}" ]]; then
    export "${target}=${value}"
  fi
}

set_from_preferred() {
  local target="$1"
  shift
  local value=""
  value="$(first_non_empty "$@" || true)"
  if [[ -n "$value" ]]; then
    export "${target}=${value}"
  fi
}

first_non_empty() {
  local value=""
  for value in "$@"; do
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done
  return 1
}

compose_http_url() {
  local host="${1:-}"
  local port="${2:-}"
  if [[ -n "$host" && -n "$port" ]]; then
    printf 'http://%s:%s' "$host" "$port"
  fi
}

resolve_against_script_dir() {
  local raw="${1:-}"
  local base=""
  if [[ -z "$raw" ]]; then
    return 0
  fi
  case "$raw" in
    /*)
      printf '%s' "$raw"
      ;;
    *)
      base="$(cd "$SCRIPT_DIR" && pwd -P)"
      printf '%s/%s' "$base" "$raw"
      ;;
  esac
}

usage() {
  cat <<'EOF'
Usage:
  bash byclaw-data/start.sh [options]

Options:
  --service-only    Only start the MCP service.
  --worker-only     Only start byclaw-data worker.
  --no-wait         Do not wait for data service health before starting worker.
  --help, -h        Show this help.

Environment:
  DATACLOUD_START_MCP_SERVICE      Whether to start the MCP service (default: true).
  DATACLOUD_START_GATEWAY_WORKER   Whether to start byclaw-data worker (default: true).
  DATACLOUD_DATA_SERVICE_HOST      Uvicorn host (default: 0.0.0.0).
  DATACLOUD_DATA_SERVICE_PORT      Uvicorn port (default: 8080).
  DATACLOUD_DATA_SERVICE_URL       Health-check / public base URL (default: http://127.0.0.1:$PORT).
  DATACLOUD_DATA_SERVICE_STARTUP_TIMEOUT  Seconds to wait for /health (default: 60).
EOF
}

service_command() {
  if [[ -x "${VENV_BIN_DIR}/uvicorn" ]]; then
    printf 'cd "%s" && exec "%s/uvicorn" byclaw_data.mcp.routes:create_app --factory --host "%s" --port "%s" --log-level "%s"' \
      "$SCRIPT_DIR" "$VENV_BIN_DIR" "$SERVICE_HOST" "$SERVICE_PORT" "$UVICORN_LOG_LEVEL"
    return 0
  fi

  printf 'cd "%s" && exec uv run uvicorn byclaw_data.mcp.routes:create_app --factory --host "%s" --port "%s" --log-level "%s"' \
    "$SCRIPT_DIR" "$SERVICE_HOST" "$SERVICE_PORT" "$UVICORN_LOG_LEVEL"
}

worker_command() {
  if [[ -x "${VENV_BIN_DIR}/python" ]]; then
    printf 'cd "%s" && exec "%s/python" -m byclaw_data.main' \
      "$SCRIPT_DIR" "$VENV_BIN_DIR"
    return 0
  fi

  printf 'cd "%s" && exec uv run python -m byclaw_data.main' \
    "$SCRIPT_DIR"
}

load_env_file "${REPO_ROOT}/.env"
load_env_file "${SCRIPT_DIR}/.env"

START_SERVICE=1
START_WORKER=1
WAIT_FOR_SERVICE=1
if bool_from_env "${DATACLOUD_START_MCP_SERVICE:-}" "true"; then
  START_SERVICE=1
else
  START_SERVICE=0
fi
if bool_from_env "${DATACLOUD_START_GATEWAY_WORKER:-}" "true"; then
  START_WORKER=1
else
  START_WORKER=0
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service-only)
      START_SERVICE=1
      START_WORKER=0
      shift
      ;;
    --worker-only)
      START_SERVICE=0
      START_WORKER=1
      shift
      ;;
    --no-wait)
      WAIT_FOR_SERVICE=0
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ $START_SERVICE -eq 0 && $START_WORKER -eq 0 ]]; then
  echo "[error] Nothing to start. Enable service and/or worker." >&2
  exit 2
fi

if [[ ! -x "${VENV_BIN_DIR}/python" && ! -x "${VENV_BIN_DIR}/uvicorn" ]] && ! command -v uv >/dev/null 2>&1; then
  echo "[error] uv not found. Please install uv first." >&2
  exit 1
fi

SERVICE_HOST="${DATACLOUD_DATA_SERVICE_HOST:-0.0.0.0}"
SERVICE_PORT="${DATACLOUD_DATA_SERVICE_PORT:-${DATACLOUD_PORT:-8080}}"
SERVICE_URL="${DATACLOUD_DATA_SERVICE_URL:-http://127.0.0.1:${SERVICE_PORT}}"
STARTUP_TIMEOUT="${DATACLOUD_DATA_SERVICE_STARTUP_TIMEOUT:-60}"
WORKSPACE_DIR="${DATACLOUD_GATEWAY_WORKSPACE_DIR:-/tmp/datacloud}"
DEFAULT_ONTOLOGY_DIR="${SCRIPT_DIR}/resource"
LOG_DIR="${DATACLOUD_LOG_DIR:-${SCRIPT_DIR}/logs}"
SERVICE_LOG_FILE="${LOG_DIR}/datacloud_data_service.log"
WORKER_LOG_FILE="${LOG_DIR}/byclaw_data_worker.log"
UVICORN_LOG_LEVEL="${DATACLOUD_DATA_SERVICE_LOG_LEVEL:-info}"

export DATACLOUD_DATA_SERVICE_URL="$SERVICE_URL"
export PYTHONUNBUFFERED="${PYTHONUNBUFFERED:-1}"
if [[ -n "${FILE_STORAGE_MINIO_MOUNT_PATH:-}" ]]; then
  set_if_absent "DATACLOUD_ONTOLOGY_PATH" "${FILE_STORAGE_MINIO_MOUNT_PATH}/${FILE_STORAGE_MINIO_BUCKET_NAME:-byclaw}/resource"
  set_if_absent "DATACLOUD_MID_FTP_PATH" "${FILE_STORAGE_MINIO_MOUNT_PATH}/${FILE_STORAGE_MINIO_BUCKET_NAME:-byclaw}/resource/dig_employee"
fi
set_if_absent \
  "DATACLOUD_API_BASE_URL" \
  "$(first_non_empty "$(compose_http_url "${HOST:-}" "$SERVICE_PORT")" "$SERVICE_URL")"
set_if_absent "DATACLOUD_CSV_BASE_DIR" "${WORKSPACE_DIR}/data-service"
set_if_absent \
  "BE_DOMAINNAME_URL" \
  "$(compose_http_url "${HOST:-}" "${BE_SERVER_PORT:-}")"

set_if_absent "DATACLOUD_DB_HOST" "${DB_HOST:-}"
set_if_absent "DATACLOUD_DB_PORT" "${DB_PORT:-}"
set_if_absent "DATACLOUD_DB_DATABASE" "${DB_DATABASE:-}"
set_if_absent "DATACLOUD_DB_SCHEMA" "${DB_SCHEMA:-}"
set_if_absent "DATACLOUD_DB_TYPE" "${DB_TYPE:-}"
set_if_absent "DATACLOUD_DB_USER" "${DB_USER:-}"
set_if_absent "DATACLOUD_DB_PASSWORD" "$(first_non_empty "${DATACLOUD_DB_PASSWORD:-}" "${DB_PASS:-}" "${DB_PASSWORD:-}")"
set_if_absent "DATACLOUD_DB_PASS" "$(first_non_empty "${DATACLOUD_DB_PASS:-}" "${DB_PASS:-}" "${DB_PASSWORD:-}")"
set_if_absent "DATACLOUD_GATEWAY_REDIS_HOST" "${REDIS_HOST:-}"
set_if_absent "DATACLOUD_GATEWAY_REDIS_PORT" "${REDIS_PORT:-}"
set_if_absent "DATACLOUD_GATEWAY_REDIS_USERNAME" "${REDIS_USERNAME:-}"
set_if_absent "DATACLOUD_GATEWAY_REDIS_PASSWORD" "${REDIS_PASSWORD:-}"
set_if_absent "DATACLOUD_GATEWAY_REDIS_DB" "${REDIS_DATABASE:-}"
set_if_absent "DATACLOUD_LLM_API_BASE" "${LLM_BASE_URL:-}"
set_if_absent "DATACLOUD_LLM_API_KEY" "${LLM_API_KEY:-}"
set_if_absent "DATACLOUD_EMBEDDING_MODEL" "${EMBEDDING_MODEL_NAME:-}"
set_if_absent "DATACLOUD_EMBEDDING_API_BASE" "${EMBEDDING_BASE_URL:-}"
set_if_absent "DATACLOUD_EMBEDDING_API_KEY" "${EMBEDDING_API_KEY:-}"
set_if_absent "DATACLOUD_EMBEDDING_DIMS" "${EMBEDDING_DIMENSION:-}"
set_if_absent "DATACLOUD_EMBEDDING_BATCH_SIZE" "${EMBEDDING_BATCH_SIZE:-}"

set_from_preferred \
  "OPENAI_API_KEY" \
  "${DATACLOUD_LLM_REASONING_API_KEY:-}" "${DATACLOUD_LLM_API_KEY:-}" "${OPENAI_API_KEY:-}"
set_from_preferred \
  "OPENAI_BASE_URL" \
  "${DATACLOUD_LLM_REASONING_API_BASE:-}" "${DATACLOUD_LLM_API_BASE:-}" "${OPENAI_BASE_URL:-}"
set_from_preferred \
  "DC_LLM_API_KEY" \
  "${DATACLOUD_LLM_API_KEY:-}" "${DATACLOUD_LLM_REASONING_API_KEY:-}" "${DC_LLM_API_KEY:-}"
set_from_preferred \
  "DC_LLM_BASE_URL" \
  "${DATACLOUD_LLM_API_BASE:-}" "${DATACLOUD_LLM_REASONING_API_BASE:-}" "${DC_LLM_BASE_URL:-}"
set_from_preferred \
  "DC_LLM_MODEL" \
  "${DATACLOUD_LLM_MODEL:-}" "${DATACLOUD_LLM_REASONING_MODEL:-}" "gpt-4o"
set_from_preferred \
  "DC_LLM_TEMPERATURE" \
  "${DATACLOUD_LLM_TEMPERATURE:-}" "0.0"
set_from_preferred \
  "DC_API_BASE_URL" \
  "${DATACLOUD_API_BASE_URL:-}" "${DC_API_BASE_URL:-}"
set_from_preferred \
  "DC_CSV_BASE_DIR" \
  "$(resolve_against_script_dir "${DATACLOUD_CSV_BASE_DIR:-}")" "$(resolve_against_script_dir "${DC_CSV_BASE_DIR:-}")"
set_from_preferred \
  "DC_SCENE_PATH" \
  "$(resolve_against_script_dir "${DATACLOUD_SCENE_PATH:-}")" "$(resolve_against_script_dir "${DC_SCENE_PATH:-}")"
set_from_preferred \
  "DC_SQL_EXECUTION_MODE" \
  "${DATACLOUD_SQL_EXECUTION_MODE:-}" "${DC_SQL_EXECUTION_MODE:-}"
set_from_preferred \
  "DC_MAX_PLAN_RETRIES" \
  "${DATACLOUD_MAX_PLAN_RETRIES:-}" "${DC_MAX_PLAN_RETRIES:-}"
set_from_preferred \
  "DC_TRACE_ENABLED" \
  "${DATACLOUD_TRACE_ENABLED:-}" "${DC_TRACE_ENABLED:-}"
set_from_preferred \
  "DC_TERM_LOADER_TYPE" \
  "${DATACLOUD_TERM_LOADER_TYPE:-}" "${DC_TERM_LOADER_TYPE:-}"
set_from_preferred \
  "DC_ZNT_SERVER" \
  "${DATACLOUD_ZNT_SERVER:-}" "${DC_ZNT_SERVER:-}"

if [[ -n "${DATACLOUD_ONTOLOGY_PATH:-}" ]]; then
  export DC_ONTOLOGY_PATH="$(resolve_against_script_dir "${DATACLOUD_ONTOLOGY_PATH}")"
elif [[ -z "${DC_ONTOLOGY_PATH:-}" && -d "$DEFAULT_ONTOLOGY_DIR" ]]; then
  export DC_ONTOLOGY_PATH="$DEFAULT_ONTOLOGY_DIR"
fi

mkdir -p "${WORKSPACE_DIR}" "${DC_CSV_BASE_DIR}" "${LOG_DIR}"

PIDS=()
NAMES=()
TAIL_PIDS=()
LAST_PID=""

cleanup() {
  set +e
  for pid in "${TAIL_PIDS[@]}"; do
    [[ -n "$pid" ]] && kill -TERM "$pid" 2>/dev/null || true
  done
  [[ ${#PIDS[@]} -eq 0 ]] && return
  for pid in "${PIDS[@]}"; do
    [[ -n "$pid" ]] && kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 2
  for pid in "${PIDS[@]}"; do
    [[ -n "$pid" ]] && kill -KILL "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

stream_log_file() {
  local name="$1"
  local log_file="$2"
  touch "$log_file"
  bash -lc '
    log_file="$1"
    name="$2"
    tail -n +1 -F "$log_file" 2>/dev/null | sed -u "s/^/[$name] /"
  ' _ "$log_file" "$name" &
  TAIL_PIDS+=("$!")
}

show_recent_log() {
  local name="$1"
  local log_file="$2"
  if [[ -f "$log_file" ]]; then
    echo "[info] last 120 lines from ${name} log: ${log_file}" >&2
    tail -n 120 "$log_file" >&2 || true
  else
    echo "[info] no log file found for ${name}: ${log_file}" >&2
  fi
}

launch() {
  local name="$1"
  shift
  echo "[start] ${name}"
  "$@" &
  local pid="$!"
  PIDS+=("$pid")
  NAMES+=("$name")
  LAST_PID="$pid"
}

launch_logged() {
  local name="$1"
  local log_file="$2"
  shift 2
  : >"$log_file"
  echo "[start] ${name}"
  echo "[info]  ${name}_log=${log_file}"
  "$@" >>"$log_file" 2>&1 &
  local pid="$!"
  PIDS+=("$pid")
  NAMES+=("$name")
  LAST_PID="$pid"
  stream_log_file "$name" "$log_file"
}

wait_for_service_health() {
  local service_url="${1%/}"
  local health_url="${service_url}/health"
  local health_v1_url="${service_url}/api/v1/health"
  local pid="$2"
  local deadline=$((SECONDS + STARTUP_TIMEOUT))
  local url_without_scheme="${service_url#*://}"
  local host_port="${url_without_scheme%%/*}"
  local probe_host="${host_port%%:*}"
  local probe_port="${host_port##*:}"

  if [[ "$probe_port" == "$host_port" ]]; then
    probe_port="80"
  fi

  while (( SECONDS < deadline )); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[error] datacloud_data_service exited before it became healthy." >&2
      return 1
    fi
    if python -c 'import sys, urllib.request; urllib.request.urlopen(sys.argv[1], timeout=2).read()' "$health_url" >/dev/null 2>&1; then
      echo "[ready] datacloud_data_service healthy: ${health_url}"
      return 0
    fi
    if python -c 'import sys, urllib.request; urllib.request.urlopen(sys.argv[1], timeout=2).read()' "$health_v1_url" >/dev/null 2>&1; then
      echo "[ready] datacloud_data_service healthy: ${health_v1_url}"
      return 0
    fi
    if [[ -n "$probe_host" && -n "$probe_port" ]] && (: >/dev/tcp/"$probe_host"/"$probe_port") >/dev/null 2>&1; then
      echo "[ready] datacloud_data_service reachable on ${probe_host}:${probe_port} (health endpoint did not respond in time)"
      return 0
    fi
    sleep 1
  done

  echo "[error] datacloud_data_service did not become healthy within ${STARTUP_TIMEOUT}s: ${health_url}" >&2
  show_recent_log "datacloud_data_service" "$SERVICE_LOG_FILE"
  return 1
}

run_service_foreground() {
  echo "[start] datacloud_data_service"
  echo "[info]  mode=foreground"
  exec bash -lc "$(service_command)"
}

run_worker_foreground() {
  echo "[start] byclaw_data_worker"
  echo "[info]  mode=foreground"
  exec bash -lc "$(worker_command)"
}

if [[ $START_SERVICE -eq 1 && $START_WORKER -eq 0 ]]; then
  run_service_foreground
fi

if [[ $START_SERVICE -eq 0 && $START_WORKER -eq 1 ]]; then
  run_worker_foreground
fi

if [[ $START_SERVICE -eq 1 ]]; then
  launch_logged "datacloud_data_service" "$SERVICE_LOG_FILE" bash -lc "$(service_command)"
  SERVICE_PID="$LAST_PID"
  if [[ $WAIT_FOR_SERVICE -eq 1 && $START_WORKER -eq 1 ]]; then
    wait_for_service_health "$SERVICE_URL" "$SERVICE_PID"
  fi
fi

if [[ $START_WORKER -eq 1 ]]; then
  launch_logged "byclaw_data_worker" "$WORKER_LOG_FILE" bash -lc "$(worker_command)"
fi

echo
echo "[ready] byclaw-data stack started. Press Ctrl+C to stop."
echo "[info]  service_url=${SERVICE_URL}"

ALIVE=${#PIDS[@]}
while [[ $ALIVE -gt 0 ]]; do
  for i in "${!PIDS[@]}"; do
    pid="${PIDS[$i]}"
    [[ -z "$pid" ]] && continue
    if ! kill -0 "$pid" 2>/dev/null; then
      name="${NAMES[$i]}"
      echo "[exit] ${name} stopped (pid=${pid})."
      PIDS[$i]=""
      ALIVE=$((ALIVE - 1))
    fi
  done
  sleep 1
done
