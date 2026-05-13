#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Stopping QA Worker..."
$COMPOSE $COMPOSE_ENV_FLAG stop qa-worker
$COMPOSE $COMPOSE_ENV_FLAG rm -f qa-worker
echo "QA Worker stopped."
