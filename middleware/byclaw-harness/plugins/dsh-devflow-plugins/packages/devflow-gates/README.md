# @zhchxiao123/dsh-devflow-gates

English | [中文](README.zh.md)

Command gate policies on the [`devflow/transition`](../devflow/README.md) waterfall: a configured edge runs its gate commands through `ctx.shell` before the journal commits, and a failing command vetoes the move with a bounded output summary in the rejection reason. Gate commands live entirely in deployment configuration — global per-edge lists plus per-card overrides keyed by card id — never in the card's writable files, so a developing agent cannot rewrite its own gates.

## Behavior

For an attempt on edge `from->to`, the guarding commands are `cards[<card id>][edge]` when present, else `edges[edge]`, else none (an ungated edge delegates untouched). Commands run through `ctx.shell.resolve`/`run` in the card's workspace directory — the parent of the attempt's devflow root, so a gate like `pnpm run test` checks the code the card belongs to — with the edge's `policies` entry supplying its timeout, working directory, and whether the commands run concurrently. Sequentially (the default) the first non-zero exit or kill vetoes without running the rest; in `parallel` every command runs and the veto names each that failed. A veto carries `gate command failed: <command> (exit N | killed): <stderr+stdout summary>` truncated at `maxFailureOutputChars`, plus `full output: <path>`. All-green gates delegate to the remaining waterfall listeners.

## Human approvals

An edge listed in `approvals` additionally requires a one-shot human decision after its commands pass, answered over the interaction plane (`ctx.approval`) — never through the model conversation, because the gate exists to check the agent. The approval request routes to the initiating agent's answerers (`attempt.by.session` resolved through `ctx.agents`); an approved move carries `gate: { approvedBy: { kind: 'human' } }` in its journal entry, and a rejected or withdrawn question vetoes without side effects. When no responder is reachable — a non-agent initiator, no composed approval service, or the seam's fail-closed `unavailable` — the move is vetoed and the card is parked `blocked` (`awaiting human approval for <edge>`, actor `command devflow-gates`) so an unattended run exits cleanly; a human recovers the card to its interrupted stage and re-attempts the move.

## Config

```yaml
- id: devflow-gates
  name: '@zhchxiao123/dsh-devflow-gates'
  config:
    edges:
      'developing->reviewing': ['pnpm run test']
    cards:
      0042-retry-backoff:
        'developing->reviewing': ['pnpm run test -- packages/llm']
    policies:
      'developing->reviewing':
        timeoutMs: 900000
        parallel: true
    maxFailureOutputChars: 2000
```

| Key | Default | Meaning |
|---|---|---|
| `edges` | `{}` | Global gate commands per `from->to` edge. |
| `cards` | `{}` | Per-card overrides replacing the global list for that edge. |
| `approvals` | `[]` | Edges requiring a one-shot human approval after their commands pass. |
| `policies` | `{}` | Per-edge `timeoutMs`, `workdir`, and `parallel`. |
| `maxFailureOutputChars` | `2000` | Character cap for the failure-output summary in a veto reason. |

An edge key not of the form `<from>-><to>` with known location names fails the load, in `policies` as in `edges`; so does a non-positive `timeoutMs`.

**Set `timeoutMs` on any edge that runs a test suite.** The executor's default sizes a check, and `developing->reviewing` running `pnpm run test` is the first thing most deployments configure — a suite that outlives the default is killed, and the gate reports the kill as a failure of the code rather than of its own budget.

`parallel` trades the sequential short-circuit for one round trip: every command runs and the veto names each that failed. It suits independent checks (lint, types, tests) and not a chain where a later command presupposes an earlier one.

## Where the artifacts go

Nothing to configure. Each artifact lands under the **moving card's own devflow root**:

```
<devflow root>/
  reports/gates/{card}-{from}-{to}-r{rev}.log
```

Inside the root rather than beside it, because [`dsh-devflow-fs-guard`](../devflow-fs-guard/README.md) protects the root by name — so the agent whose work this gate judged cannot rewrite the record with its own file tools. One harness serving several projects keeps each project's artifacts in that project, with no path to collide over.

## Model Experience

None, as gate vetoes reach a model only through the devflow tools' rejection text; this plugin registers no prompt or schema.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Approvals need a live initiating agent** — the approval seam is agent-scoped, so a human- or command-initiated move on an approval edge always takes the parked-blocked path; even [`/devflow move`](../command-devflow/README.md) goes through the same executor without a bypass, so an approval edge is crossable only by an agent with a reachable approval responder.
- **Gate results are not cached or incremental** — every attempt at an edge reruns that edge's commands in full, so a rework loop pays for the whole suite each time round. Reusing a previous result needs a notion of what the commands depend on, which this package does not have.
- **The full failure output goes to a file, not to the card** — the log is a plain file under the card's devflow root, because a gate cannot register an artifact against the card it is gating: the store serializes per card and this waterfall runs inside the transition holding that card's turn, so `attachArtifact` would wait for a transition that is waiting for it. Putting the output on the card needs a seam that accepts a write from inside its own waterfall.

## Required mechanical validators

A deployment can require a named validator independently of shell commands and
human/LLM approval. The scope is the canonical absolute `.devflow` root, plus
optional card ids and explicit edges. An omitted `cards` list covers all cards
in that root; an empty list is rejected. Include shortcut completion edges when
express or emergency cards must meet the same acceptance policy.

```yaml
requiredValidators:
  - root: /absolute/project/.devflow
    edges: [testing->done, reviewing->done, developing->done]
    validators: [midscene]
    timeoutMs: 300000
```

The provider registers through `ctx.get('devflowValidators')` in an effect and
returns its registration disposer. Every attempt receives a new `requestId`, the
store's resolved transition identity, a deadline, and an `AbortSignal`. Providers
must execute a fresh check and cancel their owned resources when signalled.
A successful result supplies `{ allowed: true, runId, summary }`; a refusal
supplies `{ allowed: false, reason }` with a safe, credential-free explanation.

Missing providers, unresolved scopes, provider exceptions, empty evidence,
timeouts and provider unload veto the transition. A timeout/unload reports
unconfirmed cleanup and never accepts a late result. Providers remain responsible
for completing their bounded cleanup. The engine also rejects a provider change
while downstream approval runs. Successful execution references are appended to
the existing journal `gate.checks`, alongside other gate decisions.

Requirements are deployment policy, not fields in an agent-editable card. The
gates plugin must be enabled: a disabled policy engine cannot enforce its own
configuration. Integrations exposing a required acceptance profile must check the
engine's availability before advertising that profile as usable.

Shell commands run before required validators, so a build command cannot modify
the workspace after its acceptance run. Providers can return a same-process
`revalidate()` callback with a successful result. The engine calls it after
remaining approval policies and before commit; `false` or an exception vetoes.
Midscene uses it to recheck source/suite fingerprints and the deployment receipt
without repeating browser actions. It never serializes executable callbacks into
the journal.
