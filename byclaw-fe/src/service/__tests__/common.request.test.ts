jest.mock('@/utils/auth', () => ({
  clearToken: jest.fn(),
  getssoToken: jest.fn(() => 'sso-token'),
  getToken: jest.fn(() => 'access-token'),
  ssotokenKey: 'x-sso-token',
  tokenKey: 'x-token',
  getSessionKey: jest.fn(() => 'session-key'),
  loginRedirect: jest.fn(),
}));

jest.mock('@/utils/signature', () => ({
  generateSignature: jest.fn(() => ({ 'x-signature': 'signed' })),
}));

jest.mock('@umijs/max', () => ({
  getLocale: jest.fn(() => 'zh-CN'),
  history: {
    replace: jest.fn(),
  },
  getIntl: jest.fn(() => ({
    formatMessage: jest.fn(() => 'login expired'),
  })),
}));

jest.mock('antd', () => ({
  message: {
    error: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('@/utils/antdAppModal', () => ({
  showRequestErrorModal: jest.fn(),
}));

jest.mock('@/utils', () => ({
  getRootUnAuthPagePath: jest.fn(() => '/chat'),
  getModelState: jest.fn(),
}));

jest.mock('@/utils/broadcastChannel', () => ({
  __esModule: true,
  default: {
    postMessage: jest.fn(),
    close: jest.fn(),
  },
}));

jest.mock('../user', () => ({
  logout: jest.fn(),
}));

var mockRequest: jest.Mock;
var mockRequestInterceptorUse: jest.Mock;
var mockResponseInterceptorUse: jest.Mock;

jest.mock('axios', () => {
  mockRequest = jest.fn();
  mockRequestInterceptorUse = jest.fn();
  mockResponseInterceptorUse = jest.fn();
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => ({
        request: mockRequest,
        interceptors: {
          request: { use: mockRequestInterceptorUse },
          response: { use: mockResponseInterceptorUse },
        },
      })),
    },
  };
});

import axios from 'axios';
import { message } from 'antd';

import { EXCEED_LIMITED_LOGIN_NUMBER } from '@/constants/error/errorCode';
import BeyondBroadcastChannel from '@/utils/broadcastChannel';
import { clearToken, loginRedirect } from '@/utils/auth';
import { getModelState, getRootUnAuthPagePath } from '@/utils';
import { showRequestErrorModal } from '@/utils/antdAppModal';
import { logout } from '../user';

import { GET, globalLogout, POST } from '../common/request';

const mockAxiosCreate = (axios as any).create as jest.Mock;

describe('Service Common Request', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('globalLogout clears local auth state and redirects when a user exists', async () => {
    (getModelState as jest.Mock).mockReturnValue({
      userInfo: {
        userId: 'u1',
      },
    });

    await expect(globalLogout(true)).resolves.toBeUndefined();

    expect(clearToken).toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
    expect(BeyondBroadcastChannel.postMessage).toHaveBeenCalledWith({ type: 'logout' });
    expect(BeyondBroadcastChannel.close).toHaveBeenCalled();
    expect(loginRedirect).toHaveBeenCalledWith({ openLoginModal: '1' });
  });

  it('GET assembles headers, language and query params', async () => {
    mockRequest.mockResolvedValue({
      data: {
        code: 0,
        data: {
          ok: true,
        },
      },
      config: {
        url: '/api/test',
      },
    });

    const result = await GET('/api/test', { a: 1 });

    expect(result).toEqual({ ok: true });
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/api/test',
        method: 'GET',
        params: {
          a: 1,
          language: 'zh-CN',
        },
        headers: expect.objectContaining({
          'x-token': 'access-token',
          'x-sso-token': 'sso-token',
          'x-session-id': 'session-key',
          language: 'zh-CN',
        }),
      })
    );
  });

  it('POST returns blob metadata when responseType is blob', async () => {
    mockRequest.mockResolvedValue({
      data: new Blob(['hello']),
      headers: {
        get: jest.fn(() => 'attachment; filename=%E6%B5%8B%E8%AF%95.txt'),
      },
    });

    const result = await POST('/api/blob', { id: 1 }, { responseType: 'blob' });

    expect(result).toEqual({
      fileName: '测试.txt',
      file: expect.any(Blob),
    });
  });

  it('shows request error modal and rejects when backend code is not zero', async () => {
    mockRequest.mockResolvedValue({
      data: {
        code: 500,
        msg: 'boom',
      },
      config: {
        url: '/api/fail',
      },
    });

    await expect(POST('/api/fail', { id: 1 })).rejects.toBe('boom');
    expect(showRequestErrorModal).toHaveBeenCalledWith('boom');
  });

  it('redirects to login when login count exceeds the limit', async () => {
    mockRequest.mockResolvedValue({
      data: {
        code: EXCEED_LIMITED_LOGIN_NUMBER,
        msg: 'too many users',
      },
      config: {
        url: '/byaiService/other',
      },
    });

    await expect(POST('/byaiService/other', {})).rejects.toBeUndefined();
    expect(message.error).toHaveBeenCalled();
    await Promise.resolve();
    expect(getRootUnAuthPagePath as jest.Mock).toHaveBeenCalled();
  });
});
