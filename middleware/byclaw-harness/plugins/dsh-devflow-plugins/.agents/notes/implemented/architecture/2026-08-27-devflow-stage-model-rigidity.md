# Agent Note: devflow — rework reaches the stage that owns the fault, and the other two rigidities stay

Status: implemented

English | [中文](2026-08-27-devflow-stage-model-rigidity.zh.md)

## Problem

`FLOW` in [`stages.ts`](../../../../packages/devflow/src/stages.ts) is the hardest table in this line to change: the closed `DevStage` union, journal replay, gate edge keys, and the board's rendering all stand on it. Three properties of it were raised as possibly too rigid, and the point of this note is to say which of the three was, so the question stops being reopened.

1. **No skip edges.** Every card walks all seven stages. A one-line copy fix passes through `designing` and `ready`.
2. **Rework only reaches `developing`.** `reviewing` and `testing` can send a card back, but only to one place. A design fault found in testing has nowhere truthful to go.
3. **`done` is terminal.** A regression on delivered work can only start a new card.

## Decision

**Only the second is a defect, and it is fixed.** `reviewing`, `testing`, and `developing` all reach `designing`, and every one of those moves counts as rework, so it still requires a `reason`.

The argument is the PRD's own goal for having stages at all: *"so that at any moment you can answer where this thing is."* Before this change, a card whose design turned out to be wrong had two options — sit in `developing` while design work happened, or be parked `blocked` (which must recover to the exact stage it interrupted, so it could only come back to `testing`). The first makes the board say `developing` about a card nobody is implementing. A board that misreports where work is fails at the one thing it was built for, and no amount of care in the surrounding machinery compensates.

`developing -> designing` belongs to the same defect and was added after the first pair. Implementing a design is the most common way to discover it is wrong, and while that edge was missing the only route back was `developing -> reviewing -> designing`: a card had to journal a review nobody ran in order to reach the stage owning the fault. That is the same misreporting this note rejects, one stage earlier and written into the authoritative history rather than only onto the board.

The change is additive. `FLOW` gains three entries across this decision and loses none — which is the only safe direction, because removing an edge makes every journal that already used it fail replay.

## Alternatives considered

**Skip edges: no** — *superseded by [the service-class note](2026-08-31-devflow-service-class.md), which ships them under a closed, creation-fixed class.* The answer recorded here was: the uniform pipeline is the product, not an accident of it; the cost of a trivial card is six moves and six journal entries, which is real but small, and the benefit is that "where is this" has the same answer shape for every card. A skip edge, once available, becomes the default path — and a deployment that genuinely wants a shorter pipeline can leave the intermediate stages ungated, which costs the moves and nothing else.

That objection was right about the danger and wrong about the remedy: ungated stages still make the board say `designing` about a card nobody is designing, which is the misreporting this note refuses elsewhere. The superseding note answers the danger structurally instead — a closed class vocabulary and a class fixed at creation — rather than by withholding the edges.

**Reopening `done`: no.** This one looked like a contradiction — the archiver goes to real trouble to keep a decomposed requirement's history in one month bucket, so history clearly matters — and on inspection it is not one. A regression found in production is new work about old code, not a continuation of a requirement that was in fact delivered. More concretely, reopening would have to reach cards that `archiveDone` has already moved, and [the seam's archive is write-only by design](../feature/2026-08-25-devflow-file-based-task-cards.md): no operation lists or restores an archived card. Making `done` non-terminal therefore is not an edge in `FLOW` but a new read face over the archive, with its own PRD.

## Consequences

All three edges become configurable gate edges for free, because each is keyed by the same `from->to` string as every other edge. A deployment gating `developing->reviewing` — the sample in [`docs/devflow.md`](../../../../docs/devflow.md) runs `pnpm run verify` there — gains an ungated way out of `developing`, and that is correct: a command gate exists to prove an implementation sound, and an implementation being abandoned as mis-designed has nothing to prove. Gate the rework edge too if the deployment wants it gated.

`isReworkEdge` widening means all three moves are rejected `reason-required` without a stated reason. That is the point: the next holder needs to know what about the design was wrong, and on `developing -> designing` the reason is what implementing revealed — the whole value of routing the card back rather than redesigning in place.

The board's client bundle restates `isReworkEdge` because the purity gate forbids the value import ([`board-view.tsx`](../../../../packages/devflow-ui/src/client/board-view.tsx)). That copy had drifted: it matched only moves back to `developing`, so the first pair of edges was never counted as rework in a card's summary. It now mirrors the predicate exactly.

The two "no" answers are recorded here so the next person weighing them starts from the reasoning rather than from the observation. The observation — that the pipeline is strict and `done` is a wall — is correct; it is the intent.
