jest.mock('@umijs/max', () => ({
  useSelector: jest.fn(),
}));

jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

import { renderHook, act } from '@testing-library/react';
import { useSelector } from '@umijs/max';
import { POST } from '@/service/common/request';
import useAgentUploadFileConfig from '../useAgentUploadFileConfig';

const mockUseSelector = useSelector as jest.Mock;
const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('hooks/useAgentUploadFileConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSelector.mockReturnValue({ userId: 'user-1' });
  });

  it('defaults to enabled before a user has loaded', () => {
    mockUseSelector.mockReturnValue(null);
    const { result } = renderHook(() => useAgentUploadFileConfig([]));

    expect(result.current.globalConfig.enabled).toBe(true);
    expect(mockPOST).not.toHaveBeenCalled();
  });

  it.each([null, { code: 0, data: {} }, { code: 0, data: { paramValue: '' } }])(
    'keeps upload enabled when the backend has no configured value: %p',
    async (response) => {
      mockPOST.mockResolvedValue(response as any);
      const { result } = renderHook(() => useAgentUploadFileConfig([]));

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.globalConfig).toEqual({
        enabled: true,
        allowedFileTypes: [],
        maxFileSize: 0,
        maxFileCount: 0,
      });
    }
  );

  it('preserves a configured value without the enabled field', async () => {
    mockPOST.mockResolvedValue({
      code: 0,
      data: { paramValue: JSON.stringify({ maxFileSize: 10, maxFileCount: 0 }) },
    } as any);
    const { result } = renderHook(() => useAgentUploadFileConfig([]));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.globalConfig).toEqual({ maxFileSize: 10, maxFileCount: 0 });
  });

  it('loads global config and returns disabled config immediately when globally disabled', async () => {
    mockPOST.mockResolvedValue({
      code: 0,
      data: {
        paramValue: JSON.stringify({
          enabled: false,
          allowedFileTypes: ['.png'],
          maxFileSize: 1024,
          maxFileCount: 1,
        }),
      },
    } as any);

    const { result } = renderHook(() => useAgentUploadFileConfig([] as any));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.globalConfig.enabled).toBe(false);
    expect(result.current.getAgentUploadFileConfig('agent-1')).toEqual({
      enabled: false,
      allowedFileTypes: ['.png'],
      maxFileSize: 1024,
      maxFileCount: 1,
    });
  });

  it('returns agent-level upload config parsed from prologue and caches it', async () => {
    mockPOST.mockResolvedValue({
      code: 0,
      data: {
        paramValue: JSON.stringify({
          enabled: true,
          allowedFileTypes: ['.png'],
          maxFileSize: 1024,
          maxFileCount: 1,
        }),
      },
    } as any);

    const employees = [
      {
        id: 'agent-1',
        prologue: JSON.stringify({
          fileUpload: {
            enabled: true,
            allowedFileTypes: ['.jpg'],
            maxFileSize: 2048,
            maxFileCount: 2,
          },
        }),
      },
    ];

    const { result } = renderHook(() => useAgentUploadFileConfig(employees as any));

    await act(async () => {
      await Promise.resolve();
    });

    const first = result.current.getAgentUploadFileConfig('agent-1');
    const second = result.current.getAgentUploadFileConfig('agent-1');

    expect(first).toEqual({
      enabled: true,
      allowedFileTypes: ['.jpg'],
      maxFileSize: 2048,
      maxFileCount: 2,
    });
    expect(second).toStrictEqual(first);
  });

  it('returns disabled fallback when agent has no prologue config', async () => {
    mockPOST.mockResolvedValue({
      code: 0,
      data: {
        paramValue: JSON.stringify({
          enabled: true,
          allowedFileTypes: ['.png'],
          maxFileSize: 1024,
          maxFileCount: 1,
        }),
      },
    } as any);

    const { result } = renderHook(() => useAgentUploadFileConfig([{ id: 'agent-2' }] as any));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.getAgentUploadFileConfig('agent-2')).toEqual({
      enabled: false,
      allowedFileTypes: ['.png'],
      maxFileSize: 1024,
      maxFileCount: 1,
    });
  });
});
