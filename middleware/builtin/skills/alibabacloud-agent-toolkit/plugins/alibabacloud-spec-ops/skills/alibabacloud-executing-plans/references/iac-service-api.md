# Alibaba Cloud IaC Service API Reference

## Overview

IaC Service provides remote Terraform execution through the Alibaba Cloud
CLI. All operations are asynchronous — submit a job and poll for completion.

**ALL commands are executed via MCP tool `AlibabaCloud___CallCLI`** —
never via Bash. Fully qualified tool name:
`mcp__plugin_alibabacloud-spec-ops_alibabacloud-spec-ops__AlibabaCloud___CallCLI`.

## Authentication

Requires configured Alibaba Cloud CLI (`aliyun configure`) with permissions
for:

- `iacservice:ExecuteTerraformPlan`
- `iacservice:ExecuteTerraformApply`
- `iacservice:ExecuteTerraformDestroy`
- `iacservice:GetExecuteState`
- `iacservice:ValidateModule`

## Critical Constraint: No Local File Access

The `AlibabaCloud___CallCLI` MCP tool executes on a **remote server**. It
cannot:

- Access the local filesystem
- Use `file://` or `fileb://` prefixes
- Use shell substitutions like `$(cat ...)`
- Use shell pipes, redirects, or variables

**You MUST read file content locally (via Read tool) and pass it inline as
a string in `--code`.**

## Region

IaC Service derives the deployment region from the HCL `provider "alicloud"`
block (`region = var.region`). **Do NOT pass `--region`** on any of these
commands — the CLI does not accept it.

## Client Token

All write operations (Plan / Apply / Destroy) require `--client-token` as an
idempotency key:

- Type: `string`, regex `[0-9a-zA-Z-]{1,64}`
- Recommended: a fresh UUID for every call
- Re-using the same token on a retry returns the original result without
  re-executing — safe to use for "did my last call go through?" checks

## Commands

### validate-module

Validates Terraform module syntax server-side without executing. **This
command lives in the `alibabacloud-terraform-codegen` skill (Step 6).**
It is listed here only so executing-plans agents recognize it; do not call
it from this skill — the preceding `alibabacloud-validate` step already
covers validation before execution begins.

```
AlibabaCloud___CallCLI:
  command: "aliyun iacservice validate-module --client-token <uuid> --source Upload --code '<HCL_CONTENT>'"
```

| Param | Required | Type | Notes |
| --- | --- | --- | --- |
| `--client-token` | yes | `[0-9a-zA-Z-]{1,64}` | Idempotency key |
| `--source` | yes | enum | `Upload` for inline text |
| `--code` | conditional | string | Single file HCL content |
| `--code-map` | conditional | JSON string `{<file>: <hcl>}` | Multi-file; mutually exclusive with `--code` |
| `--source-path` | optional | string | Source path (other source types) |

### execute-terraform-plan

Submits a Terraform plan job. Returns a state file ID that the subsequent
Apply / Get-State call reuses.

```
AlibabaCloud___CallCLI:
  command: "aliyun iacservice execute-terraform-plan --client-token <uuid> --code '<HCL_CONTENT>'"
```

| Param | Required | Type | Notes |
| --- | --- | --- | --- |
| `--client-token` | yes | `[0-9a-zA-Z-]{1,64}` | Idempotency key, fresh UUID per call |
| `--code` | conditional | string | Full Terraform HCL (concatenated from all `.tf` files). Required for first plan; on a follow-up plan with unchanged content, omit `--code` and pass only `--state-id` |
| `--state-id` | conditional | string | When non-empty, continue Plan on top of an existing state file |

**Response (illustrative):**

```json
{
  "RequestId": "xxx",
  "StateId": "state-xxxxx"
}
```

Treat the state ID as opaque. Whatever field the response uses, store it as
`{STATE_ID}` and feed it back into subsequent calls' `--state-id`.

### execute-terraform-apply

Submits a Terraform apply job. Reuses the `{STATE_ID}` from the preceding
plan when content is unchanged, or accepts a new `--code` payload if the
HCL was modified between plan and apply.

```
AlibabaCloud___CallCLI:
  command: "aliyun iacservice execute-terraform-apply --client-token <uuid> --state-id <id>"
```

