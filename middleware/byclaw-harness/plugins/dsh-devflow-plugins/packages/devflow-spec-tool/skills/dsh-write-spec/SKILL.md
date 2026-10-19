---
name: dsh-write-spec
description: Use when writing or refreshing a devflow architecture document with devflow_write_spec — choosing what a package's spec should claim, tying each claim to an evaluable anchor, shaping the Source of truth section, and reading the write path's refusals. Covers when a claim does not deserve a document at all.
---

# Write a devflow spec document

An architecture document here is not prose that happens to cite code. Every substantive claim rests on a declared **anchor**, and an anchor that stops resolving makes the whole document report itself stale.

That is the only reason this format exists. A document nobody can invalidate is worse than no document: an agent reads it, believes it, and writes code against a rule that stopped being true six months ago. Your job is not to describe the code — it is to describe the code **in a way that will notice when you are wrong**.

## Before writing anything

Ask whether a document should exist at all.

Write one when a package or layer has a rule that is **decidable, non-obvious, and would be violated by a competent stranger**: the split between domain rejections and thrown failures, where validation happens, which module owns a vocabulary, why an event stream exists.

Do not write one for anything the code already says plainly. A document restating a type signature earns nothing and costs a maintenance obligation forever. If your draft's claims all read like the source with more words, delete the draft.

## The anchor discipline

Pick the weakest anchor that would actually catch the change you fear.

| The claim depends on | Use | It goes stale when |
|---|---|---|
| a name continuing to exist | `symbol` | the symbol is renamed or removed |
| how something is implemented | `content-hash` | a line of that symbol changes |
| anything in a file no parser reads | `churn` | the file is committed after the document |

**`symbol` is the default.** Most spec claims are about vocabulary and structure: "the rejection codes are a closed set", "this module owns the replay". A rename is the change that invalidates them, and `symbol` catches exactly that without firing on every unrelated edit.

**Reach for `content-hash` when the claim is about behavior.** "This predicate rejects a move whose reason is missing" is a claim about an implementation; if the implementation changes, the sentence may be false even though the name is untouched. Omit the `hash` field — the store records the current digest for you. You cannot compute it yourself and should not try.

**`churn` is the last resort.** It fires on any commit to the file, so it produces false alarms; use it only for YAML, Markdown, or shell files no parser reads. A `symbol` anchor on a TypeScript file is always better than a `churn` anchor on the same file.

### What not to anchor

- **Do not anchor a test file** to prove behavior. Tests change for reasons that have nothing to do with your claim, and you will train readers to ignore the stale flag.
- **Do not add an anchor you do not cite.** The write path refuses it (`uncited-anchor`), and rightly: an anchor nothing rests on protects nothing while still going stale and costing someone an investigation.
- **Do not anchor everything in sight.** Five well-chosen anchors on a document beat twenty. Every extra anchor is another false alarm waiting to fire.

## Workflow

1. **Read the code first, not the existing docs.** Open `src/`, the tests, and the package README. Establish what is actually true today.
2. **Decide the scope id.** Slash-joined segments (`@scope/package/backend/error-handling`), each matching `^[@a-z0-9][a-z0-9._@-]*$`. One document per topic, not one per file.
3. **Write the claims, then find their anchors.** Not the reverse — starting from anchors produces documents that describe whatever was easy to anchor.
4. **Give each anchor a short local id** (`a1`, `a2`, …) and cite it inline as `[[a1]]` at the sentence it supports.
5. **Write the `## Source of truth` section**: a table mapping each anchor id to what it points at and what the document depends on it for.
6. **Call `devflow_write_spec`.** Read the refusal if there is one; each code names a specific structural defect.

## The Source of truth section

Required, and it is not bureaucracy — it is what lets the next reader judge whether your anchors were well chosen.

```markdown
## Source of truth

| Anchor | Points at | This document depends on it for |
|---|---|---|
| `a1` | `src/types.ts#CreateRejectionCode` | the rejection codes being a closed set |
| `a2` | `src/stages.ts#isLegalTransition` | which edges are legal at all |
```

The third column is the one that matters. If you cannot fill it for an anchor, that anchor should not be there.

## Reading a refusal

| Code | What went wrong |
|---|---|
| `invalid-id` | a segment of the id is not a legal directory name |
| `missing-source-of-truth` | no `## Source of truth` section |
| `no-anchors` | the document anchors nothing and would report fresh forever |
| `duplicate-anchor-id` | two anchors share an id, so a citation is ambiguous |
| `uncited-anchor` | you declared an anchor the body never cites |
| `unknown-anchor` | the body cites an id no anchor defines |
| `anchor-unresolvable` | an anchor does not resolve **right now** — usually a typo'd symbol or path |
| `exists` | that id is taken; name it in `replaces` to revise it, or choose another id |
| `unknown-replaced` | `replaces` names an id no document has; list only ids the index actually holds |
| `budget-exceeded` | the write grows the document set past the deployment's ceiling; growth is counted net of what `replaces` removes, so a merge is never refused for its size |
| `self-waiver` | `waives` names a scope this document itself sits in; that scope has a document and is covered, so waive only scopes no document reaches |

`anchor-unresolvable` is the useful one. It means the document would have been born stale, which almost always means you mistyped a symbol name or pointed at the wrong file. Fix the anchor, not the claim.

## Done criteria

- Every substantive claim carries a citation.
- Every anchor's row in `Source of truth` names something the document actually depends on.
- The document says something a careful stranger could get wrong, not something the source already states.
- The write returned `ok`, which means every anchor resolved against the tree as it is today.
