ARG OPENCLAW_VERSION=2026.6.6
FROM node:24-slim AS ext-builder

WORKDIR /build

RUN npm config set registry https://registry.npmmirror.com --global \
    && npm config set fund false --global \
    && npm config set audit false --global \
    && npm config set prefer-offline true --global

RUN --mount=type=cache,target=/root/.npm \
    npm install --prefix /build/toolchain --no-package-lock --omit=dev esbuild@0.25.12

ENV PATH="/build/toolchain/node_modules/.bin:${PATH}"

COPY byclaw-exe/extensions/baiying-enhance/package.json \
     byclaw-exe/extensions/baiying-enhance/package-lock.json \
     ./src/baiying-enhance/
COPY byclaw-exe/extensions/byai-channel/package.json \
     byclaw-exe/extensions/byai-channel/package-lock.json \
     ./src/byai-channel/
COPY byclaw-exe/extensions/byai_diagnostics-otel/package.json \
     byclaw-exe/extensions/byai_diagnostics-otel/package-lock.json \
     ./src/byai_diagnostics-otel/
COPY byclaw-exe/extensions/byclaw-sqlite/package.json \
     byclaw-exe/extensions/byclaw-sqlite/package-lock.json \
     ./src/byclaw-sqlite/
COPY byclaw-exe/extensions/byclaw-acp-adapter/package.json \
     byclaw-exe/extensions/byclaw-acp-adapter/package-lock.json \
     ./src/byclaw-acp-adapter/
COPY byclaw-exe/extensions/byclaw-wiki/package.json \
     ./src/byclaw-wiki/


RUN --mount=type=cache,target=/root/.npm \
    set -eux; \
    pids=""; \
    for dir in src/*/; do \
        [ -f "$dir/package.json" ] || continue; \
        name=$(basename "$dir"); \
        if [ -f "$dir/package-lock.json" ]; then \
            echo ">>> npm ci --omit=dev: $name"; \
            (cd "$dir" && npm ci --omit=dev --prefer-offline) & \
        else \
            echo ">>> npm install --omit=dev --no-package-lock: $name"; \
            (cd "$dir" && npm install --omit=dev --no-package-lock --prefer-offline) & \
        fi; \
        pids="$pids $!"; \
    done; \
    for pid in $pids; do wait "$pid"; done

COPY byclaw-exe/extensions/baiying-enhance/ ./src/baiying-enhance/
COPY byclaw-exe/extensions/byai-channel/ ./src/byai-channel/
COPY byclaw-exe/extensions/byai_diagnostics-otel/ ./src/byai_diagnostics-otel/
COPY byclaw-exe/extensions/byclaw-sqlite/ ./src/byclaw-sqlite/
COPY byclaw-exe/extensions/byclaw-acp-adapter/ ./src/byclaw-acp-adapter/
COPY byclaw-exe/extensions/byclaw-wiki/ ./src/byclaw-wiki/

RUN set -eux; \
    mkdir -p /build/out; \
    for dir in src/*/; do \
        [ -f "$dir/package.json" ] || continue; \
        name=$(basename "$dir"); \
        if node --input-type=module -e ' \
            import { readFileSync } from "fs"; \
            const pkg = JSON.parse(readFileSync(process.argv[1] + "package.json", "utf8")); \
            process.exit((pkg.scripts || {}).build ? 0 : 1); \
        ' "$dir"; then \
            echo ">>> npm run build: $name"; \
            (cd "$dir" && npm run build); \
        fi; \
        echo ">>> prune dev deps: $name"; \
        (cd "$dir" && npm prune --omit=dev); \
        target="/build/out/$name"; \
        mkdir -p "$target"; \
        [ -d "$dir/dist" ] && cp -r "$dir/dist" "$target/dist"; \
        [ -d "$target/dist" ] && find "$target/dist" -name '*.map' -delete; \
        for f in package.json openclaw.plugin.json; do \
            [ -f "$dir/$f" ] && cp "$dir/$f" "$target/"; \
        done; \
        [ -d "$dir/node_modules" ] && cp -r "$dir/node_modules" "$target/node_modules"; \
    done; \
    echo ">>> built extensions:"; ls -la /build/out/

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS python312

