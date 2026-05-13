#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Stopping Redis..."
$COMPOSE $COMPOSE_ENV_FLAG stop redis
$COMPOSE $COMPOSE_ENV_FLAG rm -f redis
echo "Redis stopped."
