---
name: alibabacloud-terraform-codegen
description: |
  Use when the user wants Terraform HCL for Alibaba Cloud (Alicloud) infrastructure —
  new project or extending an existing one. Covers VPC, ECS, ApsaraDB RDS, OSS,
  SLB / ALB, Function Compute v3, ACK, and any other `alicloud_*` resource via the
  provider's own documentation fetched at generation time. For AWS → Alicloud
  migration or importing existing resources into state, use a different skill.
  Triggers: "write terraform for alicloud", "generate alibaba cloud terraform",
  "alicloud HCL", "create alibaba cloud vpc/ecs/rds", "生成阿里云 Terraform",
  "阿里云 HCL", "用 Terraform 部署阿里云", "alicloud provider", "aliyun/alicloud",
  "terraform-provider-alicloud".
license: MIT
metadata:
  author: Alibaba Cloud
  version: "0.3.1"
compatibility:
  tools:
    - mcp__plugin_alibabacloud-spec-ops_alibabacloud-spec-ops__AlibabaCloud___CallCLI
---

# Alibaba Cloud Terraform Code Generation

Turn natural-language Alibaba Cloud infrastructure requirements into validated
Terraform for the current `aliyun/alicloud` provider. Resource knowledge is
pulled from the provider's own docs at generation time — no local gold examples
are maintained.

## Hard rules (never violate)

### 1. Credentials — never leak, never require

NEVER read, print, ask for, or write AK/SK values anywhere — HCL, comments, env
declarations, shell output, logs. The alicloud provider resolves credentials
through seven mechanisms (env AK/SK, shared `config.json`, ECS instance RAM
role, Assume Role, OIDC/RRSA, sidecar URI, static HCL) — see
`references/auth-and-network.md` for the full chain. All read by the provider
itself, never by this skill. Do NOT recommend the deprecated `ALICLOUD_*` /
`ALIBABACLOUD_*` (no-underscore) env-var names — the current names are
`ALIBABA_CLOUD_ACCESS_KEY_ID` / `_ACCESS_KEY_SECRET` / `_SECURITY_TOKEN`.

### 2. Honest reporting — never claim a step you didn't run

Never report `fmt: ok` / `validate: ok` / `plan: ok` unless the corresponding
command actually executed AND returned that status. When a step is skipped
(tool missing, user opt-out), state **"SKIPPED"** (or **"FAILED"**) with a
reason. Paraphrasing real output is fine; fabricating it is not.

### 3. No local `terraform` execution

This skill NEVER runs `terraform` locally — not `fmt`, `init`, `validate`,
`plan`, or `apply`. Validation routes through MCP (Step 6, `aliyun
iacservice validate-module` via `AlibabaCloud___CallCLI`). Plan and apply
belong to a separate skill — in the spec-ops workflow that is
`alibabacloud-executing-plans`, which runs through Alibaba Cloud IaC
Service rather than a local binary. See Step 8 for the handoff.

## Environment (soft recommendations)

- **MCP** — the `alibabacloud-spec-ops` MCP server must be reachable; all
  IaCService calls (Step 6 validation, Step 8 handoff context) go through
  `AlibabaCloud___CallCLI`. No local `terraform` binary is required.
- **Network** is required — Step 4.2 WebFetches each resource's provider doc.

## Workflow

### Step 1. Parse requirement

Extract:

- `region` — default `cn-hangzhou`.
- `resources[]` — `{ alicloud_type, quantity, attributes }`.
- Non-functional: multi-AZ, encryption, backup, HA, IOPS.

If ambiguous (e.g. "搭个数据库"), ask **at most one** clarifying question.

### Step 2. Resolve target directory

Extract `<target-dir>` from the user's request (explicit path like
`myshop-infra/` or current working directory if unspecified). All subsequent
`fmt` / `init` / `validate` commands run in this directory.

Before writing any `.tf` file, **MUST** create the directory:

```bash
mkdir -p <target-dir>
```

All file writes MUST prefix paths with `<target-dir>/` — never write to
the current working directory directly, never write to a generic `outputs/`
parent. After generation completes, verify the structure:

```bash
ls -R <target-dir>
```

