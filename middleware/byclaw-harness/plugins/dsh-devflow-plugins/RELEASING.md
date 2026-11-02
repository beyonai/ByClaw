# Releasing

Twelve packages publish together at one version, because they depend on each
other by `^<version>`: a package left behind resolves a sibling that does not
exist yet. `pnpm run set-version` moves them together and `pnpm run preflight`
refuses a workspace where they have drifted.

Releases run in CI, on npm trusted publishing. Pushing a tag is the whole
trigger; there is no credential to hold.

## Release channels

A stable version such as `0.4.0` publishes under npm's `latest` dist-tag. A
development prerelease must use the form `0.4.0-dev.0`; the release workflow
publishes it under `dev`, so a test build can install
`@zhchxiao123/dsh-devflow-bundle@dev` without changing what ordinary installs
receive.

The workflow rejects other prerelease identifiers instead of guessing a
channel. Add a deliberate mapping before introducing an `alpha`, `beta`, or
`rc` release line.

## Authentication

There is no token. Each package names this repository's `release.yml` workflow
as a **trusted publisher**, and the workflow exchanges its GitHub Actions OIDC
identity for a short-lived publish grant. Nothing long-lived is stored in the
repository or on a laptop.

That grant is bound to the repository, the workflow **filename**, and the ref.
Renaming `release.yml`, moving the publish job into another workflow, or forking
the repository all break it, and the fix is to update the trusted publisher on
each of the twelve packages first.

### How this was bootstrapped, and why it cannot repeat

npm can only configure a trusted publisher from a package's settings page,
which does not exist until the package does — [npm/cli#8544](https://github.com/npm/cli/issues/8544)
tracks the gap, and npm has no equivalent of PyPI's pending publishers. So
`0.1.0` went out on a short-lived granular token, the trusted publishers were
configured against the packages that now existed, and the token was revoked.

A **new** package added to this workspace hits the same wall: its first version
needs a token, after which it joins the others. Publish it alone rather than
reaching for a token the whole line would then depend on.

## Every release

```sh
pnpm run set-version 0.4.0-dev.0 # move all twelve together
pnpm run verify && pnpm run build && pnpm run preflight   # CI's gates, plus the registry check
git commit -am "release: 0.4.0-dev.0"
git tag v0.4.0-dev.0
git push && git push --tags
```

CI runs `preflight:tarballs`, which is this same preflight without the "already
published" lookup — that one question has no answer on a pull request, and it
is the only one that does not. Here the full form is the point: it is what
refuses to publish a version that already exists.

Pushing the tag is what publishes. `.github/workflows/release.yml` checks that
the tag names the version the packages carry, reruns typecheck, lint, tests, the
build, and the preflight, and only then runs `pnpm publish -r`. Stable tags use
`latest`; `-dev.N` tags use `dev`.

Running the gates locally first is not redundant — it is how you find out
before the tag exists, and a tag is awkward to take back.

## Publishing from a laptop

Don't. Trusted publishing is bound to the workflow, so a laptop publish needs a
token that would undo the reason for it — and npm refuses one without 2FA or a
bypass-enabled granular token anyway. Push a tag.

## What preflight is protecting you from

It reads the **tarballs**, not the working tree, because the failures that
matter are invisible from a checkout. Two of them have already happened here:

- **A manifest pointing at a file the build never produced.** Every package
  declared `main: lib/index.js` while only `lib/types/` was ever written, so a
  publish would have shipped eleven empty shells.
- **A build step deleting another's output.** tsdown's default `clean` wipes its
  `outDir`, which is the same `lib/` that `tsc -b` had just written declarations
  into — and incremental tsc, seeing its `.tsbuildinfo`, would not write them
  again. The packages would have published with no types at all.

The one it protects a *consumer* from is `devflow-ui` without `lib/client.js`:
a harness treats a `dsh.client` declaration with no bundle as fatal and refuses
to boot, so that is not a degraded install but a broken one.

It also refuses a version already on the registry. That check is why a failed
release is safe to retry: `pnpm publish -r` goes package by package and stops at
the first failure, so a half-finished release leaves the published ones alone
and the preflight tells you which those were.

## Versioning

Pre-1.0, so a breaking change bumps the minor. What counts as breaking for a
plugin line:

- a route path, WebSocket path, sidebar page id, tool name, or `/devflow`
  subcommand changing — these are what a deployment and a model have learned;
- a `Config` field losing its meaning or its default;
- the `.devflow` on-disk format changing in a way an existing journal cannot
  replay;
- the pinned harness version moving, because a plugin built against one exact
  prerelease is not guaranteed to load on another.

Bumping the harness is its own release: change the pin in every package, run
the whole chain, and say so in the release notes.

## Deferred

**Nothing.** Trusted publishing attaches provenance on its own, so the
attestation that `--provenance` would have requested comes with the OIDC path.
