#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Starting Redis Cluster (6 nodes)..."
$COMPOSE -f docker-compose-redis-cluster.yml $COMPOSE_ENV_FLAG up -d --force-recreate
echo ""
$COMPOSE -f docker-compose-redis-cluster.yml $COMPOSE_ENV_FLAG ps
