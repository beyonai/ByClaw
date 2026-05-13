import {
  convertFlattenMenuToTreeData,
  convertMenuTreeToTreeData,
  convertMenuTreeToUrlList,
  filterRoutesByBlockedPaths,
  findMaxParent,
  flattenMenuTree,
  getMenuTreeLastLevelData,
  getMenuTreeLastMenuIdData,
} from '../menu';

describe('manager/utils/menu', () => {
  const menuTree = [
    {
      menuId: 1,
      menuName: 'Root',
      menuUrl: '/root',
      parentMenuId: -1,
      orderId: 2,
      menuLevel: 1,
      children: [
        {
          menuId: 2,
          menuName: 'Child A',
          menuUrl: '/child-a',
          parentMenuId: 1,
          orderId: 2,
          menuLevel: 2,
        },
        {
          menuId: 3,
          menuName: 'Child B',
          menuUrl: '/child-b',
          parentMenuId: 1,
          orderId: 1,
          menuLevel: 2,
          children: [
            {
              menuId: 4,
              menuName: 'Leaf',
              menuUrl: '/leaf',
              parentMenuId: 3,
              orderId: 1,
              menuLevel: 3,
            },
          ],
        },
      ],
    },
  ];

  it('converts menu tree to tree data', () => {
    expect(convertMenuTreeToTreeData(menuTree)).toEqual([
      {
        title: 'Root',
        key: 1,
        children: [
          { title: 'Child A', key: 2 },
          {
            title: 'Child B',
            key: 3,
            children: [{ title: 'Leaf', key: 4 }],
          },
        ],
      },
    ]);
  });

  it('collects urls from menu tree recursively', () => {
    const result: string[] & { children?: unknown } = [];
    convertMenuTreeToUrlList(
      [
        {
          menuUrl: '/root',
          childList: [{ menuUrl: '/child-a' }, { menuUrl: '/child-b', childList: [{ menuUrl: '/leaf' }] }],
        },
      ],
      result
    );

    expect(Array.from(result)).toEqual(['/root', '/child-a', '/child-b', '/leaf']);
  });

  it('returns only leaf nodes', () => {
    expect(getMenuTreeLastLevelData(menuTree).map((item) => item.menuId)).toEqual([2, 4]);
  });

  it('returns all menu ids in preorder', () => {
    expect(getMenuTreeLastMenuIdData(menuTree)).toEqual([1, 2, 3, 4]);
  });

  it('flattens the menu tree and removes children from items', () => {
    expect(flattenMenuTree(menuTree)).toEqual([
      {
        menuId: 1,
        menuName: 'Root',
        menuUrl: '/root',
        parentMenuId: -1,
        orderId: 2,
        menuLevel: 1,
      },
      {
        menuId: 2,
        menuName: 'Child A',
        menuUrl: '/child-a',
        parentMenuId: 1,
        orderId: 2,
        menuLevel: 2,
      },
      {
        menuId: 3,
        menuName: 'Child B',
        menuUrl: '/child-b',
        parentMenuId: 1,
        orderId: 1,
        menuLevel: 2,
      },
      {
        menuId: 4,
        menuName: 'Leaf',
        menuUrl: '/leaf',
        parentMenuId: 3,
        orderId: 1,
        menuLevel: 3,
      },
    ]);
  });

  it('finds the top-level parent recursively', () => {
    const flattened = flattenMenuTree(menuTree);
    expect(findMaxParent(flattened, flattened[3])).toEqual(flattened[0]);
  });

  it('rebuilds a tree from a flat menu list and sorts by order', () => {
    const result = convertFlattenMenuToTreeData([
      {
        menuId: 3,
        menuName: 'Child B',
        parentMenuId: 1,
        orderId: 2,
        menuLevel: 2,
      },
      {
        menuId: 1,
        menuName: 'Root',
        parentMenuId: -1,
        orderId: 1,
        menuLevel: 1,
      },
      {
        menuId: 2,
        menuName: 'Child A',
        parentMenuId: 1,
        orderId: 1,
        menuLevel: 2,
      },
    ]);

    expect(result).toEqual([
      {
        menuId: 1,
        menuName: 'Root',
        parentMenuId: -1,
        orderId: 1,
        menuLevel: 1,
        children: [
          {
            menuId: 2,
            menuName: 'Child A',
            parentMenuId: 1,
            orderId: 1,
            menuLevel: 2,
          },
          {
            menuId: 3,
            menuName: 'Child B',
            parentMenuId: 1,
            orderId: 2,
            menuLevel: 2,
          },
        ],
      },
    ]);
  });

  describe('filterRoutesByBlockedPaths', () => {
    const routes = [
      {
        path: '/dashboard',
        component: 'Dashboard',
      },
      {
        path: '/admin',
        routes: [
          {
            path: '/admin/users',
            component: 'Users',
          },
          {
            path: '/admin/logs',
            component: 'Logs',
          },
        ],
      },
      {
        path: '/empty',
        routes: [
          {
            path: '/empty/blocked',
            component: 'Blocked',
          },
        ],
      },
      {
        path: '/sider-group',
        routes: [],
      },
    ];

    it('returns routes as-is when blocked paths are empty', () => {
      expect(filterRoutesByBlockedPaths(routes, [])).toBe(routes);
    });

    it('removes blocked leaf routes and empty containers', () => {
      expect(filterRoutesByBlockedPaths(routes, ['/admin/logs', '/empty/blocked'])).toEqual([
        {
          path: '/dashboard',
          component: 'Dashboard',
          routes: undefined,
        },
        {
          path: '/admin',
          routes: [
            {
              path: '/admin/users',
              component: 'Users',
              routes: undefined,
            },
          ],
        },
        {
          path: '/sider-group',
          routes: undefined,
        },
      ]);
    });

    it('drops a whole branch when the parent path is blocked', () => {
      expect(filterRoutesByBlockedPaths(routes, ['/admin'])).toEqual([
        {
          path: '/dashboard',
          component: 'Dashboard',
          routes: undefined,
        },
        {
          path: '/empty',
          routes: [
            {
              path: '/empty/blocked',
              component: 'Blocked',
              routes: undefined,
            },
          ],
        },
        {
          path: '/sider-group',
          routes: undefined,
        },
      ]);
    });
  });
});
