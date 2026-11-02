---
name: alibabacloud-executing-plans
description: "Execute validated Terraform plans via Alibaba Cloud IaC Service. Requires explicit user confirmation before any apply operation. WHEN: execute terraform, apply infrastructure, run terraform apply, deploy infrastructure, create cloud resources, execute plan."
license: MIT
metadata:
  author: Alibaba Cloud
  version: "0.7.0"
---

# Alibaba Cloud Executing Plans

> **AUTHORITATIVE GUIDANCE — MANDATORY COMPLIANCE**
>
> This skill executes validated Terraform code via Alibaba Cloud IaC Service (remote execution).
> It creates **real cloud resources** that cost money. Safety gates are non-negotiable.
>
> **ALL CLI operations MUST use MCP tool `AlibabaCloud___CallCLI`** — never use Bash to run `aliyun` commands directly.

---

> **PREREQUISITE CHECK — MANDATORY**
>
> Before proceeding, verify BOTH prerequisites:
>
> 1. **Validation passed** — check `tasks/status.json` has `status: "validated"` (internal check, don't expose to user)
> 2. **User explicitly confirmed** they want to execute
>
> If EITHER is missing, **STOP IMMEDIATELY**:
>
> - Not validated? → Invoke **alibabacloud:validate** first
> - No user confirmation? → Ask user before proceeding

---

## Triggers

Activate when:

- User explicitly asks to execute/apply the Terraform plan
- User confirms they want to proceed after validation passes

**NEVER activate automatically.** This skill requires explicit user intent.

## Rules

1. **Single deploy approval, granted upstream** — The user authorizes deployment ONCE in `alibabacloud-validate`'s gate. Inside this skill the entire `plan → apply` chain runs automatically. Never add a second confirmation between plan and apply.
2. **Plan before apply, results always shown** — Always run terraform plan first AND surface its output to the user before apply. The user can interrupt mid-stream if the plan reveals something unexpected, but the default flow does not stop to ask.
3. **MCP only** — ALL `aliyun` CLI commands MUST go through `AlibabaCloud___CallCLI`, never through Bash
4. **Inline content** — Read .tf files locally, then pass content as string to `--code` (MCP cannot access local files)
5. **Record everything** — All outputs recorded to tasks/
6. **Support rollback** — Provide destroy option if apply fails
7. **Poll for completion** — IaC Service is async; use sequential MCP calls to poll
8. ⚠️ **Destructive operations (destroy) require double confirmation**
9. **Persist `state_id`** — IaC Service keeps the Terraform state remotely keyed by `state_id`. This skill MUST write it back to `tasks/status.json` (under `state.state_id`) on every Plan / Apply / Destroy and MUST pass the saved value on every subsequent Day-2 call. Losing the `state_id` orphans the remote state and forces a fresh deploy (potential duplicate resources).
10. **Source-of-truth integrity** — Some failures are only discoverable at apply time (SKU offline in target AZ, zone out-of-capacity, etc.). Any spec change forced by such a failure MUST be written back to BOTH `designs/design.md` (with a Decisions Log entry) AND `designs/terraform/*.tf` BEFORE re-running plan/apply. **Never hot-patch the in-flight apply** — Day-2 iterations re-read these files and will redeploy the broken spec if it isn't fixed at the source.

---

## State Persistence (CRITICAL for Day-2)

IaC Service stores each deployment's Terraform state remotely, indexed by
`state_id`. This handle is the contract that lets you iterate on the same
infrastructure across multiple `executing-plans` invocations:

| When | Read | Write |
| --- | --- | --- |
| Step 1 (start) | `tasks/status.json` → `state.state_id` (may be empty on first run) | — |
| Step 3 (after plan response) | — | `state.state_id`, `state.last_plan_at` |
| Step 5/6 (after apply succeeds) | — | `state.state_id` (re-confirm), `state.last_apply_at` |
| Destroy (after success) | — | `state.last_destroy_at`; keep `state_id` as historical record |

**Branching by Day-1 vs Day-2:**

| Scenario | Saved `state_id` | Plan CLI |
| --- | --- | --- |
| Day-1 (first run) | absent / empty | `--code '{CODE}' --client-token <uuid>` |
| Day-2 (iteration) | present | `--code '{CODE}' --state-id {STATE_ID} --client-token <uuid>` |

Apply always passes `--state-id`; pass `--code` too only when the HCL
changed between plan and apply (rare — usually code is already final at
plan time).

**Legacy / migration edge case.** If status is `executed` but `state.state_id`
is absent (status.json predates this schema), STOP before touching the
remote — ask the user whether to:

- (a) treat this as Day-1 and create a fresh state (risks duplicate
  resources alongside the legacy deployment), or
- (b) abort and let the user supply the missing `state_id` manually
  (recommended if they know it).

Never silently start fresh — the user paid for those resources.

---

## MCP Execution Model

**CRITICAL: The `AlibabaCloud___CallCLI` MCP tool runs on a REMOTE server. It CANNOT:**

- Access local files (no `file://`, no `$(cat ...)`, no local paths)
- Use shell operators (`|`, `>`, `&&`, `$()`)
- Use shell variables or environment variables

**Therefore, you MUST:**

1. Use the `Read` tool to read `.tf` file contents into your context
2. Concatenate all `.tf` files into a single string and pass it inline via `--code`
3. Escape single quotes in HCL content (replace `'` with `'\''` if needed)
4. Generate a fresh UUID for `--client-token` on every Plan / Apply / Destroy call (idempotency key, format `[0-9a-zA-Z-]{1,64}`)

---

## Process

### Step 1: Verify Prerequisites

1. Read `tasks/status.json`:
   - `status` must be `"validated"` (Day-1) OR `"executed"` (Day-2 re-iteration after planning produced new code)
   - Capture `state.state_id` into `{STATE_ID}` (may be empty on first run — that signals Day-1)
   - If `status == "executed"` but `state.state_id` is missing, see the
     legacy edge case in [State Persistence](#state-persistence-critical-for-day-2) before proceeding
2. Read `tasks/validation-report.md` — must show all reviews PASS
3. Confirm user intent one more time, and surface whether this is Day-1 or Day-2:

> "Ready to execute Terraform.
>
> {Day-1: This will create real cloud resources on Alibaba Cloud and incur costs.}
> {Day-2: This will update the existing deployment (state `{STATE_ID}`); changes
> shown in the next plan output will be applied to the live resources.}
>
> Proceed with `terraform plan`?"

### Step 2: Prepare Template Content

**Read all `.tf` files** from the design directory and concatenate them into a single string:

```
# Use Read tool to get content of each .tf file:
Read: .aliyun-ai-ops-spec/{name}/designs/terraform/main.tf
Read: .aliyun-ai-ops-spec/{name}/designs/terraform/variables.tf
Read: .aliyun-ai-ops-spec/{name}/designs/terraform/outputs.tf
# ... any other .tf files
```

Concatenate all content into one `CODE` string. This will be passed inline via `--code` to MCP commands.

### Step 3: Execute Terraform Plan

**Branch by whether `{STATE_ID}` was loaded in Step 1.**

**Day-1 (no prior `state_id`):**

```
AlibabaCloud___CallCLI:
  command: "aliyun iacservice execute-terraform-plan --code '{CODE}' --client-token {CLIENT_TOKEN}"
```

**Day-2 (continuing on saved `state_id`):**

```
AlibabaCloud___CallCLI:
  command: "aliyun iacservice execute-terraform-plan --code '{CODE}' --state-id {STATE_ID} --client-token {CLIENT_TOKEN}"
```

Where:

- `{CODE}` = concatenated .tf content (single quotes properly escaped)
- `{CLIENT_TOKEN}` = fresh UUID (format `[0-9a-zA-Z-]{1,64}`) — required for idempotency
- `{STATE_ID}` = value from `tasks/status.json` → `state.state_id` (Day-2 only)

**Response contains a state file ID (typically `StateId`)** — capture it as
`{STATE_ID}`. On Day-2 it will match the value passed in; on Day-1 this is
the freshly minted one.

**PERSIST IMMEDIATELY** — before polling, before showing the plan output to
the user, silently update `tasks/status.json`:

```json
{
  ...,
  "state": {
    "state_id": "{STATE_ID}",
    "last_plan_at": "{ISO timestamp}",
    ...
  }
}
```

Rationale: if the user aborts at the Step 4 confirmation, the next
invocation must still be able to continue on this state. **Never poll or
proceed before this write completes.**

**Poll for completion** (see Polling Strategy below):

```
AlibabaCloud___CallCLI:
  command: "aliyun iacservice get-execute-state --state-id {STATE_ID}"
```

### Step 4: Present Plan Results (no second confirmation)

Show the plan output to user, then **proceed directly to Step 5** —
do NOT stop to ask "Confirm apply?". The user already authorized
deployment at the validate-stage gate; a second confirmation here is
friction that this skill explicitly removes.

Write plan results to `tasks/tf-plan-result.md`.

Display:

> "Terraform plan results:
>
> - {N} resources to create
> ~ {N} resources to modify
>
> - {N} resources to destroy
>
> {Summary of key resources}
>
> 即将自动进入 apply 阶段。如发现 plan 不符合预期，请立刻中断我（例如按 Esc / 中止当前消息）。"

If the plan output reveals something the user clearly did not consent to
(e.g. unexpected resource destruction in a Day-2 modify when no destroy
was discussed), STOP and surface it as a question — this is a safety
override, not the default flow:

> "⚠️ plan 中检测到非预期的破坏性变更：
>
> - `<resource>` 将被 destroy/replace
>
> 这通常不在变更范围内，是否确认继续？回复 **\"继续\"** 才会 apply；回复 **\"停\"** 我立刻中止。"

Default path (no anomalies): emit the display block, then immediately
invoke Step 5 in the same turn.

### Step 5: Execute Terraform Apply (auto, immediately after Step 4)

Reuse `{STATE_ID}` (saved in Step 3) and a **fresh** `--client-token`
(different UUID from the plan call):

```
AlibabaCloud___CallCLI:
  command: "aliyun iacservice execute-terraform-apply --state-id {STATE_ID} --client-token {CLIENT_TOKEN}"
```

If the HCL changed after plan (rare — usually it didn't), also pass
`--code '{CODE}'` (mutually included with `--state-id`).

The apply response returns the same `{STATE_ID}` — re-confirm it matches
the saved value before polling. If for any reason a NEW state_id appears,
treat that as an anomaly: stop, alert the user, and do NOT overwrite the
saved one without explicit confirmation.

**Poll for completion:**

```
AlibabaCloud___CallCLI:
  command: "aliyun iacservice get-execute-state --state-id {STATE_ID}"
```

### Step 6: Record Results

Write results to `tasks/tf-apply-result.md`:

```markdown
# Terraform Apply Results - {Requirement Name}

## Timestamp
{ISO timestamp}

## State ID
{state-id}

## Status
SUCCESS / FAILED

## Resources Created
| Resource Type | Resource Name | Resource ID |
|---------------|---------------|-------------|
| ... | ... | ... |

## Outputs
| Name | Value |
|------|-------|
| ... | ... |

## Errors (if any)
{error details}
```

### Step 7: Update Internal State + TODO list

1. Silently update `tasks/status.json`. **Do NOT mention this file to the user.**

   ```json
   {
     ...,
     "status": "executed",
     "updated_at": "{ISO timestamp}",
     "state": {
       "state_id": "{STATE_ID}",
       "last_plan_at": "{from Step 3}",
       "last_apply_at": "{ISO timestamp of successful apply}",
       "last_destroy_at": null
     }
   }
   ```

   `state.state_id` MUST be retained even on Day-2 transitions (do not clear
   it between iterations). Subsequent `executing-plans` invocations will read
   it back in Step 1 to continue on the same remote state.

2. Update the user-facing TODO list via `TodoWrite`: mark
   **"部署执行：terraform plan/apply via IaC Service"** → `completed`.
   This closes the 3-task scaffold the planning skill rendered after
   design confirmation, giving the user a clean "everything done" view.

   On apply failure or destroy: leave the task in `in_progress` so the
   user understands the workflow has not finished; mark `completed`
   only after the resource state is reconciled (retry succeeded, partial
   destroy completed, or user explicitly abandons).

### Step 8: Generate Deployed Topology (`topology.html`)

**When:** Apply succeeded. Skip if failed or partial.

**⚠️ `topology.html` ≠ `designs/architecture.html`。** `architecture.html` 是规划阶段的设计图，数据来自 design spec。`topology.html` 是部署后的实际拓扑图，数据来自 `get-execute-state` 的真实远程状态。不要复用、不要搞混。

**做法：**

1. 用 Bash 找到并读取 guide：

   ```bash
   GUIDE=$(find ~/.qoderwork/plugins-custom ~/Desktop/alibabacloud-agent-toolkit -path "*/alibabacloud-executing-plans/references/architecture-topology-html-guide.md" 2>/dev/null | head -1)
   cat "$GUIDE"
   ```

   找不到就停下告诉用户。**必须读完这个文件再动手，不准凭记忆生成。**

2. 调用 `aliyun iacservice get-execute-state --state-id {STATE_ID}` 获取真实部署状态。

3. 严格按 guide 的每一节生成 `<project-root>/topology.html`，用浏览器打开验证。

---

## Polling Strategy

IaC Service operations are **asynchronous**. After submitting a job, poll using sequential MCP calls:

| Parameter | Value |
|-----------|-------|
| First poll delay | Wait ~5 seconds (inform user "正在执行中...") then call |
| Poll interval | Every 10 seconds, call `get-execute-state` again |
| Max attempts | 60 attempts (≈10 minutes) |
| Timeout action | Report "still running" with `{STATE_ID}` for manual check |

**How to poll:**

1. Call `AlibabaCloud___CallCLI` with `get-execute-state`
2. Check `Status` in response:
   - `"Running"` → inform user "执行中..." and call again after brief pause
   - `"Succeeded"` → proceed to next step
   - `"Failed"` → extract `ErrorMessage`, go to Error Handling
3. Repeat until terminal state or max attempts reached

**Important:** Each poll is a separate `AlibabaCloud___CallCLI` call. Do NOT use Bash loops or sleep commands.

---

## Error Handling

### Plan Fails

- Record error in `tasks/tf-plan-result.md`
- Identify root cause from `ErrorMessage`:

| Error Code | Meaning | Action |
|------------|---------|--------|
| InvalidTemplate | TF syntax error | Fix TF files and re-validate |
| QuotaExceeded | Resource quota limit | Inform user to request quota increase |
| AccessDenied | Permission missing | Invoke `alibabacloud-ram-permission-diagnose` |
| ResourceNotFound | Referenced resource missing | Check dependencies |
| `Invalid*Class.Offline`, `OperationDenied.NoStock`, `Zone.NotOnSale`, etc. | Spec discovered unavailable at plan time | See [Spec-driven Failures](#spec-driven-failures-source-of-truth-recovery) below |
| InternalError | Service issue | Retry once after informing user |

- Set status back to "plans-written" for re-validation
- **Keep `state.state_id`** in status.json if one was already saved from a
  prior successful run — never delete it on a plan failure. The remote
  state still exists and the next attempt must continue on it.

### Apply Fails

- Record error in `tasks/tf-apply-result.md`
- Check partial state:

```
AlibabaCloud___CallCLI:
  command: "aliyun iacservice get-execute-state --state-id {STATE_ID}"
```

- Classify the failure first, then offer the right options:

| Failure class | Examples | Where to go |
|---------------|----------|-------------|
| **Spec-driven** (resource exists in API catalog but is rejected at create time) | `InvalidDBInstanceClass.Offline`, `OperationDenied.NoStock`, `Zone.NotOnSale`, instance family sold out in target AZ | [Spec-driven Failures](#spec-driven-failures-source-of-truth-recovery) — MANDATORY source-of-truth sync, do NOT hot-patch |
| **Structural** (HCL refers to something that does not exist or has wrong dependencies) | Wrong VPC ID, missing security group reference, circular dependency | Fix HCL in `designs/terraform/*.tf`, re-run plan/apply (keep state_id) |
| **Permission** | `AccessDenied`, `Forbidden`, `NoPermission` | Invoke `alibabacloud-spec-ops:alibabacloud-ram-permission-diagnose`; once RAM is fixed re-run apply with same state_id |
| **Transient** | `ServiceUnavailable`, intermittent 5xx | Re-run apply once with same state_id |

After classification, present these options to the user (in addition to
the diagnosed root cause):

1. Apply the spec/HCL fix and retry apply
2. Destroy partially created resources (uses the Destroy gate below)
3. Pause for manual investigation — keep state_id so we can resume

### Spec-driven Failures (source-of-truth recovery)

Some Alibaba Cloud resource constraints are only discoverable at apply
time — the API lists a SKU as available but `CreateInstance` returns
`InvalidDBInstanceClass.Offline`; a zone is out of capacity for a
specific instance family; an EIP bandwidth-package shape is no longer
sold. These are not bugs in the generated code — the design was valid
when planning ran, the reality changed (or the catalog lied).

**Example diagnostic (from a real session):**

> ✅ 17/21 资源已创建成功（VPC, VSwitch, SG+rules, ECS, EIP+关联, OSS+ACL, RAM 全套, random_string）
> ❌ RDS 实例创建失败 → 由此连带 4 个依赖（账号/库/授权/备份策略）未创建
> 根因：`mysql.n2.small.1` 在 cn-beijing-i 已下线（API 仍列出，但创建时报 `InvalidDBInstanceClass.Offline`）

**Recovery flow (5 steps — every step MANDATORY):**

#### 1. Diagnose

From the apply error, extract:

- the resource block (`<resource>.<name>`) that failed
- the failing spec value (e.g. `db_instance_class = "mysql.n2.small.1"`)
- the region / zone where it failed
- the upstream error code (`InvalidDBInstanceClass.Offline`,
  `OperationDenied.NoStock`, …)

#### 2. Query live alternatives via MCP

Use `AlibabaCloud___CallCLI` against the right inventory API to find
currently-available specs. Pick the API by resource type:

| Resource | Query CLI |
| --- | --- |
| RDS instance class | `aliyun rds DescribeAvailableResource --RegionId <region> --ZoneId <zone> --Engine <engine> --EngineVersion <ver>` |
| ECS instance type | `aliyun ecs DescribeAvailableResource --RegionId <region> --ZoneId <zone> --DestinationResource InstanceType --InstanceChargeType <type>` (or `DescribeRecommendInstanceType`) |
| Disk category | `aliyun ecs DescribeAvailableResource --RegionId <region> --ZoneId <zone> --DestinationResource DataDisk` |
| EIP bandwidth | `aliyun vpc DescribeBandwidthPackages --RegionId <region>` |
| (other) | Whatever `aliyun <service> Describe*Resource` / `Describe*Availability` exists |

Filter the response down to specs with **the closest match on CPU /
memory / IOPS / charge type** to the failed one. Pick 1–3 candidates;
mark one with ⭐ as the minimal-diff recommendation.

#### 3. Ask the user (explicit, with `AskUserQuestion`)

Surface diagnosis + candidates as distinct options:

```
AskUserQuestion:
  question: "RDS 规格 mysql.n2.small.1 在 cn-beijing-i 已下线，apply 中断。要换成下列哪个继续？"
  header: "替代规格"
  options:
    - label: "mysql.n2e.small.1 (推荐)"
      description: "n2e 新一代，同 1C2G 规格，同价位（最小改动）"
    - label: "mysql.x2.medium.1"
      description: "x2 系列，1C2G，新一代主推，价格 +12%"
    - label: "暂停 — 我自己来查"
      description: "保留已创建的 17 个资源和 state_id，稍后我手动决定后再重新触发 apply"
```

Never auto-pick a replacement, even if "obvious". Spec changes can
affect cost, performance, and compliance — the user owns this call.

#### 4. Sync source-of-truth (BOTH design.md AND .tf — non-negotiable)

Once user confirms a replacement, **before any re-run**:

1. **`designs/design.md`**:
   - Update the affected resource entry with the new spec
   - Append to **Decisions Log** (or create the section if missing):

     ```
     - {ISO timestamp}: RDS 实例规格 mysql.n2.small.1 → mysql.n2e.small.1
       原因：原规格在 cn-beijing-i 已下线（apply 时报 InvalidDBInstanceClass.Offline）
       影响：1C2G/同价位，无性能/成本变化
     ```

2. **`designs/terraform/*.tf`**:
   - Replace the failing field value(s); only edit the lines required
   - Do NOT reformat unrelated code; keep the diff minimal so the
     change is auditable

This is Rule 10. Skipping either file silently breaks Day-2:

- Skip design.md → next Day-2 planning reads stale design and "fixes"
  the difference back to the broken spec
- Skip .tf → next plan still fails the same way

#### 5. Re-run plan + apply with retained state_id

The original `state_id` is already in `tasks/status.json`. Re-enter
Step 3 of the main Process with the patched HCL:

```
AlibabaCloud___CallCLI:
  command: "aliyun iacservice execute-terraform-plan --code '{NEW_CODE}' --state-id {STATE_ID} --client-token {NEW_UUID}"
```

The 17 already-created resources stay (state remembers them); only
the failed 4 + any that depend on them are created. Apply auto-flows
per Rule 2.

If the user picked **"暂停 — 我自己来查"** in Step 3:

- Leave `status: "executing"` (do NOT roll back to `validated`)
- Leave TODO task 3 `in_progress`
- Tell user how to resume: "已保留 state_id `{STATE_ID}` 和已创建的 17 个资源。手动定夺规格后回到本会话回复"继续 apply"，我会用更新后的 HCL 在同一 state 上 resume。"

### Destroy Operations

For `terraform destroy` (cleanup or rollback):

> "⚠️ **DESTRUCTIVE OPERATION**
>
> This will destroy ALL resources created by this Terraform configuration.
> This action cannot be undone.
>
> Type the requirement name `{name}` to confirm destruction:"

Require exact name match before proceeding. Then execute (use a fresh `--client-token`):

```
AlibabaCloud___CallCLI:
  command: "aliyun iacservice execute-terraform-destroy --state-id {STATE_ID} --client-token {CLIENT_TOKEN}"
```

Poll for completion using same strategy as apply.

After destroy succeeds, update `tasks/status.json`:

```json
{
  ...,
  "status": "destroyed",
  "updated_at": "{ISO timestamp}",
  "state": {
    "state_id": "{STATE_ID}",
    "last_plan_at": "{prior}",
    "last_apply_at": "{prior}",
    "last_destroy_at": "{ISO timestamp}"
  }
}
```

**Keep `state.state_id` as a historical record** — do not clear it. If the
user later wants to redeploy fresh (new state), planning will detect
`status == "destroyed"` and prompt for net-new Day-1 vs reuse decision.

---

## IaC Service MCP Command Reference

**All commands use `AlibabaCloud___CallCLI` with the full CLI string:**

| Operation | MCP Command |
|-----------|-------------|
| Plan        | `aliyun iacservice execute-terraform-plan --code '{content}' --client-token {uuid}` |
| Apply       | `aliyun iacservice execute-terraform-apply --state-id {id} --client-token {uuid}` |
| Poll status | `aliyun iacservice get-execute-state --state-id {id}` |
| Destroy     | `aliyun iacservice execute-terraform-destroy --state-id {id} --client-token {uuid}` |

### Command Parameter Reference

**`aliyun iacservice execute-terraform-plan`**

| Param | Required | Type | Notes |
| --- | --- | --- | --- |
| `--client-token` | yes | string `[0-9a-zA-Z-]{1,64}` | Idempotency key, fresh UUID per call |
| `--code` | conditional | string | Full Terraform HCL content (concatenated from all `.tf` files). Required for first plan; on a follow-up plan with unchanged content you may pass only `--state-id` |
| `--state-id` | conditional | string | When non-empty, continue Plan on top of an existing state file |

**`aliyun iacservice execute-terraform-apply`**

| Param | Required | Type | Notes |
| --- | --- | --- | --- |
| `--client-token` | yes | string `[0-9a-zA-Z-]{1,64}` | Idempotency key, fresh UUID per call |
| `--code` | conditional | string | Required only if HCL changed since plan; pass the new concatenated content |
| `--state-id` | conditional | string | State ID from the preceding plan; pass it when content is unchanged so Apply continues on the same state |

**`aliyun iacservice execute-terraform-destroy`**

| Param | Required | Type | Notes |
| --- | --- | --- | --- |
| `--client-token` | yes | string `[0-9a-zA-Z-]{1,64}` | Idempotency key, fresh UUID per call |
| `--state-id` | yes | string | State ID of the deployment to tear down |

**`aliyun iacservice get-execute-state`**

| Param | Required | Type | Notes |
| --- | --- | --- | --- |
| `--state-id` | yes | string | State ID returned by the preceding Plan / Apply / Destroy call |

**⚠️ NEVER:**

- Use `file://` paths (MCP cannot access local filesystem)
- Use `$(cat ...)` shell substitution (MCP doesn't support shell operators)
- Use Bash tool to run `aliyun` commands (always use MCP)
- Pass `--region` — IaC Service derives the region from the HCL `provider "alicloud"` block; the CLI does not accept a `--region` flag here
- Omit `--client-token` from Plan / Apply / Destroy — it is required for idempotency
- Use `--execution-id` or `--template-body` — these are stale names from earlier drafts; the correct parameters are `--state-id` and `--code`

---

## Safety Principles

- **Never skip plan** — Always plan before apply, and always show plan output to the user
- **Auto-apply is the default flow** — The deploy authorization is granted ONCE at the validate-stage gate; do NOT add a second confirmation between plan and apply. The user can still interrupt mid-stream; the safety override in Step 4 covers unexpected destructive changes.
- **Never silent destroy** — Destroy (Rule 8) requires explicit naming confirmation; this is independent of the plan→apply auto-flow
- **Always use MCP** — Never run aliyun CLI via Bash; always via `AlibabaCloud___CallCLI`
- **Always inline content** — Read files first, pass content as string to MCP
- **Always record** — Every operation logged to tasks/
- **Always poll** — Don't assume completion; verify state via MCP
- **Always persist `state_id`** — Write to `tasks/status.json` → `state.state_id` immediately after every plan response; never proceed without saving
- **Never orphan remote state** — Keep `state.state_id` across re-iterations and even after destroy (historical record); only the user may decide to discard it
- **Fail safe** — On error, stop and inform user; don't retry blindly
