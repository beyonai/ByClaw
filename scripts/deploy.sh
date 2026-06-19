#!/bin/sh

# Deploy a named envs/<name> environment to its remote HOST/DEPLOY_DIR.
# Usage:
#   sh scripts/deploy.sh 204 init
#   sh scripts/deploy.sh 204 nfs-init
#   sh scripts/deploy.sh 204 update
#   sh scripts/deploy.sh 204 stop
#
# This wrapper archives the current git HEAD, uploads envs/<name>/.env as
# DEPLOY_DIR/.env, then runs the root deploy.sh on the remote host.

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_NAME="${1:-}"
ACTION="${2:-}"

usage() {
    echo "Usage: sh scripts/deploy.sh <env-name> init|nfs-init|update|stop"
    echo "Example: sh scripts/deploy.sh 204 nfs-init"
}

if [ -z "$ENV_NAME" ] || [ -z "$ACTION" ]; then
    usage
    exit 1
fi

case "$ACTION" in
    init|nfs-init|update|stop) ;;
    *)
        echo "Error: unsupported action '$ACTION'. Use init, nfs-init, update, or stop." >&2
        exit 1
        ;;
esac

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

echo "==> Deploying env '$ENV_NAME' to $REMOTE_USER@$REMOTE_HOST:$REMOTE_DEPLOY_DIR"
echo "==> Action: $ACTION"

echo "==> Preparing remote directory"
eval "$SSH_CMD $REMOTE \"mkdir -p $REMOTE_DIR_Q\""

echo "==> Uploading current git HEAD"
(
    cd "$ROOT_DIR"
    git archive --format=tar HEAD
) | eval "$SSH_CMD $REMOTE \"tar -x -C $REMOTE_DIR_Q\""

echo "==> Uploading env file as .env"
cat "$ENV_FILE" | eval "$SSH_CMD $REMOTE \"cat > $REMOTE_DIR_Q/.env\""

echo "==> Running remote deploy.sh $ACTION"
eval "$SSH_CMD $REMOTE \"cd $REMOTE_DIR_Q && sh deploy.sh $(shell_quote "$ACTION")\""
