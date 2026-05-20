#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

sh gen-nginx-conf.sh

echo "Starting Frontend..."
$COMPOSE $COMPOSE_ENV_FLAG up -d --force-recreate fe
echo ""
$COMPOSE ps fe
