# ACP Metadata-First Bootstrap Design

## Goal

Make the complete generated `metadata.md` the authoritative business-rule manual for every downstream ACP client. The client must receive, read, acknowledge, and apply that manual before it can inspect or execute the real user query. The mechanism must remain generic when future metadata sections and business rules are added.

## Current Problems

The current planner embeds the user query near the start of `plan.task` and only later tells the ACP client to read `metadata.md`. This permits work to begin before business rules are loaded. The task supplies file paths but has no integrity manifest, no immutable per-dispatch snapshot, no fail-closed bootstrap state, and no receipt describing which rule source and referenced resources were loaded.

The adapter must not implement section-specific parsing for `Response Language`, `Session Files`, `Linked Skills`, or any other current heading. Those are examples of business rules, not protocol fields.

## Authority and Precedence

The downstream instruction precedence is:

1. System and safety constraints.
2. The complete `metadata.md` business-rule manual.
3. The user query in `query.md`.
4. Model defaults.

The entire metadata document is authoritative. A rule does not need a known heading to participate. Instructions in the user query cannot waive the bootstrap protocol or override metadata business rules.

## Per-Dispatch Immutable Snapshot

Each plan materializes an isolated run directory below the existing byai-channel session directory:

```text
<sharedDir>/runs/<bootstrapId>/
  metadata.md
  query.md
  clients/<client>.md
  bootstrap-contract.json
  bootstrap-receipt.json
  plan-bundle.json
```

`sharedDir` remains scoped by the real byai-channel session ID. `bootstrapId` is unique per plan, so concurrent calls in one business session do not overwrite each other's query, rules, bundle, contract, or receipt.

## Bootstrap Contract

`bootstrap-contract.json` describes the protocol and artifact integrity without interpreting metadata semantics:

```json
{
  "protocolVersion": 1,
  "bootstrapId": "agent-11000145-...",
  "policy": "fail-closed",
  "precedence": [
    "system-and-safety",
    "metadata-business-rules",
    "user-query",
    "model-defaults"
  ],
  "metadata": {
    "path": "/absolute/run/path/metadata.md",
    "sha256": "...",
    "bytes": 28642,
    "required": true,
    "readMode": "complete-to-eof"
  },
  "clientInstructions": {
    "path": "/absolute/run/path/clients/claude-code.md",
    "required": true
  },
  "query": {
    "path": "/absolute/run/path/query.md",
    "readAfterBootstrap": true
  },
  "receipt": {
    "path": "/absolute/run/path/bootstrap-receipt.json",
    "requiredStatus": "READY"
  }
}
```

The adapter verifies that required artifacts are non-empty, reside in the run directory, and match the recorded metadata byte count and SHA-256 before dispatch.

## Delegation Content

`buildCallAgentContentFromPlan` no longer returns `plan.task` unchanged. It validates the bootstrap contract and builds a metadata-first delegation envelope.

The envelope contains, in order:

1. A prohibition on reading the query, planning, invoking subagents, modifying business files, or producing business conclusions before bootstrap reaches `READY`.
2. The contract path, metadata path, expected byte count, expected SHA-256, receipt path, and fail-closed rules.
3. The complete metadata content, delimited as a trusted business-rule manual, before any user task content.
4. Instructions to read the on-disk metadata from byte zero to EOF, verify its integrity, and obey the entire document without relying on known section names.
5. Instructions to load every resource that metadata marks as required for the current task, including skills, workflow material, configuration, or future resource types.
6. Instructions to write a `READY` or `BLOCKED` bootstrap receipt.
7. The query path. The real query text is not embedded in the pre-bootstrap portion of the task.

Inlining the complete metadata ensures rule visibility in the one-shot asynchronous protocol. The on-disk artifact remains authoritative and supplies integrity evidence.

## Downstream Receipt

The downstream client writes `bootstrap-receipt.json` before reading the query:

