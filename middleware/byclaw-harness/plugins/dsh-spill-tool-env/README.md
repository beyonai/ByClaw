# @byclaw/dsh-spill-tool-env

A DSH spill store (`ctx.spillStore`) that writes oversized tool results into the tool environment, under `/by/.dsh-spill/session-<hash>/`.

The spill policy replaces a long tool result with a preview and a path, and tells the model to `read` or `grep` that path. On the shared host those tools run in the user's tool sandbox, so the file has to be there. `@deepseek-ai/dsh-spill-local` writes to the host's temp directory, which the tool sandbox cannot see and a host restart discards.

The shared DSH host enables it, and disables `spill-local`, for every user whose tools run in a tool environment (not for `toolEnvBackend: none`).

## Behaviour

- Files are created owner-only (`0600` in a `0700` directory) and never replace an existing file. Names derive from, but never equal, the suggested name; the session id is hashed.
- A failed write (no tool environment, a full disk) fails the save; the spill policy then keeps the result inline.
- On the first spill of a context, files older than `cleanupPeriodDays` (30) are deleted in the background, as `spill-local` does at startup.
