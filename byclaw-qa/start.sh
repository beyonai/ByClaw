#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

load_env_file() {
    local env_file="$1"
    if [[ -f "$env_file" ]]; then
        set -a
        # shellcheck disable=SC1090
        source "$env_file"
        set +a
    fi
}

map_prefixed_env() {
    local target="$1"
    local source_name="BYCLAW_QA_${target}"
    local source_value="${!source_name-}"
    local target_value="${!target-}"

    if [[ -n "${source_value}" && -z "${target_value}" ]]; then
        export "${target}=${source_value}"
    fi
}

map_env_if_unset() {
    local target="$1"
    local source_name="$2"
    local source_value="${!source_name-}"
    local target_value="${!target-}"

    if [[ -n "${source_value}" && -z "${target_value}" ]]; then
        export "${target}=${source_value}"
    fi
}

map_env_alias_if_unset() {
    local target="$1"
    local source_name="$2"
    local source_value="${!source_name-}"
    local target_value="${!target-}"

    if [[ -n "${source_value}" && -z "${target_value}" ]]; then
        export "${target}=${source_value}"
    fi
}

map_file_storage_minio_env() {
    if [[ -z "${MINIO_ENDPOINT-}" && -n "${FILE_STORAGE_MINIO_HOST-}" && -n "${FILE_STORAGE_MINIO_API_PORT-}" ]]; then
        export "MINIO_ENDPOINT=${FILE_STORAGE_MINIO_HOST}:${FILE_STORAGE_MINIO_API_PORT}"
    fi

    map_env_if_unset "MINIO_ACCESS_KEY" "FILE_STORAGE_MINIO_ACCESS_KEY"
    map_env_if_unset "MINIO_SECRET_KEY" "FILE_STORAGE_MINIO_SECRET_KEY"
    map_env_if_unset "MINIO_SECURE" "FILE_STORAGE_MINIO_SECURE"
}

default_env_if_unset() {
    local target="$1"
    local default_value="$2"
    local target_value="${!target-}"

    if [[ -z "${target_value}" ]]; then
        export "${target}=${default_value}"
    fi
}

load_env_file "$SCRIPT_DIR/.env"

usage() {
    cat <<'EOF'
Usage:
  ./start.sh api
  ./start.sh worker

Modes:
  api     Start the knowledge base management API service
  worker  Start the instant question answering worker
EOF
}

MODE="${1:-}"

case "$MODE" in
    api|worker)
        ;;
    -h|--help|help)
        usage
        exit 0
        ;;
    *)
        usage
        exit 1
        ;;
esac

collect_missing_env() {
    local missing_ref="$1"
    shift

    local var_name
    for var_name in "$@"; do
        if [[ -z "${!var_name-}" ]]; then
            eval "$missing_ref+=(\"\$var_name\")"
        fi
    done
}

collect_missing_minio_source_env() {
    local missing_ref="$1"

    if [[ -z "${MINIO_ENDPOINT-}" ]]; then
        collect_missing_env "$missing_ref" \
            FILE_STORAGE_MINIO_HOST \
            FILE_STORAGE_MINIO_API_PORT
    fi

    if [[ -z "${MINIO_ACCESS_KEY-}" ]]; then
        collect_missing_env "$missing_ref" FILE_STORAGE_MINIO_ACCESS_KEY
    fi

    if [[ -z "${MINIO_SECRET_KEY-}" ]]; then
        collect_missing_env "$missing_ref" FILE_STORAGE_MINIO_SECRET_KEY
    fi

    if [[ -z "${MINIO_SECURE-}" ]]; then
        collect_missing_env "$missing_ref" FILE_STORAGE_MINIO_SECURE
    fi
}

print_missing_env() {
    local mode="$1"
    shift

    printf 'Missing required source environment variables for %s mode:\n' "$mode" >&2
    local var_name
    for var_name in "$@"; do
        printf '  - %s\n' "$var_name" >&2
    done
}

collect_required_source_missing_env() {
    local missing_ref="$1"
    collect_missing_env "$missing_ref" \
        QA_DOMAINNAME \
        HOST \
        DB_USER \
        DB_PASS \
        REDIS_HOST \
        REDIS_PORT \
        REDIS_DATABASE \
        BYCLAW_QA_PORT \
        BYCLAW_QA_AGENT_DATA_PATH \
        BYCLAW_QA_KB_FETCH_CACHE_TTL_SECONDS \
        BYCLAW_QA_KB_FETCH_CACHE_CLEANUP_INTERVAL_SECONDS \
        BYCLAW_QA_KB_MINIO_BUCKET \
        BYCLAW_QA_KB_MINIO_MARKDOWN_BUCKET \
        BYCLAW_QA_BYAI_WORKER_ID
    collect_missing_minio_source_env "$missing_ref"
}

