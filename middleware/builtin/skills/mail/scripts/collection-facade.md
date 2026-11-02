# Mail collection facade

`collection-facade.mjs` exports `describeCapabilities(context, selector)` and
`execute(request, context, deps = {})`. The parent collection owner provides the
authorized immutable `mailBindings`, registered `candidates`, absolute persisted
`deadlineAt`, canonical `sessionDir`, and fixed private `downloadRoot`.

Only exact `accountContextRef` matches are authorized. Provider hints never supply
commands or paths. Browser identities are context-only; transparent cross-process
resume is unsupported. The collection controller must reject interrupted replay.
Projected bindings optionally carry the credential-free `capabilities` and
`capabilityStatus` from the local account projection. Missing or conditional
capability metadata is unknown, not supported.

Discovery lists the inbox in bounded pages, defaulting to at most 200 scanned and
20 returned messages. It reads complete bodies before matching. Every whitespace
token or double-quoted phrase in the original query must occur case-insensitively
in the subject, sender, or body. There is no semantic rewrite or stemming. Date-only
boundaries use the requested IANA timezone; timestamps require an explicit UTC
offset. Time ranges are left-inclusive and right-exclusive. `coverage.scope` is
`inbox`: end-observed completion never means every mailbox folder was searched.
Read failures preserve metadata matches with `bodyStatus: failed`; they never
fabricate full text. Exhausted scanning or return budgets produce partial results.

Materialization accepts only registered `skillItemId`/`revision` references and
rechecks account revision and the original criteria fingerprint. IDs hash account
and provider message ID; candidate revisions additionally hash content and
attachment metadata. Preserve all binding/fingerprint fields when registering
candidates. Successful materialization can produce a newer revision.

Attachments download only when materialization explicitly sets
`includeAttachments: true`. Supported extensions are PDF, TXT, MD, CSV, JSON,
DOC/DOCX, XLS/XLSX, and PPT/PPTX. Inline and non-file attachments are unsupported.
Files are limited to 25 MiB each and the smaller of the requested cumulative
budget and 100 MiB. Failures are reported per attachment. A private exclusive lock,
filesystem byte accounting and hash-validated receipts prevent duplicate downloads
and reset of cumulative usage within the fixed root. Files remain source evidence;
the collection artifact owner must revalidate before publishing them.

Tests can inject `deps.runMail(providerRequest, binding, options)`; it returns
`{items, coverage?}` or `{ok:false,error:{code}}`. Provider requests use only
`list` (limit, offset or cursor), `read` (message, optional bodyType), and
`download` (message, attachment, sessionDir). List coverage includes `endObserved`
and projected `nextCursor`. Read rows use the existing browser wrapper shape:
`emailId`, `subject`, `fromEmail`, `date`, `body`,
`contentGranularity: full-text`, `attachments`. The production projected adapter
normalizes the mailctl response into that shape. Download rows contain `path`
and `size`. Options carry remaining `timeoutMs`, absolute numeric `deadline`,
`maxDownloadedBytes`, and parent `sessionDir`. Test doubles must obey those limits.

Run offline verification with:

```sh
rtk proxy node --test middleware/openclaw/skills/mail/scripts/collection-facade.test.mjs middleware/openclaw/skills/mail/scripts/iwhalecloud-mail.test.mjs
```
