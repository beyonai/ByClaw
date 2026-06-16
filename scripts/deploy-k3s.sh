#!/bin/sh
# 远程一键部署 K3s 环境（仿 scripts/deploy.sh）
# Usage:
#   sh scripts/deploy-k3s.sh byclaw init
#   sh scripts/deploy-k3s.sh byclaw storage-init
#   sh scripts/deploy-k3s.sh byclaw monitoring-init
#   sh scripts/deploy-k3s.sh byclaw update
#   sh scripts/deploy-k3s.sh byclaw stop
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_NAME="${1:-}"
ACTION="${2:-}"

usage() {
    echo "Usage: sh scripts/deploy-k3s.sh <env-name> init|storage-init|monitoring-init|update|stop"
    echo "Example: sh scripts/deploy-k3s.sh byclaw init"
}

if [ -z "$ENV_NAME" ] || [ -z "$ACTION" ]; then
    usage
    exit 1
fi

case "$ACTION" in
    init|storage-init|monitoring-init|update|stop) ;;
    *)
        echo "Error: unsupported action '$ACTION'. Use init, storage-init, update, or stop." >&2
        exit 1
        ;;
esac

K3S_ENV_LOCAL="$ROOT_DIR/envs/$ENV_NAME/env.k3s"
if [ ! -f "$K3S_ENV_LOCAL" ]; then
    echo "Error: k3s env file not found: $K3S_ENV_LOCAL" >&2
    exit 1
fi

set -a
. "$K3S_ENV_LOCAL"
if [ -f "$ROOT_DIR/envs/$ENV_NAME/.env" ]; then
    # Optional remote-only overrides, such as HOST_PASSWORD or DEPLOY_DIR.
    . "$ROOT_DIR/envs/$ENV_NAME/.env"
fi
set +a

REMOTE_HOST="${K3S_REMOTE_HOST:-${K3S_API_HOST:-${HOST:-}}}"
REMOTE_USER="${K3S_REMOTE_USER:-${K3S_SSH_USER:-${HOST_USER:-root}}}"
REMOTE_PORT="${K3S_REMOTE_PORT:-${K3S_SSH_PORT:-${HOST_PORT:-22}}}"
REMOTE_PASSWORD="${K3S_REMOTE_PASSWORD:-${K3S_SSH_PASSWORD:-${HOST_PASSWORD:-}}}"
REMOTE_DEPLOY_DIR="${K3S_REMOTE_DEPLOY_DIR:-${DEPLOY_DIR:-/data/byclaw/${ENV_NAME}-k3s}}"

if [ -z "$REMOTE_HOST" ] || [ -z "$REMOTE_DEPLOY_DIR" ]; then
    echo "Error: K3S_API_HOST or HOST must be set in $K3S_ENV_LOCAL." >&2
    exit 1
fi

shell_quote() {
    printf "%s" "$1" | sed "s/'/'\\\\''/g; 1s/^/'/; \$s/\$/'/"
}

log_step() {
    printf "\n[%s] %s\n" "$(date '+%H:%M:%S')" "$*"
}

REMOTE="$(shell_quote "$REMOTE_USER@$REMOTE_HOST")"
REMOTE_DIR_Q="$(shell_quote "$REMOTE_DEPLOY_DIR")"

prompt_password() {
    if [ -n "$REMOTE_PASSWORD" ]; then
        return 0
    fi
    printf "Password for %s@%s and k3s nodes: " "$REMOTE_USER" "$REMOTE_HOST" >&2
    stty -echo
    IFS= read -r REMOTE_PASSWORD
    stty echo
    printf "\n" >&2
}

SSH_OPTS="-o StrictHostKeyChecking=no -p $REMOTE_PORT"
prompt_password
if [ -n "$REMOTE_PASSWORD" ]; then
    if ! command -v sshpass >/dev/null 2>&1; then
        echo "Error: sshpass is required for one-time password deploy. Install sshpass or use SSH keys." >&2
        exit 1
    fi
    REMOTE_PASSWORD_Q="$(shell_quote "$REMOTE_PASSWORD")"
    SSH_CMD="SSHPASS=$REMOTE_PASSWORD_Q sshpass -e ssh $SSH_OPTS"
else
    SSH_CMD="ssh $SSH_OPTS"
fi

log_step "K3s deploy env '$ENV_NAME' to $REMOTE_USER@$REMOTE_HOST:$REMOTE_DEPLOY_DIR"
echo "    action: $ACTION"
echo "    k3s join url: ${K3S_JOIN_URL:-https://${K3S_API_HOST}:6443}"
echo "    server hosts: ${K3S_SERVER_HOSTS:-}"
echo "    agent hosts: ${K3S_AGENT_HOSTS:-}"
echo "    internal IP map: ${K3S_NODE_INTERNAL_IPS:-<empty>}"
echo "    ssh port: $REMOTE_PORT"

