# Session titles

New standalone chat sessions publish a local title derived from the first ten characters of the
message immediately. Model-generated titles are optional enrichment and do not block session
creation or Framework message dispatch. Existing prompt selection and English/Chinese fallback
remain unchanged.

The `sessionTitleExecutor` has two workers and a bounded queue of 32 tasks. Saturation retains
the local title; it never runs model requests on the submitting chat thread. Tasks preserve the
request's user and locale, restore worker context, and start only after an active transaction
commits. Failures or process restarts leave a usable local title.

The `summary_title_pending` session extension is saved before publishing the new session.
Manual renaming removes this extension. The background task atomically consumes the extension and
writes the generated name in one transaction. A concurrent manual rename waits for this claim
to finish and then writes its own title, so the manual name wins. The extension is cleared after
completion or rejected submission. No schema migration is required.

Successful enrichment broadcasts `SESSION_EVENT/sessionTitleUpdated` to the owner's devices.
The frontend handles this globally, including after turn completion or session navigation.
Tenant-owned session creation keeps its existing local-title behavior.
