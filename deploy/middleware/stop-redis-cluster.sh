#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Stopping Redis Cluster..."
$COMPOSE -f docker-compose-redis-cluster.yml $COMPOSE_ENV_FLAG stop
$COMPOSE -f docker-compose-redis-cluster.yml $COMPOSE_ENV_FLAG rm -f
echo "Redis Cluster stopped."
