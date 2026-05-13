#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Starting DataCloud..."
$COMPOSE $COMPOSE_ENV_FLAG up -d data
echo ""
$COMPOSE ps data
