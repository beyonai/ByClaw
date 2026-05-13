jest.mock('@/service/auth', () => ({
  getDcSystemConfigListByStandType: jest.fn(),
}));

jest.mock('@/utils/bot', () => ({
  ssoLoginByIframe: jest.fn(),
}));

jest.mock('../index', () => ({
  getPublicPath: jest.fn(() => '/app/'),
}));

import { getDcSystemConfigListByStandType } from '@/service/auth';
import { ssoLoginByIframe } from '@/utils/bot';
import { SYSTEM_CONFIG_STORAGE_KEY, getVisibleMenuKeysFromConfig } from '@/constants/system';
import { getSsoLoginByIframe, getSystemConfigByStorage, getSystemIcon } from '../system';

const mockGetDcSystemConfigListByStandType = getDcSystemConfigListByStandType as jest.MockedFunction<
  typeof getDcSystemConfigListByStandType
>;
const mockSsoLoginByIframe = ssoLoginByIframe as jest.MockedFunction<typeof ssoLoginByIframe>;

describe('utils/system', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it('getSsoLoginByIframe fetches config and triggers iframe login for each url', async () => {
    mockGetDcSystemConfigListByStandType.mockResolvedValue([
      { paramValue: 'https://a.example.com' },
      { paramValue: 'https://b.example.com' },
    ] as any);

    getSsoLoginByIframe();
    await Promise.resolve();

    expect(mockGetDcSystemConfigListByStandType).toHaveBeenCalledWith({
      standType: 'BYAI_LOGIN_NOTICE_IFRAME_URLLIST',
    });
    expect(mockSsoLoginByIframe).toHaveBeenNthCalledWith(1, 'https://a.example.com');
    expect(mockSsoLoginByIframe).toHaveBeenNthCalledWith(2, 'https://b.example.com');
  });

  it('getSsoLoginByIframe swallows fetch errors', async () => {
    mockGetDcSystemConfigListByStandType.mockRejectedValue(new Error('network'));
    expect(() => getSsoLoginByIframe()).not.toThrow();
    await Promise.resolve();
  });

  it('getSystemConfigByStorage returns parsed config or empty object', () => {
    localStorage.setItem(SYSTEM_CONFIG_STORAGE_KEY, JSON.stringify({ logo: '/logo.png', title: 'ByAI' }));
    expect(getSystemConfigByStorage()).toEqual({ logo: '/logo.png', title: 'ByAI' });

    localStorage.setItem(SYSTEM_CONFIG_STORAGE_KEY, '{invalid');
    expect(getSystemConfigByStorage()).toEqual({});

    localStorage.removeItem(SYSTEM_CONFIG_STORAGE_KEY);
    expect(getSystemConfigByStorage()).toEqual({});
  });

  it('getSystemIcon returns stored logo or default icon', () => {
    expect(getSystemIcon()).toBe('/app/logo.svg');

    localStorage.setItem(SYSTEM_CONFIG_STORAGE_KEY, JSON.stringify({ logo: '/custom-logo.png' }));
    expect(getSystemIcon()).toBe('/custom-logo.png');
  });

  it('getVisibleMenuKeysFromConfig preserves order and removes duplicate menu keys', () => {
    const config = [
      { paramName: '工具', paramValue: 'true', paramSeq: 3 },
      { paramName: '会话', paramValue: 'true', paramSeq: 1 },
      { paramName: '会话', paramValue: 'true', paramSeq: 2 },
      { paramName: '员工', paramValue: 'false', paramSeq: 4 },
      { paramName: '工具', paramValue: 'true', paramSeq: 5 },
    ];

    expect(getVisibleMenuKeysFromConfig(config)).toEqual(['sessions', 'tool']);
  });
});
