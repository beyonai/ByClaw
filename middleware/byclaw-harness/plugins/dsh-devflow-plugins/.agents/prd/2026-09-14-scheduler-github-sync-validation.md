# Scheduler / GitHub Sync validation

## Runtime boundary

The acceptance script uses the npm-published `@deepseek-ai/dsh@0.1.5-rc.2` CLI (`dsh`), Node 24 and pnpm 11.24.0. The npm package `deepseek-harness@0.1.5-rc.2` does not exist; local unpublished Harness source is not substituted.

Every execution creates an isolated temporary runtime, `DSH_HOME`, profile and SQLite databases. It neither reads nor modifies the user's actual profiles. The tested providers are installed as packed tarballs using `dsh plugin --profile acceptance add`, not source imports. The custom profile starts without any agent or model provider. After background synchronization completes, the probe creates one idle real agent to exercise the published command runtime and disposes it without submitting a prompt. A loopback HTTP fixture replaces only GitHub's external API.

## Reproduce

First run the repository's required checks and `pnpm run build`. Then:

```sh
node --version # v24.x
pnpm --version # 11.24.0
node scripts/scheduler-github-profile-smoke.mjs
```

On another machine use Node 24 and set `DSH_SMOKE_PNPM` to that machine's pnpm 11.24.0 entry point. The script prints its temporary evidence directory. `DSH_SMOKE_ROOT` may name an already prepared, isolated runtime directory; every invocation creates a fresh run directory for profile, databases and result files. Do not point it at a user home or production profile.

The acceptance script:

1. Installs and verifies the exact published CLI version.
2. Packs all four definition/provider packages and installs them through CLI profile management. Unpublished intra-line dependencies are redirected to these same tarballs using overrides in the isolated pnpm 11 workspace configuration; no source import or remote publication is involved.
3. Dumps the composed profile and boots it through the published CLI.
4. Creates a subscription and interval plan through public services, without creating an agent.
5. Waits for the real background timers to complete synchronization of an Issue and its comment, excluding a PR.
6. Checks stable receipt deduplication and unchanged-content deduplication.
7. Confirms one consumer while leaving a second consumer offline.
8. Stops and restarts the CLI against the same databases, verifies persisted plans and independent cursors, and replays historical versions.
9. Exercises `/scheduler` and `/github-sync` through the real commands runtime and real idle agent/session.
10. Confirms that the fixture received only GET requests.

The probe is an acceptance-only downstream consumer. It must not be loaded into a real profile. It provides neither issue evaluation nor Devflow development automation.

## Evidence

Prepared environment on 2026-09-14: `/tmp/dsh-scheduler-github-profile.FNblU0`.

- Published CLI installation completed successfully; `dsh --version` printed `0.1.5-rc.2`.
- `node --check` passed for the acceptance script and probe.
- A separate published CLI protocol probe successfully created and disposed an idle agent through the real registry, with exit 0 and no model/provider credentials.
- Built tarball profile execution passed after the final source freeze and full build. The final fresh run is `/tmp/dsh-scheduler-github-profile.FNblU0/run-D8kNyt`.
- First boot: one completed scheduled trigger, two snapshots (Issue and comment), two changes, stable receipt deduplication and no unchanged-content duplication. Seven real slash commands returned success through the published command runtime. No prompt or model call was submitted.
- Second boot: the plan survived; offline consumer retained two changes, the acknowledged consumer had zero pending, and explicit historical replay returned two changes.
- All fixture requests were GET; both CLI boots exited after orderly SIGTERM disposal.

Each run preserves installation/packing logs, composed-profile output, first/restart boot logs, structured first/restart results and the fixture request log. A successful CLI start alone is not sufficient: both result files must report `passed`.

## Limits

This profile probe covers published-package composition and a narrow scheduled-sync-to-consumer path. It does not replace the wider tests for Cron/DST, Discussions and replies, paging failures, credential redaction, lease fencing, capacity exhaustion and cancellation. Those results must be recorded separately by the implementation owner.

The probe exercises the public command runtime, but does not operate a browser conversation composer. Browser acceptance and a real GitHub network sync must be reported separately; fixture success must not be described as live GitHub acceptance.

## Tested artifact identity

These hashes identify the final built artifacts used by the successful profile run. They include the cancellation tombstone, scope-change/resume guard, independent lease and defensive JSON-copy fixes.

| Tarball (0.4.0-dev.7) | SHA-256 |
| --- | --- |
| dsh-github-sync | `d25fae38511b3ee673708c30e482879ce83fd4c95b9f1fbc3c51bf784740d507` |
| dsh-github-sync-local | `2e81fcc97fd983cc2e0429bff022fdf75f7a7fa5f16207e1475cdc3e438b6de1` |
| dsh-scheduler | `8853445b7ee99d18d852127b39ae3a8de4cff7508ec0d6e393fa2214df2fa095` |
| dsh-scheduler-local | `fdb2bdf30f54ed8a28ef4fdff1ff5997992f4b8d132e83edc30e9adb7a361113` |

## Repository validation and slice coverage

Final local verification on Node 24.18.0 / pnpm 11.24.0:

- Full suite: 123 files, 1,601 tests passed. The earlier bilingual-record hash failure was corrected and the full suite rerun successfully.
- Focused coverage: 137 tests passed; every source file in the four new packages reached 100% statements, branches, functions and lines (987 statements, 695 branches, 226 functions, 907 lines). No coverage exclusions were added. The final delayed-startup disposal test controls the external microtask scheduler and keeps the disposal guard exercised.
- Project and tools typechecking passed; lint passed with three pre-existing unused-disable warnings in release/discovery scripts.
- Full clean declaration, host and client build passed.
- Offline tarball preflight: all 25 packages pack cleanly at 0.4.0-dev.7. No registry publication was performed.
- Independent specification and standards reviews were completed. Confirmed JSON-copy, cancellation-retry, lease-renewal, resume-race, conversational-update and capacity-audit defects were corrected and regressed.

| Slice | Implemented behavior and evidence |
| --- | --- |
| S1, S4 | Scheduler public-service/command tests: interval and Cron/DST, management, stable delivery, retries, overlapping requests, pause/remove, time changes and restart. |
| S2, S5 | GitHub service/protocol tests: independent manual intake, pagination, PR exclusion, incremental overlap, reconciliation, historical versions, scope changes and incomplete-result handling. |
| S3 | Real Loader integration tests and packed profile: scheduled acceptance, downstream status, failure/cancellation, optional service composition and durable consumption. |
| S6 | Discussion tests: independent GraphQL topic/comment/reply pagination, edits, inaccessible connections and partial completion. |
| S7 | Durable consumer tests and exported example: ordered acknowledgement, independent positions, offline/restart/replay and duplicate-effect handling. |
| S8 | Multi-instance tests: shared concurrency, subscription FIFO, ownership generations, takeover, independently renewed leases and late-result rejection. |
| S9 | Capacity tests: atomic rollback, persistent admission block and actor audit, retained historical consumption, explicit same-receipt resume, stale or competing-run rejection. |

Full test, build, coverage, lint and preflight logs were captured under `/tmp/dsh-scheduler-github-*`; the reproducible commands and packed-runtime evidence above distinguish those checks from live GitHub or browser acceptance. The 36-story PRD and S1–S9 remain local planning records, not published GitHub issues.
