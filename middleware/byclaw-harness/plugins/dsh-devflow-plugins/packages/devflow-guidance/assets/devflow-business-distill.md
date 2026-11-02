# Distilling business knowledge

Turn unstructured material — technical proposals, stability walkthroughs, incident reviews,
meeting notes — into a knowledge base an agent can read along a determinate path.

The skeleton is a structured directory, not a vector index. Knowledge has structure and suits
structured indexing; retrieval answers "where might there be material", never "does the agent
now hold what it needs to judge". Retrieval is for the long tail, after the skeleton stands.

## What this layer is, and what it is not

devflow already holds two kinds of knowledge, and business facts are neither:

| | anchored to | goes stale when | write path |
|---|---|---|---|
| spec document | code — symbol, content hash, file churn | a parser says so | `devflow_write_spec` |
| iron rule | an obligation a script checks | `check.sh` fails | `devflow_record_iron_rule` |
| **business knowledge** | **registered source material** | **only a human can say** | **`devflow_write_business`** |

No anchor evaluates a business fact and no script decides one. That is why this base has a
review fence instead of a freshness verdict, and why nothing here interrupts a turn — business
knowledge is a reference, and its reader owes it a look rather than a fight.

**The tool is the only way in.** `.devflow/business/` is fenced by the fs guard: `write` and
`edit` are denied there. Reading is not — use `Read`, `Glob`, and `Grep` freely to navigate the
base. Only authoring goes through `devflow_write_business`.

## The buckets

One knowledge base serves ONE stable business domain. Another domain is related through
`reference/`, never merged in.

| Bucket | Takes | Does not take |
|---|---|---|
| `meta` | objects, state meanings, boundaries, aliases, NON-synonyms | implementation detail |
| `principle` | constraints that hold across scenarios — idempotency, consistency, timeout, compatibility, degradation | one-off decisions |
| `scenario` | a scenario mapped to entry API, call chain, data, messages, exceptions, compensation | fragments belonging to no scenario |
| `practice` | a past decision AND its reason, incident lessons, why a compatibility path exists | hearsay with no source |
| `reference` | the contract and relationship with a neighbouring domain | that domain's internals |

## The procedure

Copy this into your reply and tick as you go:

```
Distillation:
- [ ] 1. Register sources
- [ ] 2. Establish the vocabulary (meta) first
- [ ] 3. Sort candidates into buckets
- [ ] 4. Turn diagrams into written conclusions
- [ ] 5. Write one fact per call
- [ ] 6. Cross-link
- [ ] 7. Self-check
- [ ] 8. Record the batch
```

**1. Register sources.** Every input material gets an entry in
`.devflow/business/source-manifest.yaml`: id, path or URL, document type, date. Entries are
`  - id: <value>` under a `sources:` key, indented. **Unregistered material is not a source** —
`devflow_write_business` refuses `sources` it cannot find there, so registration comes first.

The manifest sits inside the fence and no tool writes it: adding an entry is a reviewed edit,
made by a human or through git. Ask for the entries you need before distilling, and name the
materials precisely. The registry of what may be cited does not extend itself from a chat turn,
for the same reason a claim does not confirm itself from one.

**2. Establish the vocabulary first.** Read everything, then write `meta` documents for the
business objects, states, aliases, and **non-synonyms**. Disambiguation is step one: an "order"
that means the trading order in one team's speech, the payment record in another's, and the
delivery record in a third's will send every later bucket off course. Pin it down before
sorting anything.

A first `meta` document is cited by nothing, and that is correct — the base is written meaning
first. Nothing refuses it.

**3. Sort candidates.** Second pass over the material, each candidate into the bucket above.

**The distillation boundary.** Determinate rules and facts — IF-THEN, contracts, red lines —
distil well; take those first. A **judgement call** (two defensible options, and someone picked
one) is NOT a rule. Record what was chosen and why as a `practice` document, and leave the
judgement to the future reader. Encoding judgement as a rule manufactures confident, plausible,
wrong knowledge — the most expensive thing this base can hold.

**4. Turn diagrams into written conclusions.** Sequence and architecture diagrams in the source
carry real content. Analyse each and write the CONCLUSION into the right bucket as text. Do not
store the image: the base holds facts, and a picture nobody has read is not one. Record the
diagram's source document and which document carries its conclusion in
`.devflow/business/evidence/image-manifest.json`.

**5. Write one fact per call.** One `devflow_write_business` call = one independently checkable
fact. Never a survey paragraph; never a whole source document in one file.

- Anchor the wording in the material's own terms; add no unsourced extension.
- Where the material is silent, **say so in the body**. Do not complete the thought.
- `scope` states the conditions under which the claim holds.
- `watches` (for `scenario` and `reference`) names the paths the document describes. Once every
  one of them is gone, the document describes nothing that still exists.

**Every write lands `pending-review`.** There is no parameter that says otherwise. A human
promotes a claim by editing its `status:` line, which is a reviewed change. Until then, do not
present the claim to anyone as an established domain fact — especially not API contracts, DB
semantics, MQ schemas, state machines, or security policy.

**6. Cross-link.** Cite another document as `[[its-id]]`. A citation to an id that does not
exist is refused, so write the cited document first. Scenarios cite the `meta` terms and the
`principle` constraints they rest on; anything touching a neighbouring domain gets a
`reference` document holding the relationship only.

**7. Self-check.** Before reporting done, read the hygiene report — the `devflowBusiness`
service's `hygiene()`, or read `review-queue.yaml` and the base directly:

- **Coverage** — does each bucket hold something? Does every scenario reach a concrete API or
  service? Did every registered source either contribute or get explicitly excluded?
- **Conflict** — does the new knowledge contradict what is already here, or what the code
  actually does? A contradiction is a drift signal. **Record it; do not adjudicate it.** The
  code is authoritative for current behaviour, confirmed product material for intent, traceable
  records for history — and which of those a given conflict turns on is a human's call.
- **Zombies** — a document whose every declared `watches` path is gone describes nothing that
  still exists. Merge it into a current document through `replaces`, or retire it.

**8. Record the batch.** Write a `history/history-YYYYMMDD.md` document naming the sources
processed, how many facts were added, updated, and left pending, and the drift you found.

## Modes

- **First pass** — build the base, aim for coverage across all five buckets.
- **Incremental** — new material only, with a conflict check against what stands. On a stable
  domain this fires on events: a release, an incident review.
- **Periodic recalibration** — when a wave of material lands at once (a peak-season readiness
  review, an annual walkthrough), sweep the whole base. This is where cross-system, historical,
  and high-risk knowledge gets filled in.

## Anti-patterns

- **A whole document in one file** — granularity is gone, and you have rebuilt a more
  searchable document graveyard.
- **Retrieval instead of structure** — structure defines what the agent MUST understand;
  retrieval only says where material might be.
- **Completing what the material left open** — the value here is that inference is never
  disguised as fact.
- **A judgement written as a rule** — record the decision and its reason; keep the judgement.
- **Treating `pending-review` as settled** — it is the one state the tool can produce, and
  saying it means something stronger is how an unreviewed claim becomes a domain fact.
