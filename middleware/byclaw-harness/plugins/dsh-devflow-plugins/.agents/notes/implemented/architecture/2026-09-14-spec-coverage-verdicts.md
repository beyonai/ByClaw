# Agent Note: The coverage census answers three questions, not one

Status: implemented

## Problem

`/devflow spec` asked one question of every expected scope: does it have at least one document? A binary answer to a question with three answers leaked at both ends.

**A large package went green early and stayed there.** `@excalidraw/excalidraw` — 362 files, 88K lines — took the bootstrap skill's opening three documents and the census reported "every expected scope has at least one document". The skill's own wording was "start with at most three", the pace of one pass; but with nothing that ever called anyone back, a starting pace silently became a permanent ceiling. Nobody decided that three documents were enough for 362 files. The report simply stopped asking.

**A scope that deserves no document was asked for one forever.** `examples/with-nextjs` is 84 lines whose honest answer is that nothing here is worth an architecture document, and every run listed it as a gap. The one move that would clear the line — a placeholder document — is exactly what the bootstrap skill forbids ("a document that claims nothing protects nothing"), so the only remaining move was to ignore the line. A signal that is permanently red teaches as little as one that is permanently green, and this one taught people to skim past the gap list that also held the real gaps.

## Decision

The census places every expected scope in one of three states — **no document**, **documented**, **waived** — and reports each one over the count of files under it that an anchor could point at.

### Density is reported as a fact, with no threshold anywhere

Each scope's line reads `N document(s) over M anchorable file(s)`. Nothing derives a verdict from `M`: no ratio, no floor, no warning for a scope that looks thin. The census says what is there and hands the judgement back, because "is this enough?" is a natural-language question about a particular package.

That is the same line this seam already drew once. The [anchor-model note](2026-09-02-devflow-spec-anchor-model.md) records why the structural contract does not check that every substantive claim carries an anchor: it is a judgement, and "putting an uncheckable rule in the mechanical layer produces a check that only pretends to be strict". A minimum document count per file count would have been exactly that check — trivially satisfied by three thin documents, and wrong for the honest 12-file package it would have flagged.

What the fact buys is the return path the skill never had. Three documents over 360 anchorable files and three over 12 no longer read the same, so the bootstrap skill's writing section now says plainly that three is one pass's pace rather than the scope's total, and names the census as how a large scope gets a second pass and a third.

### A waiver is carried by a real document's `waives` field

`SpecDocument` frontmatter takes an optional `waives: [<scope-id>, …]`, and the census reports those scopes as `waived by <document id>` instead of as gaps.

The carrying document is an ordinary document. It passes the `## Source of truth` rule, the two-way citation relation, at least one anchor, all of them fresh at write time, and the net growth budget. Four properties fall out of that with no new mechanism:

- **The reason has to exist and be written down.** A waiver that cannot say why those scopes need no document cannot be written at all.
- **The reason has to rest on code.** Anchors are how this seam ties prose to something falsifiable, and a waiver gets no exemption.
- **The waiver expires by itself.** When those anchors stop resolving, the document goes stale and the census reports `waiver in doubt` — with a closing instruction distinct from the gap instruction, because "the reasoning has moved, re-make the decision" is not "write the missing document". The judgement "examples/ is only illustrations" is owed a second look on the day examples/ grows into something real. **This is the most valuable property of the design**, and it is free.
- **It cannot be a placeholder.** The structural contract already refuses a document that claims nothing.

A waived scope is not a gap: the report's "merge, retire, or write what is missing" never counts one, because pushing a decision already made back into the backlog undoes it.

Nothing is folded away silently. A waiver naming a scope the expectation never asks about is listed on its own — the id is misspelled, or the package is gone, and silence would leave its author believing the waiver decided something. Several documents waiving one scope are all named. A scope that holds both a document and a waiver is reported as documented, with the overtaken waiver named so someone can retire it.

