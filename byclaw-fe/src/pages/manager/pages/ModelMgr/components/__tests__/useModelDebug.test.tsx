jest.mock('antd', () => ({
  message: {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  },
}));

jest.mock('@/pages/manager/utils/copy', () => ({
  copyTextToClipboard: jest.fn(),
}));

import { act, renderHook } from '@testing-library/react';
import { message } from 'antd';
import useModelDebug from '../useModelDebug';

describe('useModelDebug image generation validation', () => {
  it('does not dispatch an image debug request when param.prompt is blank', () => {
    const runDebugRequest = jest.fn().mockResolvedValue({});
    const { result } = renderHook(() =>
      useModelDebug({
        intl: {
          formatMessage: ({ id }) => id,
        },
        open: true,
        currentModelType: 'IMAGE_GENERATION',
        getCurrentModelId: () => 'image-model-1',
        runDebugRequest,
      })
    );

    act(() => {
      result.current.setDebugInput('{"param":{"prompt":"   "}}');
    });
    act(() => {
      result.current.runDebug();
    });

    expect(runDebugRequest).not.toHaveBeenCalled();
    expect(message.warning).toHaveBeenCalledWith('modelMgr.modal.imagePromptRequired');
  });

  it('aborts an in-flight image request when the modal closes', () => {
    const runDebugRequest = jest.fn(() => new Promise(() => undefined));
    const { result, rerender } = renderHook(
      ({ open }) =>
        useModelDebug({
          intl: {
            formatMessage: ({ id }) => id,
          },
          open,
          currentModelType: 'IMAGE_GENERATION',
          getCurrentModelId: () => 'image-model-1',
          runDebugRequest,
        }),
      { initialProps: { open: true } }
    );

    act(() => {
      result.current.setDebugInput('{"param":{"prompt":"whale"}}');
    });
    act(() => {
      result.current.runDebug();
    });

    const signal = runDebugRequest.mock.calls[0][0].signal;
    expect(signal.aborted).toBe(false);

    rerender({ open: false });

    expect(signal.aborted).toBe(true);
  });

  it('renders a large image result immediately without using the typing queue', async () => {
    const largeBase64 = 'A'.repeat(512 * 1024);
    const runDebugRequest = jest.fn().mockResolvedValue({ output: largeBase64 });
    const { result } = renderHook(() =>
      useModelDebug({
        intl: {
          formatMessage: ({ id }) => id,
        },
        open: true,
        currentModelType: 'IMAGE_GENERATION',
        getCurrentModelId: () => 'image-model-1',
        runDebugRequest,
      })
    );

    act(() => {
      result.current.setDebugInput('{"param":{"prompt":"whale"}}');
    });
    await act(async () => {
      result.current.runDebug();
      await Promise.resolve();
    });

    expect(result.current.debugOutput).toHaveLength(largeBase64.length);
    expect(result.current.debugOutput.slice(0, 16)).toBe('A'.repeat(16));
    expect(result.current.debugOutputLoading).toBe(false);
  });
});
