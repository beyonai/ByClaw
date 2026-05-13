jest.mock('@/service/message', () => ({
  collectCase: jest.fn(),
  cancelCollectCase: jest.fn(),
}));

jest.mock('../useGlobal', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { renderHook, act } from '@testing-library/react';
import { collectCase, cancelCollectCase } from '@/service/message';
import useGlobal from '../useGlobal';
import useCollect from '../useCollect';

const mockUseGlobal = useGlobal as jest.MockedFunction<typeof useGlobal>;
const mockCollectCase = collectCase as jest.MockedFunction<typeof collectCase>;
const mockCancelCollectCase = cancelCollectCase as jest.MockedFunction<typeof cancelCollectCase>;

describe('hooks/useCollect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseGlobal.mockReturnValue({
      EventEmitter: {
        emit: jest.fn(),
      },
    } as any);
  });

  it('collect calls service and emits updated message when message exists', async () => {
    mockCollectCase.mockResolvedValue({} as any);
    const message = { collectIds: [] };
    const emitter = (mockUseGlobal.mock.results[0]?.value as any)?.EventEmitter || mockUseGlobal().EventEmitter;

    const { result } = renderHook(() =>
      useCollect({
        sessionId: 's1',
        messageId: 'm1',
        collectKey: 'file-1',
        type: 'ppt',
        message: message as any,
      })
    );

    await act(async () => {
      await result.current.collect({
        name: 'My File',
        content: 'content',
        agentId: 'a1',
      });
    });

    expect(mockCollectCase).toHaveBeenCalledWith({
      sessionId: 's1',
      type: 'ppt',
      content: 'content',
      name: 'My File',
      messageId: 'm1',
      agentId: 'a1',
    });
    expect(emitter.emit).toHaveBeenCalledWith('beyond-update-message', {
      message: { collectIds: ['file-1'] },
      opt: {
        isAssign: true,
      },
    });
    expect(result.current.collectLoading).toBe(false);
  });

  it('cancelCollect calls service and removes collect key from message', async () => {
    mockCancelCollectCase.mockResolvedValue({} as any);
    const message = { collectIds: ['file-1', 'file-2'] };
    const emitter = (mockUseGlobal.mock.results[0]?.value as any)?.EventEmitter || mockUseGlobal().EventEmitter;

    const { result } = renderHook(() =>
      useCollect({
        sessionId: 's1',
        messageId: 'm1',
        collectKey: 'file-1',
        type: 'ppt',
        message: message as any,
      })
    );

    await act(async () => {
      await result.current.cancelCollect();
    });

    expect(mockCancelCollectCase).toHaveBeenCalledWith({
      sessionId: 's1',
      messageId: 'm1',
      type: 'ppt',
      fileCode: 'file-1',
    });
    expect(emitter.emit).toHaveBeenCalledWith('beyond-update-message', {
      message: { collectIds: ['file-2'] },
      opt: {
        isAssign: true,
      },
    });
    expect(result.current.collectLoading).toBe(false);
  });
});
