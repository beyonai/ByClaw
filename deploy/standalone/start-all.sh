#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

ENV_FILE="../../.env"

set -a
. "$ENV_FILE" 2>/dev/null
set +a

sh gen-nginx-conf.sh

if [ "$STANDALONE_MODULES" = "NONE" ]; then
    echo "STANDALONE_MODULES=NONE, skipping all standalone services."
elif [ -n "$STANDALONE_MODULES" ]; then
    SERVICES=$(echo "$STANDALONE_MODULES" | tr ',' ' ')
    echo "Starting standalone services: $SERVICES"
    $COMPOSE $COMPOSE_ENV_FLAG up -d --force-recreate $SERVICES
else
    echo "Starting all services..."
    $COMPOSE $COMPOSE_ENV_FLAG up -d --force-recreate
fi

echo ""
echo "==================== 部署完成 ===================="
echo "前端: http://localhost:${NGINX_PORT:-8080}"
echo "后端: http://localhost:${BE_SERVER_PORT:-8086}"
echo "QA:   http://localhost:${BYCLAW_QA_PORT:-8090}"
echo "Data: http://localhost:${DATACLOUD_PORT:-8087}"
echo ""
$COMPOSE ps
