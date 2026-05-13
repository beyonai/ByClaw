import {
  loginByUsername,
  getLoginInfo,
  logout,
  updatePassword,
  batchAdd,
  sendSMS,
  registerByPhone,
  loginByPhone,
} from '../user';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

import { GET, POST } from '@/service/common/request';

const mockGET = GET as jest.MockedFunction<typeof GET>;
const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('User Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loginByUsername', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { username: 'testuser', password: 'password123' };
      const cancelToken = new AbortController();

      loginByUsername(data, cancelToken);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/session/loginByUsername', data, {
        cancelToken,
        responseCfg: {
          hideErrorTips: true,
          customHandle: true,
        },
      });
    });

    it('should call POST without cancelToken', () => {
      const data = { username: 'testuser', password: 'password123' };

      loginByUsername(data);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/session/loginByUsername', data, {
        cancelToken: undefined,
        responseCfg: {
          hideErrorTips: true,
          customHandle: true,
        },
      });
    });
  });

  describe('getLoginInfo', () => {
    it('should call GET with correct endpoint', () => {
      getLoginInfo();

      expect(mockGET).toHaveBeenCalledWith(
        '/byaiService/system/session/currentUser',
        { terminal: 'PC' },
        {
          responseCfg: {
            hideErrorTips: false,
            customHandle: true,
          },
        }
      );
    });
  });

  describe('logout', () => {
    it('should call GET with correct endpoint', () => {
      logout();

      expect(mockGET).toHaveBeenCalledWith('/byaiService/system/session/logout');
    });
  });

  describe('updatePassword', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { oldPassword: 'old123', newPassword: 'new123' };

      updatePassword(data);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/user/updatePassword', data);
    });
  });

  describe('batchAdd', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { leads: [{ name: 'Lead 1' }, { name: 'Lead 2' }] };

      batchAdd(data);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/customer/leads/batchAdd', data);
    });
  });

  describe('sendSMS', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { phone: '13800138000', type: 'login' };

      sendSMS(data);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/session/sms/send', data);
    });
  });

  describe('registerByPhone', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { phone: '13800138000', smsCode: '123456', password: 'password123' };
      const cancelToken = new AbortController();

      registerByPhone(data, cancelToken);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/session/registerByPhone', data, { cancelToken });
    });

    it('should call POST without cancelToken', () => {
      const data = { phone: '13800138000', smsCode: '123456', password: 'password123' };

      registerByPhone(data);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/session/registerByPhone', data, {
        cancelToken: undefined,
      });
    });
  });

  describe('loginByPhone', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { phone: '13800138000', smsCode: '123456' };
      const cancelToken = new AbortController();

      loginByPhone(data, cancelToken);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/session/loginByPhone', data, { cancelToken });
    });

    it('should call POST without cancelToken', () => {
      const data = { phone: '13800138000', smsCode: '123456' };

      loginByPhone(data);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/session/loginByPhone', data, {
        cancelToken: undefined,
      });
    });
  });
});
