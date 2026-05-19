## ── stage 1: build byclaw extensions ──────────────────────────────
FROM node:22-slim AS ext-builder

WORKDIR /build

COPY byclaw-exe/extensions/ ./src/

RUN npm config set registry https://registry.npmmirror.com --global

# install, build, prune, then assemble clean output into /build/out/
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

## ── stage 2: final image ─────────────────────────────────────────
FROM ghcr.io/openclaw/openclaw:2026.4.21

USER root

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
        python3 \
        python3-pip \
        python3-venv \
        ca-certificates \
        unzip \
        zip; \
    python3 -m pip config --global set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple; \
    python3 -m pip config --global set global.trusted-host pypi.tuna.tsinghua.edu.cn; \
    rm -rf /var/lib/apt/lists/*

COPY --from=ext-builder /build/out/ /app/extensions/

# add openclaw skills (overwrite same-name files with project content)
COPY middleware/openclaw/skills/ /app/skills/

# add dingTalk cli dws
RUN curl -fsSL https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.sh | sh

# rm
RUN rm -fr /root/.agents/skills