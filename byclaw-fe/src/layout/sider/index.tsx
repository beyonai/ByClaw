import React from 'react';

import { CaretLeftOutlined, CaretRightOutlined } from '@ant-design/icons';
// @ts-ignore
import { useSelector, SelectLang, useIntl, useLocation, useNavigate } from '@umijs/max';
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
import { clearEasyConfirmInputDraft } from '@/components/ChatLayoutComp/components/EasyConfirm';

import type { IState as IEmployeesState } from '@/models/useEmployees';
import { SiderContentContext, DEFAULT_SIDER_CONTENT_WIDTH } from './siderContentContext';

export const DEF_SIDER = 'sessions';

const CENTER_TAB_KEYS = new Set(['agent', 'knowledge', 'tool', 'view', 'object', 'ontology', 'skill', 'file', 'model']);
const EMPLOYEE_RESOURCE_TAB_KEYS = new Set([
  'knowledge',
  'tool',
  'view',
  'object',
  'ontology',
  'skill',
  'file',
  'model',
]);

const SIDER_ACTIVE_TAB_BY_PATH: Partial<Record<string, (typeof tabItems)[number]['key']>> = {
  '/dialogueRecord': 'sessions',
  '/knowledgeDetail': 'knowledge',
};

const CHAT_PANEL_PATHS = ['/chat', '/dialogueRecord', '/employees', '/searchAndQuery', '/functionCloud', '/sandbox'];

const isSameOrChildPath = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);

const isChatPanelPath = (pathname: string) => CHAT_PANEL_PATHS.some((path) => isSameOrChildPath(pathname, path));

const getCurrentTabByPathname = (pathname: string) => {
  const matchedTabKey = Object.entries(SIDER_ACTIVE_TAB_BY_PATH).find(([path]) => pathname.startsWith(path))?.[1];

  if (matchedTabKey) {
    return tabItems.find((item) => item.key === matchedTabKey);
  }

  return tabItems.find((item) => item.navigatePath && pathname.startsWith(item.navigatePath));
};

const Sidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { pathname } = location;
  const keepSiderActiveKey = (location.state as { keepSiderActiveKey?: (typeof tabItems)[number]['key'] } | null)
    ?.keepSiderActiveKey;

  const { isSiderCollapsed, setSiderCollapsed } = useAppStore();
  const { EventEmitter } = useGlobal();
  const { clearDetailPanel } = React.useContext(SiderContentContext);

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
  const [activeKey, setActiveKey] = React.useState<(typeof tabItems)[number]['key']>(
    () => currentTab?.key ?? DEF_SIDER
  );
  const [manualSiderOpenKey, setManualSiderOpenKey] = React.useState<(typeof tabItems)[number]['key']>();
  const pathnameRef = React.useRef(pathname);
  const shouldHideSiderContent = React.useMemo(() => {
    return Boolean(currentTab?.hideSider && manualSiderOpenKey !== activeKey);
  }, [activeKey, currentTab, manualSiderOpenKey]);
  const [siderContentWidth, setSiderContentWidth] = React.useState(() => {
    if (currentTab?.hideSider) {
      return 0;
    }

    return DEFAULT_SIDER_CONTENT_WIDTH;
  });

  const handleNewChat = useNewChat();

  const handleMenuTabClick = React.useCallback(
    (tab: (typeof tabItems)[number]) => {
      const isChatPage = isChatPanelPath(pathname);

      // 左侧主菜单切换时，最右侧详情面板要及时关闭；即使重复点击当前菜单也要生效。
      clearDetailPanel?.();
      setActiveKey(tab.key);
      setManualSiderOpenKey(tab.key);
      setSiderCollapsed(false);
      EventEmitter.emit('sider-menu-tab-click-refresh', { key: tab.key });

      if (!tab.navigatePath) {
        return;
      }

      if (tab.key === 'sessions') {
        if (!isChatPage && pathname !== tab.navigatePath) {
          navigate(tab.navigatePath);
        }
        return;
      }

      // 会话面板打开时，点击资源类菜单只切换左侧栏，不打断右侧当前会话。
      if (isChatPage) {
        return;
      }

      if (CENTER_TAB_KEYS.has(tab.key) && pathname !== tab.navigatePath) {
        navigate(tab.navigatePath);
      }
    },
    [EventEmitter, clearDetailPanel, navigate, pathname, setSiderCollapsed]
  );

  const showSearchAndQueryTab = React.useMemo(() => {
    const hasEmployee = [...agentList, ...employeesList].find((agent) =>
      [agentTypeMap.searchAndQuery, agentTypeMap.functionCloud].includes(agent?.agentType as any)
    );
    const paths = [agentMap[agentTypeMap.searchAndQuery]?.path, agentMap[agentTypeMap.functionCloud]?.path];

    return hasEmployee && paths.includes(pathname);
  }, [agentList, employeesList, pathname]);

  const myTabItems = React.useMemo(() => {
    const visibleKeySet = new Set(visibleKeys);
    return compact(
      tabItems.map((tab) => {
        if (!visibleKeySet.has(tab.key)) {
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
  const contextTabItems = React.useMemo(
    () => myTabItems.filter((tab) => !EMPLOYEE_RESOURCE_TAB_KEYS.has(tab.key)),
    [myTabItems]
  );
  const employeeResourceTabItems = React.useMemo(
    () => myTabItems.filter((tab) => EMPLOYEE_RESOURCE_TAB_KEYS.has(tab.key)),
    [myTabItems]
  );
  const isEmployeeResourceActive = EMPLOYEE_RESOURCE_TAB_KEYS.has(activeKey);

  const { userDropdownItems, onUserDropdownClick, userDropdownRender } = useUserDropdown(userInfo);

  const getFaviconIcon = React.useMemo(() => {
    const defaultIcon = getRuntimeActualUrl('/favicon.svg');
    return getSystemConfigByStorage().favicon || defaultIcon;
  }, []);

  // 新手指引时，需要点击左侧菜单
  React.useEffect(() => {
    const handleSetSiderActiveKey = (key: string) => {
      setActiveKey(key);
      setManualSiderOpenKey(key);
      setSiderCollapsed(false); // 确保侧边栏展开
    };

    EventEmitter.on('set-sider-active-key', handleSetSiderActiveKey);

    return () => {
      EventEmitter.off('set-sider-active-key', handleSetSiderActiveKey);
    };
  }, [EventEmitter, setSiderCollapsed]);

  React.useEffect(() => {
    setSiderContentWidth(shouldHideSiderContent ? 0 : DEFAULT_SIDER_CONTENT_WIDTH);
    clearDetailPanel?.();
  }, [activeKey, shouldHideSiderContent]);

  React.useEffect(() => {
    const hasKey = myTabItems.find((tab) => tab.key === activeKey);
    if (!hasKey) {
      setActiveKey(DEF_SIDER);
    }
  }, [activeKey, myTabItems]);

  React.useEffect(() => {
    const hasKey = myTabItems.find((tab) => tab.key === currentTab?.key);
    const pathnameChanged = pathnameRef.current !== pathname;
    const keepSiderActiveTab = keepSiderActiveKey && myTabItems.find((tab) => tab.key === keepSiderActiveKey);

    if (pathnameChanged && keepSiderActiveTab) {
      pathnameRef.current = pathname;
      setManualSiderOpenKey(keepSiderActiveKey);
      setActiveKey(keepSiderActiveKey);
      setSiderContentWidth(DEFAULT_SIDER_CONTENT_WIDTH);
      return;
    }

    const shouldSyncActiveKey = Boolean(currentTab && hasKey && (pathnameChanged || !manualSiderOpenKey));
    const nextActiveKey = shouldSyncActiveKey ? currentTab?.key : activeKey;
    const nextManualSiderOpenKey = pathnameChanged ? undefined : manualSiderOpenKey;
    const nextShouldHideSiderContent = Boolean(currentTab?.hideSider && nextManualSiderOpenKey !== nextActiveKey);

    if (pathnameChanged) {
      pathnameRef.current = pathname;
      setManualSiderOpenKey(undefined);
      clearDetailPanel?.();
    }

    setSiderContentWidth(nextShouldHideSiderContent ? 0 : DEFAULT_SIDER_CONTENT_WIDTH);

    if (shouldSyncActiveKey && currentTab) {
      setActiveKey(currentTab.key);
    }
  }, [activeKey, currentTab, keepSiderActiveKey, manualSiderOpenKey, myTabItems, pathname]);

  if (!userInfo) return null;

  const renderTabItem = (tab: (typeof tabItems)[number]) => (
    <div
      key={tab.key}
      className={classnames(styles.tabItem, tab.key === activeKey && styles.activeTab)}
      onClick={() => handleMenuTabClick(tab)}
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

  return (
    <>
      <div className={classnames(styles.siderBar, 'hideThumb')}>
        <div className={styles.logo}>
          <img alt="BYAI" src={getFaviconIcon} />
        </div>
        <SiderSearch />
        <Tooltip placement="right" title={intl.formatMessage({ id: 'sider.newChat' })}>
          <div
            className={styles.sideIconWrap}
            onClick={() => {
              clearDetailPanel?.();
              clearEasyConfirmInputDraft();
              handleNewChat();
            }}
          >
            <Icon type="icon-xinjianduihua-fill" style={{ color: token.colorPrimary }} />
          </div>
        </Tooltip>
        <Divider type="horizontal" />
        <div className={styles.tabsContainer}>
          {contextTabItems.map(renderTabItem)}
          {employeeResourceTabItems.length > 0 && (
            <Tooltip
              placement="right"
              title={intl.formatMessage({
                id: 'sider.employeeResourceGroup.tooltip',
                defaultMessage: '知识、工具、视图、对象、技能、文件会跟随当前数字员工切换',
              })}
            >
              <div
                className={classnames(
                  styles.employeeResourceGroup,
                  isEmployeeResourceActive && styles.employeeResourceGroupActive
                )}
              >
                <span className={styles.employeeResourceGroupLabel}>
                  {intl.formatMessage({
                    id: 'sider.employeeResourceGroup.label',
                    defaultMessage: '联动资源',
                  })}
                </span>
                <div className={styles.employeeResourceGroupItems}>{employeeResourceTabItems.map(renderTabItem)}</div>
              </div>
            </Tooltip>
          )}
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
      {!shouldHideSiderContent && (
        <div className={styles.collapseLine}>
          <div
            className={classnames(styles.collapesBtn, 'pointer ub ub-ac ub-pc')}
            onClick={() => setSiderCollapsed(!isSiderCollapsed)}
          >
            {!isSiderCollapsed && <CaretLeftOutlined />}
            {isSiderCollapsed && <CaretRightOutlined />}
          </div>
        </div>
      )}
    </>
  );
};

export default Sidebar;
