import { desktopKey, mergeInstanceRefs, resolveDesktop, listDesktops } from '../desktopInstances';

const a = { sandboxId: 'a', instance: 'editor' };
const rows: any[] = [
  {
    sandboxId: 'b',
    status: 'RUNNING',
    instanceEndpoints: { editor: 'https://b/vnc.html?token=x' },
    instanceDescriptors: { editor: { viewer: 'novnc' } },
  },
  {
    sandboxId: 'a',
    status: 'RUNNING',
    instanceEndpoints: { editor: 'https://a/vnc.html?sessionId=server' },
    instanceDescriptors: { editor: { viewer: 'novnc' } },
  },
];
it('resolves exact identity independent of order and preserves server routing', () => {
  expect(resolveDesktop(rows, a)?.url).toContain('https://a/vnc.html?sessionId=server');
  expect(resolveDesktop([...rows].reverse(), a)?.url).toBe(resolveDesktop(rows, a)?.url);
});
it.each(['', '&hideHeader=false'])(
  'hides the embedded viewer header while preserving server parameters: %s',
  (flag) => {
    const resolved = resolveDesktop(
      [{ ...rows[1], instanceEndpoints: { editor: `https://a/vnc.html?token=fixture&sessionId=server${flag}` } }],
      a
    );
    const url = new URL(resolved!.url);
    expect(url.searchParams.getAll('hideHeader')).toEqual(['true']);
    expect(url.searchParams.get('token')).toBe('fixture');
    expect(url.searchParams.get('sessionId')).toBe('server');
  }
);
it('never guesses a shared mapping or header-only navigation', () => {
  const shared = [{ ...rows[1], isShared: true, mappingId: 'm' }];
  expect(resolveDesktop(shared, a)).toBeUndefined();
  expect(resolveDesktop(shared, { ...a, mappingId: 'other' })).toBeUndefined();
  expect(resolveDesktop(shared, { ...a, mappingId: 'm' })).toBeDefined();
  expect(resolveDesktop([{ ...rows[1], endpointHeaders: { Authorization: 'secret' } }], a)).toBeUndefined();
});
it('opens an exact same-origin authorized desktop route without exposing provider headers', () => {
  const endpoint = '/byaiService/sandbox/desktop/exclusive/a/editor/?sessionId=server';
  const privateRow = {
    ...rows[1],
    instanceEndpoints: { editor: endpoint },
    endpointHeaders: { 'e2b-traffic-access-token': 'fixture-private-traffic' },
  };
  const expected = `${window.location.origin}${endpoint}&autoconnect=true&resize=scale&hideHeader=true`;
  expect(resolveDesktop([privateRow], a)?.url).toBe(expected);
  expect(
    resolveDesktop([{ ...privateRow, instanceEndpoints: { editor: `${window.location.origin}${endpoint}` } }], a)?.url
  ).toBe(expected);
});
it('opens only the encoded shared mapping desktop route returned for the exact instance', () => {
  const ref = { sandboxId: 'sandbox-a', instance: '设计 tools', mappingId: 'mapping a' };
  const endpoint = '/byaiService/sandbox/desktop/shared/mapping%20a/sandbox-a/%E8%AE%BE%E8%AE%A1%20tools/';
  const sharedRow = {
    ...rows[1],
    sandboxId: ref.sandboxId,
    isShared: true,
    mappingId: ref.mappingId,
    instanceEndpoints: { [ref.instance]: endpoint },
    instanceDescriptors: { [ref.instance]: { viewer: 'novnc' } },
    endpointHeaders: { 'e2b-traffic-access-token': 'fixture-private-traffic' },
  };
  expect(resolveDesktop([sharedRow], ref)?.url).toBe(
    `${window.location.origin}${endpoint}?autoconnect=true&resize=scale&hideHeader=true`
  );
  expect(
    resolveDesktop(
      [
        {
          ...sharedRow,
          instanceEndpoints: {
            [ref.instance]: '/byaiService/sandbox/desktop/shared/other/sandbox-a/%E8%AE%BE%E8%AE%A1%20tools/',
          },
        },
      ],
      ref
    )
  ).toBeUndefined();
});
it.each(['vnc.html', 'index.html', 'viewer.HTML'])(
  'opens a single authorized HTML entry and preserves its server WebSocket routing: %s',
  (entry) => {
    const endpoint =
      `/byaiService/sandbox/desktop/exclusive/a/editor/${entry}?sessionId=server&` +
      'path=byaiService%2Fsandbox%2Fdesktop%2Fexclusive%2Fa%2Feditor%2Fwebsockify%3FsessionId%3Dserver';
    const resolved = resolveDesktop(
      [
        {
          ...rows[1],
          instanceEndpoints: { editor: endpoint },
          endpointHeaders: { 'e2b-traffic-access-token': 'fixture-private-traffic' },
        },
      ],
      a
    );
    expect(resolved?.url).toBe(`${window.location.origin}${endpoint}&autoconnect=true&resize=scale&hideHeader=true`);
  }
);
it('matches identifiers decoded from the server path-segment encoding', () => {
  const ref = { sandboxId: 'a:1', instance: 'view+one@2', mappingId: 'm;1' };
  const endpoint = '/byaiService/sandbox/desktop/shared/m;1/a:1/view+one@2/vnc.html';
  expect(
    resolveDesktop(
      [
        {
          sandboxId: ref.sandboxId,
          isShared: true,
          mappingId: ref.mappingId,
          instanceEndpoints: { [ref.instance]: endpoint },
          instanceDescriptors: { [ref.instance]: { viewer: 'novnc' } },
          endpointHeaders: { 'e2b-traffic-access-token': 'fixture-private-traffic' },
        },
      ],
      ref
    )?.url
  ).toBe(`${window.location.origin}${endpoint}?autoconnect=true&resize=scale&hideHeader=true`);
});
it.each(['sandbox/a', 'sandbox\\a', 'sandbox\u0001a', 'sandbox\u0085a', '.', '..'])(
  'rejects a protected navigation identity that the server cannot authorize: %s',
  (sandboxId) => {
    expect(
      resolveDesktop(
        [
          {
            ...rows[1],
            sandboxId,
            instanceEndpoints: {
              editor: `/byaiService/sandbox/desktop/exclusive/${encodeURIComponent(sandboxId)}/editor/`,
            },
            endpointHeaders: { 'e2b-traffic-access-token': 'fixture-private-traffic' },
          },
        ],
        { ...a, sandboxId }
      )
    ).toBeUndefined();
  }
);
it.each([
  'https://other.example/byaiService/sandbox/desktop/exclusive/a/editor/',
  '/byaiService/sandbox/desktop/exclusive/b/editor/',
  '/byaiService/sandbox/desktop/exclusive/a/vnc/',
  '/byaiService/sandbox/desktop/shared/m/a/editor/',
  '/byaiService/sandbox/desktop/exclusive/a/editor',
  '/byaiService/sandbox/desktop/exclusive/a/editor/websockify',
  '/byaiService/sandbox/desktop/exclusive/a/editor/goal',
  '/byaiService/sandbox/desktop/exclusive/a/editor/core/rfb.js',
  '/byaiService/sandbox/desktop/exclusive/a/editor/nested/vnc.html',
  '/byaiService/sandbox/desktop/exclusive/a/editor/viewer%2Fvnc.html',
  '/byaiService/sandbox/desktop/exclusive/a/editor/viewer%5Cvnc.html',
  '/byaiService/sandbox/desktop/exclusive/a/editor/viewer%00.html',
  '/byaiService/sandbox/desktop/exclusive/a/editor/viewer%25.html',
  '/byaiService/sandbox/desktop/exclusive/b/editor/vnc.html',
  '/byaiService/sandbox/desktop/shared/other/a/editor/vnc.html',
  '/v1/sandboxes/a/proxy/8081/',
])('rejects a header-required endpoint outside the exact authorized desktop route: %s', (endpoint) => {
  expect(
    resolveDesktop(
      [
        {
          ...rows[1],
          instanceEndpoints: { editor: endpoint },
          endpointHeaders: { 'e2b-traffic-access-token': 'fixture-private-traffic' },
        },
      ],
      a
    )
  ).toBeUndefined();
});
it('merges references in first-seen order and suppresses malformed fields', () => {
  expect(mergeInstanceRefs([a], [a, { sandboxId: 'b', instance: 'vnc' }])).toEqual([
    a,
    { sandboxId: 'b', instance: 'vnc' },
  ]);
  expect(mergeInstanceRefs([a], [])).toEqual([a]);
  expect(mergeInstanceRefs(undefined, { url: 'https://evil' })).toEqual([]);
  expect(desktopKey({ sandboxId: 'a:b', instance: 'c' })).not.toBe(desktopKey({ sandboxId: 'a', instance: 'b:c' }));
});
it('only recognizes declared novnc or exact legacy names', () => {
  expect(
    listDesktops([
      { sandboxId: 'a', instanceEndpoints: { web: 'https://a', 'fake-vnc': 'https://a', vnc: 'https://a' } } as any,
    ])
  ).toHaveLength(1);
});
it('rejects whitespace identity and invalid mapping instead of changing identity', () => {
  expect(
    mergeInstanceRefs(
      [],
      [
        { sandboxId: ' a', instance: 'vnc' },
        { sandboxId: 'a', instance: 'vnc', mappingId: '' },
        { sandboxId: 'a', instance: 'vnc ', mappingId: 'm' },
      ]
    )
  ).toEqual([]);
});
