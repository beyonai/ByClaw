#!/bin/sh
set -eu

case "${1:-}" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *Password*) printf '%s\n' "${BYCLAW_GITHUB_TOKEN:?}" ;;
  *) exit 1 ;;
esac
