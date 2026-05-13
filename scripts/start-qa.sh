#!/usr/bin/env bash
# Start byclaw-qa (knowledge base QA service).
#
# Usage:
#   ./scripts/start-qa.sh api      Start the QA API service
#   ./scripts/start-qa.sh worker   Start the instant QA worker
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QA_DIR="$ROOT/byclaw-qa"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/start-qa.sh <mode>

Modes:
  api      Start the knowledge base management API service.
  worker   Start the instant question answering worker.

Options:
  --help   Show this message.

Examples:
  ./scripts/start-qa.sh api
  ./scripts/start-qa.sh worker
EOF
}

MODE="${1:-}"

case "$MODE" in
  --help|-h|help)
    usage
    exit 0
    ;;
  api|worker)
    ;;
  *)
    usage
    exit 1
    ;;
esac

if ! [[ -f "$QA_DIR/start.sh" ]]; then
  echo "[error] byclaw-qa not initialized (missing start.sh)" >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "[error] uv not found. Please install uv first:"
  echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
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

LOG_NAME="qa-${MODE}"
LOG_FILE="$LOG_DIR/${LOG_NAME}.log"

echo "[start] byclaw-qa ${MODE}: bash start.sh ${MODE}"
(
  cd "$QA_DIR"
  bash start.sh "$MODE"
) >"$LOG_FILE" 2>&1 &

pid="$!"
PIDS+=("$pid")
echo "[log]   ${LOG_NAME} -> ${LOG_FILE}"

echo
echo "[ready] byclaw-qa (${MODE}) started. Press Ctrl+C to stop."
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
