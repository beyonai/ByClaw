#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Starting QA Manager..."
$COMPOSE $COMPOSE_ENV_FLAG up -d qa-manager
echo ""
$COMPOSE ps qa-manager
