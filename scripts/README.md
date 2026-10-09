# scripts

Repository-level automation: bootstrapping, codegen, release helpers, local orchestration.

- **LLM checks:** Scripts that call models to review tests or coverage belong here; **never commit API keys** — use environment variables or CI secrets.
- **Git hooks:** See [githooks/](githooks/) for sample hooks and install notes.

Document dependencies (bash, Python version, etc.) per script.

- **Post-release smoke tests:** `run-release-smoke.sh` logs in as a configured user, tests five individual digital employees in separate chats, deletes successful test chats, retains failed chats, and sends a text report through the dedicated ByClaw automated testing DingTalk robot. Requires Node.js 20+, pnpm 9 and Playwright. See [configuration and deployment hooks](../tests/integration/release-smoke/README.md).

## One-click startup

Use `start.sh` to run multiple modules locally.

Examples:

- `./scripts/start.sh --all`
- `./scripts/start.sh --fe --be`
