# Agent Note: Project automation pages and tool consumers

Status: implemented

English | [中文](2026-09-14-automation-sidebar-tools.zh.md)

## Problem

A host-wide management view cannot determine which project owns a subscription or where a downstream development task belongs. Mixing GitHub content into the generic scheduler page also couples its navigation to one handler.

## Decision

Plans and GitHub subscriptions belong to the stable ID of an existing Harness workspace. Sessions are entrances to that project; the host owns execution. Closing a page or session does not cancel accepted background work. Worktrees with different workspace identities are independent even when their Git remotes match.

The shared automation-project resolver uses the actual session's cwd and the published workspace registry. HTTP accepts a session ID, never a filesystem path or client-selected project owner. Tools and commands derive that context from their invocation. Missing context fails closed instead of accessing host-wide data. Durable services filter project reads and check ownership before operations, including consumers and run recovery. GitHub plans validate same-project subscription linkage before configuration and delivery. Creating, updating and claiming plans require a currently available handler; existing plans can wait for an unloaded handler to return. Tools recheck cancellation after asynchronous workspace resolution before mutating state.

The native right Sidebar registers two peer pages. Automation manages plans and delivery history; GitHub Subscriptions manages subscriptions, plain-text content and synchronization runs. Native navigation carries the related subscription or run without changing its project. The existing Devflow board remains a peer. Page state belongs to its session/tab context, and late reads cannot replace another project's state.

Legacy records remain unassigned until explicitly claimed. Claiming is atomic within each provider's database, retains history and keeps automatic work paused; resumption is explicit. Linked records in the two databases can be claimed separately, but a plan cannot execute until ownership agrees. Storage capacity remains a shared host resource and is labeled accordingly.

## Alternatives considered

**Filter only in the UI.** Tools, guessed object IDs and queued work could still cross project boundaries.

**Use Git remote or the session ID as ownership.** A remote can serve several projects; multiple sessions can operate on one project. Neither identifies the required durable scope.

**Separate databases per session.** This duplicates state, couples background work to conversations and conflicts with shared project ownership.

## Consequences

Scheduling and synchronization remain independent service/provider/consumer capabilities. Their human and tool entrances observe the same durable outcomes. Accepted delivery and completed synchronization remain separate facts. Unassigned discovery is an explicit migration action; ordinary project queries never include unassigned or other-project records. Registry deletion does not reassign records to a replacement workspace with a new ID.

## Verification

Node 24.18.0 / pnpm 11.24.0: 134 test files, 1,687 tests pass. Repository-wide per-file statement, branch, function and line coverage is 100%. TypeScript, clean build and 30-package tarball preflight pass; lint reports no errors and three existing unused-disable warnings.

Real Loader composition uses published workspace registry, filesystem domain storage and session persistence to verify same-project sessions, cross-project reads/writes, consumer access and recovery. Regressions refuse configuration without a handler, unloading during validation, and cancellation during workspace resolution.

Packed isolated profiles expose 19 actual tools and two native Sidebar pages. Browser checks create a subscription in project A, open its prefilled schedule in Automation, dispatch and follow the completed synchronization back to GitHub, then switch to project B and observe an empty list. Final tarballs also reject cross-project synchronization and plan linkage over real HTTP. GitHub responses use a loopback fixture; no real model request or remote GitHub account operation was performed.
