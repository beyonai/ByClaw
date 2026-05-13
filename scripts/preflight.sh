#!/usr/bin/env bash
# Preflight environment checks for ByClaw dev runner.
# Sourced by start.sh — do not execute directly.
#
# Usage (from start.sh):
#   source "$SCRIPTS/preflight.sh"
#   run_preflight "$START_FE" "$START_BE" "$START_QA" "$START_DATA"

# --- Color helpers (respects NO_COLOR and non-TTY) ---
if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
  _C_RED='\033[0;31m'
  _C_GREEN='\033[0;32m'
  _C_YELLOW='\033[0;33m'
  _C_BOLD='\033[1m'
  _C_RESET='\033[0m'
else
  _C_RED='' _C_GREEN='' _C_YELLOW='' _C_BOLD='' _C_RESET=''
fi

_PREFLIGHT_ERRORS=()
_PREFLIGHT_WARNINGS=()

_check_pass() { printf "  ${_C_GREEN}✓${_C_RESET} %s\n" "$1"; }
_check_fail() {
  printf "  ${_C_RED}✗${_C_RESET} %s\n" "$1"
  _PREFLIGHT_ERRORS+=("$1")
}
_check_warn() {
  printf "  ${_C_YELLOW}!${_C_RESET} %s\n" "$1"
  _PREFLIGHT_WARNINGS+=("$1")
}
_section() { printf "\n${_C_BOLD}[preflight]${_C_RESET} %s\n" "$1"; }

