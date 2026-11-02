# devflow-spec-bootstrap

Bootstrapping is the cold-start case the incremental judgment does not cover:
a scope the `/devflow spec` census lists with no document at all. The
`devflow-spec-authoring` skill owns what deserves a document and how anchors
are chosen; the `dsh-write-spec` skill owns the write protocol and how to
read a refusal. This skill owns only the procedure that takes an uncovered
scope from zero to a small anchored set — it repeats neither.

## 1. One scope at a time

Take one scope the census reports with no document — or the one a human
names — and finish it before opening another. Bootstrapping works by holding a whole
scope's code in view at once; splitting that attention across scopes yields
documents that describe none of them well.

## 2. Read the code, not the old documents

Establish what is true today from the source, in this order:

1. the package's README and contributor notes — the claimed contracts, taken
   as questions to verify, not as answers;
2. `src/types.ts` — the vocabulary: unions, discriminants, service shapes;
3. the export surface — what the package promises outward;
4. the test titles — the behaviors someone already found worth pinning.

Do not mine legacy design documents, wikis, or stale comments for claims. A
document inherits the reliability of its sources, and prose copied from an
unverified one starts life defending statements nobody checked. The code is
the only source a born-fresh anchor can vouch for.

## 3. What to look for

In descending order of value per byte:

- **Seam contracts** — a capability's definition, provider, and consumer
  roles and which module owns each. This knowledge spans files, so no single
  file states it.
- **Closed vocabularies** — unions, code sets, and state sets that are
  closed on purpose, where adding a member is a design decision rather than
  an edit.
- **Cross-file rules** — a single write path, where validation lives, an
  ordering two modules must agree on. These break silently when one side
  moves alone.
- **Deliberate surprises** — a design that looks wrong until its reason is
  known. Record the reason: without it the design reads as a defect and
  invites a "fix".

## 4. Judge the candidates first

Before drafting anything, list what section 3 turned up — one line per
candidate claim — and give every line a verdict against the write skill's
bar: decidable, non-obvious, and would be violated by a competent stranger.
One sentence of reason per verdict, for the rejections as much as for the
passes. Then write the claims that passed, and only those.

What bounds the count in the end is the stranger test, not a number. A scope
holds only so many rules of that kind, and when the list is spent the scope
is written out, whether that took two documents or six. **The count falls
out of the verdicts; it is never the target they are judged against.**
Nothing here sets a floor either — a scope written up to a number carries
claims that already failed the bar once.

**No candidate passing is a verdict, not a wasted pass.** A scope whose every
line reads back as something the code already says plainly has answered the
census's question, and section 6 is where that answer is recorded. The move
is never to lower the bar until something clears it.

The list is a working artifact: show it in the turn, and keep it out of
`.devflow/spec/`. Its rejections are what make the count reviewable, and a
document carries claims.

## 5. Write few, write anchored

Start with at most three documents per scope. **That is the pace of one
pass, not the scope's total.** It guards against bootstrapping's own failure
mode — enthusiasm at its highest while understanding is at its lowest —
which lands ten documents describing the code file by file, something the
code already does better, and every one of them is surface someone must
later merge away.

The way back is the census. It reports each scope as its document count over
its anchorable-file count, and that pair is a fact, not a threshold: three
documents over a 360-file package and three over a 12-file one are not the
same situation, and telling them apart is a judgement the census leaves to
whoever reads it. **A large scope has earned a second pass, and a third** —
return to it rather than reading the first pass's three as a ceiling nobody
set.

**The first document of a scope orients.** How the module works as a whole,
where its boundaries run, what crosses them: the rest of the scope branches
off it, and detail documents read without it are sharp claims about corners
the reader cannot place. That is an ordering rule and not a file — **do not
write an `index.md`.** A table of contents describes documents rather than
code, so it has nothing it could honestly anchor and the write path refuses
it as `no-anchors`; and the index exists already, derived by `list()` from
every document's id, title, and description.

