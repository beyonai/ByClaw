# @byclaw/dsh-storage-db

A DSH storage backend (`ctx.storage`) on openGauss/PostgreSQL, registered as backend `db`. Units opened through `storage-domain` land in the database instead of `<dsh-home>/storages/*.json`: workspace records, ByClaw session roots, the session projection cache, schedules and group task publications.

The shared DSH host turns it on for the same users as the session database (`BYCLAW_SESSION_DB_URL`, `BYCLAW_SESSION_DB_USERS`, see `dsh-session-persistence-db`) and routes their `storage-domain` row to `db`. Other users keep files. Only the shared host may use it, for the same reason as the session database: in a per-user sandbox model-generated commands could read the password.

The tables (`byai.dsh_storage_unit`, `byai.dsh_storage_record`) are created on first use.

## Behaviour

- **One writer per unit, enforced by the database.** Opening a unit raises its epoch; a host still holding the old epoch gets `StorageOwnershipLostError` on its next write.
- **Versions follow the backend contract.** A `single` unit stamped with another version is refused untouched (`version-mismatch`). A `per-record` unit reads the record versions it accepts (`version`, `compatibleVersions`) and treats others as missing; `backupRecord` moves a record to `#backup:<table>` rows instead of deleting it.
- **A database failure fails the write.** Statements time out after `queryTimeoutMs` (30 s). Writes are overwrites, so repeating one after a lost reply is safe.
- **Users are separated by `user_code` in every statement**, as in the session database.
- openGauss has no `ON CONFLICT`; a write locks the unit row, then updates the record and inserts it when absent.

## Not done yet

- Existing `storages/*.json` files are not imported. For a listed user, workspace pins and session roots start empty, so old chats need re-opening from BE; the projection cache rebuilds itself.
- Nothing deletes old rows.

`tests/contract.ts` is copied from `deepseek-harness` (`packages/storage/storage/tests`), which does not publish it.
