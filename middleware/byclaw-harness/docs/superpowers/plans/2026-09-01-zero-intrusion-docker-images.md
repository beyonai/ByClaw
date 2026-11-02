# Zero-Intrusion Docker Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a reusable pristine DSH base image and a derived image that automatically installs every packaged business bundle from `/home/byclaw/.dsh/plugins`.

**Architecture:** The base image contains only the shared toolchain and a Git-sourced DSH build. The extension image builds plugins in a disposable DSH copy, packs them to remove runtime `workspace:` protocols, then starts again from the pristine base and registers discovered bundles through the official DSH CLI.

**Tech Stack:** Dockerfile/BuildKit, Debian, Bash, jq, pnpm 11, DSH CLI, Podman-compatible container builds.

**Spec:** `docs/superpowers/specs/2026-09-01-zero-intrusion-docker-images-design.md`

## Global Constraints

- Do not modify `Dockerfile`.
- `Dockerfile.base` must not copy or reference ByClaw plugins, builtin assets, plugin scan paths, or business profile registration.
- DSH source comes from `DSH_REPOSITORY` and `DSH_REF`, not the local sibling checkout.
- Build-time discovery registers every immediate plugin directory whose manifest declares a non-empty `dsh.bundle.patch`.
- Runtime startup performs no plugin installation.
- Preserve the existing pinned tool versions and the pinned external `dsh-plugin` version.

---

### Task 1: Make the Base Image Pristine

**Files:**
- Modify: `Dockerfile.base`

**Interfaces:**
- Consumes: `DSH_REPOSITORY`, `DSH_REF`, and the pinned toolchain build arguments.
- Produces: an image tagged by the caller, with built DSH at `/workspace` and no business plugin state.

- [ ] **Step 1: Run the failing purity assertion**

Run:

```bash
if rg -n 'plugins/\*|/home/byclaw/\.dsh/plugins|COPY .*plugins|builtin|dsh plugin' Dockerfile.base; then exit 1; fi
```

Expected: FAIL because the current file modifies `pnpm-workspace.yaml` for `plugins/*`.

- [ ] **Step 2: Remove business workspace preparation**

Delete the `plugins/*` insertion from `Dockerfile.base`. Keep the clone, native DSH workspace file, install, and build commands unchanged.

- [ ] **Step 3: Re-run the purity assertion**

Run the Step 1 command.

Expected: exit 0 with no matching output.

### Task 2: Build Plugins Outside the Final DSH Workspace

**Files:**
- Modify: `Dockerfile.extensions`

**Interfaces:**
- Consumes: `BASE_IMAGE`, repository `plugins/`, and `DSH_PLUGIN_VERSION`.
- Produces: packed bundle archives with normal version dependencies and no final reference to the disposable build workspace.

- [ ] **Step 1: Run the failing stage assertion**

Run:

```bash
rg -n '^FROM .* AS plugin-builder|pnpm pack|FROM .* AS runtime' Dockerfile.extensions
```

Expected: FAIL because the current file has one extension stage and no pack boundary.

- [ ] **Step 2: Add a disposable plugin-builder stage**

Create `plugin-builder` from `BASE_IMAGE`, copy `/workspace` to `/tmp/dsh-plugin-build`, copy repository plugins to `/tmp/dsh-plugin-build/plugins`, and add `plugins/*` only to that temporary workspace manifest.

- [ ] **Step 3: Discover and build bundle packages**

Use `jq -e '.dsh.bundle.patch | type == "string" and length > 0'` on immediate plugin manifests. Build selected package names with one recursive pnpm invocation so workspace dependency ordering is preserved. Keep repository-level `verify` and `test` suites in CI because they may require Git metadata or mutable filesystem timestamp behavior unavailable during an image build.

- [ ] **Step 4: Pack discovered bundles**

Run `pnpm --filter <package-name> pack --pack-destination /tmp/byclaw-plugin-packs` for every discovered bundle. Also run `pnpm pack dsh-plugin@${DSH_PLUGIN_VERSION}` into the same destination. Fail if no archives are produced.

- [ ] **Step 5: Re-run the stage assertion**

Expected: all three patterns are present.

### Task 3: Auto-Install and Register Packed Bundles

**Files:**
- Modify: `Dockerfile.extensions`

**Interfaces:**
- Consumes: packed archives from `plugin-builder`.
- Produces: `/home/byclaw/.dsh/plugins/<encoded-package>/package.json` and a web profile whose bundle list contains every discovered package.

- [ ] **Step 1: Add a clean final stage**

Start the final stage from `BASE_IMAGE`, not from `plugin-builder`, and copy only packed plugin archives from the builder.

- [ ] **Step 2: Expand and validate package directories**

For each archive, extract `package/`, validate non-empty `.name` and `.version`, encode the name as a unique directory, and reject duplicate names. Copy the package directory to `/home/byclaw/.dsh/plugins`.

- [ ] **Step 3: Initialize the profile and map local packages**

Initialize the web profile through `pnpm dsh plugin --profile web list`. Add workspace `overrides` entries mapping every discovered local package name to its `file:` directory so bundle-to-bundle dependencies do not require a published registry copy. Inherit DSH's reviewed `allowBuilds` policy for profile installation.

- [ ] **Step 4: Register every bundle**

Scan immediate plugin manifests, collect `file:` paths for manifests with `dsh.bundle.patch`, fail on an empty set, and call `pnpm dsh plugin --profile web add` once with all collected paths.

- [ ] **Step 5: Verify registration and composition**

Compare each discovered package name against `.dsh.profile.bundles` in the profile manifest and run `pnpm dsh --profile web --dump-config` successfully.

- [ ] **Step 6: Add builtin and entrypoint**

Copy builtin assets and `docker-entrypoint.sh`, set permissions and ownership, switch to `USER byclaw`, and retain `CMD ["web"]`.

### Task 4: End-to-End Container Verification

**Files:**
- Verify: `Dockerfile.base`
- Verify: `Dockerfile.extensions`
- Verify unchanged: `Dockerfile`

**Interfaces:**
- Consumes: a Docker- or Podman-compatible container engine.
- Produces: build logs and image inspection evidence.

- [ ] **Step 1: Parse both Dockerfiles**

Run:

```bash
npx --yes dockerfilelint Dockerfile.base Dockerfile.extensions
```

Expected: no syntax errors; a variable-backed `FROM` tag warning may be reported by the legacy linter.

- [ ] **Step 2: Build the base image**

Run:

```bash
podman build --format docker --layers -f Dockerfile.base -t localhost/byclaw/dsh-base:e2e .
```

Expected: exit 0. If the existing Alibaba Cloud proxy check reproduces the known Podman ARM native-dependency crash, report it and run the same original-Dockerfile target to prove environmental parity.

- [ ] **Step 3: Build the extension image**

Run:

```bash
podman build --format docker --layers -f Dockerfile.extensions --build-arg BASE_IMAGE=localhost/byclaw/dsh-base:e2e -t localhost/byclaw/dsh:e2e .
```

Expected: exit 0 and successful automatic registration.

- [ ] **Step 4: Inspect image separation**

Run base and extension containers to assert the plugin directory is absent from the base and populated in the extension. Read the web profile manifest and verify every discovered bundle is registered.

- [ ] **Step 5: Smoke the final entrypoint**

Run the final image with `--help` and confirm the DSH CLI exits 0 without starting the web server.

- [ ] **Step 6: Verify the original Dockerfile diff**

Run `git diff -- Dockerfile` and compare it with the pre-task user-owned ten added lines; do not stage or change it.
