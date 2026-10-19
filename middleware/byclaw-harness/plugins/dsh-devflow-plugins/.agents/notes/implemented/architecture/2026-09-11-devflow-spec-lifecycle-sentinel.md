# Agent Note: the spec lifecycle moves from gate edges to the session

Status: implemented

## Problem

The spec seam's content mechanics — anchors, three-valued verdicts, the structural write contract owned by [the anchor-model Agent Note](2026-09-02-devflow-spec-anchor-model.md) — were sound, but the *lifecycle* was hosted on the wrong thing. Entry (`spec-refs`), exit (`spec-delta`), and health expectations (`specScopes`) all hung off artifact-gate edge configuration, and the artifact gate ships disabled in the bundle: a deployment that configured nothing did not get a weaker spec lifecycle, it got none, silently. Spec relevance is also per-file, not per-card — most cards touch no anchored file, and an edge contract cannot tell those apart.

The recommended entry configuration was defective on its own terms. Mounting `spec-refs` on `draft->designing` binds only the standard route: `express` and `emergency` cards enter work through `draft->developing` and never cross that edge, so precisely the cards that skip design — the ones most likely to skip everything else — were exempted from declaring what they touch, with nothing reporting the exemption.

## Decision

**The default lifecycle is hosted on session and code events, in a new package [`dsh-devflow-spec-sentinel`](../../../../packages/devflow-spec-sentinel/README.md); the artifact route stays available as the opt-in paper record.** Three hosts replace the edge:

- `tools/result` collects the file paths a turn's first-party `write`/`edit` calls landed (per-agent, `WeakMap`-keyed; read paths from `read` feed only the index's scope layer). The coupling to first-party tool names and the `file_path` argument shape is stated and accepted — the same coupling `dsh-devflow-iron-rules` carries for its dirty gate.
- `agent/turn-stopping` intersects the turn's write set with the documents' anchor files (via the new `SpecSummary.anchorRefs` face, exposed from data `list()` already evaluates), evaluates only the hit documents, and steers once with the full triage: rewrite via `replaces`, replace a wrong document, retire through a merge, or explicitly defer.
- `agent/pre-step` refreshes the `devflow-spec-map` runtime context — index lines for documents whose anchors claim touched files (sharp layer, writes only) and for the touched packages' other documents (broad layer, reads included), byte-capped, harness-diffed.

**Steered-once, no `maxRetries` — the deliberate divergence from iron-rules.** An iron rule violation is an obligation: block every dirty turn until fixed or capped. A stale spec document is a reference: its reader owes it one informed look, and a mid-refactor rename that keeps a document stale for many turns is a legitimate state. So the sentinel records a per-(agent, document) steered set before steering, clears the write set so only a new write re-arms it, and never interrupts over the same document twice in a session; after the one interruption — or an explicit defer — staleness stays visible in the pre-step index instead. A retry ceiling would be a category error here: there is nothing to retry.

**Churn is split across three layers by what each can honestly promise.** The sentinel excludes `churn` anchors — an uncommitted edit cannot flip one, so a churn-only overlap could surface only staleness that predates the turn. The index's hit test includes them — awareness is not an interruption, and a churn anchor still names a file the document claims. The census backstops churn health wholesale.

**Coverage is discovered before it is configured.** The sentinel publishes the optional `devflowSpecWorkspace` value service (fiber-scoped, the `devflowArtifactStructures` precedent): root manifests to member packages to scope ids — originally `pnpm-workspace.yaml` alone, since widened to a [multi-ecosystem detector chain](../feature/2026-09-13-spec-discovery-multi-ecosystem.md). `/devflow spec` reads it with `ctx.get` and demotes `specScopes` to a whole-set override — configured scopes replace discovery rather than joining it, preserving "ask about exactly these". The same layout table serves the index's scope layer and the census, which is why the resolver lives once.

