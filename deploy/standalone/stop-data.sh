#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Stopping DataCloud..."
$COMPOSE $COMPOSE_ENV_FLAG stop data
$COMPOSE $COMPOSE_ENV_FLAG rm -f data
echo "DataCloud stopped."
