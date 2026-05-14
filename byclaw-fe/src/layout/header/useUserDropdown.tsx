import { get, intersection, isEmpty } from 'lodash';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Divider, DropdownProps, theme } from 'antd';
import { useIntl, useNavigate, useSelector } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import { globalLogout } from '@/service/common/request';
import type { UserState } from '@/models/common/user';
import { getRuntimeActualUrl } from '@/utils';
import { isAdminVip } from '@/utils/auth';
import useAppStore from '@/models/common/useAppStore';
import { getDisplayUserNameInChat } from '@/utils/chat';
import { getssoToken, getToken } from '@/utils/auth';
import {
  fallbackMenuConfig,
  filterMenusByAdminVip,
  filterMenusByMenuDisplay,
  getManagerMenuConfig,
  normalizeMenuUrl,
} from '@/pages/manager/layout/sider/menuConfig';
import { filterRoutesByBlockedPaths } from '@/pages/manager/utils/menu';
import styles from './index.module.less';

export default function useUserDropdown(userInfo: UserState['userInfo']) {
  const intl = useIntl();
  const navigate = useNavigate();
  const { blockedPaths } = useSelector(({ menu }: any) => menu);
  const { modal } = App.useApp();

  const { ENV, devConfig } = useAppStore();
  const { token } = theme.useToken();
  const [menuConfig, setMenuConfig] = useState<any[]>(fallbackMenuConfig);

  useEffect(() => {
    let mounted = true;

    getManagerMenuConfig()
      .then((menus) => {
        if (mounted && menus.length > 0) {
          setMenuConfig(menus);
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
  }, []);

  const handleClick = useCallback(
    ({ key }: any) => {
      if (key === 'logout') {
        modal.confirm({
          title: intl.formatMessage({ id: 'contentHeader.confirmOperation' }),
          content: intl.formatMessage({ id: 'contentHeader.confirmLogout' }),
          onOk: () => {
            globalLogout();
          },
          prefixCls: PREFIX_NAME,
        });
        return;
      }
      if (key === 'develop') {
        const ssoToken = getssoToken();
        const devPortalUrl = devConfig?.devPortalUrl?.replace('{sso-token}', ssoToken || '');
        window.open(devPortalUrl, '_blank');
        return;
      }
      const matchedMenu = menuConfig.find((item: any) => item.path === key);
      if (matchedMenu?.menuUrl) {
        let url = normalizeMenuUrl(matchedMenu.menuUrl);
        if (url.includes('${Beyond-token}')) {
          url = url.replace('${Beyond-token}', getToken());
        }
        console.log('menuUrl', url);
        console.log('url', url);
        window.open(url, '_blank');
        return;
      }
      if (key?.startsWith('/manager/')) {
        window.open(`${window.location.origin}${getRuntimeActualUrl(key)}`, '_blank');
        return;
      }
      if (key === 'accessToken') {
        navigate('/accessTokenMgmt');
      } else if (key === 'settings') {
        navigate('/settings');
      } else if (key === 'assistantSettings') {
        navigate('/assistantSettings');
      }
    },
    [devConfig, menuConfig]
  );

  const items = useMemo(() => {
    const usersOrganizations = get(userInfo, 'usersOrganizations') || [];
    const userTypeList = usersOrganizations.map((item: any) => item.userType);

    const isEnterpriseHiden =
      isEmpty(intersection(userTypeList, ['PLAT_MAN', 'ORG_MAN', 'BUSINESS_MAN', 'PLAT_DEVOPS'])) ||
      ENV.includes('enterprise');
    const isDevelopHiden =
      !devConfig?.devPortalUrl ||
      isEmpty(intersection(userTypeList, ['PLAT_MAN', 'DEV_USER'])) ||
      ENV.includes('develop');
    const enterpriseMenuItems = filterRoutesByBlockedPaths(
      filterMenusByMenuDisplay(filterMenusByAdminVip(menuConfig, isAdminVip(userInfo as any)), userInfo),
      blockedPaths || []
    ).map((item: any) => {
      const IconComponent = item.icon;

      return {
        key: item.path,
        icon: IconComponent ? <IconComponent className={styles.menuIcon} /> : null,
        label: item.localeId
          ? intl.formatMessage({
            id: item.localeId,
            defaultMessage: item.name,
          })
          : item.name,
      };
    });

    const m: any[] = [
      {
        key: 'settings',
        icon: <AntdIcon type="icon-a-shouye-Setting-twoshezhi" className={styles.menuIcon} />,
        label: intl.formatMessage({ id: 'contentHeader.settings' }),
        hidden: ENV.includes('settings'),
      },
      // {
      //   key: 'assistantSettings',
      //   icon: <AntdIcon type="icon-shuziyuangong" className={styles.menuIcon} />,
      //   label: intl.formatMessage({ id: 'contentHeader.AssistantSettings' }),
      //   hidden: ENV.includes('assistantSettings'),
      // },
      {
        type: 'divider',
        hidden: ENV.includes('settings') && ENV.includes('assistantSettings'),
      },
      // 企业后台管理
      {
        key: 'enterprise',
        icon: <AntdIcon type="icon-a-shouye-Setting-computerjisuanjishezhi" className={styles.menuIcon} />,
        label: intl.formatMessage({ id: 'contentHeader.enterpriseAdmin' }),
        children: enterpriseMenuItems,
        hidden: isEnterpriseHiden || enterpriseMenuItems.length === 0,
      },
      // 开发平台管理
      {
        key: 'develop',
        icon: <AntdIcon type="icon-a-Systemxitong1" className={styles.menuIcon} />,
        label: intl.formatMessage({ id: 'contentHeader.developAdmin' }),
        hidden: isDevelopHiden,
      },

      {
        key: 'accessToken',
        icon: <AntdIcon type="icon-a-Protectbaohu" className={styles.menuIcon} />,
        label: intl.formatMessage({ id: 'contentHeader.accessTokenMgmt' }),
        hidden: ENV.includes('accessToken'),
      },
      {
        type: 'divider',
        hidden: ENV.includes('accessToken') && isDevelopHiden && isEnterpriseHiden,
      },
      {
        key: 'logout',
        icon: <AntdIcon type="icon-a-shouye-Logouttuichu" className={styles.menuIcon} />,
        label: intl.formatMessage({ id: 'contentHeader.logout' }),
        hidden: ENV.includes('logout'),
      },
    ];

    return m.filter((i) => !i.hidden);
  }, [userInfo, ENV, devConfig, blockedPaths, menuConfig]);

  const dropdownRender = useCallback<Required<DropdownProps>['dropdownRender']>(
    (menu) => {
      const contentStyle: React.CSSProperties = {
        background: 'linear-gradient(rgb(232,236,254) 0%, #ffffff 20%)',
        borderRadius: 12,
        boxShadow: token.boxShadow,
        padding: 4,
        position: 'relative',
      };
      const menuStyle: React.CSSProperties = {
        boxShadow: 'none',
        borderRadius: 0,
        background: 'transparent',
      };
      const positionName = Array.from(
        new Set(userInfo?.usersOrganizations?.map((item: { positionName: string }) => item.positionName))
      ).join(', ');
      return (
        <div style={contentStyle}>
          <div className={styles.userDropdownTopInfo}>
            <div className={styles.userName} style={{ background: token.colorPrimary }}>
              {getDisplayUserNameInChat(userInfo?.userName ?? '')}
            </div>
            <div style={{ marginLeft: 8, flex: 1, overflow: 'hidden' }}>
              <div style={{ fontWeight: token.fontWeightStrong }}>{userInfo?.userName ?? ''}</div>
              <div
                className="textEllipsis"
                title={positionName}
                style={{ fontSize: 12, lineHeight: '20px', color: token.colorTextTertiary, maxWidth: 180 }}
              >
                {positionName}
              </div>
            </div>
          </div>
          <Divider style={{ margin: 0 }} />
          {React.cloneElement(
            menu as React.ReactElement<{
              style: React.CSSProperties;
              className: string;
            }>,
            { style: menuStyle, className: styles.userDropdownMenu }
          )}
        </div>
      );
    },
    [userInfo]
  );

  return {
    userDropdownRender: dropdownRender,
    userDropdownItems: items,
    onUserDropdownClick: handleClick,
  };
}
