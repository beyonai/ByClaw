# Weixin Login-Gate Rerun Budget Design

## Goal

Allow a browser-backed Weixin operation to return to the human verification gate after a confirmed rerun encounters authentication, CAPTCHA, or environment verification again. The operation may perform at most ten user-confirmed reruns. The initial execution does not count toward this limit.

## State Model

Replace the one-shot rerun budget with a persisted `confirmedRerunCount` in the range `0..10`.

- `waiting-confirmation`: the browser context is retained and the runner waits for an explicit statement that verification is complete.
- `confirmed-rerun`: a transient attempt kind used while executing after explicit confirmation.
- `complete`: the command succeeded.
- `terminal`: the command returned a non-verification terminal error, or the tenth confirmed rerun still encountered a human verification gate.

Persist the incremented count before launching each confirmed rerun. This preserves the retry budget if the runner is interrupted after dispatch.

## Transitions

1. The initial execution does not increment `confirmedRerunCount`.
2. If an execution reaches authentication, a login page, CAPTCHA, or environment verification, retain the current browser context and enter `waiting-confirmation`.
3. A retry-shaped message without explicit verification completion does not execute the command and leaves the state unchanged.
4. On explicit verification completion, increment `confirmedRerunCount` and execute the same operation without browser preflight.
5. If a confirmed rerun succeeds, enter `complete` immediately.
6. If a confirmed rerun returns an ordinary non-verification error, follow the existing terminal error behavior.
7. If confirmed reruns 1 through 9 encounter another human verification gate, return to `waiting-confirmation` and prompt the user again.
8. If confirmed rerun 10 encounters another human verification gate, enter `terminal`. Later retry-shaped messages must not execute another command for the same fingerprint.

## Compatibility

Existing persisted `terminal` states remain terminal and are not revived automatically.

For older non-terminal state files that contain `rerunConsumed: true` but no numeric counter, treat the state as having consumed one confirmed rerun. A missing or false legacy flag maps to zero. New state writes use the numeric counter while retaining only compatibility fields that existing consumers still require.

## Documentation

Update the Weixin reference so that:

- terminal-state precedence applies only after the tenth confirmed rerun encounters a human gate;
- the login and verification procedure describes the repeated prompt-and-wait cycle;
- references to a single rerun or a one-shot budget become a ten-rerun budget;
- retry-shaped messages still do not count as confirmation or create a new logical operation.

## Tests

Add or update focused tests that prove:

- the initial execution does not consume the confirmed-rerun budget;
- reruns 1 through 9 that encounter a human gate return to `waiting-confirmation`;
- rerun 10 that encounters a human gate becomes terminal;
- retry-shaped messages never execute the command while waiting;
- a successful rerun completes before the limit;
- ordinary non-verification errors remain terminal;
- the rerun count is persisted before command execution;
- legacy persisted state maps to the intended numeric count;
- the browser runner skips capability and bridge preflight on every confirmed rerun.
- the knowledge-collection contract test recognizes the ten-rerun terminal precedence wording.

## Scope

The change is limited to the Weixin login-gate runner, its browser-runner integration, focused and cross-cutting contract tests, and the Weixin reference. It does not change diagnostic retry budgets, rate-limit handling, authentication-source eligibility, operation fingerprinting, or partial-download reporting.
