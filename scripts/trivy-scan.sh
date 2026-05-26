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

echo "=== Trivy Security Scan ==="
echo "Target:   $TARGET"
echo "Severity: $SEVERITY"
echo "Scanners: $SCANNERS"
echo "Format:   $FORMAT"
echo "DB:       $TRIVY_DB_REPOSITORY"
echo ""

trivy fs "$TARGET" \
  --severity "$SEVERITY" \
  --scanners "$SCANNERS" \
  --format "$FORMAT"
