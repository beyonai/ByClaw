jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

import { renderHook, act } from '@testing-library/react';
import useAbortRequest from '../useAbortRequest';

describe('hooks/useAbortRequest', () => {
  it('aborts the previous request when called again', () => {
    const request = jest.fn(() => new Promise(() => {}));
    const { result } = renderHook(() => useAbortRequest(request as any));

    act(() => {
      void result.current({ id: 1 }, {});
    });
    const firstController = request.mock.calls[0][1].cancelToken as AbortController;

    act(() => {
      void result.current({ id: 2 }, {});
    });
    const secondController = request.mock.calls[1][1].cancelToken as AbortController;

    expect(firstController.signal.aborted).toBe(true);
    expect(secondController.signal.aborted).toBe(false);
  });

  it('resolves request results normally', async () => {
    const request = jest.fn().mockResolvedValue({ success: true });
    const { result } = renderHook(() => useAbortRequest(request as any));

    await expect(result.current({ id: 1 }, {})).resolves.toEqual({ success: true });
  });

  it('swallows canceled errors as empty rejections', async () => {
    const request = jest.fn().mockRejectedValue({ name: 'CanceledError' });
    const { result } = renderHook(() => useAbortRequest(request as any));

    await expect(result.current({ id: 1 }, {})).rejects.toBeUndefined();
  });
});
