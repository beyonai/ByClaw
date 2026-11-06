import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import useVncOpener from '../useVncOpener';
import { desktopAuthEpoch, getDesktopOwner, updateDesktopOwner, useDesktopWorkspace } from '@/utils/desktopWorkspace';

const mockEmit = jest.fn();
const mockLookup = jest.fn();
let mockIdentity = 'tenant';
jest.mock('../useGlobal', () => ({ __esModule: true, default: () => ({ EventEmitter: { emit: mockEmit } }) }));
jest.mock('@/models/common/useAppStore', () => ({
  __esModule: true,
  default: { getState: () => ({ getSandboxesInfoUrl: mockLookup }) },
}));
jest.mock('@/utils/auth', () => ({
  getDesktopIdentitySnapshot: () => ({ account: 'user', enterpriseId: mockIdentity }),
  getAuthSnapshot: () => ({ sessionId: 'auth', token: '', ssoToken: '' }),
}));
const refA = { sandboxId: 'a', instance: 'vnc' };
const refB = { sandboxId: 'b', instance: 'vnc' };
const owner = JSON.stringify(['session', 'chat']);
const row = (sandboxId: string) => ({ sandboxId, instanceEndpoints: { vnc: `https://${sandboxId}/vnc.html` } });
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
beforeEach(() => {
  mockIdentity = 'tenant';
  desktopAuthEpoch();
  sessionStorage.clear();
  useDesktopWorkspace.setState({ owners: {}, panel: '', activeOwner: '', visible: false, revision: 0 });
  mockEmit.mockClear();
  mockLookup.mockReset();
  mockLookup.mockResolvedValue([row('b'), row('a')]);
});
it('always opens the empty workspace manually', async () => {
  mockLookup.mockResolvedValue([]);
  const { result } = renderHook(() => useVncOpener('chat'));
  act(() => result.current());
  expect(mockEmit).toHaveBeenCalledWith(
    'beyond-drawer-view',
    expect.objectContaining({ action: 'open', config: expect.objectContaining({ drawerType: 'desktop' }) })
  );
});
it('registers later instances without stealing selection or reopening', async () => {
  const { result } = renderHook(() => useVncOpener('chat'));
  act(() => result.current({ key: 'toolA', instanceRefs: [refA] }));
  await flush();
  const first = getDesktopOwner(owner).selected;
  mockEmit.mockClear();
  act(() => result.current({ key: 'toolB', instanceRefs: [refB] }));
  await flush();
  expect(getDesktopOwner(owner).refs).toEqual([refA, refB]);
  expect(getDesktopOwner(owner).selected).toBe(first);
  expect(mockEmit).not.toHaveBeenCalled();
});
it('claims pending once; B neither cancels nor replaces A', async () => {
  let resolve!: (rows: any[]) => void;
  mockLookup.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const { result } = renderHook(() => useVncOpener('chat'));
  act(() => result.current({ key: 'A', instanceRefs: [refA] }));
  act(() => result.current({ key: 'B', instanceRefs: [refB] }));
  await act(async () => {
    resolve([row('a'), row('b')]);
  });
  expect(mockLookup).toHaveBeenCalledTimes(1);
  expect(getDesktopOwner(owner).selected).toContain('"a"');
  expect(mockEmit.mock.calls.filter(([event]) => event === 'beyond-drawer-view')).toHaveLength(1);
});
it('does not replace another work panel and consumes the first chance', async () => {
  const { result } = renderHook(() => useVncOpener('chat'));
  useDesktopWorkspace.setState({ panel: 'preview' });
  act(() => result.current({ key: 'A', instanceRefs: [refA] }));
  expect(getDesktopOwner(owner).handled).toBe(true);
  expect(mockLookup).not.toHaveBeenCalled();
  expect(mockEmit).not.toHaveBeenCalled();
});
it('cancels pending when user intent or owner changes', async () => {
  let resolve!: (rows: any[]) => void;
  mockLookup.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const { result, rerender } = renderHook(({ id }) => useVncOpener(id), { initialProps: { id: 'chat' } });
  act(() => result.current({ key: 'A', instanceRefs: [refA] }));
  rerender({ id: 'other' });
  await act(async () => {
    resolve([row('a')]);
  });
  expect(mockEmit).not.toHaveBeenCalled();
  expect(getDesktopOwner(owner).refs).toEqual([refA]);
});
it('does not resurrect hidden entries on repeated tool events', async () => {
  const { result } = renderHook(() => useVncOpener('chat'));
  act(() => result.current({ key: 'A', instanceRefs: [refA] }));
  await flush();
  const key = getDesktopOwner(owner).selected!;
  updateDesktopOwner(owner, { hidden: [key] });
  act(() => result.current({ key: 'again', instanceRefs: [refA] }));
  expect(getDesktopOwner(owner).hidden).toEqual([key]);
});
it('does not consume the opportunity for explicit empty or known non-desktop references', async () => {
  mockLookup.mockResolvedValue([
    { sandboxId: 'a', instanceEndpoints: { web: 'https://a/' }, instanceDescriptors: { web: { viewer: 'iframe' } } },
  ]);
  const { result } = renderHook(() => useVncOpener('chat'));
  act(() => result.current({ key: 'empty', instanceRefs: [] }));
  expect(getDesktopOwner(owner).handled).not.toBe(true);
  act(() => result.current({ key: 'web', instanceRefs: [{ sandboxId: 'a', instance: 'web' }] }));
  await flush();
  expect(getDesktopOwner(owner).handled).toBe(false);
  expect(getDesktopOwner(owner).refs).toEqual([]);
  expect(mockEmit).not.toHaveBeenCalled();
});
it('opens the picker for ambiguous legacy targets without registering a guessed target', async () => {
  const { result } = renderHook(() => useVncOpener('chat'));
  act(() => result.current({ key: 'legacy' }));
  await flush();
  expect(mockEmit).toHaveBeenCalledWith('beyond-drawer-view', expect.objectContaining({ action: 'open' }));
  expect(getDesktopOwner(owner).refs).toEqual([]);
});
it('opens a local draft owner manually and migrates its associations once a formal ID exists', async () => {
  const { result, rerender } = renderHook(({ id }: { id?: string }) => useVncOpener(id), {
    initialProps: { id: undefined },
  });
  const draft = result.current.owner;
  act(() => result.current({ key: 'not-yet-real', instanceRefs: [refA] }));
  expect(mockEmit).not.toHaveBeenCalled();
  act(() => result.current());
  expect(mockEmit).toHaveBeenCalledWith('beyond-drawer-view', expect.objectContaining({ content: { owner: draft } }));
  updateDesktopOwner(draft, { refs: [refA], selected: JSON.stringify(['a', null, 'vnc']), hidden: ['hidden'] });
  rerender({ id: 'chat' });
  expect(getDesktopOwner(owner)).toMatchObject({
    refs: [refA],
    selected: JSON.stringify(['a', null, 'vnc']),
    hidden: ['hidden'],
    handled: true,
  });
  expect(useDesktopWorkspace.getState().owners[draft]).toBeUndefined();
  mockEmit.mockClear();
  act(() => result.current({ key: 'first-real', instanceRefs: [refA] }));
  expect(mockEmit).not.toHaveBeenCalled();
});
it('restores the current owner after navigation effect cleanup so the next owner can open', () => {
  const { result, rerender } = renderHook(({ id }) => useVncOpener(id), { initialProps: { id: 'chat' } });
  rerender({ id: 'other' });
  act(() => result.current());
  expect(mockEmit).toHaveBeenCalledWith(
    'beyond-drawer-view',
    expect.objectContaining({ content: { owner: JSON.stringify(['session', 'other']) } })
  );
});

