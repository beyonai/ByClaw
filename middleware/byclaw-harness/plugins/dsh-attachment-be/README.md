# @byclaw/dsh-attachment-be

DSH's image attachment store (`ctx.attachments`) with a copy of every image in the user's own space, so a session can continue on any host.

DSH keeps the normalized copy of each image (resized and re-encoded for the model) under `<dsh-home>/attachments/v1`. The session log records only its digest, and every later turn reads the copy again to send the history to the model. On a shared host that copy would be lost with the host's disk. This store is `@deepseek-ai/dsh-attachment-local` plus:

- **Save**: after the local write, the copy is stored through BE (`POST /fs/operation/v1/files/put`, `spaceType=USER`) at `/by/.dsh/attachments/<sha[0:2]>/<sha256>` in the user's bucket. A failed store fails the save, so no reference points at an image another host could not read.
- **Read**: when the local copy is missing, it is fetched (`GET /fs/operation/v1/files/get`), checked against its digest and published locally; the local store's own checks then run as usual. A missing or changed copy reads as `ATTACHMENT_NOT_FOUND`, as before.
- Calls carry the user's `Beyond-Token`. The host renews it with each PUT (`renewBeToken`); when BE still rejects it, the store asks the host's `byclawBeTokenSource` for the user's current token once.

The shared DSH host enables it for the users in `BYCLAW_SESSION_DB_USERS` when the tool environment backend is `byclaw-be` (that is where it learns BE's address).

## Not done yet

- The copies sit under the user's `/by`, so commands in the tool sandbox can see and delete them. A changed copy is refused by digest; a deleted one is lost on hosts without a local copy.
- Images already on a host's disk are not uploaded. File attachments (`saveFile`) stay local; ByClaw passes files through `/by` paths instead.
- Nothing deletes old copies (DSH never deletes attachments either).
