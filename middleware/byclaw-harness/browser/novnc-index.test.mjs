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
    search: '?token=sandbox-token&sessionId=%E4%BC%9A%E8%AF%9D-A&autoconnect=true&resize=scale',
  },
});

assert.equal(
  websocketUrl,
  'ws://sandbox.example:9005/v1/sandboxes/sandbox-id/proxy/8081/websockify?token=sandbox-token&sessionId=%E4%BC%9A%E8%AF%9D-A',
);

assert.equal(getWsUrl({
  location: { pathname: '/', protocol: 'http:', host: 'localhost:8081', search: '' },
}), 'ws://localhost:8081/websockify?');

assert.match(source, /get\('hideHeader'\)/, 'noVNC page should support the hideHeader query parameter');
assert.match(source, /classList\.add\('embed'\)/, 'hideHeader should enable the headerless layout');
assert.match(
  source,
  /<div class="sidebar-wrap collapsed" id="sidebarWrap">/,
  'noVNC sidebar should start collapsed',
);
