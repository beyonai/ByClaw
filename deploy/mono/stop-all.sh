#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Stopping byclaw-all..."
$COMPOSE $COMPOSE_ENV_FLAG down
echo "All services stopped."
