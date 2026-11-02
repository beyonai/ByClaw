# Agent Note: the iron-rules give-up notice no longer costs a step

Status: implemented

## Problem

`devflow-iron-rules`' give-up path injected its notice from inside the
`agent/turn-stopping` window, with a comment claiming the notice "stays
pending … reaches the model on the next turn, while this turn ends". The
[spec-lifecycle-sentinel Agent
Note](../architecture/2026-09-11-devflow-spec-lifecycle-sentinel.md) measured
the opposite at the pinned `0.1.5-rc.2`: inside that window `inject()` feeds
the same next-step list as `steer()`, so the give-up notice forced exactly the
continuation step it existed to stop — the model got one more step after
`maxRetries` was exhausted, against both the comment and the README. The
zombie-watch notice (checks all green, watched paths all gone) was sent from
the same window and carried the same defect.

## Decision

Turn-stopping now says nothing for either notice — inside the window the only
honest choices are one steer or nothing. Each notice is recorded in a
per-agent `WeakMap<Agent, string[]>` and delivered by a new `agent/pre-step`
listener in the same `check.ts` mount (same shell-conditional context, so both
listeners share one fiber lifecycle): it delegates first, then injects every
pending notice and clears the queue, returning the downstream decision
untouched. Outside the window an inject queues for the opening turn instead of
forcing a step — the measured semantics the old comment wrongly assumed of a
window inject. Retry counting, the dirty gate, and the steer path under the
ceiling are unchanged; the fix restores the semantics the code always
declared, which is also what the port source `@byclaw/dsh-iron-rules` declares
(its delivery still pays the extra step; the README pair now states the
difference).

## Consequences

Reaching `maxRetries` ends the turn with no step N+1; the give-up (or zombie)
notice arrives once, as the next turn opens — pinned by the composition suite
counting messages out of the window (zero) and out of the next pre-step
(exactly one, then none). An agent whose session never opens another turn
never sees the notice: it is collected with the agent via the `WeakMap`,
accepted as the correct reading of a session promise — the same reading the
sentinel's steered-once set carries. Notices from several give-up turns with
no step between them accumulate and deliver together, once.
