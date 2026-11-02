# @zhchxiao123/dsh-devflow-artifact-gate

English | [中文](README.zh.md)

Artifact-contract policy on the [`devflow/transition`](../devflow/README.md) waterfall: a configured edge requires registered artifact kinds, and the newest registration of each required kind must pass a mechanical structure check — the configured frontmatter fields present, the configured `## ` section titles found. The plugin is a read-only Consumer of the `ctx.devflow` seam; it writes nothing, decides one waterfall, publishes its kind specs for producers, and publishes a dynamic inspection contract so model-facing tools can report the exact same decision before a transition is attempted.

## Behavior

For an attempt on edge `from->to` with an `edges` entry, the gate reads the moving card and checks every required kind against the newest registration of that kind — the record with the highest journal revision, as written by `devflow_attach_artifact`'s kind + content form; path-only registrations carry no kind and never match. A kind with no registration, a registered file the disk does not serve, a missing frontmatter block or field, and a missing section are each one defect, and the veto lists **all** of them at once (`<kind>: <what>`, naming the file), so one rework round sees the whole gap instead of one item per attempt. Earlier registrations of a kind are history, not evidence: a structurally whole newest registration passes regardless of what its predecessors look like.

An edge with no `edges` entry delegates without reading the card, and a card that passes every check delegates untouched — later policies (command gates, approvals) decide as if this plugin were absent. A veto is not a commit: the card stays where it was, at its revision, with no journal entry.

The check is structural only: fields present with a value, section headings present as `## <title>` lines (trailing whitespace allowed). Whether the content under them is any good is a different layer's question.

## Config

```yaml
- id: devflow-artifact-gate
  name: '@zhchxiao123/dsh-devflow-artifact-gate'
  config:
    kinds:
      prd:
        frontmatter: [card, kind, title]
      design:
        frontmatter: [card, kind, title]
        sections: [Approach, Compatibility]
    edges:
      'draft->designing': [prd]
      'designing->ready': [prd, design]
```

| Key | Default | Meaning |
|---|---|---|
| `kinds` | `{}` | Structure spec per artifact kind: `frontmatter` fields that must be present with a value, `sections` titles (without `## `) that must appear, and `nonEmptySections` titles that must appear **and carry at least one non-blank line before the next heading**. Listing a title in `nonEmptySections` implies its presence, so it need not also appear in `sections`. All lists optional; an empty list equals omission, and a kind declared with none is required only to be registered. |
| `edges` | `{}` | Artifact kinds each `from->to` edge requires. An edge with no entry — or an empty list — is not gated. |

Misconfiguration fails the load, naming the config item: an edge key not of the form `<from>-><to>` with known location names (`blocked` is legal on either side — a recovery edge can carry a contract too), an edge requiring a kind `kinds` does not declare, a kind key outside the seam's kind grammar (lowercase letters, digits, and dashes, starting alphanumeric), or a blank entry in a `frontmatter`/`sections`/`nonEmptySections` list.

A kind no edge references is legal: it exists purely as a published spec, for deliverables that are templated but not gated.

## Cookbook

