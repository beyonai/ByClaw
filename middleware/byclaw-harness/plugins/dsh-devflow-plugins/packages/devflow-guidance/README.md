# @zhchxiao123/dsh-devflow-guidance

Model guidance for the devflow workflow, in two layers. The [`devflow_*` tools](../devflow-tool/README.md) teach single-call protocol in their descriptions and the gates enforce it; nothing in that surface owns the **cross-tool** process knowledge or answers "does this workspace have a board at all" at the start of a session. This package adds both: bundled skills (judgment, loaded on demand — `devflow-workflow` for the card workflow, plus `devflow-spec-authoring` and `devflow-spec-bootstrap` for architecture documents while the composition mounts the `devflowSpec` seam) and the `devflow-board` runtime context (awareness, resident while a board exists).

Neither layer carries obligations. Per-call protocol (the `stageRevision` optimistic-concurrency token, reading a card before moving it) stays in the tool descriptions, and enforcement stays with the store and the transition policies — a deployment where the model never loads the skill, or that suppresses runtime context, loses guidance, never a guarantee.

## Behavior

**The skills.** `apply` registers the `devflow-workflow` provider on `ctx.skills` as an effect of the plugin fiber, and the `devflow-spec-authoring` and `devflow-spec-bootstrap` providers on a conditional child (`ctx.inject(['devflowSpec'], …)`) that activates whenever the spec seam is composed and unwinds with it — a composition without `devflow_write_spec` / `devflow_read_spec` never advertises the skills that teach them. Each candidate is registered at `BUNDLED_SKILL_RANK` with `{ modelInvocable: true, userInvocable: true }`, so it appears in the model's `<available_skills>` catalog, loads through the `skill` tool, and answers the `/devflow-workflow` (or `/devflow-spec-authoring`, `/devflow-spec-bootstrap`) user gesture. A deployment overrides a body by registering a same-layer provider under the same name with a lower rank; a nearer-scope provider shadows it regardless of rank. The bodies ship as `assets/<name>.md`. `devflow-workflow` deliberately does not enumerate this deployment's required artifact kinds — those differ per deployment and every applicable tool result already carries the artifact-gate preflight, which the skill names as the authority. It also owns the judgment about ending a card: filing a finished one, parking one that is stuck, and dropping one that will not be built are three different outcomes with three different reversibilities, and all three are human decisions on the `/devflow` plane — what the model does with them is tell them apart, and read the archive of what was already filed. `devflow-spec-authoring` owns the judgment the spec tools cannot: what deserves a document versus an iron rule, anchor choice as a writability-then-strength question, id scoping, revision through `replaces`, and the response to a stale read. `devflow-spec-bootstrap` owns the cold-start procedure for a scope the `/devflow spec` census reports with no document — one scope at a time, claims established from the code rather than legacy documents, a verdict on every candidate claim before any prose is drafted (the count falls out of those verdicts, and the skill sets no floor under it any more than it sets a ceiling over it), an orienting document first and never a hand-written `index.md`, `content-hash` for the behavioral claims a bootstrapping pass writes all at once, at most a few documents in one pass with the census's anchorable-file count as the way back to a large scope, when the honest answer is a waiver instead of a document, a closing report naming what the pass covered and how many scopes the census still reports uncovered, plus the churn-only expectations of a scope in a language without an anchor evaluator, where the turn-end sentinel never fires and the census is the only staleness backstop — and defers the authoring judgment and the write protocol to the two skills that own them. Its closing branch is opt-in and unnumbered: a run whose gaps outlast one pass may take a parent card per repository and a child card per scope, so the pass's candidate list and verdicts become a registered artifact an independent checker can judge, and it states in the same breath that the board is never a second answer to the census's coverage question — the [deployment sample](../../docs/devflow.md#bootstrapping-on-the-board) is the configuration behind it.

**The board snapshot.** An `agent/pre-step` listener (delegate-first; it never takes the step decision) reads the calling session's workspace board — `ctx.devflow.list()` on a workspace without `.devflow/` is one failed readdir with no side effects — plus one `holder()` read per card, renders a snapshot, and caches it by devflow root; a synchronous `ctx.systemPrompt.context()` provider (name `devflow-board`, order 200) serves the cached text for the assembling agent's `session.header.cwd` and contributes `''` without an agent, a cwd, or a board. The harness diffs the joined runtime-context snapshot per step, so an unchanged board is never re-sent. There is deliberately no store-event subscription: the seam emits only on create and transition (abandon, artifact, and archive appends fire nothing), while assembly always follows a pre-step, so the per-step refresh closes that gap and leaves an event listener nothing to add.

