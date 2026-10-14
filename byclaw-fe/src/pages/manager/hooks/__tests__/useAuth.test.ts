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
    useAuth: 'FORCE_USE',
    mgrAuth: 'ALLOW_MANAGE',
  },
}));

jest.mock('@/pages/manager/service/resources', () => ({
  queryUseApplyList: jest.fn(),
}));

import { act, renderHook, waitFor } from '@testing-library/react';
import { listAuthDetail, batchHandleAuth, allowManageAuth } from '@/pages/manager/service/DigitalResourceMgr';
import { queryUseApplyList } from '@/pages/manager/service/resources';
import useAuth from '../useAuth';

describe('useAuth', () => {
  const useAuthPath = '/byaiService/auth/privilegeGrant/setResourceUsers';

  beforeEach(() => {
    jest.resetAllMocks();
    (listAuthDetail as jest.Mock).mockResolvedValue({ code: 0, data: { redList: [], blackList: [] } });
    (batchHandleAuth as jest.Mock).mockResolvedValue({ code: 0 });
    (allowManageAuth as jest.Mock).mockResolvedValue({ code: 0 });
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
    expect(listAuthDetail).toHaveBeenCalledWith({
      grantType: 'FORCE_USE',
      grantObjType: 'KG_DOC',
      grantObjId: '2001',
    });
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

  it.each(['SKILL', 'KG_DOC', 'MCP'])('reads both use grant types for resource drawer %s', async (grantObjType) => {
    (listAuthDetail as jest.Mock).mockResolvedValue({
      code: 0,
      data: {
        redList: [{ grantToObjType: 'USER', grantToObjId: '10000118', grantToObjName: '刘皇叔' }],
        blackList: [{ grantToObjType: 'ORG', grantToObjId: '10000118', grantToObjName: '排除组织' }],
      },
    });
    const { result } = renderHook(() =>
      useAuth({ authType: 'useAuth', grantObjType, grantObjId: '13', authApiPath: useAuthPath })
    );
    await waitFor(() => expect(result.current.detailLoading).toBe(false));

    expect(listAuthDetail).toHaveBeenCalledWith({
      grantType: 'FORCE_USE',
      grantObjType,
      grantObjId: '13',
      includeUseGrantFamily: true,
    });
    expect(result.current.redList[0]).toMatchObject({ id: 'user_10000118', name: '刘皇叔', type: 'USER' });
    expect(result.current.blackList[0]).toMatchObject({ id: 'org_10000118', name: '排除组织', type: 'ORG' });
    expect(queryUseApplyList).not.toHaveBeenCalled();
  });

  it('saves the edited merged list with the same reconciliation scope used by the read', async () => {
    (listAuthDetail as jest.Mock).mockResolvedValue({
      code: 0,
      data: {
        redList: [{ grantToObjType: 'USER', grantToObjId: '10000118', grantToObjName: '刘皇叔' }],
        blackList: [],
      },
    });
    const { result } = renderHook(() =>
      useAuth({ authType: 'useAuth', grantObjType: 'SKILL', grantObjId: '13', authApiPath: useAuthPath })
    );
    await waitFor(() => expect(result.current.detailLoading).toBe(false));
    act(() => {
      result.current.setRedList([]);
      result.current.setBlackList([{ id: 'user_10000118', type: 'USER' }]);
    });
    const onSaved = jest.fn();
    await act(async () => result.current.setAuth(onSaved));

    expect(batchHandleAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: '13',
        includeUseGrantFamily: true,
        redList: [],
        blackList: [{ grantToObjId: '10000118', grantToObjType: 'USER', grantType: 'FORCE_USE' }],
      }),
      useAuthPath
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['mgrAuth', 'SKILL', '/byaiService/auth/privilegeGrant/setResourceManagers', 'ALLOW_MANAGE'],
    ['useAuth', 'DIG_EMPLOYEE', useAuthPath, 'FORCE_USE'],
    ['useAuth', 'SKILL', undefined, 'FORCE_USE'],
    ['useAuth', 'SKILL', '/custom/project/useAuth', 'FORCE_USE'],
  ])('preserves the existing scope for %s / %s / %s', async (authType, grantObjType, authApiPath, grantType) => {
    const { result } = renderHook(() =>
      useAuth({ authType, grantObjType, grantObjId: '13', pid: 'project-1', authApiPath })
    );
    await waitFor(() => expect(result.current.detailLoading).toBe(false));
    await act(async () => result.current.setAuth());

    expect(listAuthDetail).toHaveBeenCalledWith({ grantType, grantObjType, grantObjId: '13' });
    const saveApi = authType === 'mgrAuth' ? allowManageAuth : batchHandleAuth;
    const [params, path] = (saveApi as jest.Mock).mock.calls[0];
    expect(params).not.toHaveProperty('includeUseGrantFamily');
    expect(params.pid).toBe('project-1');
    expect(path).toBe(authApiPath);
  });
});
