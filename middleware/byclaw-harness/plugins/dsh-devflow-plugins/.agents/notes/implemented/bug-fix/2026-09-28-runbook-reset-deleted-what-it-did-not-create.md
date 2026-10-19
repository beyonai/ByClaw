# Agent Note: The Runbook Skill's `--reset` Deleted What It Had Not Created

Status: implemented

## Problem

`devflow-e2e-bootstrap-runbook` asks the authoring agent to produce
`e2e/down.sh --reset`, a script whose whole job is destruction. The body said a
great deal about doing that job thoroughly and **nothing** about its blast
radius. The pressure was one-directional, and the deliverable followed it.

A real output demonstrates the result. `/e2e-test-samples/repos/fastapi-template/`
satisfies every rule the body stated:

- `e2e/up.sh:57` brings services up with `docker compose up -d --wait db mailpit`
  — the repository's own `compose.yml`, its default project name, its
  `app-db-data` volume (`compose.yml:88`), its default ports.
- `e2e/down.sh:49` then runs `docker compose down -v --remove-orphans`.

So `--reset` deletes the volume the developer's own development database lives
in, and `--remove-orphans` additionally removes containers of that project the
runbook never listed. `e2e/up.sh:51-53` separately runs
`docker compose stop backend`, stopping a process the developer started.
`/e2e-test-samples/repos/excalidraw/e2e/down.sh:56` has the same shape.

This is not an agent going off-script. It is the script.

**The defect is in `up`, not in `down`.** By the time `down.sh` runs, "the volume
I created" and "the volume that was already there" are the same object, because
`up.sh` joined the repository's existing compose project. Whether cleanup can be
safe is decided at bring-up. Phase two — the bring-up phase — said nothing about
isolation at all; every word about reset lived in phase five.

Four places pushed toward over-deletion:

- `up.sh` was required to be idempotent by *"已就绪的组件直接跳过"*, which
  silently adopts a same-named resource someone else is running — and reset then
  deletes it.
- *"`down --reset` 必须从任意起始状态都到达同一个终态"* named a terminal state
  without bounding it, and its worked example punished only the under-deleting
  failure (skipping `DROP SCHEMA` while claiming clean). It further told the
  agent to *start* a service in order to wipe it.
- The one boundary the body did draw — keep `node_modules`, `~/.m2`, images —
  was justified by rebuild cost, not ownership. A performance boundary dissolves
  the moment rebuilding is cheap.
- The anti-pattern list's only reset entry was *"reset 在没清干净时宣称干净"*.

By contrast the body devoted a full bullet each to host identity and to
credentials. Destructive scope, whose failure is the only irreversible one in
the document, had none.

## Decision

The invariant is stated at **core-principle level**, as a second `## 核心原则`
beside *"只写你亲手跑通的东西"*, not as a bullet inside phase five.

Placement is the decision, not a formatting preference. A bullet at line 111
would sit directly beneath *"必须从任意起始状态都到达同一个终态"* — and between
two instructions that pull apart, a model follows the more specific and more
forceful one. The existing wording was both. So the four conflicting sentences
were **rewritten in place** rather than merely supplemented; an additive change
would have left the old pressure intact and winning.

**Ownership is made decidable at deletion time** by naming, because the agent
that writes `down.sh` cannot rely on remembering what `up.sh` created — often it
is a different agent in a different session. Resources in a shared namespace
carry a `<project>-e2e-` prefix, and deletion **enumerates by that scope**
(`docker ps -aq --filter name=<project>-e2e-`, the runbook's own pidfile, paths
under `e2e/`) rather than by "whatever this compose file declares" or "whatever
is in this directory". Those two enumerations are the defect: neither has any
relationship to ownership. Two hard rules fall out — `docker compose down -v` is
permitted only when the project name is scope-isolated, and filesystem deletion
happens only inside `e2e/`.

**Ownership is transitive.** A database inside a container the runbook created
needs no prefix of its own; owning the container owns its contents. This was not
in the first draft — see below.

**Isolation moved into phase two** as its own bullet: scoped names, an
independent compose project (`-p <project>-e2e`), and ports off the service's
default. It closes by naming what it buys, because the consequence is invisible
from where the rule sits: get this wrong and nothing written later can be right.

**Borrowing is not owning** became an explicit script requirement. Meeting a
same-named resource you did not create means not stopping it, not killing it,
not deleting it, not reconfiguring it — rename, repick a port, or fail loudly and
let a human decide. This is what repairs the idempotence rule, which is retained
but scoped: skip what is ready *within your own scope*.

The terminal state was redefined as "everything you created is gone, everything
else is untouched" — explicitly *not* a cleared environment. Phase six gained a
reverse check, since the previous clean-room pass could only ever observe
under-deletion: compare `docker ps -a`, `docker volume ls`, and `git status`
across the reset, because over-deleting has no second chance the way
under-deleting does.

Two further sentences were found during the read-through and tightened for the
same reason: the `down.sh` usage comment (*"额外清数据回到干净态"*) and the
README template's section 7, which now requires the generated document to list
what reset deletes **and** what it deliberately leaves alone.

## What the reverse check found

The acceptance gate was not "the suite is green" — a prompt change cannot be
proved that way. It was: take the known-bad output and confirm the new rules
convict it, and take a known-good output and confirm they acquit it.
Full record in the task's `research/ac11-reverse-check.md`.

