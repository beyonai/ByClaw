import { act, renderHook } from '@testing-library/react';
import { openPublication, type PublicationDetail } from '@/service/employeePublication';
import usePublicationDetailLoader from './useDetailLoader';

jest.mock('@/service/employeePublication', () => ({ openPublication: jest.fn() }));
beforeEach(() => jest.resetAllMocks());

it('shows loading immediately, prevents duplicate requests, and finishes after hydration', async () => {
  let finish!: (value: any) => void;
  (openPublication as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const { result } = renderHook(() => usePublicationDetailLoader('100'));
  const hydrate = jest.fn();
  expect(result.current.loading).toBe(true);
  act(() => {
    void result.current.load(hydrate);
    void result.current.load(hydrate);
  });
  expect(openPublication).toHaveBeenCalledTimes(1);
  expect(openPublication).toHaveBeenCalledWith('100');
  await act(async () => {
    finish({ employee: { resourceName: '员工' } });
  });
  expect(hydrate).toHaveBeenCalledWith({ employee: { resourceName: '员工' } });
  expect(result.current.loading).toBe(false);
});

it('retains a visible error and retries with the original hydration callback', async () => {
  (openPublication as jest.Mock).mockRejectedValueOnce('网络暂时不可用').mockResolvedValue({ employee: {} });
  const { result } = renderHook(() => usePublicationDetailLoader('100'));
  const hydrate = jest.fn();
  await act(async () => {
    await result.current.load(hydrate);
  });
  expect(result.current.error).toBe('网络暂时不可用');
  expect(result.current.loading).toBe(false);
  await act(async () => {
    result.current.retry();
  });
  expect(hydrate).toHaveBeenCalledTimes(1);
  expect(result.current.error).toBe('');
  expect(openPublication).toHaveBeenCalledTimes(2);
});

it('ignores a late response after leaving the publication page', async () => {
  let finish!: (value: any) => void;
  (openPublication as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const { result, unmount } = renderHook(() => usePublicationDetailLoader('100'));
  const hydrate = jest.fn();
  act(() => {
    void result.current.load(hydrate);
  });
  unmount();
  await act(async () => {
    finish({ employee: {} });
  });
  expect(hydrate).not.toHaveBeenCalled();
});

it('hydrates a synchronized or cleared resource configuration after saving or confirming without reloading the page', async () => {
  const initial = { employee: { relIds: ['21'] } } as PublicationDetail;
  const cleared = {
    ...initial,
    employee: { relIds: [], relTools: [], relResourceList: [] },
    sourceResourcesChanged: true,
  };
  (openPublication as jest.Mock).mockResolvedValue(initial);
  const { result, unmount } = renderHook(() => usePublicationDetailLoader('100'));
  const hydrate = jest.fn();
  await act(async () => {
    await result.current.load(hydrate);
  });
  act(() => result.current.hydrate(cleared));
  expect(hydrate).toHaveBeenLastCalledWith(cleared);
  expect(openPublication).toHaveBeenCalledTimes(1);
  unmount();
  act(() => result.current.hydrate(initial));
  expect(hydrate).toHaveBeenCalledTimes(2);
});
