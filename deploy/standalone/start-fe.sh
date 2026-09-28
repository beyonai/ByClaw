#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

sh gen-nginx-conf.sh

echo "Starting Frontend..."
NO_DEPS=""
SELECTED_SERVICES=$(echo "${STANDALONE_MODULES:-}" | tr ',' ' ')
case " $SELECTED_SERVICES " in
    *" be "*) ;;
    *) NO_DEPS="--no-deps" ;;
esac
$COMPOSE $COMPOSE_ENV_FLAG up -d --force-recreate $NO_DEPS fe
echo ""
$COMPOSE ps fe
