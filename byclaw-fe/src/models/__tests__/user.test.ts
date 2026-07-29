jest.mock('@/service/common/request', () => ({
  globalLogout: jest.fn(),
}));

jest.mock('@/service/user', () => ({
  getLoginInfo: jest.fn(),
  queryMyDepartmentRange: jest.fn(),
}));

jest.mock('@/utils/auth', () => ({
  getAuthSnapshot: jest.fn(() => ({
    sessionId: 'session-1',
    token: 'token-1',
    ssoToken: 'sso-1',
  })),
  isCurrentAuthSnapshot: jest.fn(() => true),
  setUserToken: jest.fn(),
}));

jest.mock('@/utils/cookie', () => ({
  __esModule: true,
  default: {
    set: jest.fn(),
  },
}));

jest.mock('@/utils/websocket', () => ({
  __esModule: true,
  default: {
    init: jest.fn(),
  },
}));

import userModel from '../common/user';
import CookieUtil from '@/utils/cookie';
import { getAuthSnapshot, isCurrentAuthSnapshot, setUserToken } from '@/utils/auth';
import { globalLogout } from '@/service/common/request';
import webSocketManager from '@/utils/websocket';

describe('models/common/user', () => {
  const effects = (userModel as any).effects;
  const reducers = (userModel as any).reducers;

  beforeEach(() => {
    jest.clearAllMocks();
    (isCurrentAuthSnapshot as jest.Mock).mockReturnValue(true);
  });

  it('save merges payload into state', () => {
    const state = { userInfo: null, departmentList: [] };
    expect(reducers.save(state, { payload: { departmentList: [1, 2] } })).toEqual({
      userInfo: null,
      departmentList: [1, 2],
    });
  });

  it('clean resets to initial state', () => {
    expect(reducers.clean()).toEqual({
      userInfo: null,
      departmentList: [],
    });
  });

  it('updateUserInfo merges payload when userInfo exists', () => {
    const state = {
      userInfo: {
        userName: 'Alice',
        phone: '1',
      },
    };

    expect(reducers.updateUserInfo(state as any, { payload: { phone: '2' } })).toEqual({
      userInfo: {
        userName: 'Alice',
        phone: '2',
      },
    });
  });

  it('setUserInfo effect stores user info, writes cookie/localStorage and calls setUserToken', () => {
    const payload = {
      data: {
        userCode: 'alice',
        userName: 'Alice',
        registerType: null,
      },
      sessionId: 'session-1',
      token: 'token-1',
    };
    const put = jest.fn((action) => action);

    const effect = effects.setUserInfo({ payload }, { put });
    const next = effect.next();

    expect((CookieUtil as any).set).toHaveBeenCalledWith('uc', 'alice');
    expect(localStorage.getItem('uc')).toBe('alice');
    expect(setUserToken).toHaveBeenCalledWith(payload);
    expect(webSocketManager.init).toHaveBeenCalled();
    expect(put).toHaveBeenCalledWith({
      type: 'save',
      payload: {
        userInfo: expect.objectContaining({
          userCode: 'alice',
          userName: 'Alice',
          isRetented: true,
        }),
      },
    });
    expect(next.value).toEqual({
      type: 'save',
      payload: {
        userInfo: expect.objectContaining({
          userCode: 'alice',
          userName: 'Alice',
          isRetented: true,
        }),
      },
    });
    expect(next.done).toBe(false);
  });

  it('setUserInfo effect does nothing when payload has no data', () => {
    const put = jest.fn((action) => action);
    const effect = effects.setUserInfo({ payload: {} }, { put });
    const next = effect.next();

    expect((CookieUtil as any).set).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(next.value).toBeUndefined();
    expect(next.done).toBe(true);
  });

  it('initUserInfo only logs out the auth snapshot used by the failed request', () => {
    const call = jest.fn(() => 'getLoginInfo');
    const put = jest.fn();
    const authSnapshot = (getAuthSnapshot as jest.Mock)();
    const effect = effects.initUserInfo({}, { call, put });

    expect(effect.next().value).toBe('getLoginInfo');
    expect(effect.next('登录失效').value).toBe('登录失效');
    expect(globalLogout).toHaveBeenCalledWith(false, authSnapshot);
  });

  it('initUserInfo does not log out on a transient request error', () => {
    const call = jest.fn(() => 'getLoginInfo');
    const put = jest.fn();
    const effect = effects.initUserInfo({}, { call, put });

    effect.next();
    expect(effect.throw(new Error('network error')).value).toBeNull();
    expect(globalLogout).not.toHaveBeenCalled();
  });

  it('initUserInfo ignores a successful response from an old session', () => {
    (isCurrentAuthSnapshot as jest.Mock).mockReturnValue(false);
    const success = jest.fn();
    const call = jest.fn(() => 'getLoginInfo');
    const put = jest.fn();
    const effect = effects.initUserInfo({ success }, { call, put });

    expect(effect.next().value).toBe('getLoginInfo');
    expect(
      effect.next({
        code: 0,
        data: {
          userCode: 'old-user',
        },
      })
    ).toEqual({ value: null, done: true });

    expect(put).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(globalLogout).not.toHaveBeenCalled();
  });
});