fastapi-template is convicted on all three counts (non-isolated compose project;
stopping the developer's backend; `down -v` on a shared project). miniflux is
acquitted — `miniflux-e2e-pg`, `miniflux-e2e-pg-data`, port 5433, deletion by
those two names only.

The acquittal is what earned its keep. The first draft required a
`<project>-e2e-` prefix on "every named thing … containers, volumes, networks,
compose project, **databases/schemas**, temp directories", which convicts
miniflux's `E2E_DB_NAME=miniflux_test`. That verdict is wrong: the database lives
inside a container the runbook created, never appears in any deletion list, and
cannot reach anyone else's data. The rule was redrawn around **shared
namespaces**, which is what ownership actually tracks. Had only the negative case
been run, an over-strict rule would have shipped — and an agent following it
literally would have gone on to prefix table names.

## A second rule, carried in the same change

Review of this change surfaced an unrelated gap in the same region of the body,
small enough that splitting it into its own change would have had two edits
competing over one paragraph.

The body's only answer to "this environment lacks a dependency the system needs"
was to mark the step `[未验证]` and report it at the end. Nothing told the agent
to **ask**. That produces premature degradation — a half runbook where one
question ("there is a shared test instance at X", "run `make db`") would have
unblocked it — and a worse failure the `[未验证]` path structurally cannot catch:
the agent starts its own `postgres:latest` with an invented password, the health
check goes green, and it writes that up. *"只写你亲手跑通的东西"* is satisfied —
the agent really did run it — so no gate fires, and every later agent reasons
about a middleware version nobody deployed. Running something is not evidence
that it was the right something, and the body never said so.

The rule now sits in phase two beside the mock-versus-real bullet: ask when the
correct shape is not guessable (version, connection form, whether a shared
instance exists, seed data, where credentials come from); ask once and completely;
finish everything that does not depend on the answer first; never substitute
silently. Two seams connect it to the rest — a shared instance the user hands
over is **borrowed**, so the ownership rule forbids deleting it; and `[未验证]`
is re-stated in the core principle as the fallback *after* asking, for the
non-interactive case where no one answers. The anti-pattern list gained the
matching line.

## What pins it

`skill.spec.ts` is the only thing protecting the body; this package has no other
mechanism. Six pins were added at the established "few and stable" granularity —
single sentences, not whole sections: the new heading, the borrowing sentence,
the `docker compose down -v` condition, the anti-pattern entry, the escalation
rule's bold title, and the sentence naming the silent-substitution trap.

Each was checked against the committed body before this change and found absent,
which is what distinguishes a pin that guards the text from an assertion written
against a string that was already there.

## The declaration this invalidated

The count of deliberate divergences from the author's original moves from three
to five — the ownership invariant and the escalation rule. `src/skill.ts`'s
module doc, both READMEs, and the Trellis backend spec each state it, and all
four were updated in the same change — the same obligation the host-identity fix
recorded, arriving for the same reason.

That this declaration has now been invalidated twice in eleven days, by two
unrelated changes, is worth noticing. A count maintained by hand in four places
is a thing each future change must remember; the reason to keep paying it is that
the module doc is specifically what a later agent reads before deciding whether
editing the body is permitted at all.

## Alternatives considered

**Add a bullet to phase five and leave the rest alone.** The cheapest change and
the one that fails: it lands beneath a more forceful competing sentence, and it
addresses cleanup when the defect is committed at bring-up.

**Ship a checker that scans generated `e2e/` scripts for unscoped deletion.** This
package retreated from executor to pure judgment on 2026-09-11, and "nothing
verifies the deliverable" is a recorded boundary rather than an oversight. The
same reasoning that rejected a host-identity checker applies unchanged.

**Require an interactive confirmation or `--dry-run` in generated `down.sh`.** The
consumer is an agent in a short-lived non-interactive shell; a prompt either
blocks forever or is auto-confirmed. It would also break the idempotent
up/check/down contract the body is built around.

**Forbid `docker compose down -v` outright.** Simple to state and wrong — against
a properly isolated project it is exactly the right command, and banning it would
push agents toward hand-rolled deletion loops that are easier to get wrong.

## Consequences

Generated runbooks become slightly more expensive to bring up: a separate compose
project cannot share the repository's already-pulled images by project scope, and
non-default ports mean the developer's usual `psql` invocation will not find the
test database. Both are accepted — the alternative is a test environment that
cannot be distinguished from the development one, which is the defect.

Existing deliverables in other repositories are not retrofitted. The body's
maintenance mode repairs each the next time an agent works from it. Until then
those `--reset` scripts remain destructive, and the two samples under
`/e2e-test-samples/` are deliberately left unmodified as evidence.

Enforcement remains the reading agent's, as with every rule in this body.

No runtime behaviour changes: exports, `Config`, registration rank, and disposal
are untouched, `src/` gains no branch, and the per-file coverage gate is
unaffected.

## Related

- [The runbook skill told agents to commit their own machine](./2026-09-18-runbook-host-identity-leak.md)
  — the same shape of defect: a rule the body needed, whose absence the
  verification phase structurally could not observe.
- [The retreat to a runbook skill](../feature/2026-09-11-testenv-retreats-to-runbook-skill.md)
  — why this package contributes judgment only, which is what rules out a checker.
