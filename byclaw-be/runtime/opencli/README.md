# ByKC OpenCLI Runtime

This directory declares the OpenCLI dependency used by `byclaw-be` for platform-side ByKC ecosystem collection.

OpenCLI is a CLI runtime, not a user-installed prerequisite. In test and deployment environments it is installed into the `byclaw-be` image and executed by `OpenCliRunner` for server-side adapters such as public web, API/token, local CLI, and IMAP collection.

`byclaw-be` discovers OpenCLI capabilities dynamically with `opencli list -f json`. OpenCLI `read` commands are exposed as runtime virtual ecosystem capabilities and routed by command strategy. There is no persisted `bykc_ec_connector` capability table; the legacy table is dropped during the ByKC ecosystem schema setup.

QQ Mail and generic IMAP are also exposed as runtime virtual mail capabilities: QQ Mail uses the Browser Bridge mailbox action, while IMAP uses the server-side mail collector. They are not OpenCLI built-in mail adapters and should not be described that way.

Browser-login collection is handled by the ByClaw Browser Bridge extension. Users do not need to install or run OpenCLI locally; they only bind the Browser Bridge, open the target site in Chrome, and sign in when the plan asks for browser session access.

## Image Install Location

The `byclaw-be` Dockerfile installs this package into:

```bash
/opt/byclaw/opencli
```

The expected environment variables are:

```bash
BYKC_OPENCLI_BIN=/opt/byclaw/opencli/node_modules/.bin/opencli
BYKC_OPENCLI_WORKDIR=/opt/byclaw/opencli
BYKC_OPENCLI_TIMEOUT_SECONDS=120
BYKC_OPENCLI_CAPABILITY_REFRESH_MS=600000
BYKC_OPENCLI_CAPABILITY_REFRESH_INITIAL_DELAY_MS=20000
```

## Local Development

If OpenCLI is installed globally on a development machine, point `BYKC_OPENCLI_BIN` to that executable and set `BYKC_OPENCLI_WORKDIR` to any writable working directory.

To use the project-local runtime instead:

```bash
cd byclaw-be/runtime/opencli
pnpm install --frozen-lockfile
```

Then configure:

```bash
BYKC_OPENCLI_BIN=./byclaw-be/runtime/opencli/node_modules/.bin/opencli
BYKC_OPENCLI_WORKDIR=./byclaw-be/runtime/opencli
```

Do not commit `node_modules`, collection output, browser profiles, cookies, tokens, or other user data.
