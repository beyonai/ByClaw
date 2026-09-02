jest.mock('@/pages/manager/service/session', () => ({
  getDcSystemConfig: jest.fn(),
}));

import { getDcSystemConfig } from '@/pages/manager/service/session';
import {
  fallbackMenuConfig,
  getManagerMenuConfig,
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
