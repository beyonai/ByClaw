jest.mock('@/service/common/request', () => ({
  globalLogout: jest.fn(),
}));

jest.mock('@/service/user', () => ({
  getLoginInfo: jest.fn(),
  queryMyDepartmentRange: jest.fn(),
}));

jest.mock('@/utils/auth', () => ({
  setUserToken: jest.fn(),
}));

jest.mock('@/utils/cookie', () => ({
  __esModule: true,
  default: {
    set: jest.fn(),
  },
}));

import userModel from '../common/user';
import CookieUtil from '@/utils/cookie';
import { setUserToken } from '@/utils/auth';

describe('models/common/user', () => {
  const reducers = (userModel as any).reducers;

  beforeEach(() => {
    jest.clearAllMocks();
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

  it('setUserInfo stores user info, writes cookie/localStorage and calls setUserToken', () => {
    const state = { userInfo: null };
    const payload = {
      data: {
        userCode: 'alice',
        userName: 'Alice',
        registerType: null,
      },
      sessionId: 'session-1',
      token: 'token-1',
    };

    const next = reducers.setUserInfo(state as any, { payload });

    expect((CookieUtil as any).set).toHaveBeenCalledWith('uc', 'alice');
    expect(localStorage.getItem('uc')).toBe('alice');
    expect(setUserToken).toHaveBeenCalledWith(payload);
    expect(next.userInfo).toMatchObject({
      userCode: 'alice',
      userName: 'Alice',
      isRetented: true,
    });
    expect(next.userInfo.loginTime).toBeDefined();
  });

  it('setUserInfo clears cookie when payload has no data', () => {
    const state = { userInfo: { userCode: 'alice' } };
    const next = reducers.setUserInfo(state as any, { payload: {} });

    expect((CookieUtil as any).set).toHaveBeenCalledWith('uc');
    expect(next).toEqual({
      userInfo: null,
    });
  });
});
