# scripts

Repository-level automation: bootstrapping, codegen, release helpers, local orchestration.

- **LLM checks:** Scripts that call models to review tests or coverage belong here; **never commit API keys** — use environment variables or CI secrets.
- **Git hooks:** See [githooks/](githooks/) for sample hooks and install notes.

Document dependencies (bash, Python version, etc.) per script.

## Commit hook regression

Run `node --test scripts/pre-commit.test.mjs` with Node.js, Git and a POSIX shell.
The regression runs the real hook in an isolated repository with local command
substitutes: a partial commit must preserve lint-staged's temporary index and
leave unrelated staged files untouched. Test/check subprocesses clear Git-local
environment variables in a subshell so nested test repositories use their own
index. The hook itself and lint-staged retain the committing repository's Git
environment. No application tests or dependency downloads run in this regression.
The frontend commit gate runs the full Jest suite serially with ordinary console
output silenced; assertion failures and the test summary remain visible. This
avoids concurrent jsdom form work competing for memory on developer machines.

## One-click startup

Use `start.sh` to run multiple modules locally.

Examples:

- `./scripts/start.sh --all`
- `./scripts/start.sh --fe --be`
