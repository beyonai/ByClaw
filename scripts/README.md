# scripts

Repository-level automation: bootstrapping, codegen, release helpers, local orchestration.

- **LLM checks:** Scripts that call models to review tests or coverage belong here; **never commit API keys** — use environment variables or CI secrets.
- **Git hooks:** See [githooks/](githooks/) for sample hooks and install notes.

Document dependencies (bash, Python version, etc.) per script.

## One-click startup

Use `start.sh` to run multiple modules locally.

Examples:

- `./scripts/start.sh --all`
- `./scripts/start.sh --fe --be`
