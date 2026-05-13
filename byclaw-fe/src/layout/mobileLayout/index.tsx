import React, { useEffect, useState, memo } from 'react';

import classNames from 'classnames';

import { Layout } from 'antd';

// @ts-ignore
import { useSelector, Outlet } from '@umijs/max';

import { getHistoryState } from '@/utils/browser';

import { EventEmitter$Cls } from '@/utils/eventEmitter';

import AntdProvider from '@/layout/components/provider/antd';
import antdMobileTheme from '@/styles/antdMobileTheme';

import GlobalContext, { Platform } from '@/layout/components/provider/global';

import styles from './index.module.less';

const { Content } = Layout;

const MobileSessionId = 'mobileSessionId';
const MobileAgentId = 'mobileAgentId';

const myEventEmitter = new EventEmitter$Cls();

function MobileLayout() {
  const [sessionId, setSessionId] = useState<string>(getHistoryState(MobileSessionId, ''));
  const [agentId, setAgentId] = useState<string>(getHistoryState(MobileAgentId, ''));
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
    const newState = {
      ...window.history.state,
      [MobileSessionId]: sessionId,
      [MobileAgentId]: agentId,
    };
    window.history.replaceState(newState, '');
  }, [sessionId, agentId]);

  // 3. 监听 popstate 事件
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (event.state) {
        setSessionId(getHistoryState(MobileSessionId, ''));
        setAgentId(getHistoryState(MobileAgentId, ''));
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return (
    <>
      <AntdProvider theme={antdMobileTheme}>
        <GlobalContext.Provider
          value={{
            platform: Platform.mobile,
            sessionId,
            setSessionId,
            agentId,
            agentInfo: curAgentInfo,
            setAgentId,
            EventEmitter: myEventEmitter,
          }}
        >
          <div className="full-width full-height ub ub-ver">
            <Layout className={classNames('ub-f1')}>
              <Content id="mobileLayoutId" className={classNames(styles.content)}>
                <Outlet />
              </Content>
            </Layout>
          </div>
        </GlobalContext.Provider>
      </AntdProvider>
    </>
  );
}

export default memo(MobileLayout);
