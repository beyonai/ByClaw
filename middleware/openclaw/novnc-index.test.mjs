import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./novnc-index.html', import.meta.url), 'utf8');
const match = source.match(/function getWsUrl\(\) \{[\s\S]*?\n    \}/);

assert.ok(match, 'getWsUrl function should exist');

const getWsUrl = new Function('window', `${match[0]}; return getWsUrl();`);
const websocketUrl = getWsUrl({
  location: {
    pathname: '/v1/sandboxes/sandbox-id/proxy/8081',
    protocol: 'http:',
    host: 'sandbox.example:9005',
    search: '?token=sandbox-token&autoconnect=true&resize=scale',
  },
});

assert.equal(
  websocketUrl,
  'ws://sandbox.example:9005/v1/sandboxes/sandbox-id/proxy/8081/websockify?token=sandbox-token',
);
