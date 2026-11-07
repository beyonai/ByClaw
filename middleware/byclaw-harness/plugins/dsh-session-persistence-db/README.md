# @byclaw/dsh-session-persistence-db

Stores DSH session logs in openGauss/PostgreSQL, behind the same `ctx.sessionPersistence` service as the JSONL files. The shared DSH host turns it on per user:

```
BYCLAW_SESSION_DB_URL=postgres://user:password@host:5432/postgres
BYCLAW_SESSION_DB_USERS=0027012991,0027016840   # or *
```

Other users keep files. The same users' storage units (workspace, session roots, projection cache) move with them through `@byclaw/dsh-storage-db`. Only the shared host may use it: in a per-user sandbox model-generated commands run beside the harness and could read the password. The host keeps the URL out of launch environments for the same reason.

The tables (`byai.dsh_session`, `byai.dsh_session_event`) are created on first use.

With `BYCLAW_CREDENTIAL_SECRET_FILE` (the host's service secret) also set, the host keeps the same users' credential store (`.credentials.yaml`) and tool-environment SSH identities and sandbox records in `byai.dsh_host_file`, encrypted (AES-256-GCM, key derived from the secret, bound to user and file name). It restores them before a context boots and writes each change back (`scripts/host-durable-files.mjs`). They are secrets, so they never go to the user's `/by`, which commands in the tool sandbox can read.

## Behaviour

- **One writer, enforced by the database.** Opening a session for writing raises its epoch; a host still holding the old epoch gets `SessionOwnershipLostError` on its next append, and its turn fails at the next `session/flush`.
- **A database failure fails the turn.** Statements time out after `queryTimeoutMs` (30 s). The batch stays buffered and is retried; a commit whose reply was lost is not written twice.
- **Users are separated by `user_code` in every statement.** They share one process and one database account, so this guards against mistakes, not against plugin code in the host.

## Not done yet

- Existing files are not imported; for a listed user, an old chat starts an empty log.
- Only the current session format is stored. After a DSH format upgrade old sessions are refused (`SessionFormatUnsupportedError`) until a migration exists.
- Nothing deletes old sessions.

`tests/contract/` is copied from `deepseek-harness`, which does not publish these suites.
