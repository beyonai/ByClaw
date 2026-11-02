---
name: super-skill-update
description: Upgrade, edit, repair, enable, disable, and pin OpenClaw-first Agent Skills and MCP candidates. Use for lifecycle changes that retain the target.
---

# Super Skill Update

Before any operational instruction, fully read `../../references/policy.md` and `../../references/provider-contract.md`. You must not bypass `../../scripts/manager.mjs` for writes; all writes use that manager contract.

Own upstream upgrade, local edit, repair, enabled state, and version pinning while retaining the target. Select one provider only: `openclaw` for runtime/ClawHub, `builtin-repo` for the checked-in tree, or `byclaw-workspace` for its named workspace. Do not edit provider files or endpoints directly, and allow no cross-provider fallback.

For every mutation: preview, inspect the returned target, drift, pin, and warnings, then obtain an explicit scoped confirmation and pass its preview token. Never use `--force`, `--yes`, or `--risk-confirm`; stop if a risk acknowledgement is requested. An upgrade blocked by local drift or a pin remains blocked until separately resolved.

Use the `openclaw` upgrade examples only when the runtime inventory marks that skill `trackedBy: clawhub`; the manager maps that explicit marker to the ClawHub lifecycle. Do not assume every OpenClaw skill is tracked: an untracked or non-ClawHub skill returns `CUSTOM_TRANSACTION_REQUIRED` and must stay with its transaction provider.

```sh
node ../../scripts/manager.mjs update upgrade NAME --provider openclaw
node ../../scripts/manager.mjs update upgrade NAME --provider openclaw --confirm PREVIEW_TOKEN
node ../../scripts/manager.mjs update repair NAME --provider openclaw
node ../../scripts/manager.mjs update repair NAME --provider openclaw --confirm PREVIEW_TOKEN
node ../../scripts/manager.mjs update enable NAME --provider openclaw
node ../../scripts/manager.mjs update enable NAME --provider openclaw --confirm PREVIEW_TOKEN
node ../../scripts/manager.mjs update disable NAME --provider openclaw
node ../../scripts/manager.mjs update disable NAME --provider openclaw --confirm PREVIEW_TOKEN
node ../../scripts/manager.mjs update pin NAME --provider openclaw
node ../../scripts/manager.mjs update pin NAME --provider openclaw --confirm PREVIEW_TOKEN
node ../../scripts/manager.mjs update unpin NAME --provider openclaw
node ../../scripts/manager.mjs update unpin NAME --provider openclaw --confirm PREVIEW_TOKEN
```

Local edit is an owned routing command, but it currently returns `NOT_IMPLEMENTED`; do not run it as an executable workflow or claim it completed. Never expose tokens or secrets, edit documentation, or auto-commit.
