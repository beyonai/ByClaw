#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Stopping QA Manager..."
$COMPOSE $COMPOSE_ENV_FLAG stop qa-manager
$COMPOSE $COMPOSE_ENV_FLAG rm -f qa-manager
echo "QA Manager stopped."
