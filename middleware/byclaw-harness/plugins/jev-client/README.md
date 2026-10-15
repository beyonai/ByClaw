# Shared Jev client

Both ByClaw routers use the official TypeSafe SDK through Vercel AI Gateway. This library owns connection configuration and validates Choice responses; it owns no agent or model catalog.

Set `BYCLAW_JEV_BASE_URL=https://ai-gateway.vercel.sh/typesafe`, `BYCLAW_JEV_MODEL=typesafe-ai/jev`, and `BYCLAW_JEV_API_KEY` (or `AI_GATEWAY_API_KEY`). Requests go to `/typesafe/v1/systemone`, using the TypeSafe-compatible Choice contract. `BYCLAW_JEV_TIMEOUT_MS` defaults to 15000. No implicit TypeSafe credential fallback, SDK retries, or request/body logs are enabled. Caller cancellation rejects instead of selecting a fallback.

Official integration: https://vercel.com/changelog/ai-gateway-now-supports-typesafe-clients-and-http-api-for-jev

## Gateway connection check

From the repository root, validate the current process environment without sending requests:

```sh
node plugins/jev-client/scripts/gateway-smoke.mjs
```

The script does not load `.env` automatically. If configuration lives in a file, use Node's `--env-file=/absolute/path/to/router.env` before the script path. Use the same file/environment that starts ByClaw. Provide a Vercel AI Gateway key in `BYCLAW_JEV_API_KEY` or `AI_GATEWAY_API_KEY`; `BYCLAW_JEV_API_KEY` takes precedence. `TYPESAFE_API_KEY` is not used. No key is required for `--help`.

To explicitly send real requests through Gateway:

```sh
node plugins/jev-client/scripts/gateway-smoke.mjs --live
```

This sends two small Choice requests using fixed, synthetic data: the agent router's text state plus employee/group criteria, and the model router's structured task/requirements state plus model metadata criteria. It imports the same `selectWithJev` used by both routers. No Redis access, business prompts, model provider credentials, real agent creation, or generation-model calls are involved. The requests may incur Gateway usage. To make one request, add `--case agent` or `--case model`; the default is `--case both`.

Output is JSON Lines containing the resolved endpoint, configured JEV model, status, elapsed milliseconds, selected fixture key, confidence, and token counts when returned. The script validates the Choice response, including membership and probability distribution, before reporting success. It never prints the API key, raw request body, or provider error body. HTTP failures include a numeric `http_status`; unavailable credentials, invalid configuration, invalid responses, or failed requests exit with code 1. Invalid CLI arguments exit with code 2. A check without `--live` confirms local configuration only, not server reachability or authentication.

Successful `--live` results confirm Gateway authentication and the shared Choice protocol for these fixture shapes. They do not validate the deployed DSH runtime, candidate authorization, routing quality on business requests, or generation fallback. Those require the router/runtime checks and a user-run end-to-end test.

Offline script tests are included in `npm test` for this package; they inject a fake fetch and never contact Gateway.
