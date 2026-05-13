#!/bin/bash

# 项目构建脚本

set -e

echo "🔨 开始构建 ByClaw-BE..."

# 清理并编译
echo "📦 清理并编译..."
mvn clean compile -B -q

# 运行测试
echo "🧪 运行测试..."
mvn test -B

# 打包
echo "📦 打包应用..."
mvn package -B -DskipTests

echo "✅ 构建完成！"
echo ""
echo "输出文件:"
ls -lh target/*.jar
