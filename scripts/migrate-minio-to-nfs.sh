#!/bin/sh

# Migrate MinIO runtime buckets to the configured file/NFS volume for an env.
#
# Usage:
#   sh scripts/migrate-minio-to-nfs.sh 204
#
# The script reads envs/<env>/.env, connects to HOST over SSH, and runs an
# idempotent MinIO Client mirror:
#   - default bucket FILE_STORAGE_MINIO_BUCKET_NAME is mirrored into
#     FILE_STORAGE_LOCAL_PATH / BYCLAW_SANDBOX_FILE_VOLUME_ROOT
#   - every other business bucket is mirrored into <target-root>/<bucket-name>
# Existing target files are overwritten when the source changes. Extra files on
# the NFS side are intentionally kept, so rerunning this script is safe after
# new files have been created on the NFS volume.

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_NAME="${1:-}"

usage() {
    echo "Usage: sh scripts/migrate-minio-to-nfs.sh <env-name>"
    echo "Example: sh scripts/migrate-minio-to-nfs.sh 204"
}

if [ -z "$ENV_NAME" ]; then
    usage
    exit 1
fi

ENV_FILE="$ROOT_DIR/envs/$ENV_NAME/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: env file not found: $ENV_FILE" >&2
    exit 1
fi

set -a
. "$ENV_FILE"
set +a

REMOTE_HOST="${HOST:-}"
REMOTE_USER="${HOST_USER:-root}"
REMOTE_PASSWORD="${HOST_PASSWORD:-}"
REMOTE_DEPLOY_DIR="${DEPLOY_DIR:-}"

if [ -z "$REMOTE_HOST" ] || [ -z "$REMOTE_DEPLOY_DIR" ]; then
    echo "Error: HOST and DEPLOY_DIR must be set in $ENV_FILE." >&2
    exit 1
fi

MINIO_HOST_VALUE="${FILE_STORAGE_MINIO_HOST:-$REMOTE_HOST}"
MINIO_PORT_VALUE="${FILE_STORAGE_MINIO_API_PORT:-9000}"
MINIO_SECURE_VALUE="${FILE_STORAGE_MINIO_SECURE:-false}"
MINIO_ACCESS_KEY_VALUE="${FILE_STORAGE_MINIO_ACCESS_KEY:-}"
MINIO_SECRET_KEY_VALUE="${FILE_STORAGE_MINIO_SECRET_KEY:-}"
MINIO_BUCKET_VALUE="${FILE_STORAGE_MINIO_BUCKET_NAME:-byclaw}"
TARGET_ROOT_VALUE="${FILE_STORAGE_LOCAL_PATH:-${BYCLAW_SANDBOX_FILE_VOLUME_ROOT:-}}"
MC_IMAGE_VALUE="${BYCLAW_MINIO_MC_IMAGE:-minio/mc:latest}"

if [ -z "$MINIO_ACCESS_KEY_VALUE" ] || [ -z "$MINIO_SECRET_KEY_VALUE" ]; then
    echo "Error: FILE_STORAGE_MINIO_ACCESS_KEY and FILE_STORAGE_MINIO_SECRET_KEY must be set." >&2
    exit 1
fi

if [ -z "$TARGET_ROOT_VALUE" ]; then
    echo "Error: FILE_STORAGE_LOCAL_PATH or BYCLAW_SANDBOX_FILE_VOLUME_ROOT must be set." >&2
    exit 1
fi

case "$MINIO_SECURE_VALUE" in
    true|TRUE|1|yes|YES) MINIO_SCHEME="https" ;;
    *) MINIO_SCHEME="http" ;;
esac

MINIO_ENDPOINT_VALUE="$MINIO_SCHEME://$MINIO_HOST_VALUE:$MINIO_PORT_VALUE"

shell_quote() {
    printf "%s" "$1" | sed "s/'/'\\\\''/g; 1s/^/'/; \$s/\$/'/"
}

REMOTE="$(shell_quote "$REMOTE_USER@$REMOTE_HOST")"
REMOTE_DIR_Q="$(shell_quote "$REMOTE_DEPLOY_DIR")"

SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
if [ -n "$REMOTE_PASSWORD" ]; then
    if ! command -v sshpass >/dev/null 2>&1; then
        echo "Error: sshpass is required when HOST_PASSWORD is configured. Install sshpass or use SSH keys." >&2
        exit 1
    fi
    SSH_CMD="sshpass -p $(shell_quote "$REMOTE_PASSWORD") ssh $SSH_OPTS"
else
    SSH_CMD="ssh $SSH_OPTS"
fi

echo "==> Migrating env '$ENV_NAME' MinIO data to NFS/file volume"
echo "==> Remote: $REMOTE_USER@$REMOTE_HOST:$REMOTE_DEPLOY_DIR"
echo "==> MinIO:  $MINIO_ENDPOINT_VALUE"
echo "==> Target: $TARGET_ROOT_VALUE"

