#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Starting QA Worker..."
$COMPOSE $COMPOSE_ENV_FLAG up -d --force-recreate qa-worker
echo ""
$COMPOSE ps qa-worker
