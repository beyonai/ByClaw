import { primarySandboxEndpoint, sandboxEndpoints } from '../endpointUtils';

test('separates named URLs and ignores non-string JSON metadata', () => {
  expect(sandboxEndpoints('{"vnc":"https://example.com/vnc","port":8080,"config":{}}')).toEqual([
    { key: 'vnc', value: 'https://example.com/vnc', href: 'https://example.com/vnc' },
  ]);
});

test.each([
  'javascript:alert(1)',
  'data:text/html,unsafe',
  '//other.example/path',
  '/\\other.example/path',
  'tcp://db:5432',
])('does not make unsafe or non-browser address %s clickable', (address) =>
  expect(primarySandboxEndpoint(JSON.stringify({ endpoint: address }))).toBeUndefined()
);

test.each(['{broken json', '["https://example.com"]', 'null', ''])(
  'handles malformed or unsupported value %s',
  (value) => {
    expect(sandboxEndpoints(value)).toEqual([]);
  }
);

test('preserves OpenClaw gateway override without modifying the VNC or byCLI URL', () => {
  const value = JSON.stringify({ openclaw: '/proxy/chat?token=fixture', vnc: 'https://example.com/vnc' });
  const entries = sandboxEndpoints(value, 'openclaw');
  expect(new URL(entries[0].href!).searchParams.get('gatewayUrl')).toBe(`ws://${window.location.host}/proxy`);
  expect(entries[1].href).toBe('https://example.com/vnc');
  expect(primarySandboxEndpoint(value, 'byclaw-dsh')).toBe('/proxy/chat?token=fixture');
});
