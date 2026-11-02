# Agent Note: Midscene CI portability and lint project discovery

Status: implemented

## Problem

Type-aware lint cannot resolve tests and scripts excluded from the nearest TypeScript project. Missing type information produces thousands of `error`-typed diagnostics even when the source build passes. Real-process tests also depend on Windows path, permission, filesystem-error and process-tree semantics that a local macOS run cannot establish.

## Decision

Each package's tests have a discoverable no-emit `tests/tsconfig.json`. New projects extend `tsconfig.tests.json`; root scripts and helpers use local configurations extending `tsconfig.tools.json`. Production build references and lint rules remain unchanged. Obsolete missing-type suppressions are removed.

Fixtures use native path operations and `file:` URLs for ESM imports. Permission tests follow the reader's existing contract: Unix checks POSIX permission bits; Windows ACL policy belongs to the host. Report-rendering tests have an outer budget for acceptance plus a second browser without changing the acceptance deadline. Recovery fixtures expose child progress and results while retaining real model-request, host-kill and process-exit assertions.

Worker unit tests supply a test-owned lifecycle and IPC host; production uses the dedicated worker process. The tests do not replace the test runners process listeners, send function or connection state. Sharing Vitest's IPC channel can cancel a worker unexpectedly, leaving queued mock responses to contaminate the next case. Mocks are reset between tests, listener isolation and disposal are asserted, and restart detection requires both build probes. Real-process tests retain actual IPC and process termination.

Owned browsers prepare a persistent page with Playwright, apply login state before navigation, wait for page load and a successful screenshot, then hand that rendered page to the official CLI. The CLI's immediate screenshot after `domcontentloaded` can fail on hosted macOS before rendering is ready. Browser launch, CDP connection, navigation and screenshot share the remaining operation budget; cancellation or expiry prevents the next step. Borrowed browsers retain their existing connection path. Cleanup failures retain their redacted cause in the result instead of reporting only an unknown cleanup state.

Windows cleanup terminates the recorded browser tree before its parent tree to avoid overlapping `taskkill /T` races. Both roots are attempted under a shared deadline, reserving time for the second command. If scheduling exhausts the deadline, the remaining attempt gets a positive 1ms timeout; zero would disable the subprocess timeout. Missing proxy metadata requires checking its parent, because Windows can also report `ENOENT` when that parent is a file. An absent temporary directory remains valid; inaccessible metadata fails closed.

Recovery persists fixed diagnostic reasons for the command, proxy and browser stages; arbitrary exception messages are not published because recovery has no model credential context. An empty successful Windows ownership query is accepted only after confirming the PID has exited; a live mismatched process is never terminated.

## Alternatives considered

**Disable unsafe-type lint rules.** This hides unresolved types and actual unsafe operations together. Discoverable projects provide the existing rules their intended inputs.

**Skip Windows browser tests.** This leaves supported cleanup and ownership behavior unverified. Platform-specific fixture assertions preserve the same observable guarantees.

**Retry silent recovery failures.** Child diagnostics are necessary to distinguish infrastructure failures from cleanup defects. A local pass alone is insufficient evidence for hosted CI.

## Consequences

Lint can resolve package tests without adding them to production declarations. The root typecheck command still checks production and tooling projects, not every package test independently. Full cross-platform CI remains necessary; test and coverage success on one machine does not establish hosted Windows or macOS behavior.
