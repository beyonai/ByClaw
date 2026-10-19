# @zhchxiao123/dsh-devflow-parent-gate

English | [中文](README.zh.md)

Completion policy for decomposed requirements on the [`ctx.devflow`](../devflow/README.md) seam: a card with child cards reaches `done` only after every child does. The plugin is a pure Consumer on the `devflow/transition` waterfall — it adds no state machine, no stage, and no store operation; a requirement's completion stays a fact derived from its slices.

## Behavior

The listener decides one edge: a move whose target is `done`. It lists the moving card's children in the card's own root and vetoes while any of them sits anywhere but `done`, naming each unfinished child and its current stage so the caller learns what is left. Every other edge, and every card without children, delegates untouched.

The rule sits on `-> done` alone rather than earlier in the pipeline, which leaves a parent's own `reviewing` and `testing` free for the integration pass over the finished slices. A veto is not a commit: the card stays where it was, at its revision, with no journal entry.

Composition is one line beside the store; without this plugin the parent/child relation still works, only unenforced.

```yaml
- id: devflow
  name: '@zhchxiao123/dsh-devflow-filesystem'
- id: devflow-parent-gate
  name: '@zhchxiao123/dsh-devflow-parent-gate'
```

The invariant companion validates the same rule against the notification stream: no `devflow/stage-changed` settles a card at `done` while a child the stream has seen is elsewhere, keyed on root + id like every other devflow relation.

## Model Experience

None, as the completion veto reaches a model only through the devflow tools' rejection text; this plugin registers no prompt or schema.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The gate does not move the parent** — when the last child finishes, a human or the model still commits the parent's own moves; the policy only refuses a premature `done`.
- **A child created after its parent settled is impossible, not reconciled** — the store rejects that creation (`parent-settled`) and runs it under the parent's own card chain, so a creation cannot interleave with the `-> done` this gate decides; the plugin never has to reason about a parent that finished too early.
