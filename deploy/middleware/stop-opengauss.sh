#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Stopping OpenGauss..."
$COMPOSE $COMPOSE_ENV_FLAG stop opengauss
$COMPOSE $COMPOSE_ENV_FLAG rm -f opengauss
echo "OpenGauss stopped."
