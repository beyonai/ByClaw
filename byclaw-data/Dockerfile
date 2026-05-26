FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PATH="/workspace/byclaw-data/.venv/bin:${PATH}"

WORKDIR /workspace

COPY byclaw-data /workspace/byclaw-data

WORKDIR /workspace/byclaw-data
RUN uv sync --frozen --no-dev

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /workspace
USER appuser

EXPOSE 8080

ENTRYPOINT ["bash", "/workspace/byclaw-data/start.sh"]
