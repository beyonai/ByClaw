#!/bin/bash
cd "$(dirname "$0")"
. ../compose-detect.sh

sh gen-nginx-conf.sh

if [ "$STANDALONE_MODULES" = "NONE" ]; then
    echo "STANDALONE_MODULES=NONE, skipping all standalone services."
elif [ -n "$STANDALONE_MODULES" ]; then
    SERVICES=$(echo "$STANDALONE_MODULES" | tr ',' ' ')
    echo "Starting standalone services: $SERVICES"
    # 保留 compose.yml 中的 depends_on，只有在选择性启动且未包含 BE 时
    # 禁止 Compose 因 FE 的依赖关系自动拉起 BE。
    NO_DEPS=""
    case " $SERVICES " in
        *" be "*) ;;
        *) NO_DEPS="--no-deps" ;;
    esac
    $COMPOSE $COMPOSE_ENV_FLAG up -d --force-recreate $NO_DEPS $SERVICES
else
    echo "Starting all services..."
    $COMPOSE $COMPOSE_ENV_FLAG up -d --force-recreate
fi

echo ""
echo "==================== 部署完成 ===================="
echo "前端: http://localhost:${NGINX_PORT:-8080}"
echo "后端: http://localhost:${BE_SERVER_PORT:-8086}"
echo "Super: http://localhost:${BYCLAW_SUPER_PORT:-3000}"
echo "QA:   http://localhost:${BYCLAW_QA_PORT:-8090}"
echo ""
$COMPOSE ps
