# Build stage: install dependencies with uv (contains Rust tooling, not needed at runtime)
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

# Override by-qa on develop/qa branches to track ByKC main during integration.
# GitHub's archive URL serves a redirect that Docker's ADD caches — when ByKC main
# receives new commits, the redirect target changes and the layer is re-executed.
ARG BRANCH=""
RUN if [ "${BRANCH}" = "develop" ] || [ "${BRANCH}" = "qa" ]; then \
        echo "BRANCH=${BRANCH}: reinstalling by-qa from ByKC main branch"; \
        uv pip install --python .venv/bin/python --force-reinstall \
            "by-qa[all] @ https://github.com/beyonai/ByKC/archive/refs/heads/main.tar.gz"; \
    fi

# Strip build-time bloat from the venv
RUN uv cache clean \
    && find .venv -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null; true

# Runtime stage: slim Python image without uv toolchain
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-writer-nogui \
        libreoffice-impress-nogui \
        fonts-wqy-microhei \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/.venv /app/.venv

COPY start.sh ./
COPY src/ ./src/

ARG BUILD_VERSION=unknown
ARG BUILD_BRANCH=unknown
ARG BUILD_COMMIT=unknown
ARG BUILD_COMMIT_FULL=unknown
ARG BUILD_TIME=unknown
ARG BUILD_MODULE=byclaw-qa
ARG BUILD_COMMIT_MSG=unknown

RUN printf '{"version":"%s","branch":"%s","commit":"%s","commitFull":"%s","buildTime":"%s","module":"%s","commitMsg":"%s"}\n' \
    "$BUILD_VERSION" "$BUILD_BRANCH" "$BUILD_COMMIT" "$BUILD_COMMIT_FULL" "$BUILD_TIME" "$BUILD_MODULE" "$BUILD_COMMIT_MSG" \
    > /app/build-info.json

ENTRYPOINT ["bash", "/app/start.sh"]
CMD ["api"]
