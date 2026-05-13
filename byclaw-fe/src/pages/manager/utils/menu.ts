// @ts-nocheck
/* eslint-disable */
import { isEmpty } from 'lodash';

export function convertMenuTreeToTreeData(data) {
  return data.map((o) => {
    const { menuId, menuName, children } = o;
    const result = {
      title: menuName,
      key: menuId,
    };
    if (children) {
      result.children = convertMenuTreeToTreeData(children);
    }
    return result;
  });
}

export function convertMenuTreeToUrlList(data, result) {
  return data.map((o) => {
    const { menuUrl, childList } = o;
    if (menuUrl) {
      result.push(menuUrl);
    }
    if (childList) {
      result.children = convertMenuTreeToUrlList(childList, result);
    }
    return result;
  });
}

export function getMenuTreeLastLevelData(data) {
  const result = [];
  data.forEach((o) => {
    const { children } = o;
    if (children) {
      const childs = getMenuTreeLastLevelData(children);
      result.push(...childs);
    } else {
      result.push(o);
    }
  });
  return result;
}

export function getMenuTreeLastMenuIdData(data) {
  const result = [];
  data.forEach((o) => {
    const { children, menuId } = o;
    result.push(menuId);
    if (children) {
      const childs = getMenuTreeLastMenuIdData(children);
      result.push(...childs);
    }
  });
  return result;
}

export function flattenMenuTree(data) {
  const result = [];
  data.forEach((o) => {
    const { children, ...otherProps } = o;
    result.push(otherProps);
    if (children) {
      const childrenMenus = flattenMenuTree(children);
      result.push(...childrenMenus);
    }
  });
  return result;
}

export function findMaxParent(flattenMenus, menu) {
  const { parentMenuId } = menu;
  if (parentMenuId === -1) {
    return menu;
  } else {
    const parentMenu = flattenMenus.find((o) => o.menuId === parentMenuId);
    return findMaxParent(flattenMenus, parentMenu);
  }
}

export function convertFlattenMenuToTreeData(menus) {
  const sortedMenus = menus.sort((a, b) => b.menuLevel - a.menuLevel);
  sortedMenus.sort((a, b) => a.orderId - b.orderId);
  sortedMenus.forEach((o) => {
    const { parentMenuId } = o;
    const parentMenu = menus.find((o) => o.menuId === parentMenuId);
    if (!parentMenu) {
      return;
    }
    if (!parentMenu.children) {
      parentMenu.children = [];
    }
    parentMenu.children.push(o);
  });
  return menus.filter((o) => o.parentMenuId === -1);
}

export function filterRoutesByBlockedPaths(routes, blockedPaths) {
  if (isEmpty(blockedPaths)) {
    return routes;
  }

  const blocked = new Set(blockedPaths);

  const walk = (list) =>
    list
      .map((item) => {
        // 1) 命中要过滤的 path，则整节点连同子孙一起丢弃
        if (blocked.has(item.path)) return null;

        // 2) 递归过滤子路由
        const filteredChildren = item.routes ? walk(item.routes) : [];

        // 3) 判断是否保留当前节点
        const hasComponent = Boolean(item.component);
        const hasChildren = filteredChildren.length > 0;
        const isLeaf = !item.routes || item.routes.length === 0;

        // 叶子节点（无子路由）即使没有 component 也保留（如 sider menuConfig）
        // 非叶子节点若子节点全被过滤且自身无 component，说明是空容器，丢弃
        if (!isLeaf && !hasComponent && !hasChildren) return null;

        return {
          ...item,
          routes: hasChildren ? filteredChildren : undefined,
        };
      })
      .filter((v) => Boolean(v));

  return walk(routes);
}
