# Agent Note: devflow — the journal is read-only to the agent's file tools

Status: implemented

English | [中文](2026-08-26-devflow-journal-fs-guard.zh.md)

## Problem

`.devflow/` lives inside the workspace so cards travel with git, but that also put the journal inside the developing agent's writable set: an agent with workspace-write file tools could bypass the transition executor (revision CAS, edge legality, rework reasons, gates) and rewrite history directly. The first devflow PRD recorded this as a known limitation; the follow-up PRD (`.agents/prd/2026-08-26-devflow-workspace-binding-and-chat-creation.md`) requires closing it without moving the state out of the workspace.

## Decision

A new policy plugin, `@zhchxiao123/dsh-devflow-fs-guard`, on the existing `fs/write-intent` / `fs/edit-intent` waterfalls the file tools dispatch before every mutation — the same slot `dsh-fs-observation-policy` occupies. A target whose path contains a protected directory segment throws the structured `FS_SANDBOX_DENIED` (reusing the fs vocabulary's policy-fence code) with a message that names the devflow tools, so the denial is enforced in the tool executor and reads stay open. The protected names are deployment configuration (`directories`, default `['.devflow']`, ill-formed lists fail the load) delivered beside the gate configuration in the profile — never hardcoded in a devflow plugin and never stored in files the agent can edit. The devflow store writes host-side with plain node fs, not through `ctx.fs`, so the transition executor keeps working unchanged under the active policy: hardening costs no functionality, which the composition test proves by moving and creating cards while the same session's file tools are denied.

## Alternatives considered

- **Carving `.devflow` out of the sandbox `writableRoots`** — deferred, not rejected: it would extend the fence to bash (the kernel boundary), but `writableRoots` is the one function shared by the fs fence and the Seatbelt profile, and subtracting subtrees there is sandbox-profile work beyond this slice; recorded as the guard's known limitation.
- **Omitting the journal from the file tools' schemas or prompts** — rejected: schema omission is not enforcement; any direct or alternate caller bypasses it, and the repository rule is to test denial through the executor.
- **A read-only bit or ownership change on the files** — rejected: the harness process itself (the devflow store) must keep writing them, and permission bits do not distinguish the store from the agent's tools running in the same process.

## Consequences

Process state is tamper-resistant against the chat plane while staying in git: the model can read the journal it cannot forge, and every mutation funnels through the seam where CAS, edge legality, and gates decide. Shell writes remain confined only by the composed kernel sandbox (workspace-write still includes the devflow root) until the `writableRoots` subtraction lands.
