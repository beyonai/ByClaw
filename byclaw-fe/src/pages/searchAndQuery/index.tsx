import React, { useState, lazy, useEffect, createContext } from 'react';
import classNames from 'classnames';
import { Layout, Skeleton } from 'antd';
import { useSelector, useNavigate } from '@umijs/max';

import TitleWriter from '@/components/TitleWriter';
import ChatPageLayout from '@/components/ChatPageLayout';
import ChatLayoutComp from './components/ChatLayoutComp';

import useGlobal from '@/hooks/useGlobal';

import type { IState as IEmployeesState } from '@/models/useEmployees';

import styles from './styles.module.less';
import { isEmpty } from 'lodash';
import { agentTypeMap } from '@/constants/agent';

export const SearchAndQueryContext = createContext<{
  isWorkSpaceCollapsed: boolean;
  setIsWorkSpaceCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
}>({
  isWorkSpaceCollapsed: false,
  setIsWorkSpaceCollapsed: () => {},
});

const { Content, Sider } = Layout;
const ChatBottom = lazy(() => import('./components/chatBottom'));
const WorkSpace = lazy(() => import('./components/workSpace'));

const SearchAndQuery = () => {
  const navigate = useNavigate();

  const globalContext = useGlobal();
  const { sessionId, EventEmitter } = globalContext;

  const { agentList, employeesList } = useSelector(({ employees }: { employees: IEmployeesState }) => ({
    agentList: employees.agentList,
    employeesList: employees.employeesList,
  }));

  const [isWorkSpaceCollapsed, setIsWorkSpaceCollapsed] = React.useState(true);
  const [isBottom, setIsBottom] = React.useState(false);
  const [pcLayoutContentId] = useState('SearchAndQueryLayoutId');

  useEffect(() => {
    if (isEmpty(employeesList) && isEmpty(agentList)) {
      navigate('/chat');
    }
  }, [employeesList, agentList]);

  useEffect(() => {
    EventEmitter.emit('set-sider-active-key', 'searchAndQuery');

    return () => {
      // EventEmitter.emit('set-sider-active-key', DEF_SIDER);
    };
  }, []);

  return (
    <SearchAndQueryContext.Provider value={{ setIsWorkSpaceCollapsed, isWorkSpaceCollapsed }}>
      <Layout className={classNames(styles.layout, 'full-width full-height ub ub-ver')}>
        <Content id={pcLayoutContentId} className={classNames(styles.content)}>
          <ChatPageLayout
            id="chat_wrapper"
            isBottom={isBottom}
            scrollId="chat_scroller"
            title={
              <TitleWriter
                showAssistant
                title="百应搜问"
                colorTitleBg="linear-gradient(90deg, #3150ff 0%, #c067ff 100%) text"
                fullText="做最懂你的知识顾问"
                highlightStart={-1}
              />
            }
            bottom={<ChatBottom />}
            main={
              <ChatLayoutComp
                sessionId={sessionId}
                isBottom={isBottom}
                setIsBottom={setIsBottom}
                agentType={agentTypeMap.searchAndQuery}
              />
            }
          />
        </Content>
        <Sider
          className={styles.sider}
          width="20vw"
          collapsed={isWorkSpaceCollapsed}
          collapsedWidth={0}
          style={{ marginLeft: isWorkSpaceCollapsed ? 0 : 'var(--layout-gap)' }}
        >
          <React.Suspense fallback={<Skeleton active />}>
            <WorkSpace />
          </React.Suspense>
        </Sider>
      </Layout>
    </SearchAndQueryContext.Provider>
  );
};

export default SearchAndQuery;
