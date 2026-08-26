# Decouple Knowledge Collection From Downstream Actions

## Goal

Make `knowledge-collection` a collection-only capability. It discovers, collects, materializes, and reports source material, then hands validated `sanitized/items/` files back to the orchestrating agent. It must not perform or coordinate knowledge-base ingest, knowledge organization, or any other downstream action.

## Agent boundary

The intended topology is:

- Agent A owns `knowledge-collection` and stops after producing a collection delivery.
- The parent agent chooses Agent B or another agent for ingest, knowledge organization, or any later action.
- Agent A does not select a downstream agent, select a knowledge base, upload content, rewrite links for a downstream system, track downstream results, or clean the session in response to downstream results.

The only content files Agent A may advertise as downstream input are validated, materialized Markdown files below `<session-dir>/sanitized/items/`. Candidate metadata, raw artifacts, `markdown/` work copies, missing files, pending items, and failed items are not downstream input.

## Command surface

Keep collection and research commands needed to create and inspect deliverables, including discovery, `init`, research planning and reporting, `collect`, read-only inspection/status, crawl state, enterprise collection, and exported collection views.

Remove these knowledge-base commands from the unified CLI and command schema:

- `list-kb`
- `ingest`
- `store`
- `upload-doc`
- `upload-images`
- `upload-resource`

Remove these downstream lifecycle commands:

- `run`
- downstream-result-driven `cleanup`
- `set-retention`
- `rewrite-image-links`

`inspect` becomes strictly read-only and no longer accepts downstream operation/target selection or cleanup flags. Collection-internal handling of superseded or invalid materialization remains allowed where it is necessary to keep the canonical collection view correct; it must not depend on a downstream run.

## Delivery contract

The human-facing skill instructions must end the collection flow with a stable handoff summary containing:

- effective source scope and materialization target;
- session directory;
- source record, duplicate group, materialized, pending, and failed counts;
- exact downstream input files under `sanitized/items/`;
- provenance and coverage gaps;
- an explicit statement that downstream actions belong to another agent or skill.

The machine-readable status output adds `downstreamInput` with a versioned, minimal contract:

```json
{
  "downstreamInput": {
    "schemaVersion": "1.0",
    "directory": "<absolute-session-dir>/sanitized/items",
    "files": ["<absolute-session-dir>/sanitized/items/example.md"]
  }
}
```

Every listed file must be a regular Markdown file whose validated relative path is within `sanitized/items/`. The array may be empty. Pending and failed inventory entries remain visible in the surrounding status summary but are never included in `downstreamInput.files`.

No downstream operation name, knowledge-base identifier, target directory, image upload mapping, cleanup instruction, or downstream execution state belongs in this contract.

## State and compatibility

New collection sessions no longer use downstream `postProcessing.runs` as an active state machine. The collection status is derived only from collection inventory and materialization state.

Historical sessions containing post-processing fields remain readable so existing collection artifacts are not stranded. Compatibility code may normalize or ignore those legacy fields, but no public command may create, update, resume, or clean a downstream run. Removed command invocations fail as unknown commands.

Collection sessions and their local images are preserved after delivery. If a downstream agent requires durable image URLs, upload, transformation, or eventual deletion, that agent owns the operation and its lifecycle.

## Files and references

Delete the knowledge-base implementation and tests owned by this skill, including the ingest entry points, ingest-specific tests, and `knowledge-ingest.md`. Remove knowledge-base and downstream-action entries from the reference manifest and rewrite `post-processing.md` into a collection delivery/handoff reference, or replace it with a clearly named delivery reference.

Update repository-level skill contract tests so they assert the new collection-only boundary rather than the former ingest bridge. Keep `by-knowledge-manager` and `knowledge-organizer` unchanged; they remain independent downstream skills available to Agent B.

## Error handling

- Invalid or missing materialized paths are downgraded to `pending` through the existing safe recovery rules and omitted from downstream input.
- A requested `materializationTarget=all` is complete only when every requested body is materialized; otherwise pending and failed counts remain visible.
- Removed knowledge-base and downstream lifecycle commands return the unified CLI's normal unknown-command error.
- The collection agent must not compensate for missing downstream capabilities by reading `markdown/`, choosing a knowledge base, or invoking another downstream skill itself.

## Testing

Use test-first changes to prove:

1. Removed commands are absent from help and command schema and fail as unknown commands.
2. Knowledge-base scripts and references are no longer required by the skill contract.
3. `inspect` has no mutating or downstream-operation arguments.
4. `status.downstreamInput.files` contains only validated, materialized Markdown files under `sanitized/items/`.
5. Pending, failed, missing, non-file, and out-of-scope paths are excluded from downstream input while remaining visible in status counts and warnings.
6. Delivery does not delete the session or mutate downstream state.
7. Existing research, crawl, public discovery, enterprise collection, materialization, and export-view tests continue to pass.

## Non-goals

- Changing `by-knowledge-manager` or `knowledge-organizer` behavior.
- Defining how the parent agent selects Agent B.
- Defining a cross-agent transport protocol beyond the stable session path and file list.
- Uploading images or rewriting Markdown for a specific downstream system.
- Migrating or deleting users' historical session files.