The snapshot is capped at 1024 bytes (`SNAPSHOT_MAX_BYTES`): it is awareness, not a board mirror, and every byte is resent whenever any runtime context changes. Over the cap, claimed-card lines are dropped from the end and the drop is announced in the text. Every card-derived line is sanitized so a `{{...}}` pair cannot reach the prompt renderer's strict variable interpolation. Claimed cards render without a "claimed by you" qualifier: the rendered text is cached per workspace root and served to every agent in it, and `list()` carries no lease identity to compare.

## Configuration

None. The skill body is capability prose, not deployment policy; the override path above is the customization surface. The snapshot cap is a documented constant of the awareness contract.

## Model Experience

### Skill catalog entries

#### What the model sees

One `<available_skills>` line per bundled skill (rendering owned by the harness's skill catalog). While the plugin is mounted:

> Drive the devflow card workflow: decide when work belongs on the board, pick a service class, decompose an oversized requirement, write artifacts the gates can judge, and choose the rework path after a veto. Use when the user asks to turn a discussed plan or requirement into tracked work, when devflow_transition is vetoed and the next move must be chosen, or when starting work in a workspace that already has an active devflow board.

And, only while the composition also mounts `devflowSpec`:

> Author devflow architecture documents: decide what deserves a spec document versus an iron rule, choose anchors that are writable and falsifiable, scope ids so documents are found, and revise or merge through replaces. Use when recording a learning worth keeping beyond the current task, when devflow_read_spec returns a stale warning, when devflow_write_spec rejects a write, or when choosing between a spec document and an iron rule.

> Bootstrap the architecture-document set of one uncovered scope: take a gap from the /devflow spec census, establish what is true from the code rather than legacy documents, and record at most a few anchored claims a competent stranger would otherwise violate. Use when the census names scopes with no document, when a workspace adopts the spec seam over an existing codebase, or when a human asks for a package to be documented from scratch.

Loading a skill injects its asset body (about 9 KB for `devflow-workflow`, about 6 KB for `devflow-spec-authoring`, about 14 KB for `devflow-spec-bootstrap`) into that step.

### Runtime context

#### What the model sees

While the calling workspace has cards, the runtime-context snapshot carries a `devflow-board` section like:

```
Devflow board: 2 cards (draft 1, designing 1).
Claimed: 2-claimed-work [draft] Claimed work
New requirements start with devflow_create; process knowledge lives in the devflow-workflow skill.
```

A workspace without a board contributes nothing at all.

#### Token effect

One catalog line per bundled skill per request (three while the spec seam is mounted), plus at most 1024 bytes of board snapshot inside the runtime-context message while a board exists. A skill body costs its size only in steps after the model or the user loads it.

#### KV Cache effect

The catalog entry participates in the harness's durable catalog message, republished only when the visible skill set changes. The board snapshot participates in the merged runtime-context snapshot, which the harness re-appends only when any part of it changed — an unchanged board costs nothing, and each board change republishes the merged snapshot once (the cap bounds that price).

## Known Limitations and Deferred Work

- **The skill body is static** — it cannot cite this deployment's configured artifact kinds or gate commands, and points at the tool results' preflight instead. Rendering deployment facts into the body requires a demonstrated need the preflight does not already serve.
- **Claim lines name no holder** — `list()` carries no lease facts, so the refresh pays one `holder()` read per card per step, and the per-root cache cannot attribute a lease to the reading session; a claimed card says "Claimed", not whose.
- **A refresh failure keeps the last snapshot** — a corrupt journal or claim record fails loudly on the tool plane where the model can act on it; the awareness layer logs a warning and serves the previous text rather than failing the model step.
- **Suppressed runtime context drops the snapshot silently** — deployments with `includeRuntimeContext: false` or an active `suppressRuntimeContext()` see the skill but no board awareness; that is the harness's contract, not an error.
