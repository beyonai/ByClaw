# @byclaw/dsh-iron-rules

English | [中文](README.zh.md)

Lets a repository carry its team's iron rules as versioned assets: rule bodies stay resident in the model context before development starts, and each rule's check script runs when a turn that touched files is about to stop.

Rules ship through git — an administrator merges a PR to distribute them, a developer pulls to receive them, and every rule keeps a reviewable history.

The plugin does three things:

1. **Resident injection** — every rule's **body** (not a catalog) reaches the first request and is re-injected automatically after compaction.
2. **Automatic enforcement** — each rule's `check.sh` runs concurrently when a turn that touched files stops, steering the model to fix what failed.
3. **Conversational capture** — the `/iron-rule` command and the `record_iron_rule` tool, with a captured rule taking effect **on the very next request**.
4. **Self-evolution** — capture forces a triage decision, revision and N→1 cluster merges let the set shrink, dead check scripts are reported, and overflow becomes a maintenance instruction. The rule set gets *better* with use, not just *longer*.

## Directory contract

Rules live under `.iron-rules/` at the project root (the nearest ancestor holding `.git`), one directory per rule:

```
.iron-rules/
├── no-any-in-src/
│   ├── RULE.md        # the rule body
│   └── check.sh       # optional check script
└── jsdoc-on-exports/
    └── RULE.md        # no script — injected but never machine-checked
```

`RULE.md`:

```markdown
---
id: no-any-in-src
title: Never use `any` under src/
owner: admin
---

Narrow from `unknown` when a type is uncertain. Declare missing third-party types under `types/`.
```

| Field | Meaning |
|---|---|
| `id` | Redundant with the directory name so the file is self-describing. **The directory name wins** on disagreement, with a warning |
| `title` | Required. A rule without one is skipped with a warning |
| `owner` | `admin` or `local` (default). `admin` rules are presented as non-negotiable; their force comes from code review and git permissions, not from this plugin |
| `enforcement` | `script` (a check script decides violations) or `judgement` (only a reader can). **The triage decision, recorded rather than inferred** |
| `watches` | Space-separated path prefixes, relative to the project root. Required for `enforcement: script` |

The body follows four parts: **the ban** (one bolded, greppable sentence) / **why** / **the correct form** / **what enforces it**.

**Backward compatible**: older rules carry neither new field. A missing `enforcement` is inferred from whether a check script exists; a missing `watches` makes staleness detection skip that rule — **undeclared is neither fresh nor stale**. The requirement applies only to new writes.

The directory name is the authoritative id and must match `^[a-z0-9][a-z0-9-]*$`. `../escape`, `a/b`, and absolute paths are rejected **as ids**, before anything is joined into a path.

One malformed rule is skipped with a warning and leaves the rest armed — a single bad rule must not disable the whole set.

## Resident injection

Rule bodies are injected in full on `agent/pre-step`, with the `admin` group first and labelled non-negotiable.

This deliberately avoids a catalog with on-demand loading. A catalog is right for a capability the model reaches for when relevant — that is what skills are — but a rule is an obligation, and one the model never opened is one it never followed.

Three guarantees:

- **Delegate before injecting** — the listener never short-circuits later pre-step listeners (`dsh-agent-instructions` and `dsh-tool-skill` both sit on this waterfall).
- **Digest idempotency** — SHA-1 over `(id, owner, title, body)` rides the message source; unchanged rules are not republished. The digest covers the **data**, not the rendered prose, so rewording the frame does not resend everything.
- **Republish after compaction** — `session.surface.nodes` decides whether the last rule message is still visible; a compacted one is re-injected in full. **A rule outside the context has silently stopped applying**, which is the failure mode this plugin exists to prevent.

A `</system-reminder>` inside rule text is escaped so repository content cannot close the plugin's own frame.

Past `maxBytes` the leading rules are kept and the message becomes a **maintenance instruction**, not a casualty list: it names the ids that did not load, gives three ways to act (merge, retire, or never-should-have-been-resident), and states plainly that until then those rules will not be followed.

Overflow is a **maintenance event, not a rendering problem**. Listing the casualties and moving on trains everyone to accept a silently shrinking rule set.

## Recording

**The `record_iron_rule` tool is the only writer.** `/iron-rule` writes nothing; it hands the request to the model.

### `/iron-rule <the rule to capture>`

```
/iron-rule stop putting console.log in src/
```

The command frames that line as a task and opens a follow-up turn with `agent.followup()`. The model then:

1. Reads the relevant code to express the rule as it actually applies here
2. Checks the existing rule ids (handed to it with the task) for duplicates and conflicts
3. Decides whether the rule can be checked mechanically, and writes `check.sh` when it can
4. Calls `record_iron_rule` and reports what it wrote

