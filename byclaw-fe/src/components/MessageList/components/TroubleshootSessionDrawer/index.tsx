import React from 'react';
import { Drawer } from 'antd';
// @ts-ignore
import { useIntl, useSelector } from '@umijs/max';

import ChatLayoutComp from '@/components/ChatLayoutComp';
import { agentTypeMap } from '@/constants/agent';
import useGlobal from '@/hooks/useGlobal';
import GlobalContext, { Platform } from '@/layout/components/provider/global';
import { EventEmitter$Cls } from '@/utils/eventEmitter';

import type { IAgentCache, IAgentType } from '@/typescript/agent';
import { cacheTroubleshootSession } from './sessionCache';
import styles from './index.module.less';

type Props = {
  agentId: string;
  initialSessionId?: string;
  initialText: string;
  onClose: () => void;
  open: boolean;
  traceId?: string;
};

function TroubleshootSessionContent({
  agentId,
  initialSessionId,
  initialText,
  traceId,
}: Pick<Props, 'agentId' | 'initialSessionId' | 'initialText' | 'traceId'>) {
  const parentGlobalContext = useGlobal();
  const [sessionId, setSessionId] = React.useState(initialSessionId || '');
  const [currentAgentId, setCurrentAgentId] = React.useState(agentId);
  const [agentType, setAgentType] = React.useState<IAgentType>(agentTypeMap.common);
  const eventEmitterRef = React.useRef(new EventEmitter$Cls());

  const { agentList, employeesList } = useSelector(({ employees }: any) => ({
    agentList: employees.agentList || [],
    employeesList: employees.employeesList || [],
  }));

  React.useEffect(() => {
    setCurrentAgentId(agentId);
  }, [agentId]);

  React.useEffect(() => {
    setSessionId(initialSessionId || '');
  }, [initialSessionId]);

  React.useEffect(() => {
    cacheTroubleshootSession(traceId, sessionId);
  }, [sessionId, traceId]);

  React.useEffect(() => {
    const agentInfo = [...agentList, ...employeesList].find(
      (item: IAgentCache) => `${item.agentId || item.id}` === `${agentId}`
    );
    setAgentType(agentInfo?.agentType || agentTypeMap.common);
  }, [agentId, agentList, employeesList]);

  React.useEffect(() => {
    if (!initialText || initialSessionId) return undefined;

    const timer = setTimeout(() => {
      eventEmitterRef.current.emit('queryInput-set-value', initialText);
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [initialSessionId, initialText]);

  return (
    <GlobalContext.Provider
      value={{
        ...parentGlobalContext,
        platform: Platform.pc,
        sessionId,
        setSessionId,
        agentId: currentAgentId,
        setAgentId: setCurrentAgentId,
        EventEmitter: eventEmitterRef.current,
      }}
    >
      <div className={styles.drawerContent}>
        <ChatLayoutComp
          isBottom
          cannotAt={false}
          hideChatTitle
          sessionId={sessionId}
          agentType={agentType}
          setAgentType={setAgentType}
          queryInputProps={{
            placeholder: '',
          }}
        />
      </div>
    </GlobalContext.Provider>
  );
}

export default function TroubleshootSessionDrawer({
  agentId,
  initialSessionId,
  initialText,
  onClose,
  open,
  traceId,
}: Props) {
  const intl = useIntl();

  return (
    <Drawer
      open={open}
      width="50vw"
      mask={false}
      className={styles.drawer}
      title={intl.formatMessage({ id: 'messageList.troubleshoot' })}
      onClose={onClose}
      destroyOnHidden
    >
      <TroubleshootSessionContent
        agentId={agentId}
        initialSessionId={initialSessionId}
        initialText={initialText}
        traceId={traceId}
      />
    </Drawer>
  );
}
