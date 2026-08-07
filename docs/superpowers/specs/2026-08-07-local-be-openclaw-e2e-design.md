# Local BE and OpenClaw End-to-End Test Design

## Goal

Build an isolated local environment that reproduces the production connector authorization path from ByClaw BE through OpenSandbox into an OpenClaw user sandbox. Use a dedicated Feishu test application to validate OpenClaw binding, device authorization, credential persistence, and backend authorization state without reading from or writing to production infrastructure.

## Scope

The environment must validate this path:

```text
Browser
  -> local ByClaw BE
  -> local OpenSandbox API
  -> OpenClaw user sandbox
  -> /by/.connector-auth/.lark-cli
  -> dedicated Feishu test application
```

The test covers:

- user sandbox resolution and reuse;
- sandbox command execution;
- `HOME` and `LARK_HOME` injection;
- OpenClaw `channels.feishu` discovery;
- `lark-cli config bind --source openclaw --identity user-default --force`;
- Lark device authorization;
- final `auth status --json --verify` verification;
- consistency between the database authorization record and sandbox-native credentials.

The test does not cover production ingress, Kubernetes scheduling, production storage, production databases, or production Feishu applications.

## Isolation

The local environment uses dedicated names, ports, data directories, and volumes. It must not source the repository root `.env` because that file points to remote services.

Use a separate, git-ignored environment file named `.env.local-e2e`. It contains only local service endpoints and non-secret defaults. Feishu application credentials are entered interactively and stored only in the local test OpenClaw volume.

Local state is separated into:

```text
.local-e2e/
  data/opengauss/
  data/redis/
  sandboxes/
  logs/be/
  logs/opensandbox/
```

No test credential, token, cookie, application secret, or generated authorization state may be staged or committed.

## Components

### Podman

Use the running `byclaw-test` Podman machine as the default container backend. The environment must verify both client and server availability before starting services.

### OpenGauss and Redis

Run dedicated local instances. Initialize OpenGauss with the repository DDL and DML required by connector authorization and sandbox service specifications. Redis stores authorization sessions and sandbox coordination state.

### OpenSandbox

Run the repository-supported OpenSandbox service locally and expose its API on `127.0.0.1:8090`. Configure it to launch the locally built OpenClaw image and mount a user-private directory at `/by`.

### OpenClaw Image

Build from `middleware/openclaw/Dockerfile`. The image must contain `lark-cli 1.0.84`. The sandbox receives:

```text
OPENCLAW_STATE_DIR=/by/.openclaw
LARK_HOME=/by/.connector-auth/.lark-cli
USER_CODE=<test-user-code>
```

The OpenClaw template must contain a `channels.feishu` object configured from the dedicated Feishu test application before user authorization begins.

### ByClaw BE

Run the current `D0.3.1` code against local OpenGauss, Redis, and OpenSandbox. Required local overrides include:

```text
BYCLAW_SANDBOX_ENABLE=true
BYCLAW_SANDBOX_BASE_URL=http://127.0.0.1:8090
BYCLAW_SANDBOX_FILE_VOLUME_ROOT=<absolute-local-e2e-sandbox-path>
```

The local BE must use the sandbox Lark authorization runtime and the current bind command containing `--force`.

## Feishu Test Application

Use a dedicated application that is not connected to production callbacks or production event subscriptions. Configure the smallest domains needed by the connector test. Application credentials are entered locally through an interactive configuration step and written only into the test OpenClaw state.

Before user authorization, verify only the presence of the required channel fields without printing their values:

```text
channels.feishu.appId
channels.feishu.appSecret
channels.feishu.domain
```

## Authorization Flow

1. Start local middleware, OpenSandbox, and BE.
2. Create or resolve the local test user.
3. Start connector authorization through the BE API or frontend.
4. BE resolves a reusable OpenClaw sandbox for the test user.
5. BE checks Lark configuration in the sandbox.
6. On `not_configured`, BE binds the Lark workspace to the OpenClaw Feishu channel using the `user-default` identity.
7. BE starts device authorization and returns the Feishu verification URL.
8. The tester completes authorization in the browser.
9. BE completes the device flow inside the same sandbox.
10. BE verifies the user identity and persists the connector authorization record.
11. The test independently runs `auth status --json --verify` in the same sandbox and compares it with the database state.

## Failure Handling

- Missing `channels.feishu`: stop before OAuth and report a channel configuration error.
- Binding confirmation failure: capture the complete non-secret command envelope and fail with `PROVIDER_BIND_FAILED`.
- Sandbox mismatch: report both the BE-resolved sandbox ID and the inspected sandbox ID.
- Expired device code: discard the authorization session and start a new device flow.
- Database success with failed CLI verification: mark the test failed and retain local logs and volumes.
- Secrets in output: redact values before saving logs.

## Verification

The environment is ready when all of the following pass:

1. Podman client can reach the `byclaw-test` server.
2. OpenGauss and Redis health checks pass.
3. OpenSandbox can create and execute a command in an OpenClaw sandbox.
4. The sandbox reports `lark-cli version 1.0.84`.
5. `channels.feishu` contains the required field names.
6. The bind command exits successfully.
7. Device authorization completes using the dedicated test application.
8. Sandbox verification returns `verified=true` and `identity=user`.
9. The active database authorization record references the same user and connector.
10. Repeating verification reuses the same credential directory and sandbox.

## Cleanup

Provide separate stop and purge operations:

- Stop preserves local databases, logs, sandbox volumes, and credentials for diagnosis.
- Purge removes only `.local-e2e` containers, networks, and volumes after explicit confirmation.

Neither operation may touch the repository root `.env`, the existing `podman-machine-default` VM, or remote services.
