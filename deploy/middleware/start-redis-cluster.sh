#!/bin/bash
set -e
cd "$(dirname "$0")"
. ../compose-detect.sh

SUFFIX="${CONTAINER_SUFFIX:-middleware}"
IMG="${IMAGE_REDIS:-ghcr.io/beyonai/byclaw/byclaw-redis:main}"
PASS="${REDIS_PASSWORD}"
CLUSTER_HOST="${HOST}"
P1="${REDIS_CLUSTER_PORT_1:-6371}"
P2="${REDIS_CLUSTER_PORT_2:-6372}"
P3="${REDIS_CLUSTER_PORT_3:-6373}"
P4="${REDIS_CLUSTER_PORT_4:-6374}"
P5="${REDIS_CLUSTER_PORT_5:-6375}"
P6="${REDIS_CLUSTER_PORT_6:-6376}"

NODES="redis-node-1 redis-node-2 redis-node-3 redis-node-4 redis-node-5 redis-node-6"

echo "Starting Redis Cluster (6 nodes)..."
# Start only the 6 nodes. The bundled init service is unreliable (fixed sleep,
# no retry, not idempotent); we do the create here instead.
$COMPOSE -f docker-compose-redis-cluster.yml $COMPOSE_ENV_FLAG up -d $NODES

# Wait until every node answers PING (real readiness, not a fixed sleep).
echo "Waiting for all nodes to be ready..."
for n in $NODES; do
    c="byclaw-${n}-${SUFFIX}"
    for i in $(seq 1 30); do
        if [ "$(docker exec "$c" redis-cli -p 6379 -a "$PASS" ping 2>/dev/null)" = "PONG" ]; then
            break
        fi
        [ "$i" -eq 30 ] && { echo "ERROR: $c not responding"; exit 1; }
        sleep 1
    done
done

# Idempotent: if the cluster is already healthy, leave it alone.
STATE=$(docker exec "byclaw-redis-node-1-${SUFFIX}" redis-cli -p 6379 -a "$PASS" cluster info 2>/dev/null | tr -d '\r' | grep '^cluster_state:' | cut -d: -f2)
if [ "$STATE" = "ok" ]; then
    echo "Cluster already initialized (cluster_state:ok). Nothing to do."
    $COMPOSE -f docker-compose-redis-cluster.yml $COMPOSE_ENV_FLAG ps
    exit 0
fi

# Clear any stale nodes.conf state from a previous failed attempt so that
# --cluster create sees six empty nodes.
echo "Resetting node state before create..."
for n in $NODES; do
    c="byclaw-${n}-${SUFFIX}"
    docker exec "$c" redis-cli -p 6379 -a "$PASS" flushall 2>/dev/null || true
    docker exec "$c" redis-cli -p 6379 -a "$PASS" cluster reset hard 2>/dev/null || true
done

echo "Creating Redis cluster on $CLUSTER_HOST ..."
# Run via host networking so redis-cli reaches the announced host IP:port
# (matches each node's --cluster-announce-ip), which is what external clients use.
docker run --rm --network host "$IMG" \
    redis-cli -a "$PASS" --cluster create \
    "$CLUSTER_HOST:$P1" "$CLUSTER_HOST:$P2" "$CLUSTER_HOST:$P3" \
    "$CLUSTER_HOST:$P4" "$CLUSTER_HOST:$P5" "$CLUSTER_HOST:$P6" \
    --cluster-replicas 1 --cluster-yes

# Verify the cluster came up healthy.
echo "Verifying cluster state..."
STATE=$(docker exec "byclaw-redis-node-1-${SUFFIX}" redis-cli -p 6379 -a "$PASS" cluster info 2>/dev/null | tr -d '\r' | grep '^cluster_state:' | cut -d: -f2)
if [ "$STATE" = "ok" ]; then
    echo "Redis cluster created (cluster_state:ok)."
else
    echo "ERROR: cluster_state is '$STATE' after create. Check node logs."
    exit 1
fi

echo ""
$COMPOSE -f docker-compose-redis-cluster.yml $COMPOSE_ENV_FLAG ps
