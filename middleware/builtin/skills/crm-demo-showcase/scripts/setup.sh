#!/usr/bin/env bash
# =============================================================================
# CRM Demo Showcase — 环境检查脚本
#
# 幂等设计，可安全重复执行。
# 系统已预装 Python 3.12 (/usr/local/bin/python3) 及 by-framework/by-datacloud 依赖。
# 用法: bash scripts/setup.sh
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}>>>${NC} $*"; }
ok()    { echo -e "${GREEN}  ✓${NC} $*"; }
warn()  { echo -e "${YELLOW}  ⚠${NC} $*"; }
fail()  { echo -e "${RED}  ✗${NC} $*"; }

PYTHON_BIN=/usr/local/bin/python3

echo ""
echo "============================================"
echo "  CRM Demo Showcase 环境检查"
echo "============================================"
echo ""

# ---- Step 1: Check Python ----
info "Step 1/4: 检查系统 Python 环境 ..."
if [ -f "$PYTHON_BIN" ]; then
    ok "Python 已安装: $("$PYTHON_BIN" --version 2>&1)"
else
    fail "系统 Python 未找到: $PYTHON_BIN"
    exit 1
fi

# ---- Step 2: Verify imports ----
info "Step 2/4: 验证 Python 包导入 ..."
if "$PYTHON_BIN" -c "import by_framework; print('OK')" 2>/dev/null; then
    ok "by_framework 导入正常"
else
    fail "by_framework 导入失败，请检查镜像依赖"
    exit 1
fi

# ---- Step 3: Check environment variables ----
info "Step 3/4: 检查环境变量 ..."
MISSING=0

# Required
for VAR in BEYOND_TOKEN USER_CODE; do
    if [ -z "${!VAR:-}" ]; then
        fail "$VAR 未设置"
        MISSING=$((MISSING + 1))
    else
        ok "$VAR 已设置"
    fi
done

# Optional with default
if [ -n "${BE_DOMAINNAME:-}" ]; then
    ok "BE_DOMAINNAME = $BE_DOMAINNAME"
else
    warn "BE_DOMAINNAME 未设置（将使用默认值 ByaiService）"
fi

# Redis (optional at install time)
for VAR in REDIS_HOST REDIS_PORT REDIS_PASSWORD; do
    if [ -z "${!VAR:-}" ]; then
        warn "$VAR 未设置（Redis 相关功能将跳过）"
    else
        ok "$VAR 已设置"
    fi
done

echo ""
echo "============================================"
if [ $MISSING -gt 0 ]; then
    echo -e "  ${RED}⚠ 缺少 $MISSING 个必需环境变量${NC}"
    echo "  请设置后重新运行: bash scripts/setup.sh"
    echo "============================================"
    exit 1
else
    echo -e "  ${GREEN}✅ 环境就绪！${NC}"
    echo "============================================"
fi
