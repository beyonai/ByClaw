# Agent Note: the workspace may live on the context's tool environment

Status: implemented

## Problem

ByClaw is moving to one shared DSH process with one context per user. Each
context runs its tools in the user's own tool sandbox through DSH's SSH
providers, so `ctx.fs`, `ctx.subprocess` and `ctx.shell` reach the sandbox,
while this process has no `/by` at all. Every devflow plugin that touched the
workspace did so with `node:fs` and `child_process.execFile` in this process:
the board, its artifacts, gate reports and caches, spec documents and their
anchored sources, iron rules, workspace manifests, and the `git` questions the
worktree fence and `/devflow doctor` ask. In a shared process those calls read
and write the host, not the user's workspace. The headless fallbacks of the
sentinel and the iron rules also took the workspace from `process.cwd()`, which
is one value for every user.

## Decision

`@zhchxiao123/dsh-devflow` exports `WorkspaceIo`, a node-shaped interface over
the workspace operations devflow performs, with two implementations:

- `localWorkspaceIo` is the previous `node:fs` and `execFile` code, unchanged.
- `toolEnvironmentWorkspaceIo(ctx)` reads, writes, lists and stats through
  `ctx.fs`, and creates directories, renames, removes, appends and runs
  commands through `ctx.subprocess` (`/bin/sh` scripts whose exit statuses map
  to `ENOENT`, `EEXIST`, `ENOTDIR`, `EISDIR` and `ENOTEMPTY`). Failures keep
  node's codes, so every existing `ENOENT` / `EEXIST` / exit-code branch is
  unchanged. A write refuses a missing parent as node does, although the
  provider would create it.

`workspaceIo(ctx, config.workspaceOnToolEnvironment)` selects one. The option
defaults to `false` on every plugin that has it, so a deployment that sets
nothing behaves exactly as before. It exists on the store
(`devflow-filesystem`), `devflow-tool`, `devflow-artifact-gate`,
`devflow-agent-gate`, `devflow-worktree`, `devflow-command`,
`devflow-spec-filesystem`, `devflow-spec-sentinel` and `devflow-iron-rules`;
the name matches `byclaw-integration`'s option for the same fact. Each plugin
reads the flag itself, so a host sets it on every row it mounts.

`devflow-spec-sentinel` gains `repoRoot` and `devflow-iron-rules` gains
`projectRoot`: the workspace used when a session names no working directory,
and the base a relative `root` resolves against. Unset, both remain the process
cwd.

Freshness caches that compared `mtimeMs` (the anchor-source parse cache and the
workspace-layout fingerprint) compare `WorkspaceStats.version` instead: `mtime`
and size locally, the provider's version token remotely.

Check scripts, gate commands and review commands already ran through
`ctx.shell`, so they follow the shell provider without a change.

## Alternatives considered

**One flag on the store that every consumer reads.** Consumers that read card
artifacts could ask the store where its files are. It would save a host a few
config keys, but the worktree fence and doctor also run `git`, which is not the
store's file, and the iron rules and spec plugins do not depend on the store at
all. A per-plugin option keeps each plugin's behavior decided by its own
configuration.

**Everything through `ctx.subprocess`.** A shell command per operation gives
one error vocabulary, but reads and writes are the hot path and `ctx.fs` serves
them over the helper's RPC without starting a process per call.

**A context-scoped "current I/O" set once at boot.** Module state would be
shared by every context in the process, which is the problem being solved.

## Consequences

The remote path depends on the provider honoring the `@deepseek-ai/dsh-fs`
contract and on a POSIX `sh` with `mkdir`, `mv -T`, `rm` and `cat` on the tool
environment. Directory listings through `ctx.fs` do not distinguish symbolic
links, so a remote `WorkspaceEntry.isSymbolicLink()` is always `false`; `lstat`
still reports links. Commands' stdout is capped at 32 MiB and refused, not
truncated, beyond it.

Not converted: `devflow-web`'s acceptance-report route (`O_NOFOLLOW` reads with
inode checks), `devflow-gates`' project policy and validator roots, and
`devflow-review-gate`'s diff reads and reports. ByClaw mounts the first without
report configuration and ships the other two disabled; `devflow-business` is
not in the bundle.
