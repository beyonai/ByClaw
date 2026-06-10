#!/bin/bash

# ==============================================
# 环境变量 直接从系统 env 获取，不硬编码
# ==============================================
if [ -z "${GBRAIN_HOME}" ]; then
    echo "❌ GBRAIN_HOME 未设置"
    exit 1
fi

if [ ! -d "${GBRAIN_HOME}" ]; then
    echo "📁 创建 GBRAIN_HOME 目录：${GBRAIN_HOME}"
    mkdir -p "${GBRAIN_HOME}" || exit 1
fi

DB_FILE="${GBRAIN_HOME}/.gbrain/brain.pglite"

# ==============================================
# 核心判断：只有数据库文件不存在，才初始化
# ==============================================
if [ -f "${DB_FILE}" ]; then
    echo "✅ 数据库已存在：${DB_FILE}"
    echo "✅ 跳过 GBrain 初始化"
    exit 0
fi

echo "🔧 数据库不存在，开始初始化 GBrain..."

# 进入工作目录
cd "${GBRAIN_HOME}" || exit 1

# ==============================================
# 自动输入 tokenmax，无交互、不卡住
# ==============================================
printf "tokenmax\n" | gbrain init --pglite \
  --embedding-model openai:text-embedding-v4 \
  --embedding-dimensions 1024 \
  --chat openai:gpt-5.2 \
  --search-mode tokenmax

echo -e "\n🎉 GBrain 初始化完成！"