### Step 3. Sketch architecture

Before any HCL, sketch a dependency table — one row per resource:

| resource | depends on | AZ / placement |
| --- | --- | --- |

- Expand `resources[]` with implied infra (VPC → VSwitch → SecurityGroup
  → workload); user parse often skips these.
- The expanded list is the input to Step 4's gate.

### Step 4. Pre-HCL gate (MANDATORY)

For every distinct `alicloud_*` type from Step 3 (resources **and** data
sources), execute 4.1 → 4.2 → 4.3. The calls per type are independent —
**issue them in parallel** across types.

#### 4.1 Pre-doc lookup (catalog + patterns, in parallel)

Two local lookups; **run them concurrently** before going to WebFetch:

**(a) Catalog lookup** — confirm the resource exists and check deprecation.
The catalog (`references/alicloud-providers.md`) is ~2600 lines; **do NOT
`Read` it whole** — use `grep`, which returns just the row(s) you need:

```bash
grep "alicloud_<name>" references/alicloud-providers.md
```

Three outcomes:

- **Row found, status column empty** → note the `[doc](<url>)` from the row;
  proceed to 4.2.
- **Row found, status `⚠️ 弃用 →`<new_name>`** → switch the plan to
  `<new_name>` and re-lookup. NEVER emit the deprecated name. Common catch:
  `alicloud_fc_function` → `alicloud_fcv3_function`.
- **Row not found** → stop. Ask the user whether the name was a typo;
  don't invent an `alicloud_<guess>`.

**(b) Pattern lookup** (conditional) — if the user's requirement matches a
product-specific idiom listed in `references/resource-patterns.md` (e.g.
RDS cross-AZ HA, OSS lifecycle noncurrent, VPC peering), read the
relevant section. These idioms are NOT in the provider doc's *Required*
list but are what the user actually wants (e.g. `zone_id_slave_a` for RDS
HA is optional per the doc but required for real cross-AZ placement).
Missing them produces "validates but silently wrong" output.

When a matching pattern section is found, **ALL attributes listed in that
section's "Required attributes" table MUST appear in the generated HCL**
— treat them as mandatory even if the provider doc marks them Optional.

```bash
# Quick check whether a relevant pattern exists, then Read only the section:
grep -in "<keyword>" references/resource-patterns.md
```

#### 4.2 Fetch provider doc (WebFetch)

WebFetch the doc URL from 4.1. If it fails or returns no useful content,
construct the raw URL directly from the catalog row's `doc` URL. Preserve
the catalog kind: resources use `website/docs/r/`, data sources use
`website/docs/d/`.

```
https://raw.githubusercontent.com/aliyun/terraform-provider-alicloud/master/website/docs/{r|d}/<doc_name>.html.markdown
```

**If both fail**, fall back to the local catalog row in
`references/alicloud-providers.md`. Prefix the recitation header with
`doc unreachable: used local catalog`. **Do NOT fetch any other URL** —
only the two URLs above or the local catalog are trusted sources.

#### 4.3 Recite (proof-of-read)

Before writing any HCL, emit and verify a complete per-resource brief:

- **Required** params (verbatim list from the doc, or from the local catalog
  if the 4.2 fallback was taken)
- **2–5 key Optional** params relevant to the user's requirement
- A minimal HCL snippet from the doc's "Example Usage" (omit with the note
  `no example available` only when the fallback was taken)

If Required or Optional params are missing, return to 4.2. Skipping or using
a partial recitation is a hard failure; WebFetch failure uses the 4.2 fallback,
not memory.

### Step 5. Generate

#### 5.1 Write HCL from the recitations, not memory

Use ONLY the params established in 4.3. If you need a param that wasn't in the
recited brief, re-fetch 4.2 with a deeper read; do not guess.

Before writing a field, look up the resource in
`references/deprecated-fields.md` (see §5.6 for the four row-kinds and
their handling rules):

```bash
grep '`alicloud_<resource>`' references/deprecated-fields.md
```

If the user's requirement touches a product with a specific usage pattern
(e.g. RDS cross-AZ HA, VPC peering, OSS lifecycle), also consult
`references/resource-patterns.md` for the non-obvious attributes.

#### 5.2 Data-source enforcement (MANDATORY — no hardcoded IDs)

Resolve via `data` blocks, never literals. These also pass Step 4's gate:

- `zone_id` → `data "alicloud_zones"` (filter by `available_resource_creation`).
- `image_id` → `data "alicloud_images"` (filter by `name_regex`, `owners = "system"`, `most_recent = true`).
- `instance_type` → `data "alicloud_instance_types"` (filter by `cpu_core_count`, `memory_size`, AZ).

#### 5.4 Provider block (content contract)

Two Terraform blocks must appear **somewhere** in the project's `*.tf`
files. Terraform merges all `*.tf` in a directory, so *file organization
is a style choice, not a contract* — see "File organization" below.

**Block 1 — `terraform { required_providers {} }`**:

```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    alicloud = {
      source  = "aliyun/alicloud"
      version = "~> 1.274"
    }
  }
}
```

- Provider version: resolve the latest published stable `aliyun/alicloud` 1.x
  version, then write a pessimistic minor constraint (`1.278.0` -> `~> 1.278`).
  Lookup sources, in order:
  1. `https://registry.terraform.io/v1/providers/aliyun/alicloud/versions`
  2. `https://registry.terraform.io/providers/aliyun/alicloud/latest`
  3. `https://github.com/aliyun/terraform-provider-alicloud/releases` or
     `https://github.com/aliyun/terraform-provider-alicloud/tags`
