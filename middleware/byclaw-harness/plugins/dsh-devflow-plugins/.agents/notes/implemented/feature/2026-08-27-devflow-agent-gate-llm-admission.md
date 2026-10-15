# Agent Note: devflow — the LLM admission gate

Status: implemented

English | [中文](2026-08-27-devflow-agent-gate-llm-admission.zh.md)

## Problem

The artifact contract stops at structure: `dsh-devflow-artifact-gate` proves a design exists and has its sections, not that the design answers the PRD. Judging content needs a reader, and the only reader available unattended is a model — but letting the producing agent certify its own deliverable certifies nothing, and a gate whose checker can fail *open* (provider down, verdict garbled, report lost) is worse than no gate, because it converts outages into silent approvals. There was also no way to record a passed check: S1 added `gate.checks` to the transition entry precisely so an admission fact could live beside the human `approvedBy`.

## Decision

**One read-only function plugin on the `devflow/transition` waterfall**, `@zhchxiao123/dsh-devflow-agent-gate`. A configured edge dispatches a **one-shot checker subagent** through `ctx.subagents` — the driver's dispatch surface, reused verbatim: a synthetic registered parent per root anchors lineage and workspace, `ctx.agentDefaultModel.currentSelection()` routes the model, `run.result` is awaited and the run always disposed. The prompt is the deployment's instruction, the card, each configured input kind's newest registration inlined under a `--- artifact <kind> (rev N) ---` separator, and a fixed contract demanding one fenced JSON verdict block; the last parsable block is the decision.

**An allow is a recorded fact, not a bare pass.** The gate delegates and appends `{ by: { kind: 'agent' }, verdict: 'allowed', summary }` to the downstream decision's `checks` — merged, never overwriting, so a human approval and an agent check share one journal entry — and a downstream veto passes through untouched. **A veto is a file first**: the full report (summary, findings, checked `kind:rev` list) lands under the moving card's devflow root (once the required `reportDir`) and the reason names the path, because the report is the rework input and `attachArtifact` is unreachable from inside the card's own transition (the store serializes per card — the gates package documents the same deadlock).

**Every checker fault fails closed, in the gates' parking posture.** Provider unregistered, runtime not composed, start rejected, timeout, abnormal exit, unparsable verdict, unreadable input, unwritable report: veto naming the fault, plus a `blocked` park queued behind the vetoed transition exactly as `devflow-gates` parks an unanswerable approval — fire-and-forget `devflow.transition` against the attempt's revision, failure only warned. Unlike the driver, the gate never waits for a late provider: a transition is blocked on the decision, so absence is a fault now.

**Verdicts are cached; faults are not.** The key is (edge, root, card, sorted input `kind:rev` pairs, instruction hash) — the card and root are in the key even though the design sketch omitted them, because input revisions are per-card facts and sharing verdicts across cards would let one card's approval admit another's move. Files under `<devflow root>/cache/agent-gate/` — once the optional `verdictCacheDir`, now derived from the moving card — store the full key detail for field-equality on hit and human audit; corruption is a warned miss; a cached allow is journal-marked `[cached] `, a cached veto points at the original report.

**The checker's tool face is restricted when the published surface allows it.** `SubagentStartRequest.toolFilter` exists and is gated per provider by `capabilities.toolFilter`; the gate sends a deny list of the devflow mutation tools and file write tools, intersected with the actually registered tools because `tools.restrict()` rejects unknown names. A provider without the capability dispatches unrestricted — recorded in Known Limitations, with the verdict contract instructing read-only conduct.

## Alternatives considered

**Let the producing session self-check before moving.** Free of dispatch cost, but the producer grading its own work is the failure the parent PRD names; independence is the point of a separate one-shot session with no shared prefix.

**Fail open (delegate) when the checker infrastructure is down.** Keeps the pipeline moving, but converts every outage into an approval no one gave. The human-approval precedent already chose the other side: veto and park `blocked` so a human resumes deliberately.

**Wait for a late provider like the driver does.** The driver parks work items and can wait forever; this gate sits inside a transition someone is awaiting. Waiting would hang the store's per-card chain on an event that may never come.

**Cache by (edge, input revs, prompt) without card identity.** The design sketch's literal key. Rejected because two cards can share an edge and revision numbers while carrying different bodies and artifact contents — the cache would smear one card's verdict across another.

**Park synchronously inside the waterfall.** Deadlocks: the park is a store write on the very card whose transition holds the serialization turn. The gates package's queued fire-and-forget park is the sanctioned mechanism and is reused verbatim.

**Write no veto report, keep the verdict in the reason.** The reason is capped prose in a rejection message; findings need a durable, complete home the rework agent can read, and the report's location is derived from the moving card (once the required `reportDir`) so a deployment cannot configure the gate into silently discarding them.

## Consequences

- One gated attempt on a cache miss costs one full subagent request proportional to the card plus all inlined inputs; hits cost zero. The README's Model Experience section accounts for this.
- Deployment order matters and is unenforced: this gate belongs after `artifact-gate` (mechanics before tokens) and before `gates` approvals (agents before humans); the composition rows decide.
- The fail-closed paths are the review surface: the four fault families (provider missing, dispatch failure, timeout, unparsable verdict) each have a named test in `tests/fail-closed.spec.ts`, and the report-write and input-read faults are tested through the shared fs-fault injector.
- A provider without `toolFilter` capability leaves the checker's tool face to the deployment — instruction, not enforcement.
- `blocked` parking on every infrastructure fault means a flaky provider parks cards instead of retrying; that is deliberate (unattended runs stop loudly), and recovery is a normal unblock plus retry.
