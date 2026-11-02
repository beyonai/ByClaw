#!/usr/bin/env bash
# One-shot setup for a fresh checkout: install, then prove the tree is sound.
#
# Everything this line composes against comes from npm at one exact harness
# prerelease, so a clean install either reproduces the recorded lockfile or
# tells you the harness moved under you — there is no workspace checkout to
# fall back on.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v pnpm >/dev/null 2>&1; then
  echo "init: pnpm is required (corepack enable, or npm i -g pnpm)" >&2
  exit 1
fi

echo "init: installing (frozen lockfile)"
pnpm install --frozen-lockfile

echo "init: typecheck"
pnpm run typecheck

echo "init: lint"
pnpm run lint

echo "init: test"
pnpm run test || {
  cat >&2 <<'NOTE'

init: the four packages/devflow-ui client specs are a known gap, not a broken
checkout — the harness's published client packages are loader-factory bundles
rather than importable modules. See the "Known gap" section of AGENTS.md.
NOTE
  exit 1
}

echo
echo "init: ready. Start from .agents/prd/ for intent and .scratch/devflow/ for open slices."
