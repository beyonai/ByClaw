#!/usr/bin/env bash
# General tool sandbox acceptance, run inside the image as the sandbox user:
#   docker run --rm --entrypoint bash -u byclaw <image> -c "$(cat tool-general-slim-smoke.sh)"
# Checks the commands everyday turns run on B, real document/image/browser work,
# the Skills payload and the SSH helper closure; Java/Maven and ffmpeg stay out.
set -Eeuo pipefail
work="$(mktemp -d /tmp/byclaw-general-smoke.XXXXXX)"
trap 'rm -rf "$work"' EXIT
fail() { printf 'General smoke failed: %s\n' "$*" >&2; exit 1; }

for command in bash git jq curl rsync zip unzip node npm npx pnpm python3 uv \
    bycli chromium byclaw-playwright-chromium soffice libreoffice convert magick gh pandoc pdftotext file \
    rg fd sqlite3 tree make aliyun dws kbcli callcli dbcli groksearchcli searxng-cli \
    wecom-cli lark-cli alibabacloud.mcp-proxy; do
  command -v "$command" >/dev/null || fail "missing command: $command"
done
for command in java mvn ffmpeg; do
  if command -v "$command" >/dev/null; then fail "$command belongs to another tool sandbox"; fi
done

python3 - <<'PY'
import importlib
from importlib.metadata import version
assert version('byclaw-caps') == '0.7.6'
for name in ('by_framework', 'byclaw_caps.article', 'byclaw_caps.tts', 'kbcli', 'callcli', 'redis',
             'docx', 'pptx', 'openpyxl', 'matplotlib', 'numpy', 'PIL', 'fitz', 'pypdf', 'yaml', 'bs4', 'requests'):
    importlib.import_module(name)
print('python modules ok')
PY

test -f "${BYCLAW_SKILLS_DIR:?}/bycli/SKILL.md" || fail "builtin Skills missing"
test -f /opt/byclaw/builtin/skills/github-issues-mgmt/scripts/gh-issues-list.mjs || fail "skill scripts missing"
test -d /opt/byclaw/dsh-managed/skills || fail "managed Skills copy missing"
test "$(cat /etc/byclaw-tool-sandbox/capabilities.json | python3 -c 'import json,sys;print(json.load(sys.stdin)["purpose"])')" = general
sha256sum -c --quiet /etc/byclaw-tool-sandbox/helper.sha256 || fail "SSH helper closure differs from its donor"
grep -q '^BYCLAW_BROWSER_STARTUP=on-demand$' /etc/byclaw-tool-env.session-env || fail "browser must start on demand"
test -d /usr/local/share/byclaw-tool-home || fail "home seed missing"

cd "$work"
printf '# ByClaw 通用沙箱\n\n中文与 English 混排。\n' >doc.md
pandoc doc.md -o doc.docx
pandoc doc.md -o doc.html
timeout 120 soffice --headless --convert-to pdf --outdir "$work" doc.docx >/dev/null 2>&1
test -s doc.pdf || fail "LibreOffice conversion produced no PDF"
pdftotext doc.pdf - | grep -q 'ByClaw' || fail "pdftotext could not read the converted PDF"
convert -size 64x64 xc:'#00dcff' swatch.png
file swatch.png | grep -q 'PNG image' || fail "ImageMagick did not write a PNG"
timeout 60 chromium --headless --disable-gpu --no-sandbox --hide-scrollbars --window-size=800,600 \
  --screenshot="$work/page.png" "file://$work/doc.html" >/dev/null 2>&1
file page.png | grep -q 'PNG image' || fail "headless Chromium screenshot failed"
sqlite3 smoke.db 'create table t(x); insert into t values (1); select count(*) from t;' | grep -qx 1

printf 'General smoke passed: commands, Python packages, Skills, helper closure, Office/PDF/image/browser work.\n'
