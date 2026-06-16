FROM node:22-slim AS ext-builder

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
COPY byclaw-exe/extensions/byclaw-sqlite/package.json \
     byclaw-exe/extensions/byclaw-sqlite/package-lock.json \
     ./src/byclaw-sqlite/


RUN --mount=type=cache,target=/root/.npm \
    set -eux; \
    pids=""; \
    for dir in src/*/; do \
        [ -f "$dir/package.json" ] || continue; \
        name=$(basename "$dir"); \
        echo ">>> npm ci --omit=dev: $name"; \
        (cd "$dir" && npm ci --omit=dev --prefer-offline) & \
        pids="$pids $!"; \
    done; \
    for pid in $pids; do wait "$pid"; done

COPY byclaw-exe/extensions/baiying-enhance/ ./src/baiying-enhance/
COPY byclaw-exe/extensions/byai-channel/ ./src/byai-channel/
COPY byclaw-exe/extensions/byclaw-sqlite/ ./src/byclaw-sqlite/

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

FROM ghcr.io/openclaw/openclaw:2026.6.1

USER root

ARG OPENCLI_VERSION=1.8.1
ARG OPENCLI_EXTENSION_VERSION=1.0.17
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
        novnc \
        xauth \
        x11vnc \
        xvfb \
        zip"; \
    case "${INSTALL_BROWSER_STACK}" in \
      true|1|yes|on) apt-get install -y --no-install-recommends ${base_packages} ${browser_packages} ;; \
      *) apt-get install -y --no-install-recommends ${base_packages}; echo "skip browser/VNC/display/opencli stack" ;; \
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
        ffmpeg -version; \
        ffprobe -version; \
        tmp_mp3="$(mktemp --suffix=.mp3)"; \
        ffmpeg -hide_banner -loglevel error -y -f lavfi -i sine=frequency=1000:duration=1 -q:a 9 -acodec libmp3lame "${tmp_mp3}"; \
        ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tmp_mp3}"; \
        rm -f "${tmp_mp3}"; \
        npm install -g "@jackwener/opencli@${OPENCLI_VERSION}"; \
        mkdir -p /opt/opencli/extension; \
        curl -fsSL -o /tmp/opencli-extension.zip \
            "https://github.com/jackwener/OpenCLI/releases/download/v${OPENCLI_VERSION}/opencli-extension-v${OPENCLI_EXTENSION_VERSION}.zip"; \
        unzip -q /tmp/opencli-extension.zip -d /opt/opencli/extension; \
        rm -f /tmp/opencli-extension.zip; \
        chromium --version; \
        x11vnc -version; \
        opencli --version; \
        test -f /opt/opencli/extension/manifest.json; \
        ;; \
    esac; \
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
    python3 -m pip install --no-cache-dir redis websockify; \
    rm -f /usr/bin/websockify; \
    ln -sf /usr/local/bin/websockify /usr/bin/websockify; \
    websockify --help >/dev/null

COPY --from=ext-builder /build/out/ /app/dist-runtime/extensions/

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

RUN curl -fsSL https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.sh | sh

# 安装 Bun 运行环境（gbrain 必需）
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# add gbrain（官方原版）
RUN bun install -g github:garrytan/gbrain

# rm
RUN rm -fr /root/.agents/skills

EXPOSE 8081

ENTRYPOINT ["/usr/local/bin/startAll.sh"]