| Param | Required | Type | Notes |
| --- | --- | --- | --- |
| `--client-token` | yes | `[0-9a-zA-Z-]{1,64}` | Fresh UUID — different from the plan's token |
| `--code` | conditional | string | Required only if HCL changed since plan |
| `--state-id` | conditional | string | State ID from the preceding plan; required when `--code` is omitted |

**Response:**

```json
{
  "RequestId": "xxx",
  "StateId": "state-xxxxx"
}
```

### execute-terraform-destroy

Submits a Terraform destroy job for an existing state.

```
AlibabaCloud___CallCLI:
  command: "aliyun iacservice execute-terraform-destroy --client-token <uuid> --state-id <id>"
```

| Param | Required | Type | Notes |
| --- | --- | --- | --- |
| `--client-token` | yes | `[0-9a-zA-Z-]{1,64}` | Fresh UUID per call |
| `--state-id` | yes | string | State ID of the deployment to tear down |

### get-execute-state

Polls execution status. Read-only — no `--client-token` required.

```
AlibabaCloud___CallCLI:
  command: "aliyun iacservice get-execute-state --state-id <id>"
```

| Param | Required | Type | Notes |
| --- | --- | --- | --- |
| `--state-id` | yes | string | State ID returned by Plan / Apply / Destroy |

**Response (illustrative):**

```json
{
  "RequestId": "xxx",
  "Status": "Running|Succeeded|Failed",
  "Output": "...",
  "ErrorMessage": "..."
}
```

## State Persistence (Day-1 vs Day-2)

IaC Service stores each deployment's Terraform state remotely, indexed by
the `state_id` returned from `execute-terraform-plan`. The
`executing-plans` skill is responsible for round-tripping this value
through `tasks/status.json` so that subsequent invocations (Day-2
iteration, retry-after-failure, destroy) continue on the same remote state
instead of creating a new one.

### Lifecycle

| Trigger | status.json field | Action |
| --- | --- | --- |
| Plan response received | `state.state_id`, `state.last_plan_at` | Write **before** showing plan to user / polling |
| Apply succeeds | `state.last_apply_at` | Re-confirm `state_id` matches; never overwrite with a different value silently |
| Plan fails | (unchanged) | Keep any prior `state_id`; failed plan does not delete remote state |
| Destroy succeeds | `state.last_destroy_at`, top-level `status: "destroyed"` | Keep `state_id` as historical record |

### Day-1 vs Day-2 call shape

| Scenario | Prior `state.state_id` | Plan CLI |
| --- | --- | --- |
| Day-1 (first ever plan/apply for this requirement) | absent / empty | `execute-terraform-plan --code '{HCL}' --client-token <uuid>` |
| Day-2 (iteration on existing infra) | present | `execute-terraform-plan --code '{HCL}' --state-id <id> --client-token <uuid>` |

`execute-terraform-apply` always passes `--state-id`. It accepts an
optional `--code` only when the HCL changed between plan and apply
(usually it didn't — code is final at plan time).

### Legacy / migration

If status.json has `status: "executed"` but `state.state_id` is missing
(file predates this schema), the safe response is to STOP and ask the
user. Choices:

- Treat as Day-1 → fresh state, risks duplicate resources alongside the
  legacy live infrastructure
- Have the user paste a known `state_id` to adopt
- Abort

Never silently start a new state.

## Polling Strategy

1. Initial wait: ~5 seconds (inform user execution is in progress)
2. Poll interval: 10 seconds between each `get-execute-state` call
3. Max attempts: 60 (≈10 minutes total)
4. On timeout: report as "still running" with the `{STATE_ID}` for manual
   check

Each poll is a **separate** `AlibabaCloud___CallCLI` call. Do NOT use loops
in Bash.

## Error Codes

| Code | Meaning | Action |
| --- | --- | --- |
| InvalidTemplate | TF syntax error | Fix and re-validate |
| QuotaExceeded | Resource quota limit | Request quota increase |
| AccessDenied | Permission missing | Check RAM policy / invoke `alibabacloud-ram-permission-diagnose` |
| ResourceNotFound | Referenced resource missing | Check dependencies |
| InternalError | Service issue | Retry after delay (reuse same `--client-token` for safe retry) |

## Deprecated Parameter Names

The following parameter names appeared in early drafts and are **wrong**.
Do not emit them — the CLI rejects them:

| Stale | Correct |
| --- | --- |
| `--template-body` | `--code` |
| `--execution-id` | `--state-id` |
| `--region` (on iacservice commands) | not a parameter — drop it; region comes from HCL provider block |
