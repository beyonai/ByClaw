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

# 注意：nginx.conf 通过 -v 参数外挂，不打包进镜像
# 这样可以在宿主机修改配置后，直接重启容器生效

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
