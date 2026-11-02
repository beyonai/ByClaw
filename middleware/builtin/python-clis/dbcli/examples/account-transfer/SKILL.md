---
name: transfer-account-balance
description: Use when a user asks to transfer an amount between two accounts in data source resource 3001.
---

# Transfer Account Balance

Transfer money atomically between two active accounts. The Skill uses the fixed data source resource ID `3001`.

## Required input

- `session_id`: opaque runtime session supplied by the caller.
- `request_id`: globally unique idempotency key supplied by the caller.
- `from_account_id`: debit account ID.
- `to_account_id`: credit account ID.
- `amount`: positive decimal amount with at most two decimal places.

## Execution

This reference contains Shell and Python variants. A production Skill must select and expose exactly one variant.

Shell entry:

```bash
scripts/run.sh \
  "$session_id" \
  "$request_id" \
  "$from_account_id" \
  "$to_account_id" \
  "$amount"
```

Equivalent Python entry:

```bash
python3 scripts/run.py \
  "$session_id" \
  "$request_id" \
  "$from_account_id" \
  "$to_account_id" \
  "$amount"
```

Rules:

- Never call `scripts/business.sh`, `scripts/business.py`, or files under `sql/` directly.
- Never replace the fixed `3001` data source resource ID.
- Never generate, log, persist, or hard-code `session_id`.
- Treat exit code `0` and output `ok: true` as success.
- Do not retry `TX_OUTCOME_UNKNOWN`; query by `request_id` first.
- Do not import or invoke a database driver.

## Result

Success:

```json
{"ok":true,"requestId":"TR-1001","status":"SUCCESS","alreadyProcessed":false}
```

An identical completed request returns success with `alreadyProcessed: true`. Reusing a request ID with different business parameters fails.

## Schema dependency

Read [references/schema-contract.md](references/schema-contract.md) before changing SQL. This Skill depends on Schema version `finance-core/2026.09.1`.
