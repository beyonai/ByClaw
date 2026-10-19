# @zhchxiao123/dsh-devflow-spec-tool

English | [中文](README.zh.md)

**The model-facing half of the [spec seam](../devflow-spec/README.md)**: `devflow_write_spec` commits one architecture document. A thin Consumer over `ctx.devflowSpec` — id legality, the structural contract, and anchor evaluation all live behind the seam, so a refusal here carries the seam's own stable code.

## Contract

`devflow_write_spec({ id, title, description?, body, anchors, replaces?, waives? })` commits one document and returns its id, path, anchor count, and the ids it replaced.

- `id` is a slash-joined scope path (`@scope/package/backend/error-handling`); each segment must match `^[@a-z0-9][a-z0-9._@-]*$`, and rejection happens at the id before any path is built.
- `body` must carry a `## Source of truth` section and must cite every declared anchor as `[[id]]`.
- `anchors` must hold at least one entry. `symbol` and `content-hash` anchors also carry `symbol`. A `content-hash` anchor normally **omits** `hash`: no caller outside this line can compute a digest over a parser-normalized body, so the store records the anchored symbol's current one. A symbol that cannot be found leaves it unresolvable and the write is refused.
- `replaces` names existing documents this one supersedes; they are deleted (git keeps the history). The document's **own id revises it in place**; **several ids merge a cluster** — the move when two documents already say the same thing, rather than adding a third. This is the only way the set shrinks: writing to an existing id without listing it here refuses with `exists`, and a listed id that does not exist refuses with `unknown-replaced`. The store budgets one write's **net** growth — the new file's bytes minus everything it replaces — and refuses over the ceiling with `budget-exceeded`, so a merge is never refused for being large.
- `waives` names scopes this document declares as deliberately needing **no** architecture document of their own, exact ids rather than prefixes so a waiver cannot quietly cover packages that do not exist yet. The body says why. Nothing about the write is relaxed for it — the same `## Source of truth` section, the same anchors, all fresh — so a waiver cannot be a placeholder, and it does not outlive its reasoning: when those anchors stop resolving the document goes stale and `/devflow spec` reports the waiver as in doubt. Naming a scope this document itself sits in refuses with `self-waiver`, because that scope has a document and is covered rather than waived.

Every declared anchor must evaluate `fresh` at write time — a document may not be born stale. Rejections surface as tool errors prefixed with the seam's code, the closed `SpecWriteRejectionCode` set: `invalid-id`, `missing-source-of-truth`, `no-anchors`, `duplicate-anchor-id`, `uncited-anchor`, `unknown-anchor`, `unknown-replaced`, `exists`, `anchor-unresolvable`, `budget-exceeded`, `self-waiver`.

The tool requires an owning agent session; a caller without one is refused before any side effect.

**This is the only way a document reaches disk**, and that is enforced rather than intended: the spec root sits under `.devflow/`, which [`dsh-devflow-fs-guard`](../devflow-fs-guard/README.md) denies the file tools.

`devflow_read_spec({ id })` reads one document back with its anchors evaluated against the code as it stands now: the body, the summary fields, and one verdict per anchor. **The rendered text carries a warning line when the document is not `fresh`**, naming the failing anchors — a read that returned only the body would drop the one signal this seam exists to carry, and the reader would have no way to know it was dropped. The body still comes through: a stale document is worth reading with the warning attached. Reading has no side effect but still requires the owning agent session: both filesystem roots resolve from the session's working directory, never process cwd, so a caller without one has no spec root to read from.

A sample composition that makes cards declare which documents they touch — the kind's `References` entries are **not** structurally checked, only the section's presence, so entry quality belongs to an admission gate if a deployment wants it enforced:

```yaml
- name: '@zhchxiao123/dsh-devflow-artifact-gate'
  config:
    kinds:
      spec-refs:
        sections: [Scope, References]
    edges:
      'draft->designing': [prd, spec-refs]
```

