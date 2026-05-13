#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

load_nvm_if_available() {
  if command -v nvm >/dev/null 2>&1; then
    return 0
  fi

  nvm_dir=${NVM_DIR:-"$HOME/.nvm"}
  if [ -s "$nvm_dir/nvm.sh" ]; then
    # shellcheck source=/dev/null
    . "$nvm_dir/nvm.sh"
    return 0
  fi

  if [ -s "/opt/homebrew/opt/nvm/nvm.sh" ]; then
    # shellcheck source=/dev/null
    . "/opt/homebrew/opt/nvm/nvm.sh"
    return 0
  fi

  if [ -s "/usr/local/opt/nvm/nvm.sh" ]; then
    # shellcheck source=/dev/null
    . "/usr/local/opt/nvm/nvm.sh"
    return 0
  fi

  return 1
}

ensure_node_installed() {
  if command -v node >/dev/null 2>&1; then
    log "Detected Node.js $(node --version)"
    if command -v npm >/dev/null 2>&1; then
      log "Detected npm $(npm --version)"
    else
      fail "Node.js is present but npm is missing."
    fi
    return 0
  fi

  log "Node.js not found. Attempting automatic installation."

  if command -v brew >/dev/null 2>&1; then
    log "Installing Node.js with Homebrew."
    brew install node || fail "Failed to install Node.js with Homebrew."
  elif load_nvm_if_available; then
    log "Installing Node.js LTS with nvm."
    nvm install --lts || fail "Failed to install Node.js with nvm."
    nvm use --lts || fail "Failed to activate Node.js installed by nvm."
  elif command -v fnm >/dev/null 2>&1; then
    log "Installing Node.js LTS with fnm."
    fnm install --lts || fail "Failed to install Node.js with fnm."
    fnm use lts-latest || fail "Failed to activate Node.js installed by fnm."
  elif command -v volta >/dev/null 2>&1; then
    log "Installing Node.js with Volta."
    volta install node || fail "Failed to install Node.js with Volta."
  else
    fail "Node.js is not installed and no supported installer was found. Please install Homebrew, nvm, fnm, or Volta first."
  fi

  command -v node >/dev/null 2>&1 || fail "Node.js installation completed but 'node' is still unavailable."
  command -v npm >/dev/null 2>&1 || fail "Node.js installation completed but 'npm' is still unavailable."

  log "Node.js installation successful: $(node --version)"
  log "npm is ready: $(npm --version)"
}

should_run_build() {
  package_json=$1

  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    const extensions = (((pkg || {}).openclaw || {}).extensions || []);
    const shouldBuild = Array.isArray(extensions) && extensions.some((item) => (
      typeof item === "string" && item.indexOf("./dist") === 0
    ));
    process.exit(shouldBuild ? 0 : 1);
  ' "$package_json"
}

install_plugins() {
  plugin_count=0

  for dir in "$ROOT_DIR"/*; do
    [ -d "$dir" ] || continue
    [ -f "$dir/package.json" ] || continue

    plugin_count=$((plugin_count + 1))
  done

  if [ "$plugin_count" -eq 0 ]; then
    fail "No plugin directories with package.json were found under $ROOT_DIR."
  fi

  log "Found $plugin_count plugin(s) to install."

  for dir in "$ROOT_DIR"/*; do
    [ -d "$dir" ] || continue
    [ -f "$dir/package.json" ] || continue

    log "Running npm install in $(basename "$dir")"
    (
      cd "$dir" || exit 1
      npm install
    ) || fail "npm install failed in $dir"
    log "npm install succeeded in $(basename "$dir")"

    if should_run_build "$dir/package.json"; then
      log "Detected dist-based openclaw.extensions in $(basename "$dir"), running npm run build"
      (
        cd "$dir" || exit 1
        npm run build
      ) || fail "npm run build failed in $dir"
      log "npm run build succeeded in $(basename "$dir")"
    else
      log "No dist-based openclaw.extensions in $(basename "$dir"), skipping build"
    fi
  done
}

main() {
  log "Starting extension dependency installation from $ROOT_DIR"
  ensure_node_installed
  install_plugins
  log "All plugin dependencies installed successfully."
}

main "$@"
