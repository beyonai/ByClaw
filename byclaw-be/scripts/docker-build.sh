#!/bin/bash

# Docker 镜像构建脚本

set -e

VERSION=${1:-latest}
REGISTRY=${2:-}

echo "🐳 构建 Docker 镜像..."
echo "版本: $VERSION"

# 构建镜像
docker build -t byclaw-be:$VERSION .

# 如果指定了仓库，推送镜像
if [ -n "$REGISTRY" ]; then
    echo "📤 推送镜像到仓库..."
    docker tag byclaw-be:$VERSION $REGISTRY/byclaw-be:$VERSION
    docker push $REGISTRY/byclaw-be:$VERSION
fi

echo "✅ Docker 镜像构建完成！"
docker images | grep byclaw-be
