#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

# 确保 opengauss 数据目录和初始化脚本权限正确（omm uid=70）
mkdir -p data
sudo chown -R 70:70 data
sudo chmod -R a+r initdb

echo "Starting OpenGauss..."
$COMPOSE $COMPOSE_ENV_FLAG up -d --force-recreate opengauss
echo ""
$COMPOSE ps opengauss
