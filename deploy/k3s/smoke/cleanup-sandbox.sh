#!/bin/bash
set -euo pipefail
API_URL="${BYCLAW_SANDBOX_BASE_URL:-http://127.0.0.1:9005}"
API_KEY="${BYCLAW_SANDBOX_API_KEY:-dev}"
SANDBOX_ID="${1:-}"

if [ -z "$SANDBOX_ID" ]; then
    echo "Usage: $0 <sandboxId>" >&2
    exit 1
fi

curl -fsS -X DELETE -H "OPEN-SANDBOX-API-KEY: ${API_KEY}" \
  "${API_URL}/v1/sandboxes/${SANDBOX_ID}"
