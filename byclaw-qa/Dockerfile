FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

WORKDIR /app

ENV PYTHONPATH=/app/src

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY start.sh ./
COPY src/ ./src/

ENTRYPOINT ["bash", "/app/start.sh"]
CMD ["api"]
