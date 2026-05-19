// tslint:disable:ordered-imports
import React, { memo, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';

// @ts-ignore
import { Outlet, useLocation, useSelector, useSearchParams } from '@umijs/max';
import { Layout } from 'antd';

import { EventEmitter$Cls } from '@/utils/eventEmitter';
import Auth from '../auth';
import AntdProvider from '../components/provider/antd';
import Header from '../header';
import Sider from '../sider';
import { SiderContentContext, DEFAULT_SIDER_CONTENT_WIDTH } from '../sider/siderContentContext';
import { tabItems } from '../sider/components/SiderContent';

import PasswordModal from '@/pages/settings/components/PasswordModal';

import FullScreenModal from '@/components/FullScreenModal';
import UserCollectModal from '@/components/UserCollectModal';
import AbsoluteDrawer from '@/components/AbsoluteDrawer';
import FullAbsoluteDrawer from '@/components/FullAbsoluteDrawer';
import MainDrawer from '@/components/MainDrawer';
import MinorDrawer from '@/components/MinorDrawer';
import DragFileEventHandler from '@/components/QueryInput/dragFileEventHandler';
import useAgentUploadFileConfig from '@/hooks/useAgentUploadFileConfig';

import GlobalContext, { Platform } from '../components/provider/global';

import useNotification from './hooks/useNotification';

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

function isPcUnShowLayoutRoute(pathname: string) {
  let path = pathname;
  if (pathname.endsWith('/')) {
    path = pathname.slice(0, -1);
  }
  return !!pcUnShowLayoutRoute[path || pathname];
}

const PCSessionId = 'pcSessionId';
const PCAgentId = 'pcAgentId';

const myEventEmitter = new EventEmitter$Cls();

const PCLayout = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const { pathname } = location;

  // 检查当前路由是否需要隐藏侧边栏
  const [siderContentWidth, setSiderContentWidth] = React.useState(DEFAULT_SIDER_CONTENT_WIDTH);

  React.useEffect(() => {
    // 参考 sider 组件的逻辑，检查当前路径是否需要隐藏侧边栏
    const currentTab = tabItems.find((item) => item.navigatePath === pathname);

    // 检查 tabItems 中的 hideSider 属性
    if (currentTab?.hideSider) {
      setSiderContentWidth(0);
    }
    // 检查特定路由是否需要隐藏侧边栏
    else if (pathname === '/knowledgeDetail') {
      setSiderContentWidth(0);
    } else {
      setSiderContentWidth(DEFAULT_SIDER_CONTENT_WIDTH);
    }
  }, [pathname]);

  const { setLoginModalOpen } = useAppStore();

  const [isClose, setIsClose] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [agentId, setAgentId] = useState<string>('');
  const [modPswModalVisible, setModPswModalVisible] = useState(false);
  const [pcLayoutContentId] = useState('pcLayoutId');
  const [containChatLayout, setContainChatLayout] = useState(false);

  const { userInfo } = useSelector(({ user }) => ({ userInfo: user.userInfo }));
  const { agentList, employeesList } = useSelector(({ employees }) => ({
    agentList: employees.agentList || [],
    employeesList: employees.employeesList,
  }));

  const dragFileEventHandlerRef = useRef<DragFileEventHandler>(null);
  const layoutRef = useRef<HTMLElement>(null);

  const curAgentInfo = React.useMemo(() => {
    return [...(agentList || []), ...(employeesList || [])].find(
      (item) => `${item.id}` === `${agentId}` || `${item.resourceCode}` === `${agentId}`
    );
  }, [agentList, employeesList, agentId]);

  useNotification();

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

  const getAgentUploadFileConfig = useAgentUploadFileConfig(employeesList);
  const uploadFileConfig = React.useMemo(() => {
    return getAgentUploadFileConfig(agentId);
  }, [agentId, getAgentUploadFileConfig]);

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
                    '--layout-gap': '8px',
                  } as React.CSSProperties
                }
              >
                {/* 没有登录的时候，展示header */}
                {!userInfo && <Header />}
                <Layout
                  className={classNames('full-width full-height ub-f1', styles.layout)}
                  style={{
                    // 用gap实现起来很难搞，因为在没有展开drawer的情况下，也占了8px的位置，因此采用了--layout-gap这种方式来做一个margin处理
                    padding: userInfo ? '8px 8px 8px 0' : 0,
                  }}
                  ref={layoutRef}
                >
                  <SiderContentContext.Provider value={{ siderContentWidth, setSiderContentWidth }}>
                    <Sider />
                  </SiderContentContext.Provider>
                  <MinorDrawer />
                  <Content
                    id={pcLayoutContentId}
                    className={classNames(styles.content, {
                      [styles.opening]: !isClose,
                      [styles.closing]: isClose,
                    })}
                    style={{ marginLeft: userInfo ? 'var(--layout-gap)' : 0 }}
                  >
                    <Outlet />
                  </Content>
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