**Why the indirection.** Stating a rule is the easy half; writing a `check.sh` that uses the project's real paths and patterns without false positives is not, and that needs the code in front of you. A command that wrote the chat line straight to disk would capture the user's guess at both. It also gives the command something to show: the model's reply is the confirmation, which is the only settlement text worth rendering here.

### `/iron-rule` with no argument

Listing goes through a turn as well. A command settlement **collapses to one truncated line** in the transcript, which no list of any length reads well in; one request buys ordinary prose layout, and the rules are already resident in context so the model reads no files to answer.

Since the request is paid for anyway, it asks for the two things a plain dump cannot give: grouping into team and local rules, and any duplication or conflict between them.

**With zero rules it does not spend a turn** — one sentence is exactly what a collapsed row renders well, and paying a request to report an empty directory would be absurd.

> **Only usable inside a started session.** `CommandInvocation.agent` is a required field — a command is addressed to an existing agent by type — so on the pre-session launcher a slash line is not dispatched as a command and does not create a session either. Send any message first, then use `/iron-rule`.

### The `record_iron_rule` tool

Parameters are `id` / `title` / `body` / `enforcement` (required) / `check` / `watches` / `replaces`. Besides being driven by an `/iron-rule` task, the model calls it when the user explicitly makes something binding ("from now on…", "this is a hard rule"). The description states that it must **not** be used to summarize advice or the model's own conclusions — a wrong capture reaches the repository and every later session.

### Triage: the question capture must answer

Four hard checks before any write. **Skipping triage is how a rule set ends up as all prose**, so the answer has to be stated:

| Condition | Result |
|---|---|
| `enforcement` missing | Refused (required at the tool schema) |
| `script` without `check` | Refused |
| `script` without `watches` | Refused |
| `judgement` carrying a `check` | **Refused** — the contradiction means no decision was made |

The last one is deliberate: allowing it turns the required field into a formality.

Triage does more than classify. Observed in practice: to make a rule checkable, the model **rewrote the rule itself** — the original phrasing carried a temporal intent ("delete it once you're done debugging") that no script can decide, so rather than forcing an unreliable grep it tightened the ban to "nothing left under `src/`". **Aligning a rule with its enforcement layer** is what the required field actually buys.

### Revision and clustering: how the set shrinks

`replaces: string[]` names the rules this one supersedes; they are **deleted** (git keeps the history).

- **One id** revises a rule in place.
- **Several** merges a cluster. When two or more rules say the same thing, the right move is to fold them into one — not to refuse the third.
- **Team (`admin`) rules cannot be replaced** — their force comes from code review, and editing one from a chat turn would bypass it.
- The budget charges the **net** change: merging three large rules is a reduction, and charging it as pure addition would block the very move that relieves the pressure.
- Any failed check means **zero writes**. A half-applied replacement — new rule written, old one still there — leaves exactly the duplication this exists to remove.

The injected delta **names the superseded ids**: their text is still in the visible history, and nothing else would tell the model they no longer apply.

### Write behavior

| Situation | Result |
|---|---|
| Invalid id (`../escape`, `a/b`, absolute path) | Rejected **as an id**, before the filesystem is touched |
| Id exists and is not in `replaces` | Refused; the message points at the revision path |
| Writing would exceed `maxBytes` (net) | **Refused with the actual byte count**, never truncated |
| Success | Directory written, replaced ones deleted, plus an `agent.inject()` delta effective on the next request |

Recording always writes `owner: local`. An `admin` rule draws its force from code review, and minting one from a chat turn would skip exactly that review — promotion is a reviewed edit to the file, not a parameter.

## Check-script contract

| Aspect | Contract |
|---|---|
| Invocation | `bash <absolute path>`; **no executable bit required** |
| Working directory | The project root (not the session cwd), so relative paths inside the script are stable |
| Exit 0 | Pass |
| Non-zero exit | Violation |
| Killed by a signal | Treated as a violation — no verdict was produced, so it cannot approve the tree |
| stdout | The violation detail written for the model |
| stderr | The script's own errors; logged, and used as the detail only when stdout is empty |
| Cannot run at all | Warned and treated as **passing** — a broken check must not wedge every developer's turn |

Scripts execute directly with no approval prompt. Rules arrive through git, so whoever can change a `check.sh` can already change the code: the script trust boundary equals the repository's write permission.

### Staleness: catching a dead check script

A rule can fail in two ways, and `check.sh` only guards the first:

| Failure | Guard |
|---|---|
| The rule **is not followed** | `check.sh` at turn end |
| The rule **no longer applies** | This section |

