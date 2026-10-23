# @zhchxiao123/dsh-devflow-agent-gate

English | [中文](README.zh.md)

LLM admission policy on the [`devflow/transition`](../devflow/README.md) waterfall: a configured edge dispatches a **one-shot checker subagent** — independent of whatever produced the work — that reads the card and the newest registration of each configured input kind and answers with a structured verdict. An allow travels into the committed entry's `gate.checks`; a veto writes the full report under the card's devflow root and rejects the move naming that file; any fault that keeps the checker from actually running **fails closed**: the move is vetoed and the card is parked `blocked`. The producer never certifies its own work, and a broken checker never waves a move through.

## Behavior

For an attempt on edge `from->to` with an `edges` entry, the gate reads the moving card, inlines the newest registration of each `inputs` kind (the record with the highest journal revision), and starts one checker on the configured subagent provider: a fresh session sharing no history with the producer. For an agent-triggered transition, the checker follows the initiating live agent's latest request provider and model, including session-local model selections supplied by a deployment; otherwise it uses the deployment's current default model. Its prompt is the configured instruction, the card title and body, each input under a `--- artifact <kind> (rev N) ---` separator, and a fixed contract requiring one fenced JSON verdict block — `{ "verdict": "allow" | "veto", "summary": "...", "findings": ["..."] }`. The last parsable block of the reply is the decision, so a checker may quote the contract without being misread.

The checker receives a synthetic parent scoped to the card workspace. That parent carries an explicit `agents` injection for later subagent prompt assembly, while the gate itself still resolves `subagents`, `agents`, and `agentDefaultModel` dynamically so a missing runtime fails the configured edge closed instead of silently leaving it ungated.

- **Allow** — the gate delegates, and when the rest of the waterfall also admits the move, appends `{ by: { kind: 'agent' }, verdict: 'allowed', summary }` to the decision's `checks`, which the store records on the committed journal entry alongside whatever the downstream policies collected (a human `approvedBy`, other checks). A downstream veto passes through untouched.
- **Veto** — the move is rejected without delegating: the full report (summary, findings, the checked `kind:rev` list) is written to `<devflow root>/reports/agent-gate/<card>-<from>-<to>-r<revision>.md` and the veto reason names that file. A veto is not a commit — no journal entry, same revision.
- **Fail closed** — the provider is not registered, the subagent runtime is not composed, the dispatch rejects, the checker overruns `checkTimeoutMs` or exits abnormally, the reply carries no parsable verdict, a registered input file cannot be read, or the veto report cannot be written: the move is vetoed with the fault in the reason, and the card is parked `blocked` (actor `command devflow-agent-gate`) so an unattended run stops instead of retrying into the same fault — the same posture as `dsh-devflow-gates` when no human approver is reachable. The parking move is queued behind the vetoed transition's per-card serialization, never awaited inside the waterfall; recovery returns the card to its stage and re-attempts the gate normally.

An edge with no entry delegates without touching the store. An input kind with no registration is skipped, not vetoed — requiring presence and structure is [`dsh-devflow-artifact-gate`](../devflow-artifact-gate/README.md)'s mechanical contract, composed ahead of this gate.

## Config

```yaml
- id: devflow-agent-gate
  name: '@zhchxiao123/dsh-devflow-agent-gate'
  config:
    edges:
      'designing->ready':
        provider: spawn
        inputs: [prd, design, implement]
        prompt: Check that the design covers every PRD acceptance criterion and the implementation list starts with its test cases.
    checkTimeoutMs: 600000
```

| Key | Default | Meaning |
|---|---|---|
| `edges` | `{}` | Admission check per `from->to` edge: the subagent `provider` the checker starts on, the `inputs` artifact kinds inlined into its prompt (optional; unregistered kinds are skipped), and the `prompt` instruction it judges by. An edge with no entry is not checked. |
| `checkTimeoutMs` | `600000` | Milliseconds one checker may take from dispatch to verdict; overrunning fails closed. |
| `workspaceOnToolEnvironment` | `false` | Read inputs and keep reports and the verdict cache through the context's `ctx.fs` / `ctx.subprocess` instead of this process. |

