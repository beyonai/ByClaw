#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Starting Super..."
$COMPOSE $COMPOSE_ENV_FLAG up -d --force-recreate --no-deps super
echo ""
$COMPOSE ps super
