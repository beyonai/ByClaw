# 运行阶段（JAR 由 CI 预先构建）
FROM eclipse-temurin:21-jre-alpine

# 安装必要的工具
RUN apk add --no-cache curl nodejs npm && \
    node -e "const major = Number(process.versions.node.split('.')[0]); if (major < 20) { throw new Error('OpenCLI requires Node.js >= 20'); }"

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
ARG BUILD_COMMIT_MSG=unknown

RUN printf '{"version":"%s","branch":"%s","commit":"%s","commitFull":"%s","buildTime":"%s","module":"%s","commitMsg":"%s"}\n' \
    "$BUILD_VERSION" "$BUILD_BRANCH" "$BUILD_COMMIT" "$BUILD_COMMIT_FULL" "$BUILD_TIME" "$BUILD_MODULE" "$BUILD_COMMIT_MSG" \
    > /app/build-info.json && chown appuser:appgroup /app/build-info.json

# 安装 ByKC 生态采集所需的 OpenCLI 运行时
COPY runtime/opencli/package.json runtime/opencli/pnpm-lock.yaml /opt/byclaw/opencli/
RUN npm config set registry https://registry.npmmirror.com --global && \
    npm install -g pnpm@9.0.0 && \
    cd /opt/byclaw/opencli && \
    pnpm install --prod --frozen-lockfile && \
    chown -R appuser:appgroup /opt/byclaw/opencli

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
