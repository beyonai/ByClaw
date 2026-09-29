// @ts-nocheck
import React, { useEffect, useState, useMemo } from 'react';
import classNames from 'classnames';
import { Menu, Button, Dropdown } from 'antd';
import { MenuUnfoldOutlined, MenuFoldOutlined } from '@ant-design/icons';
import { useLocation, useNavigate, useSelector, useIntl, getLocale, setLocale } from '@umijs/max';

import { filterRoutesByBlockedPaths } from '@/pages/manager/utils/menu';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import UserDropdown from '@/pages/manager/layout/sider/components/userDropdown';

import { isAdminVip } from '@/pages/manager/utils/auth';
import { getWorkgroupTemplateCapability } from '@/pages/manager/service/WorkgroupTemplate';
import { getAppVersionCapability } from '@/pages/manager/service/AppVersion';
import {
  fallbackMenuConfig,
  filterAppVersionMenu,
  filterMenusByAdminVip,
  filterMenusByMenuDisplay,
  getManagerMenuConfig,
  getManagerMenuLabel,
  normalizeMenuUrl,
  withWorkgroupTemplateMenu,
} from './menuConfig';
import { buildSiderMenuItems, flattenSiderMenuItems, getInitialOpenKeys } from './menuHelpers';

import styles from './index.module.less';

const LocaleDropdown = () => {
  const locale = getLocale() || 'zh-CN';

  return (
    <Dropdown
      menu={{
        selectedKeys: [locale],
        items: [
          {
            key: 'en-US',
            label: 'us English',
          },
          {
            key: 'zh-CN',
            label: 'cn 简体中文',
          },
        ],
        onClick: ({ key }) => setLocale(key),
      }}
    >
      <Button type="text" size="small">
        <AntdIcon type="icon-a-Translatefanyi" style={{ fontSize: 18 }} />
      </Button>
    </Dropdown>
  );
};

const Sider: React.FC = () => {
  const intl = useIntl();
  const location = useLocation();
  const navigate = useNavigate();
  const locale = getLocale() || 'zh-CN';
  const isEnglish = locale === 'en-US';

  const { blockedPaths } = useSelector(({ menu }) => menu);
  const userInfo = useSelector(({ user }) => user.userInfo);

  const { pathname: rawPathname } = location;
  const pathname = rawPathname === '/' ? '/' : rawPathname.replace(/\/$/, '');

  const [collapsed, setCollapsed] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [menuConfig, setMenuConfig] = useState<any[]>(fallbackMenuConfig);
  const [menuConfigReady, setMenuConfigReady] = useState(false);

  useEffect(() => {
    if (!userInfo) {
      return;
    }

    let mounted = true;
    setMenuConfigReady(false);

    const canManageTemplates = isAdminVip(userInfo)
      ? getWorkgroupTemplateCapability().catch(() => false)
      : Promise.resolve(false);
    const canManageAppVersions = isAdminVip(userInfo)
      ? getAppVersionCapability().catch(() => false)
      : Promise.resolve(false);

    Promise.all([getManagerMenuConfig({ refresh: true }), canManageTemplates, canManageAppVersions])
      .then(([menus, templateAllowed, appVersionAllowed]) => {
        if (!mounted) return;
        const baseMenus = menus.length > 0 ? menus.filter((item) => item.routePath) : fallbackMenuConfig;
        // App 版本管理菜单项来自后台菜单配置，这里只按管理权限隐藏。
        setMenuConfig(filterAppVersionMenu(withWorkgroupTemplateMenu(baseMenus, templateAllowed), appVersionAllowed));
        setMenuConfigReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        setMenuConfig(filterAppVersionMenu(withWorkgroupTemplateMenu(fallbackMenuConfig, false), false));
        setMenuConfigReady(true);
      });

    return () => {
      mounted = false;
    };
  }, [userInfo?.userId]);

  // Filter menu items by blockedPaths
  const filteredMenus = useMemo(() => {
    // 根据userInfo判断isAdminVip过滤menuConfig中的adminVipOnly
    const filterMenus = filterMenusByMenuDisplay(filterMenusByAdminVip(menuConfig, isAdminVip(userInfo)), userInfo);

    // blockedPaths 为 null 表示接口还未返回，先展示全部菜单；为空数组表示无需屏蔽
    return filterRoutesByBlockedPaths(filterMenus, blockedPaths || []);
  }, [blockedPaths, menuConfig, userInfo]);

  // Build antd Menu items from filtered config
  const menuItems = useMemo(() => {
    return buildSiderMenuItems(
      filteredMenus,
      (item) => getManagerMenuLabel(item, intl),
      (icon) => {
        const IconComponent = icon;
        return IconComponent ? <IconComponent style={{ fontSize: 16 }} /> : null;
      }
    );
  }, [filteredMenus, intl]);

  // Helper: flatten menu routes to find current path info
  const flatMenuItems = useMemo(() => flattenSiderMenuItems(filteredMenus), [filteredMenus]);

  // Update selected/open keys based on current pathname
  useEffect(() => {
    // 动态菜单返回前不能用旧兜底权限判断当前路由，否则沙箱等合法页面会被提前重定向到第一个菜单。
    if (!menuConfigReady || filteredMenus.length === 0) return;

    const hiddenDetailPages = ['/manager/resource/employeeDetail'];
    const isHiddenDetailPage = hiddenDetailPages.some((page) => pathname === page || pathname.startsWith(`${page}/`));

    if (isHiddenDetailPage) {
      setSelectedKeys([]);
      return;
    }

    const matched = flatMenuItems.find((item) => item.path === pathname);
    if (matched) {
      setSelectedKeys([matched.path]);
      if (matched.parentPath) {
        setOpenKeys((prev) => [...new Set([...prev, matched.parentPath!])]);
      }
    } else {
      // If no match, redirect to first available menu item
      const first = flatMenuItems[0];
      if (first) {
        navigate(first.path, { replace: true });
      }
    }
  }, [pathname, flatMenuItems, filteredMenus, menuConfigReady]);

  // Initialize open keys when menus load
  useEffect(() => {
    if (filteredMenus.length > 0) {
      setOpenKeys(getInitialOpenKeys(flatMenuItems));
    }
  }, [filteredMenus, flatMenuItems]);

  const handleMenuClick = ({ key }: { key: string }) => {
    const menu = flatMenuItems.find((item) => item.path === key);
    if (menu?.menuUrl) {
      window.open(normalizeMenuUrl(menu.menuUrl), '_blank');
      return;
    }

    navigate(menu?.routePath || key);
  };

  return (
    <div className={styles.sider} style={{ width: collapsed ? 64 : isEnglish ? 260 : 200 }}>
      <div className={styles.menu}>
        <Menu
          inlineCollapsed={collapsed}
          mode="inline"
          openKeys={openKeys}
          theme="light"
          style={{
            height: '100%',
            border: 'none',
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
          selectedKeys={selectedKeys}
          onOpenChange={(keys) => setOpenKeys(keys)}
          onClick={handleMenuClick}
          items={menuItems}
        />
      </div>
      <div className={classNames(styles.footer, 'ub gap4')}>
        <div className="ub-f1">{!collapsed && <UserDropdown />}</div>
        <div
          className={classNames('ub gap4', {
            'ub-ver': collapsed,
          })}
        >
          <LocaleDropdown />
          <Button onClick={() => setCollapsed((prev) => !prev)} type="text" size="small">
            {collapsed ? (
              <MenuUnfoldOutlined style={{ fontSize: 16 }} />
            ) : (
              <MenuFoldOutlined style={{ fontSize: 16 }} />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Sider;