it('keeps the opener valid after StrictMode setup-cleanup replay', () => {
  const { result } = renderHook(() => useVncOpener('strict-chat'), { wrapper: StrictMode });
  act(() => result.current());
  expect(mockEmit).toHaveBeenCalledWith(
    'beyond-drawer-view',
    expect.objectContaining({ content: { owner: JSON.stringify(['session', 'strict-chat']) } })
  );
});

it('releases a visible desktop only after the last opener for its chat unmounts', () => {
  const stream = renderHook(() => useVncOpener('chat'));
  const title = renderHook(() => useVncOpener('chat'));
  act(() => title.result.current());
  stream.unmount();
  expect(useDesktopWorkspace.getState()).toMatchObject({ activeOwner: owner, visible: true });
  title.unmount();
  expect(useDesktopWorkspace.getState()).toMatchObject({ activeOwner: '', visible: false, pendingOwner: '' });
});

it('opens the first live desktop after identity changes without requiring route remount', async () => {
  const { result } = renderHook(() => useVncOpener('chat'));
  act(() => {
    mockIdentity = 'next-tenant';
    desktopAuthEpoch();
  });
  act(() => result.current({ key: 'new-identity', instanceRefs: [refA] }));
  await flush();
  expect(mockEmit).toHaveBeenCalledWith('beyond-drawer-view', expect.objectContaining({ action: 'open' }));
  expect(useDesktopWorkspace.getState().pendingOwner).toBe('');
});

