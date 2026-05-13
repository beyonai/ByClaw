#!/bin/bash
cd "$(dirname "$0")"

echo "========== Stopping Mono =========="
cd mono && sh stop-all.sh
cd ..

echo ""
echo "========== Stopping Middleware =========="
cd middleware && sh stop-all.sh
