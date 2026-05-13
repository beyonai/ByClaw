#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

ENV_FILE="../../.env"

set -a
. "$ENV_FILE" 2>/dev/null
set +a

if [ "$STANDALONE_MODULES" = "NONE" ]; then
    echo "STANDALONE_MODULES=NONE, no standalone services to stop."
elif [ -n "$STANDALONE_MODULES" ]; then
    SERVICES=$(echo "$STANDALONE_MODULES" | tr ',' ' ')
    echo "Stopping standalone services: $SERVICES"
    $COMPOSE $COMPOSE_ENV_FLAG stop $SERVICES
    $COMPOSE $COMPOSE_ENV_FLAG rm -f $SERVICES
else
    echo "Stopping all services..."
    $COMPOSE $COMPOSE_ENV_FLAG down
fi

echo "Standalone services stopped."
