#!/bin/sh
set -eu
export SEARXNG_CLI_SETTINGS="${SEARXNG_CLI_SETTINGS:-/opt/searxng-cli/searxng_pack_settings.yml}"
# SearXNG places SQLite engine caches in Python's temporary directory. Keep
# those files private to this user, including when root runs a diagnostic.
umask 077
TMPDIR="${XDG_CACHE_HOME:-${HOME:?HOME must be set}/.cache}/byclaw/searxng/$(id -u)"
mkdir -p "$TMPDIR"
chmod 700 "$TMPDIR"
export TMPDIR
exec /opt/searxng-cli-venv/bin/python /opt/searxng-cli/runtime.py "$@"