- If lookup fails, fall back to `~> 1.274`. Accepted form is `~> 1.<minor>`
  from a confirmed published 1.x release. Do NOT write open-ended constraints
  (`>= 1.x`, `>= 1.239.0`) or bare version strings.

**Block 2 — `provider "alicloud" {}`** with BOTH `region = var.region`
and `configuration_source`:

```hcl
provider "alicloud" {
  region               = var.region
  configuration_source = "AlibabaCloud-Agent-Toolkit/alibabacloud-spec-ops"
}
```

- `configuration_source` is the attribution signature — required.
- `region` MUST reference `var.region`, not a hardcoded literal.

**File organization (recommended, not required)**: conventional split is
`terraform.tf` (Block 1) + `providers.tf` (Block 2). Also acceptable:
a single `versions.tf` containing both blocks, or either block at the
top of `main.tf`. Pick what fits the project — Terraform merges all
`*.tf` equivalently. Do NOT add a filename check; run the content check
below instead.

**Post-generation verification (cross-file content grep)**:

```bash
# 1. required_providers has aliyun/alicloud with a ~> 1.<minor> version
awk '
  /required_providers[[:space:]]*{/ { in_req=1 }
  in_req && /alicloud[[:space:]]*=[[:space:]]*{/ { in_ali=1 }
  in_ali && /source[[:space:]]*=[[:space:]]*"aliyun\/alicloud"/ { source=1 }
  in_ali && /version[[:space:]]*=[[:space:]]*"~>[[:space:]]*1\.[0-9]+"/ { version=1 }
  in_ali && /^[[:space:]]*}/ { in_ali=0 }
  END { exit(source && version ? 0 : 1) }
' <target-dir>/*.tf \
  && echo OK_VERSION || echo BAD_OR_MISSING_VERSION

# 2. configuration_source attribution present somewhere
grep -Rq 'configuration_source = "AlibabaCloud-Agent-Toolkit/alibabacloud-spec-ops"' \
  <target-dir>/*.tf \
  && echo OK_CFG_SOURCE || echo MISSING_CFG_SOURCE

# 3. region uses variable, not hardcoded
grep -Rq 'region\s*=\s*var\.region' <target-dir>/*.tf \
  && echo OK_REGION_VAR || echo HARDCODED_REGION
```

All three must return OK. If any fails, fix the offending content and
re-run — do NOT proceed to Step 6 with failures.

#### 5.5 Style baseline

- 2-space indent; `=` aligned within a block; snake_case semantic resource labels
  (`alicloud_vswitch.app_a`, not `vsw1`).
