FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY redis_agent_config.py redis_model_config.py minio_client.py minio_agent_config.py api.py start.sh worker.py ./

ENTRYPOINT ["bash", "/app/start.sh"]
CMD ["api"]
