#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Stopping Super..."
$COMPOSE $COMPOSE_ENV_FLAG stop super
$COMPOSE $COMPOSE_ENV_FLAG rm -f super
