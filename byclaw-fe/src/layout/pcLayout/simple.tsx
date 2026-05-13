// tslint:disable:ordered-imports
import React, { memo, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';

// @ts-ignore
import { Outlet, useSelector } from '@umijs/max';
import { Layout } from 'antd';

import { EventEmitter$Cls } from '@/utils/eventEmitter';
import Auth from '../auth';
import AntdProvider from '../components/provider/antd';

import AbsoluteDrawer from '@/components/AbsoluteDrawer';
import FullAbsoluteDrawer from '@/components/FullAbsoluteDrawer';
import MainDrawer from '@/components/MainDrawer';

import GlobalContext, { Platform } from '../components/provider/global';
import { LayoutMode } from '@/constants/system';

import { getHistoryState } from '@/utils/browser';

import styles from './index.module.less';

const { Content } = Layout;

const PCSessionId = 'pcSessionId';
const PCAgentId = 'pcAgentId';

const myEventEmitter = new EventEmitter$Cls();

const SimpleLayout = () => {
  const [isClose, setIsClose] = useState(false);

  const [sessionId, setSessionId] = useState<string>('');
  const [agentId, setAgentId] = useState<string>('');

  const { userInfo } = useSelector(({ user }) => ({ userInfo: user.userInfo }));

  const layoutRef = useRef<HTMLElement>(null);

  const { agentList, employeesList } = useSelector(({ employees }) => ({
    agentList: employees.agentList || [],
    employeesList: employees.employeesList,
  }));

  const curAgentInfo = React.useMemo(() => {
    return [...(agentList || []), ...(employeesList || [])].find(
      (item) => `${item.id}` === `${agentId}` || `${item.resourceCode}` === `${agentId}`
    );
  }, [agentList, employeesList, agentId]);

  useEffect(() => {
    const onCloseContent = (isClose: boolean) => {
      setIsClose(isClose);
    };

    myEventEmitter.on('beyond-pclayout-close-content', onCloseContent);

    return () => {
      myEventEmitter.off('beyond-pclayout-close-content', onCloseContent);
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
    const searchParams = new URLSearchParams(window.location.search);

    if (userInfo) {
      setSessionId(searchParams.get('sessionId') || getHistoryState(PCSessionId, ''));
      setAgentId(searchParams.get('agentId') || getHistoryState(PCAgentId, ''));
    } else {
      setSessionId('');
      setAgentId('');

      myEventEmitter.emit('beyond-driver-close');
    }
  }, [userInfo]);

  useEffect(() => {
    myEventEmitter.emit('beyond-driver-close');
  }, [sessionId]);

  return (
    <AntdProvider>
      <GlobalContext.Provider
        value={{
          platform: Platform.pc,
          sessionId,
          setSessionId,
          agentId,
          agentInfo: curAgentInfo,
          setAgentId,
          EventEmitter: myEventEmitter,
          layoutMode: LayoutMode.debug,
        }}
      >
        <Auth>
          <Layout
            id="pc-layout"
            className="full-width full-height ub-f1"
            style={{ position: 'relative', flexDirection: 'row' }}
            ref={layoutRef}
          >
            <Content
              style={{ flex: 1, backgroundColor: '#f7fafc' }}
              className={classNames(styles.content, {
                [styles.opening]: !isClose,
                [styles.closing]: isClose,
              })}
            >
              <Outlet />
            </Content>
            <MainDrawer />
          </Layout>
          <AbsoluteDrawer getContainer={() => layoutRef.current || window.document.body} />
          <FullAbsoluteDrawer />
        </Auth>
      </GlobalContext.Provider>
    </AntdProvider>
  );
};

export default memo(SimpleLayout);
