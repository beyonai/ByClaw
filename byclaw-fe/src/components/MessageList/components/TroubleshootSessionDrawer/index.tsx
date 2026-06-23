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
import styles from './index.module.less';

type Props = {
  agentId: string;
  initialText: string;
  onClose: () => void;
  open: boolean;
};

function TroubleshootSessionContent({ agentId, initialText }: Pick<Props, 'agentId' | 'initialText'>) {
  const parentGlobalContext = useGlobal();
  const [sessionId, setSessionId] = React.useState('');
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
    const agentInfo = [...agentList, ...employeesList].find(
      (item: IAgentCache) => `${item.agentId || item.id}` === `${agentId}`
    );
    setAgentType(agentInfo?.agentType || agentTypeMap.common);
  }, [agentId, agentList, employeesList]);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      eventEmitterRef.current.emit('queryInput-set-value', initialText);
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [initialText]);

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

export default function TroubleshootSessionDrawer({ agentId, initialText, onClose, open }: Props) {
  const intl = useIntl();

  return (
    <Drawer
      open={open}
      width="50vw"
      mask={false}
      title={intl.formatMessage({ id: 'messageList.troubleshoot' })}
      onClose={onClose}
      destroyOnHidden
      bodyStyle={{ height: '100%', padding: 0 }}
      styles={{
        body: {
          height: '100%',
          overflow: 'hidden',
          padding: 0,
        },
      }}
    >
      <TroubleshootSessionContent agentId={agentId} initialText={initialText} />
    </Drawer>
  );
}
