#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Starting Redis..."
$COMPOSE $COMPOSE_ENV_FLAG up -d redis
echo ""
$COMPOSE ps redis
