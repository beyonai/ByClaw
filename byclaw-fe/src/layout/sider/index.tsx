import React from 'react';

import { CaretLeftOutlined, CaretRightOutlined } from '@ant-design/icons';
// @ts-ignore
import { useSelector, SelectLang, useIntl, useNavigate, useLocation } from '@umijs/max';
import { Badge, theme, Divider, Dropdown, Tooltip } from 'antd';
import classnames from 'classnames';
import { omit, compact } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import useAppStore from '@/models/common/useAppStore';
import SiderContent, { tabItems } from './components/SiderContent';

import { getRuntimeActualUrl } from '@/utils';
import { getSystemConfigByStorage } from '@/utils/system';
import { agentMap, agentTypeMap } from '@/constants/agent';
import useVisibleMenuKeys from './useVisibleMenuKeys';

import styles from './index.module.less';
import Icon from '@/components/AntdIcon/icon';
import Feedback from '../header/components/Feedback';
import useUserDropdown from '../header/useUserDropdown';
import SiderSearch from './siderSearch';
import useNewChat from '../header/components/NewChat/useNewChat';
import { getDisplayUserNameInChat } from '@/utils/chat';
import useGlobal from '@/hooks/useGlobal';

import type { IState as IEmployeesState } from '@/models/useEmployees';
import { SiderContentContext, DEFAULT_SIDER_CONTENT_WIDTH } from './siderContentContext';

export const DEF_SIDER = 'sessions';

const SIDER_ACTIVE_TAB_BY_PATH: Partial<Record<string, (typeof tabItems)[number]['key']>> = {
  '/knowledgeDetail': 'knowledge',
};

const getCurrentTabByPathname = (pathname: string) => {
  const matchedTabKey = Object.entries(SIDER_ACTIVE_TAB_BY_PATH).find(([path]) => pathname.startsWith(path))?.[1];

  if (matchedTabKey) {
    return tabItems.find((item) => item.key === matchedTabKey);
  }

  return tabItems.find((item) => item.navigatePath && pathname.startsWith(item.navigatePath));
};

