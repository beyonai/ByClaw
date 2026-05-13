#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Stopping MinIO..."
$COMPOSE $COMPOSE_ENV_FLAG stop minio
$COMPOSE $COMPOSE_ENV_FLAG rm -f minio
echo "MinIO stopped."
