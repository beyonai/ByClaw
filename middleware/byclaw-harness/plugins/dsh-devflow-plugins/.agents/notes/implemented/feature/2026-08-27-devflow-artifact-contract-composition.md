# Agent Note: devflow — the artifact contract as a deployable composition

Status: implemented

English | [中文](2026-08-27-devflow-artifact-contract-composition.zh.md)

## Problem

The artifact contract shipped in four slices — [kinds and store-written content on the seam](2026-08-27-devflow-artifact-kinds-and-store-written-content.md), the [mechanical gate](2026-08-27-devflow-artifact-gate-mechanical-contract.md), the [LLM admission gate](2026-08-27-devflow-agent-gate-llm-admission.md), and [driver feeding](2026-08-27-devflow-driver-artifact-feeding.md) — each proven inside its own package suite. Nothing proved they compose. No test mounted all four transition policies on one waterfall; the order they must mount in — which **is** the decision order, and which the mechanical gate's README could only call a Known Limitation — was written down nowhere a deployment would copy from; the bundle did not even carry the two new gate packages; and a deployer had no runnable configuration showing what a full contract looks like.

## Decision

**One repository-level real-composition test owns the whole story.** `tests/artifact-contract-composition.spec.ts` boots a `cordis.yml` through the actual Loader — store, the four policies in waterfall order, real bash for gate commands, the scripted checker provider — and drives one card draft→done. Every layer decides at least once, every decision is asserted at the journal or file level (a veto commits nothing; an admission's `gate.checks` lands in the committed entry; the veto report and the store-written deliverables are read back from disk), and the order itself is observable: a mechanical defect dispatches zero checkers and runs zero gate commands, and an agent veto runs zero gate commands. The rework loop runs in full — agent veto with the report on disk, an identical retry served from the verdict cache without a second dispatch, a fixed revision missing the cache and admitting — and the completion layer both vetoes (unfinished child) and releases (child driven to done through the same contract). The test lives at repository level because it proves a deployment shape spanning five packages, not any one package's behavior; the composition-wide invariant suite already lives there.

**The deployment sample is documentation, not folklore.** `docs/devflow.md` / `.zh.md` gain "The artifact contract": a copyable configuration in which all six pipeline edges carry a contract, the waterfall-order rationale (mechanical → agent → command → approval; completion last on the one edge it owns — the cheap, deterministic layers veto before model budget, wall-clock, or a human's attention is spent), and the single-point rule — `kinds` in the mechanical gate is the only definition of a kind's structure, published as `devflowArtifactStructures`, which the hand-maintained Cordis API block now records; every other row names kinds without restating shapes. The bundle mounts both gate packages as disabled rows (an empty spec set gates nothing; an agent gate spends model budget on every checked move) and orders its four policy rows to match the documented waterfall.

**The last permission-bit fault simulations are gone.** The three remaining `chmod(0o444)` journal-write-failure tests (filesystem, gates, driver) now inject an `appendFile` fault at the journal path through `tests/fs-fault.ts`, assertions unchanged — the injector gained the `appendFile` operation for it. Permission bits are inert for root and unreliable on Windows; the repo rule ([ci-blocking-gates](../process/2026-08-27-ci-blocking-gates.md)) already banned them for read faults, and this closes the write-fault remainder.

## Alternatives considered

**Enforce the waterfall order in code instead of by mount order.** A priority field on listeners does not exist on the published harness surface, and a single aggregating gate plugin would trade four independently mountable policies for one monolith. Mount order deciding listener order is the framework's own convention; the line documents it, ships it in the bundle, and pins it with a composition test that fails loudly if the Loader ever stops preserving it.

**Home the end-to-end test in one of the gate packages.** It asserts cross-package behavior — which package would own "an agent veto runs no gate command"? Any single home understates ownership and drags the other packages plus the runtime stack into that package's devDependencies. The cost of the repository-level home is five harness packages added to the root devDependencies.

**Mount the new gate rows enabled in the bundle.** An artifact gate with no specs is a row that gates nothing, and an agent gate spends model budget on every checked move — an enabled row would have the bundle paying for checks nobody asked for. Disabled rows keep the one-command install true while holding their place in the waterfall order for the deployment that turns them on.

**Leave the bundle's parent-gate row where it was (ahead of gates).** The rows' relative order is only observable on a `-> done` edge that also carries commands or approvals, but the documented order puts completion last, and a mount list that contradicts its own documentation is how load-order folklore starts. The move is behavior-neutral for every existing profile because both rows decide disjoint edge sets by default.

## Consequences

- The waterfall order is now pinned three ways — docs, bundle, test — so a cordis or Loader change that reorders activation surfaces as this suite failing, not as deployments' gates silently swapping.
- The root package gains five pinned `@deepseek-ai/*` devDependencies (`dsh-agent`, `dsh-agent-default-model`, `dsh-subagent`, `dsh-subprocess-local`, `dsh-bash-local`) solely for the composition test; they ride the same lockstep harness-version bumps as every package's own.
- The deployment sample is hand-maintained prose over the config schemas of five packages; a schema change costs a docs pass, which the "treat the source as the authority" rule in the Cordis API block already prices in.
- `tests/fs-fault.ts` now serves four operations; a spec needing a new faultable operation extends the union rather than reaching for `chmod`.
