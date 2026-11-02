# @zhchxiao123/dsh-devflow-business

English | [中文](README.zh.md)

**Repository-carried business knowledge**: a workspace records one business domain's distilled facts as `.devflow/business/<bucket>/<id>.md` across five buckets — `meta`, `principle`, `scenario`, `practice`, `reference`. Documents reach disk only through `devflow_write_business`, every write lands `pending-review`, and a human promotes a claim by editing its status line. A workspace with no business directory makes the plugin inert.

This is the layer devflow's other knowledge surfaces cannot hold. [Spec documents](../devflow-spec/README.md) tie every claim to code through evaluable anchors; [iron rules](../devflow-iron-rules/README.md) are obligations a script decides. Business facts rest on technical proposals, incident reviews, and walkthroughs — no anchor evaluates them and no script decides them. They need a store whose confirmation signal is a human rather than a parser, which is exactly what the spec seam's `no-anchors` rejection refuses to pretend to be: a document anchoring nothing would report `fresh` forever.

## Contract

Four mechanisms, and the package is not itself without any of them:

1. **One write path.** `devflow_write_business({ id, bucket, title, body, sources, scope, watches?, replaces? })` is the only way a document reaches disk. That is enforced rather than intended: the business root sits under `.devflow/`, which [`dsh-devflow-fs-guard`](../devflow-fs-guard/README.md) denies the file tools, naming this tool in the denial. Every rejection settles **before the first byte**, so a refused write leaves the base byte-for-byte as it was.

2. **The review fence.** Writing produces `status: pending-review`, and the tool schema has no parameter that could produce anything else. `confirmed` draws its force from code review, and minting it from a chat turn would skip exactly the review that gives it that force — the same posture iron rules take toward `owner: admin`. A revision through `replaces` drops a confirmed document back to pending: revised knowledge does not inherit its predecessor's confirmation. `review-queue.yaml` is a projection rebuilt on every write; editing it promotes nothing.

3. **Registered sources only.** Every claim names `sources` that exist in `source-manifest.yaml`, and a write citing anything else is refused. The manifest itself sits inside the fence and no tool writes it, so extending the set of citable material is a reviewed edit. Unregistered material is not a source.

4. **Shrinkability and decay.** `replaces` deletes the named documents after the replacement is written: one id revises in place, several merge a cluster — the only way the base shrinks. In the other direction, a `scenario` or `reference` document whose declared `watches` paths have **all** disappeared is reported as a zombie; a partial miss only counts as ordinary directory reorganization, because reporting that as rot would train everyone to ignore the signal.

### Rejections

`write` refuses with a stable code rather than accepting a document nothing can check later:

| Code | Cause |
|---|---|
| `invalid-id` | the id fails `^[a-z0-9][a-z0-9-]*$`; rejection happens at the id, before any path is built |
| `invalid-title` | an empty title; a titleless document loads as a warning and is skipped, so writing one creates a file nothing will read |
| `unknown-bucket` | a bucket outside the closed five |
| `no-sources` | a claim with no source is one nothing can check later |
| `unregistered-source` | a source `source-manifest.yaml` does not register |
| `dangling-reference` | the body cites `[[id]]` for a document that does not exist |
| `exists` | the id is taken and not listed in `replaces`, or `replaces` names an id nothing holds |

**The citation check is single-direction, deliberately.** The spec seam checks its `[[id]]` relation both ways because an anchor and its citation live in the same document and the same write. Here a citation lives in a *different* document, so the first document of a domain is always uncited — and distillation establishes meaning first. Refusing an uncited document at write time would refuse the only correct authoring order. Orphan detection therefore belongs to the hygiene report, beside zombie detection: both ask whether the base is healthy, not whether this write is legal.

### Reads are deliberately not fenced

The guard covers `fs/write-intent` and `fs/edit-intent` only, so `read`, `glob`, and `grep` reach `.devflow/business/` untouched — and a document's `status` is a frontmatter line a plain read already sees. This package therefore ships **no read tool**: the one the spec seam needs exists because staleness must be evaluated before a reader can learn of it, and no equivalent evaluation exists here.

## The `devflowBusiness` service

`ctx.get('devflowBusiness')` exposes `read(agent, id)`, `list(agent, bucket?)`, and `hygiene(agent)` — the parsed shape for consumers that want it rather than the bytes. It is **optional**; a deployment without this plugin has no business knowledge at all, and must say so rather than inventing some.

`hygiene` reports orphans, zombies, and the pending set. Nothing here interrupts a turn: a stale iron rule is an obligation and blocks, while business knowledge is a **reference**, and its reader owes it a look rather than a fight. The report is pulled, never pushed into a model step.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `root` | `.devflow/business` | Business root for callers whose session derives no root of its own; a relative path resolves against the process cwd. |

The root of an agent with a session working directory is always `<cwd>/.devflow/business`, the same derivation every other devflow root uses — **not** the nearest git ancestor, so cards, spec documents, iron rules, and business knowledge always share one `.devflow/`. One consequence is worth stating: a business domain spanning several repositories gets one base per repository, related through `reference/` documents rather than shared.

## Model Experience

### Tool schema

#### What the model sees

One tool. Its description carries the distillation discipline the schema cannot enforce — one document is one independently checkable fact; a judgement call (two defensible options, and someone picked one) is recorded as a `practice` decision rather than written as a rule, because encoding judgement as a rule manufactures confident, plausible, wrong knowledge. The review fence is stated there too, since the model cannot lift it and should not describe a pending claim as an established fact.

The [`devflow-business-distill`](../devflow-guidance/assets/devflow-business-distill.md) skill in [`dsh-devflow-guidance`](../devflow-guidance/README.md) carries the cross-call procedure and registers only while this seam is composed.

#### Token effect

A fixed schema cost while the plugin is active. Nothing is resident: no rule block, no pre-step index, no runtime context. Documents cost tokens only when a reader opens one.

#### KV Cache effect

None; this package neither assembles nor sends a provider request, and publishes no runtime context that could invalidate a prefix.

## Known Limitations and Deferred Work

- **No read tool.** Reads are unfenced and `status` is visible in the frontmatter, so one would duplicate the file tools. If a consumer ever needs freshness computed rather than read, that is the demonstrated need to revisit.
- **No pre-step index or residency.** Business knowledge is a reference, and a domain's base does not fit an injected block. A model that never opens the base gets no prompting from this package — the skill's description is the whole routing surface.
- **Registering a source needs a human.** The manifest is inside the fence and no tool writes it, so a distillation pass cannot start its own source list. That is the same argument as the review fence, and the same friction.
- **No `/devflow business` census.** `review-queue.yaml` and the hygiene report are readable directly; a command surface is deferred until someone reports not finding them.
- **Orphan and zombie detection is pull-only.** There is no turn-end hook and no background scan, so a base nobody assesses decays unreported. Deliberate: the alternative is interrupting turns over a reference.
