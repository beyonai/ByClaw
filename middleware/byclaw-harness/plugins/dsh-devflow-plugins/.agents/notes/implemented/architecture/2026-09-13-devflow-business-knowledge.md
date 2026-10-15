# Agent Note: business knowledge is its own seam, confirmed by review

Status: implemented

## Problem

devflow's knowledge surfaces are all anchored to something a machine can
evaluate. A spec document ties every claim to code through `symbol`,
`content-hash`, or `churn` anchors, and refuses to be born stale. An iron rule
is an obligation with a `check.sh` behind it.

Business-domain facts are neither. What an "order" means in the trading domain
versus the payment one, why a compatibility branch exists, which API a business
scenario actually enters through — these rest on technical proposals, incident
reviews, and walkthroughs. No parser evaluates them and no script decides them.

The tempting move was to put them in the spec seam, since they are also
documents that cite code. That fails on `no-anchors`, which exists precisely to
refuse "a document that anchors nothing; it would report `fresh` forever". The
only way through would be fabricated anchors — which is to say, a
permanently-green check, the one thing the three-valued `AnchorVerdict` was
designed to prevent.

## Decision

`@zhchxiao123/dsh-devflow-business` is a **single package**, not a
Definition/Provider seam, holding `.devflow/business/<bucket>/<id>.md` across
five buckets: `meta`, `principle`, `scenario`, `practice`, `reference`.

It takes its packaging shape from `devflow-iron-rules` and deliberately inverts
that package's central mechanism:

| | iron-rules | business |
|---|---|---|
| write | `devflow_record_iron_rule` | `devflow_write_business` |
| read | none — rules are resident | none — reads are unfenced |
| pre-step | full residency, digest-compared | **nothing** |
| enforcement | `check.sh` at turn end | **nothing** |
| grading | `owner: admin \| local` | `status: confirmed \| pending-review` |
| decay | `watches` all gone → zombie | same |
| shrink | `replaces` | same |

**Why one package.** The spec seam splits Definition from Provider because
anchor evaluation has a real second implementation — its own README records
which languages `symbol` and `content-hash` reach. Business storage has one
implementation and one consumer, so a seam would mint roles nothing fills,
against `AGENTS.md`'s "Require a current owner and need".

**Why no residency.** `devflow-iron-rules`'s README states the triage this line
already uses: `reference` goes to the spec seam, `obligation` comes to iron
rules, because "an obligation the model never opened is one it never followed".
Business knowledge is a reference. It also would not fit — the rule block's
32 KB ceiling is a fraction of one domain's base — and injecting it whole
contradicts reading only what the current judgement needs.

**Why `pending-review` is not a parameter.** Recording writes it
unconditionally, restating iron-rules' argument for `owner: local`: the
stronger state draws its force from code review, and minting it from a chat
turn skips exactly that review. A `replaces` revision drops a confirmed
document back to pending, because revised knowledge does not inherit its
predecessor's confirmation. `review-queue.yaml` is a projection rebuilt on every
write; the status of record is the line in each document.

**Why the citation check is single-direction.** The spec seam checks
`[[id]]` both ways because an anchor and its citation share one document and one
write. Here the citation lives in a *different* document, so the first document
of a domain is always uncited — and distillation establishes meaning first.
A write-time orphan check would refuse the only correct authoring order.
Orphan detection sits in the hygiene report beside zombie detection: both ask
whether the base is healthy, not whether this write is legal.

`devflow-fs-guard` gains a fourth remedy arm. Without it the denial for
`.devflow/business/` would point at the card tools — a denial that technically
holds and practically misleads, which that package's README already names as
the failure to avoid.

## Alternatives considered

**Business documents in the spec seam.** Rejected above: fabricated anchors, or
rejection at `no-anchors`.

**A four-package seam mirroring `devflow-spec*`.** Rejected as roles without
occupants. Two of the four collapse immediately — the sentinel has no mechanical
staleness signal to react to, and the read tool duplicates unfenced file reads.

**A read tool.** Rejected. The guard covers `fs/write-intent` and
`fs/edit-intent` only, and `status` is a frontmatter line a plain read sees.
`devflow_read_spec` exists because staleness must be *computed* before a reader
can learn of it; nothing here computes.

**Letting the tool register sources.** Rejected. `source-manifest.yaml` is the
registry of what may be cited, and a registry that extends itself from a chat
turn is the same hole the review fence closes. The cost is real and recorded:
a distillation pass cannot start its own source list.

**Gate configuration in the same change.** Dropped from scope. The proposal
this work came from also specifies design-completeness gates, but that
configuration reads no business knowledge and this package depends on no gate.
Independent concern, no ordering between them.

## Consequences

The domain boundary is now the repository boundary. The root derives as
`<session cwd>/.devflow/business` like every other devflow root — not the
nearest git ancestor — so cards, spec documents, iron rules, and business
knowledge share one `.devflow/`. A domain spanning three repositories gets three
bases related through `reference/` documents. That was the price of the shared
fence and shared provenance, and it is paid per-repository forever.

Nothing decays loudly. There is no turn-end hook and no background scan, so a
base nobody assesses rots unreported. That is the deliberate other side of
"a reference is owed a look, not a fight" — the alternative was interrupting
turns over knowledge no anchor can falsify.

The skill registers on its own conditional child rather than sharing the spec
one, so a composition may mount either seam alone without advertising a skill
whose tool is absent.
