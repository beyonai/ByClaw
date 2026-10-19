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
| `byclaw-qa/` | Cross-cutting QA, e2e, performance |
| `middleware/builtin/` | Shared skills, scripts, Python CLIs, runtime tools, and skill registry for OpenClaw and Harness |
| `middleware/openclaw/` | OpenClaw image definitions and runtime-specific integration |
| `middleware/byclaw-harness/` | Harness image definitions, plugins, and runtime-specific integration |
| `docs/` | Top-level docs: `architecture/`, `api/`, `quick-start/` |
| `examples/` | Standalone examples, decoupled from production config |
| `tests/` | Repo-wide test layout: `unit/`, `integration/`, `auto-gen/` (reviewed only) |
| `scripts/` | Repo automation; optional LLM-assisted checks (secrets via env/CI only) |
| `.github/` | CI, templates, Dependabot |

Human-oriented workflow and governance: [CONTRIBUTING.md](CONTRIBUTING.md).
Claude-specific notes: [CLAUDE.md](CLAUDE.md).

## OpenClaw and Harness shared resources

- **Maintain shared resources only in [`middleware/builtin/`](middleware/builtin/).** This is the canonical location for `skills/`, `python-clis/`, `runtime-tools/`, `cli/`, and `skills-registry.json`, used by both OpenClaw and Harness. The shared baseline comes from Harness; preserve OpenClaw-only skills and scripts when synchronizing upstream changes.
- `middleware/byclaw-harness/builtin` and the corresponding legacy resource paths under `middleware/openclaw/` are compatibility symlinks. Preserve these links; do not replace them with copied directories or maintain separate resource versions. Keep runtime-specific plugins, startup scripts, and image configuration in their respective modules.
- Resolve shared script resources relative to the script file (`import.meta.url` or `__file__`), not the caller's working directory. Do not hardcode resource locations such as `/app/skills`, `/opt/byclaw/builtin`, or developer-machine paths. Use runtime environment configuration for data, credentials, sessions, and workspace directories; retain existing access boundaries when changing path handling.
- Build the business images from the **ByClaw repository root**. Dockerfiles must COPY shared resources directly from `middleware/builtin/`, rather than relying on compatibility symlinks. Check both Harness Dockerfiles (`Dockerfile` and `Dockerfile.extensions`), all affected OpenClaw variants, Docker ignore rules, and CI path filters when moving shared resources. Preserve each image's container destinations, ownership, installation steps, and startup behavior unless the task explicitly changes them.
- Changes to shared resources affect both runtimes. Check that neither runtime loses required skills or scripts, and run the relevant resource tests plus the following checks from the repository root:

  ```bash
  python3 -m unittest discover -s middleware/tests -p 'test_shared_builtin.py'
  node --test middleware/tests/shared-builtin-portability.test.mjs
  ```

  For Harness Dockerfile changes, also run `bash middleware/byclaw-harness/scripts/docker-browser-layout-verify.sh --dockerfile Dockerfile` and the same command with `--dockerfile Dockerfile.extensions`. Static checks do not establish that an image builds or starts; report any unverified container build or runtime behavior.

See [shared resource conventions](middleware/builtin/README.md) and [Harness build instructions](middleware/byclaw-harness/INTEGRATION.md).

## Frontend lint conventions

When writing or modifying code under `byclaw-fe/`, follow the checked-in lint and formatting configuration. The configuration files are the source of truth if this summary becomes stale:

- **JavaScript/TypeScript:** Follow [`byclaw-fe/.eslintrc.js`](byclaw-fe/.eslintrc.js), which extends `@umijs/max/eslint`. Use semicolons and 2-space indentation, including JSX; indent `switch` cases by one additional level; and satisfy the configured comment-spacing rules. React does not need to be imported solely for JSX. `fetchPriority` is an allowed React property, and the function-spacing rules disabled for TypeScript generic arrow functions must remain disabled unless the underlying incompatibility is resolved.
- **Formatting:** Follow [`byclaw-fe/.prettierrc.js`](byclaw-fe/.prettierrc.js): 2-space indentation without tabs, semicolons, single quotes except in JSX, trailing commas where valid in ES5, bracket spacing, always-parenthesized arrow parameters, a 120-column print width, and LF line endings.
- **Less/CSS Modules:** Follow [`byclaw-fe/.stylelintrc.js`](byclaw-fe/.stylelintrc.js). Less is parsed with `postcss-less`; unknown pseudo-classes are rejected except for the CSS Modules `:global` and `:local` pseudo-classes. The Umi Max Stylelint preset is currently not enabled.
- **Verification:** Run `cd byclaw-fe && pnpm run lint:js && pnpm run lint:style:check && pnpm run lint:prettier` for a non-mutating lint check. The aggregate `pnpm run lint` command invokes `lint:style`, which includes `--fix` and may modify Less files; use it only when automatic style fixes are acceptable, then review the resulting diff.

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

