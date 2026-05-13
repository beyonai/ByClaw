#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

ENV_FILE="../../.env"

set -a
. "$ENV_FILE" 2>/dev/null
set +a

# Generate opensandbox config if needed
if [ "$MIDDLEWARE_MODULES" != "NONE" ]; then
    if [ -z "$MIDDLEWARE_MODULES" ] || echo "$MIDDLEWARE_MODULES" | grep -q "opensandbox"; then
        sh gen-opensandbox-config.sh
    fi
fi

# opengauss init if needed
if [ "$MIDDLEWARE_MODULES" != "NONE" ]; then
    if [ -z "$MIDDLEWARE_MODULES" ] || echo "$MIDDLEWARE_MODULES" | grep -q "opengauss"; then
        mkdir -p data
        sudo chown -R 70:70 data
        sudo chmod -R a+r initdb
    fi
fi

if [ "$MIDDLEWARE_MODULES" = "NONE" ]; then
    echo "MIDDLEWARE_MODULES=NONE, skipping all middleware services."
elif [ -n "$MIDDLEWARE_MODULES" ]; then
    SERVICES=$(echo "$MIDDLEWARE_MODULES" | tr ',' ' ')
    echo "Starting middleware services: $SERVICES"
    $COMPOSE $COMPOSE_ENV_FLAG up -d --force-recreate $SERVICES
else
    echo "Starting all middleware services..."
    $COMPOSE $COMPOSE_ENV_FLAG up -d --force-recreate
fi

echo ""
$COMPOSE ps