`draft->designing` is the standard route's edge only: `express` and `emergency` enter work through `draft->developing` and never cross it, so this contract as written binds none of their cards. A deployment adopting it either accepts standard-only coverage or requires the kind on `draft->developing` as well — both are defensible, but it has to be a decision. The whole artifact route is the opt-in paper record: in a default composition the reaction to spec drift is [`dsh-devflow-spec-sentinel`](../devflow-spec-sentinel/README.md)'s turn-end sentinel and pre-step index, with no card-level declaration involved.

### Closing the loop: `spec-delta`

The companion on the way out. `spec-refs` makes a card say what it will touch; `spec-delta` makes it say what its work produced and, for each output, **which layer should enforce it**. Like `spec-refs`, it is opt-in: a default composition already reacts to stale documents automatically through the sentinel, and this artifact is for deployments that want a per-card written triage on top:

```yaml
- name: '@zhchxiao123/dsh-devflow-artifact-gate'
  config:
    kinds:
      spec-delta:
        sections: [Changes, Classification, Verdict]
        nonEmptySections: [Classification, Verdict]
    edges:
      'testing->done':    [spec-delta]
      'reviewing->done':  [spec-delta]
      'developing->done': [spec-delta]
```

**All three terminal edges, not just `testing->done`.** A service class adds edges rather than replacing them: `express` reaches `done` from `reviewing` and `emergency` from `developing`, so a contract naming only the standard route lets exactly the cards that skipped review also skip triage — silently, with nothing reporting that a `spec-delta` was never filed. Whether an `emergency` card should be excused is a deployment's decision; it just has to be a decision.

`nonEmptySections` is what makes the required triage more than a heading. A `## Classification` with nothing under it satisfies a presence check while answering nothing.

**Classification sorts each output into one of two homes.** A `reference` — worth knowing, not relevant every time — becomes a document through `devflow_write_spec` and reaches later cards as an index row. An `obligation` — not following it is a mistake — belongs in a rule set that stays resident and is enforced by a check script; where [`dsh-devflow-iron-rules`](../devflow-iron-rules/README.md) is mounted, forward it through `ctx.get('devflowIronRules')`'s `record(agent, input)` so the receipt is that call's result rather than prose someone typed. **A deployment without that seam has nowhere to put an obligation and must say so** — the template allows an explicit "no obligation sink here" verdict, because the alternative is an obligation quietly becoming a reference.

What a gate can check mechanically ends there: sections present, two of them non-empty. Whether the triage is honest, whether a `no-change` verdict names a reason specific to *this* card, and whether an `obligation` row carries its rule id are judgements, and belong to an admission gate:

```yaml
- name: '@zhchxiao123/dsh-devflow-agent-gate'
  config:
    edges:
      'testing->done':
        prompt: |
          Read the card's spec-delta artifact and judge three things.
          1. Every output is classified `obligation` or `reference` — no row left straddling both.
          2. A `no-change` verdict gives a reason specific to THIS card. "No spec changes" is
             not one; "the change was confined to test fixtures, which no document describes" is.
          3. Every `obligation` row names the rule id it was recorded as, and does NOT also name
             a spec document id — an output recorded in both places is two sources of truth
             that will disagree.
          Reject with the failing row quoted.
```

## Rendering intent

Both presenters are pure functions of the arguments: a write shows an `edit`-kind `generic` card whose `rawInput` is the document title; a read shows a `read`-kind one whose `rawInput` is the id.

## Model Experience

### Tool schema

#### What the model sees

