# 运行阶段（JAR 由 CI 预先构建）
FROM eclipse-temurin:21-jre-alpine

# 安装必要的工具
RUN apk add --no-cache curl

# 创建应用目录
WORKDIR /app

# 创建非 root 用户
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# 构建信息参数（由 CI/Jenkins/本地脚本通过 --build-arg 传入）
ARG BUILD_VERSION=unknown
ARG BUILD_BRANCH=unknown
ARG BUILD_COMMIT=unknown
ARG BUILD_COMMIT_FULL=unknown
ARG BUILD_TIME=unknown
ARG BUILD_MODULE=byclaw-be

RUN printf '{"version":"%s","branch":"%s","commit":"%s","commitFull":"%s","buildTime":"%s","module":"%s"}\n' \
    "$BUILD_VERSION" "$BUILD_BRANCH" "$BUILD_COMMIT" "$BUILD_COMMIT_FULL" "$BUILD_TIME" "$BUILD_MODULE" \
    > /app/build-info.json && chown appuser:appgroup /app/build-info.json

# 复制构建好的 JAR 文件
COPY --chown=appuser:appgroup target/*.jar app.jar

# 切换到非 root 用户
USER appuser

# 暴露端口
EXPOSE 8080

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/actuator/health || exit 1

# 启动应用
ENTRYPOINT ["java", "-jar", "app.jar"]