Each snippet below is a standalone `kinds:`/`edges:` pair, shaped like the [Config](#config) example — swap it in as its own `config:` block. Snippets are independent illustrations, not meant to be merged with each other or with the block above: a few reuse a kind or edge name (`prd`, `design`, `developing->reviewing`) with a different structure purely to isolate one behavior, and YAML rejects a duplicate key within one mapping.

### Frontmatter-only requirement

```yaml
kinds:
  changelog:
    frontmatter: [card, version]
edges:
  'developing->reviewing': [changelog]
```

A `changelog` registration passes once its frontmatter carries non-null `card` and `version` values; no section heading is checked.

### Sections-only requirement (heading presence, content ignored)

```yaml
kinds:
  review:
    sections: [Findings, Verdict]
edges:
  'reviewing->testing': [review]
```

A `review` registration passes once `## Findings` and `## Verdict` headings both appear — what is written under them is not checked.

### `nonEmptySections` (heading plus real content)

```yaml
kinds:
  test-report:
    nonEmptySections: [Results]
edges:
  'testing->done': [test-report]
```

A `test-report` registration must carry a `## Results` heading with at least one non-blank line before the next heading; an empty heading fails. Listing `Results` here already implies its presence, so it must not also be listed in `sections`.

### Registration-only kind (no frontmatter, no sections)

```yaml
kinds:
  screenshot: {}
edges:
  'developing->reviewing': [screenshot]
```

A kind declared with neither `frontmatter` nor `sections`/`nonEmptySections` only requires that some registration of that kind exists; any content passes.

### One edge, multiple required kinds

```yaml
kinds:
  prd:
    frontmatter: [card]
  design:
    frontmatter: [card]
edges:
  'ready->developing': [prd, design]
```

`ready->developing` unblocks only once both `prd` and `design` each have a passing newest registration — every kind listed for an edge is required, not any one of them.

### A kind no edge references

```yaml
kinds:
  postmortem:
    sections: [Summary]
edges: {}
```

`postmortem` is published to producers via `devflowArtifactStructures` but gates no transition, because no `edges` entry names it — legal for deliverables that are templated but never enforced.

### Rich-content artifacts (screenshots, large or binary payloads)

For a kind whose real payload does not fit this text-structure model, see the pointer + separate-file pattern in `docs/devflow.md` ("Rich-content artifacts: pointer plus a separate file") rather than repeating it here — its gate config is a plain `nonEmptySections` kind like the ones above; the pattern itself is about the two `attachArtifact` calls that satisfy it.

Misconfiguration fails the load with the offending config item named, not silently — a malformed edge key, an edge requiring an undeclared kind, and a blank entry in a `frontmatter`/`sections`/`nonEmptySections` list all abort startup, so a load failure means the config is wrong, not that this is unusual runtime behavior.

## The kind-spec service

The validated `kinds` — normalized (empty lists dropped) and deep frozen — are published as the optional `devflowArtifactStructures` service. A producer reads it with `ctx.get('devflowArtifactStructures')` and feeds the same field and section lists into whatever writes the deliverable, so the template and the check cannot drift apart; the service disappears with the plugin's fiber. Types (`ArtifactKindStructure`, `ArtifactStructures`) are exported for type-only import.

## The contract-inspection service

The optional `devflowArtifactContract` service exposes one read-only operation, `inspectOutgoing(card)`. It returns every configured and currently legal edge leaving the card, with each required kind classified as `missing`, `malformed`, or `satisfied`; the immutable kind spec, newest registration when present, and every defect are included. The transition listener and this inspection call the same internal requirement checker, so a preflight's defects are exactly the defects a transition veto would use.

The inspection is a point-in-time structural snapshot of the supplied card revision. It never runs semantic agent checks, writes files, or reserves a transition. The existing `stageRevision` compare-and-swap remains the authority if the card changes after inspection. The service disappears with the plugin's fiber.

## Model Experience

This package itself registers no prompt or schema. When `dsh-devflow-tool` is mounted, its single-card lifecycle results consume `devflowArtifactContract` and show the applicable outgoing edge, each requirement's status and template, all defects, and an explicit instruction not to transition while any requirement is unsatisfied. A model can therefore author and re-register the deliverable before using the rejection path.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Waterfall order is deployment load order** — this mechanical layer should be composed ahead of slower layers (command gates, approvals, any agent check), so a missing artifact vetoes before a test suite runs or a human is asked. Nothing enforces that order; the deployment's row order does.
- **Structure only, no semantics** — a present field may hold nonsense and a present section may be empty prose; judging content is a separate (agent-side) layer, not this one.
- **The contract sees only journal-registered kinds** — a deliverable written into the card directory without `attachArtifact`'s kind + content form does not exist for this gate, by design: the journal is the authority on what was delivered.
