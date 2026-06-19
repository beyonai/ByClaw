# 使用本地已有的 nginx 镜像作为基础
# 注意：构建前需要先在本地执行 npm run build 生成 dist 目录
#
# 使用方法：
# 1. 构建镜像: docker build -t byclaw-fe:latest . 
#      or docker build --platform linux/amd64 -t byclaw-fe:amd64 .
# 2. 运行容器（外挂nginx配置）: 
#    docker run -d -p 8080:8080 -v $(pwd)/nginx.conf:/etc/nginx/conf.d/default.conf byclaw-fe:latest

FROM nginx:1.29.4-alpine

# 复制本地构建好的前端文件到 nginx 目录
COPY ./dist /usr/share/nginx/html

# 构建信息
ARG BUILD_VERSION=unknown
ARG BUILD_BRANCH=unknown
ARG BUILD_COMMIT=unknown
ARG BUILD_COMMIT_FULL=unknown
ARG BUILD_TIME=unknown
ARG BUILD_MODULE=byclaw-fe
ARG BUILD_COMMIT_MSG=unknown

RUN printf '{"version":"%s","branch":"%s","commit":"%s","commitFull":"%s","buildTime":"%s","module":"%s","commitMsg":"%s"}\n' \
    "$BUILD_VERSION" "$BUILD_BRANCH" "$BUILD_COMMIT" "$BUILD_COMMIT_FULL" "$BUILD_TIME" "$BUILD_MODULE" "$BUILD_COMMIT_MSG" \
    > /usr/share/nginx/html/build-info.json

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
