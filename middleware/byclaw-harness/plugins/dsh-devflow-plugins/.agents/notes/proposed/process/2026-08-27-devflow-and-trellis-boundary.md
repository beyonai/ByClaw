# Agent Note: where devflow ends and Trellis begins

Status: proposed

English | [中文](2026-08-27-devflow-and-trellis-boundary.zh.md)

> **This one needs a person.** It is a decision about how the team works, not
> how the code behaves, and remains proposed until a maintainer accepts,
> amends, or rejects it.

## Problem

Two systems in the same workspace model the same thing.

| Trellis (`.trellis/`) | devflow (this line) |
|---|---|
| Phase 1 Plan — `prd.md` / `design.md` / `implement.md` | `draft` → `designing` → `ready` |
| Phase 2 Execute — implement / check | `developing` → `reviewing` → `testing` |
| Phase 3 Finish — spec update, commit | `done`, then `archiveDone` |
| Parent/child task trees, one level, independently verifiable children | Parent/child cards, one level, independently verifiable children |
| `.trellis/tasks/<name>/` plus jsonl manifests | `.devflow/tasks/<seq>-<slug>/` plus `journal.jsonl` |
| `task.py start` gates implementation on artifact review | Gate commands and approvals on the transition waterfall |

The overlap goes down to the rules: both restrict decomposition to one level, both require a child to be independently verifiable, both make the parent responsible for integration acceptance. That convergence is evidence the shape is right, not evidence of waste.

The waste is elsewhere. Maintaining both costs twice the attention, and neither accumulates the other's experience — a lesson learned about how parents and children behave in Trellis teaches devflow nothing, and vice versa. Worse, the boundary today is held by habit rather than by a rule, so which system a piece of work lands in depends on who starts it.

**This repository is the sharpest case.** devflow is a development-process system whose own development is tracked in Trellis and in `.scratch/` markdown, with not one devflow card. Defects that only appear in use — the driver stalling after one stage, a gate killed by a default timeout, `attachArtifact` deadlocking from inside a gate — had no chance to surface, and all three were found by reading code instead.

## Proposal

**Option 2: an explicit division, written down.** Trellis owns the inside of one agent session; devflow owns work that outlives a session or crosses people.

- **Trellis** is a session's scratchpad and checklist. It plans what this session will do, holds the artifacts that planning produces, and closes when the session's work is committed. Its unit is a task somebody is doing now.
- **devflow** is the requirement's public record. It answers "where is this" for anyone who was not in the session, survives restarts and hand-offs, and carries the gates a deployment enforces. Its unit is a card that outlives whoever is holding it.

A piece of work large enough to span sessions gets a devflow card first; each session against it may open a Trellis task and close it, and the card stays.

## Alternatives considered

The two other options and why they are not the recommendation:

- **Option 1 — devflow absorbs Trellis's artifact model** (`designing` cannot reach `ready` until three artifacts are attached; devflow's gates can enforce exactly that). Nearly free to build, and tempting. It is a bigger bet than it looks: it makes devflow the only system, so every session — including a five-minute question — pays card overhead. Worth revisiting after Option 2 has run for a while and the boundary has been observed rather than predicted.
- **Option 3 — retire one.** Retiring devflow discards a published, tested plugin line. Retiring Trellis discards the workflow this repository is currently developed with. Neither is justified by "they overlap".

**The status quo — both, with the boundary held by habit — is the worst of the three options**, because it costs the maintenance of two systems and delivers the clarity of neither.

## Acceptance criteria

1. Write the division into both `AGENTS.md` and `.trellis/workflow.md`, so the rule lives where each system's users read.
2. Adopt devflow for this repository's own next requirement — cards for the work, no driver at first (it spends model budget the moment a card moves), just `devflow_create`, `/devflow`, and the board. Record what breaks. That is the dogfooding gap this note's Problem section describes, and it is the only part of this proposal that produces evidence rather than agreement.
3. Leave the 22 existing `.scratch/devflow/` issues where they are. Migrating history buys nothing; the rule applies to new work.

## Risks

The session boundary can still be ambiguous for work that begins small and later crosses sessions; dogfooding must record those cases rather than silently choosing one system. Until both systems expose links to each other's records, card and task status can drift. Enabling the driver during the trial also spends model budget on every configured stage, so the first adoption keeps it disabled.

If the proposal is rejected, Option 1 needs the least new design work. Continuing indefinitely with the boundary held only by habit retains the duplicate maintenance without clarifying ownership.

## Follow-up: 2026-08-27

The artifact-contract work (the `devflow-artifact-contract` change set) has since shipped Option 1's artifact model — **as optional equipment, not as the rule this note asks a maintainer to decide.** Artifact kinds and store-written registrations live on the seam, a mechanical structure gate and an LLM admission gate sit on the transition waterfall, the driver feeds and requests deliverables by kind, and [docs/devflow.md](../../../../docs/devflow.md#the-artifact-contract) carries a complete deployment sample with an end-to-end composition proof. All of it is per-deployment configuration: a deployment that mounts none of it has cards exactly as before, so "every session pays card overhead" — the reason Option 1 lost above — has not happened. What changed is only that revisiting Option 1 no longer needs design work; adopting it is now a configuration decision. The division this note proposes, and its status, remain with a maintainer.