REMOTE_SCRIPT="$REMOTE_DEPLOY_DIR/scripts/remote-migrate-minio-to-nfs.sh"

eval "$SSH_CMD $REMOTE \"mkdir -p $REMOTE_DIR_Q/scripts\""

cat <<'REMOTE_EOF' | eval "$SSH_CMD $REMOTE \"cat > $(shell_quote "$REMOTE_SCRIPT") && chmod +x $(shell_quote "$REMOTE_SCRIPT")\""
#!/bin/sh
set -eu

log() {
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
    echo "Error: $*" >&2
    exit 1
}

run_mc() {
    if command -v mc >/dev/null 2>&1; then
        MC_CONFIG_DIR="$MC_CONFIG_DIR" mc "$@"
        return
    fi

    command -v docker >/dev/null 2>&1 || fail "neither mc nor docker is available on the remote host"
    docker run --rm --network host \
        -e MC_CONFIG_DIR=/root/.mc \
        -v "$MC_CONFIG_DIR:/root/.mc" \
        -v "$TARGET_ROOT:$TARGET_ROOT" \
        "$MC_IMAGE" "$@"
}

mirror_bucket_to() {
    source_bucket="$1"
    target_dir="$2"

    if ! run_mc ls "$MC_ALIAS/$source_bucket" >/dev/null 2>&1; then
        log "skip missing bucket: $source_bucket"
        return
    fi

    mkdir -p "$target_dir"
    log "mirror $MC_ALIAS/$source_bucket -> $target_dir"
    run_mc mirror --quiet --overwrite "$MC_ALIAS/$source_bucket" "$target_dir"
}

DEPLOY_DIR="${DEPLOY_DIR_VALUE}"
MINIO_ENDPOINT="${MINIO_ENDPOINT_VALUE}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY_VALUE}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY_VALUE}"
DEFAULT_BUCKET="${MINIO_BUCKET_VALUE}"
TARGET_ROOT="${TARGET_ROOT_VALUE}"
MC_IMAGE="${MC_IMAGE_VALUE}"
MC_ALIAS="byclaw-migration"
MC_CONFIG_DIR="$DEPLOY_DIR/.mc-migration-config"
LOG_DIR="$DEPLOY_DIR/migration-logs/minio-to-nfs"

[ -n "$TARGET_ROOT" ] || fail "target root is empty"
mkdir -p "$TARGET_ROOT" "$MC_CONFIG_DIR" "$LOG_DIR"

if command -v findmnt >/dev/null 2>&1; then
    if ! findmnt "$TARGET_ROOT" >/dev/null 2>&1; then
        fail "$TARGET_ROOT is not mounted; run nfs-init before migration"
    fi
fi

probe="$TARGET_ROOT/.byclaw-minio-migration-probe"
touch "$probe" || fail "cannot write to $TARGET_ROOT"
rm -f "$probe"

log_file="$LOG_DIR/migration-$(date '+%Y%m%d-%H%M%S').log"
log "migration log: $log_file"

{
    log "setting MinIO alias $MC_ALIAS -> $MINIO_ENDPOINT"
    run_mc alias set "$MC_ALIAS" "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" --api S3v4

    log "available buckets:"
    run_mc ls "$MC_ALIAS" || true

    mirror_bucket_to "$DEFAULT_BUCKET" "$TARGET_ROOT"

    buckets="$(run_mc ls "$MC_ALIAS" | awk '{print $NF}' | sed 's#/$##' || true)"
    if [ -n "$buckets" ]; then
        for bucket in $buckets; do
            if [ "$bucket" = "$DEFAULT_BUCKET" ]; then
                continue
            fi
            mirror_bucket_to "$bucket" "$TARGET_ROOT/$bucket"
        done
    fi

    log "target summary:"
    find "$TARGET_ROOT" -mindepth 1 -maxdepth 3 -type d | sort | head -200 || true
    log "migration finished"
} 2>&1 | tee "$log_file"
REMOTE_EOF

eval "$SSH_CMD $REMOTE \"DEPLOY_DIR_VALUE=$(shell_quote "$REMOTE_DEPLOY_DIR") MINIO_ENDPOINT_VALUE=$(shell_quote "$MINIO_ENDPOINT_VALUE") MINIO_ACCESS_KEY_VALUE=$(shell_quote "$MINIO_ACCESS_KEY_VALUE") MINIO_SECRET_KEY_VALUE=$(shell_quote "$MINIO_SECRET_KEY_VALUE") MINIO_BUCKET_VALUE=$(shell_quote "$MINIO_BUCKET_VALUE") TARGET_ROOT_VALUE=$(shell_quote "$TARGET_ROOT_VALUE") MC_IMAGE_VALUE=$(shell_quote "$MC_IMAGE_VALUE") sh $(shell_quote "$REMOTE_SCRIPT")\""
