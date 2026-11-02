# Agent Skill Runtime Implementation Plan

> Execute in this session using the approved plugin-only design and test-driven development.

**Goal:** Every agent receives repository builtin Skill metadata; each ByClaw employee additionally sees only its current authorized associated Skills, including watch updates in live sessions.

**Architecture:** ByClaw Integration owns immutable Skill generations and decorates the existing registry's `list`, `snapshot`, and `get` methods. Employee bindings select exact template resources; ordinary agents retain their normal catalog plus builtins. Existing DSH catalog and loader remain the consumers. Preparation reads the staged generation; successful filesystem publication commits the in-memory generation synchronously under the existing generation lease.

**Tech Stack:** TypeScript, Cordis effects, YAML frontmatter, existing Redis watcher, source-mode Vitest against the supplied DSH checkout.

**Spec:** User-approved design in this task: plugin-only registry adapter and live watch synchronization, supplemented with builtin/skills as the baseline for every agent.

## Constraints

- Do not edit DSH source or the user's unrelated working changes.
- Builtins resolve from `builtinSkillDir`, then `BYCLAW_SKILLS_DIR`, then the repository builtin directory; Docker already sets the environment variable.
- Employee catalog = builtins plus its latest template associations. Associated resources win same-name collisions; no unrelated global or preset fallback.
- An explicitly empty `relSkills` clears associations. Builtins remain.
- Update visibility after successful publication and before the next registry query; already dispatched model requests are unchanged.
- Metadata remains in DSH's durable catalog. A durable revision notice requests reload when resource bodies change, including after cold resume; historical messages are retained.
- Root employees, delegated templates and AgentTeams employees bind to template identity, never to a frozen member Skill list.

## Task 1: Resource views and builtin metadata

Files: new `plugins/byclaw-integration/src/skill-runtime.ts`, test helpers/config and `tests/skill-runtime.spec.ts`, package dependencies.

- [x] Add failing tests for builtin discovery (including multiline YAML), exact employee views, ordinary agents, same-name collisions, empty associations, loader/slash restrictions and adapter disposal.
- [x] Implement `ByClawSkillRuntime`, `bind(agentCtx, templateId)`, `entries(templateId)`, and `prepareGeneration(templates, stagedRoot, liveRoot)` returning a synchronous publication function.
- [x] Keep metadata and bodies separate in registry results; supply correct final resource paths.
- [x] Run source-mode tests and plugin typecheck.

## Task 2: Publish watch generations and bind all employee paths

Files: `integration.ts`, `index.ts`, `template-runtime.ts`, `resources.ts`; AgentTeams `members.ts` optional runtime binding; focused tests.

- [x] Add failing tests for explicit-empty parsing, staging rollback, live body/description updates, revocation and watcher delivery to an existing agent.
- [x] Prepare the runtime snapshot inside staged projection, publish it only after directory publication succeeds.
- [x] Install the runtime before initial synchronization and restore last-good local templates on startup.
- [x] Bind direct/root and delegated template agents, including empty templates; bind AgentTeams members by employee ID when integration is present, preserve standalone AgentTeams behavior.
- [x] Inject a durable revision notice for changed effective resources, including body-only changes.
- [x] Run focused runtime, parser, projection, watch and composition tests.

## Task 3: Documentation and final review

Files: integration README.md / README.zh.md, AgentTeams README sections if applicable, plan status.

- [x] Document builtin directory resolution, collision priority, hot-update timing, revision notices, failure retention and historical-context limitation.
- [x] Run integration build/verification and the affected AgentTeams checks. Record any pre-existing environment blockers separately.
- [x] Review diff, verify no DSH source changed and retain unrelated user changes.
