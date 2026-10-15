# Agent Note: devflow — a card's service class picks its pipeline, and skip edges become defensible

Status: implemented

English | [中文](2026-08-31-devflow-service-class.zh.md)

## Problem

Every card walked all seven stages. A one-line copy fix passed through
`designing` and `ready`; a production incident did too. The gates were always
configuration, but the *traversal* was not, so the only way to move faster was
`/devflow move` — the human intervention plane. That is the failure worth
naming: when the process cannot express urgency, the escape hatch lives
**outside** the recorded process, and the audit trail is what gets dropped
exactly when it matters most.

[The rigidity note](2026-08-27-devflow-stage-model-rigidity.md) examined this
and answered **"Skip edges: no"**, on the grounds that a uniform pipeline is
the product and that a skip edge, once available, becomes the default path.
This note supersedes that one alternative. The other two answers it gave — the
rework fix it shipped, and its refusal to reopen `done` — still stand.

## Decision

A card carries a **service class**, fixed at creation, that selects which edges
it may take. Three exist, and the vocabulary is closed:

| Class | Adds | Gives up |
| --- | --- | --- |
| `standard` (default) | nothing | nothing |
| `express` | `draft->developing`, `reviewing->done` | design, readiness, independent verification |
| `emergency` | `draft->developing`, `developing->done` | those, and review |

`express` keeps peer review deliberately: of the controls available here it is
the one that earns its cost, so cheap work skips design rounds rather than
skipping the reading. `emergency` gives that up too, and pays for it with an
ordinary follow-up card — not with an obligation encoded in the state machine,
which would be a second orchestrator wearing a field name.

### Why the old objection no longer holds

The objection was that a skip edge becomes the default path. It is answered by
two structural properties, not by discipline:

- **The vocabulary is closed.** A deployment cannot mint a shorter class. The
  three names are Definition-owned for the same reason `DEV_STAGES` is: the
  board, both language documents, and the agent's tool descriptions all
  reference them, and a deployment-defined class makes every one of those
  references local. Letting a deployment define its own is *precisely* the
  drift the original objection feared.
- **The class is fixed at creation.** A card cannot be demoted into a faster
  lane once work is underway, so "this is taking too long" can never be
  resolved by reclassifying. Escalation means a new `emergency` card, and the
  original stays on the board saying what it is.

The original answer's escape route — "a deployment that wants a shorter
pipeline can leave the intermediate stages ungated" — was true about cost and
false about meaning. Ungated stages still make the board say a card is
`designing` when nobody is designing, which is the same misreporting the
rigidity note refused to accept for rework.

## Edge model

`FLOW` is unchanged. A second table holds only what each class **adds**
([`stages.ts`](../../../../packages/devflow/src/stages.ts)), so "every class is
a superset of `standard`" is a property of the code rather than a convention:
a class cannot remove an edge, and therefore cannot make a journal that
replays today stop replaying. `isLegalTransition` takes the moving card's own
context, and both production call sites pass the card whole.

No shortcut is a rework edge — each one jumps forward — so `isReworkEdge` and
its `reason-required` contract needed no change.

## Durable format

`serviceClass` follows `parent` exactly: written into the `created` entry,
folded into the read state, projected into the card file's frontmatter, never
re-pointed. It is **optional on disk and total in memory**: the entry and the
frontmatter key are written only when the class is not `standard`, and an
entry stating none folds to `standard`.

So a journal written before classes existed replays unchanged, a `standard`
card's first journal line and card file stay byte-identical to what the
class-unaware code wrote, and no read-side consumer branches on absence.
An unknown value fails the durable boundary loudly rather than degrading.

## Alternatives considered

**Configurable classes: no.** It relocates the problem instead of solving it —
a deployment-defined class set is the "skip edges become the default" failure
with an extra layer, and it makes the board and the agent's prompts reference
something local.

**Reclassifying a live card: no.** Escalation is real, but a mutable class
turns the audit trail into a claim about the present rather than a record of
what was decided when. A new card costs one creation and keeps both facts.

**A post-hoc review obligation on `emergency`: no.** Encoding "you owe a
review" in the state machine makes the plugin an orchestrator. Real incident
practice already treats the postmortem as its own work item, and the existing
parent/child relation carries it.

## Consequences

Each class-added edge is an ordinary `from->to` key, so `'draft->developing'`
and `'developing->done'` can carry artifact contracts, agent checks, or command
gates like any other edge. A stage a class skips is **not** a bypassed gate:
the card never traverses that edge, so there is no contract to evade.

`devflow_list` stays compact — the class is reported only when it is not
`standard`, so an ordinary row is unchanged and a shortened one is marked
`<express>` / `<emergency>`. The board follows the same rule, which means an
existing deployment sees no new visual noise until it creates a shortened card.

Rollback is reverting the code: `express` and `emergency` cards then read as
`standard`, which under-reports intent but leaves every journal replayable.
That asymmetry is why the field reaches disk only when it carries information.

The board's client bundle now restates `DEFAULT_SERVICE_CLASS` alongside its
existing `DEV_STAGES` and `isReworkEdge` copies, under the same rule: a
divergence from the original is a defect in the copy.
