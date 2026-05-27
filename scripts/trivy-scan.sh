#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEVERITY="${SEVERITY:-CRITICAL,HIGH}"
FORMAT="${FORMAT:-table}"
SCANNERS="${SCANNERS:-vuln,secret,misconfig}"
TARGET="${1:-$REPO_ROOT}"

if ! command -v trivy &>/dev/null; then
  echo "trivy not found. Install with: brew install trivy"
  exit 1
fi

# Use GitHub release mirror for vulnerability DB (default gcr.io is blocked in China)
export TRIVY_DB_REPOSITORY="${TRIVY_DB_REPOSITORY:-ghcr.io/aquasecurity/trivy-db:2}"
export TRIVY_JAVA_DB_REPOSITORY="${TRIVY_JAVA_DB_REPOSITORY:-ghcr.io/aquasecurity/trivy-java-db:1}"

# --skip-download: skip checks bundle download (faster, use cached/embedded checks only)
SKIP_CHECKS_DOWNLOAD=false
for arg in "$@"; do
  case "$arg" in
    --skip-download) SKIP_CHECKS_DOWNLOAD=true ;;
  esac
done
# Remove --skip-download from positional args
ARGS=()
for arg in "$@"; do
  [[ "$arg" != "--skip-download" ]] && ARGS+=("$arg")
done
TARGET="${ARGS[0]:-$REPO_ROOT}"

# Directories to skip (build artifacts, dependencies, caches)
SKIP_DIRS="node_modules,.venv,.umi,dist,build,target,.git,public/preview,byclaw-data/.venv,logs,.DS_Store"

# Write a .trivyignore for binary/media files that slow down secret scanning
TRIVYIGNORE="$REPO_ROOT/.trivyignore"
cat > "$TRIVYIGNORE" <<'EOF'
# Binary and media files (no secrets to find here)
*.png
*.jpg
*.jpeg
*.gif
*.ico
*.svg
*.bmp
*.webp
*.woff
*.woff2
*.ttf
*.eot
*.otf
*.mp4
*.mp3
*.wav
*.avi
*.mov
*.pdf
*.docx
*.xlsx
*.pptx
*.zip
*.tar.gz
*.gz
*.jar
*.war
*.bin
*.so
*.dylib
*.dll
*.exe
*.pyc
*.pyo
*.class
*.owl
*.map
*.DS_Store
*.log
pnpm-lock.yaml
package-lock.json
yarn.lock
EOF

echo "=== Trivy Security Scan ==="
echo "Target:   $TARGET"
echo "Severity: $SEVERITY"
echo "Scanners: $SCANNERS"
echo "Format:   $FORMAT"
echo "DB:       $TRIVY_DB_REPOSITORY"
echo "Skip checks download: $SKIP_CHECKS_DOWNLOAD"
echo ""

EXTRA_ARGS=()
if [[ "$SKIP_CHECKS_DOWNLOAD" == "true" ]]; then
  EXTRA_ARGS+=(--skip-check-update)
fi

trivy fs "$TARGET" \
  --severity "$SEVERITY" \
  --scanners "$SCANNERS" \
  --format "$FORMAT" \
  --skip-dirs "$SKIP_DIRS" \
  --ignorefile "$TRIVYIGNORE" \
  --misconfig-scanners "" \
  "${EXTRA_ARGS[@]}"

rm -f "$TRIVYIGNORE"