it('does not close a newer chat when an older owner finishes unmounting', () => {
  const old = renderHook(() => useVncOpener('old'));
  const next = renderHook(() => useVncOpener('next'));
  act(() => next.result.current());
  old.unmount();
  expect(useDesktopWorkspace.getState()).toMatchObject({
    activeOwner: JSON.stringify(['session', 'next']),
    visible: true,
  });
});

it('migrates the title draft while its separate stream opener also receives the formal ID', () => {
  const { result, rerender, unmount } = renderHook(
    ({ id }: { id?: string }) => ({ stream: useVncOpener(id), title: useVncOpener(id) }),
    { initialProps: { id: undefined } }
  );
  const titleDraft = result.current.title.owner;
  act(() => result.current.title());
  act(() => updateDesktopOwner(titleDraft, { refs: [refA], selected: JSON.stringify(['a', null, 'vnc']) }));
  rerender({ id: 'chat' });
  expect(getDesktopOwner(owner)).toMatchObject({ refs: [refA], selected: JSON.stringify(['a', null, 'vnc']) });
  act(() => result.current.title());
  expect(useDesktopWorkspace.getState().visible).toBe(true);
  unmount();
  expect(useDesktopWorkspace.getState()).toMatchObject({ activeOwner: '', visible: false });
});

it('clears only the unmounted subscriber pending request while its chat title remains', async () => {
  let resolve!: (rows: any[]) => void;
  mockLookup.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const stream = renderHook(() => useVncOpener('chat'));
  const title = renderHook(() => useVncOpener('chat'));
  act(() => stream.result.current({ key: 'pending', instanceRefs: [refA] }));
  expect(useDesktopWorkspace.getState().pendingOwner).toBe(owner);
  stream.unmount();
  expect(useDesktopWorkspace.getState()).toMatchObject({ activeOwner: owner, pendingOwner: '' });
  await act(async () => resolve([row('a')]));
  expect(mockEmit).not.toHaveBeenCalled();
  title.unmount();
});

it('does not cancel another subscriber newer pending request after a non-desktop result', async () => {
  const stream = renderHook(() => useVncOpener('chat'));
  const title = renderHook(() => useVncOpener('chat'));
  mockLookup.mockResolvedValue([{ sandboxId: 'a', instanceEndpoints: { web: 'https://a/' } }]);
  act(() => stream.result.current({ key: 'web', instanceRefs: [{ sandboxId: 'a', instance: 'web' }] }));
  await flush();
  let resolve!: (rows: any[]) => void;
  mockLookup.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  act(() => title.result.current({ key: 'desktop', instanceRefs: [refA] }));
  stream.unmount();
  expect(useDesktopWorkspace.getState().pendingOwner).toBe(owner);
  await act(async () => resolve([row('a')]));
  expect(mockEmit).toHaveBeenCalledWith('beyond-drawer-view', expect.objectContaining({ action: 'open' }));
});
