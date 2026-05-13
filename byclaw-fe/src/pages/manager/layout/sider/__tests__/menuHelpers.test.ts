import { buildSiderMenuItems, flattenSiderMenuItems, getInitialOpenKeys } from '../menuHelpers';

describe('manager/layout/sider/menuHelpers', () => {
  it('keeps single-level menu items visible', () => {
    const items = buildSiderMenuItems(
      [
        {
          path: '/manager/dashboard',
          name: 'Dashboard',
          icon: 'icon-dashboard',
        },
      ],
      (item) => item.name || '',
      (icon) => icon
    );

    expect(items).toEqual([
      {
        key: '/manager/dashboard',
        icon: 'icon-dashboard',
        label: 'Dashboard',
      },
    ]);
  });

  it('builds nested menu groups and open keys', () => {
    const menus = [
      {
        path: '/manager/system',
        name: 'System',
        icon: 'icon-system',
        routes: [
          {
            path: '/manager/system/config',
            name: 'Config',
            icon: 'icon-config',
          },
        ],
      },
    ];

    const items = buildSiderMenuItems(
      menus,
      (item) => item.name || '',
      (icon) => icon
    );
    const flatItems = flattenSiderMenuItems(menus);

    expect(items).toEqual([
      {
        key: '/manager/system',
        icon: 'icon-system',
        label: 'System',
        children: [
          {
            key: '/manager/system/config',
            icon: 'icon-config',
            label: 'Config',
          },
        ],
      },
    ]);
    expect(flatItems).toEqual([
      { path: '/manager/system', parentPath: undefined },
      { path: '/manager/system/config', parentPath: '/manager/system' },
    ]);
    expect(getInitialOpenKeys(flatItems)).toEqual(['/manager/system']);
  });

  it('filters hidden menu nodes from rendering output only', () => {
    const menus = [
      {
        path: '/manager/system',
        name: 'System',
        icon: 'icon-system',
        routes: [
          {
            path: '/manager/system/config',
            name: 'Config',
            icon: 'icon-config',
            hideInMenu: true,
          },
          {
            path: '/manager/system/sandbox',
            name: 'Sandbox',
            icon: 'icon-sandbox',
          },
        ],
      },
    ];

    const items = buildSiderMenuItems(
      menus,
      (item) => item.name || '',
      (icon) => icon
    );
    const flatItems = flattenSiderMenuItems(menus);

    expect(items).toEqual([
      {
        key: '/manager/system',
        icon: 'icon-system',
        label: 'System',
        children: [
          {
            key: '/manager/system/sandbox',
            icon: 'icon-sandbox',
            label: 'Sandbox',
          },
        ],
      },
    ]);
    expect(flatItems).toEqual([
      { path: '/manager/system', parentPath: undefined },
      { path: '/manager/system/config', parentPath: '/manager/system' },
      { path: '/manager/system/sandbox', parentPath: '/manager/system' },
    ]);
  });
});
