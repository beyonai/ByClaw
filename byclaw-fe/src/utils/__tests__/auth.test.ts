jest.mock('@/utils', () => ({
  getRuntimeActualUrl: jest.fn((value: string) => value),
  getRootUnAuthPagePath: jest.fn(() => '/login'),
}));

jest.mock('../cookie', () => ({
  __esModule: true,
  default: {
    clearDelete: jest.fn(),
    set: jest.fn(),
  },
}));

jest.mock('@/service/layout', () => ({
  getDcSystemConfigValueByCodes: jest.fn(),
}));

const loadAuthModule = () => require('../auth');

describe('utils/auth', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    localStorage.clear();
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'https://example.com',
        search: '?foo=1',
        replace: jest.fn(),
      },
      writable: true,
      configurable: true,
    });
  });

  it('loginRedirect merges existing query params and redirects', () => {
    const { loginRedirect } = loadAuthModule();

    loginRedirect({ bar: '2', foo: '9' });

    expect(window.location.replace).toHaveBeenCalledWith('https://example.com/login?foo=9&bar=2');
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('clearToken clears cookie and localStorage keys', () => {
    const auth = loadAuthModule();
    const cookie = require('../cookie').default;

    localStorage.setItem(auth.sessionKey, 's1');
    localStorage.setItem(auth.portalSessionKey, 'p1');
    localStorage.setItem(auth.tokenKey, 't1');
    localStorage.setItem(auth.ssotokenKey, 'sso1');

    auth.clearToken();

    expect(cookie.clearDelete).toHaveBeenCalled();
    expect(localStorage.getItem(auth.sessionKey)).toBeNull();
    expect(localStorage.getItem(auth.portalSessionKey)).toBeNull();
    expect(localStorage.getItem(auth.tokenKey)).toBeNull();
    expect(localStorage.getItem(auth.ssotokenKey)).toBeNull();
  });

  it('setUserToken writes session, portal session, token and sso token', () => {
    const auth = loadAuthModule();
    const cookie = require('../cookie').default;

    auth.setUserToken({
      sessionId: 'session-1',
      token: 'token-1',
      ssoToken: 'sso-1',
    });

    expect(cookie.set).toHaveBeenNthCalledWith(1, auth.sessionKey, 'session-1');
    expect(cookie.set).toHaveBeenNthCalledWith(2, auth.portalSessionKey, 'session-1');
    expect(auth.getSessionKey()).toBe('session-1');
    expect(auth.getToken()).toBe('token-1');
    expect(auth.getssoToken()).toBe('sso-1');
  });

  it('initAdminVipList caches config values from service', async () => {
    const auth = loadAuthModule();
    const { getDcSystemConfigValueByCodes } = require('@/service/layout');
    getDcSystemConfigValueByCodes.mockResolvedValue([{ paramCode: 'USERCODE', paramValue: '["alice","bob"]' }]);

    await auth.initAdminVipList();

    expect(auth.isAdminVip({ userCode: 'adminvip' })).toBe(true);
    expect(auth.isAdminVip({ userCode: 'alice' })).toBe(true);
    expect(auth.isAdminVip({ userCode: 'nobody' })).toBe(false);
  });

  it('initAdminVipList falls back to default when paramValue is invalid json', async () => {
    const auth = loadAuthModule();
    const { getDcSystemConfigValueByCodes } = require('@/service/layout');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    getDcSystemConfigValueByCodes.mockResolvedValue([{ paramCode: 'USERCODE', paramValue: '{invalid}' }]);

    await auth.initAdminVipList();

    expect(auth.isAdminVip({ userCode: 'adminvip' })).toBe(true);
    expect(auth.isAdminVip({ userCode: 'alice' })).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('isAdminVip triggers async init and uses adminvip fallback before cache is ready', () => {
    const auth = loadAuthModule();
    const { getDcSystemConfigValueByCodes } = require('@/service/layout');
    getDcSystemConfigValueByCodes.mockResolvedValue([]);

    expect(auth.isAdminVip({ userCode: 'adminvip' })).toBe(true);
    expect(auth.isAdminVip({ userCode: 'alice' })).toBe(false);
    expect(getDcSystemConfigValueByCodes).toHaveBeenCalledWith({
      paramCodes: ['USERCODE_CONFIG'],
    });
  });
});
