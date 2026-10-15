# AgentTeams Fix Commit Plan

**Goal:** Commit the six modified files in three focused commits and push to `origin/2026.9.8`.

## Commits

1. `fix: skip invalid agent workspace skills`
   - Skill runtime configuration, error reporting, and existing regression tests.
   - Include this plan.
2. `fix: pass resource metadata to team skill bindings`
   - AgentTeams binding arguments and verification script.
   - Real Skill runtime regression tests for member creation and resume.
3. `fix: align protobufjs build policy`
   - Sidebar workspace policy and Docker preparation test.

## Validation

- [x] All 21 Skill integration tests pass.
- [x] AgentTeams typecheck, build, and full verification pass.
- [x] Docker workspace preparation test passes.
- [ ] Inspect each staged diff and commit.
- [ ] Push to `origin/2026.9.8` and verify the remote SHA.

**Limitation:** Full ByClaw integration build is blocked by the missing local `@deepseek-ai/dsh-shell-env` dependency.

**Scope:** Leave pre-existing untracked files untouched. No deployment or force push.
