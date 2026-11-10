# Unity tool sandbox

`Dockerfile.tools.unity` builds on the slim-derived browser layer at `192.168.0.81:8080/byclaw/byclaw-harness-tools:D0.6.0_browser`. It adds the existing Unity Editor, Linux Player/WebGL toolchains, Hub, game bridge commands, project template, Unity skill and game desktop. It does not inherit the full historical Unity image or copy its user homes, projects, licenses, Hub sign-in or keyring state.

Build from the repository root on linux/amd64. `UNITY_DONOR_IMAGE` is required and must identify a controlled installation image by digest. The inspected donor is Editor `2022.3.62f3c1` with digest `sha256:b9e082db17b2ca04b0eb715eb80059f5c5a4e8748410ec07d5d630d58916a987`:

```bash
docker build --platform linux/amd64 \
  -f middleware/byclaw-harness/Dockerfile.tools.unity \
  --build-arg UNITY_DONOR_IMAGE='127.0.0.1:8080/byclaw/byclaw-harness-tools-unity@sha256:b9e082db17b2ca04b0eb715eb80059f5c5a4e8748410ec07d5d630d58916a987' \
  -t '192.168.0.81:8080/byclaw/byclaw-harness-tools:D0.6.0_unity' .
```

`BROWSER_IMAGE` can pin the tested browser artifact's digest on the same LAN Harbor repository. The browser layer must provide its normal SSH entrypoint at `/usr/local/bin/byclaw-dsh-entrypoint`. The Unity wrapper installs the skill into the runtime home, starts the game desktop and then executes that entrypoint. Cloud deployment may copy the resulting artifact to ACR; ACR is not the Dockerfile's default parent registry.

The business Dockerfile applies the reviewed browser supervisor after copying assets. Both unprivileged Unity startup commands remove injected SSH host/authorization key variables from their child environments, while the privileged SSH bootstrap retains its required inputs. This overlay also covers an older pinned browser parent.

The Unity desktop viewer uses `BYCLAW_UNITY_DESKTOP_PORT=8083`, X display `:1` and loopback RFB `6901`. Browser preview retains viewer `8081` and its own session displays/ports. Route each viewer through the platform's authenticated desktop ingress; do not expose raw noVNC publicly. The first Hub session starts on the visible Unity desktop, including with an empty home. After the owner signs in and supplies a valid license using Unity's supported flow, `UNITY_HUB_DISPLAY=:2` can move Hub to its hidden display while games use `:1`. No login or activation is performed during the image build. Runtime home persistence and license suitability are the owner's responsibility.

Package downloads default to `UPM_REGISTRY=https://packages.unity.cn`. This was verified in the installed 2022.3.62f3c1 PackageManager's `Server/server/app.js`: `createRegistries` checks the project registry, then `UPM_REGISTRY`, then `UPM_NPM_REGISTRY`; its built-in production endpoints are also domestic. An existing project's `Packages/manifest.json` can override that default, so keep its `registry` at `https://packages.unity.cn` and audit scoped registries, Git dependencies and tarball URLs for domestic sources before import. Preserve that registry setting in reusable project templates. This base ships the Editor/modules already installed: use Hub for supported login/licensing and provision engine/module changes through controlled image builds. No automatic engine installation is started by the entrypoint.

The inspected Hub 3.3.7 installation is the China edition. Its `app.asar` builder configuration and production cloud configuration use `https://public-cdn.cloud.unitychina.cn/hub/prod/` for Hub updates; the Editor release service defaults to `https://download.unitychina.cn/download_unity/<revision>/`. These defaults were verified from the shipped application code. Hub auto-update settings and login/licensing service endpoints are preserved.

Required acceptance checks on the actual built image:

- Use the inherited SSH runtime key injection and check A-to-B commands, file roundtrip and helper/PTC operations.
- Start from an empty writable home; confirm viewer `8083` shows Hub and the owner can complete the supported sign-in/license flow. Verify browser viewer `8081` still works independently.
- Under the owner's valid runtime license, create a project with `unity-new-project`, build/run a Linux player, query `unity-agent state`, interact with it and capture a screenshot. Confirm the installed skill/template and CJK font are available.
- Export a real scene to WebGL, serve it and load it in the inherited browser. A compiler `--version`, shared-library check or Editor startup alone does not establish successful WebGL export.
- Stop/delete only the isolated validation instance. Do not snapshot credentials, licensing state or user data into an image/template.

Build-time library and script checks are included; successful build does not establish activation, graphics, Linux Player, WebGL export or cloud readiness. Report those runtime results separately.

The slim image installs Debian `libicu76` for the Hub licensing client. This is a dynamically loaded .NET dependency: Editor version and `ldd` checks cannot prove it is present. Run `scripts/unity-browser-smoke.mjs` as `byclaw` in a disposable image with a fresh writable home and an output directory. Override the normal container entrypoint with `--entrypoint node` so this test owns the desktop lifecycle, and create its writable output directory before invocation. It starts the desktop, requires a visible Unity Hub window and a successful noVNC connection, rejects missing-ICU licensing errors, and compiles/optimizes/executes a wasm32 sample with the bundled WebGL tools. This check does not activate a license or establish a successful licensed Unity scene export.

A managed spec declaring browser `vnc` on 8081 and Unity `game-vnc` on 8083 must enable `BYCLAW_TOOL_BROWSER=1` and `BYCLAW_BROWSER_STARTUP=eager` so every advertised port is ready before acquisition.
