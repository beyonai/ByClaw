#!/bin/bash
cd "$(dirname "$0")"

echo "========== Starting Middleware =========="
cd middleware && sh start-all.sh
cd ..

echo ""
echo "========== Starting Mono =========="
cd mono && sh start-all.sh
