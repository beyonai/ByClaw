// tslint:disable:ordered-imports
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';

// @ts-ignore
import { Outlet, useIntl, useLocation, useSelector, useSearchParams } from '@umijs/max';
import { Layout, Tooltip } from 'antd';

import { EventEmitter$Cls } from '@/utils/eventEmitter';
import ResourcePanelToggleIcon from '@/components/ChatLayoutComp/ChatResourceWorkspace/ResourcePanelToggleIcon';
import Auth from '../auth';
import AntdProvider from '../components/provider/antd';
import Header from '../header';
import {
  SiderContentContext,
  DEFAULT_SIDER_CONTENT_WIDTH,
  HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH,
  type DetailPanelOptions,
} from '../sider/siderContentContext';
import WorkspaceSider from '../sider/components/WorkspaceSider';

import PasswordModal from '@/pages/settings/components/PasswordModal';

import FullScreenModal from '@/components/FullScreenModal';
import UserCollectModal from '@/components/UserCollectModal';
import AbsoluteDrawer from '@/components/AbsoluteDrawer';
import FullAbsoluteDrawer from '@/components/FullAbsoluteDrawer';
import MainDrawer from '@/components/MainDrawer';
import MinorDrawer from '@/components/MinorDrawer';
import { Resizable } from '@/components/Resizable';
import DragFileEventHandler from '@/components/QueryInput/dragFileEventHandler';
import useAgentUploadFileConfig from '@/hooks/useAgentUploadFileConfig';
import useVersionNotification from '@/hooks/useVersionNotification';

import GlobalContext, { Platform } from '../components/provider/global';

import { getSsoLoginByIframe } from '@/utils/system';
import { getHistoryState } from '@/utils/browser';

import useAppStore from '@/models/common/useAppStore';

import styles from './index.module.less';

const { Content } = Layout;

const pcUnShowLayoutRoute: Record<string, boolean> = {
  '/': true,
  '/404': true,
  '/digitalEmployeesCreate': true,
};

const pcHideSiderContentRoute: Record<string, boolean> = {};

function isPcUnShowLayoutRoute(pathname: string) {
  let path = pathname;
  if (pathname.endsWith('/')) {
    path = pathname.slice(0, -1);
  }
  return !!pcUnShowLayoutRoute[path || pathname];
}

function isPcHideSiderContentRoute(pathname: string) {
  let path = pathname;
  if (pathname.endsWith('/')) {
    path = pathname.slice(0, -1);
  }
  return !!pcHideSiderContentRoute[path || pathname];
}

const PCSessionId = 'pcSessionId';
const PCAgentId = 'pcAgentId';

const myEventEmitter = new EventEmitter$Cls();

if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  (window as any).__BYCLAW_E2E_EVENT_EMITTER__ = myEventEmitter;
  (window as any).__BYCLAW_E2E__ = {
    EventEmitter: myEventEmitter,
  };
}

