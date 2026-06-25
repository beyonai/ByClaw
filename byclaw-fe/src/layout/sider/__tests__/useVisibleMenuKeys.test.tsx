jest.mock('@/service/auth', () => ({
  getDcSystemConfigListByStandType: jest.fn(),
}));

jest.mock('@/pages/manager/service/session', () => ({
  getDcSystemConfig: jest.fn(),
}));

import { renderHook, waitFor } from '@testing-library/react';

import { DEFAULT_MENU_CONFIG, getVisibleMenuKeysFromConfig } from '@/constants/system';
import { getDcSystemConfigListByStandType } from '@/service/auth';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import useVisibleMenuKeys from '../useVisibleMenuKeys';

const mockGetDcSystemConfigListByStandType = getDcSystemConfigListByStandType as jest.MockedFunction<
  typeof getDcSystemConfigListByStandType
>;
const mockGetDcSystemConfig = getDcSystemConfig as jest.MockedFunction<typeof getDcSystemConfig>;

describe('useVisibleMenuKeys', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDcSystemConfig.mockResolvedValue({ paramValue: '' });
  });

  it('waits for userInfo before loading menu config', async () => {
    mockGetDcSystemConfigListByStandType.mockResolvedValue({
      data: [{ paramName: '会话', paramValue: 'true', paramSeq: 1 }],
    });

    const { result, rerender } = renderHook(({ userInfo }) => useVisibleMenuKeys(userInfo), {
      initialProps: { userInfo: null as any },
    });

    expect(mockGetDcSystemConfigListByStandType).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);

    rerender({ userInfo: { userId: 1 } });

    await waitFor(() => {
      expect(mockGetDcSystemConfigListByStandType).toHaveBeenCalledWith({
        standType: 'MENU_ICON_SHOW_TAB',
      });
    });

    await waitFor(() => {
      expect(result.current).toEqual(['sessions', 'skill', 'file']);
    });
  });

  it('does not append skill when remote config explicitly hides it', async () => {
    mockGetDcSystemConfigListByStandType.mockResolvedValue({
      data: [
        { paramName: '会话', paramValue: 'true', paramSeq: 1 },
        { paramName: '技能', paramValue: 'false', paramSeq: 2 },
      ],
    });

    const { result } = renderHook(() => useVisibleMenuKeys({ userId: 1 }));

    await waitFor(() => {
      expect(result.current).toEqual(['sessions', 'file']);
    });
  });

  it('falls back to default visible keys when menu config is empty', async () => {
    mockGetDcSystemConfigListByStandType.mockResolvedValue({ data: [] });

    const { result } = renderHook(() => useVisibleMenuKeys({ userId: 1 }));

    expect(result.current).toEqual([]);

    await waitFor(() => {
      expect(result.current).toEqual(getVisibleMenuKeysFromConfig(DEFAULT_MENU_CONFIG));
    });
  });

  it('falls back to default visible keys when menu config request fails', async () => {
    mockGetDcSystemConfigListByStandType.mockRejectedValue(new Error('request failed'));

    const { result } = renderHook(() => useVisibleMenuKeys({ userId: 1 }));

    expect(result.current).toEqual([]);

    await waitFor(() => {
      expect(result.current).toEqual(getVisibleMenuKeysFromConfig(DEFAULT_MENU_CONFIG));
    });
  });
});
