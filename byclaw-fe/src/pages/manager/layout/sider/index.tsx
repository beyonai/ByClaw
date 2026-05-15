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
import {
  fallbackMenuConfig,
  filterMenusByAdminVip,
  filterMenusByMenuDisplay,
  getManagerMenuConfig,
  normalizeMenuUrl,
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

  useEffect(() => {
    if (!userInfo) {
      return;
    }

    let mounted = true;

    getManagerMenuConfig({ refresh: true })
      .then((menus) => {
        if (mounted && menus.length > 0) {
          setMenuConfig(menus.filter((item) => item.routePath));
        }
      })
      .catch(() => {
        if (mounted) {
          setMenuConfig(fallbackMenuConfig);
        }
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
      (item) => {
        const name = isEnglish ? item.nameEn || item.name : item.name;

        if (item.localeId) {
          return intl.formatMessage({
            id: item.localeId,
            defaultMessage: name,
          });
        }

        return name;
      },
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
    if (filteredMenus.length === 0) return;

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
  }, [pathname, flatMenuItems, filteredMenus]);

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
