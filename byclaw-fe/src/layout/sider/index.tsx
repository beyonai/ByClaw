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
import SandboxStatusIndicator from './components/SandboxStatus';
import useUserDropdown from '../header/useUserDropdown';
import { getDisplayUserNameInChat } from '@/utils/chat';
import useGlobal from '@/hooks/useGlobal';
import { clearEasyConfirmInputDraft } from '@/components/ChatLayoutComp/components/EasyConfirm';

import type { IState as IEmployeesState } from '@/models/useEmployees';
import { SiderContentContext, DEFAULT_SIDER_CONTENT_WIDTH } from './siderContentContext';

export const DEF_SIDER = 'sessions';

const CENTER_TAB_KEYS = new Set([
  'agent',
  'knowledge',
  'tool',
  'view',
  'object',
  'ontology',
  'skill',
  'file',
  'projectSpace',
]);
// 资源菜单点击后直接进入全局中心页，不再打开当前数字员工关联的小列表。
const RESOURCE_CENTER_TAB_KEYS = new Set(['knowledge', 'tool', 'view', 'object', 'ontology', 'skill', 'file']);
// 独立工作区页面：无论当前在聊天页还是中心页，点击都要切换右侧大页面。
const WORKSPACE_TAB_KEYS = new Set(['projectSpace', 'automation']);

