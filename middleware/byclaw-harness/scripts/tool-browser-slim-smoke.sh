#!/usr/bin/env bash
# Real browser/desktop acceptance. Uses only its own disposable container.
set -euo pipefail
image=${1:?usage: tool-browser-slim-smoke.sh IMAGE}
here=$(cd "$(dirname "$0")" && pwd)
fixture="$here/../plugins/dsh-browser-use/scripts/vnc-isolation-integration.mjs"
container=$(docker run -d --network none --shm-size=512m \
    -e BYCLAW_TOOL_ENV_SEED_GENERATE=1 "$image")
cleanup() { docker logs "$container" >&2; docker rm -f "$container" >/dev/null; }
trap cleanup EXIT
for attempt in $(seq 1 60); do
    if docker exec "$container" test -S /run/byclaw-browser/browserd.sock; then break; fi
    sleep 1
done
docker exec "$container" test -f /run/byclaw-browser/broker.secret
# A real TCP byCLI client must activate the lazy supervisor, as BE does.
docker exec -i "$container" python3 - <<'PY'
import socket
with socket.create_connection(('127.0.0.1', 19825), timeout=5):
    pass
PY
for attempt in $(seq 1 90); do
    if docker exec "$container" test -f /run/byclaw-browser/browserd.sock.activated; then break; fi
    sleep 1
done
docker exec "$container" test -f /run/byclaw-browser/browserd.sock.activated
docker exec "$container" curl -fsS http://127.0.0.1:8081/ >/dev/null
docker exec -i "$container" bash -s <<'CHECK'
set -euo pipefail
cat >/tmp/browser-headless-smoke.cjs <<'JS'
const assert = require('node:assert/strict');
const { chromium } = require('/opt/nvm/current/lib/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.BYCLAW_BROWSER_EXECUTABLE_PATH});
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>headless-smoke</title><h1>Headless screenshot</h1>');
    assert.equal(await page.title(), 'headless-smoke');
    const png = await page.screenshot();
    assert.equal(png.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
    console.log('Headless Chromium screenshot OK');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
JS
chmod 0644 /tmp/browser-headless-smoke.cjs
timeout 30 su -s /bin/sh byclaw -c 'node /tmp/browser-headless-smoke.cjs'
cat >/tmp/browser-native-smoke.mjs <<'JS'
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { BrowserBrokerClient } from '/opt/byclaw/dsh-managed/profiles/web/node_modules/@byclaw/dsh-browser-use/lib/broker-client.js';
const fixture = createServer((request, response) => response.end('<!doctype html><title>base-browser-native</title><button type="button" aria-label="Smoke action" onclick="document.title=\'clicked\'">Run</button>'));
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const client = new BrowserBrokerClient({socketPath:'/run/byclaw-browser/browserd.sock', secret:(await readFile('/run/byclaw-browser/broker.secret','utf8')).trim()});
const lease = {leaseId:'base-smoke', capability:randomBytes(24).toString('hex')};
const signal = () => AbortSignal.timeout(30000);
try {
  await client.open(lease, {startUrl:`http://127.0.0.1:${fixture.address().port}`, allowedDomains:['127.0.0.1'], viewerSessionId:'base-smoke'}, signal());
  assert.equal((await client.probe(lease, signal())).title, 'base-browser-native');
  const button = (await client.inspect(lease, signal())).elements.find(entry => entry.name === 'Smoke action');
  assert(button, 'native inspect must find the actionable button');
  await client.act(lease, {kind:'click', element:button.index}, signal());
  assert.equal((await client.probe(lease, signal())).title, 'clicked');
  const screenshot = await client.screenshot(lease, {}, signal());
  assert(screenshot.size > 0 && (await stat(screenshot.path)).size === screenshot.size);
  assert.equal((await readFile(screenshot.path)).subarray(0,8).toString('hex'), '89504e470d0a1a0a');
  console.log('Native supervised browser open/inspect/action/screenshot OK');
} finally {
  await client.closeLease(lease, signal()); client.dispose(); fixture.closeAllConnections(); fixture.close();
}
JS
chmod 0644 /tmp/browser-native-smoke.mjs
timeout 60 su -s /bin/sh byclaw -c 'node /tmp/browser-native-smoke.mjs'
timeout 30 su -s /bin/sh byclaw -c 'bycli doctor --json'
CHECK
# Reuse the existing full RFB/WebSocket isolation test against the shipped libs.
docker cp "$fixture" "$container:/tmp/vnc-isolation-integration.mjs"
docker exec "$container" python3 -c 'from pathlib import Path; p=Path("/tmp/vnc-isolation-integration.mjs"); p.write_text(p.read_text().replace("../lib/", "/opt/byclaw/dsh-managed/profiles/web/node_modules/@byclaw/dsh-browser-use/lib/"))'
docker exec --user byclaw -e BYCLAW_RUN_VNC_INTEGRATION=1 "$container" node /tmp/vnc-isolation-integration.mjs
echo 'BYCLAW_BROWSER_SLIM_SMOKE_OK'
