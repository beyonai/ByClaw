# Agent Note: the service kind and its retreat

Status: implemented

## Problem

A static site switches atomically: the previous release keeps serving until one
rename replaces it, so any failure before that leaves the world untouched and
"try again" is always the right advice.

A container has no such switch. Once `docker compose up -d` runs on a new tag,
the previous container is gone. If the new one does not come up, the service is
**down** — and the failure the caller reads has to distinguish that from the
cases where nothing is wrong, because the next step is completely different:
page someone, or fix a build and retry.

Configuration had a second, smaller problem. `static` had claimed the top level
of `Config` (`remoteWebRoot`, `baseUrl`, …), and a container kind shares none of
those fields.

## Decision

**A release is an image tag; the pointer to it is one line of `.env`.**

```
<image>:<releaseId>       the version, in the host's image store
<composeDir>/.env         the pointer, read by `docker compose up -d`
```

That mirrors the static kind's release directory and served symlink, and it is
why this driver never writes `docker-compose.yml`: the compose file is the
operator's, and the plugin owns only the variable it interpolates. Preflight
refuses a compose file that does not reference that variable, because deploying
would otherwise not change what runs. The `.env` rewrite is line-preserving —
that file routinely holds database URLs and secrets.

**A failed switch retreats, and says which of three things happened.**

```
recovered  the previous release is serving again and healthy
unhealthy  it was restored but is NOT answering — the service is down
none       nothing was ever deployed, so there was nothing to return to
```

`unhealthy` is the one that needs a human, and `none` is a normal first-deploy
failure with nothing broken. Collapsing them into one "deploy failed" would
hide the only distinction that changes what the caller should do next. A
**rollback** deliberately does not retreat: the caller named that release, and
switching back and forth would leave the service flapping while hiding which
version is actually broken.

**`save` and `load` are separate commands, never one pipe.** Commands run
through `sh -c`, `pipefail` is not POSIX, and a pipe reports only the last
command's status — a failed `save` would surface as an ambiguous `load` error
instead of a failure attributed to its own step.

**Configuration is grouped under `drivers`, one opaque section per kind.** The
core hands a section to its kind, which validates it, exactly as it hands over
the manifest fields it does not own.

## What the type system decided

The grouping was first written with each section typed in the schema. It did
not survive contact: schemastery types an object member by its output and
validates a nested default through its member schemas, so an "optional section"
needed a cast asserting a runtime behaviour the schema did not have — the
`.default({})` was still validated as a full `static` section.

Making sections opaque removed both casts and put config validation beside the
manifest validation it already resembles. The push-back found the better design.

## Alternatives considered

**A pipe for the image transfer.** Rejected for the `pipefail` reason above;
the cost is a temporary archive on each side, cleaned up in a `finally` and
downgraded to a warning when cleanup fails.

**Blue/green or rolling deploys.** Rejected: they would make the rollback class
`atomic`-ish, but only with a load balancer and a second container this
deployment does not have. An honest `disruptive` beats a half-implemented
zero-downtime claim.

**Generating the `Dockerfile` from the driver.** Rejected — that is judgement
(base image, build stages, health check), and the driver is the deterministic
hand. The bundled skill writes them instead, behind an explicit approval gate,
following the `testenv-author` precedent.

**Retreating again when a rollback fails.** Rejected: it converts one bad
release into a restart loop and obscures which version broke.

## Consequences

The seam held. `static` transfers files with `rsync` and switches with a symlink
rename; `service` ships an image and rewrites one line of `.env`. Same closed
phase vocabulary, no shared code, and no branch in the core — which is the
evidence the seam is real rather than a name for the first driver's structure.

Adding this kind did change one seam type: `DeployRun` now exposes the
configured deadlines, because a local image build is a build and holding it to
the remote deadline would kill it partway.

The cost is a fake `docker` in the test suite that keeps an image store, a
`.env`, and a container record on disk. It is more machinery than the static
kind's fake `ssh`, and it is what lets the three retreat outcomes be tested as
sequences rather than asserted as strings.
