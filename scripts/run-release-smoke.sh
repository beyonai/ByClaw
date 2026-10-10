#!/bin/sh
# Optional trusted local configuration files are sourced without logging secrets.
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ -n "${BYCLAW_SMOKE_CONFIG_FILE:-}" ]; then
    set -a
    . "$BYCLAW_SMOKE_CONFIG_FILE"
    set +a
fi
LOCAL_NOTIFY_CONFIG="$SCRIPT_DIR/../tests/integration/release-smoke/.env.notify.local"
if [ -z "${BYCLAW_SMOKE_NOTIFY_CONFIG:-}" ] && [ -z "${BYCLAW_SMOKE_DINGTALK_WEBHOOK_URL:-}" ] && [ -f "$LOCAL_NOTIFY_CONFIG" ]; then
    BYCLAW_SMOKE_NOTIFY_CONFIG="$LOCAL_NOTIFY_CONFIG"
fi
if [ -n "${BYCLAW_SMOKE_NOTIFY_CONFIG:-}" ]; then
    # Source trusted shell configuration in isolated subshells; export only
    # the notification settings, never database or deployment credentials.
    BYCLAW_SMOKE_DINGTALK_WEBHOOK_URL=$(
        set +u
        . "$BYCLAW_SMOKE_NOTIFY_CONFIG" >/dev/null
        printf '%s' "${BYCLAW_SMOKE_DINGTALK_WEBHOOK_URL:-}"
    )
    BYCLAW_SMOKE_DINGTALK_SECRET=$(
        set +u
        . "$BYCLAW_SMOKE_NOTIFY_CONFIG" >/dev/null
        printf '%s' "${BYCLAW_SMOKE_DINGTALK_SECRET:-}"
    )
    BYCLAW_SMOKE_DINGTALK_GROUP=$(
        set +u
        . "$BYCLAW_SMOKE_NOTIFY_CONFIG" >/dev/null
        printf '%s' "${BYCLAW_SMOKE_DINGTALK_GROUP:-}"
    )
    export BYCLAW_SMOKE_DINGTALK_WEBHOOK_URL BYCLAW_SMOKE_DINGTALK_SECRET BYCLAW_SMOKE_DINGTALK_GROUP
fi
exec node "$SCRIPT_DIR/../tests/integration/release-smoke/run.mjs" "$@"
