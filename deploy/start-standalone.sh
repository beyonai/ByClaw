#!/bin/bash
set -e
cd "$(dirname "$0")"

# Run the same environment check even when a startup command fails.
_DEPLOY_ROOT="$(cd .. && pwd)"
finish_start() {
    _start_status=$?
    trap - EXIT
    if sh "$_DEPLOY_ROOT/deploy.sh" check; then
        exit "$_start_status"
    else
        exit 1
    fi
}
trap finish_start EXIT

if [ "$#" -gt 0 ]; then
    echo "Warning: start-standalone.sh no longer accepts storage parameters. Use .env + sh ../deploy.sh init|update."
fi

if [ "${BYCLAW_DEPLOY_INIT_NFS:-false}" = "true" ]; then
    echo "========== Initializing NFS =========="
    sh init-nfs.sh
    echo ""
fi

echo "========== Starting Middleware =========="
cd middleware && sh start-all.sh
cd ..

echo ""
echo "========== Starting Standalone =========="
cd standalone && sh start-all.sh
