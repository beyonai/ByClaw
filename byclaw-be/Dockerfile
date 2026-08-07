# 运行阶段（JAR 由 CI 预先构建）
FROM eclipse-temurin:21-jre-alpine

# 创建应用目录
WORKDIR /app

# 创建非 root 用户
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# 安装依赖：curl（健康检查）、bash、gcompat（dws 所需的 glibc 兼容层）、nodejs/npm（Lark/WeCom CLI + Trellis CLI）
RUN apk add --no-cache \
    curl \
    bash \
    gcompat \
    git \
    nodejs \
    npm \
    && rm -rf /var/cache/apk/*

# npm 使用国内镜像加速
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

# 安装 Lark/WeCom CLI
ARG LARKSUITE_CLI_VERSION=1.0.78
ARG WECOM_CLI_VERSION=0.1.9
RUN npm install --global \
        "@larksuite/cli@${LARKSUITE_CLI_VERSION}" \
        "@wecom/cli@${WECOM_CLI_VERSION}" \
    && lark-cli --version \
    && wecom-cli --version \
    && npm cache clean --force

# 复制 Trellis 离线安装包
COPY resources/mindfoldhq-trellis-core-0.6.12.tgz /tmp/
COPY resources/mindfoldhq-trellis-0.6.12.tgz /tmp/

# 安装 Trellis CLI（离线安装）
RUN npm install --global \
        /tmp/mindfoldhq-trellis-core-0.6.12.tgz \
        /tmp/mindfoldhq-trellis-0.6.12.tgz \
    && trellis --version \
    && rm -f /tmp/mindfoldhq-trellis-*.tgz \
    && npm cache clean --force

# 安装 DWS CLI。amd64 用随仓库预下载的二进制（避免构建时网络下载）；
# 仓库只存 amd64 包，arm64 构建时从 npm 包 dingtalk-workspace-cli 在线拉取对应架构二进制。
# DWS_VERSION 需与 docker/dws/version.md 及本地 amd64 包保持一致，避免运行时行为漂移。
# 非 root 运行：CLI 装到 appuser 家目录，token 走 file-DEK 后端加密落盘到 $HOME/.dws
# （DWS_DISABLE_KEYCHAIN=1，不依赖 gnome-keyring/dbus）。
ARG TARGETARCH
ARG DWS_VERSION=1.0.52
COPY docker/dws/dws-linux-amd64.tar.gz /tmp/dws-amd64.tar.gz
RUN mkdir -p /home/appuser/.local/bin \
    && if [ "$TARGETARCH" = "amd64" ]; then \
         tar -xzf /tmp/dws-amd64.tar.gz -C /home/appuser/.local/bin dws; \
       else \
         curl -fsSL "https://registry.npmjs.org/dingtalk-workspace-cli/-/dingtalk-workspace-cli-${DWS_VERSION}.tgz" -o /tmp/dws-pkg.tgz \
         && tar -xzf /tmp/dws-pkg.tgz -C /tmp "package/assets/dws-linux-${TARGETARCH}.tar.gz" \
         && tar -xzf "/tmp/package/assets/dws-linux-${TARGETARCH}.tar.gz" -C /home/appuser/.local/bin dws; \
       fi \
    && chmod +x /home/appuser/.local/bin/dws \
    && rm -rf /tmp/dws-amd64.tar.gz /tmp/dws-pkg.tgz /tmp/package \
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
