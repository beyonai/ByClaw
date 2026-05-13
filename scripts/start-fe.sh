#!/usr/bin/env bash
# Start byclaw-fe (frontend) only.
#
# Usage:
#   ./scripts/start-fe.sh [--install]
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FE_DIR="$ROOT/byclaw-fe"

INSTALL_DEPS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install)
      INSTALL_DEPS=1
      shift
      ;;
    --help|-h)
      cat <<'EOF'
Usage:
  ./scripts/start-fe.sh [options]

Options:
  --install   Install dependencies before starting.
  --help      Show this message.

Examples:
  ./scripts/start-fe.sh
  ./scripts/start-fe.sh --install
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

mkdir -p "$ROOT/logs"
LOG_DIR="$ROOT/logs"

PIDS=()

cleanup() {
  set +e
  [[ ${#PIDS[@]} -eq 0 ]] && return
  for pid in "${PIDS[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 2
  for pid in "${PIDS[@]}"; do
    kill -KILL "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

start_bg() {
  local name="$1"
  local cwd="$2"
  local cmd="$3"
  local log="$LOG_DIR/${name}.log"

  echo "[start] ${name}: ${cmd}" >&2
  (
    cd "$cwd"
    bash -lc "$cmd"
  ) >"$log" 2>&1 &

  local pid="$!"
  PIDS+=("$pid")
  echo "[log]   ${name} -> ${log}" >&2
  echo "$pid"
}

if ! [[ -f "$FE_DIR/package.json" ]]; then
  echo "[error] byclaw-fe not initialized (missing package.json)" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[error] pnpm not found. Enable it and try again:"
  echo "  corepack enable"
  echo "  corepack prepare pnpm@latest --activate"
  echo "  (or: npm i -g pnpm)"
  exit 1
fi

FE_NODE_MODULES=0
[[ -f "$FE_DIR/node_modules/.modules.yaml" ]] && FE_NODE_MODULES=1

# Lockfile version check
if [[ -f "$FE_DIR/pnpm-lock.yaml" ]]; then
  LOCKFILE_VERSION="$(awk '/^lockfileVersion:/{print $2}' "$FE_DIR/pnpm-lock.yaml" 2>/dev/null || true)"
else
  LOCKFILE_VERSION=""
fi
PNPM_VERSION="$(pnpm --version 2>/dev/null || true)"
if [[ "$LOCKFILE_VERSION" == "5.4" && -n "$PNPM_VERSION" ]]; then
  PNPM_MAJOR="${PNPM_VERSION%%.*}"
  if [[ "$PNPM_MAJOR" -ne 7 ]]; then
    echo "[warn] byclaw-fe lockfileVersion=5.4 usually requires pnpm 7.x."
    echo "       Current pnpm: ${PNPM_VERSION}"
    echo "       Recommended:"
    echo "         corepack enable"
    echo "         corepack prepare pnpm@7 --activate"
  fi
fi

if [[ $FE_NODE_MODULES -eq 0 ]]; then
  echo "[deps] byclaw-fe dependencies not found; installing:"
  echo "       pnpm install --frozen-lockfile"
  pid="$(start_bg "fe-install" "$FE_DIR" "pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile")"
  wait "$pid" || true
  [[ -f "$FE_DIR/node_modules/.modules.yaml" ]] && FE_NODE_MODULES=1
fi

if [[ $FE_NODE_MODULES -eq 1 ]]; then
  start_bg "fe-dev" "$FE_DIR" "pnpm run dev"
fi

echo
echo "[ready] byclaw-fe started. Press Ctrl+C to stop."
echo "[tip]   tail -f logs/fe-dev.log"

if [[ ${#PIDS[@]} -eq 0 ]]; then
  echo "[info] No background processes were started."
  exit 0
fi

while true; do
  for i in "${!PIDS[@]}"; do
    pid="${PIDS[$i]}"
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[exit] Process stopped (pid=${pid}). Check logs/fe-dev.log."
      exit 0
    fi
    if command -v ps >/dev/null 2>&1; then
      stat="$(ps -p "$pid" -o stat= 2>/dev/null | tr -d ' ' || true)"
      if [[ "$stat" == Z* ]]; then
        echo "[exit] Process exited (pid=${pid}, zombie). Check logs/fe-dev.log."
        exit 0
      fi
    fi
  done
  sleep 1
done
