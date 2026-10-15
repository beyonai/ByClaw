---
name: super-skill-create
description: Create, install, scaffold, import, and restore OpenClaw-first Agent Skills and MCP candidates. Use for creation and addition requests.
---

# Super Skill Create

Before any operational instruction, fully read `../../references/policy.md` and `../../references/provider-contract.md`. You must not bypass `../../scripts/manager.mjs` for writes; all writes use that manager contract.

Own install, scaffold, import, and restore. Choose one provider only: `openclaw` for runtime/ClawHub, `builtin-repo` for the checked-in tree, or `byclaw-workspace` for its named workspace. Do not mix provider paths or credentials, and allow no cross-provider fallback.

For every mutation: preview, inspect the returned target/security/warnings, then obtain an explicit scoped confirmation and pass its preview token. Never use `--force`, `--yes`, or `--risk-confirm`; stop if a risk acknowledgement is requested. Never expose tokens or secrets, edit documentation, or auto-commit.

```sh
node ../../scripts/manager.mjs create install CANDIDATE --provider openclaw
node ../../scripts/manager.mjs create install CANDIDATE --provider openclaw --confirm PREVIEW_TOKEN
node ../../scripts/manager.mjs create scaffold NAME --provider byclaw-workspace
node ../../scripts/manager.mjs create scaffold NAME --provider byclaw-workspace --confirm PREVIEW_TOKEN
```

Import and restore are owned routing commands, but each currently returns `NOT_IMPLEMENTED`; do not run either as an executable workflow or claim it completed. Use only concrete paths and a single target. Preserve the preview result; do not install a search result until it has been independently inspected.
