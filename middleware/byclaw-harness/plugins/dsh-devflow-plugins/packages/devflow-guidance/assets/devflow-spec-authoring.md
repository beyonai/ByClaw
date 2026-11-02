# devflow-spec-authoring

Architecture documents live behind `devflow_write_spec` and `devflow_read_spec`:
Markdown under `.devflow/spec/<id>.md` whose claims are tied to the code by
anchors the store re-evaluates on every read. The tool descriptions state the
per-call protocol, and the store rejects a structurally bad write with a stable
code; nothing here repeats either. This skill owns the judgment the mechanics
cannot check: whether to write at all, which anchors to declare, what id to
choose, and what to do when a document decays.

## 1. What deserves a document

Three kinds of knowledge take three homes:

- **Reference** — worth knowing, read when relevant: a package's vocabulary,
  its structural rules, the why behind a seam. This is what spec documents are
  for; they sit behind an index and are read on demand.
- **Obligation** — not following it is a mistake. That takes the opposite
  strategy: record it as an iron rule, whose body stays resident in every
  request, because a rule the model never opened is one it never followed.
  An obligation written as a spec document is silently broken by every reader
  who never opens it.
- **Process judgment** — how to drive the work well. It belongs in skills
  like this one, not in the document set.

The cost asymmetry decides close calls: a document is permanent surface. There
is no delete operation, and growth is charged against a net byte budget, so
every document added is one someone must later merge away. The seam's own
calibration: a document that says one thing well runs a few kilobytes.

## 2. Choosing anchors

Every anchor must evaluate fresh at write time — a non-fresh verdict,
`unevaluable` included, rejects the whole write. So choose by **writability
first**:

- `churn` anchors need git: without history, or on an untracked file, they
  are unevaluable and therefore unwritable.
- `symbol` and `content-hash` anchors need a source language the evaluator
  parses — TypeScript/JavaScript, Python, Go, Rust, or Java; a file no parser
  reads can only carry `churn`.

Then by **strength** — tie each claim to the narrowest thing that would
falsify it:

- `content-hash` pins the symbol's exact (normalized) body: it catches an
  implementation change behind an unchanged name. Omit the `hash` field; the
  store records the current digest.
- `symbol` requires only that the name is still declared in the file: it
  survives body edits and catches renames and removals — right for vocabulary
  and structure claims.
- `churn` is the weakest: any later commit to the file marks the document
  stale, whether or not the claim moved.

The born-stale rule is what makes verdicts trustworthy later: because nothing
non-fresh can be written, a later `stale` verdict always means the code moved
— never that the document was wrong from the start.

## 3. Scope and ids

The id is the query surface. Listing, the per-card specRefs index, and the
coverage census all match on id **prefixes**, so a slash-joined path like
`@scope/package/facet/topic` decides whether the document is ever reached. An
id outside every declared scope names a document nobody is shown.

The body's structural contract: a `## Source of truth` section saying what
each anchor points at, and every declared anchor cited as `[[id]]` — the
citation relation is checked in both directions. What is NOT checked is that
every substantive claim carries an anchor; that judgment is yours, and an
unanchored claim is one whose decay nothing will ever report.

A card names the documents its work touches through a `spec-refs` artifact: a
`## Scope` section, one id prefix per line. A registration that yields no
readable scope — missing section, no entries, an unreadable file — drops the
index and puts a warning line on the card result saying the index is not
being served. Act on that warning: re-register a corrected artifact.

## 4. Revising and merging

`replaces: [<own id>]` IS the revision path. Storage is whole-document —
every write lands a whole new one, so a revision is a full rewrite, not an
edit: naming the same id in `replaces` revises it in place, and naming
several ids merges a cluster into one survivor.

There is no delete operation. The document set shrinks only through
`replaces`, and the growth budget charges the **net** change, so a merge is
never refused for being large. That budget is the standing pressure to merge
rather than accumulate: when a write is refused for growth, merge or retire
documents in the same write, or say less.

## 5. Responding to stale

A verdict is three-valued. `fresh` means the check passed now; `stale` means
it definitely failed; `unevaluable` means it can no longer run — and a check
that cannot run has not passed, so it is never folded into fresh. Roll-ups
take the worst, with `stale` outranking `unevaluable`: a definite failure
survives any number of unknowns.

Reading a decayed document leads with a warning line naming the failing
anchors. Never keep citing such a document as if it were fresh — check it
against the code first, then triage:

- **The code moved** — the usual case, by the born-stale rule: update the
  claims to match the code and rewrite via `replaces: [<same id>]`, which
  re-anchors everything against the code as it stands.
- **The document was wrong** — the claim was bad even while its anchors held:
  replace it with a corrected document the same way, rather than bending the
  code toward wrong prose.

## 6. When not to write

Most knowledge dies with its task, and should:

- One-off details — a bug's mechanics, a migration's steps — live in the
  commit and the card journal, not in permanent reference surface.
- What the code already says plainly needs no document. A document earns its
  bytes by carrying what a reader cannot get from the code in front of them:
  the why, the cross-file rule, the vocabulary.
- A learning whose only audience is the current card belongs in that card's
  artifacts.

Writing nothing is a real option. The index shows one description line per
document, and the budget charges every byte — a document written "just in
case" is surface someone else must later merge away.