const PCLayout = () => {
  const intl = useIntl();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const { pathname } = location;
  const preserveDetailPanel = Boolean(
    (location.state as { preserveDetailPanel?: boolean } | null)?.preserveDetailPanel
  );

  // 检查当前路由是否需要隐藏侧边栏
  const [siderContentWidth, setSiderContentWidth] = React.useState(DEFAULT_SIDER_CONTENT_WIDTH);
  const [detailPanel, setDetailPanel] = React.useState<React.ReactNode>(null);
  const [detailPanelWidth, setDetailPanelWidth] = React.useState<React.CSSProperties['width']>();
  const [detailPanelOverlay, setDetailPanelOverlay] = React.useState(false);
  const openDetailPanel = useCallback((panel: React.ReactNode, options?: DetailPanelOptions) => {
    setDetailPanel(panel);
    setDetailPanelWidth(options?.width);
    setDetailPanelOverlay(!!options?.overlay);
  }, []);
  const clearDetailPanel = useCallback(() => {
    setDetailPanel(null);
    setDetailPanelWidth(undefined);
    setDetailPanelOverlay(false);
  }, []);

  React.useEffect(() => {
    // 从右侧资源入口进入中心页时，主内容切换但保留当前资源工作区。
    if (!preserveDetailPanel) {
      clearDetailPanel();
    }
    // 新侧栏是全局工作区导航，资源中心和设置页都保留它；只有明确配置的页面才隐藏侧栏。
    if (isPcHideSiderContentRoute(pathname)) {
      setSiderContentWidth(0);
    } else {
      setSiderContentWidth(DEFAULT_SIDER_CONTENT_WIDTH);
    }
  }, [clearDetailPanel, pathname, preserveDetailPanel]);

  React.useEffect(() => {
    const handleMainDriverOpen = (payload: any) => {
      const nextDrawerType = typeof payload === 'object' ? payload?.drawerType : payload;
      if (`${nextDrawerType}`.toLowerCase() === 'preview') {
        clearDetailPanel();
      }
    };

    myEventEmitter.on('beyond-main-driver-open-type', handleMainDriverOpen);
    return () => {
      myEventEmitter.off('beyond-main-driver-open-type', handleMainDriverOpen);
    };
  }, [clearDetailPanel]);

  const { isSiderCollapsed, setLoginModalOpen, setSiderCollapsed } = useAppStore();
  useVersionNotification(myEventEmitter);

  const [isClose, setIsClose] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');

  React.useEffect(() => {
    if (pathname !== '/chat' || !sessionId) return;

    // 会话切换可能发生在资源中心路由，通知聊天组件重新注册右侧资源工作区。
    myEventEmitter.emit('chat-session-changed', { sessionId }, { waitForListeners: true });
  }, [pathname, sessionId]);

  const [agentId, setAgentId] = useState<string>('');
  // 仅用于左侧资源联动，与实际聊天 agentId 分离。
  const [siderAgentId, setSiderAgentId] = useState<string>('');
  const [modPswModalVisible, setModPswModalVisible] = useState(false);
  const [pcLayoutContentId] = useState('pcLayoutId');
  const [containChatLayout, setContainChatLayout] = useState(false);
  const dragFileEventHandlerRef = useRef<DragFileEventHandler>(null);
  const layoutRef = useRef<HTMLElement>(null);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const visibleSiderContentWidth = isSiderCollapsed ? 0 : siderContentWidth;
  const mainContentHalfWidth =
    layoutWidth > 0 ? Math.max(280, Math.floor((layoutWidth - visibleSiderContentWidth) / 2)) : 450;
  const detailPanelBasis = (() => {
    if (detailPanelWidth === undefined) return undefined;
    if (typeof detailPanelWidth === 'number') return `${detailPanelWidth}px`;
    if (detailPanelWidth === HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH) return `${mainContentHalfWidth}px`;
    return detailPanelWidth;
  })();
  const detailPanelStyle = detailPanelBasis
    ? {
      flex: '0 0 auto',
      width: detailPanelBasis,
    }
    : undefined;

  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return;
    (window as any).__BYCLAW_E2E__ = {
      ...((window as any).__BYCLAW_E2E__ || {}),
      EventEmitter: myEventEmitter,
      resetChat: () => {
        setSessionId('');
        setAgentId('');
        setSiderAgentId('');
      },
      getState: () => ({
        sessionId,
        agentId,
      }),
    };
  }, [agentId, sessionId]);

  useEffect(() => {
    const layoutElement = layoutRef.current;
    if (!layoutElement) return undefined;

    const updateLayoutWidth = () => {
      setLayoutWidth(layoutElement.clientWidth);
    };
    updateLayoutWidth();

    if (!window.ResizeObserver) return undefined;

    const resizeObserver = new ResizeObserver(updateLayoutWidth);
    resizeObserver.observe(layoutElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const { userInfo } = useSelector(({ user }) => ({ userInfo: user.userInfo }));
  const { agentList, employeesList } = useSelector(({ employees }) => ({
    agentList: employees.agentList || [],
    employeesList: employees.employeesList,
  }));

  const curAgentInfo = React.useMemo(() => {
    return [...(agentList || []), ...(employeesList || [])].find(
      // 不同员工接口分别返回 id、resourceId、resourceCode 或 agentId，详情页需统一兼容。
      (item) =>
        `${item.agentId}` === `${agentId}` ||
        `${item.resourceId}` === `${agentId}` ||
        `${item.id}` === `${agentId}` ||
        `${item.resourceCode}` === `${agentId}`
    );
  }, [agentList, employeesList, agentId]);

  useEffect(() => {
    const onCloseContent = (isClose: boolean) => {
      setIsClose(isClose);
    };

    myEventEmitter.on('beyond-pclayout-close-content', onCloseContent);
    myEventEmitter.on('pcLayout-contains-chatLayout', setContainChatLayout);

    return () => {
      myEventEmitter.off('beyond-pclayout-close-content', onCloseContent);
      myEventEmitter.off('pcLayout-contains-chatLayout', setContainChatLayout);
    };
  }, []);

  useEffect(() => {
    const newState = {
      ...window.history.state,
      [PCSessionId]: sessionId,
      [PCAgentId]: agentId,
    };
    window.history.replaceState(newState, '');
  }, [sessionId, agentId]);

  // 3. 监听 popstate 事件
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (event.state) {
        setSessionId(getHistoryState(PCSessionId, ''));
        setAgentId(getHistoryState(PCAgentId, ''));
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    // 初始化sessionId，agentId
    // 优先获取searchParam中的
    if (userInfo) {
      const agentId = searchParams.get('agentId') || getHistoryState(PCAgentId, '');
      if (agentId) {
        setAgentId(agentId);
        searchParams.delete('agentId');
      }
      const sessionId = searchParams.get('sessionId') || getHistoryState(PCSessionId, '');
      if (sessionId) {
        setSessionId(sessionId);
        searchParams.delete('sessionId');
      }
      if (userInfo.isDefaultPwd && userInfo.loginType === 'username') {
        setModPswModalVisible(true);
      }

      setSearchParams(searchParams);
    } else {
      setSessionId('');
      setAgentId('');

      myEventEmitter.emit('beyond-driver-close');
    }
  }, [userInfo]);

  useEffect(() => {
    if (userInfo) {
      getSsoLoginByIframe();
    }
  }, [userInfo]);

  useEffect(() => {
    myEventEmitter.emit('beyond-driver-close');
  }, [sessionId]);

  const { globalConfig } = useAgentUploadFileConfig(employeesList);
  const uploadFileConfig = React.useMemo(() => globalConfig, [globalConfig]);

  useEffect(() => {
    if (containChatLayout) {
      dragFileEventHandlerRef.current = new DragFileEventHandler(document.getElementById(pcLayoutContentId)!, {
        uploadFileConfig: () => uploadFileConfig,
        onDropFile: (fileList: File[]) => {
          myEventEmitter.emit('queryInput-paste-files', fileList);
        },
      });
    }
    return () => {
      dragFileEventHandlerRef.current?.destroy();
    };
  }, [containChatLayout, pcLayoutContentId, uploadFileConfig]);

  useEffect(() => {
    const hasOpenLoginModal = searchParams.has('openLoginModal');
    if (hasOpenLoginModal) {
      searchParams.delete('openLoginModal');
      setTimeout(() => {
        setSearchParams(searchParams);
      }, 100);

      if (!userInfo) {
        setLoginModalOpen(true);
      }
    }
  }, [userInfo]);

  return (
    <>
      <AntdProvider>
        <GlobalContext.Provider
          value={{
            platform: Platform.pc,
            sessionId,
            setSessionId,
            agentId,
            setAgentId,
            siderAgentId,
            setSiderAgentId,
            uploadFileConfig,
            agentInfo: curAgentInfo,
            EventEmitter: myEventEmitter,
          }}
        >
          <Auth>
            {isPcUnShowLayoutRoute(pathname) ? (
              <Outlet />
            ) : (
              <Layout
                className="full-width full-height ub ub-ver"
                style={
                  {
                    '--user-fill-color': '#F2F6FA',
                    '--layout-gap': '0px',
                  } as React.CSSProperties
                }
              >
                {/* 没有登录的时候，展示header */}
                {!userInfo && <Header />}
                <Layout
                  className={classNames('full-width full-height ub-f1', styles.layout)}
                  style={
                    {
                      padding: 0,
                      '--sider-content-width': `${visibleSiderContentWidth}px`,
                      '--layout-gap': '8px',
                    } as React.CSSProperties
                  }
                  ref={layoutRef}
                >
                  <SiderContentContext.Provider
                    value={{
                      siderContentWidth: visibleSiderContentWidth,
                      setSiderContentWidth,
                      setDetailPanel: openDetailPanel,
                      clearDetailPanel,
                    }}
                  >
                    {userInfo && siderContentWidth > 0 && !isSiderCollapsed && <WorkspaceSider />}
                    {userInfo && siderContentWidth > 0 && isSiderCollapsed && (
                      <Tooltip title={intl.formatMessage({ id: 'workspaceSider.expandSidebar' })} placement="bottom">
                        <button
                          type="button"
                          className={styles.workspaceSiderExpandButton}
                          aria-label={intl.formatMessage({ id: 'workspaceSider.expandSidebar' })}
                          onClick={() => setSiderCollapsed(false)}
                        >
                          <ResourcePanelToggleIcon className={styles.workspaceSiderExpandIcon} />
                        </button>
                      </Tooltip>
                    )}
                    <MinorDrawer />
                    <Content
                      id={pcLayoutContentId}
                      className={classNames(styles.content, {
                        [styles.opening]: !isClose,
                        [styles.closing]: isClose,
                        [styles.siderCollapsedContent]: isSiderCollapsed,
                      })}
                    >
                      <Outlet />
                    </Content>
                    {detailPanel &&
                      (detailPanelOverlay ? (
                        <aside className={classNames(styles.detailPanel, styles.detailPanelOverlay)}>
                          {detailPanel}
                        </aside>
                      ) : (
                        <Resizable left limit={{ minWidth: DEFAULT_SIDER_CONTENT_WIDTH, maxWidth: '70vw' }}>
                          <aside className={styles.detailPanel} style={detailPanelStyle}>
                            {detailPanel}
                          </aside>
                        </Resizable>
                      ))}
                  </SiderContentContext.Provider>
                  <MainDrawer />
                </Layout>
                <AbsoluteDrawer getContainer={() => layoutRef.current || window.document.body} />
                <FullAbsoluteDrawer />
                <FullScreenModal />
              </Layout>
            )}
          </Auth>
        </GlobalContext.Provider>
        <UserCollectModal />
        <PasswordModal
          unclosable
          visible={modPswModalVisible}
          logoutOnSuccess={false}
          onClose={() => setModPswModalVisible(false)}
        />
      </AntdProvider>
    </>
  );
};

export default memo(PCLayout);
