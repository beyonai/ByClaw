FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PATH="/workspace/byclaw-data/.venv/bin:${PATH}"

WORKDIR /workspace

COPY byclaw-data /workspace/byclaw-data

WORKDIR /workspace/byclaw-data

RUN set -- packages/by_datacloud-*.whl; \
    if [ -f "$1" ]; then \
      uv sync --frozen --no-dev --no-install-package by-datacloud; \
      uv pip install --python .venv/bin/python "$1"; \
    else \
      uv sync --frozen --no-dev; \
    fi

# 构建信息
ARG BUILD_VERSION=unknown
ARG BUILD_BRANCH=unknown
ARG BUILD_COMMIT=unknown
ARG BUILD_COMMIT_FULL=unknown
ARG BUILD_TIME=unknown
ARG BUILD_MODULE=byclaw-data

RUN printf '{"version":"%s","branch":"%s","commit":"%s","commitFull":"%s","buildTime":"%s","module":"%s"}\n' \
    "$BUILD_VERSION" "$BUILD_BRANCH" "$BUILD_COMMIT" "$BUILD_COMMIT_FULL" "$BUILD_TIME" "$BUILD_MODULE" \
    > /workspace/byclaw-data/build-info.json

#RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /workspace
#USER appuser
RUN groupadd -g 1001 appuser \
    && useradd -m -u 1001 -g 1001 appuser \
    && chown -R 1001:1001 /workspace

USER appuser

EXPOSE 8080

ENTRYPOINT ["bash", "/workspace/byclaw-data/start.sh"]
