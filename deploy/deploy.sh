#!/bin/sh

# 兼容入口：允许在 deploy/ 目录内执行 sh deploy.sh init|update|stop。
cd "$(dirname "$0")/.."
exec sh deploy.sh "$@"
