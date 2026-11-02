# @zhchxiao123/dsh-devflow-review-gate

English | [中文](README.zh.md)

Code-review policy on the [`devflow/transition`](../devflow/README.md) waterfall: a configured edge runs [open-code-review](https://github.com/alibaba/open-code-review)'s **delegate mode** for the parts of a review that must not be left to a model — which files are in scope, and which rule governs each — then dispatches one read-only checker subagent per rule group and thresholds their findings against the edge's configured severity. A finding at or above the threshold vetoes the move; every review, passing or vetoing, writes a full report under the card's devflow root.

The split is the point. `ocr delegate` never calls an LLM: it answers *what to review* deterministically, so a large change cannot be selectively skipped and the coverage account belongs to the CLI rather than to the reviewer. The checkers supply judgment, routed through the deployment's own default model like every other agent in this line. No second model configuration, no API key of its own.

**The `ocr` binary is not shipped with this plugin and is not installed by it.** A deployment that wants this gate installs `ocr` itself (`npm i -g @alibaba-group/open-code-review`, v1.9.0 or newer) and then configures an edge. An edge with no entry is delegated untouched, so a deployment that configures nothing is a deployment this plugin does not affect.

## Behavior

For an attempt on edge `from->to` with an `edges` entry, the gate:

1. Checks the installed CLI can emit JSON (`ocr --version`, minimum v1.9.0).
2. Runs `ocr delegate preview --format json` — in **range mode** when the edge names a `baseRef` (`--from <baseRef> --to HEAD`), otherwise in **workspace mode** over uncommitted changes. The result is the authoritative file list; the gate never adds to it.
3. Runs `ocr delegate rule --format json` over the **reviewable** paths only, and takes the diffs from git — against the `merge_base` the preview resolved, never against the ref that was asked for. An untracked file in workspace mode has no diff, so its whole content stands in.
4. Dispatches one checker per rule group, at most `groupConcurrency` at once, under one shared `reviewTimeoutMs`. Each checker sees the card, its own rule verbatim, and only its own files.
5. Holds the verdicts to the CLI's file list: every previewed path must come back `reviewed` or `skipped` with a reason. A path accounted for by neither is a fault.
6. Writes the report under the card's devflow root — **on both outcomes**.
7. Vetoes when any finding is at or above `vetoAtOrAbove`, naming the report file; otherwise delegates, appends its coverage account to the committed entry's `gate.checks`, and (when `artifactKind` is set) registers the report on the card once the move commits.

**Fail closed.** The CLI missing, too old, failing, or emitting something that is not JSON; git failing; the subagent runtime not composed; the provider unregistered; a dispatch rejected; a checker that dies, overruns, or replies without a parsable verdict; a file left unaccounted for; a report that cannot be written — each vetoes the move and parks the card `blocked` (actor `command devflow-review-gate`), so an unattended run stops instead of retrying into the same fault. The whole value of the gate is that a check which could not run is not a passing check.

## Config

```yaml
- id: devflow-review-gate
  name: '@zhchxiao123/dsh-devflow-review-gate'
  config:
    edges:
      'developing->reviewing':
        provider: spawn
        baseRef: main
        vetoAtOrAbove: high
    command: ocr
    exclude: ['**/testdata/*']
    reviewTimeoutMs: 900000
    groupConcurrency: 4
    artifactKind: review-report
```

| Key | Default | Meaning |
|---|---|---|
| `edges` | `{}` | Review policy per `from->to` edge. An edge with no entry delegates untouched. |
| `edges[].provider` | — required | Subagent provider the per-group checkers start on. |
| `edges[].baseRef` | unset | Set selects range mode; omitted reviews the workspace's uncommitted changes. |
| `edges[].vetoAtOrAbove` | `high` | Lowest severity that vetoes: `critical`, `high`, `medium`, `low`, or `never`. |
| `command` | `ocr` | The executable: a bare name resolved on `PATH`, or an absolute path. |
| `exclude` | `[]` | Exclude patterns passed to `ocr delegate`, merged with the repository's own `rule.json` excludes. |
| `reviewTimeoutMs` | `900000` | Milliseconds the **whole** review may take, shared across every group. |
| `groupConcurrency` | `4` | Maximum checkers in flight at once. |
| `artifactKind` | unset | Artifact kind the report is registered under after the move commits. Unset leaves the report in the gate's report directory only. |

Misconfiguration fails the load, naming the config item: an edge key not of the form `<from>-><to>` with known location names, a blank `provider` or `baseRef`, a `vetoAtOrAbove` off the ladder, a blank `command`, an `artifactKind` outside the seam's kind grammar, a non-positive `reviewTimeoutMs` or `groupConcurrency`.

**`vetoAtOrAbove: never` is the first setting to reach for.** It reviews, reports, and never refuses — so a team can read a few weeks of real reports before letting the gate block anything.

**`reviewTimeoutMs` covers the review, not each checker.** What a deployment cares about is how long one transition may block; a per-checker budget would multiply by however many rules the change happened to touch.

## The verdict cache

A verdict is keyed by everything that determined what the checkers saw and judged by: the edge, root, and card; the preview mode and merge base; every reviewable file with its status and line counts; a digest of every rule body; the veto threshold; and the `ocr` version that resolved them. An identical retry reuses the record without dispatching, and its journal check summary is prefixed `[cached] `. A rework loop otherwise pays for a full fan-out of checkers on every attempt.

The cache is an optimization, never an authority. Each record stores its full key, so a hit requires field-by-field equality rather than trusting a truncated filename hash; a corrupt record is a warned miss; an unwritable directory only warns. **Faults are never cached** — a fault means the review did not happen, and a retry must actually retry.

## Where the artifacts go

Nothing to configure. Each artifact lands under the **moving card's own devflow root**:

```
<devflow root>/
  reports/review-gate/{card}-{from}-{to}-r{rev}.md
  cache/review-gate/{key-hash}.json
```

Inside the root rather than beside it, because [`dsh-devflow-fs-guard`](../devflow-fs-guard/README.md) protects the root by name — so the agent whose work this gate judged cannot rewrite the record with its own file tools. One harness serving several projects keeps each project's artifacts in that project, with no path to collide over.

## Model Experience

### Checker prompt

#### What the model sees

Each checker's user message is: the line `You are reviewing devflow card <id> on edge <from>-><to>.`, the card's title and body, its rule group's body **verbatim**, each of its files under a `--- file <path> (<status>) ---` separator with the diff (or the whole content, for a new file), and a fixed closing contract — review only these diffs against only this rule, act as a read-only reviewer, account for every file as `reviewed` or `skipped` with a reason, and end with exactly one fenced JSON verdict block.

The rule body is passed through untouched because it is the repository's own standard when `.opencodereview/rule.json` supplies one. The contract carries one note about it: `ocr`'s built-in rules name the tools of *its* review agent (the Go ruleset says to use `file_read` and `code_search`), which a checker here does not have, so the contract says to use whichever equivalent tools it actually holds. Disambiguating in the contract rather than editing the rule is the difference between explaining the project's standard and rewriting it.

The card's text goes into this prompt rather than through `ocr delegate --background`: that flag only echoes the text back to its caller, and the caller assembling the prompt is this gate, so the round trip would buy nothing while inheriting the flag's size limits.

#### Token effect

One full subagent request per rule group per cache miss, each proportional to the card body plus that group's rule and diffs. Because the CLI groups by rule content, the rule text is sent once per group rather than once per file. Cache hits cost zero tokens; unconfigured edges add nothing to any request.

#### KV Cache effect

Independent: every checker is a fresh one-shot session sharing no prefix with the producer or with the other groups.

## Known Limitations and Deferred Work

- **Several cards in flight on one branch cross-contaminate in range mode.** A card carries no git identity of its own, so `baseRef` is a deployment-wide answer to "what did this card change". When two cards are being worked on one branch, a review of the first also sees the second's changes and files its findings against the first. Workspace mode avoids this at the cost of requiring that `developing` not commit. Fixing it properly needs the card model to carry a range, which is a larger change than this package.
- **A cache hit needs the file list, line counts, and rules to be unchanged**; anything else reviews afresh.
- **Verdict quality is the deployment's and the ruleset's responsibility.** The gate guarantees that the review ran, that its coverage was accounted for, and that a fault never admits a move — not that the judgment is any good.
- **The checker tool face is only restricted when the provider supports it.** With start-time `toolFilter` the gate denies the devflow mutation tools and the file-write tools (intersected with what is actually registered, because the runtime rejects unknown names). A provider without the capability runs checkers with whatever tools the deployment gives children; the contract instructs read-only conduct, but that is instruction, not enforcement.
- **Registering the report on the card is best-effort.** It happens after the move has already committed, so a failed registration only warns — the report directory holds the authoritative copy either way.
- **Requires `ocr` v1.9.0 or newer**, the first release whose `delegate` subcommands accept `--format json`. There is no text-output fallback: parsing the human format would invent structure the CLI never promised.
- **Argument quoting is POSIX single-quoting.** `ctx.shell` takes a command string rather than an argument vector, so every interpolated path is quoted here rather than passed as an argv entry. The published shell surface states no per-platform quoting contract; CI exercises the suite — including a path containing a quote, `$`, and backticks — on Linux, macOS, and Windows.
- **A gate that is not composed reviews nothing.** Like every waterfall policy, the fence exists only while the plugin is loaded and the edge is configured.