```json
{
  "protocolVersion": 1,
  "bootstrapId": "...",
  "status": "READY",
  "metadata": {
    "path": ".../metadata.md",
    "expectedSha256": "...",
    "actualSha256": "...",
    "expectedBytes": 28642,
    "actualBytes": 28642,
    "readToEof": true
  },
  "acknowledgedRules": [
    {
      "source": "metadata.md",
      "summary": "Business constraints acknowledged for this task"
    }
  ],
  "referencedResources": [],
  "blockers": [],
  "createdAt": "2026-07-21T00:00:00.000Z"
}
```

If metadata is missing, truncated, changed, unreadable, or requires a resource that cannot be loaded, the receipt status is `BLOCKED`. The client must not inspect or execute the query in that state. Optional resources remain governed by their wording in metadata; the adapter does not invent requiredness.

## Components

### `src/metadata-bootstrap.ts`

Owns the generic protocol:

- Bootstrap contract, artifact, and receipt types.
- Metadata byte count and SHA-256 calculation.
- Run-directory containment checks.
- Contract materialization and validation.
- Metadata-first delegation-envelope rendering.

It does not parse metadata headings or implement business rules.

### `src/planner.ts`

Owns plan data:

- Creates `sharedDir/runs/<bootstrapId>`.
- Renders metadata once, writes it atomically, and passes the exact content to the bootstrap component.
- Writes query, client instructions, plan bundle, and bootstrap contract into the isolated run directory.
- Adds `runDir`, `bootstrapId`, contract path, receipt path, and metadata integrity fields to the bundle's `sharedContext`.
- Changes the generic task so metadata bootstrap precedes query access.

### `src/call-acp-agent-tool.ts`

Owns dispatch:

- Calls `buildCallAgentContentFromPlan` before invoking `executeViaCallAgent`.
- Returns `ACP_METADATA_BOOTSTRAP_INVALID` without dispatch when the contract or artifact validation fails.
- Preserves the current session, language, Langfuse, and async call-agent behavior.

### `src/constants.ts` and `src/types.ts`

Add protocol version, run-directory names, artifact file names, and typed bootstrap structures. Existing public plan fields remain compatible; bootstrap details are added to bundle metadata.

## Error Handling

Adapter-side failures are fail-closed and occur before remote dispatch:

- Empty or missing metadata.
- Metadata read-back digest or byte mismatch.
- Contract, query, client-instruction, or plan-bundle path escaping the run directory.
- Missing bootstrap contract fields.
- Delegation envelope failing to place the business-rule manual before query access.

Downstream failures produce a `BLOCKED` receipt and no business execution:

- Cannot read metadata to EOF.
- Digest or byte mismatch.
- Cannot interpret the rule manual sufficiently to proceed.
- Cannot load a resource that metadata makes mandatory.

## Compatibility and Enforcement Boundary

The generated metadata structure stays compatible. Existing headings and JSON blocks are retained. The new protocol treats them as opaque content.

In the current one-shot asynchronous `executeViaCallAgent` flow, the adapter can guarantee that validated complete metadata appears before the query in the model input. It cannot independently prove the model's internal reading behavior before the remote worker responds. A future two-phase worker protocol can use the same contract and receipt: send bootstrap, validate `READY`, then send the query as a second message.

## Testing

Tests must cover:

- Metadata precedes every query reference in delegation content.
- Real query text is absent from the pre-bootstrap task.
- Unknown future metadata headings pass through unchanged.
- Recorded SHA-256 and bytes match the exact written file.
- Empty, missing, changed, or path-escaping metadata blocks dispatch.
- The prompt requires complete-to-EOF reading and a `READY` receipt.
- The prompt handles referenced resources generically rather than naming current metadata sections.
- Two plans in one channel session use different run directories.
- Existing agent, team, workflow, loop, language, Session Files, linked-skill, and model configuration tests remain green.

## Documentation

Update the adapter README with the metadata-first bootstrap flow, artifact layout, fail-closed behavior, receipt contract, and one-shot enforcement boundary.
