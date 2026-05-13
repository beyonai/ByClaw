#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS="$ROOT/scripts"

START_FE=0
START_BE=0
START_QA=0
START_DATA=0

usage() {
  cat <<'EOF'
Usage:
  ./scripts/start.sh [options]

Options:
  --all            Start all modules (fe, be, qa, data).
  --fe             Start frontend (byclaw-fe).
  --be             Start backend (byclaw-be).
  --qa             Start QA services (byclaw-qa, api + worker).
  --data           Start data gateway (byclaw-data).
  --help           Show this message.

Environment:
  BE_PROFILE       Spring profile for backend (default: local).

Examples:
  ./scripts/start.sh --all
  ./scripts/start.sh --fe --be
  ./scripts/start.sh --be
EOF
}

print_welcome() {
  cat <<'EOF'

  ██████╗ ██╗   ██╗ ██████╗██╗      █████╗ ██╗    ██╗
  ██╔══██╗╚██╗ ██╔╝██╔════╝██║     ██╔══██╗██║    ██║
  ██████╔╝ ╚████╔╝ ██║     ██║     ███████║██║ █╗ ██║
  ██╔══██╗  ╚██╔╝  ██║     ██║     ██╔══██║██║███╗██║
  ██████╔╝   ██║   ╚██████╗███████╗██║  ██║╚███╔███╔╝
  ╚═════╝    ╚═╝    ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝

Local dev runner for:
  byclaw-fe   (frontend)
  byclaw-be   (Java backend)
  byclaw-qa   (knowledge base QA)
  byclaw-data (data gateway)

Quick commands:
  ./scripts/start.sh --all
  ./scripts/start.sh --fe --be
  ./scripts/start.sh --fe

Logs:
  ./logs/

Press Ctrl+C to stop all running processes.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      START_FE=1; START_BE=1; START_QA=1; START_DATA=1
      shift ;;
    --fe)   START_FE=1;   shift ;;
    --be)   START_BE=1;   shift ;;
    --qa)   START_QA=1;   shift ;;
    --data) START_DATA=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2 ;;
  esac
done

# Default: start everything.
if [[ $START_FE -eq 0 && $START_BE -eq 0 && $START_QA -eq 0 && $START_DATA -eq 0 ]]; then
  START_FE=1; START_BE=1; START_QA=1; START_DATA=1
fi

print_welcome

mkdir -p "$ROOT/logs"
LOG_DIR="$ROOT/logs"

PIDS=()
NAMES=()

cleanup() {
  set +e
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

# Launch a sub-script in the background, redirecting its output to a log file.
launch() {
  local name="$1"
  local script="$2"
  shift 2
  local log="$LOG_DIR/${name}.log"

  echo "[start] ${name}: ${script} $*"
  bash "$script" "$@" >"$log" 2>&1 &
  local pid="$!"
  PIDS+=("$pid")
  NAMES+=("$name")
  echo "[log]   ${name} -> ${log}"
}

[[ $START_FE   -eq 1 ]] && launch "fe"   "$SCRIPTS/start-fe.sh"
[[ $START_BE   -eq 1 ]] && launch "be"   "$SCRIPTS/start-be.sh"
if [[ $START_QA -eq 1 ]]; then
  launch "qa-api" "$SCRIPTS/start-qa.sh" api
  launch "qa-worker" "$SCRIPTS/start-qa.sh" worker
fi
[[ $START_DATA -eq 1 ]] && launch "data" "$SCRIPTS/start-data.sh"

echo
echo "[ready] Started modules. Press Ctrl+C to stop."
echo "[ready] Processes: ${#PIDS[@]}"
echo
echo "[tip] Tail logs in another terminal:"
for name in "${NAMES[@]}"; do
  echo "  tail -f logs/${name}.log"
done

if [[ ${#PIDS[@]} -eq 0 ]]; then
  echo
  echo "[info] No modules were started."
  exit 0
fi

# Monitor sub-processes. When one exits, log it and continue with the rest.
# Only exit when ALL sub-processes have stopped.
ALIVE=${#PIDS[@]}
while [[ $ALIVE -gt 0 ]]; do
  for i in "${!PIDS[@]}"; do
    pid="${PIDS[$i]}"
    [[ -z "$pid" ]] && continue
    if ! kill -0 "$pid" 2>/dev/null; then
      name="${NAMES[$i]}"
      echo "[exit] ${name} stopped (pid=${pid}). Check logs/${name}.log."
      PIDS[$i]=""
      ALIVE=$((ALIVE - 1))
    fi
  done
  sleep 1
done

echo
echo "[done] All modules have stopped."
