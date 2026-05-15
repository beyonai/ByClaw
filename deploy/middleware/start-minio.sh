#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

echo "Starting MinIO..."
$COMPOSE $COMPOSE_ENV_FLAG up -d --force-recreate minio
echo ""
$COMPOSE ps minio
