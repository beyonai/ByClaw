# @zhchxiao123/dsh-devflow-iron-rules

English | [中文](README.zh.md)

**Repository-carried iron rules**: a workspace records its binding development rules as `.devflow/iron-rules/<id>/` directories, each holding a `RULE.md` body and, for mechanically checkable rules, a `check.sh`. Rule bodies stay resident in the model context, and every check script runs when a turn that touched files is about to stop, feeding failures back as forced continuation. A workspace with no rule directory makes the plugin inert.

This is deliberately the opposite shape from devflow's `specRefs` index, and the two do not compete: an index is the right shape for a capability the model reaches for when relevant — architecture documents, read on demand through `devflow_read_spec` — while a rule is an **obligation**, and one the model never opened is one it never followed. The triage between the two is exactly what a `spec-delta` classification decides: `reference` goes to the [spec seam](../devflow-spec/README.md), `obligation` comes here.

The rule vocabulary restates `@byclaw/dsh-iron-rules`, which this package was ported from; a semantic divergence from it is a defect in this package. One stated behavioral difference: the port source sends its give-up and zombie notices from inside the turn-stopping window, which at the pinned harness costs an extra continuation step, while this package delivers them as the next turn opens — the timing the notices always claimed. **Do not mount both in one profile** — each would inject the rules and run the checks a second time, with separate retry counters.

## Contract

Four mechanisms, and the package is not itself without any of them:

1. **Residency.** On each `agent/pre-step` the plugin checks whether the current rule set — identified by a digest over rule data, not rendering — is still on the session's visible surface, and appends the full rule block when it is not: on the first step, after a rule changes, and after compaction shadows the block. Rules are injected in full rather than as a catalog. `admin`-owned rules render first as non-negotiable; `owner: local` is what recording writes, unconditionally, because an admin rule draws its force from code review and minting one from a chat turn would skip exactly that review.
2. **Enforcement.** A successful first-party `write`/`edit` marks the turn dirty; when a dirty turn is about to stop, every rule's `check.sh` runs (via `bash`, in the session workspace root). Failures come back as forced continuation naming each rule, its output, and the rule path, up to `maxRetries` consecutive attempts — then the plugin says enforcement stopped and hands the decision back, rather than giving up quietly. Giving up costs no extra step: at the pinned harness any message sent from inside the turn-stopping window — injected as much as steered — forces one more continuation step (the same measured contract [`devflow-spec-sentinel`'s composition notes](../devflow-spec-sentinel/README.md#composition-notes) hold that plugin to), so the plugin records the give-up notice and injects it as the agent's next turn opens; a session that never opens another turn ends with the decision already handed back, and the notice is discarded with the agent. A check that cannot run at all is treated as passing and logged (a broken check must not wedge every turn), but a check that was **killed** — timeout or signal — produced no verdict and is treated as a violation.
3. **Stated triage.** `devflow_record_iron_rule({ id, title, body, enforcement, check?, watches?, replaces? })` requires `enforcement: 'script' | 'judgement'` — `script` REQUIRES `check` and `watches`, `judgement` forbids `check`. Skipping the question "can a script decide this?" is the default way a rule set ends up all prose. Recording validates everything before the first write (a refused request leaves the rule set exactly as it was), then injects the new rule into the current context immediately — waiting for the next session would leave it inert for the rest of this one.
4. **Shrinkability and decay.** `replaces` deletes the named rules after the replacement is written: one id revises in place, several merge a cluster — the only way the set shrinks. The byte budget (`maxBytes`) charges the **net** change, so a merge that relieves pressure is never refused as an addition. In the other direction, a passing check whose `watches` paths have ALL disappeared is reported, when the next turn opens, as one that can no longer fail — a zombie pass reads as compliance and is worth exactly nothing; a partial miss only logs, because reporting ordinary directory moves as rot trains everyone to ignore the signal.

The rule root resolves like every other devflow root: `<session cwd>/.devflow/iron-rules`, falling back to the configured `root` — **not** the nearest git ancestor, so rules, cards, and spec documents always share one `.devflow/`. Check scripts consequently run from the session workspace root, and `watches` are workspace-relative.

### The `devflowIronRules` service

`ctx.get('devflowIronRules')` exposes `record(agent, input)` — the same write path as the tool, published so another plugin can forward an obligation (a `spec-delta` classification, for instance) as one call instead of hoping a model remembers to. A deployment without this plugin has nowhere to forward an obligation and must say so explicitly rather than dropping it.

## Trust boundary

Rules carry **executable shell scripts**, and there is no pre-execution approval step. The reasoning, in full: `.devflow/iron-rules/` is reachable only through `devflow_record_iron_rule` (in-session, tool-audited) or through git (a reviewed commit) — the model's file tools are denied the directory by [`dsh-devflow-fs-guard`](../devflow-fs-guard/README.md), one fence more than a plain rules directory has. The script trust boundary therefore equals the repository's write permission plus the tool plane, the same level as the repository's own `package.json` scripts or CI config. **A deployment that runs untrusted checkouts should not mount this plugin.**

## Configuration

```yaml
- name: '@zhchxiao123/dsh-devflow-iron-rules'
  config:
    root: .devflow/iron-rules   # fallback rule root for sessions without a cwd
    maxBytes: 32768             # byte ceiling for resident rule bodies
    checkTimeoutMs: 120000      # per-check.sh timeout
    checkOutputMaxChars: 2000   # per-failure cap on quoted script output
    maxRetries: 2               # forced continuations before handing back
```

Recording past `maxBytes` fails loud with a maintenance instruction; a rule set over the ceiling at injection time publishes what fits plus the list of what did not, stated as rules that are **not being followed** until someone merges or retires — listing the casualties and moving on would train everyone to accept a silently shrinking rule set.

## Rendering intent

An `other`-kind `generic` card titled by the rule id, with the rule title as `rawInput`. The presenter is a pure function of the arguments.

## Model Experience

### Tool schema

#### What the model sees

One tool. Its description carries the recording discipline — record only on a trigger (an incident, the same mistake twice, an outright stated requirement), never speculatively — because a rule set assembled from summarized advice enforces nothing anyone decided. The resident rule block and every check failure arrive as ordinary context.

#### Token effect

A fixed schema cost while the plugin is active, plus the resident rule block once per publication (re-sent only when the rules change or compaction shadows them), plus check-failure feedback on turns that violate a rule. Give-up and zombie notices arrive as the next turn opens rather than extending the stopping turn.

#### KV Cache effect

The rule block is injected as a durable user message rather than mutating the prompt prefix, so reuse degrades only at publication points: recording a rule or republishing after compaction invalidates from the injection onward.

## Known Limitations and Deferred Work

- **No `/iron-rule` command.** The convenience surface (list rules, frame a capture as a model turn) is deliberately deferred; the tool is the capability, and recording still happens through ordinary conversation.
- **Only first-party `write`/`edit` mark a turn dirty.** A shell command that mutates files does not trigger the checks — the same tool-plane exposure the fs guard has, not one this plugin introduces.
- **No co-mount detection.** Mounting this beside `@byclaw/dsh-iron-rules` doubles injection and enforcement; nothing warns. Keep one.
- **`admin` rules are authored only by editing files through review.** Recording always writes `local`; promotion is a reviewed change of the `owner:` line, by design rather than omission.
