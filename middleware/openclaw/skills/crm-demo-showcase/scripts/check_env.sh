#!/usr/bin/env bash
# =============================================================================
# CRM Demo Showcase — 环境就绪检查
#
# 快速检查 Python 环境和必需变量是否就绪。
# 系统已预装 /usr/local/bin/python3 及 by-framework/by-datacloud 依赖。
# 用法: bash scripts/check_env.sh
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

PASS=0
FAIL=0

check() {
    local name="$1" ok="$2" msg="$3"
    if [ "$ok" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} $name"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $name — $msg"
        FAIL=$((FAIL + 1))
    fi
}

PYTHON_BIN=/usr/local/bin/python3

echo ""
echo "CRM Demo Showcase 环境检查"
echo "==========================="
echo ""

# Python
if [ -f "$PYTHON_BIN" ]; then
    if "$PYTHON_BIN" -c "import by_framework" 2>/dev/null; then
        check "系统 Python ($PYTHON_BIN)" true ""
    else
        check "系统 Python ($PYTHON_BIN)" false "by_framework 导入失败"
    fi
else
    check "系统 Python ($PYTHON_BIN)" false "未找到"
fi

# Required env vars
for VAR in BEYOND_TOKEN USER_CODE; do
    if [ -n "${!VAR:-}" ]; then
        check "环境变量 $VAR" true ""
    else
        check "环境变量 $VAR" false "未设置"
    fi
done

# Optional env vars
if [ -n "${BE_DOMAINNAME:-}" ]; then
    check "环境变量 BE_DOMAINNAME" true ""
else
    check "环境变量 BE_DOMAINNAME" false "未设置（默认 ByaiService）"
fi

for VAR in REDIS_HOST REDIS_PORT REDIS_PASSWORD; do
    if [ -n "${!VAR:-}" ]; then
        check "环境变量 $VAR" true ""
    else
        check "环境变量 $VAR" false "未设置（非必需）"
    fi
done

echo ""
echo "==========================="
echo -e "通过: ${GREEN}$PASS${NC}  失败: ${RED}$FAIL${NC}"
if [ $FAIL -gt 0 ]; then
    echo -e "${RED}环境未完全就绪${NC}"
    exit 1
else
    echo -e "${GREEN}环境就绪 ✓${NC}"
fi
