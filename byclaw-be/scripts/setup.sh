#!/bin/bash

# 开发环境初始化脚本

set -e

echo "🚀 开始初始化 ByClaw-BE 开发环境..."

# 检查 Java
if ! command -v java &> /dev/null; then
    echo "❌ 未找到 Java，请先安装 Java 17+"
    exit 1
fi

JAVA_VERSION=$(java -version 2>&1 | head -n 1 | cut -d'"' -f2)
echo "✅ Java 版本: $JAVA_VERSION"

# 检查 Maven
if ! command -v mvn &> /dev/null; then
    echo "❌ 未找到 Maven，请先安装 Maven 3.8+"
    exit 1
fi

MVN_VERSION=$(mvn -version | head -n 1)
echo "✅ Maven: $MVN_VERSION"

# 创建本地配置文件
if [ ! -f "src/main/resources/application-local.yml" ]; then
    echo "📝 创建本地配置文件..."
    cp src/main/resources/application-dev.yml \
       src/main/resources/application-local.yml
    echo "⚠️  请编辑 application-local.yml 配置数据库和 Redis 连接信息"
fi

# 创建日志目录
mkdir -p logs

# 下载依赖
echo "📦 下载 Maven 依赖..."
mvn dependency:resolve -q

# 编译项目
echo "🔨 编译项目..."
mvn clean compile -q

echo "✅ 开发环境初始化完成！"
echo ""
echo "下一步:"
echo "1. 配置数据库和 Redis"
echo "2. 运行: mvn spring-boot:run -Dspring-boot.run.profiles=local"
