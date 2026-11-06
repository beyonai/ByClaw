import { act, renderHook } from '@testing-library/react';
import { EventEmitter$Cls } from '../eventEmitter';
import { openDrawerView, updateDrawerView, closeDrawerView } from '../drawerView';
import useActionEffect from '@/components/MainDrawer/useEventEmitter';
const mockEmitter = new EventEmitter$Cls();
jest.mock('@/hooks/useGlobal', () => () => ({ EventEmitter: mockEmitter }));
it('isolates external late updates and closes after a later chat or file opens', () => {
  const { result } = renderHook(() => useActionEffect());
  let first: ReturnType<typeof openDrawerView>;
  act(() => {
    first = openDrawerView(mockEmitter, 'external:login', { drawerType: 'vnc', overlay: true }, { url: 'https://old' });
  });
  expect(result.current.contentPayload.url).toBe('https://old');
  act(() => {
    mockEmitter.emit('beyond-main-driver-open-type', { drawerType: 'preview' });
    mockEmitter.emit('beyond-main-driver-message', { title: 'file' });
  });
  act(() => {
    updateDrawerView(mockEmitter, first, { url: 'https://late' });
    closeDrawerView(mockEmitter, first);
  });
  expect(result.current.drawerType).toBe('preview');
  expect(result.current.contentPayload).toEqual({ title: 'file' });
});
it('gives tool-message manual opens an atomic handle that rejects legacy URL updates', () => {
  const { result } = renderHook(() => useActionEffect());
  const owner = JSON.stringify(['session', 'chat']);
  act(() => mockEmitter.emit('byclaw-desktop-open', { owner, ref: { sandboxId: 'a', instance: 'vnc' } }));
  expect(result.current.drawerType).toBe('desktop');
  act(() => mockEmitter.emit('beyond-main-driver-message', { url: 'https://late-old-login' }));
  expect(result.current.contentPayload).toEqual({ owner });
});