**An independent package, not a feature of an existing one.** This line uses profile rows as its policy switches (`dsh-devflow-fs-guard`, a 114-line package, is the standing precedent), and a steer is the most intrusive model experience in the line — a deployment must be able to turn exactly that off with one `disabled: true` whose fiber disposal takes every listener along. Reuse was maximized before the package was accepted: the bootstrap skill went to `devflow-guidance`, the seam extension to the two spec packages, discovery-first census to `devflow-command`. What remains in the sentinel is only what had no honest home elsewhere.

## The turn-stopping window at 0.1.5-rc.2

Measured before implementation (experiment preserved under `.scratch/devflow/steer-composition/`): two `agent/turn-stopping` listeners that both steer produce **one** continuation step carrying both messages in listener order — nothing lost, nothing overwritten — and `turn-stopping` dispatches again after that step, which is why the sentinel records its steered set *before* steering.

The same experiment found that `inject()` inside the turn-stopping window feeds the same next-step list as `steer()`: it also holds the turn open and forces an immediate continuation step. Two consequences are recorded here on purpose. First, the sentinel's defer downgrade *cannot* be "inject a quieter notice at turn end" — inside that window the only honest choices are one steer or nothing, so the non-interrupting channel is the pre-step index (a hard constraint, not a preference). Second, **`dsh-devflow-iron-rules`' give-up comment does not match the pinned harness's actual behavior**: it says the give-up notice "stays pending … reaches the model on the next turn, while this turn ends", but at `0.1.5-rc.2` that inject also triggers a continuation step. This task deliberately did not touch iron-rules (out of scope); reconciling that comment — or the behavior — needs its own card.

## Alternatives considered

**Host the reaction on the transition waterfall** (the shape two earlier design rounds assumed). Rejected: a transition fires long after the edit that caused the drift, when the context that could triage it is gone, and deciding "what went stale *because of this card*" needs a baseline snapshot of verdicts taken when the card started. The turn-end host needs no snapshot at all — the anchor model's born-stale rule means every `stale` verdict is already a delta ("this moved since the document was written"), so intersecting the turn's writes with anchor files is the whole computation.

**Warn through `fs/edit-intent` before the edit lands.** Rejected twice over. Typewise there is no channel: that waterfall returns a version guard, and a listener can only throw to refuse (the fs-guard pattern) — nothing it returns reaches model context. And the workaround — refuse the first edit with a message, allow the retry — is a speed bump that trains the model to re-issue calls; recorded as a possible future *strict mode*, not a default.

**Fold into `dsh-devflow-spec-tool` or `dsh-devflow-guidance`.** Rejected. The tool package is the model-facing tool plane; a turn-stopping policy inside it would make one package's Model Experience section describe two unrelated surfaces, and disabling the steer would take the only write path down with it. Guidance's charter says its layers lose "guidance, never a guarantee" when suppressed — a forced continuation step is an intervention, and hiding one inside that package would falsify its README.

**Same package as iron-rules, sharing the hook plumbing.** Rejected: the two are opposites on every axis that matters — resident obligation bodies versus indexed references, block-every-dirty-turn versus told-once, `maxRetries` versus none — and co-packaging invites sharing exactly the constants that must differ. They share the hook *shape* and zero code; each README names the other and the composed double-steer behavior instead.

## Consequences

It **bought** a spec lifecycle that exists at zero configuration — the bundle mounts the sentinel enabled, and a workspace without the seam or documents pays nothing — and it made the express/emergency exemption moot on the default path: the sentinel never asks which edges a card crossed. The artifact route's documentation now states its real position (opt-in paper record, standard-route-only as sampled) instead of implying it was load-bearing.

It **cost** a second stated coupling to first-party tool names and argument shapes, a session-memory promise ("told once" resets on process restart, which is the correct reading of a session promise), and an explicit non-promise: file reads and writes through `bash` are invisible to collection, the same exposure iron-rules accepts. The read-tools list is `read` alone, in one commented set, so a harness bump has one place to check.

Real-composition tests pin the behavior end to end: write a document, edit the anchored symbol through the real tool plane, observe exactly one steer naming document and anchor and no second interruption; observe both index layers appear; observe the iron-rules double-steer merge. The workspace resolver, renderers, and collection carry per-file unit coverage at the repository's 100% gate.
