#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Stopping Backend..."
$COMPOSE $COMPOSE_ENV_FLAG stop be
$COMPOSE $COMPOSE_ENV_FLAG rm -f be
echo "Backend stopped."
