import {
  getSSOUrl,
  iwhaleCallback,
  dingtalkCallback,
  getCaptcha,
  getAccessToken,
  createAccessToken,
  removeAccessToken,
  getDebugSession,
  getDcSystemConfigListByStandType,
  getDcSystemConfigValueByCode,
} from '../auth';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

import { GET, POST } from '@/service/common/request';

const mockGET = GET as jest.MockedFunction<typeof GET>;
const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('Auth Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getSSOUrl', () => {
    it('should call GET with systemCode in query string', () => {
      const systemCode = 'test-system';

      getSSOUrl(systemCode);

      expect(mockGET).toHaveBeenCalledWith(`/byaiService/system/social/getSSOUrl?systemCode=${systemCode}`);
    });
  });

  describe('iwhaleCallback', () => {
    it('should call GET with payload', () => {
      const payload = { code: 'auth-code', state: 'state-value' };

      iwhaleCallback(payload);

      expect(mockGET).toHaveBeenCalledWith('/byaiService/system/social/iwhaleCallback', payload);
    });

    it('should call GET with empty object when no payload provided', () => {
      iwhaleCallback();

      expect(mockGET).toHaveBeenCalledWith('/byaiService/system/social/iwhaleCallback', {});
    });
  });

  describe('dingtalkCallback', () => {
    it('should call GET with payload', () => {
      const payload = { code: 'dingtalk-code', state: 'state-value' };

      dingtalkCallback(payload);

      expect(mockGET).toHaveBeenCalledWith('/byaiService/system/social/dingtalkCallback', payload);
    });

    it('should call GET with empty object when no payload provided', () => {
      dingtalkCallback();

      expect(mockGET).toHaveBeenCalledWith('/byaiService/system/social/dingtalkCallback', {});
    });
  });

  describe('getCaptcha', () => {
    it('should call GET with responseType blob', () => {
      const payload = { width: 120, height: 40 };

      getCaptcha(payload);

      expect(mockGET).toHaveBeenCalledWith('/byaiService/system/session/captcha', payload, {
        responseType: 'blob',
      });
    });

    it('should call GET with empty payload and responseType blob', () => {
      getCaptcha();

      expect(mockGET).toHaveBeenCalledWith(
        '/byaiService/system/session/captcha',
        {},
        {
          responseType: 'blob',
        }
      );
    });
  });

  describe('getAccessToken', () => {
    it('should call POST with payload', () => {
      const payload = { userId: 'user123' };

      getAccessToken(payload);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/userAccessToken/list', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      getAccessToken();

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/userAccessToken/list', {});
    });
  });

  describe('createAccessToken', () => {
    it('should call POST with payload', () => {
      const payload = { name: 'Test Token', expiresIn: 3600 };

      createAccessToken(payload);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/userAccessToken/createToken', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      createAccessToken();

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/userAccessToken/createToken', {});
    });
  });

  describe('removeAccessToken', () => {
    it('should call POST with payload', () => {
      const payload = { tokenId: 'token123' };

      removeAccessToken(payload);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/userAccessToken/removeToken', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      removeAccessToken();

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/userAccessToken/removeToken', {});
    });
  });

  describe('getDebugSession', () => {
    it('should call GET with agentId', () => {
      const payload = { agentId: 'agent123' };

      getDebugSession(payload);

      expect(mockGET).toHaveBeenCalledWith('/byaiService/digitalEmployeeController/debugSession', payload);
    });

    it('should call GET with empty object when no payload provided', () => {
      getDebugSession();

      expect(mockGET).toHaveBeenCalledWith('/byaiService/digitalEmployeeController/debugSession', {});
    });
  });

  describe('getDcSystemConfigListByStandType', () => {
    it('should call POST with payload', () => {
      const payload = { standType: 'production' };

      getDcSystemConfigListByStandType(payload);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/staticdata/getDcSystemConfigListByStandType', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      getDcSystemConfigListByStandType();

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/staticdata/getDcSystemConfigListByStandType', {});
    });
  });

  describe('getDcSystemConfigValueByCode', () => {
    it('should call POST with payload', () => {
      const payload = { code: 'config-key' };

      getDcSystemConfigValueByCode(payload);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/session/getDcSystemConfigValueByCode', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      getDcSystemConfigValueByCode();

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/session/getDcSystemConfigValueByCode', {});
    });
  });
});