const SIDER_ACTIVE_TAB_BY_PATH: Partial<Record<string, (typeof tabItems)[number]['key']>> = {
  '/dialogueRecord': 'sessions',
  // 数字员工详情属于“员工”菜单，不能因详情路由不是列表路由而回退到“会话”。
  '/employees': 'agent',
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
  const preserveDetailPanel = Boolean(
    (location.state as { preserveDetailPanel?: boolean } | null)?.preserveDetailPanel
  );

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
    // 资源中心统一使用大页面，旧事件和路由状态都不能再强制展开对应左侧小面板。
    return Boolean(currentTab?.hideSider);
  }, [currentTab]);
  const [siderContentWidth, setSiderContentWidth] = React.useState(() => {
    if (currentTab?.hideSider) {
      return 0;
    }

    return DEFAULT_SIDER_CONTENT_WIDTH;
  });

  const handleMenuTabClick = React.useCallback(
    (tab: (typeof tabItems)[number]) => {
      const isChatPage = isChatPanelPath(pathname);

      // 左侧主菜单切换时，最右侧详情面板要及时关闭；即使重复点击当前菜单也要生效。
      clearDetailPanel?.();
      setActiveKey(tab.key);
      // 隐藏型中心菜单不打开左侧小列表，仅展示右侧主内容页面。
      setManualSiderOpenKey(tab.hideSider ? undefined : tab.key);
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

      // 项目和自动化都是独立工作区，从聊天页点击时也必须切换右侧大页面；
      // 它们不属于资源中心，下面两个白名单都不覆盖，必须在此提前导航。
      if (WORKSPACE_TAB_KEYS.has(tab.key)) {
        if (pathname !== tab.navigatePath) {
          navigate(tab.navigatePath);
        }
        return;
      }

      // 资源类菜单直接进入全局中心页，不再在会话页打开员工绑定列表。
      if (isChatPage) {
        if (RESOURCE_CENTER_TAB_KEYS.has(tab.key)) {
          navigate(tab.navigatePath);
        }
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
        if (tab.hideMenu) {
          return null;
        }
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
  // 所有资源入口都作为普通主菜单展示，与当前数字员工解除联动。
  const contextTabItems = myTabItems;

  const { userDropdownItems, onUserDropdownClick, userDropdownRender } = useUserDropdown(userInfo);

  const getFaviconIcon = React.useMemo(() => {
    const defaultIcon = getRuntimeActualUrl('/favicon.svg');
    return getSystemConfigByStorage().favicon || defaultIcon;
  }, []);

  // 新手指引时，需要点击左侧菜单
  React.useEffect(() => {
    const handleSetSiderActiveKey = (key: string) => {
      const targetTab = tabItems.find((tab) => tab.key === key);
      setActiveKey(key);
      setManualSiderOpenKey(RESOURCE_CENTER_TAB_KEYS.has(key) || key === 'model' ? undefined : key);
      setSiderCollapsed(false); // 确保侧边栏展开
      if ((RESOURCE_CENTER_TAB_KEYS.has(key) || key === 'model') && targetTab?.navigatePath) {
        navigate(targetTab.navigatePath);
      }
    };

    EventEmitter.on('set-sider-active-key', handleSetSiderActiveKey);

    return () => {
      EventEmitter.off('set-sider-active-key', handleSetSiderActiveKey);
    };
  }, [EventEmitter, navigate, setSiderCollapsed]);

  React.useEffect(() => {
    const handleOntologyBindSaved = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      if (!detail.openSider) return;
      const refreshDetail = { ...detail, receivedAt: Date.now() };
      (window as any).__latestOntologyBindSaved = refreshDetail;
      setActiveKey('ontology');
      setManualSiderOpenKey(undefined);
      setSiderCollapsed(false);
      setSiderContentWidth(0);
      // 绑定完成后进入本体大页面；若事件来自右侧资源面板，也保留该面板。
      navigate('/ontologyCenter', { state: { preserveDetailPanel: true } });
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('ontologySiderRefresh', { detail: refreshDetail }));
      }, 0);
    };

    window.addEventListener('ontologyBindSaved', handleOntologyBindSaved);
    return () => window.removeEventListener('ontologyBindSaved', handleOntologyBindSaved);
  }, [navigate, setSiderCollapsed]);

  React.useEffect(() => {
    setSiderContentWidth(shouldHideSiderContent ? 0 : DEFAULT_SIDER_CONTENT_WIDTH);
    if (!preserveDetailPanel) {
      clearDetailPanel?.();
    }
  }, [activeKey, clearDetailPanel, preserveDetailPanel, shouldHideSiderContent]);

  React.useEffect(() => {
    const hasKey = myTabItems.find((tab) => tab.key === activeKey);
    if (!hasKey) {
      setActiveKey(DEF_SIDER);
    }
  }, [activeKey, myTabItems]);

  React.useEffect(() => {
    const hasKey = myTabItems.find((tab) => tab.key === currentTab?.key);
    const pathnameChanged = pathnameRef.current !== pathname;
    const keepSiderActiveTab =
      keepSiderActiveKey &&
      !RESOURCE_CENTER_TAB_KEYS.has(keepSiderActiveKey) &&
      keepSiderActiveKey !== 'model' &&
      myTabItems.find((tab) => tab.key === keepSiderActiveKey);

    if (pathnameChanged && keepSiderActiveTab) {
      pathnameRef.current = pathname;
      setManualSiderOpenKey(keepSiderActiveKey);
      setActiveKey(keepSiderActiveKey);
      setSiderContentWidth(DEFAULT_SIDER_CONTENT_WIDTH);
      return;
    }

    const shouldSyncActiveKey = Boolean(currentTab && hasKey && (pathnameChanged || !manualSiderOpenKey));
    const nextShouldHideSiderContent = Boolean(currentTab?.hideSider);

    if (pathnameChanged) {
      pathnameRef.current = pathname;
      setManualSiderOpenKey(undefined);
      if (!preserveDetailPanel) {
        clearDetailPanel?.();
      }
    }

    setSiderContentWidth(nextShouldHideSiderContent ? 0 : DEFAULT_SIDER_CONTENT_WIDTH);

    if (shouldSyncActiveKey && currentTab) {
      setActiveKey(currentTab.key);
    }
  }, [
    activeKey,
    clearDetailPanel,
    currentTab,
    keepSiderActiveKey,
    manualSiderOpenKey,
    myTabItems,
    pathname,
    preserveDetailPanel,
  ]);

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
          <img key="BYAI" alt="BYAI" src={getFaviconIcon} />
        </div>
        <Tooltip placement="right" title={intl.formatMessage({ id: 'sider.newChat' })}>
          <div
            className={styles.sideIconWrap}
            onClick={() => {
              clearDetailPanel?.();
              clearEasyConfirmInputDraft();
              // 项目会话组件持有当前下拉选中的项目，由它带 projectId 创建会话。
              EventEmitter.emit('projectSpace-create-session');
            }}
          >
            <Icon type="icon-xinjianduihua-fill" style={{ color: token.colorPrimary }} />
          </div>
        </Tooltip>
        <Divider type="horizontal" />
        <div className={styles.tabsContainer}>{contextTabItems.map(renderTabItem)}</div>
        <Feedback
          userId={userInfo.userId}
          className={classnames(styles.smallIconWrap)}
          style={{ background: 'transparent', marginTop: 'auto' }}
        />
        <SandboxStatusIndicator
          userCode={userInfo.userCode}
          className={classnames(styles.smallIconWrap)}
          style={{ background: 'transparent' }}
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
          <Tooltip
            title={intl.formatMessage({
              id: isSiderCollapsed ? 'workspaceSider.expandSidebar' : 'workspaceSider.collapseSidebar',
            })}
            placement="bottom"
          >
            <div
              className={classnames(styles.collapesBtn, 'pointer ub ub-ac ub-pc')}
              onClick={() => setSiderCollapsed(!isSiderCollapsed)}
            >
              {!isSiderCollapsed && <CaretLeftOutlined />}
              {isSiderCollapsed && <CaretRightOutlined />}
            </div>
          </Tooltip>
        </div>
      )}
    </>
  );
};

export default Sidebar;
