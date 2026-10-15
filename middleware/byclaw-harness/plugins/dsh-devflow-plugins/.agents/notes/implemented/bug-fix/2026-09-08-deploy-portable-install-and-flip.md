# Agent Note: deploy installs inert and flips atomically on GNU and BSD hosts

Status: implemented

English | [中文](2026-09-08-deploy-portable-install-and-flip.zh.md)

## Problem

Installing `@zhchxiao123/dsh-devflow-deploy` added an enabled Loader row with
no configuration. The plugin correctly requires `host` and a complete driver
layout, so Cordis rejected the row before the profile could boot. The bundle
patch called that state inert, but it was not inert in the only sense that
matters: an unconfigured installation stopped the Harness.

The static driver's atomic symlink switch also used GNU-only `mv -T`. Its real
remote-command tests execute the command locally, so every deploy scenario
failed on macOS before reaching the behavior under test. A BSD-only rewrite
would merely move the incompatibility to Linux.

## Decision

The shipped `deploy` row is disabled by default. A profile enables that same
row only while supplying its complete server and driver configuration. This
keeps installation reversible and bootable without inventing unsafe address
defaults; direct programmatic composition remains fail-loud when configuration
is incomplete.

The static switch still stages a fresh symlink and performs one rename over the
live link. It first tries GNU `mv -fT`; if that option form is unavailable, it
uses BSD/macOS `mv -fh`. Both forms prevent a destination symlink to a directory
from being followed, so the rename remains atomic on the two supported Unix
families. Windows remote hosts remain unsupported.

## Alternatives considered

**Give deployment paths defaults.** Rejected: a guessed host or served tree can
publish to the wrong place. Missing deployment knowledge is a reason to leave
the capability disabled, not a reason to fabricate it.

**Remove the live symlink before moving the staged one.** Rejected: it is
portable but creates a gap in which visitors receive a missing target, breaking
the static driver's advertised atomic rollback class.

**Use plain `mv -f`.** Rejected: GNU `mv` may treat a destination symlink to a
directory as a directory unless `-T` is supplied. Passing on macOS is not enough
if the same command changes meaning on Linux.

## Consequences

A standalone package install no longer breaks an unrelated profile; an
operator must make deployment active explicitly. The profile patch now becomes
the audit point for the destination being authorized.

Static deployment and rollback execute the real flip successfully under both
GNU and macOS command semantics while retaining the same release layout and
atomic rollback promise. The fallback is intentionally limited to Unix tools;
supporting Windows servers would require a different remote protocol rather
than another flag branch.
