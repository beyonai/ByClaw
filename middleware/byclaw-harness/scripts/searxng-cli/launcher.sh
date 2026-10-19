#!/bin/sh
set -eu
export SEARXNG_CLI_SETTINGS="${SEARXNG_CLI_SETTINGS:-/opt/searxng-cli/searxng_pack_settings.yml}"
exec /opt/searxng-cli-venv/bin/searxng-cli "$@"
