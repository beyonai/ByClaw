# Contributing

Thank you for contributing to Byclaw.

**AI-assisted work:** Follow [AGENTS.md](AGENTS.md). For Claude, also see [CLAUDE.md](CLAUDE.md).

## Development setup

1. Clone the repository.
2. Initialize each module you work on (see its README):
   - `byclaw-fe/`: Node.js and `pnpm` (or npm as documented there).
   - `byclaw-be/`: JDK 17+ and Maven.
   - `byclaw-exe/`: Python 3.10+ with `uv` or `pip` in a virtual environment.

## Style and commits

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) — details in [.github/commit-convention.md](.github/commit-convention.md).
- **Lint/format:** Respect each module’s ESLint/Prettier, SpotBugs, Ruff, etc.

## Pull request workflow

1. Branch from `main` (or the agreed default branch).
2. A PR should include, where applicable:
   - Code changes;
   - **Tests** (unit / integration / e2e as appropriate);
   - **Documentation** updates under `docs/` or the module’s docs.
3. At least **one** maintainer approval before merge.
4. **Green CI** (lint, tests, build as configured).

## Tests and docs

- Repo-wide areas: `tests/unit/`, `tests/integration/`; reviewed machine-generated tests may live under `tests/auto-gen/` (see that folder’s README).
- Modules may keep their own test trees (e.g. Jest under `byclaw-fe`). Explain boundaries in the PR if both apply.

## Community

Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Sponsoring

To enable the GitHub Sponsors button, copy [.github/FUNDING.yml.example](.github/FUNDING.yml.example) to `FUNDING.yml` and fill in valid entries.

## LLM helper scripts

If you add scripts under `scripts/` that call external models, **never commit API keys**; use environment variables or CI secrets.