The dangerous shape: `check.sh` greps `src/`, but `src/` was renamed to `lib/` long ago. The script **always exits 0** and the surface is always green. **A check that cannot fail is worse than no check — it reads as compliance.**

The test: every path declared in `watches` is gone.

- **Only when ALL are missing.** A partial miss is ordinary directory reorganization, and a false positive here trains people to ignore the signal.
- **No `watches` declared** (older rules, judgement rules) → skipped. Without a declaration staleness is unknowable, and "unknown" must not read as "stale".
- **Nothing is blocked** — not the check run, not the turn, not continuation.

Reporting: a passing check that has rotted is annotated with "its watched paths are gone, so this pass means nothing"; the `/iron-rule` listing calls those out and additionally lists rules that have lost only *some* of their paths (`[id] (3/10)`) for review. **Putting a question mark on the green is the fix.**

#### ⚠ This is far weaker than it sounds

Path existence is a **weak proxy** for "this check still works". What it does and does not catch:

| How a check dies | Caught? |
|---|---|
| `src/` renamed to `lib/` | ✅ |
| The logging library changed and all 8 grep patterns stopped matching (paths intact) | ❌ Not at all |
| A new app was added and never included in the script's scan set | ❌ |

**The second is probably the more common death**, and it is entirely invisible here. For a rule that legitimately spans a whole repository (ten app directories in `watches`), even the first barely applies — all ten vanishing means the repository is empty, so the partial-miss count is the only signal it will ever produce.

Actually proving a check still works needs one of two things, neither implemented: comparing the watched paths' git churn against the rule's own last modification (the `check-entry-freshness` model from `codebase-map-init`), or shipping a known-violating sample per rule that the script must flag.

**So: do not read green here as proof the check is effective.** It rules out one failure mode.

### When it runs

On `agent/turn-stopping`, behind three controls:

1. **Dirty gate** — skipped unless the turn landed a successful `write` or `edit`. `turn-stopping` fires on every turn, including one that only answered a question, and it is awaited, so its cost lands in perceived turn latency.
2. **Concurrent execution** — every `check.sh` runs in parallel and the results fold into one report.
3. **Continuation ceiling** — a failure steers the model into another step to fix it; after `maxRetries` consecutive failures the plugin stops forcing continuation and hands the decision back to the user.

## Configuration

```yaml
- id: iron-rules
  name: '@byclaw/dsh-iron-rules'
  config:
    rulesDir: .iron-rules
    maxBytes: 32768
    checkTimeoutMs: 120000
    checkOutputMaxChars: 2000
    maxRetries: 2
```

| Field | Default | Meaning |
|---|---|---|
| `rulesDir` | `.iron-rules` | Rule directory name, resolved against the project root. Must be a single directory name |
| `maxBytes` | `32768` | Byte ceiling for injected rule bodies. Overflow injects a maintenance instruction; recording past it is refused outright |
| `checkTimeoutMs` | `120000` | Timeout for each `check.sh` |
| `checkOutputMaxChars` | `2000` | Per-violation cap on script output quoted back to the model, so a runaway script cannot flood the context |
| `maxRetries` | `2` | Consecutive forced continuations. `0` reports once and never forces a retry |
| `requireApproval` | `false` | Reserved: require approval before executing a check script. Not yet honored |

## Install

**Install the packed tarball, not the directory.**

```sh
npm run package        # build + npm pack → byclaw-dsh-iron-rules-<version>.tgz
dsh plugin --profile <name> add /abs/path/to/byclaw-dsh-iron-rules-0.1.0.tgz
# restart the profile
```

Verify:

```sh
dsh --profile <name> --dump-config | grep iron-rules   # the plugin row must appear
```

The plugin is inert in a repository with no `.iron-rules` directory, so it is safe to install before authoring any rules.

> **Why the tarball is required.** This directory's `node_modules/@deepseek-ai/*` are dev-time symlinks (below). Installing the directory links the whole tree into the profile, and those symlinks then **shadow the profile's own copies**. The built output really imports `@deepseek-ai/schemastery`, `dsh-llm`, and `dsh-tools` at runtime, so resolving them to the source checkout hands the plugin different module instances than the host — schemastery most dangerously, since the Loader validates this plugin's own Config with it. The tarball carries only `lib/`, the manifest, and `cordis.patch.yml`.
>
> **Exception: when the plugin already lives inside a DSH workspace** — which is how the image builds it — those symlinks point at the very packages the host runs, so they are the same module instances and installing the directory is safe. The `Dockerfile` therefore does `dsh plugin add <directory>` like every other plugin here. The test is not directory-versus-tarball; it is whether the linked packages are the same ones the host uses.

