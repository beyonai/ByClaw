#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

# 配置生成失败时保留现有容器，不能继续启动并把失败报告为成功。
sh gen-nginx-conf.sh || exit $?

echo "Starting Frontend..."
NO_DEPS=""
SELECTED_SERVICES=$(echo "${STANDALONE_MODULES:-}" | tr ',' ' ')
case " $SELECTED_SERVICES " in
    *" be "*) ;;
    *) NO_DEPS="--no-deps" ;;
esac
$COMPOSE $COMPOSE_ENV_FLAG up -d --force-recreate $NO_DEPS fe
echo ""
$COMPOSE ps fe
