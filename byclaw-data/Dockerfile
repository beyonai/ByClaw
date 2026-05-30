FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PATH="/workspace/byclaw-data/.venv/bin:${PATH}"

WORKDIR /workspace

COPY byclaw-data /workspace/byclaw-data

WORKDIR /workspace/byclaw-data
RUN uv sync --frozen --no-dev

# 构建信息
ARG BUILD_VERSION=unknown
ARG BUILD_BRANCH=unknown
ARG BUILD_COMMIT=unknown
ARG BUILD_COMMIT_FULL=unknown
ARG BUILD_TIME=unknown
ARG BUILD_MODULE=byclaw-data
ARG BUILD_COMMIT_MSG=unknown

RUN printf '{"version":"%s","branch":"%s","commit":"%s","commitFull":"%s","buildTime":"%s","module":"%s","commitMsg":"%s"}\n' \
    "$BUILD_VERSION" "$BUILD_BRANCH" "$BUILD_COMMIT" "$BUILD_COMMIT_FULL" "$BUILD_TIME" "$BUILD_MODULE" "$BUILD_COMMIT_MSG" \
    > /workspace/byclaw-data/build-info.json

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /workspace
USER appuser

EXPOSE 8080

ENTRYPOINT ["bash", "/workspace/byclaw-data/start.sh"]
