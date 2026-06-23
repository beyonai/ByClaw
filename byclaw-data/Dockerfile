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
      echo "[install] found local wheel: $1, installing by-datacloud from wheel"; \
      uv sync --frozen --no-dev --no-install-package by-datacloud; \
      uv pip install --python .venv/bin/python "$1"; \
      echo "[install] done: by-datacloud installed from local wheel"; \
    else \
      echo "[install] no local wheel found (packages/by_datacloud-*.whl), installing from registry"; \
      uv sync --frozen --no-dev; \
      echo "[install] done: dependencies installed from registry"; \
    fi

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
