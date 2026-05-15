FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PATH="/workspace/byclaw-data/.venv/bin:${PATH}"

WORKDIR /workspace

COPY byclaw-data /workspace/byclaw-data

WORKDIR /workspace/byclaw-data
RUN uv config set pypi-index-url https://mirrors.aliyun.com/pypi/simple/
RUN set -- packages/by_datacloud-*.whl; \
    if [ -f "$1" ]; then \
      uv sync --frozen --no-dev --no-install-package by-datacloud; \
      uv pip install --python .venv/bin/python "$1"; \
    else \
      uv sync --frozen --no-dev; \
    fi

EXPOSE 8080

ENTRYPOINT ["bash", "/workspace/byclaw-data/start.sh"]
