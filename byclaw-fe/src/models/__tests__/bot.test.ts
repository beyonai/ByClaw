jest.mock('antd', () => ({
  message: {
    error: jest.fn(),
  },
}));

jest.mock('@/service/bot', () => ({
  logged: jest.fn(),
}));

jest.mock('@/utils/auth', () => ({
  getssoToken: jest.fn(() => 'sso-token'),
}));

jest.mock('@/utils/bot', () => ({
  setBotSelectedTenantID: jest.fn(),
  getBotSelectedTenantID: jest.fn(() => 'tenant-cached'),
}));

import { message } from 'antd';
import botModel from '../bot';

describe('models/bot', () => {
  const reducers = (botModel as any).reducers;
  const effects = (botModel as any).effects;
  const sagaHelpers = {
    select: (fn: any) => ({ type: 'select', fn }),
    put: (action: any) => ({ type: 'put', action }),
    call: (fn: any, ...args: any[]) => ({ type: 'call', fn, args }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('save reducer merges payload', () => {
    expect(reducers.save({ hasLogined: false }, { payload: { hasLogined: true } })).toEqual({
      hasLogined: true,
    });
  });

  it('botLogin returns cached tenant when already logged in', () => {
    const iterator = effects.botLogin({ payload: {} }, sagaHelpers);

    expect(iterator.next().value).toEqual({
      type: 'select',
      fn: expect.any(Function),
    });
    expect(iterator.next(true).value).toBe('tenant-cached');
    expect(iterator.next().done).toBe(true);
  });

  it('botLogin performs login and saves state when not logged in', () => {
    const iterator = effects.botLogin({ payload: {} }, sagaHelpers);

    iterator.next();
    expect(iterator.next(false).value).toEqual({
      type: 'call',
      fn: expect.any(Function),
      args: [
        {
          'sso-token': 'sso-token',
          systemCode: 'BYAI',
        },
      ],
    });

    const boteInfo = {
      loginInfo: { defaultTenantId: 'tenant-1' },
    };

    expect(iterator.next(boteInfo).value).toEqual({
      type: 'put',
      action: {
        type: 'save',
        payload: { hasLogined: true },
      },
    });

    expect(iterator.next().value).toBe('tenant-1');
  });

  it('botLogin reports error and returns false when login fails', () => {
    const iterator = effects.botLogin({ payload: {} }, sagaHelpers);

    iterator.next();
    iterator.next(false);
    expect(iterator.throw(new Error('fail')).value).toBe(false);
    expect((message as any).error).toHaveBeenCalledWith('bot Login error');
  });
});
