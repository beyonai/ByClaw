#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Stopping Frontend..."
$COMPOSE $COMPOSE_ENV_FLAG stop fe
$COMPOSE $COMPOSE_ENV_FLAG rm -f fe
echo "Frontend stopped."
