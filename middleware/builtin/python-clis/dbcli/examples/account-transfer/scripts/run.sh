#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() {
  printf '{"ok":false,"error":{"code":"INVALID_ARGUMENT","message":"%s"}}\n' "$1" >&2
  exit 2
}

[[ "$#" -eq 5 ]] || fail "expected session_id, request_id, from_account_id, to_account_id and amount"

session_id="$1"
request_id="$2"
from_account_id="$3"
to_account_id="$4"
amount="$5"

[[ -n "$session_id" ]] || fail "session_id is required"
[[ "$request_id" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$ ]] || fail "request_id format is invalid"
[[ "$from_account_id" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$ ]] || fail "from_account_id format is invalid"
[[ "$to_account_id" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$ ]] || fail "to_account_id format is invalid"
[[ "$from_account_id" != "$to_account_id" ]] || fail "source and target accounts must differ"
[[ "$amount" =~ ^[0-9]+([.][0-9]{1,2})?$ ]] || fail "amount must be a positive decimal with at most two decimal places"
[[ "$amount" != "0" && "$amount" != "0.0" && "$amount" != "0.00" ]] || fail "amount must be greater than zero"

# Fixed when this Skill is developed. It is never accepted from runtime input.
readonly datasource_code="3001"

exec dbcli transaction run \
  --session-id "$session_id" \
  --datasource-code "$datasource_code" \
  --isolation read-committed \
  --timeout 30s \
  -- "${SCRIPT_DIR}/business.sh" \
  "$request_id" "$from_account_id" "$to_account_id" "$amount"
