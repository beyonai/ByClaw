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

    expect(result.current('agent-1')).toEqual({
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

    const first = result.current('agent-1');
    const second = result.current('agent-1');

    expect(first).toEqual({
      enabled: true,
      allowedFileTypes: ['.jpg'],
      maxFileSize: 2048,
      maxFileCount: 2,
    });
    expect(second).toBe(first);
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

    expect(result.current('agent-2')).toEqual({
      enabled: false,
      allowedFileTypes: ['.png'],
      maxFileSize: 1024,
      maxFileCount: 1,
    });
  });
});
