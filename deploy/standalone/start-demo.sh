#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Starting Demo..."
DEMO_CONTAINER="byclaw-demo-${CONTAINER_SUFFIX:-standalone}"
docker rm -f "$DEMO_CONTAINER" 2>/dev/null
$COMPOSE --profile demo $COMPOSE_ENV_FLAG up -d demo
echo ""
$COMPOSE --profile demo ps demo