### A document may not waive the scope it sits in

Refused at write time as `self-waiver`, a new member of the closed `SpecWriteRejectionCode` set. The test reuses the index's own relation: `list(scope)` answers with any document whose id equals the scope or descends from it, so the refused case is exactly the one where a census asking about the waived scope would find the waiving document under it. That scope is **covered**; calling it waived would fold two different answers into one.

Two things are deliberately not checked at write time, because the answer is not in the request: whether anything expects a document from the waived scope, and whether another document already waives it. Both belong to whoever holds the expected set, which is the census, and the census reports both cases rather than refusing them.

### `anchorableExtensions` is a seam member, not a value import

The denominator is "files a symbol anchor could point at", which only the mounted provider knows — its evaluator registry decides what resolves. The census reaches it through `ctx.get('devflowSpec')` as a new abstract member on `DevflowSpecStore`, answered by the filesystem provider from `ANCHORABLE_EXTENSIONS`.

The command plane cannot value-import the provider: the spec seam is optional there, and a composition may mount a different provider or none. A copied language list would have been the alternative, and it would have started lying the day a sixth language landed — quietly, since a file nobody counts reports nothing. There is no default on the abstract member for the same reason.

## Alternatives considered

**An `acknowledgedScopes` list in the command's own config.** Rejected. "The examples directory deserves no architecture document" is a property of the repository, not a preference of a deployment; in a profile the decision travels with the deployment instead of with the code, and is lost when a second profile is added. Configuration also has nowhere to write the reason, which is the part worth keeping.

**Dropping such scopes from `specScopes`.** Rejected. That merges "we decided this needs no document" with "nobody ever asked", which is precisely the information loss this census exists to prevent — the same reason the report distinguishes an unasked coverage question from full coverage.

**A separate waiver store with its own tool.** Rejected under "require a current owner and need": a new storage surface, a new tool, and new rejection codes, bought against a capability documents already have in full. The waiver needs a body, anchors, a revision path, and an expiry rule — four things the document format already provides.

**An empty document with a `kind: waiver` marker.** Rejected as self-contradictory: the bootstrap skill forbids placeholder documents, and inventing a blessed placeholder would make the skill argue with the format it teaches.

**A mechanical threshold on documents per anchorable file.** Rejected — it is the failure this change is fixing, not a fix. See the density section above.

## Consequences

**The census output changed shape.** The former "expected scopes with no document" block and the "every expected scope has at least one document" line are one census block now: a tally, then one line per scope. Fourteen assertions across eight existing tests in `packages/devflow-command/tests/spec-health.spec.ts` moved with it, each keeping its original meaning — the origin of the expectation is still named, a gap is still a gap, and an exact-id match still counts as covered.

**`waives` is optional everywhere.** A document without it decodes, re-encodes, and reports exactly as before, and a deployment that never writes one sees the same three states minus the waived one.

**The tree walk is confined to `/devflow spec`.** Counting happens on a human-invoked command only; the pre-step index and the turn-end sentinel walk nothing. Skipping dot directories and `node_modules` without parsing `.gitignore` is the stated rule, coarse on purpose — an ignore-file parser is a second unbounded question, and a rule that fits in one sentence is one a reader can argue with. A member directory that will not open reports `could not read <dir>` rather than counting zero, because "nobody could look" and "this scope holds nothing" are different facts — and `<dir>` is the directory as the layout service spelled it. Each member is carried in two forms: a normalized path for the walk and for the nested-scope comparison, where two spellings of one directory must compare equal, and the reported spelling for the census line, where re-resolving the seam's already-absolute `dir` bought nothing and printed a path the detector never named.

**One new honest burden.** A waiver in doubt is real work: someone has to re-read the waiving document and either re-anchor its reasoning or write the document it waived. The design deliberately offers no way to renew a waiver without re-establishing why it holds, which is the whole reason it is carried by an anchored document.
