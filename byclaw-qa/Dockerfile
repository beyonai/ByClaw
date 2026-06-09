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
# ADD from the GitHub commits API acts as a cache probe — when ByKC main receives
# new commits, the JSON response changes, which busts this layer and forces a
# reinstall of by-qa from the updated main tarball.
# NOTE: GitHub API rate-limits unauthenticated requests to 60/hour/IP. If builds
# become frequent, switch to a raw URL instead:
#   ADD https://raw.githubusercontent.com/beyonai/ByKC/main/pyproject.toml /tmp/bykc_version.txt
ARG BRANCH=""
# ADD https://api.github.com/repos/beyonai/ByKC/commits/main /tmp/bykc_version.json
RUN if [ "${BRANCH}" = "develop" ] || [ "${BRANCH}" = "qa" ]; then \
        echo "BRANCH=${BRANCH}: reinstalling by-qa from ByKC main branch"; \
        uv pip install --python .venv/bin/python --force-reinstall \
            "by-qa[all] @ https://github.com/beyonai/ByKC/archive/refs/heads/main.tar.gz"; \
    else \
        rm -f /tmp/bykc_version.json; \
    fi

COPY start.sh ./
COPY src/ ./src/

# 构建信息
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
