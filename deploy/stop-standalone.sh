#!/bin/bash
cd "$(dirname "$0")"

echo "========== Stopping Standalone =========="
cd standalone && sh stop-all.sh
cd ..

echo ""
echo "========== Stopping Middleware =========="
cd middleware && sh stop-all.sh
