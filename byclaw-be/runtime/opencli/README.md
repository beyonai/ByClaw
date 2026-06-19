# ByKC OpenCLI Runtime

This directory declares the OpenCLI dependency used by `byclaw-be` for ByKC ecosystem collection.

OpenCLI is a CLI runtime, not a long-running middleware service. In test and deployment environments it is installed into the `byclaw-be` image and executed by `OpenCliRunner`.

## Image Install Location

The `byclaw-be` Dockerfile installs this package into:

```bash
/opt/byclaw/opencli
```

The expected environment variables are:

```bash
BYCLAW_OPENCLI_BIN=/opt/byclaw/opencli/node_modules/.bin/opencli
BYCLAW_OPENCLI_WORKDIR=/opt/byclaw/opencli
BYCLAW_OPENCLI_PROFILE=
BYCLAW_OPENCLI_TIMEOUT_SECONDS=120
```

`BYCLAW_OPENCLI_PROFILE` is optional. Set it only when the host running `byclaw-be` has a connected Browser Bridge profile alias, for example:

```bash
opencli profile list
opencli profile rename <contextId> bykc-test
```

Then configure:

```bash
BYCLAW_OPENCLI_PROFILE=bykc-test
```

For server-only or public web collection, keep it empty.

## Local Development

If OpenCLI is installed globally on a development machine, point `BYCLAW_OPENCLI_BIN` to that executable and set `BYCLAW_OPENCLI_WORKDIR` to any writable working directory.

To use the project-local runtime instead:

```bash
cd byclaw-be/runtime/opencli
pnpm install --frozen-lockfile
```

Then configure:

```bash
BYCLAW_OPENCLI_BIN=./byclaw-be/runtime/opencli/node_modules/.bin/opencli
BYCLAW_OPENCLI_WORKDIR=./byclaw-be/runtime/opencli
```

Do not commit `node_modules`, collection output, browser profiles, cookies, tokens, or other user data.
