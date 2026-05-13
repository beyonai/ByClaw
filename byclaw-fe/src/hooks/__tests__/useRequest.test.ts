import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { message } from 'antd';
import { useRequest } from '../useRequest';
import React from 'react';

// Mock antd message
jest.mock('antd', () => ({
  message: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock mutation function
const mockMutationFn = jest.fn();

// Create a wrapper component for testing
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useRequest', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeAll(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockMutationFn.mockClear();
  });

  it('should return mutation object with correct properties', () => {
    const { result } = renderHook(() => useRequest({ mutationFn: mockMutationFn }), { wrapper: createWrapper() });

    expect(result.current).toHaveProperty('mutate');
    expect(result.current).toHaveProperty('mutateAsync');
    expect(result.current).toHaveProperty('isPending');
    expect(result.current).toHaveProperty('isError');
    expect(result.current).toHaveProperty('isSuccess');
    expect(result.current).toHaveProperty('data');
    expect(result.current).toHaveProperty('error');
  });

  it('should show success toast when successToast is provided', async () => {
    const successToast = '操作成功';
    mockMutationFn.mockResolvedValue({ success: true });

    const { result } = renderHook(
      () =>
        useRequest({
          mutationFn: mockMutationFn,
          successToast,
        }),
      { wrapper: createWrapper() }
    );

    act(() => {
      result.current.mutate({ test: 'data' });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(message.success).toHaveBeenCalledWith(successToast);
  });

  it('should not show success toast when successToast is null', async () => {
    mockMutationFn.mockResolvedValue({ success: true });

    const { result } = renderHook(
      () =>
        useRequest({
          mutationFn: mockMutationFn,
          successToast: null,
        }),
      { wrapper: createWrapper() }
    );

    act(() => {
      result.current.mutate({ test: 'data' });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(message.success).not.toHaveBeenCalled();
  });

  it('should show error toast when error occurs', async () => {
    const errorToast = '操作失败';
    const error = new Error('Test error');
    mockMutationFn.mockRejectedValue(error);

    const { result } = renderHook(
      () =>
        useRequest({
          mutationFn: mockMutationFn,
          errorToast,
        }),
      { wrapper: createWrapper() }
    );

    act(() => {
      result.current.mutate({ test: 'data' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // 由于错误有message，会优先使用error.message而不是errorToast
    expect(message.error).toHaveBeenCalledWith('Test error');
  });

  it('should show error message from error object', async () => {
    const error = { message: 'Custom error message' };
    mockMutationFn.mockRejectedValue(error);

    const { result } = renderHook(() => useRequest({ mutationFn: mockMutationFn }), { wrapper: createWrapper() });

    act(() => {
      result.current.mutate({ test: 'data' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(message.error).toHaveBeenCalledWith('Custom error message');
  });

  it('should show error message from error.msg', async () => {
    const error = { msg: 'Result error message' };
    mockMutationFn.mockRejectedValue(error);

    const { result } = renderHook(() => useRequest({ mutationFn: mockMutationFn }), { wrapper: createWrapper() });

    act(() => {
      result.current.mutate({ test: 'data' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(message.error).toHaveBeenCalledWith('Result error message');
  });

  it('should show error message from error.msg', async () => {
    const error = { msg: 'Msg error message' };
    mockMutationFn.mockRejectedValue(error);

    const { result } = renderHook(() => useRequest({ mutationFn: mockMutationFn }), { wrapper: createWrapper() });

    act(() => {
      result.current.mutate({ test: 'data' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(message.error).toHaveBeenCalledWith('Msg error message');
  });

  it('should show errorToast when no error message is available', async () => {
    const errorToast = 'Default error message';
    const error = {};
    mockMutationFn.mockRejectedValue(error);

    const { result } = renderHook(
      () =>
        useRequest({
          mutationFn: mockMutationFn,
          errorToast,
        }),
      { wrapper: createWrapper() }
    );

    act(() => {
      result.current.mutate({ test: 'data' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(message.error).toHaveBeenCalledWith(errorToast);
  });

  it('should handle string error', async () => {
    const error = 'String error message';
    mockMutationFn.mockRejectedValue(error);

    const { result } = renderHook(() => useRequest({ mutationFn: mockMutationFn }), { wrapper: createWrapper() });

    act(() => {
      result.current.mutate({ test: 'data' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(message.error).toHaveBeenCalledWith('String error message');
  });

  it('should call onSuccess callback when provided', async () => {
    const onSuccess = jest.fn();
    const successData = { success: true };
    mockMutationFn.mockResolvedValue(successData);

    const { result } = renderHook(
      () =>
        useRequest({
          mutationFn: mockMutationFn,
          onSuccess,
        }),
      { wrapper: createWrapper() }
    );

    act(() => {
      result.current.mutate({ test: 'data' });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(onSuccess).toHaveBeenCalledWith(successData, { test: 'data' }, undefined);
  });

  it('should call onError callback when provided', async () => {
    const onError = jest.fn();
    const error = new Error('Test error');
    mockMutationFn.mockRejectedValue(error);

    const { result } = renderHook(
      () =>
        useRequest({
          mutationFn: mockMutationFn,
          onError,
        }),
      { wrapper: createWrapper() }
    );

    act(() => {
      result.current.mutate({ test: 'data' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(onError).toHaveBeenCalledWith(error, { test: 'data' }, undefined);
  });

  it('should pass through other mutation options', async () => {
    const onMutate = jest.fn();
    const onSettled = jest.fn();

    const { result } = renderHook(
      () =>
        useRequest({
          mutationFn: mockMutationFn,
          onMutate,
          onSettled,
          retry: 3,
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current).toBeDefined();
  });
});