# --- Version comparison: returns 0 if $1 >= $2 ---
_version_gte() {
  local IFS=.
  local i ver1=($1) ver2=($2)
  for ((i = 0; i < ${#ver2[@]}; i++)); do
    local v1="${ver1[i]:-0}"
    local v2="${ver2[i]:-0}"
    if ((v1 > v2)); then return 0; fi
    if ((v1 < v2)); then return 1; fi
  done
  return 0
}

# --- Resolve python command (python3 preferred, fallback to python) ---
_PYTHON_CMD=""
_resolve_python() {
  if command -v python3 >/dev/null 2>&1; then
    _PYTHON_CMD="python3"
  elif command -v python >/dev/null 2>&1; then
    _PYTHON_CMD="python"
  fi
}

# --- Individual check functions ---

_PYTHON_CHECKED=0

_check_env_file() {
  local start_be="$1"
  if [[ ! -f "$ROOT/.env" ]]; then
    if [[ $start_be -eq 1 ]]; then
      _check_fail ".env file missing (required by backend). Run: cp .env.example .env"
    else
      _check_warn ".env file missing. Some modules may need it. Run: cp .env.example .env"
    fi
  else
    _check_pass ".env file present"
  fi
}

_check_frontend() {
  # Node.js
  if ! command -v node >/dev/null 2>&1; then
    _check_fail "Node.js not found. Install Node.js >= 18.20: https://nodejs.org/"
  else
    local node_ver
    node_ver="$(node --version 2>/dev/null | sed 's/^v//')"
    if _version_gte "$node_ver" "18.20.0"; then
      _check_pass "Node.js ${node_ver} (>= 18.20)"
    else
      _check_fail "Node.js ${node_ver} is too old. Required >= 18.20. Update: https://nodejs.org/"
    fi
  fi

  # pnpm
  if ! command -v pnpm >/dev/null 2>&1; then
    _check_fail "pnpm not found. Install: corepack enable && corepack prepare pnpm@9 --activate"
  else
    local pnpm_ver pnpm_major
    pnpm_ver="$(pnpm --version 2>/dev/null)"
    pnpm_major="${pnpm_ver%%.*}"
    if [[ "$pnpm_major" -ge 9 ]]; then
      _check_pass "pnpm ${pnpm_ver} (>= 9.x required)"
    else
      _check_fail "pnpm ${pnpm_ver} — version 9.x or higher required. Run: corepack prepare pnpm@9 --activate"
    fi
  fi

  # node_modules
  if [[ ! -d "$ROOT/byclaw-fe/node_modules" ]]; then
    _check_warn "node_modules missing. Will auto-install before starting."
    _FE_NEEDS_INSTALL=1
  else
    _check_pass "node_modules installed"
  fi
}

_check_backend() {
  # Java
  if ! command -v java >/dev/null 2>&1; then
    _check_fail "Java not found. Install JDK 21: https://adoptium.net/"
  else
    local java_ver
    java_ver="$(java -version 2>&1 | head -1 | grep -oE '"[^"]+"' | tr -d '"' | cut -d. -f1)"
    if [[ "$java_ver" == "21" ]]; then
      _check_pass "Java ${java_ver} (JDK 21 required)"
    else
      _check_fail "Java ${java_ver} — JDK 21 required. Install: https://adoptium.net/"
    fi
  fi

  # Maven
  if ! command -v mvn >/dev/null 2>&1; then
    _check_fail "Maven not found. Install Maven >= 3.8: https://maven.apache.org/download.cgi"
  else
    local mvn_ver
    mvn_ver="$(mvn --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
    if _version_gte "$mvn_ver" "3.8.0"; then
      _check_pass "Maven ${mvn_ver} (>= 3.8)"
    else
      _check_fail "Maven ${mvn_ver} is too old. Required >= 3.8. Update: https://maven.apache.org/download.cgi"
    fi
  fi

  # pom.xml
  if [[ -f "$ROOT/byclaw-be/pom.xml" ]]; then
    _check_pass "byclaw-be/pom.xml present"
  else
    _check_fail "byclaw-be/pom.xml missing. Is the backend module initialized?"
  fi
}

_check_python_uv() {
  [[ $_PYTHON_CHECKED -eq 1 ]] && return
  _PYTHON_CHECKED=1

  # Python
  _resolve_python
  if [[ -z "$_PYTHON_CMD" ]]; then
    _check_fail "Python not found. Install Python >= 3.12: https://www.python.org/downloads/"
  else
    local py_ver
    py_ver="$($_PYTHON_CMD --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
    if _version_gte "$py_ver" "3.12.0"; then
      _check_pass "Python ${py_ver} (>= 3.12) [${_PYTHON_CMD}]"
    else
      _check_fail "Python ${py_ver} is too old. Required >= 3.12. Update: https://www.python.org/downloads/"
    fi
  fi

  # uv
  if ! command -v uv >/dev/null 2>&1; then
    _check_fail "uv not found. Install: curl -LsSf https://astral.sh/uv/install.sh | sh"
  else
    local uv_ver
    uv_ver="$(uv --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
    _check_pass "uv ${uv_ver}"
  fi
}

_check_qa() {
  _check_python_uv

  if [[ -f "$ROOT/byclaw-qa/start.sh" ]]; then
    _check_pass "byclaw-qa/start.sh present"
  else
    _check_fail "byclaw-qa/start.sh missing. Is the QA module initialized?"
  fi
}

_check_data() {
  _check_python_uv

  if [[ -f "$ROOT/byclaw-data/start.sh" ]]; then
    _check_pass "byclaw-data/start.sh present"
  else
    _check_fail "byclaw-data/start.sh missing. Is the data module initialized?"
  fi
}

# --- Auto-install frontend dependencies ---
_auto_install_fe() {
  printf "\n${_C_BOLD}[preflight]${_C_RESET} Installing frontend dependencies...\n"
  echo "  Running: pnpm install --frozen-lockfile"
  echo ""
  if (cd "$ROOT/byclaw-fe" && pnpm install --frozen-lockfile); then
    printf "\n  ${_C_GREEN}✓${_C_RESET} Dependencies installed successfully.\n"
  else
    echo ""
    echo "  Frozen lockfile failed, retrying without --frozen-lockfile..."
    echo ""
    if (cd "$ROOT/byclaw-fe" && pnpm install --no-frozen-lockfile); then
      printf "\n  ${_C_GREEN}✓${_C_RESET} Dependencies installed successfully.\n"
    else
      _PREFLIGHT_ERRORS+=("Failed to install frontend dependencies. Run manually: cd byclaw-fe && pnpm install")
      return 1
    fi
  fi
}

# --- Main entry point ---
run_preflight() {
  local start_fe="$1" start_be="$2" start_qa="$3" start_data="$4"

  _PREFLIGHT_ERRORS=()
  _PREFLIGHT_WARNINGS=()
  _PYTHON_CHECKED=0
  _FE_NEEDS_INSTALL=0

  _section "Checking environment..."
  _check_env_file "$start_be"

  if [[ $start_fe -eq 1 ]]; then
    _section "Frontend (byclaw-fe)"
    _check_frontend
  fi

  if [[ $start_be -eq 1 ]]; then
    _section "Backend (byclaw-be)"
    _check_backend
  fi

  if [[ $start_qa -eq 1 ]]; then
    _section "QA (byclaw-qa)"
    _check_qa
  fi

  if [[ $start_data -eq 1 ]]; then
    _section "Data (byclaw-data)"
    _check_data
  fi

  echo ""

  # Report results
  if [[ ${#_PREFLIGHT_ERRORS[@]} -gt 0 ]]; then
    printf "${_C_RED}${_C_BOLD}[preflight] %d problem(s) found:${_C_RESET}\n" "${#_PREFLIGHT_ERRORS[@]}"
    for err in "${_PREFLIGHT_ERRORS[@]}"; do
      printf "  ${_C_RED}•${_C_RESET} %s\n" "$err"
    done
    echo ""
    echo "Fix the issues above, or use --skip-checks to bypass."
    exit 1
  fi

  # Auto-install frontend deps if needed (only after all checks pass)
  if [[ $_FE_NEEDS_INSTALL -eq 1 ]]; then
    _auto_install_fe || exit 1
  fi

  printf "${_C_GREEN}[preflight] All checks passed.${_C_RESET}\n\n"
}
