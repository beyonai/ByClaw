# Agent Note: spec discovery is a multi-ecosystem detector chain

Status: implemented

## Problem

The workspace resolver behind `devflowSpecWorkspace` read `pnpm-workspace.yaml`
and nothing else; any other repository degraded to a single package named by
the root `package.json`. On the excalidraw sample — a yarn-workspaces monorepo
of ten packages with no `pnpm-workspace.yaml` — that fold produced one scope,
and the `/devflow spec` census reported `1/1` full coverage: a silent cap
presenting the absence of discovery as the absence of gaps. Every non-JS
ecosystem (Go, Rust, Python, JVM, …) sat behind the same fold, and the census
wording (`discovered from workspace layout`) gave a reader no way to tell a
real discovery from the fallback.

## Decision

**Discovery is a chain of twelve ecosystem detectors whose non-null answers
are unioned**, deduplicated by `(dir, scopeId)` — `packages/devflow-spec-sentinel/src/ecosystem-detectors.ts`,
one detector per package-manager convention (pnpm, npm/yarn/bun, Cargo, Go,
uv, Maven, Gradle settings, pyproject, Composer, Ruby, .NET, Mix). The
contracts that carry the design:

- **Only text manifests, never code.** Gradle settings, `.sln`, and `pom.xml`
  are read by line grammar; `mix.exs` and gemspecs are never read at all
  (existence and directory names only). Each detector's doc states its
  supported surface; anything outside it is warned about and skipped, never
  guessed at — the no-silent-caps rule applied to parsing.
- **`null` is not empty.** `null` means the governing manifest is absent; an
  empty array means it exists but no member could be read. The root
  `package.json` fallback runs only when every detector returned `null`,
  because papering an answered-but-empty workspace manifest over with a
  single-package answer would rebuild the silent cap.
- **Root-driven, never a crawl.** The member set is exactly what the root
  manifests declare; a stray nested project nothing points at (vaultwarden's
  `playwright/` package in the sample set) is deliberately not discovered — a
  crawl would misreport coverage in the opposite direction.
- **Union, not first hit.** A mixed repository contributes every ecosystem's
  face (the fastapi-template sample: uv workspace beside bun workspaces);
  the `(dir, scopeId)` dedupe absorbs the dual-build same-name case (the
  petclinic sample: Maven and Gradle both naming `spring-petclinic`).
- **Names degrade, they are never escaped.** A manifest name outside the
  seam's scope-id syntax falls back to the member's directory name, and a
  member whose directory name is also illegal is skipped — both warned. The
  seven sample repositories' 26 real names are all legal and are pinned in
  tests as must-not-degrade counterexamples.
- **The service grew a face instead of changing one.** `layout()` is
  untouched; `discover()` returns the packages plus the detector names and is
  optional on the type, so a consumer compiled against this version
  feature-tests with `?.` against an older provider. The census origin
  wording now names the answering detectors (`discovered via …`), says
  `fell back to the repository root — no workspace manifest recognized` when
  none answered, and footnotes scopes whose documents rest on churn anchors
  alone (`churn-only; freshness lags commits`) — the honest presentation of
  the [anchor model's](../architecture/2026-09-02-devflow-spec-anchor-model.md)
  TS-only evaluation, restated for authors in the bootstrap skill's
  languages-without-a-parser section. That debt was unchanged here and has
  since shrunk: [multi-language anchor
  evaluation](2026-09-13-spec-anchor-multilang.md) gives Python and Go real
  evaluators and [its second phase](2026-09-14-spec-anchor-rust-java.md) adds
  Rust and Java, so the data-driven footnote recedes with them.

**Rejected:** real parsers for XML/Gradle/sln (heavyweight dependencies for
two element names each; the line grammars state their surface instead — the
one new dependency is `smol-toml`, pure JS, for Cargo/uv/pyproject);
build-orchestrator project graphs (Nx/Turborepo/Bazel sit above the package
managers whose manifests already name the members); treating the root
`package.json` name as a thirteenth detector (kept as the all-null fallback so
the detectors list stays an honest "who answered").

## Verification

Per-detector fixture suites including out-of-surface warn-and-skip cases;
union/dedupe/normalization units; census wording three-state plus churn-only
tests; `scripts/survey-workspace-discovery.ts` (kept as the manual regression
tool) run against the seven sample repositories with 26/26 expected scopes
matched, and the excalidraw census re-run showing the false green light
replaced by the ten-package gap list — evidence preserved in the task's
research directory (`09-13-spec-discovery-multi-ecosystem`). The prior
resolver behavior this supersedes is recorded in the
[sentinel note](../architecture/2026-09-11-devflow-spec-lifecycle-sentinel.md).
