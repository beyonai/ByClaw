## ── stage 1: build byclaw extensions ──────────────────────────────
FROM node:24-slim AS ext-builder

WORKDIR /build

COPY byclaw-exe/extensions/ ./src/

RUN npm config set registry https://registry.npmmirror.com --global

RUN set -eux; \
    mkdir -p /build/out; \
    for dir in src/*/; do \
        [ -f "$dir/package.json" ] || continue; \
        name=$(basename "$dir"); \
        echo ">>> npm install: $name"; \
        (cd "$dir" && npm install); \
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

## ── stage 2: build open-design from source ────────────────────────
FROM node:24-slim AS open-design-builder

ARG OPEN_DESIGN_REPO=https://github.com/evanzmz/open-design.git
ARG OPEN_DESIGN_REF=codex/base-path-env-toggle
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ARG no_proxy
ARG NO_PROXY
ARG NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
ARG COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
ARG OPEN_DESIGN_BASE_PATH=/openDesign
ARG OPEN_DESIGN_PORT=17456

ENV HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    http_proxy=${http_proxy} \
    https_proxy=${https_proxy} \
    no_proxy=${no_proxy} \
    NO_PROXY=${NO_PROXY} \
    npm_config_registry=${NPM_CONFIG_REGISTRY} \
    COREPACK_NPM_REGISTRY=${COREPACK_NPM_REGISTRY} \
    npm_config_fetch_retries=5 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_fetch_timeout=300000 \
    OD_BASE_PATH=${OPEN_DESIGN_BASE_PATH} \
    OD_PORT=${OPEN_DESIGN_PORT} \
    CI=true \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PUPPETEER_SKIP_DOWNLOAD=1

RUN set -eux; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i 's|http://deb.debian.org/debian|http://mirrors.aliyun.com/debian|g' /etc/apt/sources.list.d/debian.sources; \
        sed -i 's|http://deb.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' /etc/apt/sources.list.d/debian.sources; \
    elif [ -f /etc/apt/sources.list ]; then \
        sed -i 's|http://deb.debian.org/debian|http://mirrors.aliyun.com/debian|g' /etc/apt/sources.list; \
        sed -i 's|http://security.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' /etc/apt/sources.list; \
    fi; \
    printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::ForceIPv4 "true";\n' > /etc/apt/apt.conf.d/80-retries; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        git \
        python3 \
        make \
        g++ \
        ca-certificates; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN git clone --depth 1 --branch "$OPEN_DESIGN_REF" "$OPEN_DESIGN_REPO" .

RUN set -eux; \
    corepack enable; \
    corepack prepare pnpm@10.33.2 --activate; \
    pnpm --version; \
    pnpm config set registry "$NPM_CONFIG_REGISTRY"; \
    pnpm config set fetch-retries 5; \
    pnpm config set fetch-retry-maxtimeout 120000; \
    pnpm config set fetch-timeout 300000; \
    pnpm install --frozen-lockfile

RUN set -eux; \
    pnpm --filter @open-design/daemon build; \
    pnpm --filter @open-design/web build; \
    pnpm --filter @open-design/daemon deploy --legacy --prod /app/deploy/daemon; \
    test -n "$(find /app/deploy/daemon/node_modules -name better_sqlite3.node -print -quit)"; \
    pnpm store prune; \
    rm -rf \
      /root/.cache \
      /root/.local/share/pnpm/store \
      /app/deploy/daemon/node_modules/.cache \
      /app/deploy/daemon/node_modules/@types \
      /app/deploy/daemon/node_modules/.pnpm/@types+* \
      /app/deploy/daemon/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/deps \
      /app/deploy/daemon/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/src && \
    find /app/deploy/daemon/node_modules -type d \( \
      -name test -o \
      -name tests -o \
      -name "__tests__" -o \
      -name docs -o \
      -name doc -o \
      -name example -o \
      -name examples -o \
      -name ".github" \
    \) -prune -exec rm -rf '{}' + && \
    find /app/deploy/daemon/node_modules -type f \( \
      -name "*.md" -o \
      -name "*.markdown" -o \
      -name "*.d.ts" -o \
      -name "*.d.cts" -o \
      -name "*.d.mts" -o \
      -name "*.map" -o \
      -name "*.tsbuildinfo" -o \
      -name "binding.gyp" \
    \) -delete

## ── stage 3: install Claude Code in a clean Node image ────────────
FROM node:24-slim AS claude-code-builder

ARG CLAUDE_CODE_NPM_REGISTRY=https://registry.npmjs.org
ARG CLAUDE_CODE_VERSION=latest

RUN set -eux; \
    npm install -g \
        --registry="$CLAUDE_CODE_NPM_REGISTRY" \
        --fetch-retries=5 \
        --fetch-retry-maxtimeout=120000 \
        --fetch-timeout=300000 \
        "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"; \
    command -v claude; \
    claude --version

## ── stage 4: final image ─────────────────────────────────────────
FROM ghcr.io/openclaw/openclaw:2026.4.21

USER root

ARG OPEN_DESIGN_BASE_PATH=/openDesign
ARG OPEN_DESIGN_PORT=17456

RUN chown root:root /app

ENV PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_ROOT_USER_ACTION=ignore

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
    apt-get install -y --no-install-recommends \
        bash \
        tini \
        curl \
        python3 \
        python3-pip \
        python3-venv \
        ca-certificates \
        unzip \
        zip \
        util-linux \
        libstdc++6; \
    python3 -m pip config --global set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple; \
    python3 -m pip config --global set global.trusted-host pypi.tuna.tsinghua.edu.cn; \
    rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    groupadd --system --gid 1001 open-design; \
    useradd --system --uid 1001 --gid open-design --home-dir /nonexistent --no-create-home open-design

# Use Node 24 in the final OpenClaw image.
COPY --from=open-design-builder /usr/local/bin/node /usr/local/bin/node
COPY --from=open-design-builder /usr/local/bin/npm /usr/local/bin/npm
COPY --from=open-design-builder /usr/local/bin/npx /usr/local/bin/npx
COPY --from=open-design-builder /usr/local/bin/corepack /usr/local/bin/corepack
COPY --from=open-design-builder /usr/local/lib/node_modules /usr/local/lib/node_modules

RUN node -e 'process.exit(process.versions.node.startsWith("24.") ? 0 : 1)'

COPY --from=claude-code-builder /usr/local/bin/claude /usr/local/bin/claude
COPY --from=claude-code-builder /usr/local/lib/node_modules/@anthropic-ai /usr/local/lib/node_modules/@anthropic-ai

RUN set -eux; \
    command -v claude; \
    claude --version

# Open Design runtime.
COPY --from=open-design-builder /app/deploy/daemon /opt/open-design/apps/daemon
COPY --from=open-design-builder /app/apps/web/out /opt/open-design/apps/web/out
COPY --from=open-design-builder /app/skills /opt/open-design/skills
COPY --from=open-design-builder /app/design-systems /opt/open-design/design-systems
COPY --from=open-design-builder /app/craft /opt/open-design/craft
COPY --from=open-design-builder /app/prompt-templates /opt/open-design/prompt-templates
COPY --from=open-design-builder /app/assets/frames /opt/open-design/assets/frames
COPY --from=open-design-builder /app/assets/community-pets /opt/open-design/assets/community-pets
COPY --from=open-design-builder /app/plugins/_official /opt/open-design/plugins/_official

# Open Design web patch.
COPY middleware/openclaw/patch-open-design-web.sh /usr/local/bin/patch-open-design-web
RUN chmod a+x /usr/local/bin/patch-open-design-web && \
    WEB_OUT=/opt/open-design/apps/web/out /usr/local/bin/patch-open-design-web

ENV OPEN_DESIGN_ROOT=/opt/open-design \
    OD_BASE_PATH=${OPEN_DESIGN_BASE_PATH} \
    OD_BIND_HOST=127.0.0.1 \
    OD_PORT=${OPEN_DESIGN_PORT} \
    OD_DATA_DIR=/by/.od \
    OD_MEDIA_CONFIG_DIR=/by/.od \
    OD_NODE_OPTIONS=--max-old-space-size=192 \
    CLAUDE_CONFIG_DIR=/by/.od/claude \
    CLAUDE_BIN=/usr/local/bin/claude

RUN mkdir -p /by/.od/claude && \
    chown -R open-design:open-design /by/.od /opt/open-design

COPY --from=ext-builder /build/out/ /app/extensions/

# add openclaw skills
COPY middleware/openclaw/skills/ /app/skills/

# add filebrowser
COPY middleware/openclaw/linux-amd64-filebrowser/filebrowser /usr/local/bin/filebrowser
RUN chmod a+x /usr/local/bin/filebrowser

# add open-design starter
COPY middleware/openclaw/start-openclaw-with-open-design.sh /usr/local/bin/start-openclaw-with-open-design
RUN chmod a+x /usr/local/bin/start-openclaw-with-open-design

# add dingTalk cli dws
# RUN curl -fsSL https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.sh | sh

# rm
RUN rm -fr /root/.agents/skills
