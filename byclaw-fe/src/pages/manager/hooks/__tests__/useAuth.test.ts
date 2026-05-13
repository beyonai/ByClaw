jest.mock('antd', () => ({
  message: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('@/pages/manager/service/DigitalResourceMgr', () => ({
  listAuthDetail: jest.fn(),
  batchHandleAuth: jest.fn(),
  allowManageAuth: jest.fn(),
}));

jest.mock('@/pages/manager/constants/digitalResource', () => ({
  grantTypeMap: {
    useAuth: 'AVAILABLE_USE',
    mgrAuth: 'ALLOW_MANAGE',
  },
}));

jest.mock('@/pages/manager/service/resources', () => ({
  queryUseApplyList: jest.fn(),
}));

import { renderHook, waitFor } from '@testing-library/react';
import { listAuthDetail } from '@/pages/manager/service/DigitalResourceMgr';
import { queryUseApplyList } from '@/pages/manager/service/resources';
import useAuth from '../useAuth';

describe('useAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not query pending apply list when opening use authorization drawer', async () => {
    (listAuthDetail as jest.Mock).mockResolvedValue({
      code: 0,
      data: {
        redList: [
          {
            grantToObjType: 'USER',
            grantToObjId: '1001',
            grantToObjName: 'tester',
          },
        ],
        blackList: [],
      },
    });

    const { result } = renderHook(() =>
      useAuth({
        authType: 'useAuth',
        grantObjType: 'KG_DOC',
        grantObjId: '2001',
      })
    );

    await waitFor(() => {
      expect(result.current.detailLoading).toBe(false);
    });

    expect(listAuthDetail).toHaveBeenCalledTimes(1);
    expect(queryUseApplyList).not.toHaveBeenCalled();
    expect(result.current.redList).toEqual([
      {
        grantToObjType: 'USER',
        grantToObjId: '1001',
        grantToObjName: 'tester',
        id: 'user_1001',
        name: 'tester',
        type: 'USER',
      },
    ]);
  });
});
