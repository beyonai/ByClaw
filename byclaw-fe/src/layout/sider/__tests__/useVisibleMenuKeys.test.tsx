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
const defaultVisibleKeys = getVisibleMenuKeysFromConfig(DEFAULT_MENU_CONFIG);

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
      expect(result.current).toEqual(['sessions', 'automation', 'projectSpace', 'skill', 'file', 'model', 'ontology']);
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
      expect(result.current).toEqual(['sessions', 'automation', 'projectSpace', 'file', 'model', 'ontology']);
    });
  });

  it('temporarily hides view and object even when remote config enables them', async () => {
    mockGetDcSystemConfigListByStandType.mockResolvedValue({
      data: [
        { paramName: '会话', paramValue: 'true', paramSeq: 1 },
        { paramName: '视图', paramValue: 'true', paramSeq: 2 },
        { paramName: '对象', paramValue: 'true', paramSeq: 3 },
        { paramName: '本体', paramValue: 'true', paramSeq: 4 },
      ],
    });

    const { result } = renderHook(() => useVisibleMenuKeys({ userId: 1 }));

    await waitFor(() => {
      expect(result.current).toEqual(['sessions', 'ontology', 'automation', 'projectSpace', 'skill', 'file', 'model']);
    });
  });

  it('falls back to default visible keys when menu config is empty', async () => {
    mockGetDcSystemConfigListByStandType.mockResolvedValue({ data: [] });

    const { result } = renderHook(() => useVisibleMenuKeys({ userId: 1 }));

    expect(result.current).toEqual([]);

    await waitFor(() => {
      expect(result.current).toEqual(defaultVisibleKeys);
    });
  });

  it('falls back to default visible keys when menu config request fails', async () => {
    mockGetDcSystemConfigListByStandType.mockRejectedValue(new Error('request failed'));

    const { result } = renderHook(() => useVisibleMenuKeys({ userId: 1 }));

    expect(result.current).toEqual([]);

    await waitFor(() => {
      expect(result.current).toEqual(defaultVisibleKeys);
    });
  });
});
