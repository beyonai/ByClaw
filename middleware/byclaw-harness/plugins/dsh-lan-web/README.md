# @byclaw/dsh-lan-web

[中文](README.zh.md) | English

This opt-in DSH profile bundle enables the existing `dsh web --host 0.0.0.0` command. It replaces only the shipped Web command-line provider; DSH still owns the HTTP server, LAN-address discovery, trusted-host checks, browser sessions, API transport, and WebSocket authentication unless ByClaw's explicit no-auth switch is enabled.

## Install

Build the package from the DSH workspace, then add it to the `web` profile:

```sh
pnpm --filter @byclaw/dsh-lan-web run build
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-lan-web
```

Start the GUI on every IPv4 interface:

```sh
dsh web --host 0.0.0.0 --no-open
```

DSH prints its loopback launch URL and one LAN URL. Open the LAN URL from another device. The URL contains the active launch token unless `BYCLAW_DSH_WEB_AUTH_ENABLED=false`. `--port` and repeatable `--trusted-host` retain their shipped behavior.

## Authentication

By default, the LAN bundle does not disable DSH authentication. The launch URL exchanges its one-time process token for a signed browser-session cookie; Host/Origin checks and API/WebSocket authentication remain active.

When `@byclaw/dsh-integration` is installed, `BYCLAW_DSH_WEB_AUTH_TOKEN` may expose a fixed public launch token. Set the following variable to disable token and signed-cookie authentication for the Web UI, HTTP API, and WebSocket:

```sh
BYCLAW_DSH_WEB_AUTH_ENABLED=false
```

The switch defaults to enabled and accepts `true/false`, `1/0`, `on/off`, or `yes/no`. With `false`, startup prints a token-free URL and trusted LAN clients can connect directly. Host/Origin rejection remains active.

## Security

The server uses plain HTTP rather than TLS. With authentication enabled, any LAN user who obtains the launch token and receives a session cookie can invoke the dsh APIs and execute the tools granted to that profile. With `BYCLAW_DSH_WEB_AUTH_ENABLED=false`, every client admitted by the Host/Origin checks can do so without a token. Use the all-interface bind only on a trusted, isolated network; prefer an authenticated TLS reverse proxy, VPN, or SSH forwarding on untrusted networks. Startup prints warnings for the all-interface bind and the no-auth mode.

## Development

```sh
pnpm --filter @byclaw/dsh-lan-web run test
pnpm --filter @byclaw/dsh-lan-web run typecheck
pnpm --filter @byclaw/dsh-lan-web run build
```
