#!/usr/bin/env bash
# Start byclaw-be (Java backend) only.
#
# Usage:
#   ./scripts/start-be.sh
#
# Environment:
#   BE_PROFILE   Spring profile (default: local).
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BE_DIR="$ROOT/byclaw-be"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      cat <<'EOF'
Usage:
  ./scripts/start-be.sh

Environment:
  BE_PROFILE   Spring profile for backend (default: local).

Examples:
  ./scripts/start-be.sh
  BE_PROFILE=dev ./scripts/start-be.sh
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

SERVICE_POM="$BE_DIR/pom.xml"
if ! [[ -f "$SERVICE_POM" ]]; then
  echo "[error] byclaw-be not initialized (missing pom.xml)" >&2
  exit 1
fi

if ! command -v mvn >/dev/null 2>&1; then
  echo "[error] mvn not found. Please install Maven and JDK 21+ first."
  exit 1
fi

BE_PROFILE="${BE_PROFILE:-local}"

BE_RUN_ARGS="${BE_DIR}/config/application"
BE_RUN_ARGS="${BE_RUN_ARGS} --spring.profiles.active=${BE_PROFILE}"
BE_RUN_ARGS="${BE_RUN_ARGS} --logging.config=${BE_DIR}/config/logback.xml"

ENV_FILE_FOR_JVM="${ROOT}/.env"
if command -v cygpath >/dev/null 2>&1; then
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      ENV_FILE_FOR_JVM="$(cygpath -w "$ENV_FILE_FOR_JVM" 2>/dev/null || echo "$ENV_FILE_FOR_JVM")"
      ;;
  esac
fi

BE_CMD="mvn -B"
BE_CMD="${BE_CMD} -f pom.xml spring-boot:run"
BE_CMD="${BE_CMD} -Dspring-boot.run.arguments=\"${BE_RUN_ARGS}\""
BE_CMD="${BE_CMD} -Dspring-boot.run.jvmArguments=-Denv.file=${ENV_FILE_FOR_JVM}"

start_bg "be-run" "$BE_DIR" "$BE_CMD"

echo
echo "[ready] byclaw-be started. Press Ctrl+C to stop."
echo "[tip]   tail -f logs/be-run.log"

if [[ ${#PIDS[@]} -eq 0 ]]; then
  echo "[info] No background processes were started."
  exit 0
fi

while true; do
  for i in "${!PIDS[@]}"; do
    pid="${PIDS[$i]}"
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[exit] Process stopped (pid=${pid}). Check logs/be-run.log."
      exit 0
    fi
    if command -v ps >/dev/null 2>&1; then
      stat="$(ps -p "$pid" -o stat= 2>/dev/null | tr -d ' ' || true)"
      if [[ "$stat" == Z* ]]; then
        echo "[exit] Process exited (pid=${pid}, zombie). Check logs/be-run.log."
        exit 0
      fi
    fi
  done
  sleep 1
done
