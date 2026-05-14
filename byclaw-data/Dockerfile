FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PATH="/workspace/byclaw-data/.venv/bin:${PATH}"

WORKDIR /workspace

COPY byclaw-data /workspace/byclaw-data

WORKDIR /workspace/byclaw-data
# ✅ 新增这一行：配置 uv 使用国内镜像源
RUN uv config set pypi-index-url https://mirrors.aliyun.com/pypi/simple/

RUN uv sync --frozen --no-dev

EXPOSE 8080

ENTRYPOINT ["bash", "/workspace/byclaw-data/start.sh"]
