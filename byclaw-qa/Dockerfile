FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

WORKDIR /app

ENV PYTHONPATH=/app/src

COPY pyproject.toml uv.lock README.md ./
# Install the locked stable dependencies first for all branches.
RUN uv sync --frozen --no-dev --no-install-project
# Override by-qa only on develop/qa so those images track ByKC main during integration.
ARG BRANCH=""
RUN if [ "${BRANCH}" = "develop" ] || [ "${BRANCH}" = "qa" ]; then \
        echo "BRANCH=${BRANCH}: reinstalling by-qa from ByKC main branch"; \
        uv pip install --python .venv/bin/python --force-reinstall \
            "by-qa[all] @ https://github.com/beyonai/ByKC/archive/refs/heads/main.tar.gz"; \
    fi

COPY start.sh ./
COPY src/ ./src/

ENTRYPOINT ["bash", "/app/start.sh"]
CMD ["api"]
