#!/bin/sh
# Render an opt-in block. All environment values are validated before insertion.
set -eu
domain="${NGINX_APP_PREVIEW_DOMAIN:-}"
if [ -z "$domain" ]; then
    printf '    location /sandbox-apps/ { return 404; }\n'
    exit 0
fi
case "$domain" in *[!a-z0-9.-]*) echo 'Invalid NGINX_APP_PREVIEW_DOMAIN' >&2; exit 1;; esac
if [ "${#domain}" -gt 253 ] || ! printf '%s\n' "$domain" | LC_ALL=C grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'; then
    echo 'Invalid NGINX_APP_PREVIEW_DOMAIN: expected a lowercase DNS suffix' >&2
    exit 1
fi
port="${NGINX_APP_PREVIEW_PORT:-8082}"
case "$port" in ''|*[!0-9]*) echo 'Invalid NGINX_APP_PREVIEW_PORT' >&2; exit 1;; esac
if [ "${#port}" -gt 5 ] || [ "$port" -lt 1024 ] || [ "$port" -gt 65535 ]; then
    echo 'Invalid NGINX_APP_PREVIEW_PORT: expected 1024..65535' >&2
    exit 1
fi
dns="${NGINX_APP_PREVIEW_DNS:-}"
if [ -z "$dns" ]; then
    if [ "$(uname)" = Darwin ] && command -v podman >/dev/null 2>&1; then
        dns="$(podman network inspect podman --format '{{(index .Subnets 0).Gateway}}' 2>/dev/null | sed -n '1p')"
        dns="${dns:-10.89.0.1}"
    else
        dns=127.0.0.11
    fi
fi
if ! printf '%s\n' "$dns" | LC_ALL=C awk -F. '
    NF != 4 { exit 1 }
    { for (i=1;i<=4;i++) if ($i !~ /^[0-9]+$/ || length($i)>3 || $i+0>255) exit 1 }
    END { if (NR != 1) exit 1 }'; then
    echo 'Invalid NGINX_APP_PREVIEW_DNS: expected one IPv4 resolver address' >&2
    exit 1
fi
sed -e "s|{{APP_PREVIEW_DOMAIN}}|$domain|g" \
    -e "s|{{APP_PREVIEW_PORT}}|$port|g" \
    -e "s|{{APP_PREVIEW_DNS}}|$dns|g" \
    "$(dirname "$0")/nginx-app-preview.conf.tpl"
