#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Starting byclaw-all..."
$COMPOSE $COMPOSE_ENV_FLAG up -d --force-recreate
echo ""
echo "==================== 部署完成 ===================="
echo "前端: http://localhost:8080"
echo "后端: http://localhost:8086"
echo "QA:   http://localhost:\${BYCLAW_QA_PORT:-8090}"
echo ""
$COMPOSE ps | grep byclaw-all
