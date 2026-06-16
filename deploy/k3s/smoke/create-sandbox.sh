#!/bin/bash
set -euo pipefail
API_URL="${BYCLAW_SANDBOX_BASE_URL:-http://127.0.0.1:9005}"
API_KEY="${BYCLAW_SANDBOX_API_KEY:-dev}"

curl -fsS -X POST "${API_URL}/v1/sandboxes" \
  -H "OPEN-SANDBOX-API-KEY: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "image": {"uri": "nginx:alpine"},
    "timeout": 600,
    "metadata": {"userCode": "smoke", "serviceKey": "nginx"},
    "resourceLimits": {"cpu": "500m", "memory": "256Mi"},
    "entrypoint": ["nginx", "-g", "daemon off;"]
  }'
