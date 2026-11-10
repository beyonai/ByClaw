# @byclaw/dsh-db

Stores the shared DSH host's per-user state in openGauss/PostgreSQL instead of files under `<dsh-home>`. Two plugins share one connection pool per database:

- **`@byclaw/dsh-db/session`** (row `session-persistence-db`): session logs, behind the same `ctx.sessionPersistence` service as the JSONL files.
- **`@byclaw/dsh-db/storage`** (row `storage-db`): a DSH storage backend (`ctx.storage`) registered as `db`. Units opened through `storage-domain` land in the database instead of `<dsh-home>/storages/*.json`: workspace records, ByClaw session roots, the session projection cache, schedules and group task publications.

The shared DSH host turns both on per user:

```
BYCLAW_SESSION_DB_URL=postgres://user:password@host:5432/postgres
BYCLAW_SESSION_DB_USERS=0027012991,0027016840   # or *
```

For those users it disables `session-persistence-jsonl` and routes `storage-domain` to `db`. Other users keep files. Only the shared host may use it: in a per-user sandbox model-generated commands run beside the harness and could read the password. The host keeps the URL out of launch environments for the same reason.

The tables (`byai.dsh_session`, `byai.dsh_session_event`, `byai.dsh_storage_unit`, `byai.dsh_storage_record`) are created on first use. Every context in the process and both plugins draw on one pool (`poolMax`, default 8, set by the first to open it).

With `BYCLAW_CREDENTIAL_SECRET_FILE` (the host's service secret) also set, the host keeps the same users' credential store (`.credentials.yaml`) and tool-environment SSH identities and sandbox records in `byai.dsh_host_file`, encrypted (AES-256-GCM, key derived from the secret, bound to user and file name). It restores them before a context boots and writes each change back (`scripts/host-durable-files.mjs`). They are secrets, so they never go to the user's `/by`, which commands in the tool sandbox can read.

## Behaviour

- **One writer, enforced by the database.** Opening a session for writing, or a storage unit, raises its epoch. A host still holding the old epoch gets `SessionOwnershipLostError` or `StorageOwnershipLostError` on its next write; a session's turn fails at the next `session/flush`.
- **Versions follow the storage backend contract.** A `single` unit stamped with another version is refused untouched (`version-mismatch`). A `per-record` unit reads the record versions it accepts (`version`, `compatibleVersions`) and treats others as missing; `backupRecord` moves a record to `#backup:<table>` rows instead of deleting it.
- **A database failure fails the operation.** Statements time out after `queryTimeoutMs` (30 s). A session batch stays buffered and is retried; a commit whose reply was lost is not written twice. Storage writes are overwrites, so repeating one after a lost reply is safe.
- **A connection dropped inside a transaction fails that write**, not the process.
- **Users are separated by `user_code` in every statement.** They share one process and one database account, so this guards against mistakes, not against plugin code in the host.
- openGauss has no `ON CONFLICT`; a storage write locks the unit row, then updates the record and inserts it when absent.

## Deploying

- **Listing an existing user hides their old state.** On the next boot the user reads only the database, so their earlier chats, workspace pins, session roots and schedules no longer appear (nothing is imported, see below); the files stay on the host's disk, unread. Removing the user from the list shows the files again, without what was written to the database meanwhile. Durable files are the exception: a local file with no row is stored on first boot. List new users, or tell existing ones their history restarts.
- **Every context boot adds a by-framework consumer.** The worker id carries a random part per boot, so that a restarted host reclaims its predecessor's open commands. by-framework never removes consumers, so the `agent_engines` group of each user's command stream keeps one per boot. Once reclaimed they hold no pending entries; delete those idle for a day or more with `XGROUP DELCONSUMER <stream> agent_engines <name>`, never one whose `XINFO CONSUMERS` shows `pending` above 0 (deleting it drops those commands).
- **Platform-managed hosts must switch together.** With `BYCLAW_SESSION_DB_URL` set (as with a shared user root), a managed host claims a context once per context (`byclaw:dsh:managed-host:storage:<context>`) instead of once per generation. A host without it still claims per generation, so the two do not exclude each other and could run one context at once. Set it on every managed host of a deployment in the same rollout, with the old instances drained first.

## Not done yet

- Existing session files and `storages/*.json` are not imported. For a listed user, an old chat starts an empty log, workspace pins and session roots start empty (old chats need re-opening from BE), and the projection cache rebuilds itself.
- Only the current session format is stored. After a DSH format upgrade old sessions are refused (`SessionFormatUnsupportedError`) until a migration exists.
- Nothing deletes old sessions or rows.

`tests/session/contract/` and `tests/storage/contract.ts` are copied from `deepseek-harness` (the latter from `packages/storage/storage/tests`), which does not publish these suites.
