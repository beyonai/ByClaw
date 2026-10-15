# Agent Note: The Midscene operation lock leaves the committed tree

Status: implemented

## Problem

`withProjectMutation` took its cross-process lock at `.devflow/midscene/operation.lock`, inside the subtree Devflow commits and carries between branches and machines. The file holds `{ pid, startedAt }` of the host that took it, and that content means nothing anywhere else. Committed, it reaches another checkout and makes `midscene_project` answer `MIDSCENE_PROJECT_BUSY` while pointing the user at a process that never ran there; two branches that each mutated settings also collide on the one path at merge.

## Decision

The lock is `operation.lock` under the workspace's private runtime root — `$DSH_HOME/midscene/projects/<sha256(canonical workspace)>`. Nothing under `.devflow` is created or removed by a settings mutation.

`projectOutput` lives in `src/runtime-root.ts`. Both `project-runtime.ts` and `project-settings.ts` import it from there, and `project-runtime.ts` re-exports it so existing importers keep one name for it. The direction matters: `project-runtime.ts` imports `project-settings.ts` for reads, so the lock's owner could not import the runtime module back.

The move keeps every property the lock had: exclusive `O_EXCL` creation, per-component symlink rejection, dev/ino re-verification after open, and removal on the success and failure paths alike. It gains the checks the runtime root already made — a `0700` directory, storage that must sit outside the project, and rejection of an aliased root — and drops the two `mkdir` calls that existed only to create `.devflow/midscene` for the lock. `MIDSCENE_PROJECT_BUSY` names the new path, because that message exists to send a person to one specific file.

The `.devflow/` guard in `writeProjectFile` is unchanged. The lock never passed through it — it opens its own handle with `wx` — so this change opens no write path outside `.devflow`. Settings, validation policy and suites are deployment choices that belong in the repository and stay where they are.

## Alternatives considered

**Put `projectOutput` in `identity.ts`.** It already holds `sha256` and `within`, the only two things `projectOutput` needs, and it would save a file. That module fingerprints workspace content; locating private storage is a different subject, and merging them makes both harder to name.

**Give `withProjectMutation` a root parameter.** Every caller would then decide where the lock goes, which is exactly the invariant the function exists to hold.

**Delete a stale lock at the old path.** The old file may be tracked by git, and silently deleting a user's version-controlled file is worse than leaving a file nothing reads. It also sits inside the subtree `devflow-fs-guard` protects, where the standing position is that one write path owns the tree. The README and the acceptance skill asset say the residue is historical and safe to remove by hand instead.

## Consequences

A settings mutation leaves the repository's working tree untouched, and `packages/devflow-midscene/tests/project.spec.ts` pins that: it compares the `.devflow` file set before and after a mutation, and observes the lock appear and disappear in the private runtime root.

Recovery is now a private-directory operation. The lock is no longer visible in a `git status`, so the README and `assets/devflow-midscene-acceptance.md` carry the path a person needs.

Two devflow-midscene versions operating on one workspace at the same moment do not exclude each other: the older one holds the old path, the newer the new one. The window is narrow and accepted; a compatibility layer that took both locks would keep the committed file alive, which is the defect.

The sibling change that writes `.devflow/midscene/operation.lock` into the specified ignore list keeps that line as a backstop. It is redundant against this code and costs one line; omitting it would cost process state in git if either change is reverted alone.
