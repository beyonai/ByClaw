# Agent Note: CI blocks on what it can decide, and runs where the code meets the platform

Status: implemented

English | [中文](2026-08-27-ci-blocking-gates.zh.md)

## Problem

Two holes in the gate, both of which let a change reach a tag unexamined.

**Preflight was advisory in CI.** It ran under `continue-on-error: true`, for a stated and correct reason: one of its checks asks whether this version is already on npm, and on a pull request the answer is "not yet" for every commit. But the flag applies to the run, not to the check, so *every* preflight check stopped blocking — including the one its own source calls out as "the one failure here that breaks a whole harness": a `dsh.client` declaration shipping without `lib/client.js`, which a harness treats not as a degraded install but as a refused boot. A packaging regression could only be caught by the release workflow, at the moment a mistake is most expensive to make.

The split is easy to see once stated: of preflight's checks, exactly one is about release timing. Manifest targets missing from the tarball, surviving `workspace:` ranges, a bundle patch the tarball does not carry, a client declaration without its bundle, drifted versions — all answer the same on a pull request as during a release.

**CI ran one platform.** `ubuntu-latest`, Node 22, no matrix. `devflow-filesystem` is the largest package in the line and is where it meets the operating system: `O_EXCL` creation for both the claim and the commit lock, `mtime` staleness, `rename`, `chmod` in the specs, and card directory names whose uniqueness assumes a case-sensitive filesystem. Windows makes `chmod` largely inert, APFS is case-insensitive by default, and `rename` across volumes fails. A line that claims to run wherever a harness runs was proven on one of the platforms a harness runs on.

## Decision

**`preflight --no-registry` is what CI runs, and it blocks.** The flag drops the registry lookup and keeps everything else, so the checks that can decide on a pull request do. The release workflow keeps running the full form, where the registry question is both answerable and worth asking.

**Two jobs rather than one matrix.** Typecheck, lint, and the tarball checks answer identically on every platform, so paying three times for them buys nothing; they stay on the cheapest runner. The test suite is what varies, so it runs on macOS and Windows as well, with `fail-fast: false` so one platform's failure does not hide another's.

**`concurrency` cancels superseded runs on branches, not on `main`.** A branch's newer push makes its older run irrelevant. A run on `main` is the record of what `main` was, so it is left to finish.

## Alternatives considered

**Teach preflight to recognize a release context and skip the check itself.** Rejected because it would put an inference about the caller inside a script whose value is reporting facts about tarballs.

## Consequences

A packaging regression now fails a pull request rather than a release. The version-drift check moves with it, which matters because `set-version` is the only thing keeping eleven manifests in step.

**The new platforms surfaced existing failures immediately**, which is what they are for. macOS passed and blocks normally. Windows failed five specs, all with one cause: each builds an "unreadable" or "unwritable" path with `chmod(path, 0o000)` and asserts the provider reports the resulting infrastructure failure, but Windows largely ignores those mode bits, so the condition under test is never created and the assertion fails on code that behaved correctly. The defect is in the specs, not in what they cover.

Those five specs now inject `EACCES` at the matching `node:fs/promises` operation and path, using the same boundary as the existing contention specs. The public assertions are unchanged, the failure is consumed once, and the setup behaves identically on Linux, macOS, and Windows. The `chmod(0o444)` specs that remained at the time exercised file write denial, which Node preserves on Windows through its writable bit — but a root-run container never sees the denial at all, so they have since been converted onto the same injector (an `appendFile` fault at the journal path), with their assertions unchanged; no test simulates a filesystem failure through permission bits anymore. With issue #2 resolved, `windows-latest` no longer carries `continue-on-error`; every platform job blocks.

CI on a pull request now costs three runners instead of one. `cancel-in-progress` on branches recovers part of that by not letting superseded runs finish.
