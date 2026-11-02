# Safety Policy

Apply these invariants to every request before taking an operational action.

- Execute read-only operations without confirmation.
- Return a preview before every mutation and require explicit confirmation scoped to one target.
- Resolve real paths and prove containment before every write, move, or removal.
- Never target a skills root, workspace root, repository root, or unresolved glob.
- Never expose credentials or place them in arguments, files, cache, logs, or output.
- Never update or delete `super-skill-manager` itself.
- Treat unknown as unknown, not safe; reject confirmed malicious sources.
- Keep remote ClawHub deletion outside this manager.
- Use byCLI for routed web execution and obey its authentication, CAPTCHA, and browser-lifecycle STOP rules.