Choose anchors by the authoring skill's order, writability first, then
strength — and expect the strength half to be where a bootstrapping pass
goes wrong, because it states a whole scope's behavior at once and behavior
is the thing a `symbol` anchor does not watch.

- **`content-hash`** for what the code does: the method set an endpoint
  answers, what a failure path returns, an algorithm, a validation rule.
- **`symbol`** for what the code is called and how it is shaped: a name
  still declared, a union still closed.
- **`churn`** only for a file no parser reads — YAML, properties, Markdown.

The failure is quiet. Take "the retry endpoint answers POST and nothing
else, so a GET gets a 405", anchored `symbol` on the controller type:
someone adds a GET handler, the claim turns false, the type's name never
moved, and **the anchor still reports fresh** — the document states the
opposite of the code with nothing left to report it. A `content-hash`
anchor over the same code flips the day the handler set changes.

Land each document through `devflow_write_spec` as you go rather than
batching drafts.

When a write is refused, fix the anchor, not the claim: per the
`dsh-write-spec` skill, a refusal at write time almost always means a
mistyped symbol or a wrong path, not a wrong sentence.

## Languages without a parser

The census discovers scopes across ecosystems, and anchor evaluation
follows for most of them: `symbol` and `content-hash` anchors resolve
through a per-language parser, and the parsers shipped today read
TypeScript/JavaScript, Python, Go, Rust, and Java. Scopes in those
languages bootstrap with the full anchor vocabulary and the turn-end
sentinel behind it. A scope in a language without a parser — C#, Ruby,
PHP, Kotlin and the rest — is the constrained case: the symbolic kinds
are refused at write time there, and `churn` is the only anchor kind such
a scope can carry. Bootstrap it with the same procedure, three
consequences accepted up front:

- **Freshness lags commits.** A churn anchor compares a file's last commit
  against the document, so the document is still born fresh, but drift shows
  only after the changed file is committed — never while it is being edited.
  The census marks such scopes `churn-only; freshness lags commits`; that
  line is this trade-off restated, not a defect to fix.
- **The turn-end sentinel never fires here.** It reads only `symbol` and
  `content-hash` verdicts, so nothing will ever interrupt a turn on these
  documents' behalf — the `/devflow spec` census is the only thing that
  reports them stale. Re-run it deliberately after working in such a scope.
- **Every churn anchor is a future false alarm.** Any commit touching the
  file flips it, typo and redesign alike, and someone must re-verify the
  claim each time. Be more restrained than section 5 already demands: fewer
  documents, and anchor only the load-bearing files whose change genuinely
  reopens the claim.

In every scope beyond TypeScript — parsed or not — the section-2 reading
order translates rather than lapses: where TypeScript offers `src/types.ts`
and the export surface, read Python's `__init__` re-exports, typing
surface, and model classes; Go's exported identifiers and interfaces;
Rust's `pub` items and traits; Java's public types, interfaces, and the
entities behind them. What counts as a claim (section 3) does not change
at all.

## 6. When the honest answer is no document

Some scopes do not deserve one, and a census that keeps asking does not make
them deserve it. An examples directory whose files exist to be read as
illustrations, a thin wrapper whose whole contract is the library it wraps,
a package whose code already says plainly everything a document would say —
these are the authoring skill's "writing nothing is a real option" seen from
the census's side, and a placeholder written to silence the line claims
nothing and protects nothing.

Record the decision instead. `devflow_write_spec` takes
`waives: [<scope-id>, …]`: a document says in its body why those scopes need
no architecture document, and the census then reports them as waived by that
document rather than as gaps.

**A waiver is not an escape hatch.** What carries it is a real document,
passing every rule any other document passes — a `## Source of truth`
section, at least one anchor, all of them fresh at write time — so the
reason has to be written out and rested on something real: the code that
makes those files illustrations, the wrapper's actual surface, whatever the
judgement was about. If you cannot write that reason and anchor it, you have
not decided the scope needs no document; you have decided not to write one,
which is the state section 7 calls honestly unfinished.

