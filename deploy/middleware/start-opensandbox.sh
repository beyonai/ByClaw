#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

# Generate opensandbox config from .env
sh gen-opensandbox-config.sh

echo "Starting OpenSandbox Server..."
$COMPOSE $COMPOSE_ENV_FLAG up -d --force-recreate opensandbox-server
echo ""
$COMPOSE ps opensandbox-server
