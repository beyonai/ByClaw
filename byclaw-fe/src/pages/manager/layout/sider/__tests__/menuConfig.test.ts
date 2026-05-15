jest.mock('@/pages/manager/service/session', () => ({
  getDcSystemConfig: jest.fn(),
}));

import { getDcSystemConfig } from '@/pages/manager/service/session';
import { getManagerMenuConfig, resetManagerMenuConfigCache } from '../menuConfig';

const mockGetDcSystemConfig = getDcSystemConfig as jest.MockedFunction<typeof getDcSystemConfig>;

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
});
