#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

: "${DBCLI_TRANSACTION_ID:?business.sh must be started by dbcli transaction run}"
: "${DBCLI_SESSION_ID:?transaction session context is missing}"
: "${DBCLI_DATASOURCE_CODE:?transaction data source context is missing}"

[[ "$DBCLI_DATASOURCE_CODE" == "3001" ]] || {
  printf '%s\n' '{"ok":false,"error":{"code":"TX_DATASOURCE_MISMATCH"}}' >&2
  exit 12
}

request_id="$1"
from_account_id="$2"
to_account_id="$3"
amount="$4"

dbcli_json() {
  local output
  if output=$(dbcli "$@"); then
    printf '%s' "$output"
  else
    local status=$?
    printf '%s\n' "$output" >&2
    return "$status"
  fi
}

common_args=(
  --session-id "$DBCLI_SESSION_ID"
  --datasource-code "$DBCLI_DATASOURCE_CODE"
  --format json
)

params=$(jq -nc \
  --arg request_id "$request_id" \
  --arg from_account_id "$from_account_id" \
  --arg to_account_id "$to_account_id" \
  --arg amount "$amount" \
  '{request_id:$request_id,from_account_id:$from_account_id,to_account_id:$to_account_id,amount:$amount}')

# Claim the idempotency key inside this transaction.
claim=$(dbcli_json sql "${common_args[@]}" \
  --file "${SKILL_DIR}/sql/claim-transfer.sql" \
  --params "$params")

if [[ "$(jq -r '.rowCount' <<<"$claim")" == "0" ]]; then
  existing=$(dbcli_json sql "${common_args[@]}" \
    --file "${SKILL_DIR}/sql/get-transfer.sql" \
    --params "$params")

  if jq -e \
    '.rowCount == 1 and
     .rows[0].same_request == true and
     .rows[0].status == "SUCCESS"' <<<"$existing" >/dev/null; then
    jq -nc --arg request_id "$request_id" \
      '{ok:true,requestId:$request_id,status:"SUCCESS",alreadyProcessed:true}'
    exit 0
  fi

  printf '%s\n' '{"ok":false,"error":{"code":"IDEMPOTENCY_CONFLICT","message":"request_id already exists with different parameters or incomplete state"}}' >&2
  exit 30
fi

# Lock in stable order to reduce deadlock risk and verify both accounts exist and are active.
locked=$(dbcli_json sql "${common_args[@]}" \
  --file "${SKILL_DIR}/sql/lock-accounts.sql" \
  --params "$params")

if [[ "$(jq -r '.rowCount' <<<"$locked")" != "2" ]]; then
  printf '%s\n' '{"ok":false,"error":{"code":"ACCOUNT_NOT_AVAILABLE","message":"both accounts must exist and be active"}}' >&2
  exit 31
fi

dbcli_json sql "${common_args[@]}" \
  --file "${SKILL_DIR}/sql/debit.sql" \
  --params "$params" \
  --expect-affected-rows 1 >/dev/null

dbcli_json sql "${common_args[@]}" \
  --file "${SKILL_DIR}/sql/credit.sql" \
  --params "$params" \
  --expect-affected-rows 1 >/dev/null

dbcli_json sql "${common_args[@]}" \
  --file "${SKILL_DIR}/sql/complete-transfer.sql" \
  --params "$params" \
  --expect-affected-rows 1 >/dev/null

jq -nc --arg request_id "$request_id" \
  '{ok:true,requestId:$request_id,status:"SUCCESS",alreadyProcessed:false}'
