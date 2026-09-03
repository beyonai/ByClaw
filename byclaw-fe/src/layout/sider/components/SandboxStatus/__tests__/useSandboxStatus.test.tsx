import { act, renderHook } from '@testing-library/react';
import useSandboxStatus from '../useSandboxStatus';
import { launchSandboxByUserCode, removeSandbox } from '@/service/sandbox';

const mockRefetch = jest.fn();

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false, refetch: mockRefetch }),
}));

jest.mock('@/service/sandbox', () => ({
  getSandboxInfo: jest.fn(),
  removeSandbox: jest.fn(),
  launchSandboxByUserCode: jest.fn(),
}));

describe('useSandboxStatus', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (removeSandbox as jest.Mock).mockResolvedValue(undefined);
    (launchSandboxByUserCode as jest.Mock).mockResolvedValue({});
    mockRefetch.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('restarts the selected sandbox service without releasing sibling services', async () => {
    const { result } = renderHook(() => useSandboxStatus('user001'));
    const target = {
      userCode: 'user001',
      sandboxType: 'byclaw-dsh',
      sandboxId: 'sandbox-dsh',
      status: 'RUNNING',
    };

    const restartPromise = result.current.restartSandbox(target);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
      await restartPromise;
    });

    expect(removeSandbox).toHaveBeenCalledWith({
      userCode: 'user001',
      resourceId: null,
      sandboxType: 'byclaw-dsh',
    });
    expect(launchSandboxByUserCode).toHaveBeenCalledWith({ userCode: 'user001', serviceKey: 'byclaw-dsh' });
    expect(mockRefetch).toHaveBeenCalled();
  });
});
