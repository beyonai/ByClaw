#!/bin/sh
# Install the pinned, no-key online-search fallback in an image or existing sandbox.
set -eu
settings=${1:?usage: install-search-runtime.sh SETTINGS CONSTRAINTS}
constraints=${2:?usage: install-search-runtime.sh SETTINGS CONSTRAINTS}
python3 -m venv /opt/searxng-cli-venv
if [ -n "${SEARXNG_WHEELHOUSE:-}" ]; then
    /opt/searxng-cli-venv/bin/python -m pip install --no-index \
        --find-links "$SEARXNG_WHEELHOUSE" --constraint "$constraints" 'searxng-cli==0.1.0'
else
    /opt/searxng-cli-venv/bin/python -m pip install --no-cache-dir --timeout 20 --retries 2 \
        --index-url https://pypi.tuna.tsinghua.edu.cn/simple \
        --extra-index-url https://pypi.org/simple \
        --constraint "$constraints" 'searxng-cli==0.1.0'
fi
mkdir -p /opt/searxng-cli
cp "$settings" /opt/searxng-cli/searxng_pack_settings.yml
install -m 755 "$(dirname "$0")/searxng-cli/launcher.sh" /usr/local/bin/byclaw-searxng-cli
ln -sf /usr/local/bin/byclaw-searxng-cli /usr/local/bin/searxng-cli
SEARXNG_CLI_SETTINGS=/opt/searxng-cli/searxng_pack_settings.yml \
    searxng-cli --list-engines >/dev/null
