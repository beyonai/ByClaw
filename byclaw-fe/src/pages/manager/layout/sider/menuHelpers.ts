type MenuNode = {
  path: string;
  name?: string;
  localeId?: string;
  icon?: unknown;
  hideInMenu?: boolean;
  routes?: MenuNode[];
};

type FlatMenuItem = {
  path: string;
  parentPath?: string;
};

type MenuItem = {
  key: string;
  icon?: unknown;
  label: string;
  children?: MenuItem[];
};

export function buildSiderMenuItems(
  menus: MenuNode[],
  formatLabel: (item: MenuNode) => string,
  renderIcon: (icon?: unknown) => unknown
): MenuItem[] {
  const buildMenuItem = (item: MenuNode): MenuItem | null => {
    if (item.hideInMenu) return null;

    const children = (item.routes || []).map((child) => buildMenuItem(child)).filter(Boolean) as MenuItem[];
    const baseItem = {
      key: item.path,
      icon: renderIcon(item.icon),
      label: formatLabel(item),
    };

    return children.length > 0 ? { ...baseItem, children } : baseItem;
  };

  return menus.map((item) => buildMenuItem(item)).filter(Boolean) as MenuItem[];
}

export function flattenSiderMenuItems(menus: MenuNode[], parentPath?: string): FlatMenuItem[] {
  return menus.flatMap((item) => {
    const currentItem = { path: item.path, parentPath };

    if (!item.routes?.length) {
      return [currentItem];
    }

    return [currentItem, ...flattenSiderMenuItems(item.routes, item.path)];
  });
}

export function getInitialOpenKeys(flatMenuItems: FlatMenuItem[]): string[] {
  return [...new Set(flatMenuItems.filter((item) => item.parentPath).map((item) => item.parentPath!))];
}
