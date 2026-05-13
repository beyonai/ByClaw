#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Stopping Demo..."
$COMPOSE $COMPOSE_ENV_FLAG stop demo
$COMPOSE $COMPOSE_ENV_FLAG rm -f demo
echo "Demo stopped."