- Every tag-supporting resource should carry a non-empty `tags` block for ops
  hygiene — pick reasonable keys for the scenario (common choices:
  `ManagedBy`, `Project`, `Environment`, `CreatedBy`). Skill does not
  prescribe specific tag keys or values.

#### 5.6 Deprecated-field audit — static grep pass (MANDATORY)

Run before `terraform` is needed — this is a pure-grep pass on the HCL you
just wrote. For every resource in this generation, grep the project against
`references/deprecated-fields.md` and handle each row-kind:

- **rename** row → if the old field name appears in HCL you just wrote,
  replace it with the new field name. Examples that show up most often:
  - `alicloud_ram_role`: `name` → `role_name`,
      `document` → `assume_role_policy_document`
  - `alicloud_security_group`: `name` → `security_group_name`
  - `alicloud_db_database`: `name` → `data_base_name`
- **split / soft-split** row → do NOT write the inline field on the parent.
  Declare the replacement sub-resource only when the user's requirement
  needs that capability, or when `references/resource-patterns.md` says the
  sub-resource has an explicit safe default. Example: for OSS buckets,
  `alicloud_oss_bucket_acl` defaults to `private`, but logging/CORS/website
  sub-resources are omitted unless the user asks for those features.
- **deprecated-no-replacement** row → stop using the field, no substitute.

Applies only to files written in this generation — do NOT refactor
pre-existing user files you weren't asked to touch.

**Post-audit verification (bash grep — must return all OK)**:

