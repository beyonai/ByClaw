#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Starting Backend..."
$COMPOSE $COMPOSE_ENV_FLAG up -d --force-recreate be
echo ""
$COMPOSE ps be
