# Agent Note: Explicit npm release channels

Status: implemented

English | [中文](2026-09-01-npm-release-channels.zh.md)

## Problem

The repository publishes from any `v*` tag, and `pnpm publish` defaults to the
`latest` dist-tag. Publishing a development build with that command would make
an unvalidated Harness adaptation the default version for every consumer,
including deployments that asked only for the stable bundle.

## Decision

Package versions use their own semver line independently of the pinned Harness
version. The first development build after stable `0.3.0` is
`0.4.0-dev.0`, while every `@deepseek-ai/*` dependency remains pinned to
Harness `0.1.2-alpha.3`.

The tag-triggered release workflow maps stable versions to npm's `latest`
dist-tag and versions matching `*-dev.*` to `dev`. It rejects every other
prerelease identifier until that channel is explicitly defined. All twelve
packages still publish together at the version named by the Git tag.

## Alternatives considered

**Publish the development build under `latest`.** Rejected because it silently
changes ordinary installs from stable `0.3.0` to an explicitly provisional
build.

**Encode the Harness version as this plugin line's package version.** Rejected
because package compatibility is already expressed by exact peer dependency
pins; tying two independent release histories together forced a public version
regression from this line's existing `0.3.0`.

**Accept any npm prerelease identifier and derive its dist-tag.** Rejected
because a typo would create an unintended public channel. New channels require
an explicit workflow change.

## Consequences

Consumers can opt into current development work with
`@zhchxiao123/dsh-devflow-bundle@dev`, while `@latest` remains stable. Release
tags must follow either a stable semver or the `-dev.N` convention, and adding
an alpha, beta, or release-candidate channel now requires a small deliberate
policy change.