log_step "1/6 Prepare remote deploy directory"
eval "$SSH_CMD $REMOTE \"mkdir -p $REMOTE_DIR_Q\""
if [ "${BYCLAW_K3S_CLEAN_STALE_PROCESSES:-true}" = "true" ]; then
    echo "    cleaning stale deploy/install processes and /tmp k3s artifacts from interrupted runs"
    eval "$SSH_CMD $REMOTE \"pids=\\\$(pgrep -f 'deploy/k3s/deploy.sh init|deploy/k3s/install-k3s.sh|/tmp/k3s-install.*/k3s|/var/tmp/k3s-install.*/k3s|sh -s - server|sh -s - agent' || true); if [ -n \\\"\\\$pids\\\" ]; then echo \\\"    stale pids: \\\$pids\\\"; for pid in \\\$pids; do [ \\\"\\\$pid\\\" = \\\"\\\$\\$\\\" ] || kill -TERM \\\"\\\$pid\\\" 2>/dev/null || true; done; sleep 2; for pid in \\\$pids; do [ \\\"\\\$pid\\\" = \\\"\\\$\\$\\\" ] || kill -KILL \\\"\\\$pid\\\" 2>/dev/null || true; done; else echo '    stale pids: none'; fi; sleep 1; artifact_list=\\\$(mktemp); find /tmp /var/tmp -maxdepth 1 \\\\( -type d -name 'k3s-install.*' -o -type f \\\\( -name 'k3s' -o -name 'k3s.bin' -o -name 'k3s.hash' -o -name 'k3s-airgap-images*.tar' -o -name 'k3s-airgap-images*.tar.gz' -o -name 'k3s-airgap-images*.tar.zst' -o -name 'k3s-images*.txt' \\\\) \\\\) -print >\\\"\\\$artifact_list\\\" 2>/dev/null || true; artifact_count=0; while IFS= read -r path; do [ -n \\\"\\\$path\\\" ] || continue; echo \\\"    remove stale install artifact: \\\$path\\\"; rm -rf \\\"\\\$path\\\"; artifact_count=\\\$((artifact_count + 1)); done <\\\"\\\$artifact_list\\\"; rm -f \\\"\\\$artifact_list\\\"; if [ \\\"\\\$artifact_count\\\" -eq 0 ]; then echo '    stale k3s install artifacts: none'; else echo \\\"    stale k3s install artifacts removed: \\\$artifact_count\\\"; fi\""
fi
eval "$SSH_CMD $REMOTE \"rm -rf $REMOTE_DIR_Q/deploy/k3s $REMOTE_DIR_Q/deploy/config $REMOTE_DIR_Q/deploy/middleware && mkdir -p $REMOTE_DIR_Q/deploy\""

log_step "2/6 Upload deploy/k3s toolkit, deploy/config, and middleware initdb"
(
    cd "$ROOT_DIR"
    COPYFILE_DISABLE=1 tar --no-xattrs \
        --exclude './deploy/k3s/env.k3s' \
        --exclude './deploy/k3s/generated' \
        -cf - ./deploy/k3s ./deploy/config ./deploy/middleware/initdb
) | eval "$SSH_CMD $REMOTE \"tar -x -C $REMOTE_DIR_Q\""
echo "    uploaded: deploy/k3s, deploy/config, deploy/middleware/initdb"

log_step "3/6 Write remote deploy metadata"
printf "HOST=%s\nHOST_USER=%s\nHOST_PORT=%s\nDEPLOY_DIR=%s\n" \
    "$REMOTE_HOST" "$REMOTE_USER" "$REMOTE_PORT" "$REMOTE_DEPLOY_DIR" |
    eval "$SSH_CMD $REMOTE \"cat > $REMOTE_DIR_Q/.env\""

log_step "4/6 Sync envs/$ENV_NAME/env.k3s to remote deploy/k3s/env.k3s"
K3S_REMOTE_PASSWORD_Q="$(shell_quote "$REMOTE_PASSWORD")"
awk -v password="$K3S_REMOTE_PASSWORD_Q" '
    /^K3S_SSH_PASSWORD=/ {
        print "K3S_SSH_PASSWORD=" password
        seen = 1
        next
    }
    /^K3S_SERVER_PASSWORD=/ {
        print "K3S_SERVER_PASSWORD=${K3S_SSH_PASSWORD}"
        next
    }
    { print }
    END {
        if (!seen) {
            print "K3S_SSH_PASSWORD=" password
        }
    }
' "$K3S_ENV_LOCAL" | eval "$SSH_CMD $REMOTE \"cat > $REMOTE_DIR_Q/deploy/k3s/env.k3s\""

if [ -n "$REMOTE_PASSWORD" ]; then
    log_step "5/6 Ensure sshpass exists on remote deploy host"
    eval "$SSH_CMD $REMOTE \"export LC_ALL=C LANG=C DEBIAN_FRONTEND=noninteractive; if ! command -v sshpass >/dev/null 2>&1; then if command -v apt-get >/dev/null 2>&1; then apt-get update -y && apt-get install -y sshpass; elif command -v yum >/dev/null 2>&1; then yum install -y sshpass; elif command -v dnf >/dev/null 2>&1; then dnf install -y sshpass; else echo 'Error: cannot install sshpass automatically on remote host.' >&2; exit 1; fi; fi\""
else
    log_step "5/6 Skip remote sshpass check because password is empty"
fi

log_step "6/6 Run remote K3s deploy action '$ACTION'"
eval "$SSH_CMD $REMOTE \"cd $REMOTE_DIR_Q && mkdir -p .bin && cat > .bin/kubectl <<'EOF'
#!/bin/sh
if command -v k3s >/dev/null 2>&1; then
  exec sudo K3S_DATA_DIR=\\\"\\\${K3S_DATA_DIR:-/data/rancher/k3s}\\\" k3s kubectl \\\"\\\$@\\\"
fi
if [ -x /usr/local/bin/kubectl ]; then
  exec /usr/local/bin/kubectl \\\"\\\$@\\\"
fi
if [ -x /usr/bin/kubectl ]; then
  exec /usr/bin/kubectl \\\"\\\$@\\\"
fi
echo 'Error: kubectl is not available and k3s is not installed yet.' >&2
exit 127
EOF
chmod +x .bin/kubectl && PATH=\\\"\\\$PWD/.bin:\\\$PATH\\\" K3S_ENV_FILE=deploy/k3s/env.k3s sh deploy/k3s/deploy.sh $(shell_quote "$ACTION")\""