**A waiver expires by itself.** When its anchors stop resolving, the
document goes stale and the census reports `waiver in doubt` in place of a
settled waiver. That is a decision to re-make, not a gap to fill: "those
were only examples" is owed a second look on the day the examples grew into
something real. Re-read the waiving document, then either re-anchor its
reasoning or write the document it waived.

A document may not waive the scope it sits in; that is refused as
`self-waiver`. A scope with a document under it is covered, and reporting it
as waived would put a decision where there is already a document.

## 7. Done, or honestly unfinished

The scope is bootstrapped when the `/devflow spec` census stops reporting it
with no document — because documents landed, or because a waiver decided it
needs none — that is the whole completion criterion, and it is mechanical.
Stopping partway is a legitimate state, not a failure: the census keeps
reporting the remaining gap, so unfinished work stays visible without
depending on anyone's memory. What is not legitimate is silencing the gap
line with a placeholder — a document that claims nothing protects nothing,
and it spends bytes someone must later merge away. When the line should not
be filled at all, section 6 is how it is closed honestly.

**Say what the pass covered before you stop.** Name the scopes it touched,
what landed in each, and how many scopes the census still reports with no
document. Staging is the design — section 1 spends a pass on one scope — so
ending with six of eight scopes uncovered is a pass that ran to plan; what
makes it read as abandonment is ending silently, and whoever asked for a
repository to be documented will otherwise take the scopes in front of them
as the whole answer.

## Putting a pass on the board

Everything above runs without a card, and most bootstrapping should. A
repository whose gaps one pass can close is closed by the procedure itself;
a card opened for it records nothing the census does not already report, and
the paperwork is the only thing it adds.

Put the passes on the board when the work outlives the session that starts
it — more uncovered scopes than one pass can hold, or a run several people
or sessions will take in turns. A card buys two things the census cannot
carry: **the candidate list with its verdicts**, which otherwise exists only
in the turn that spoke it, and **a review of that list by someone other than
its author**. Neither is coverage, and that is the point.

One parent card stands for the repository, one child card per scope the run
will take. Three tools do all of it:

- `devflow_create` opens the parent, then each child naming it as `parent`.
  A bootstrap pass has no design round to skip, so `express` is usually the
  honest class, and `emergency` for a scope whose whole answer is a waiver.
- `devflow_attach_artifact` registers the pass's candidates, verdicts,
  documents written and scopes waived as one artifact — the same list you
  would have shown in the turn, now durable and reviewable. A deployment
  that gates on it names the kind and its sections; the tool result's
  preflight is the authority on what this one requires.
- `devflow_transition` advances the card, and a gate's veto names what the
  list is missing.

**A cross-cutting claim belongs to the scope that owns the contract.** A rule
that spans modules — a routing vocabulary several services agree on, a
configuration chain every module boots through — is written once, under the
scope whose code defines it, and cited from the other scopes' documents
rather than restated in each. Restating turns one claim into as many claims
as there are scopes, and anchors every copy on code that does not own it, so
the copies fall out of step one commit at a time. The parent card is where
such a pass belongs: it crosses the children's scopes by definition, and
making it a child's work would put one scope's card in charge of another
scope's document.

**The board never says what is left.** A card carries one pass's work, its
decisions, and its review; `/devflow spec` carries coverage, computed from
what is on disk and unable to drift. Copying a scope list onto a card as a
progress bar creates a second answer to the census's question, and it starts
diverging the moment a document lands through `devflow_write_spec` while
nobody moves the card. So the parent's completion criterion is the census's
own line — it finishes when the census stops reporting these scopes with no
document, which is the mechanical criterion above and not a checklist the
parent maintains.
