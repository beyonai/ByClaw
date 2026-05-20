#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT/logs/.pids"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/stop.sh [options]

Options:
  --all            Stop all running modules (default if no option given).
  --fe             Stop frontend only.
  --be             Stop backend only.
  --qa             Stop QA services only.
  --data           Stop data gateway only.
  --help           Show this message.

Examples:
  ./scripts/stop.sh
  ./scripts/stop.sh --fe
  ./scripts/stop.sh --be --qa
EOF
}

STOP_FE=0
STOP_BE=0
STOP_QA=0
STOP_DATA=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)  STOP_FE=1; STOP_BE=1; STOP_QA=1; STOP_DATA=1; shift ;;
    --fe)   STOP_FE=1;   shift ;;
    --be)   STOP_BE=1;   shift ;;
    --qa)   STOP_QA=1;   shift ;;
    --data) STOP_DATA=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2 ;;
  esac
done

if [[ $STOP_FE -eq 0 && $STOP_BE -eq 0 && $STOP_QA -eq 0 && $STOP_DATA -eq 0 ]]; then
  STOP_FE=1; STOP_BE=1; STOP_QA=1; STOP_DATA=1
fi

should_stop() {
  local name="$1"
  case "$name" in
    fe)        [[ $STOP_FE -eq 1 ]] ;;
    be)        [[ $STOP_BE -eq 1 ]] ;;
    qa-api)    [[ $STOP_QA -eq 1 ]] ;;
    qa-worker) [[ $STOP_QA -eq 1 ]] ;;
    data)      [[ $STOP_DATA -eq 1 ]] ;;
    *)         return 0 ;;
  esac
}

kill_tree() {
  local pid="$1"
  local children
  children="$(pgrep -P "$pid" 2>/dev/null || true)"
  for child in $children; do
    kill_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
}

stopped=0
remaining=()

if [[ -f "$PID_FILE" ]]; then
  while IFS='=' read -r name pid; do
    [[ -z "$name" || -z "$pid" ]] && continue
    if should_stop "$name"; then
      if kill -0 "$pid" 2>/dev/null; then
        kill_tree "$pid"
        echo "[stop] $name (pid=$pid) terminated."
        stopped=$((stopped + 1))
      else
        echo "[skip] $name (pid=$pid) already stopped."
      fi
    else
      remaining+=("${name}=${pid}")
    fi
  done < "$PID_FILE"

  if [[ ${#remaining[@]} -eq 0 ]]; then
    rm -f "$PID_FILE"
  else
    : > "$PID_FILE"
    for entry in "${remaining[@]}"; do
      echo "$entry" >> "$PID_FILE"
    done
  fi
else
  echo "[info] No PID file found at logs/.pids"
  echo "       Modules may not have been started via start.sh, or are already stopped."
  echo ""
  echo "       Trying to find processes by port..."

  if [[ $STOP_FE -eq 1 ]]; then
    fe_pids="$(lsof -ti :8000 2>/dev/null || true)"
    if [[ -n "$fe_pids" ]]; then
      echo "$fe_pids" | xargs kill -TERM 2>/dev/null || true
      echo "[stop] fe terminated via port 8000 (pids: $(echo $fe_pids | tr '\n' ' '))."
      stopped=$((stopped + 1))
    fi
  fi

  if [[ $STOP_BE -eq 1 ]]; then
    be_pids="$(lsof -ti :8086 2>/dev/null || true)"
    if [[ -n "$be_pids" ]]; then
      echo "$be_pids" | xargs kill -TERM 2>/dev/null || true
      echo "[stop] be terminated via port 8086 (pids: $(echo $be_pids | tr '\n' ' '))."
      stopped=$((stopped + 1))
    fi
  fi

  if [[ $STOP_QA -eq 1 ]]; then
    qa_pids="$(pgrep -f 'byclaw-qa' 2>/dev/null || true)"
    if [[ -n "$qa_pids" ]]; then
      echo "$qa_pids" | xargs kill -TERM 2>/dev/null || true
      echo "[stop] qa terminated (pids: $(echo $qa_pids | tr '\n' ' '))."
      stopped=$((stopped + 1))
    fi
  fi

  if [[ $STOP_DATA -eq 1 ]]; then
    data_pids="$(pgrep -f 'byclaw-data' 2>/dev/null || true)"
    if [[ -z "$data_pids" ]]; then
      data_pids="$(lsof -ti :8087 2>/dev/null || true)"
    fi
    if [[ -n "$data_pids" ]]; then
      echo "$data_pids" | xargs kill -TERM 2>/dev/null || true
      echo "[stop] data terminated (pids: $(echo $data_pids | tr '\n' ' '))."
      stopped=$((stopped + 1))
    fi
  fi
fi

if [[ $stopped -eq 0 ]]; then
  echo "[info] No running modules found to stop."
else
  echo ""
  echo "[done] Stopped $stopped module(s)."
fi
