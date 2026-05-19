import React, { lazy, memo, Suspense, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { IProps as pIProps } from '@/components/QueryInput/queryInputBase';
import ChatLayoutCompContext from '@/components/ChatLayoutComp/hooks/useContext';
// import CleanSession from './components/CleanSession';
import { agentTypeMap } from '@/constants/agent';
import { chatModeMap, IChatModeType } from '@/constants/query';
import useGlobal from '@/hooks/useGlobal';

import useAppStore from '@/models/common/useAppStore';

const ChatQueryInput = lazy(() => import('@/components/QueryInput/Chat'));
const EmployeesQueryInput = lazy(() => import('@/components/QueryInput/Employees'));
const SearchAndQueryQueryInput = lazy(
  () => import('@/pages/searchAndQuery/components/ChatLayoutComp/components/QueryInput/QueryInputComp')
);

export type IProps = {
  selectedKnowledgeInfo?: any;
  queryInputRef?: React.RefObject<any>;
} & Omit<pIProps, 'getMessageList' | 'chatMode' | 'setChatMode' | 'globalContext' | 'userInfo'>;

function QueryInput(props: IProps) {
  const { myAgentType, queryInputRef, cannotSTT, ...rest } = props;

  const onQueryInputCompMountedCallback = useRef<() => void>(undefined);

  const { ENV } = useAppStore();
  const [chatMode, setChatMode] = React.useState<IChatModeType>(() => {
    return chatModeMap.expert;
  });

  const { getMessageList } = useContext(ChatLayoutCompContext);
  const globalContext = useGlobal();
  const { agentInfo } = globalContext;

  const agentIdRef = useRef(agentInfo?.agentId);
  const agentId = agentInfo?.agentId;
  agentIdRef.current = agentId;

  const onReceivedChatMessages = useCallback((metadata?: string) => {
    if (metadata) {
      try {
        const metaObj = JSON.parse(metadata);
        if (metaObj.mode) {
          let nextChatMode = metaObj.mode;
          if (nextChatMode === chatModeMap.base) {
            nextChatMode = chatModeMap.expert;
          }
          setChatMode(nextChatMode);
        }
      } catch (error) {
        console.error(error);
      }
    }
  }, []);

  useEffect(() => {
    const { EventEmitter } = globalContext;
    const onSetSchema = (schema: { agentId: string; agentType: string; resourceList: any[] }) => {
      if ((!agentIdRef.current && !!schema.agentId) || (!!agentIdRef.current && !schema.agentId)) {
        // agentId从有到无，或者从无到有，都需要重新渲染输入框
        onQueryInputCompMountedCallback.current = () => {
          EventEmitter.emit('queryInput-set-schema-imme', schema);
        };
      } else {
        EventEmitter.emit('queryInput-set-schema-imme', schema);
      }
    };

    EventEmitter.on('queryInput-set-schema', onSetSchema);
    EventEmitter.on('RECEIVE_SESSION_RECORDS_LAST_METADATA', onReceivedChatMessages);

    return () => {
      EventEmitter.off('queryInput-set-schema', onSetSchema);
      EventEmitter.off('RECEIVE_SESSION_RECORDS_LAST_METADATA', onReceivedChatMessages);
    };
  }, []);

  const QueryInputComp = useMemo(() => {
    if (myAgentType === agentTypeMap.searchAndQuery) {
      return SearchAndQueryQueryInput;
    }

    // 有数字员工时显示数字员工输入框；未选择数字员工时走普通对话框，并由发送 payload 显式带上默认超级助手。
    if (agentId) {
      return EmployeesQueryInput;
    }

    return ChatQueryInput;
  }, [myAgentType, agentId]);

  const onQueryInputCompMounted = useCallback(() => {
    if (onQueryInputCompMountedCallback.current) {
      onQueryInputCompMountedCallback.current();
      onQueryInputCompMountedCallback.current = undefined;
    }
  }, []);

  useEffect(() => {
    if (agentId) {
      setChatMode(chatModeMap.expert);
    }
  }, [agentId]);

  return (
    <Suspense fallback="">
      {/* <CleanSession /> */}
      <QueryInputComp
        {...rest}
        cannotSTT={cannotSTT || !!ENV?.includes?.('asr')}
        myAgentType={myAgentType}
        chatMode={chatMode}
        getMessageList={getMessageList}
        setChatMode={setChatMode}
        globalContext={globalContext}
        ref={queryInputRef}
        onMounted={onQueryInputCompMounted}
      />
    </Suspense>
  );
}

export default memo(QueryInput);
