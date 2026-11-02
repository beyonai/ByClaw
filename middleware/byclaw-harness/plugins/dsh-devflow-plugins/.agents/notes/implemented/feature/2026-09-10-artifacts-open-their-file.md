# Agent Note: an artifact path opens the file it names

Status: implemented

## Problem

The detail sheet listed artifact paths — `artifacts/2-requirements-document.md`
in the artifact section, and again in the timeline entry that registered it —
as dead text. A reader learned where the deliverable is and then had to go find
it somewhere else.

The Harness now composes workspace files by default: `ui-sidebar-files` is in
the shipped web profile (`bundle/web-app/cordis.patch.yml:234`), so a viewer for
`dsh-resource://file/**` is already running in the surface this board lives in.
The capability was there; the board simply was not reaching for it.

## Decision

Each artifact path becomes a control that calls
`tab.actions.openResource(address)`.

### The address needs no workspace root

`file-address.ts` in the Harness defines two scopes. The `session` one takes a
path that "may be absolute or workspace-relative — the Host resolves it against
the root it holds for the Session".

So the board passes the artifact's absolute path under the session scope and
never asks what the session's workspace root is. The Harness's `fileAddressFor`
also strips a known root to shorten the address; that is cosmetic, it needs an
input this plugin does not hold, and it is not restated.

The absolute path keeps its leading separator as an empty first segment
(`…/session/<id>//ws/…`). That reads like a typo and is not: the grammar spells
it that way and `parseFileAddress` rejoins it correctly.

### The grammar is restated, because importing it would fail the build

`@deepseek-ai/dsh-util-workspace-path` is not in the client bundle's module
table (`tsdown.client.ts` lists five entries), so a runtime import of
`sessionFileAddress` would fail the purity gate. The encoder is pure string
work, so it is repeated in `devflow-ui/src/client/file-address.ts` under the
same rule the trust fence and the sidebar contract already follow.

A restatement is only worth anything if it does not drift, so it is checked
against the original rather than against this author's expectations: the spec
cases were run through both implementations — absolute, relative, spaces, `#`,
`?`, `%`, `+`, CJK, a Windows drive, and UNC — and both produce identical
strings. The suite in `file-address.client.spec.ts` pins those same answers.

### The restated sidebar contract grows by one method

`SidebarRightTabInfo.tab` gained `actions`, carrying `openResource` alone.
`openTab` and `close` have no consumer here and are not restated.

This does not reopen the decision to keep the sidebar contract restated rather
than depended on: `openResource(address, options?)` is a plain method signature,
so restating it pulls in none of the dockkit/layout/host-webserver graph that
made the real dependency unaffordable.

### It opens beside the board, not in its place

`openResource` accepts `replaceTab`, which would open the file in the board's
own tab and close the board. It is not passed. The board is the context a reader
is opening the file *from*; taking it away to show the file answers a question
nobody asked. A test asserts the call carries exactly one argument, so adding
placement later has to be a decision rather than a slip.

### The timeline registration opens the same file

It names the same path, so it behaves the same way. A path that is clickable in
one place and inert in another reads as a bug.

This cost a copy change: `timeline.artifact` was `登记产物 {path}` /
`artifact {path}` and is now the label alone, with the path rendered beside it
as its own element. A path interpolated into a sentence cannot be a control.
The space between them is now layout rather than a character in the copy.

### Only the path is the target

The rest of an artifact row states registration facts — kind, stage, revision.
Making the whole row a control would claim a gesture for them too, and leave
nowhere to put a future per-row action.

## Consequences

- `devflow-ui` carries a copy of a Harness encoder. It is small and pure, but it
  is a copy: if the Harness changes the grammar, this breaks silently until
  someone re-runs the comparison. The note above records how to re-run it.
- A surface that supplies no `openArtifact` still renders every path, as text.
  `CardDetail` is surface-neutral by design and this keeps it so.

## Known gap

**An artifact whose file was deleted is not handled here.** `ArtifactRecord` is
a journal registration and the file may be gone; what `openResource` does with a
missing file — an error page, an empty viewer, silence — was not verified, so
this change neither relies on nor claims graceful degradation. The path stays
clickable either way.

## Verification

- `tsc -b --force`, `oxlint`: clean.
- `vitest run`: 100 suites, 1325 tests.
- `test:coverage`: per-file 100% on `packages/*/src`.
- `pnpm run build`, whose client-bundle purity gate is the real check that the
  encoder is restated rather than imported; the built bundle names
  `dsh-util-workspace-path` only inside a comment.
- `preflight:tarballs`: 19 packages pack cleanly.
- Not covered by automation: that the file actually opens in a real Web profile,
  and what a deleted artifact does there.
