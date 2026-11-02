# @byclaw/dsh-codegraph

English | [中文](README.zh.md)

This private DSH workspace plugin owns the CodeGraph runtime capability. Its bundle mounts `@deepseek-ai/dsh-mcp-client` as `codegraph-mcp` and registers a global CodeGraph system-prompt section inherited by root and delegated Agents. The supported CodeGraph version and MCP tool surface are declared in `package.json` under `dsh.codegraph`; CodeGraph 1.6.0 exposes `codegraph_explore` by default.

## Installation

Copy this directory to `<deepseek-harness>/plugins/dsh-codegraph`, then run:

```sh
cd /path/to/deepseek-harness
pnpm install
pnpm --filter @byclaw/dsh-codegraph run verify
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-codegraph
dsh --profile web --dump-config
```

The effective tree must contain `codegraph-mcp` and `dsh-codegraph`. The default MCP command is `codegraph serve --mcp`; set `CODEGRAPH_COMMAND` when the executable is not on `PATH`, or override the complete `codegraph-mcp.config` in the profile patch. The bundle explicitly passes `CODEGRAPH_MCP_TOOLS=explore`, so an ambient environment override cannot make the registered tool surface drift from the plugin contract.

The policy requires every CodeGraph call to pass the Agent's authoritative current-runtime cwd as `projectPath`. The MCP process cwd is not a project selection mechanism. Set `CODEGRAPH_MCP_CWD` to a neutral directory such as `/` in a container to avoid scanning the DSH installation directory for a default project; per-call `projectPath` selection continues to work normally. If the MCP process cannot start or synchronize tools, plugin loading fails rather than leaving a misleading prompt without tools.

`Dockerfile.base` declares and validates its installed version through `ARG CODEGRAPH_VERSION`. During the extension-image build, `verify:runtime` compares the inherited `codegraph --version` with the plugin manifest, performs a real MCP initialization, and requires `tools/list` to match the declared tool surface exactly. A mismatch therefore stops the image build. Upgrade CodeGraph only by updating the Docker argument, plugin contract, policy, and expected MCP surface together.

## Tool environment

DSH's MCP stdio transport spawns its server with the MCP SDK on this host, not through `ctx.subprocess`, so the `codegraph-mcp` row always runs CodeGraph where DSH runs. When the workspace lives in a separate tool sandbox, disable that row and set `workspaceOnToolEnvironment: true` on `dsh-codegraph` together with a private `stateDir`. The plugin then starts `command args` (default `codegraph serve --mcp`, in `cwd`, default `/by`) through `ctx.subprocess` for every MCP connection, and mounts its own `codegraph` MCP client, which reaches that process through `bridge/stdio-socket.mjs` and a `0600` Unix socket in `stateDir`. The tool name is unchanged. The server's open streams keep the tool sandbox awake for as long as the context runs, and `codegraph` must be installed in the tool sandbox image.

On a tool environment a CodeGraph server runs only while calls arrive: the plugin keeps the client's MCP session itself, ends the server after `idleMs` (default 120000) without a request so its streams stop keeping the tool sandbox from pausing, and starts the next one on demand, replaying the handshake to it. The server's answers to the handshake (`server/discover`, `initialize`, `tools/list`) are cached in `stateDir`, keyed by the server command and this host's copy of the executable, so a context registers the tool without starting the tool sandbox; a server that introduces itself differently refreshes the cache.

## Verification

```sh
pnpm --filter @byclaw/dsh-codegraph run verify
pnpm --filter @byclaw/dsh-codegraph run verify:runtime
```

`verify` builds the plugin, checks its manifest contract, patch configuration, and generated policy, runs isolated runtime-verifier fixtures, and runs the tool-environment route against a fake server through the local subprocess provider. `verify:contract` performs only the contract checks against existing build output, which lets image builds avoid compiling the plugin twice. `verify:runtime` requires the declared CodeGraph binary on `PATH` (or in `CODEGRAPH_COMMAND`) and checks its version and live MCP tool list using the environment declared by the patch. An end-to-end capability prompt should contain only the business request. Inspect DSH session events afterward to confirm the Agent selected `mcp__codegraph__codegraph_explore` autonomously.
