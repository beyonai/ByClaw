#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY="${REGISTRY:-ghcr.io}"
PUSH=false
MODULES=()

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS] <module...>

Build Docker images with embedded build-info.json metadata.

Modules: byclaw-fe, byclaw-be, byclaw-qa, byclaw-data

Options:
  --all             Build all modules
  --push            Push images after building
  --registry URL    Container registry (default: ghcr.io)
  --tag TAG         Image tag (default: git branch or 'local')
  -h, --help        Show this help

Examples:
  $(basename "$0") byclaw-be
  $(basename "$0") --all --push
  $(basename "$0") byclaw-fe byclaw-be --tag v1.2.3
EOF
    exit 0
}

TAG=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --all) MODULES=(byclaw-fe byclaw-be byclaw-qa byclaw-data); shift ;;
        --push) PUSH=true; shift ;;
        --registry) REGISTRY="$2"; shift 2 ;;
        --tag) TAG="$2"; shift 2 ;;
        -h|--help) usage ;;
        byclaw-*) MODULES+=("$1"); shift ;;
        *) echo "Unknown argument: $1"; exit 1 ;;
    esac
done

if [[ ${#MODULES[@]} -eq 0 ]]; then
    echo "Error: specify at least one module or --all"
    usage
fi

BRANCH=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
COMMIT=$(git -C "$REPO_ROOT" rev-parse --short=7 HEAD 2>/dev/null || echo "unknown")
COMMIT_FULL=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")
COMMIT_MSG=$(git -C "$REPO_ROOT" log -1 --pretty=format:%s 2>/dev/null | head -c 100 || echo "unknown")
BUILD_TIME=$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)

if [[ -z "$TAG" ]]; then
    TAG=$(echo "$BRANCH" | sed 's/[^a-zA-Z0-9._-]/-/g')
fi

build_module() {
    local module="$1"
    local context dockerfile image_name

    case "$module" in
        byclaw-fe)
            context="$REPO_ROOT/byclaw-fe"
            dockerfile="$context/Dockerfile"
            ;;
        byclaw-be)
            context="$REPO_ROOT/byclaw-be"
            dockerfile="$context/Dockerfile"
            ;;
        byclaw-qa)
            context="$REPO_ROOT/byclaw-qa"
            dockerfile="$context/Dockerfile"
            ;;
        byclaw-data)
            context="$REPO_ROOT"
            dockerfile="$REPO_ROOT/byclaw-data/Dockerfile"
            ;;
        *)
            echo "Unknown module: $module"; return 1 ;;
    esac

    if [[ ! -f "$dockerfile" ]]; then
        echo "  Skipping $module (no Dockerfile)"
        return 0
    fi

    image_name="$module:$TAG"
    echo ""
    echo "=== Building $module ==="
    echo "  Branch:  $BRANCH"
    echo "  Commit:  $COMMIT"
    echo "  Time:    $BUILD_TIME"
    echo "  Tag:     $TAG"

    docker build \
        --build-arg BUILD_VERSION="$TAG" \
        --build-arg BUILD_BRANCH="$BRANCH" \
        --build-arg BUILD_COMMIT="$COMMIT" \
        --build-arg BUILD_COMMIT_FULL="$COMMIT_FULL" \
        --build-arg BUILD_TIME="$BUILD_TIME" \
        --build-arg BUILD_MODULE="$module" \
        --build-arg BUILD_COMMIT_MSG="$COMMIT_MSG" \
        --build-arg BRANCH="$BRANCH" \
        --label "org.opencontainers.image.source=https://github.com/beyonai/ByClaw" \
        --label "org.opencontainers.image.revision=$COMMIT_FULL" \
        --label "org.opencontainers.image.created=$BUILD_TIME" \
        --label "org.opencontainers.image.version=$TAG" \
        --label "org.opencontainers.image.ref.name=$BRANCH" \
        --label "com.byclaw.module=$module" \
        -t "$image_name" \
        -f "$dockerfile" \
        "$context"

    echo "  Built: $image_name"

    if [[ "$PUSH" == "true" ]]; then
        local remote_image="$REGISTRY/beyonai/byclaw/$module:$TAG"
        docker tag "$image_name" "$remote_image"
        docker push "$remote_image"
        echo "  Pushed: $remote_image"
    fi
}

for module in "${MODULES[@]}"; do
    build_module "$module"
done

echo ""
echo "=== Done ==="
echo "Built ${#MODULES[@]} module(s) with tag: $TAG"
