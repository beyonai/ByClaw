# 运行阶段（JAR 由 CI 预先构建）
FROM eclipse-temurin:21-jre-alpine

# 创建应用目录
WORKDIR /app

# 创建非 root 用户
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# 安装依赖：curl（健康检查）、bash、gcompat（dws 所需的 glibc 兼容层）
RUN apk add --no-cache \
    curl \
    bash \
    gcompat \
    && rm -rf /var/cache/apk/*

# 安装 DWS CLI（使用预下载的二进制，避免构建时网络下载）。
# 非 root 运行：CLI 装到 appuser 家目录，token 走 file-DEK 后端加密落盘到 $HOME/.dws
# （DWS_DISABLE_KEYCHAIN=1，不依赖 gnome-keyring/dbus）。
COPY docker/dws/dws-linux-amd64.tar.gz /tmp/dws.tar.gz
RUN mkdir -p /home/appuser/.local/bin \
    && tar -xzf /tmp/dws.tar.gz -C /home/appuser/.local/bin dws \
    && chmod +x /home/appuser/.local/bin/dws \
    && rm -f /tmp/dws.tar.gz \
    && mkdir -p /home/appuser/.dws \
    && rm -rf /home/appuser/.agents/skills \
    && chown -R appuser:appgroup /home/appuser \
    && /home/appuser/.local/bin/dws --version

# DWS_DISABLE_KEYCHAIN=1：改用 file-DEK 后端，token 加密存 $HOME/.dws（即 /home/appuser/.dws），
# 部署时将该目录挂持久卷才能跨重启保留登录态。
ENV DWS_NO_SKILLS=1 \
    DWS_DISABLE_KEYCHAIN=1 \
    PATH="/home/appuser/.local/bin:${PATH}"

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
