jest.mock('@/pages/manager/service/session', () => ({
  getDcSystemConfig: jest.fn(),
}));

import { getDcSystemConfig } from '@/pages/manager/service/session';
import {
  fallbackMenuConfig,
  getManagerMenuConfig,
  getManagerMenuLabel,
  normalizeManagerMenuConfig,
  resetManagerMenuConfigCache,
} from '../menuConfig';

// 源服务文件关闭了类型检查，测试按实际接口响应结构声明 mock，避免被推断成 Promise<undefined>。
const mockGetDcSystemConfig = getDcSystemConfig as unknown as jest.MockedFunction<
  (params: any) => Promise<{ data?: { paramValue?: string } }>
>;

describe('manager/layout/sider/menuConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetManagerMenuConfigCache();
  });

  it.each([
    ['zh-CN', '组织结构管理11'],
    ['en-US', 'Organization Structure 11'],
  ])('uses configured names instead of built-in translations for %s', (locale, expected) => {
    const [menu] = normalizeManagerMenuConfig([
      {
        path: '/manager/org/orgMgr',
        menuCode: 'menu_org',
        menuNameCn: '组织结构管理11',
        menuNameEn: 'Organization Structure 11',
      },
    ]);
    const intl = { locale, formatMessage: jest.fn(() => '组织结构管理') };

    expect(getManagerMenuLabel(menu, intl)).toBe(expected);
    expect(intl.formatMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['en-US', { menuNameCn: '组织结构管理11' }, '组织结构管理11'],
    ['zh-CN', { menuNameEn: 'Organization Structure 11' }, 'Organization Structure 11'],
  ])('falls back to the other configured language for %s', (locale, menu, expected) => {
    expect(getManagerMenuLabel(menu, { locale, formatMessage: jest.fn() })).toBe(expected);
  });

  it('keeps built-in fallback menus localized when no configured name exists', () => {
    const menu = fallbackMenuConfig.find((item) => item.path === '/manager/org/orgMgr')!;
    const intl = { locale: 'en-US', formatMessage: jest.fn(() => 'Organization Structure') };

    expect(getManagerMenuLabel(menu, intl)).toBe('Organization Structure');
    expect(intl.formatMessage).toHaveBeenCalledWith({
      id: 'menu.orgCenter.orgMgr',
      defaultMessage: '组织结构管理',
    });
  });

  it('displays the updated configured name after refreshing a cached menu', async () => {
    const response = (menuNameCn: string) => ({
      data: {
        paramValue: JSON.stringify([{ path: '/manager/org/orgMgr', menuCode: 'menu_org', menuNameCn }]),
      },
    });
    mockGetDcSystemConfig
      .mockResolvedValueOnce(response('组织结构管理'))
      .mockResolvedValueOnce(response('组织结构管理11'));

    await getManagerMenuConfig();
    const [menu] = await getManagerMenuConfig({ refresh: true });

    expect(mockGetDcSystemConfig).toHaveBeenCalledTimes(2);
    expect(getManagerMenuLabel(menu, { locale: 'zh-CN', formatMessage: jest.fn(() => '组织结构管理') })).toBe(
      '组织结构管理11'
    );
  });

  it('does not keep an empty menu response cached', async () => {
    mockGetDcSystemConfig.mockResolvedValueOnce({ data: { paramValue: '[]' } }).mockResolvedValueOnce({
      data: {
        paramValue: JSON.stringify([
          {
            path: '/manager/org/orgMgr',
            menuCode: 'menu_org',
            menuNameCn: '组织结构管理',
            menuOrder: 1,
          },
        ]),
      },
    });

    await expect(getManagerMenuConfig()).resolves.toEqual([]);

    const menus = await getManagerMenuConfig();

    expect(mockGetDcSystemConfig).toHaveBeenCalledTimes(2);
    expect(menus).toMatchObject([
      {
        path: '/manager/org/orgMgr',
        routePath: '/manager/org/orgMgr',
        name: '组织结构管理',
      },
    ]);
  });

  it('normalizes the system feedback menu like the organization menu', () => {
    const menus = normalizeManagerMenuConfig([
      {
        path: '/manager/org/orgMgr',
        menuCode: 'menu_org',
        menuNameCn: '组织结构管理',
        menuOrder: 1,
      },
      {
        path: '/manager/system/feedback',
        menuCode: 'menu_system_feedback',
        menuNameCn: '系统反馈管理',
        menuOrder: 8,
      },
    ]);

    expect(menus).toMatchObject([
      {
        path: '/manager/org/orgMgr',
        routePath: '/manager/org/orgMgr',
        localeId: 'menu.orgCenter.orgMgr',
      },
      {
        path: '/manager/system/feedback',
        routePath: '/manager/system/feedback',
        localeId: 'menu.systemFeedback',
      },
    ]);
    const fallbackSandboxMenu = fallbackMenuConfig.find((item) => item.path === '/manager/systemParams/sandbox');
    expect(fallbackSandboxMenu).toBeDefined();
    expect(fallbackSandboxMenu).not.toHaveProperty('adminVipOnly');
    expect(fallbackMenuConfig).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/manager/system/feedback',
          localeId: 'menu.systemFeedback',
        }),
      ])
    );
  });
});
