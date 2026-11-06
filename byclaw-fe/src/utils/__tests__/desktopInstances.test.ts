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
it('never guesses a shared mapping or header-only navigation', () => {
  const shared = [{ ...rows[1], isShared: true, mappingId: 'm' }];
  expect(resolveDesktop(shared, a)).toBeUndefined();
  expect(resolveDesktop(shared, { ...a, mappingId: 'other' })).toBeUndefined();
  expect(resolveDesktop(shared, { ...a, mappingId: 'm' })).toBeDefined();
  expect(resolveDesktop([{ ...rows[1], endpointHeaders: { Authorization: 'secret' } }], a)).toBeUndefined();
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
