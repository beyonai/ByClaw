#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

# The supervisor must not create one shared :99 desktop. Browserd owns the
# per-session Xvfb/x11vnc/websockify lifecycle through SessionDesktopManager.
! grep -F -- '--desktop-command' scripts/byclaw-browser-supervisor.py
! grep -F -- 'byclaw-browser-desktop' Dockerfile
! grep -F -- 'DISPLAY=:99' Dockerfile
grep -F "new SessionDesktopManager" plugins/dsh-browser-use/src/browserd.ts >/dev/null
grep -F "startViewerGateway" plugins/dsh-browser-use/src/browserd.ts >/dev/null
grep -F "'-localhost'" plugins/dsh-browser-use/src/session-desktop-manager.ts >/dev/null
grep -F "'127.0.0.1'" plugins/dsh-browser-use/src/session-desktop-manager.ts >/dev/null
grep -F "sessionId" browser/novnc-index.html >/dev/null

printf '%s\n' 'per-session browser desktop verification passed'