Misconfiguration fails the load, naming the config item: an edge key not of the form `<from>-><to>` with known location names, a blank `provider` or `prompt`, an input kind outside the seam's kind grammar (lowercase letters, digits, and dashes, starting alphanumeric), or a non-positive `checkTimeoutMs`.

## The verdict cache

A verdict is cached under the key (edge, root, card, sorted input `kind:rev` pairs, instruction hash) — everything that determines what the checker saw, since a card body is immutable after creation and artifact registrations are immutable per revision. An identical retry reuses the record without dispatching: a cached allow admits the move with its journal check summary prefixed `[cached] `, a cached veto rejects pointing at the original report. Registering a new revision of any input changes the key and re-dispatches.

The cache is an optimization, never an authority. Each file stores its full key detail, so a hit requires field-by-field equality (insurance against a filename-hash collision) and a human can audit or delete one cached decision; a corrupt file is a warned miss, an unwritable cache only warns, and writes are atomic (temp + rename). Faults are never cached — only verdicts are.

## Where the artifacts go

Nothing to configure. Each artifact lands under the **moving card's own devflow root**:

```
<devflow root>/
  reports/agent-gate/{card}-{from}-{to}-r{rev}.md
  cache/agent-gate/{key-hash}.json
```

Inside the root rather than beside it, because [`dsh-devflow-fs-guard`](../devflow-fs-guard/README.md) protects the root by name — so the agent whose work this gate judged cannot rewrite the record with its own file tools. One harness serving several projects keeps each project's artifacts in that project, with no path to collide over.

## Model Experience

### Checker prompt

#### What the model sees

Each dispatched checker's user message is the configured `prompt` instruction, the line `You are gate-checking devflow card <id> on edge <from>-><to>.`, the card title and Markdown body, every configured input's newest content under its `--- artifact <kind> (rev N) ---` separator, and the fixed closing contract: judge only against the instruction, act as a read-only checker calling no devflow or file-writing tool, and end the reply with one fenced JSON verdict block.

#### Token effect

One full subagent request per cache miss, proportional to the card body plus **all** inlined input artifacts plus the fixed contract lines — on a design-review edge that is typically the PRD, the design, and the implementation plan in one prompt. Cache hits cost zero tokens; unconfigured edges add nothing to any request.

#### KV Cache effect

Independent: every checker is a fresh one-shot session sharing no prefix with the producer or earlier checks — a re-dispatch after an input revision pays the full prompt again.

## Known Limitations and Deferred Work

- **Verdict quality is the deployment's prompt responsibility.** This gate guarantees the checker runs, is independent, sees the declared inputs, and cannot fail open — not that its judgment is any good. A vague `prompt` buys vague vetoes.
- **Waterfall order is deployment load order.** Compose this gate after `dsh-devflow-artifact-gate` (so a missing artifact vetoes mechanically before a checker spends tokens) and before `dsh-devflow-gates` approvals (so a human is not asked about work an agent would reject). Nothing enforces that order; the composition's row order does.
- **The checker's tool face is only restricted when the provider supports it.** When the provider declares the start-time `toolFilter` capability, the gate denies the devflow mutation tools and the file write tools (intersected with what is actually registered, because the runtime rejects unknown names). A provider without the capability runs the checker with whatever tools the deployment gives children — the verdict contract instructs read-only conduct, but that is instruction, not enforcement, so the deployment remains responsible for the child toolset.
- **A gate that is not composed checks nothing.** Like every waterfall policy, the fence exists only while the plugin is loaded; a missing subagent runtime at check time fails closed, but a deployment that never loads this plugin has silently ungated edges.
- **A cached veto points at its original report.** Deleting reports while keeping the cache leaves the pointer dangling; delete the cache directory (or the one record) with them.
