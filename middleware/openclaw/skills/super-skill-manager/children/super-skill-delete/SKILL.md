---
name: super-skill-delete
description: Remove and purge OpenClaw-first Agent Skills and MCP candidates. Use for deletion and uninstallation requests.
---

# Super Skill Delete

Before any operational instruction, fully read `../../references/policy.md` and `../../references/provider-contract.md`. You must not bypass `../../scripts/manager.mjs` for writes; all writes use that manager contract.

Own removal and purge. Before either, require a completed read-only dependency assessment: identify reverse dependencies and stop if removal would break another skill. A normal remove is recoverable. Purge is irreversible and needs a fresh, explicit user request after the remove preview is inspected.

Select one provider only: `openclaw` for runtime/ClawHub, `builtin-repo` for the checked-in tree, or `byclaw-workspace` for its named workspace. Keep remote ClawHub deletion outside this manager and allow no cross-provider fallback.

For every mutation: preview, inspect the returned target, reverse dependencies, recoverability, and warnings, then obtain an explicit scoped confirmation and pass its preview token. Never use `--force`, `--yes`, or `--risk-confirm`; stop if a risk acknowledgement is requested. Do not turn a remove into a purge.

Use the `openclaw` remove examples only when the runtime inventory marks that skill `trackedBy: clawhub`; the manager maps that explicit marker to the ClawHub lifecycle. Do not assume every OpenClaw skill is tracked: an untracked or non-ClawHub skill returns `CUSTOM_TRANSACTION_REQUIRED` and must stay with its transaction provider.

```sh
node ../../scripts/manager.mjs delete remove NAME --provider openclaw
node ../../scripts/manager.mjs delete remove NAME --provider openclaw --confirm PREVIEW_TOKEN
```

Purge is an owned routing command, but it currently returns `NOT_IMPLEMENTED`; do not run it as an executable workflow or claim it completed. Never expose tokens or secrets, edit documentation, or auto-commit.
