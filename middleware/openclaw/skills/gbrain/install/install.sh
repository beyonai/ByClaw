#!/bin/sh
set -eu

: "${OPENCLAW_STATE_DIR:=${HOME}/.openclaw}"
: "${BUN_INSTALL:=/opt/bun}"

DEFAULT_GLOBAL_DIR="${OPENCLAW_STATE_DIR}/gbrain/install/global"
DEFAULT_BIN_DIR="${OPENCLAW_STATE_DIR}/gbrain/bin"
DEFAULT_DATA_DIR="${OPENCLAW_STATE_DIR}/gbrain/data"

if [ "${OPENCLAW_STATE_DIR}" != "${OPENCLAW_STATE_DIR}" ]; then
  [ "${BUN_INSTALL_GLOBAL_DIR:-}" = "${DEFAULT_GLOBAL_DIR}" ] && unset BUN_INSTALL_GLOBAL_DIR
  [ "${BUN_INSTALL_BIN:-}" = "${DEFAULT_BIN_DIR}" ] && unset BUN_INSTALL_BIN
  [ "${GBRAIN_HOME:-}" = "${DEFAULT_DATA_DIR}" ] && unset GBRAIN_HOME
fi

export BUN_INSTALL
export BUN_INSTALL_GLOBAL_DIR="${BUN_INSTALL_GLOBAL_DIR:-${OPENCLAW_STATE_DIR}/gbrain/install/global}"
export BUN_INSTALL_BIN="${BUN_INSTALL_BIN:-${OPENCLAW_STATE_DIR}/gbrain/bin}"
export GBRAIN_HOME="${GBRAIN_HOME:-${OPENCLAW_STATE_DIR}/gbrain/data}"
export PATH="${BUN_INSTALL_BIN}:${BUN_INSTALL}/bin:${PATH}"

mkdir -p "${BUN_INSTALL_BIN}" "${BUN_INSTALL_GLOBAL_DIR}" "${GBRAIN_HOME}"

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
fi

if [ ! -x "${BUN_INSTALL_BIN}/gbrain" ]; then
  bun install -g github:garrytan/gbrain
fi

cat > /usr/local/bin/gbrain <<'EOF'
#!/bin/sh
set -eu

: "${OPENCLAW_STATE_DIR:=${HOME}/.openclaw}"
: "${BUN_INSTALL:=/opt/bun}"

OPENCLAW_STATE_DIR="/root/.openclaw"
DEFAULT_GLOBAL_DIR="${OPENCLAW_STATE_DIR}/gbrain/install/global"
DEFAULT_BIN_DIR="${OPENCLAW_STATE_DIR}/gbrain/bin"
DEFAULT_DATA_DIR="${OPENCLAW_STATE_DIR}/gbrain/data"

if [ "${OPENCLAW_STATE_DIR}" != "${OPENCLAW_STATE_DIR}" ]; then
  [ "${BUN_INSTALL_GLOBAL_DIR:-}" = "${DEFAULT_GLOBAL_DIR}" ] && unset BUN_INSTALL_GLOBAL_DIR
  [ "${BUN_INSTALL_BIN:-}" = "${DEFAULT_BIN_DIR}" ] && unset BUN_INSTALL_BIN
  [ "${GBRAIN_HOME:-}" = "${DEFAULT_DATA_DIR}" ] && unset GBRAIN_HOME
fi

export BUN_INSTALL
export BUN_INSTALL_GLOBAL_DIR="${BUN_INSTALL_GLOBAL_DIR:-${OPENCLAW_STATE_DIR}/gbrain/install/global}"
export BUN_INSTALL_BIN="${BUN_INSTALL_BIN:-${OPENCLAW_STATE_DIR}/gbrain/bin}"
export GBRAIN_HOME="${GBRAIN_HOME:-${OPENCLAW_STATE_DIR}/gbrain/data}"
export PATH="${BUN_INSTALL_BIN}:${BUN_INSTALL}/bin:${PATH}"

mkdir -p "${BUN_INSTALL_BIN}" "${BUN_INSTALL_GLOBAL_DIR}" "${GBRAIN_HOME}"

if [ ! -x "${BUN_INSTALL_BIN}/gbrain" ]; then
  bun install -g github:garrytan/gbrain >&2
fi

exec "${BUN_INSTALL_BIN}/gbrain" "$@"
EOF

chmod +x /usr/local/bin/gbrain
gbrain --version
