#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Stopping OpenSandbox Server..."
$COMPOSE $COMPOSE_ENV_FLAG stop opensandbox-server
$COMPOSE $COMPOSE_ENV_FLAG rm -f opensandbox-server
echo "OpenSandbox Server stopped."