Two tools. The write description states the anchor discipline — that anchors are what make a document self-invalidating, and that readers are told a document is stale rather than following it — because a model that treats anchors as bookkeeping will write documents that pass the structural contract and protect nothing. It also says that every write lands a whole new document and that revision or merge goes through `replaces`, so a model refused with `exists` reaches for that field instead of minting a near-duplicate id. The `waives` description spends its length on what the field is not: a model that reads it as an escape hatch from writing documents would waive its way out of a census, so the description states that the carrying document passes every ordinary rule, that the reason must therefore rest on checkable code, and that the waiver falls into doubt when that code moves. The read description says what the verdicts mean: a stale document must be checked against the code before it is followed.

#### Token effect

A fixed schema cost while the plugin is active. A write result is four short fields; a read result carries the whole document body, so its cost scales with the document.

#### KV Cache effect

Prefix-stable while the plugin scope is unchanged; activating or unloading may invalidate reuse from the tool-schema section onward.

## Authoring skill

The package ships [`skills/dsh-write-spec`](skills/dsh-write-spec/SKILL.md): how to choose what a document should claim, which anchor kind catches the change you actually fear, and when a claim does not deserve a document at all. Read it before writing the first document for a package — the structural contract cannot tell a well-anchored document from a document that anchors whatever was easy.

## Which face answers which question

`devflow_read_spec` is the body face and deliberately not the discovery face. Four faces across three packages answer four different questions, and asking the wrong one is how "what does this scope hold" gets mistaken for "does this scope hold enough":

| Question | Answered by | Plane | In a default composition |
|---|---|---|---|
| Which documents claim the files this session has touched, and what else do those packages hold | `devflow-spec-map`, the pre-step index of [`dsh-devflow-spec-sentinel`](../devflow-spec-sentinel/README.md) | model, pushed | on |
| Which documents sit under the prefixes this card declared | the `specRefs` index [`dsh-devflow-tool`](../devflow-tool/README.md) carries on single-card results | model, on a card result | off |
| What does the whole set look like, and how far is each expected scope covered | `/devflow spec`'s census ([`dsh-devflow-command`](../devflow-command/README.md)) | human | on |
| What does this one document say | `devflow_read_spec` | model, on demand | on |

**The pre-step index is pushed, never asked.** It costs no tool call and vanishes from the prompt when it has nothing to say, but a scope reaches it only through a first-party `read`/`write` the session actually made — a `grep` does not admit one. The touch set keeps a fixed recency bound of 64 entries per layer, and the rendered index is byte-capped: the scope layer, the one carrying "what else does this package hold", is dropped first, and every drop is announced in the index itself.

**The card index is declared, not asked either.** Four things must hold before a single-card result carries it: the `devflowSpec` seam is mounted, there is a card, that card registered a `spec-refs` artifact, and that artifact is readable with at least one entry under a `## Scope` heading. The registration normally comes from `dsh-devflow-artifact-gate`, which is disabled in a default composition.

**The census counts; it does not list.** It takes no arguments, and a `documented` scope's line carries the number of documents rather than their ids — a fresh document covering an expected scope appears nowhere in the report by id. Ids surface for exactly two reasons: the document is not `fresh`, or it waives a scope. What the census owns instead is the three-state verdict per expected scope and the anchorable-file count each is measured over, which is what "covered enough" is judged from.

## Known Limitations and Deferred Work

- **No scope-listing tool.** `devflow_read_spec` needs an id, and nothing here takes a scope. What that leaves absent is narrower than it sounds: a session already working in a scope is **told** rather than asked — the pre-step index pushes that package's other documents before every step, in the default composition, for no tool call — and "is this scope covered enough" is a coverage question `/devflow spec` owns on the human plane. What is genuinely missing is a model-facing way to ask about a scope the session has **not** touched and no card declared. It has no current consumer, and answering it honestly means carrying the expected scope set (an expected scope with no documents is not the same as a scope nobody expects) and a whole-set scan for waivers (a scope is waived by a document living in another scope) — a per-scope census on the model plane, refused for the same reason the whole-set census is not a tool.

- **No partial edit.** Storage is whole-document: revising through `replaces` means re-supplying the complete body, not patching part of it.
