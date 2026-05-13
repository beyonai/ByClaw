#!/bin/bash
cd "$(dirname "$0")"

echo "========== Starting Middleware =========="
cd middleware && sh start-all.sh
cd ..

echo ""
echo "========== Starting Standalone =========="
cd standalone && sh start-all.sh