```bash
# Walk deprecated-fields.md row by row and check whether any deprecated
# field that applies to a generated resource is still in use.
# Uses awk to extract individual resource blocks before field matching,
# so that short field names (name, document) don't falsely match
# substrings in compound field names (role_name, policy_document).
grep '| `alicloud_' references/deprecated-fields.md | while IFS='|' read _ resource field kind _; do
  resource=$(echo "$resource" | tr -d ' `')
  field=$(echo "$field" | tr -d ' ')
  kind=$(echo "$kind" | tr -d ' ')
  # Only check if this resource exists in the generated HCL
  if grep -Rq "resource \"$resource\"" <target-dir>/*.tf; then
    case "$kind" in
      rename|deprecated-no-replacement)
        awk -v res="$resource" -v fld="$field" '
          $0 ~ "resource \"" res "\"" { in_block=1; next }
          in_block && /^}/ { in_block=0 }
          in_block && $0 ~ "(^|[^_[:alnum:]])" fld "([^_[:alnum:]]|$)" { found=1; exit }
          END { exit found ? 0 : 1 }
        ' <target-dir>/*.tf \
          && echo "DEPRECATED: $resource.$field" || echo "OK: $resource.$field"
        ;;
      split|soft-split)
        grep -q "\b$field\b\s*=" <target-dir>/*.tf \
          && echo "DEPRECATED: $resource.$field (inline — use standalone sub-resource)" \
          || echo "OK: $resource.$field (not inline)"
        ;;
    esac
  fi
done
```

**HARD GATE: must pass before Step 6** — If the script above produces
any `DEPRECATED:` line:

1. Read each `DEPRECATED:` line — it names the resource and field.
2. Look up that resource+field in `references/deprecated-fields.md`
   to get the **Action** column (rename target, split sub-resource,
   etc.).
3. Apply the fix in the HCL.
4. Re-run the verification script.
5. Repeat until **every line returns `OK:`**. This is a blocking gate —
   do NOT proceed to Step 6 with any `DEPRECATED:` output. Do NOT claim
   "verified" unless the script produces all `OK:`.

### Step 6. Validate via IaCService (remote, MCP)

NEVER run `terraform fmt`, `terraform init`, or `terraform validate`
locally. Validation runs server-side through the MCP tool
`AlibabaCloud___CallCLI` (fully qualified:
`mcp__plugin_alibabacloud-spec-ops_alibabacloud-spec-ops__AlibabaCloud___CallCLI`)
with `aliyun iacservice validate-module`. The IaCService backend performs
Terraform syntax and schema validation without requiring a local
Terraform binary, network access to `registry.terraform.io`, or backend init.

**Single-file project** (`--code` with HCL text):

```bash
aliyun iacservice validate-module \
  --client-token <uuid> \
  --source Upload \
  --code "<full HCL of the single .tf file>"
```

**Multi-file project** (`--code-map` with JSON map of `filename → content`,
RECOMMENDED whenever the project has more than one `.tf` file):

```bash
aliyun iacservice validate-module \
  --client-token <uuid> \
  --source Upload \
  --code-map '{"main.tf":"<hcl>","providers.tf":"<hcl>","variables.tf":"<hcl>"}'
```

Parameter notes:

- `--client-token` — UUID, format `[0-9a-zA-Z-]{1,64}`; generate a fresh UUID per call (idempotency key)
- `--source` — must be `Upload` for inline text
- `--code` and `--code-map` — mutually exclusive; prefer `--code-map` for multi-file projects so every file is validated together

**Loop until validate passes** (max 3 fix attempts total):

1. Parse the IaCService response. If there are **errors / diagnostics with
   severity `error`** → fix the offending file in `<target-dir>/`,
   regenerate the `--code` or `--code-map` payload, then go to step 3.
2. Scan the response diagnostics for `[DEPRECATED]` strings. The provider
   emits authoritative deprecation annotations (e.g. `"document":
   "[DEPRECATED] … New field 'assume_role_policy_document' instead."`).
   If found → fix the matching field, then go to step 3.
3. Re-invoke `aliyun iacservice validate-module` via
   `AlibabaCloud___CallCLI` and go back to step 1.

Exit the loop only when validate reports **no errors AND no `[DEPRECATED]`
diagnostics**. After 3 attempts without reaching this state: proceed to
Step 7 with `Validation: FAILED (<diagnostic excerpt>)` and include the
failing HCL verbatim in the optional notes.

**If the MCP CallCLI fails** (auth, network to OpenAPI endpoint, or
IaCService backend unavailable): do NOT fall back to local `terraform
validate`. SKIP this step and surface the failure in Step 7's summary
(Hard rule §2) with
`Validation: SKIPPED (iacservice validate-module unavailable — <reason>)`.

### Step 7. Coverage check + summarize

**MANDATORY — runs regardless of generation outcome.** Even if earlier
steps were interrupted (init network failure, validate loop exhausted,
terraform not on PATH), this step MUST execute. The `Files written:`
and `Validation:` lines are the final contract with downstream
evaluators — skipping them is a hard failure.

**Coverage check.** Enumerate resource blocks in the generated HCL and compare
with Step 3's sketch. If any sketch row is missing, return to Step 5 and add it
— do not skip a row because "the user didn't explicitly name it".

**Summary template** — print in the user's language, using **exactly this
structure** (fill `<bracketed>` placeholders, keep the two line labels
`Files written:` and `Validation:` verbatim):

```
Files written:
<path/to/file1>
<path/to/file2>
...

Validation: <one-of-four-exact-strings-below>

Deprecation routing: <If re-routed: `<original_name>` → `<new_name>`; else: None>

<optional: architecture notes, design decisions, deploy hints — free-form
here is fine, but NOT inside the lines above>
```

The `Validation:` line must be **one of these exact strings**, chosen from
what actually happened in Step 6. Do NOT paraphrase or fold it into prose:

- `Validation: iacservice validate-module: ok`
- `Validation: SKIPPED (iacservice validate-module unavailable — <reason>)`
- `Validation: SKIPPED (<reason>)`
- `Validation: FAILED (<diagnostic excerpt>)` — after 3 retries hit the cap

Edge cases:

- MCP CallCLI returns an auth error → `Validation: SKIPPED (iacservice validate-module unavailable — auth)`
- MCP CallCLI times out → `Validation: SKIPPED (iacservice validate-module unavailable — timeout)`
- IaCService returns 5xx → `Validation: FAILED (iacservice 5xx: <message>)`

### Step 8 (internal). Where execution belongs — DO NOT narrate to user

> **This step is guidance for the model, not a user-facing message.**
> The skill's user-facing output ends with the Step 7 summary
> (`Files written: …` + `Validation: …`). Do NOT add an extra
> paragraph saying you are "returning to the upstream caller",
> "handing off to {next skill}", "control flow", etc. — that leaks
> internal orchestration and confuses the user.

This skill does NOT run `terraform plan` or `terraform apply` —
neither locally nor remotely. Execution belongs to a separate skill.

For the model's internal awareness only, the spec-ops chain is:

```
alibabacloud-planning
  → alibabacloud-writing-plans
    → alibabacloud-terraform-codegen   ← this skill, ends at Step 7
      → alibabacloud-validate
        → alibabacloud-executing-plans (plan/apply via IaC Service)
```

After Step 7 emits the summary, simply stop. Whoever invoked this
skill — the upstream `writing-plans` skill in the normal flow, or the
user directly in standalone use — will see the Step 7 summary as the
return value and decide the next action. The user's next interaction
will be driven by that caller, not by this skill.

**Standalone use:** if the user invoked this skill directly and now
asks how to actually deploy, name the deployment skill in plain
language — for example: "生成完成。要把这些资源真正创建到云上，可以通过
`alibabacloud-spec-ops:alibabacloud-executing-plans` 远程执行 plan
和 apply。要现在进入这一步吗？" Never read or print AK/SK values from
this skill (Hard rule §1).

**FORBIDDEN user-facing phrases** (do not emit any of these, in any
language):

- "Returning to upstream caller"
- "Returning control to {skill}"
- "Handing off to {skill}"
- "Handoff complete"
- "Control returns to …"
- Any sentence whose subject is the skill orchestrator rather than
  the user or the work product

## IaCService API Reference (via MCP)

All IaCService calls are invoked through MCP tool
`AlibabaCloud___CallCLI` (fully qualified:
`mcp__plugin_alibabacloud-spec-ops_alibabacloud-spec-ops__AlibabaCloud___CallCLI`).
Do NOT shell out to `aliyun` locally — every command in this table goes
through the MCP CallCLI tool.

| API | CLI Command | Purpose |
| --- | ----------- | ------- |
| ListProducts | `aliyun iacservice list-products` | List all Alibaba Cloud products that support Terraform |
| ListResourceTypes | `aliyun iacservice list-resource-types --product <product>` | List Terraform resource types for a specific product |
| GetResourceType | `aliyun iacservice get-resource-type --resource-type <resourceType>` | Get all attributes and schema for a Terraform resource type (e.g. `alicloud_vpc`); usable as an alternative to the Step 4.2 WebFetch when the live provider doc is unreachable |
| ValidateModule | `aliyun iacservice validate-module --source Upload --code <hcl>` (single file) or `--code-map '{<file>: <hcl>, ...}'` (multi file) | Validate Terraform syntax and schema server-side without execution — used by Step 6 |

**`validate-module` parameter reference:**

| Param | Type | Notes |
| --- | --- | --- |
| `--client-token` | string `[0-9a-zA-Z-]{1,64}` | Idempotency key, UUID recommended |
| `--code` | string | When `--source=Upload`, the full HCL text of a single file |
| `--code-map` | JSON string `{<filename>: <hcl>, ...}` | Multi-file upload; mutually exclusive with `--code` |
| `--source` | enum | `Upload` for inline text |
| `--source-path` | string | Source path (when applicable to other source types) |

## References

| Source | When to read |
| --- | --- |
| `references/alicloud-providers.md` (local) | Step 4.1 — resource existence, deprecation mark, doc URL |
| Provider doc (WebFetch of the URL from 4.1) | Step 4.2 — authoritative Required / Optional per resource |
| `references/deprecated-fields.md` (local) | Step 5.1 + Step 5.6 — known field-level renames not flagged by IaCService `validate-module` |
| `references/resource-patterns.md` (local) | Step 5.1 — product-specific idioms not emphasized by the provider doc (RDS HA, …) |
| `references/auth-and-network.md` (local) | Background reference on credential chain; this skill does not consume credentials itself (Hard rule §1) |

The local catalog is one markdown table row per `alicloud_*` resource and
data source, with a `[doc](<url>)` cell and, for deprecated entries, a
`⚠️ 弃用 →`<new_name>`` marker. It is generated from the upstream provider
repo by `scripts/build_alicloud_providers.py`; re-run that script when a new
`aliyun/alicloud` release introduces or shifts deprecations.
