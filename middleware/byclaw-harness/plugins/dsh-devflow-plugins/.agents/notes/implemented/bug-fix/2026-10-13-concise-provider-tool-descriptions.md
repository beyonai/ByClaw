# Agent Note: Concise provider-facing tool descriptions

Status: implemented

English | [中文](2026-10-13-concise-provider-tool-descriptions.zh.md)

## Problem

Bailian can reject a chat request with `400 data_inspection_failed` before tool execution. Replays of one request with seven messages and 66 tools returned this error in three of five original-description trials. The error alone does not identify a schema defect, a forbidden phrase, or a provider length limit.

## Decision

`devflow_record_iron_rule`, `devflow_read_spec`, and `prepare_group_task_publication` use concise Chinese descriptions, including their input-field descriptions. Their top-level descriptions have 100, 71, and 161 characters respectively. Tool names, input and output schemas, execution, scope, permissions, and injection order retain their existing definitions.

Recording guidance retains confirmed-rule triggers, code and duplicate checks, durable storage, script versus judgement requirements, read-only checks, and protected administrator rules. Reading guidance requires checking stale documents against code. Publication guidance retains user intent, whole-content replacement, explicit confirmation, file eligibility, and the prohibition on claiming a completed publication.

The [iron-rules port](../feature/2026-09-03-devflow-iron-rules-port.md) still owns persistence and enforcement; this note owns the recording description's language and provider-facing wording.

## Alternatives considered

**Remove the tools.** This avoids transmitting their definitions but removes supported capabilities and does not isolate the cause of provider rejection.

**Change parameter schemas or tool order.** The replay uses identical non-description fields and ordering. Changing those fields would add another variable without evidence that they need repair.

**Assume a fixed character limit or guaranteed acceptance.** The original request sometimes succeeds. The observations support this particular wording, not a documented limit or universal cure.

## Consequences

Five interleaved trials of the concise descriptions accepted the request and started an HTTP 200 SSE stream; original descriptions accepted two of five. These trials stop after initial stream data and do not prove completed answers or model-selected tool calls. Chinese language, wording, and length change together, so the experiment does not isolate which one explains the improvement. Full request captures and credentials remain outside version control.

Loader-composition tests pin guidance and schema constraints. Existing execution tests cover rule persistence and rejections, spec reading and stale anchors, publication validation, scoped registration, durable activation, resume, and teardown. The publication session test uses the current read-only persistence handle API and starts lifecycle checks with empty storage so its awaited-write assertion reaches a real write. Local checks verify implementations; production model behavior still requires observation after deployment.
