# AGENTS.md

**Agent harness** for AI-assisted coding tools (Cursor, Copilot, Claude Code, Codex, etc.).

This is the canonical contract for automated agents working in this repository:
- repository layout & boundaries
- verification commands
- non-negotiable rules (secrets, coupling, tests, docs)

## Principles

1. **Minimal scope:** Change only what the task requires. No drive-by refactors or unrelated files.
2. **Match the codebase:** Follow existing naming, layout, imports, and tooling in the module you touch.
3. **Verify locally:** Run the commands below for the modules you change before proposing a merge.

## Repository map

| Path | Purpose |
|------|---------|
| `byclaw-fe/` | Web frontend (React / Umi Max, `pnpm`) |
| `byclaw-be/` | Java backend (Maven) |
| `byclaw-exe/` | Python CLIs and tooling (`pyproject.toml` when initialized) |
| `byclaw-data/` | Data assets, schemas, pipeline notes |
| `byclaw-qa/` | Cross-cutting QA, e2e, performance |
| `docs/` | Top-level docs: `architecture/`, `api/`, `quick-start/` |
| `examples/` | Standalone examples, decoupled from production config |
| `tests/` | Repo-wide test layout: `unit/`, `integration/`, `auto-gen/` (reviewed only) |
| `scripts/` | Repo automation; optional LLM-assisted checks (secrets via env/CI only) |
| `.github/` | CI, templates, Dependabot |

Human-oriented workflow and governance: [CONTRIBUTING.md](CONTRIBUTING.md).
Claude-specific notes: [CLAUDE.md](CLAUDE.md).

## Verification commands

**Frontend** (from repository root):
```bash
cd byclaw-fe && pnpm install --frozen-lockfile && pnpm run lint && pnpm run test && pnpm run build
```

**Backend**:
```bash
mvn -B -f byclaw-be/pom.xml verify
```

**Python** (when `byclaw-exe/pyproject.toml` exists):
```bash
cd byclaw-exe && pip install -e ".[dev]" && ruff check . && pytest
```

## Hard rules

1. **Never commit secrets** (API keys, tokens, private URLs, production connection strings). Use `.env.example` for variable names only.
2. **No new cross-module source coupling.** Prefer APIs, shared `packages/`, or versioned artifacts—not direct imports across product boundaries unless already established.
3. **Behavior changes require tests and documentation updates** (`docs/` or the relevant module docs) where applicable.
4. **Do not recreate a `.ai/` directory.** Agent rules live here and in [CLAUDE.md](CLAUDE.md).

## Pull requests

Align with [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md): tests, docs, lint, no secrets.
Commits: [Conventional Commits](https://www.conventionalcommits.org/) as described in [.github/commit-convention.md](.github/commit-convention.md).