# Zero-Intrusion Docker Image Split Design

## Goal

Build an expensive, reusable DSH base image with no ByClaw business content, then build a derived image that discovers, builds, packages, installs, and registers every bundle under `/home/byclaw/.dsh/plugins`.

## Boundaries

- `Dockerfile` and `Dockerfile.extensions` are equivalent extension-image entry points and stay byte-for-byte synchronized.
- `Dockerfile.base` clones `DSH_REPOSITORY` at `DSH_REF`, installs the shared toolchain, installs DSH dependencies, and builds DSH.
- The base image contains no ByClaw plugin source, no plugin scanning, no business profile, and no modification that adds `plugins/*` to DSH's workspace.
- `Dockerfile.extensions` owns plugins, builtin assets, the profile, and the entrypoint.
- Plugin discovery happens only during image build. Container startup performs no dependency installation or network access.

## Architecture

The extension image uses two stages. The disposable `plugin-builder` derives from the base image and adds business plugin sources directly to its inherited `/workspace`. It may modify that workspace so `workspace:*` development dependencies resolve because none of the builder filesystem is inherited by the final stage. It runs bundle builds in topological workspace order, checks the CodeGraph plugin contract and live MCP surface against the inherited binary, packs each discovered bundle, and normalizes the archives under `/opt/byclaw/plugins`. pnpm rewrites `workspace:` dependency specifications to normal versions while packing.

The final `runtime` stage starts again from the unchanged base image, copies the normalized package directories to `/home/byclaw/.dsh/plugins`, initializes the web profile, maps local business package versions to those directories, and invokes the official `dsh plugin --profile web add` path for every manifest that declares `dsh.bundle.patch`. It also includes the pinned external `dsh-plugin` package in the same plugin directory so registration follows one path.

## Discovery Rules

- Scan only immediate child directories of `/home/byclaw/.dsh/plugins`.
- A directory is registered only when `package.json` exists and `.dsh.bundle.patch` is a non-empty string.
- Invalid JSON, a missing package name/version, duplicate package names, zero discovered bundles, failed builds, failed packing, failed installation, or failed composed-config loading stops the build.
- Directory names are filesystem-safe encodings of package names; registration identity always comes from `package.json`.

## Data Flow

1. Clone and build pristine DSH from `DSH_REPOSITORY` and `DSH_REF`.
2. Start a disposable builder from the base and copy repository plugin sources into its inherited `/workspace`.
3. Discover bundle manifests, build them once, and validate the CodeGraph contract plus live MCP tool surface.
4. Pack every discovered bundle and normalize the archives under `/opt/byclaw/plugins` in the same builder.
5. Start a fresh runtime stage from the base and copy the normalized packages into `/home/byclaw/.dsh/plugins`.
6. Initialize the web profile and register every discovered bundle through the DSH CLI.
7. Dump the composed profile to prove all registered bundle layers resolve.
8. Copy builtin assets and the entrypoint, then run as `byclaw`.

## Verification

- A static contract check rejects business paths or workspace mutation in `Dockerfile.base`.
- Container builds use `Dockerfile.base`, then use its resulting tag as `BASE_IMAGE` for `Dockerfile.extensions`.
- Image inspection verifies the base has no `/home/byclaw/.dsh/plugins` and the extension does.
- Runtime inspection compares discovered bundle package names with `dsh.profile.bundles` and runs `dsh --profile web --dump-config`.
- CodeGraph verification rejects any mismatch between the base binary version, plugin manifest version, configured tool allowlist, generated policy, and live MCP `tools/list` response.
- A smoke run invokes the final entrypoint with `--help` without starting the long-running web server.
- A full runtime smoke may load an external `.env`; Redis authorization and backend runtime resolution remain external prerequisites and are reported separately from image failures.
