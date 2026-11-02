# Schema contract

Data source resource ID: `3001`  
Schema version: `finance-core/2026.09.1`

## `finance.account`

| Column | Logical type | Nullable | Notes |
|---|---|---:|---|
| `account_id` | string | no | Primary key |
| `balance` | decimal(18,2) | no | Must remain non-negative |
| `status` | string | no | `ACTIVE` or `FROZEN` |
| `updated_at` | timestamp | no | Last modification time |

Allowed operations: `SELECT`, `UPDATE`.

## `finance.transfer_request`

| Column | Logical type | Nullable | Notes |
|---|---|---:|---|
| `request_id` | string | no | Primary key and idempotency key |
| `from_account_id` | string | no | Source account |
| `to_account_id` | string | no | Target account |
| `amount` | decimal(18,2) | no | Positive transfer amount |
| `status` | string | no | `PROCESSING` or `SUCCESS` |
| `created_at` | timestamp | no | Creation time |
| `completed_at` | timestamp | yes | Completion time |

Allowed operations: `SELECT`, `INSERT`, `UPDATE`.
