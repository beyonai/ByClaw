#!/bin/bash
cd "$(dirname "$0")"

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