### Dev-time dependencies

DSH packages are unpublished and this repository is not a DSH source workspace, so `workspace:` ranges cannot resolve. `scripts/link-dsh.mjs` symlinks the `@deepseek-ai/*` packages it compiles against into a **read-only** DSH checkout (`/workspace/deepseek-harness` by default, `DSH_ROOT` to relocate); Node then resolves each package's `exports` to its built `lib`. The links point into the checkout and never write to it.

Three link sources are tried in order, so a machine with **only the dsh runtime installed and no source checkout** can still build:

| Priority | Source | Location |
|---|---|---|
| 1 | Explicit | `$DSH_ROOT` |
| 2 | Discovered | a `deepseek-harness/` directory beside any ancestor of the plugin |
| 3 | Installed dsh | `$DSH_HOME/profiles/node_modules/@deepseek-ai/` (default `~/.dsh`) |

**There is deliberately no absolute default.** A container and a host sharing its filesystem reach the same files through different paths, so any hardcoded absolute path is guaranteed to be wrong on one of them. Walking up resolves from either view and spans both repository layouts (`plugins/<name>` and `.worktrees/<branch>/plugins/<name>`).

When none exists the script **aborts naming where it looked**, rather than letting tsc bury the cause under a screen of TS2307s.

```sh
npm install            # typescript / @types/node only
npm run verify         # link:dsh, build, and the offline smoke suite
```

`build` and `typecheck` both run `link:dsh` first, so pruned links self-heal — **do not rely on the symlinks persisting in `node_modules`**. This is deliberately **not** a `postinstall` hook: `scripts/` is outside the published `files`, so the hook would fail the whole install wherever the package is consumed as a tarball.

> Building is only needed to CHANGE this plugin. Installing it needs nothing but a prebuilt tarball — no DSH source at all.

## Model Experience

### Resident rules

#### What the model sees

One user-role message framed as a `<system-reminder>` holding every rule body, carrying the typed `iron-rules` source (`form: 'instructions'`, with its digest and id list). A newly recorded rule arrives as a delta rather than a full resend.

#### Token effect

Bounded by `maxBytes` (32 KiB default) and carried on every request until compaction. An empty `.iron-rules` costs nothing. Each capture appends a delta that stays in context afterwards, so frequent capture is not free.

#### KV Cache effect

Append-only after the reusable prefix. A post-compaction republish creates a new history position and reuse resumes from there.

### Check-failure feedback

#### What the model sees

A continuation message sourced as `{ kind: 'plugin', plugin: 'iron-rules' }` carrying each failing rule's id, its script stdout (capped at `checkOutputMaxChars`), its `RULE.md` path, and the remaining retry budget. At the ceiling this becomes a notice that does not force continuation.

> Failure feedback uses the generic plugin source while rule bodies use the typed `iron-rules` source. The asymmetry is deliberate: only the latter is scanned back and digest-compared; the former is transient steering.

#### Token effect

No cost when checks pass or the turn touched no files. Each forced continuation pays for another full request.

#### KV Cache effect

Append-only; the added content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations

- **Rules are read through `node:fs`, not `ctx.fs`** — rules are undiscoverable in a remote or sandboxed workspace (e2b). The check scripts themselves run through `ctx.shell` and are unaffected.
- **No file watching** — an external edit becomes visible at the next pre-step or turn-stopping scan. Because every pass re-reads, the practical delay is small.
- **Recording cannot create or replace an `admin` rule** — that would bypass the review giving `admin` its force. `local` rules can be revised and merged through `replaces`.
- **Staleness detection depends on a `watches` declaration**, so older rules and judgement rules are outside its coverage. A "this check has never failed" signal would need persisted run history and is not implemented.
- **`owner: admin` only affects presentation and write refusal** — it stops nobody from editing the file directly; git owns the real permission.
- **A recorded `check.sh` takes effect within the same session** without review. For `local` rules that is the intended fast path, and the model already has `write` and `bash`, so the marginal risk is small — but it is worth knowing.
- **`requireApproval` is a configuration slot with no implementation**, reserved for deployments that run untrusted checkouts.
- **`check.sh` runs through `bash`**, which the host must provide. Windows needs WSL or Git Bash.
- **Enforcement is silently inactive without a `shell` service.** The plugin declares no hard injection — one would hold the whole plugin in `PENDING` and take rule injection and recording down with it — so it loads normally and only the enforcement half stays unmounted. Likewise, a missing `commands` or `tools` registry drops just that entry point.
- **No real-agent end-to-end verification yet** — the dirty gate, continuation ceiling, and injection timing have offline coverage only.
