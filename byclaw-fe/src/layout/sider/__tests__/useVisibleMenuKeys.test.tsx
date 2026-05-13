jest.mock('@/service/auth', () => ({
  getDcSystemConfigListByStandType: jest.fn(),
}));

import { renderHook, waitFor } from '@testing-library/react';

import { DEFAULT_MENU_CONFIG, getVisibleMenuKeysFromConfig } from '@/constants/system';
import { getDcSystemConfigListByStandType } from '@/service/auth';
import useVisibleMenuKeys from '../useVisibleMenuKeys';

const mockGetDcSystemConfigListByStandType = getDcSystemConfigListByStandType as jest.MockedFunction<
  typeof getDcSystemConfigListByStandType
>;

describe('useVisibleMenuKeys', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('waits for userInfo before loading menu config', async () => {
    mockGetDcSystemConfigListByStandType.mockResolvedValue({
      data: [{ paramName: '会话', paramValue: 'true', paramSeq: 1 }],
    });

    const { result, rerender } = renderHook(({ userInfo }) => useVisibleMenuKeys(userInfo), {
      initialProps: { userInfo: null as any },
    });

    expect(mockGetDcSystemConfigListByStandType).not.toHaveBeenCalled();
    expect(result.current).toEqual(getVisibleMenuKeysFromConfig(DEFAULT_MENU_CONFIG));

    rerender({ userInfo: { userId: 1 } });

    await waitFor(() => {
      expect(mockGetDcSystemConfigListByStandType).toHaveBeenCalledWith({
        standType: 'MENU_ICON_SHOW_TAB',
      });
    });

    await waitFor(() => {
      expect(result.current).toEqual(['sessions']);
    });
  });
});
