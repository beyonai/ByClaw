# Agent Note: code review as a transition gate, over open-code-review's delegate mode

Status: implemented

## Problem

The Harness agent reviewing its own work fails in three ways that are hard to
fix by rewriting a prompt. On a large change it reviews some files and quietly
skips the rest. Its findings drift off the lines they describe. And the quality
swings with wording, because nothing in a natural-language review is
load-bearing enough to debug.

devflow had no answer to this. `reviewing` was a stage a card passed through,
and whether a review had actually happened — let alone what it covered — left
no trace anyone could check afterwards.

[open-code-review](https://github.com/alibaba/open-code-review) is built around
exactly that split: deterministic engineering decides *what* to review, an
agent decides *whether it is good*. Its **delegate mode** exposes only the
deterministic half (`ocr delegate preview` for the file list, `ocr delegate
rule` for the rules) and never calls an LLM, so the judgment can stay on the
deployment's own model.

## Decision

`@zhchxiao123/dsh-devflow-review-gate` is a policy on the `devflow/transition`
waterfall. A configured edge runs `ocr delegate` for scope and rules, dispatches
one read-only checker subagent per rule group, holds their verdicts to the
CLI's file list, and vetoes when a finding reaches the edge's configured
severity. Every review writes a full report under the card's devflow root; when
`artifactKind`
is configured the report is also registered on the card after the move commits.

**It is a gate rather than a skill.** A skill would have told the agent to run
the review and register a report — leaving both the running and the honesty of
the coverage account to the same agent whose work is under review. The gate
runs `ocr delegate preview` itself, so the authoritative file list is the CLI's
and a checker that reviewed half its group is a fault rather than a quiet pass.
It also makes "installed and configured" the single opt-in switch: an edge with
no entry is delegated untouched, and the bundle mounts the row `disabled: true`.

**Delegate mode only.** `ocr review`'s default mode would require a second model
configuration and its own API key, which contradicts this line's standing
promise that optional agent checks use the harness's configured provider.

### What the card cannot tell us

`DevCard` carries no git identity — no branch, no base ref, no commit range.
So the gate cannot derive what a card changed, and `edges[].baseRef` is the
deployment's answer instead: set it for range mode, omit it to review the
workspace's uncommitted changes.

The cost is recorded as the package's first Known Limitation: with two cards in
flight on one branch, a range-mode review of the first also sees the second's
changes. That is a real defect in the product, not in the implementation, and
fixing it means putting a range on the card — a larger change than this one.

Because of that, the report's frontmatter carries `mode`, `base_ref`,
`merge_base`, `head`, and the full coverage account. A card with no git
identity would otherwise leave a review that could not be audited afterwards at
all.

### Two writes that cannot be awaited

The store serializes per card, and this waterfall runs inside the very
transition holding the moving card's turn. A synchronous store write here
deadlocks. Both of the gate's store writes therefore queue and warn, in
`src/queue.ts`:

- **Parking a card `blocked`** after a fail-closed veto queues behind the
  transition being rejected — the same shape `dsh-devflow-agent-gate` uses.
- **Registering the report on the card** happens from `devflow/stage-changed`,
  after the move has already committed. A failure there only warns: the move is
  durable, and making a failed registration look like a failed transition would
  be a worse lie than a missing artifact. The report directory holds the authoritative
  copy, which is also why the report is written on *both* outcomes rather than
  only on a veto.

### What the CLI actually returns

The upstream Skill documentation describes the delegate output in prose, and the
prose and the program disagree. Parsing was written against captures from a real
`ocr v1.12.0` (`tests/fixtures/`), which settled four things:

- An empty review is an ordinary envelope with an empty `reviewable_files`, not
  the `status: "skipped"` envelope `ocr review` emits. The delegate output has
  no `status` field at all.
- `ocr delegate rule` answers for an excluded path too, with a fallback rule, so
  only `reviewable_files` may be sent to it.
- `rule` groups by rule content, so its output is proportional to the number of
  distinct rules rather than to the file count. A configurable batch size had no
  real consumer and was dropped for a fixed command-line character guard.
- The built-in rulesets name the tools of *`ocr`'s own* review agent (the Go
  ruleset says to use `file_read` and `code_search`). Rule text is a project's
  standard and is passed through verbatim, so the fixed contract disambiguates
  the tool names instead.

## Alternatives considered

- **A bundled skill in `devflow-guidance` plus an artifact contract.** Adds no
  package, but leaves coverage as something the reviewed agent asserts about
  itself, and puts an external CLI's usage into the package whose two skills are
  defined as the board process — every devflow user would carry that prose
  whether or not they have `ocr`.
- **A config of `dsh-devflow-agent-gate`.** That gate inlines artifacts into one
  prompt and has no notion of running a CLI to partition a change; the overlap
  is the dispatch plumbing, not the policy.
- **Extracting the synthetic-parent helper into a shared package.** `dispatch.ts`
  restates `createGateAgent` and `CHECKER_DENIED_TOOLS` from
  `dsh-devflow-agent-gate`, which are package-internal and therefore not
  importable. Extraction would mean editing that package too; the restatement is
  documented at both sites as a copy whose divergence is a defect. A third
  consumer would be the point to reconsider.
- **A per-checker timeout.** `reviewTimeoutMs` covers the whole review instead,
  because what a deployment can reason about is how long one transition may
  block — a per-checker budget multiplies by however many rules the change
  happened to touch.
- **Defaulting an unrecognized severity.** A severity outside the closed ladder
  invalidates the whole verdict block. Severity is what the threshold compares
  against, so guessing one would decide a transition on a value the checker
  never gave. Category, which nothing decides on, is carried through verbatim.

## Consequences

- A deployment gets a review whose coverage is accounted for by the CLI, with a
  durable report per attempt and a `never` threshold to run it in observation
  mode first.
- devflow now has a package that depends on an external binary. It is optional
  at every level — not shipped, not installed, `disabled: true` in the bundle,
  and inert on any edge without an entry — but the precedent is new for a line
  that until now consumed only published npm packages.
- Eleven distinct faults fail closed, each parking the card. That is the right
  posture for a gate and it also means a broken `ocr` install stops the board
  rather than silently passing work through.
- The synthetic-parent plumbing now exists twice in this repository.
- Every interpolated path is POSIX single-quoted, because `ctx.shell` takes a
  command string rather than an argument vector. The published surface states
  no per-platform quoting contract, so this rested on an assumption until CI
  ran the suite — including a path containing a quote, `$`, and backticks —
  on Windows as well as Linux and macOS.
