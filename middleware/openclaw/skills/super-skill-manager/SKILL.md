---
name: super-skill-manager
description: Route OpenClaw-first Agent Skill and MCP lifecycle requests to exactly four operation-family skills. Use when users ask to discover, install, create, inspect, update, repair, remove, restore, or manage candidates.
---

# Super Skill Manager

Read `references/policy.md` before operational guidance. Route each request to exactly one child:

- `super-skill-create`: install, scaffold, import, or restore.
- `super-skill-read`: search, list, show, audit, or diagnose without mutation.
- `super-skill-update`: upgrade, edit, repair, enable, disable, pin, or unpin.
- `super-skill-delete`: remove or purge.

Select one provider and keep its boundary: `openclaw` owns runtime/ClawHub operations, `builtin-repo` owns the checked-in skill tree, and `byclaw-workspace` owns its named workspace endpoint. Do not combine their paths, authentication, or deletion semantics.

For every mutation, require preview, inspect its target and warnings, then obtain an explicit scoped confirmation. Never put tokens or secrets in commands, files, cache, logs, or output. Do not edit documentation or auto-commit.