check_required_env() {
    local mode="$1"
    local missing=()
    collect_required_source_missing_env missing

    if (( ${#missing[@]} > 0 )); then
        print_missing_env "$mode" "${missing[@]}"
        return 1
    fi
}

case "$MODE" in
    api|worker)
        check_required_env "$MODE"
        ;;
esac

# Keep by-qa HOST on its own default/config path; repo-level HOST should only
# feed HOST_MACHINE aliasing and must not leak through as the runtime bind host.
ROOT_HOST_VALUE="${HOST-}"
unset HOST
export HOST="0.0.0.0"

cd "$SCRIPT_DIR"

map_env_if_unset "BYAI_REDIS_HOST" "REDIS_HOST"
map_env_if_unset "BYAI_REDIS_PORT" "REDIS_PORT"
map_env_if_unset "BYAI_REDIS_DB" "REDIS_DATABASE"
map_env_if_unset "BYAI_REDIS_USERNAME" "REDIS_USERNAME"
map_env_if_unset "BYAI_REDIS_PASSWORD" "REDIS_PASSWORD"
map_file_storage_minio_env

for var_name in \
    PORT \
    SERVICE_NAME \
    HOST_MACHINE \
    AGENT_DATA_PATH \
    EMBEDDING_MODEL_NAME \
    EMBEDDING_BASE_URL \
    EMBEDDING_API_KEY \
    EMBEDDING_DIMENSION \
    EMBEDDING_DISTANCE_METRIC \
    LLM_BASE_URL \
    LLM_API_KEY \
    CLASSIFIER_MODEL \
    CLASSIFIER_TEMP \
    RETRIEVAL_MODEL \
    RETRIEVAL_TEMP \
    GENERATOR_MODEL \
    GENERATOR_TEMP \
    QUALITY_MODEL \
    QUALITY_TEMP \
    DECOMPOSER_MODEL \
    DECOMPOSER_TEMP \
    DECOMPOSER_MAX_SUB_QUERIES \
    AGGREGATOR_MODEL \
    AGGREGATOR_TEMP \
    CONTEXT_MAX_TOKENS \
    INSTANT_SEARCH_MAX_CONTEXT_RATIO \
    INSTANT_SEARCH_RESERVED_TOKENS \
    INSTANT_SEARCH_MIN_SENTENCE_TOKENS \
    CHECKPOINTER_SQLITE_PATH \
    KB_FETCH_CACHE_TTL_SECONDS \
    KB_FETCH_CACHE_CLEANUP_INTERVAL_SECONDS \
    BYAI_WORKER_ID
do
    map_prefixed_env "$var_name"
done

default_env_if_unset "DB_URL" "ignore"
default_env_if_unset "EMBEDDING_MODEL_NAME" "ignore"
default_env_if_unset "EMBEDDING_BASE_URL" "ignore"
default_env_if_unset "EMBEDDING_API_KEY" "ignore"
default_env_if_unset "EMBEDDING_DIMENSION" "1024"
default_env_if_unset "EMBEDDING_DISTANCE_METRIC" "cosine"
default_env_if_unset "LLM_BASE_URL" "ignore"
default_env_if_unset "LLM_API_KEY" "ignore"
default_env_if_unset "CLASSIFIER_MODEL" "ignore"
default_env_if_unset "CLASSIFIER_TEMP" "0.0"
default_env_if_unset "RETRIEVAL_MODEL" "ignore"
default_env_if_unset "RETRIEVAL_TEMP" "0.0"
default_env_if_unset "GENERATOR_MODEL" "ignore"
default_env_if_unset "GENERATOR_TEMP" "0.0"
default_env_if_unset "QUALITY_MODEL" "ignore"
default_env_if_unset "QUALITY_TEMP" "0.0"
default_env_if_unset "DECOMPOSER_MODEL" "ignore"
default_env_if_unset "DECOMPOSER_TEMP" "0.0"
default_env_if_unset "DECOMPOSER_MAX_SUB_QUERIES" "5"
default_env_if_unset "AGGREGATOR_MODEL" "ignore"
default_env_if_unset "AGGREGATOR_TEMP" "0.0"
default_env_if_unset "CONTEXT_MAX_TOKENS" "128000"
default_env_if_unset "INSTANT_SEARCH_MAX_CONTEXT_RATIO" "0.8"
default_env_if_unset "INSTANT_SEARCH_RESERVED_TOKENS" "2000"
default_env_if_unset "INSTANT_SEARCH_MIN_SENTENCE_TOKENS" "50"
default_env_if_unset "BY_QA_MODEL_CONFIG_PROVIDER" "redis_model_config:RedisModelConfigProvider"

map_env_alias_if_unset "SERVICE_NAME" "QA_DOMAINNAME"
if [[ -n "${ROOT_HOST_VALUE-}" && -z "${HOST_MACHINE-}" ]]; then
    export "HOST_MACHINE=${ROOT_HOST_VALUE}"
fi

for var_name in \
    KB_MINIO_BUCKET \
    KB_MINIO_MARKDOWN_BUCKET \
    BYAI_REDIS_HOST \
    BYAI_REDIS_PORT \
    BYAI_REDIS_DB \
    BYAI_REDIS_USERNAME \
    BYAI_REDIS_PASSWORD
do
    map_prefixed_env "$var_name"
done

resolve_python_runner() {
    local venv_python="$SCRIPT_DIR/.venv/bin/python"
    if [[ -x "$venv_python" ]]; then
        printf '%s\n' "$venv_python"
        return 0
    fi

    printf 'uv run python\n'
}

resolve_uvicorn_runner() {
    local venv_uvicorn="$SCRIPT_DIR/.venv/bin/uvicorn"
    if [[ -x "$venv_uvicorn" ]]; then
        printf '%s\n' "$venv_uvicorn"
        return 0
    fi

    printf 'uv run uvicorn\n'
}

PYTHON_RUNNER="$(resolve_python_runner)"
UVICORN_RUNNER="$(resolve_uvicorn_runner)"

case "$MODE" in
    api)
        if [[ "$UVICORN_RUNNER" == "uv run uvicorn" ]]; then
            exec uv run uvicorn api:app --host "$HOST" --port "$PORT"
        fi
        exec "$UVICORN_RUNNER" api:app --host "$HOST" --port "$PORT"
        ;;
    worker)
        if [[ "$PYTHON_RUNNER" == "uv run python" ]]; then
            exec uv run python "$SCRIPT_DIR/worker.py"
        fi
        exec "$PYTHON_RUNNER" "$SCRIPT_DIR/worker.py"
        ;;
esac
