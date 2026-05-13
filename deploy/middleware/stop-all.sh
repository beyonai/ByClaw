#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

ENV_FILE="../../.env"

set -a
. "$ENV_FILE" 2>/dev/null
set +a

if [ "$MIDDLEWARE_MODULES" = "NONE" ]; then
    echo "MIDDLEWARE_MODULES=NONE, no middleware services to stop."
elif [ -n "$MIDDLEWARE_MODULES" ]; then
    SERVICES=$(echo "$MIDDLEWARE_MODULES" | tr ',' ' ')
    echo "Stopping middleware services: $SERVICES"
    $COMPOSE $COMPOSE_ENV_FLAG stop $SERVICES
    $COMPOSE $COMPOSE_ENV_FLAG rm -f $SERVICES
else
    echo "Stopping all middleware services..."
    $COMPOSE $COMPOSE_ENV_FLAG down
fi

echo "Middleware services stopped."