FROM ghcr.io/openclaw/openclaw:${OPENCLAW_VERSION}

USER root

ARG OPENCLAW_VERSION
ARG OPENCLI_VERSION=1.8.0
ARG OPENCLI_EXTENSION_VERSION=1.0.15
ARG ZREAD_CLI_VERSION=0.2.13
ARG INSTALL_BROWSER_STACK=true

RUN chown root:root /app

ENV PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_ROOT_USER_ACTION=ignore \
    OPENCLAW_BUNDLED_PLUGINS_DIR=/app/dist/extensions \
    OPENCLAW_STATE_DIR=/root/.openclaw \
    OPENCLAW_VNC_WEB_PORT=8081 \
    OPENCLAW_VNC_PORT=5901

RUN set -eux; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i 's|http://deb.debian.org/debian|https://mirrors.tuna.tsinghua.edu.cn/debian|g' /etc/apt/sources.list.d/debian.sources; \
        sed -i 's|http://deb.debian.org/debian-security|https://mirrors.tuna.tsinghua.edu.cn/debian-security|g' /etc/apt/sources.list.d/debian.sources; \
    elif [ -f /etc/apt/sources.list ]; then \
        sed -i 's|http://deb.debian.org/debian|https://mirrors.tuna.tsinghua.edu.cn/debian|g' /etc/apt/sources.list; \
        sed -i 's|http://security.debian.org/debian-security|https://mirrors.tuna.tsinghua.edu.cn/debian-security|g' /etc/apt/sources.list; \
    fi; \
    printf 'Acquire::Retries "5";\n' > /etc/apt/apt.conf.d/80-retries; \
    apt-get update; \
    base_packages=" \
        ca-certificates \
        curl \
        git \
        unzip \
        wget \
        zip"; \
    browser_packages=" \
        chromium \
        ffmpeg \
        fontconfig \
        fonts-liberation \
        fonts-noto-cjk \
        fonts-wqy-microhei \
        fonts-wqy-zenhei \
        libreoffice \
        novnc \
        xauth \
        x11vnc \
        xvfb \
        zip"; \
    case "${INSTALL_BROWSER_STACK}" in \
      true|1|yes|on) apt-get install -y --no-install-recommends ${base_packages} ${browser_packages} ;; \
      *) apt-get install -y --no-install-recommends ${base_packages}; echo "skip browser/VNC/display/bycli stack" ;; \
    esac; \
    case "${INSTALL_BROWSER_STACK}" in \
      true|1|yes|on) \
        mkdir -p /etc/fonts/conf.d; \
        printf '%s\n' \
            '<?xml version="1.0"?>' \
            '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">' \
            '<fontconfig>' \
            '  <alias>' \
            '    <family>Microsoft YaHei</family>' \
            '    <prefer>' \
            '      <family>WenQuanYi Micro Hei</family>' \
            '      <family>Noto Sans CJK SC</family>' \
            '    </prefer>' \
            '  </alias>' \
            '  <alias>' \
            '    <family>Microsoft YaHei UI</family>' \
            '    <prefer>' \
            '      <family>WenQuanYi Micro Hei</family>' \
            '      <family>Noto Sans CJK SC</family>' \
            '    </prefer>' \
            '  </alias>' \
            '</fontconfig>' \
            > /etc/fonts/conf.d/65-microsoft-yahei-alias.conf; \
        fc-cache -f; \
        fc-match "Microsoft YaHei"; \
        libreoffice --version; \
        ffmpeg -version; \
        ffprobe -version; \
        tmp_mp3="$(mktemp --suffix=.mp3)"; \
        ffmpeg -hide_banner -loglevel error -y -f lavfi -i sine=frequency=1000:duration=1 -q:a 9 -acodec libmp3lame "${tmp_mp3}"; \
        ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tmp_mp3}"; \
        rm -f "${tmp_mp3}"; \
        npm install -g "@sovovs/bycli@${OPENCLI_VERSION}"; \
        mkdir -p /opt/opencli/extension; \
        curl -fsSL -o /tmp/opencli-extension.zip \
            "https://github.com/jackwener/OpenCLI/releases/download/v${OPENCLI_VERSION}/opencli-extension-v${OPENCLI_EXTENSION_VERSION}.zip"; \
        unzip -q /tmp/opencli-extension.zip -d /opt/opencli/extension; \
        rm -f /tmp/opencli-extension.zip; \
        chromium --version; \
        x11vnc -version; \
        bycli --version; \
        test -f /opt/opencli/extension/manifest.json; \
        ;; \
    esac; \
    npm install -g "zread_cli@${ZREAD_CLI_VERSION}"; \
    zread --help >/dev/null; \
    npm install -g @colbymchenry/codegraph; \
    codegraph version; \
    rm -rf /var/lib/apt/lists/*

COPY --from=python312 /usr/local/bin/python3.12 /usr/local/bin/pip3.12 /usr/local/bin/
COPY --from=python312 /usr/local/lib/libpython3.12.so* /usr/local/lib/
COPY --from=python312 /usr/local/lib/python3.12 /usr/local/lib/python3.12

RUN set -eux; \
    ln -sf /usr/local/bin/python3.12 /usr/local/bin/python3; \
    ln -sf /usr/local/bin/python3.12 /usr/bin/python3; \
    python3 --version | grep -q 'Python 3.12'; \
    python3 -m pip config --global set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple; \
    python3 -m pip config --global set global.trusted-host pypi.tuna.tsinghua.edu.cn; \
    python3 -m pip install --no-cache-dir redis websockify by-framework; \
    rm -f /usr/bin/websockify; \
    ln -sf /usr/local/bin/websockify /usr/bin/websockify; \
    websockify --help >/dev/null

COPY --from=ext-builder /build/out/ /app/dist-runtime/extensions/

RUN --mount=type=cache,target=/root/.npm \
    set -eux; \
    npm config set registry https://registry.npmmirror.com --global; \
    npm config set fund false --global; \
    npm config set audit false --global; \
    npm config set prefer-offline true --global; \
    rm -rf /tmp/openclaw-acpx-plugin /app/dist/extensions/acpx; \
    npm install --prefix /tmp/openclaw-acpx-plugin --omit=dev --ignore-scripts --no-package-lock --prefer-offline "@openclaw/acpx@${OPENCLAW_VERSION}"; \
    mkdir -p /app/dist/extensions/acpx; \
    cp -a /tmp/openclaw-acpx-plugin/node_modules/@openclaw/acpx/. /app/dist/extensions/acpx/; \
    cp -a /tmp/openclaw-acpx-plugin/node_modules /app/dist/extensions/acpx/node_modules; \
    rm -rf /app/dist/extensions/acpx/node_modules/@openclaw/acpx /tmp/openclaw-acpx-plugin; \
    test -f /app/dist/extensions/acpx/dist/index.js; \
    test -f /app/dist/extensions/acpx/openclaw.plugin.json; \
    node --input-type=module -e ' \
      import { readFileSync } from "node:fs"; \
      const expectedVersion = process.argv[1]; \
      const manifest = JSON.parse(readFileSync("/app/dist/extensions/acpx/openclaw.plugin.json", "utf8")); \
      const pkg = JSON.parse(readFileSync("/app/dist/extensions/acpx/package.json", "utf8")); \
      if (manifest.id !== "acpx") throw new Error(`unexpected acpx plugin id: ${manifest.id}`); \
      if (pkg.name !== "@openclaw/acpx") throw new Error(`unexpected acpx package name: ${pkg.name}`); \
      if (pkg.version !== expectedVersion) throw new Error(`unexpected acpx version: ${pkg.version}`); \
    ' "$OPENCLAW_VERSION"

RUN set -eux; \
    rm -rf /app/dist/extensions/diagnostics-otel; \
    mkdir -p /app/dist/extensions; \
    cp -a /app/dist-runtime/extensions/byai_diagnostics-otel /app/dist/extensions/diagnostics-otel; \
    rm -rf /app/dist-runtime/extensions/byai_diagnostics-otel; \
    test -f /app/dist/extensions/diagnostics-otel/dist/index.js; \
    node --input-type=module -e ' \
      import { readFileSync } from "node:fs"; \
      const manifest = JSON.parse(readFileSync("/app/dist/extensions/diagnostics-otel/openclaw.plugin.json", "utf8")); \
      const pkg = JSON.parse(readFileSync("/app/dist/extensions/diagnostics-otel/package.json", "utf8")); \
      if (manifest.id !== "diagnostics-otel") throw new Error(`unexpected diagnostics plugin id: ${manifest.id}`); \
      if (pkg.name !== "@openclaw/diagnostics-otel") throw new Error(`unexpected diagnostics package name: ${pkg.name}`); \
    '

RUN ln -s /app /app/node_modules/openclaw


COPY middleware/openclaw/skills/ /app/skills/


COPY middleware/openclaw/linux-amd64-filebrowser/filebrowser /usr/local/bin/filebrowser
RUN chmod a+x /usr/local/bin/filebrowser


COPY middleware/openclaw/runtime-bootstrap.sh /usr/local/bin/openclaw-runtime-bootstrap
COPY middleware/openclaw/novnc-index.html /usr/local/share/openclaw/novnc-index.html
COPY middleware/openclaw/filebrowser-ui/ /usr/local/share/openclaw/filebrowser-ui/
COPY middleware/openclaw/filebrowser-ui-proxy.py /usr/local/bin/openclaw-filebrowser-ui-proxy
COPY middleware/openclaw/startAll.sh \
     middleware/openclaw/start-filebrowser.sh \
     middleware/openclaw/start-display.sh \
     middleware/openclaw/start-vnc.sh \
     middleware/openclaw/start-chrome.sh \
     middleware/openclaw/start-opencli.sh \
     middleware/openclaw/start-openclaw.sh \
     middleware/openclaw/start-gbrain.sh \
     /usr/local/bin/
RUN chmod +x \
    /usr/local/bin/openclaw-runtime-bootstrap \
    /usr/local/bin/openclaw-filebrowser-ui-proxy \
    /usr/local/bin/startAll.sh \
    /usr/local/bin/start-filebrowser.sh \
    /usr/local/bin/start-display.sh \
    /usr/local/bin/start-vnc.sh \
    /usr/local/bin/start-chrome.sh \
    /usr/local/bin/start-opencli.sh \
    /usr/local/bin/start-openclaw.sh \
    /usr/local/bin/start-gbrain.sh

RUN export DWS_VERSION=v1.0.47 && curl -fsSL https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.sh | sh

# 安装 Bun 运行环境（gbrain 必需）— 从官方镜像拷贝二进制，避免 curl 下载超时
COPY --from=oven/bun:1-debian /usr/local/bin/bun /usr/local/bin/bun
RUN ln -sf /usr/local/bin/bun /usr/local/bin/bunx
ENV PATH="/root/.bun/bin:/usr/local/bin:$PATH"

# add gbrain（官方原版）
RUN bun install -g github:garrytan/gbrain

# rm
RUN rm -fr /root/.agents/skills

# === sau (social-auto-upload) CLI integration ===
# 本地构建 wheel 的方法见 middleware/openclaw/sau/README.md
ARG SAU_VERSION=0.1.0
ENV SAU_BASE_DIR=/by/sau \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    LOCAL_CHROME_PATH=/usr/bin/chromium
COPY middleware/openclaw/sau/social_auto_upload-${SAU_VERSION}-py3-none-any.whl /tmp/
RUN set -eux; \
    mkdir -p /by/sau/cookies; \
    python3 -m pip install --no-cache-dir /tmp/social_auto_upload-${SAU_VERSION}-py3-none-any.whl; \
    patchright install chromium; \
    rm -f /tmp/social_auto_upload-${SAU_VERSION}-py3-none-any.whl; \
    sau --help >/dev/null; \
    python3 -c 'from conf import LOCAL_CHROME_PATH; assert LOCAL_CHROME_PATH == "/usr/bin/chromium", LOCAL_CHROME_PATH'; \
    test -x "${LOCAL_CHROME_PATH}"; \
    python3 -c 'from utils.browser_launch import chromium_launch_kwargs; kwargs = chromium_launch_kwargs(headless=True); assert kwargs.get("channel") == "chromium", kwargs'; \
    test -f "$(python3 -c 'from utils.base_social_media import stealth_js_path; print(stealth_js_path())')"; \
    echo "sau installed: $(sau --version 2>/dev/null || echo 'version n/a')"

EXPOSE 8081

ENTRYPOINT ["/usr/local/bin/startAll.sh"]
