#!/usr/bin/env bash
# Capabilities a user's commands have, one JSON line per check ({check, ok, detail}).
# Run it through the assistant's bash tool, once in a user's own sandbox and once
# for a user on the shared DSH host (whose commands run in the tool sandbox), then
# compare the two outputs with compare.mjs. It changes nothing but a marker file
# in the home directory and a browser tab.
set -u

emit() {
    python3 -c 'import json, sys; print(json.dumps({"check": sys.argv[1], "ok": sys.argv[2] == "1", "detail": sys.argv[3] if sys.argv[1] == "env" else sys.argv[3][:300]}))' "$1" "$2" "$3"
}

# The environment commands start with (names only, never values).
emit env 1 "$(env | cut -d= -f1 | sort -u | tr '\n' ' ')"

# byCLI: one real browser command first (the browser starts on demand, as in the user's own
# sandbox), then the daemon, browser extension and the bridge between them.
if output="$(timeout 90 bycli browser parity-probe open https://example.com 2>&1)"; then emit bycli-browser 1 ''
else emit bycli-browser 0 "$(tail -n 2 <<<"${output}" | tr '\n' ' ')"; fi
doctor="$(timeout 90 bycli doctor 2>&1)"
if grep -q '\[OK\] Extension' <<<"${doctor}" && grep -q '\[OK\] Connectivity' <<<"${doctor}"; then emit bycli-doctor 1 ''
else emit bycli-doctor 0 "$(grep -E 'MISSING|FAIL' <<<"${doctor}" | tr '\n' ' ')"; fi

# A service-discovered platform CLI (needs the platform's Redis settings and the user's token).
if kbcli base list --session-id parity-probe 2>/dev/null | grep -q '"ok":true'; then emit kbcli 1 ''
else emit kbcli 0 "$(kbcli base list --session-id parity-probe 2>&1 | tail -c 200)"; fi

# Whether the home directory is persistent storage (CLI logins, ~/.openclaw, ~/.bycli survive).
mount_point="$(findmnt -n -o TARGET -T "${HOME}" 2>/dev/null)"
dsh_mount="$(findmnt -n -o TARGET -T "${HOME}/.dsh" 2>/dev/null)"
if [[ "${mount_point}" != / || ( -n "${dsh_mount}" && "${dsh_mount}" != / ) ]]; then emit home-persistent 1 "${mount_point}"
else emit home-persistent 0 'the home directory is on the container root filesystem'; fi
marker="${HOME}/.parity-probe-marker"
if [[ -f "${marker}" ]]; then emit home-marker-kept 1 "$(cat "${marker}")"; else emit home-marker-kept 0 'no marker from an earlier run'; fi
date -u +%FT%TZ >"${marker}"
