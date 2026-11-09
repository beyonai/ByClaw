jest.mock('@/pages/manager/service/authorizationTasks', () => ({
  submitAuthorizationTask: jest.fn(),
  listAuthorizationTasks: jest.fn(),
  getAuthorizationTask: jest.fn(),
  findAuthorizationTaskRequest: jest.fn(),
  retryAuthorizationTask: jest.fn(),
  cancelAuthorizationTask: jest.fn(),
}));
import { submitAuthorizationTask, listAuthorizationTasks } from '@/pages/manager/service/authorizationTasks';
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

import { message } from 'antd';
import { act, renderHook, waitFor } from '@testing-library/react';
import { listAuthDetail, batchHandleAuth, allowManageAuth } from '@/pages/manager/service/DigitalResourceMgr';
import { queryUseApplyList } from '@/pages/manager/service/resources';
import useAuth from '../useAuth';

describe('useAuth', () => {
  const useAuthPath = '/byaiService/auth/privilegeGrant/setResourceUsers';

  beforeEach(() => {
    jest.resetAllMocks();
    (listAuthorizationTasks as jest.Mock).mockResolvedValue({ code: 0, data: [] });
    (submitAuthorizationTask as jest.Mock).mockImplementation((request) =>
      Promise.resolve({
        code: 0,
        data: {
          taskId: 'task1',
          requestId: request.requestId,
          operation: request.operation,
          status: 'SUCCEEDED',
          progress: 100,
        },
      })
    );
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

    expect(submitAuthorizationTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'USE',
        setting: expect.objectContaining({
          resourceId: '13',
          includeUseGrantFamily: true,
          redList: [],
          blackList: [{ grantToObjId: '10000118', grantToObjType: 'USER', grantType: 'FORCE_USE' }],
        }),
      })
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
    const background = authApiPath?.startsWith('/byaiService/auth/privilegeGrant/setResource');
    const [params, path] = background
      ? [(submitAuthorizationTask as jest.Mock).mock.calls[0][0].setting, authApiPath]
      : (saveApi as jest.Mock).mock.calls[0];
    expect(params).not.toHaveProperty('includeUseGrantFamily');
    expect(params.pid).toBe('project-1');
    expect(path).toBe(authApiPath);
  });
});

describe('useAuth failure cleanup', () => {
  it.each(['useAuth', 'mgrAuth'])('clears submission loading after %s rejects', async (authType) => {
    (listAuthDetail as jest.Mock).mockResolvedValue({ code: 0, data: { redList: [], blackList: [] } });
    const api = authType === 'useAuth' ? batchHandleAuth : allowManageAuth;
    (api as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useAuth({ authType, grantObjId: '13', grantObjType: 'SKILL' }));
    await waitFor(() => expect(result.current.detailLoading).toBe(false));
    await act(async () => result.current.setAuth());
    expect(result.current.authLoading).toBe(false);
  });
});

describe('synchronous authorization response isolation', () => {
  const props = { authType: 'useAuth', grantObjType: 'DIG_EMPLOYEE', grantObjId: '13', authApiPath: '/legacy-auth' };
  beforeEach(() => {
    jest.resetAllMocks();
    (listAuthDetail as jest.Mock).mockResolvedValue({ code: 0, data: { redList: [], blackList: [] } });
  });

  it.each([
    { grantObjId: '14' },
    { authType: 'mgrAuth' },
    { orgId: '20' },
    { pid: 'new-project' },
    { authApiPath: '/other-auth' },
  ])('ignores old success after context changes: %p', async (change) => {
    let resolveOld;
    (batchHandleAuth as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    );
    const done = jest.fn();
    const { result, rerender } = renderHook((value) => useAuth(value), { initialProps: props });
    await waitFor(() => expect(result.current.detailLoading).toBe(false));
    let pending;
    act(() => {
      pending = result.current.setAuth(done);
    });
    rerender({ ...props, ...change });
    await act(async () => {
      resolveOld({ code: 0 });
      await pending;
    });
    expect(done).not.toHaveBeenCalled();
    expect(message.success).not.toHaveBeenCalled();
    expect(result.current.authLoading).toBe(false);
  });

  it('does not let an old failure clear the newer submission loading state or display an error', async () => {
    let rejectOld, resolveNew;
    (batchHandleAuth as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            rejectOld = reject;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNew = resolve;
          })
      );
    const { result, rerender } = renderHook((value) => useAuth(value), { initialProps: props });
    await waitFor(() => expect(result.current.detailLoading).toBe(false));
    let oldRequest, newRequest;
    act(() => {
      oldRequest = result.current.setAuth(jest.fn());
    });
    rerender({ ...props, grantObjId: '14' });
    const done = jest.fn();
    act(() => {
      newRequest = result.current.setAuth(done);
    });
    await act(async () => {
      rejectOld('old failure');
      await oldRequest;
    });
    expect(result.current.authLoading).toBe(true);
    expect(message.error).not.toHaveBeenCalled();
    await act(async () => {
      resolveNew({ code: 0 });
      await newRequest;
    });
    expect(done).toHaveBeenCalledTimes(1);
  });

  it.each(['useAuth', 'mgrAuth'])(
    'recovers after a rejected %s submission without treating loaded details as success',
    async (authType) => {
      (batchHandleAuth as jest.Mock).mockRejectedValue('资源正在被其他操作占用');
      (allowManageAuth as jest.Mock).mockRejectedValue('资源正在被其他操作占用');
      const done = jest.fn();
      const { result } = renderHook(() => useAuth({ ...props, authType }));
      await waitFor(() => expect(result.current.detailLoading).toBe(false));
      await act(async () => result.current.setAuth(done));
      expect(done).not.toHaveBeenCalled();
      expect(message.success).not.toHaveBeenCalled();
      expect(message.error).toHaveBeenCalledWith('授权失败：资源正在被其他操作占用');
      expect(result.current.authLoading).toBe(false);
    }
  );

  it('prevents duplicate submissions before a render and ignores success after unmount', async () => {
    let resolveRequest;
    (batchHandleAuth as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        })
    );
    const done = jest.fn();
    const { result, unmount } = renderHook(() => useAuth(props));
    await waitFor(() => expect(result.current.detailLoading).toBe(false));
    let pending;
    act(() => {
      pending = result.current.setAuth(done);
      result.current.setAuth(done);
    });
    expect(batchHandleAuth).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      resolveRequest({ code: 0 });
      await pending;
    });
    expect(done).not.toHaveBeenCalled();
  });

  it('does not overwrite the new resource member list with delayed old details', async () => {
    let resolveOld;
    (listAuthDetail as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          })
      )
      .mockResolvedValue({
        code: 0,
        data: { redList: [{ grantToObjType: 'USER', grantToObjId: 'new', grantToObjName: '新成员' }], blackList: [] },
      });
    const { result, rerender } = renderHook((value) => useAuth(value), { initialProps: props });
    rerender({ ...props, grantObjId: '14' });
    await waitFor(() => expect(result.current.redList[0]?.name).toBe('新成员'));
    await act(async () => resolveOld({ code: 0, data: { redList: [], blackList: [] } }));
    expect(result.current.redList[0]?.name).toBe('新成员');
  });
});
