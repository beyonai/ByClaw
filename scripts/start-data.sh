#!/usr/bin/env bash
# Start byclaw-data stack (datacloud_data_service + gateway worker).
#
# Usage:
#   ./scripts/start-data.sh [byclaw-data/start.sh args]
#
# Environment normalization is handled by byclaw-data/start.sh.
# This wrapper intentionally forwards args and streams logs only.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT/byclaw-data"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage:
  ./scripts/start-data.sh [byclaw-data/start.sh args]

Examples:
  ./scripts/start-data.sh
  ./scripts/start-data.sh --service-only
  ./scripts/start-data.sh --worker-only
EOF
  exit 0
fi

if ! [[ -f "$DATA_DIR/start.sh" ]]; then
  echo "[error] byclaw-data not initialized (missing start.sh)" >&2
  exit 1
fi

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

LOG_FILE="$LOG_DIR/data-run.log"

echo "[start] byclaw-data: bash start.sh $*"
(
  cd "$DATA_DIR"
  bash start.sh "$@"
) >"$LOG_FILE" 2>&1 &

pid="$!"
PIDS+=("$pid")
echo "[log]   data-run -> ${LOG_FILE}"

echo
echo "[ready] byclaw-data started. Press Ctrl+C to stop."
echo "[tip]   tail -f ${LOG_FILE}"

while true; do
  for i in "${!PIDS[@]}"; do
    pid="${PIDS[$i]}"
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[exit] Process stopped (pid=${pid}). Check ${LOG_FILE}."
      exit 0
    fi
    if command -v ps >/dev/null 2>&1; then
      stat="$(ps -p "$pid" -o stat= 2>/dev/null | tr -d ' ' || true)"
      if [[ "$stat" == Z* ]]; then
        echo "[exit] Process exited (pid=${pid}, zombie). Check ${LOG_FILE}."
        exit 0
      fi
    fi
  done
  sleep 1
done
