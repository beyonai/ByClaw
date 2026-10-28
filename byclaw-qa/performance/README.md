# Shared Harness WebSocket load test

Requires Node.js 22+ and an explicitly authorized test environment with ten distinct real users. The script uses the BE WebSocket endpoint, never the Harness chat endpoint. Configure the shared pool hardware/capacity and the `BYCLAW_SHARED_DSH_HOST_USERS` allowlist through the administration APIs before running.

Wait until the pod is Ready, all ten user mappings are ACTIVE on that one host, and all ten corresponding Framework Workers have completed registration (`worker-ready`). Verify live host health still reports the ten contexts ready immediately before launching the runner. Record these checks with the results. A successful login response alone is insufficient: login starts allocation asynchronously. The runner assumes this external readiness gate has passed and does not provision sandboxes.

Provide a mode-0600 JSON file outside the repository containing ten entries shaped as `{"id":123,"token":"<short-lived user JWT>"}`. Each token must represent that user's actual identity and permissions. Do not copy an administrator's claims to test accounts. Select offline users, preserve existing login state, and only remove test credentials if they still match after the run. Never commit credentials or raw server logs.

```bash
node --test byclaw-qa/performance/shared-websocket-load.test.mjs
node byclaw-qa/performance/shared-websocket-load.mjs \
  /private/path/users.json /private/path/new-run-directory \
  ws://127.0.0.1:28082/byaiService/ws
```

The runner opens all ten connections before sending the first round, maintains six-second heartbeats, and runs four synchronized rounds: first new session, warm new session, followup on that session, and another new session. Requests ask for a unique per-request marker without tools or writes. A pass requires a correlated `finalAnswer` with the expected marker and no other user's marker. It stops after a failing round. Measure cold login/allocation separately from these post-registration chat rounds.

Output includes request/session/trace IDs, first answer latency, final answer latency, and nearest-rank p50/p95/max. Connection and request timeouts are 30 and 240 seconds. All ten handshakes must succeed; the process exits nonzero unless all forty responses pass. No automatic retries hide failures. A transport completion event alone is not considered a successful answer.

Collect BE `chat_chain` and platform allocation logs alongside Kubernetes CPU/memory metrics. Confirm all ten users occupy one host with the intended image digest, resource requests/limits and capacity. Record login initialization, pod provisioning and user-context startup separately. These short text requests validate concurrency and routing; they do not establish capacity for long generations, tool execution or digital-employee delegation. Output directories contain test identities/session references and should remain private.

For server capacity measurements, run the client on the BE host or through a dedicated WebSocket tunnel. Do not transfer large diagnostic logs over the same SSH connection during timed requests; collect logs after the rounds. Report the client location and distinguish end-to-end network latency from server dispatch and model timings.
