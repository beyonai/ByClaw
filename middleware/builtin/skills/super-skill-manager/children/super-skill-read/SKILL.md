---
name: super-skill-read
description: Search, list, inspect, audit, and verify OpenClaw-first Agent Skills and MCP candidates without mutation. Use for discovery and read-only assessment requests.
---

# Super Skill Read

Before any operational instruction, fully read `../../references/policy.md`. You must not bypass `../../scripts/manager.mjs` for writes; this read-only skill must not perform writes or install.

This is read-only: never mutate, install, or create. It owns cross-market discovery, inventory list, info (`show`), audit/verify (`audit`), and diagnostics (`doctor`).

Source priority follows `../../references/source-strategy.md`: use byCLI-first cross-market discovery, search enabled markets concurrently, allow 8 seconds per source and 20 seconds total, and return partial results with coverage. Treat GitHub-only results as an unverified fallback. For routed sites, follow capability discovery, dedicated adapter, search-engine site query, web/browser, then a manual link. Do not bypass byCLI with direct HTTP or another browser. On authentication, CAPTCHA, browser-lifecycle, parse, or source errors, STOP, return the structured error/coverage, and give the manual link when supplied.

Search uses the public metadata cache by default. Use `--refresh` to refresh a result or `--no-cache` for a one-off uncached read; neither changes a skill.

```sh
node ../../scripts/manager.mjs read search QUERY --type all --limit 10
node ../../scripts/manager.mjs read list --provider openclaw
node ../../scripts/manager.mjs read show NAME --provider builtin-repo
node ../../scripts/manager.mjs read audit NAME --provider byclaw-workspace
node ../../scripts/manager.mjs read doctor
```

Select one provider (`openclaw`, `builtin-repo`, or `byclaw-workspace`) only for inventory operations. Never use `--force`, `--yes`, or `--risk-confirm`; no confirmation or mutation belongs here. Never expose tokens or secrets, edit documentation, or auto-commit.