const Sidebar = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const { isSiderCollapsed, setSiderCollapsed } = useAppStore();
  const { EventEmitter } = useGlobal();

  const { userInfo } = useSelector(({ user }: any) => ({
    userInfo: user.userInfo,
  }));
  const { unreadInfo } = useSelector(({ session }: any) => ({
    unreadInfo: session.unreadInfo,
  }));
  const { agentList, employeesList } = useSelector(({ employees }: { employees: IEmployeesState }) => ({
    agentList: employees.agentList,
    employeesList: employees.employeesList,
  }));

  const visibleKeys = useVisibleMenuKeys(userInfo);

  const { totalUnread } = unreadInfo;
  const { token } = theme.useToken();
  const intl = useIntl();
  const currentTab = React.useMemo(() => getCurrentTabByPathname(pathname), [pathname]);
  const shouldHideSiderContent = React.useMemo(() => {
    return Boolean(currentTab?.hideSider);
  }, [currentTab]);
  const [activeKey, setActiveKey] = React.useState<(typeof tabItems)[number]['key']>(
    () => currentTab?.key ?? DEF_SIDER
  );
  const [siderContentWidth, setSiderContentWidth] = React.useState(() => {
    if (shouldHideSiderContent) {
      return 0;
    }

    return DEFAULT_SIDER_CONTENT_WIDTH;
  });

  const handleNewChat = useNewChat();

  const showSearchAndQueryTab = React.useMemo(() => {
    const hasEmployee = [...agentList, ...employeesList].find((agent) =>
      [agentTypeMap.searchAndQuery, agentTypeMap.functionCloud].includes(agent?.agentType as any)
    );
    const paths = [agentMap[agentTypeMap.searchAndQuery]?.path, agentMap[agentTypeMap.functionCloud]?.path];

    return hasEmployee && paths.includes(pathname);
  }, [agentList, employeesList, pathname]);

  const myTabItems = React.useMemo(() => {
    return compact(
      visibleKeys.map((key) => {
        const tab = tabItems.find((item) => item.key === key);
        if (!tab) {
          return null;
        }
        if (tab.key === 'sessions') {
          // 会话 tab 显示未读消息数量或 WebSocket 通知红点
          let count = 0;
          if (totalUnread > 0) {
            count = 1;
          }
          return { ...omit(tab, ['ChildComponent']), count, showDot: count > 0 };
        }
        if (tab.key === 'searchAndQuery') {
          if (!showSearchAndQueryTab) {
            return null;
          }
        }
        return tab;
      })
    );
  }, [totalUnread, showSearchAndQueryTab, visibleKeys]);

  const { userDropdownItems, onUserDropdownClick, userDropdownRender } = useUserDropdown(userInfo);

  const getFaviconIcon = React.useMemo(() => {
    const defaultIcon = getRuntimeActualUrl('/favicon.svg');
    return getSystemConfigByStorage().favicon || defaultIcon;
  }, []);

  // 新手指引时，需要点击左侧菜单
  React.useEffect(() => {
    const handleSetSiderActiveKey = (key: string) => {
      setActiveKey(key);
      setSiderCollapsed(false); // 确保侧边栏展开
    };

    EventEmitter.on('set-sider-active-key', handleSetSiderActiveKey);

    return () => {
      EventEmitter.off('set-sider-active-key', handleSetSiderActiveKey);
    };
  }, [EventEmitter, setSiderCollapsed]);

  React.useEffect(() => {
    setSiderContentWidth(shouldHideSiderContent ? 0 : DEFAULT_SIDER_CONTENT_WIDTH);
  }, [activeKey, shouldHideSiderContent]);

  React.useEffect(() => {
    const hasKey = myTabItems.find((tab) => tab.key === activeKey);
    if (!hasKey) {
      setActiveKey(DEF_SIDER);
    }
  }, [activeKey, myTabItems]);

  React.useEffect(() => {
    const hasKey = myTabItems.find((tab) => tab.key === currentTab?.key);

    setSiderContentWidth(shouldHideSiderContent ? 0 : DEFAULT_SIDER_CONTENT_WIDTH);

    if (currentTab && hasKey) {
      setActiveKey(currentTab.key);
    }
  }, [currentTab, myTabItems, shouldHideSiderContent]);

  if (!userInfo) return null;

  return (
    <>
      <div className={classnames(styles.siderBar, 'hideThumb')}>
        <div className={styles.logo}>
          <img alt="BYAI" src={getFaviconIcon} />
        </div>
        <SiderSearch />
        <Tooltip placement="right" title={intl.formatMessage({ id: 'sider.newChat' })}>
          <div className={styles.sideIconWrap} onClick={handleNewChat}>
            <Icon type="icon-xinjianduihua-fill" style={{ color: token.colorPrimary }} />
          </div>
        </Tooltip>
        <Divider type="horizontal" />
        <div className={styles.tabsContainer}>
          {myTabItems.map((tab) => {
            return (
              <div
                key={tab.key}
                className={classnames(styles.tabItem, tab.key === activeKey && styles.activeTab)}
                onClick={() => {
                  setActiveKey(tab.key);
                  setSiderCollapsed(false);
                  if (tab.navigatePath) {
                    navigate(tab.navigatePath);
                  }
                }}
              >
                <Badge
                  dot={tab.showDot || Number(tab.count) > 0}
                  count={tab.count > 0 ? tab.count : undefined}
                  size="small"
                  style={{ padding: '0 3px' }}
                >
                  <AntdIcon type={tab.icon} className={styles.tabIcon} />
                </Badge>
                <span className={styles.tabLabel}>{intl.formatMessage({ id: tab.label })}</span>
                <AntdIcon type={tab.activeIcon} className={styles.activeTabIcon} />
              </div>
            );
          })}
        </div>
        <Feedback
          userId={userInfo.userId}
          className={classnames(styles.smallIconWrap)}
          style={{ background: 'transparent', marginTop: 'auto' }}
        />
        <SelectLang placement="right" style={{ fontSize: 16 }} className={styles.smallIconWrap} />
        <Dropdown
          menu={{ items: userDropdownItems, onClick: onUserDropdownClick }}
          placement="topRight"
          overlayStyle={{ minWidth: '200px' }}
          popupRender={userDropdownRender}
        >
          <div className={styles.userName}>{getDisplayUserNameInChat(userInfo.userName)}</div>
        </Dropdown>
      </div>
      <SiderContentContext.Provider value={{ siderContentWidth, setSiderContentWidth }}>
        <div
          style={
            {
              '--sider-content-width': `${siderContentWidth}px`,
            } as React.CSSProperties
          }
          className={classnames(styles.siderWrap, isSiderCollapsed && styles.collapsed)}
        >
          {siderContentWidth > 0 && (
            <aside className={styles.sider}>
              <SiderContent activeKey={activeKey} />
            </aside>
          )}
        </div>
      </SiderContentContext.Provider>
      <div className={styles.collapseLine}>
        <div
          className={classnames(styles.collapesBtn, 'pointer ub ub-ac ub-pc')}
          onClick={() => setSiderCollapsed(!isSiderCollapsed)}
        >
          {!isSiderCollapsed && <CaretLeftOutlined />}
          {isSiderCollapsed && <CaretRightOutlined />}
        </div>
      </div>
    </>
  );
};

export default Sidebar;