## Deployment model configuration

- Guide users to configure real LLM and Embedding endpoints, tokens, and model codes in model management; initialized values are placeholders. Setting `OPENAI_API_KEY` in `.env` does not configure the default models.
- Debug both models, enable them, and set each as its type's default. Verify the Embedding dimensions match the model.
- QA requires a usable Embedding model for knowledge ingestion and retrieval. Container startup or health checks alone do not establish readiness; report any unverified model calls.

## Database migration and release governance

Treat any schema or data change as a database migration. This includes DDL and DML
written under `deploy/migrations/versions/`, as well as changes to the initialization
SQL files under `deploy/middleware/initdb/`.

- If the user's request does not explicitly name the migration version, stop and ask
  which exact version to use before creating or editing any DDL/DML migration. Do not
  infer a version from the highest existing directory, automatically increment a
  version, or choose a monthly/release version on the user's behalf. The fact that
  `deploy/migrations/versions/` appears to be sequential is not permission to advance it.
- If a version is provided, use that exact version and follow the existing migration
  naming/layout conventions. Do not create an additional version merely because the
  requested version already has other work unless the user explicitly directs that.
- For ordinary migration development, `deploy/migrations/versions/` is the only
  writable migration location. An explicitly approved version authorizes changes only
  in that exact `versions/<version>/` directory; it does not authorize changes under
  `deploy/middleware/initdb/`.
- Keep DDL and DML strictly separated. Schema statements such as `CREATE`, `ALTER`,
  `DROP`, `TRUNCATE`, `COMMENT ON`, `GRANT`, and `REVOKE` belong only in
  `__ddl.sql`; data statements such as `INSERT`, `UPDATE`, `DELETE`, and `MERGE`
  belong only in `__dml.sql`. Never mix the two categories, even when their execution
  order is related. Run `python3 deploy/migrations/merge_migrations.py --dry-run`
  after editing a migration and fix every placement error before considering it ready.
- Do not run `deploy/migrations/merge_migrations.py`, manually merge migration files,
  or otherwise modify `deploy/middleware/initdb/` as part of ordinary development work
  unless the user explicitly authorizes that release operation. The repository's
  release process assigns this to the version administrator: immediately before
  creating a release tag, the version administrator runs
  `deploy/migrations/merge_migrations.py` to merge versioned migrations into
  `deploy/middleware/initdb/`.
- Never manually copy, append, rewrite, synchronize, repair, or deduplicate SQL under
  `deploy/middleware/initdb/`, including `01_init.sql`, `02_ddl.sql`, `03_grant.sql`,
  and `04_dml.sql`. Do not manually add or edit version marker blocks there, and do
  not edit `deploy/migrations/.applied`. During an explicitly authorized release
  operation, these generated artifacts may be changed only by
  `deploy/migrations/merge_migrations.py`; review the generated diff and confirm each
  pending version was appended exactly once.
- Keep development changes in the appropriate version directory. Never treat a
  migration merge as a routine cleanup or as an implicit final step.

## Hard rules

1. **Never commit secrets** (API keys, tokens, private URLs, production connection strings). Use `.env.example` for variable names only.
2. **No new cross-module source coupling.** Prefer APIs, shared `packages/`, or versioned artifacts—not direct imports across product boundaries unless already established.
3. **Behavior changes require tests and documentation updates** (`docs/` or the relevant module docs) where applicable.
4. **Do not recreate a `.ai/` directory.** Agent rules live here and in [CLAUDE.md](CLAUDE.md).
5. **Confirm before committing documentation.** Before staging or committing any file under `docs/`, obtain the user's explicit approval for that documentation change.
6. **Design documents are uncommitted by default.** Write requested design documents to the agreed project location, but do not stage or commit them and do not ask whether to commit them unless the user explicitly requests a commit.
7. **Do not use `SELECT ... FOR UPDATE`.** SELECT queries must not include a `FOR UPDATE` clause, whether written directly in SQL or generated through an ORM or query builder.

## Pull requests

Align with [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md): tests, docs, lint, no secrets.
Commits: [Conventional Commits](https://www.conventionalcommits.org/) as described in [.github/commit-convention.md](.github/commit-convention.md).

@RTK.md
