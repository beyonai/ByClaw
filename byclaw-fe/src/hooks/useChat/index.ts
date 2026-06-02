/**
 * useChat/index.ts
 *
 * 聊天核心功能Hook，用于管理聊天会话、消息发送和接收
 * 集成了消息存储、会话管理和SSE通信
 * 处理不同类型的消息内容和响应状态
 */
import { useCallback, useRef, useEffect, useMemo, useState, RefObject } from 'react';

// @ts-ignore
import { useSelector, useDispatch } from '@umijs/max';
import { cloneDeep, flow, get, noop, set, unset, isNil, pick, debounce, omit, isFunction, assign } from 'lodash';

import usePersistFn from '@/hooks/usePersistFn';
import useSend from '@/hooks/useSseSender/useSend';
import { compareStreamId, subscribeChatStream, type ParsedChatStreamMessage } from '@/hooks/useSseSender/chatStream';
import { getChatRunningSnapshot, getChatRunningStatus } from '@/service/message';

import { UserState } from '@/models/common/user';
import { ISessionState } from '@/models/session';
import useAppStore from '@/models/common/useAppStore';

import { createMessage, fetchMessageHandler } from '@/utils/messgae';
import { getFileTypeByName } from '@/utils/file';

import useHandler from './useHandler';
import useMessage from './useMessage';
import useGlobal from '@/hooks/useGlobal';
import webSocketManager from '@/utils/websocket';
import { chatSessionRuntimeManager, type RunningChatInfo } from '@/utils/chatSessionRuntimeManager';

import { IMessageState } from '@/constants/message';
import { agentTypeMap, ROOT_AGENT_ID } from '@/constants/agent';

import type { IAgentCache, IAgentType } from '@/typescript/agent';
import type { IExtParams, IMessage, IMessageListItem } from '@/typescript/message';
import type { ISession } from '@/typescript/session';
import type { IState as IEmployeesState } from '@/models/useEmployees';
import type { IState } from '@/models/useEmployees';
import type { RichInputResourceList } from '@/components/QueryInput/RichInput';
import type { IMessageInfo } from '@/models/useMessageStore';

type ISseRes = {
  message: IMessageListItem;
  messageId: string;
  sessionId: string;
  queryMessageId: string;
  resComIds?: [];
  metadata?: string;
  traceId?: string;
  sessionExts?: Array<{ extParamName?: string; extParamCode: string; extParamValue: string }>;
};

export type IOnionsProps = {
  sseRes: Partial<ISseRes> & Partial<ISession>;
  sseMsg: any;
  newQueryMsg: IMessage;
  newAnswerMsg: IMessage;
  messageList: IMessage[];
};

interface ConnectState {
  user: UserState;
  session: ISessionState;
  employees: IState;
}

/**
 * useChat的参数类型定义
 * @type IProps
 * @property {string} [sessionId] - 会话ID
 * @property {string} [agentType] - 代理类型，用于区分不同的聊天模式
 */
type IProps = {
  chatUrl?: string;
  sessionId?: string;
  agentType?: IAgentType;
  addSession: (newSession: ISession) => void;

  onBeforeSend?: () => void;
};

/**
 * 发送查询的参数类型定义
 * @type ISendProps
 * @property {string} queryQuestion - 查询问题文本
 * @property {Record<string, unknown>} [payload] - 附加数据载荷
 * @property {object} [msgOpt] - 消息选项
 * @property {Record<string, unknown>} [msgOpt.queryMsg] - 查询消息的额外属性
 * @property {Record<string, unknown>} [msgOpt.answerMsg] - 回答消息的额外属性
 */
export type ISendProps = {
  queryQuestion: string;
  inheritQryMsgId?: IMessage['msgId'];
  payload?: Record<string, unknown>;
  msgOpt?: {
    queryMsg?: Record<string, unknown>;
    answerMsg?: Record<string, unknown>;
  };
  resourceList?: RichInputResourceList;
};

export type ISendConf = {
  onlyQuery?: boolean;
};

type ChatStreamContext = {
  clientRequestId: string;
  queryMsg: IMessage;
  answerMsg: IMessage;
  onlyQuery?: boolean;
  restored?: boolean;
};

const getMessageValue = (message: any, res: any, keys: string[]) => {
  for (const key of keys) {
    const value = get(message, key) ?? get(res, key);
    if (!isNil(value) && `${value}`) {
      return `${value}`;
    }
  }
  return undefined;
};

const getChatStreamClientRequestId = (message: any, res?: any) =>
  getMessageValue(message, res, ['clientRequestId', 'data.clientRequestId']);

const getChatStreamSessionId = (message: any, res?: any) =>
  getMessageValue(message, res, ['sessionId', 'chatId', 'data.sessionId', 'data.chatId']);

const pendingChatStreamRef: RefObject<Map<string, ChatStreamContext>> = {
  current: new Map(),
};

const getRestoredStreamKey = (targetSessionId?: string | number, traceId?: string) =>
  `${targetSessionId || ''}:${traceId || ''}`;

const getParsedTraceId = (parsed: ParsedChatStreamMessage) =>
  get(parsed.rawMessage, 'traceId') || get(parsed.res, 'traceId') || get(parsed.res, 'data.traceId');

/**
 * 聊天功能Hook
 * 提供消息发送、接收、会话管理等核心聊天功能
 *
 * @param {IProps} props - 聊天参数
 * @returns {object} 聊天相关方法和状态
 */
function useChat(props: IProps) {
  const { sessionId, agentType, addSession, onBeforeSend = noop, chatUrl } = props;

  const messageListRef = useRef<IMessage[]>([]);
  const restoringStreamKeysRef = useRef(new Set<string>());
  const restoredStreamBufferRef = useRef(new Map<string, ParsedChatStreamMessage[]>());
  const [runtimeVersion, setRuntimeVersion] = useState(0);

  const { userInfo, extParamsBySessionId } = useSelector((state: ConnectState) => ({
    userInfo: state.user.userInfo,
    extParamsBySessionId: state.session.extParamsBySessionId,
  }));
  const { defaultDigEmployeeId, employeesList } = useSelector((state: { employees: IEmployeesState }) => ({
    defaultDigEmployeeId: state.employees.defaultDigEmployeeId,
    employeesList: state.employees.employeesList,
  }));
  const dispatch = useDispatch();

  const { agentId } = useGlobal();
  const { setUserCollectModalOpen, setLoginModalOpen } = useAppStore();

  // 避免频繁更新组件
  const getMessageList = useCallback(() => {
    return messageListRef.current;
  }, []);

  // 获取消息发送方法
  const { send } = useSend({ sessionId, agentType, chatUrl });

  // 获取消息相关方法和状态
  const {
    messageList,
    hasMore,
    deleteMessage,
    setSessionId,
    getMoreSessionMessage,
    setMessageList,
    updateMessage,
    reloadLatestMessageList,
  } = useMessage({
    sessionId,
  });

  const {
    sessionInfoHandler,
    messageIdHandler,
    queryMessageIdHandler,
    messageHandler,
    resComIdsHandler,
    textHandler,
    rewriteQuestionHandler,
    browserHandler,
  } = useHandler({ addSession, setSessionId });

  const flowHandler = useMemo(
    () =>
      flow(
        [
          sessionInfoHandler,
          messageIdHandler,
          queryMessageIdHandler,
          rewriteQuestionHandler,
          textHandler,
          messageHandler,
          resComIdsHandler,
          browserHandler,
        ].filter(isFunction)
      ),
    [
      sessionInfoHandler,
      messageIdHandler,
      queryMessageIdHandler,
      rewriteQuestionHandler,
      textHandler,
      messageHandler,
      resComIdsHandler,
      browserHandler,
    ]
  );

  useEffect(() => {
    messageListRef.current = messageList;
  }, [messageList]);

  useEffect(() => {
    return chatSessionRuntimeManager.subscribe(() => {
      setRuntimeVersion((version) => version + 1);
    });
  }, []);

  const defaultEmployee = useMemo(() => {
    if (!defaultDigEmployeeId) {
      return undefined;
    }
    return employeesList.find((item: IAgentCache) =>
      [`${item.agentId}`, `${item.id}`, `${item.resourceId}`].includes(`${defaultDigEmployeeId}`)
    );
  }, [employeesList, defaultDigEmployeeId]);

  const checkSessionStateBeforeSendQuery = usePersistFn(async () => {
    if (!sessionId) {
      return;
    }
    const sessionInfo = (await dispatch({
      type: 'messageStore/getSessionInfo',
      payload: {
        sessionId,
      },
    })) as unknown as IMessageInfo | undefined;
    if (!sessionInfo) {
      return;
    }
    const pageRange = sessionInfo.pageRange ?? [1, 1];
    if (pageRange[1] > 1) {
      throw reloadLatestMessageList();
    }
  });

  const isSessionRunning = useMemo(() => {
    return chatSessionRuntimeManager.isSessionRunning(sessionId);
  }, [sessionId, runtimeVersion]);

  const getRestoredKeyByParsed = usePersistFn((parsed: ParsedChatStreamMessage) => {
    const targetSessionId = getChatStreamSessionId(parsed.rawMessage, parsed.res);
    return getRestoredStreamKey(targetSessionId, getParsedTraceId(parsed));
  });

  const shouldApplyParsedStream = usePersistFn((parsed: ParsedChatStreamMessage) => {
    if (!parsed.streamId) return true;
    const targetSessionId = getChatStreamSessionId(parsed.rawMessage, parsed.res);
    const runtimeInfo = chatSessionRuntimeManager.getBySession(targetSessionId);
    if (!runtimeInfo?.lastAppliedStreamId) return true;
    return compareStreamId(parsed.streamId, runtimeInfo.lastAppliedStreamId) > 0;
  });

  const markParsedStreamApplied = usePersistFn((context: ChatStreamContext, parsed: ParsedChatStreamMessage) => {
    if (!parsed.streamId) return;
    set(context.answerMsg, 'streamId', parsed.streamId);
    chatSessionRuntimeManager.updateLastAppliedStreamId(context.clientRequestId, parsed.streamId);
  });

  const cancelCurrentSession = usePersistFn(() => {
    const runtimeInfo = chatSessionRuntimeManager.getBySession(sessionId);
    if (runtimeInfo?.cancel) {
      runtimeInfo.cancel();
      return;
    }

    const runningMessage = [...messageListRef.current]
      .reverse()
      .find((item) => [IMessageState.Query, IMessageState.Answer].includes(item.messageState as IMessageState));
    runningMessage?.cancelSSE?.();
  });

  const createRestoredAnswerMessage = usePersistFn((runningInfo: RunningChatInfo, sessionId?: string) => {
    const messageId = runningInfo.modelAnswerMessageId ? `${runningInfo.modelAnswerMessageId}` : '';
    const queryMsgId = runningInfo.traceId?.split('_')?.[0];
    return createMessage({
      msgId: messageId || `${runningInfo.clientRequestId || runningInfo.traceId || runningInfo.sessionId}`,
      messageId,
      text: '',
      fromBeyond: true,
      messageState: IMessageState.Answer,
      sessionId: runningInfo.sessionId ? `${runningInfo.sessionId}` : sessionId,
      traceId: runningInfo.traceId,
      queryMsgId,
      agentId: runningInfo.agentId ? `${runningInfo.agentId}` : undefined,
      agentType: runningInfo.agentType as IAgentType,
      metadata: runningInfo.agentId ? JSON.stringify({ agentId: runningInfo.agentId }) : '',
    });
  });

  const createRestoredAnswerMessageFromSnapshot = usePersistFn((snapshot: any, runningInfo: RunningChatInfo) => {
    const answerMsg = createMessage(fetchMessageHandler(snapshot));
    if (runningInfo.clientRequestId) {
      set(answerMsg, 'msgId', runningInfo.clientRequestId);
    }
    const queryMsgId = runningInfo.traceId?.split('_')?.[0];
    set(answerMsg, 'messageState', IMessageState.Answer);
    set(answerMsg, 'traceId', snapshot?.traceId || runningInfo.traceId);
    set(answerMsg, 'snapshotStreamId', snapshot?.snapshotStreamId);
    set(answerMsg, 'streamId', snapshot?.snapshotStreamId);
    set(answerMsg, 'queryMsgId', answerMsg.queryMsgId || queryMsgId);
    set(
      answerMsg,
      'sessionId',
      snapshot?.sessionId ? `${snapshot.sessionId}` : `${runningInfo.sessionId || sessionId}`
    );
    if (!answerMsg.agentId && runningInfo.agentId) {
      set(answerMsg, 'agentId', `${runningInfo.agentId}`);
    }
    if (!answerMsg.agentType && runningInfo.agentType) {
      set(answerMsg, 'agentType', runningInfo.agentType);
    }
    if (!answerMsg.metadata && runningInfo.agentId) {
      set(answerMsg, 'metadata', JSON.stringify({ agentId: runningInfo.agentId }));
    }
    return answerMsg;
  });

  const stopRestoredRunningSession = usePersistFn((answerMsg: IMessage, runningInfo?: RunningChatInfo) => {
    if (answerMsg.messageState === IMessageState.Cancel) return Promise.resolve();
    set(answerMsg, 'messageState', IMessageState.Cancel);
    updateMessage(answerMsg);
    chatSessionRuntimeManager.completeBySession(answerMsg.sessionId || sessionId);

    return webSocketManager.sendMessageWhenReady({
      type: 'STOP_CHAT',
      clientRequestId: runningInfo?.clientRequestId || answerMsg.msgId,
      sessionId: answerMsg.sessionId || runningInfo?.sessionId || sessionId,
      messageId: answerMsg.messageId || runningInfo?.modelAnswerMessageId,
      agentId: runningInfo?.agentId || answerMsg.agentId || null,
      agentCode: runningInfo?.agentCode || null,
      agentType: runningInfo?.agentType || answerMsg.agentType,
    });
  });

  const findPendingChatStreamContext = usePersistFn((rawMessage: any, res?: any) => {
    const clientRequestId = getChatStreamClientRequestId(rawMessage, res);
    if (clientRequestId) {
      const pending = pendingChatStreamRef.current.get(clientRequestId);
      if (pending) return pending;
    }

    const messageSessionId = getChatStreamSessionId(rawMessage, res);
    if (!messageSessionId) return undefined;

    return Array.from(pendingChatStreamRef.current.values()).find((pending) => {
      return [pending.queryMsg.sessionId, pending.answerMsg.sessionId].some(
        (item) => item && `${item}` === `${messageSessionId}`
      );
    });
  });

  const resolveRestoredChatStreamContext = usePersistFn((sessionId?: string): ChatStreamContext | undefined => {
    const runtimeInfo = chatSessionRuntimeManager.getBySession(sessionId);
    if (!runtimeInfo?.restored) return undefined;

    const answerMessageId = runtimeInfo.answerMessageId || runtimeInfo.answerClientMsgId;
    let answerMsg = messageListRef.current.find((item) => {
      return item.fromBeyond && [`${item.messageId}`, `${item.msgId}`].includes(`${answerMessageId}`);
    });
    if (!answerMsg) {
      answerMsg = createRestoredAnswerMessage(
        {
          sessionId,
          clientRequestId: runtimeInfo.clientRequestId,
          traceId: runtimeInfo.traceId,
          modelAnswerMessageId: answerMessageId,
          agentId: runtimeInfo.agentId,
          agentCode: runtimeInfo.agentCode,
          agentType: runtimeInfo.agentType,
          running: true,
        },
        sessionId
      );
    }
    const askMessageId = answerMsg.queryMsgId || '';
    const queryMsg =
      messageListRef.current.find((item) => {
        return [`${item.messageId}`, `${item.msgId}`].includes(`${askMessageId}`);
      }) ||
      createMessage({
        msgId: askMessageId,
        messageId: askMessageId,
        text: '',
        fromBeyond: false,
        messageState: IMessageState.Done,
        sessionId,
      });

    return {
      clientRequestId: runtimeInfo.clientRequestId,
      queryMsg,
      answerMsg,
      restored: true,
    };
  });

  const resolveChatStreamContext = usePersistFn((parsed: ParsedChatStreamMessage): ChatStreamContext | undefined => {
    return (
      findPendingChatStreamContext(parsed.rawMessage, parsed.res) ||
      resolveRestoredChatStreamContext(getChatStreamSessionId(parsed.rawMessage, parsed.res))
    );
  });

  const completeChatStreamContext = usePersistFn((context: ChatStreamContext, messageState: IMessageState) => {
    if (context.answerMsg.messageState !== IMessageState.Cancel) {
      set(context.answerMsg, 'messageState', messageState);
    }
    unset(context.answerMsg, 'cancelSSE');
    pendingChatStreamRef.current.delete(context.clientRequestId);
    chatSessionRuntimeManager.complete(context.clientRequestId);
  });

  const handleChatStreamPayload = usePersistFn((parsed: ParsedChatStreamMessage, context: ChatStreamContext) => {
    const { eventName, formattedPayload, rawMessage, sseMsg, streamId } = parsed;
    if (streamId) {
      set(context.answerMsg, 'streamId', streamId);
    }

    flowHandler({
      sseRes: formattedPayload,
      sseMsg: {
        ...sseMsg,
        id: context.clientRequestId,
        sessionExts: rawMessage.sessionExts,
        data: typeof rawMessage.data === 'string' ? rawMessage.data : JSON.stringify(rawMessage.data || {}),
      },
      newQueryMsg: context.queryMsg,
      newAnswerMsg: context.answerMsg,
      messageList: messageListRef.current,
    });

    const nextSessionId = context.answerMsg.sessionId || get(formattedPayload, 'sessionId');
    chatSessionRuntimeManager.bindSession(context.clientRequestId, nextSessionId ? `${nextSessionId}` : undefined);

    if (['error'].includes(eventName)) {
      completeChatStreamContext(context, IMessageState.Error);
    }

    if (['appStreamResponse'].includes(eventName)) {
      completeChatStreamContext(context, IMessageState.Done);
    }

    if (!context.onlyQuery) {
      context.queryMsg = updateMessage(context.queryMsg);
    }
    context.answerMsg = updateMessage(context.answerMsg, { isAssign: context.restored });
    markParsedStreamApplied(context, parsed);
  });

  useEffect(() => {
    const unsubscribeChatStream = subscribeChatStream({
      match: (message) => {
        if (findPendingChatStreamContext(message)) return true;
        if (!sessionId) return false;
        return `${message.sessionId}` === `${sessionId}`;
      },
      filterParsed: ({ rawMessage, res }) => {
        if (findPendingChatStreamContext(rawMessage, res)) return true;
        const messageSessionId = getChatStreamSessionId(rawMessage, res);

        // if (!sessionId || `${rawMessage.sessionId}` !== `${sessionId}`) return false;

        const runtimeInfo = chatSessionRuntimeManager.getBySession(messageSessionId);
        if (!runtimeInfo?.restored) return false;

        const traceId = rawMessage.traceId || res.traceId || get(res, 'data.traceId');
        return !(runtimeInfo.traceId && traceId && `${runtimeInfo.traceId}` !== `${traceId}`);
      },
      onPayload: (parsed) => {
        if (!shouldApplyParsedStream(parsed)) return;
        const restoredKey = getRestoredKeyByParsed(parsed);
        if (restoringStreamKeysRef.current.has(restoredKey)) {
          const buffered = restoredStreamBufferRef.current.get(restoredKey) || [];
          buffered.push(parsed);
          restoredStreamBufferRef.current.set(restoredKey, buffered);
          return;
        }
        const context = resolveChatStreamContext(parsed);
        if (!context) return;
        handleChatStreamPayload(parsed, context);
      },
    });

    const errorHandler = (message: any) => {
      const context = findPendingChatStreamContext(message);
      if (!context) return;
      set(context.answerMsg, 'messageTip', get(message, 'message') || get(message, 'chatContent') || 'WebSocket error');
      completeChatStreamContext(context, IMessageState.Error);
      context.answerMsg = updateMessage(context.answerMsg);
    };

    webSocketManager.onMessage('ERROR', errorHandler);

    return () => {
      unsubscribeChatStream();
      webSocketManager.offMessage('ERROR', errorHandler);
    };
  }, [
    sessionId,
    getRestoredKeyByParsed,
    findPendingChatStreamContext,
    resolveChatStreamContext,
    handleChatStreamPayload,
    completeChatStreamContext,
    shouldApplyParsedStream,
    updateMessage,
  ]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    let disposed = false;
    let restoreKey = '';

    getChatRunningStatus({ sessionIds: [sessionId] })
      .then(async (list: RunningChatInfo[] = []) => {
        if (disposed) return;
        const runningInfo = list.find((item) => `${item.sessionId}` === `${sessionId}`);
        if (!runningInfo || !runningInfo.traceId) {
          return;
        }
        if (!runningInfo.running) {
          chatSessionRuntimeManager.completeBySession(sessionId);
          return;
        }

        restoreKey = getRestoredStreamKey(sessionId, runningInfo.traceId);
        restoringStreamKeysRef.current.add(restoreKey);

        const messageId = runningInfo.modelAnswerMessageId ? `${runningInfo.modelAnswerMessageId}` : '';
        let answerMsg = messageListRef.current.find((item) => {
          return `${item.messageId}` === messageId || `${item.msgId}` === `${runningInfo.clientRequestId}`;
        });

        if (!answerMsg) {
          answerMsg = createRestoredAnswerMessage(runningInfo, sessionId);
        }
        answerMsg.cancelSSE = debounce(() => stopRestoredRunningSession(answerMsg!, runningInfo), 100);
        set(answerMsg, 'messageState', IMessageState.Answer);
        answerMsg = updateMessage(answerMsg, { isAssign: true });
        chatSessionRuntimeManager.hydrateRunning(runningInfo, () => answerMsg?.cancelSSE?.());

        let snapshotAnswerMsg: IMessage | undefined;
        try {
          const snapshot = await getChatRunningSnapshot({
            sessionId,
            traceId: runningInfo.traceId,
            modelAnswerMessageId: runningInfo.modelAnswerMessageId,
          });
          if (disposed) return;
          if (snapshot?.messageId) {
            snapshotAnswerMsg = createRestoredAnswerMessageFromSnapshot(snapshot, runningInfo);
          }
        } catch (error) {
          console.error(error);
        }

        if (snapshotAnswerMsg) {
          const runtimeInfo = chatSessionRuntimeManager.getBySession(sessionId);
          const snapshotStreamId = snapshotAnswerMsg.snapshotStreamId;
          const shouldApplySnapshot =
            !snapshotStreamId ||
            !runtimeInfo?.lastAppliedStreamId ||
            compareStreamId(snapshotStreamId, runtimeInfo.lastAppliedStreamId) > 0;
          if (shouldApplySnapshot) {
            assign(answerMsg, snapshotAnswerMsg);
            answerMsg.cancelSSE = debounce(() => stopRestoredRunningSession(answerMsg!, runningInfo), 100);
            set(answerMsg, 'messageState', IMessageState.Answer);
            answerMsg = updateMessage(answerMsg, { isAssign: true });
            chatSessionRuntimeManager.updateLastAppliedStreamId(
              runtimeInfo?.clientRequestId || runningInfo.clientRequestId || answerMsg.msgId,
              snapshotStreamId
            );
          }
        }

        const buffered = restoredStreamBufferRef.current.get(restoreKey) || [];
        restoredStreamBufferRef.current.delete(restoreKey);
        restoringStreamKeysRef.current.delete(restoreKey);
        buffered
          .filter(shouldApplyParsedStream)
          .sort((a, b) => compareStreamId(a.streamId, b.streamId))
          .forEach((parsed) => {
            const context = resolveChatStreamContext(parsed);
            if (!context) return;
            handleChatStreamPayload(parsed, context);
          });
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      disposed = true;
      if (restoreKey) {
        restoringStreamKeysRef.current.delete(restoreKey);
        restoredStreamBufferRef.current.delete(restoreKey);
      }
    };
  }, [
    sessionId,
    createRestoredAnswerMessage,
    createRestoredAnswerMessageFromSnapshot,
    handleChatStreamPayload,
    resolveChatStreamContext,
    shouldApplyParsedStream,
    stopRestoredRunningSession,
    updateMessage,
  ]);

  /**
   * 发送查询函数
   * 处理消息发送、接收和状态更新的完整流程
   * 使用usePersistFn确保函数引用稳定
   *
   * @param {ISendProps} sendProps - 发送参数
   * @returns {boolean|object} 发送结果，失败返回false，成功返回包含promise和cancel方法的对象
   */
  const sendQuery = usePersistFn(async (sendProps: ISendProps, conf: ISendConf = {}) => {
    // 检查用户是否已登录
    if (!userInfo) {
      // 未登录，显示登录弹窗
      setLoginModalOpen(true);
      return false;
    }
    const isRetented = isNil(userInfo?.isRetented) ? true : userInfo?.isRetented;
    if (!isRetented) {
      setUserCollectModalOpen(true);
      return false;
    }

    const { queryQuestion, payload = {}, msgOpt = {} } = sendProps;
    const isResumeChat = get(payload, 'actionType') === 'RESUME';
    // 追问 RESUME：当前列表末尾常为「助手仍在回答」，需允许继续走与底部输入框一致的发送流程
    if (!isResumeChat) {
      if (isSessionRunning) {
        return false;
      }
    }

    await checkSessionStateBeforeSendQuery();

    const { onlyQuery = false } = conf;
    const { inheritQryMsgId } = sendProps;
    let { resourceList } = sendProps;

    const myExtParams = get(payload, 'extParams');
    const restPayload = omit(payload, ['extParams']);

    await onBeforeSend?.();

    let _queryQuestion = queryQuestion;
    let _agentId = (get(restPayload, 'agentId') || agentId) as string | undefined;
    let _agentType = (get(restPayload, 'agentType') || agentType) as IAgentType | undefined;

    if (_agentId === ROOT_AGENT_ID || !_agentId) {
      _agentId = defaultEmployee?.agentId || '';
      _agentType = defaultEmployee?.agentType || agentTypeMap.agent;
    }

    if (inheritQryMsgId) {
      // 如果传了inheritQryMsgId，表示是基于那个发送的消息再次发送，这个时候要取到上一次发送的agentType和resourceList
      const lastTimeQryMsg = messageListRef.current.find((item) => item.msgId === inheritQryMsgId);
      if (lastTimeQryMsg) {
        if (lastTimeQryMsg.agentType) {
          _agentType = lastTimeQryMsg.agentType;
        }
        // 上一次消息发送的resourceList参数，这一次自动发送也要带上
        if (!resourceList && lastTimeQryMsg.resourceList) {
          ({ resourceList } = lastTimeQryMsg);
        }
        if (!_queryQuestion) {
          _queryQuestion = lastTimeQryMsg.text || '';
        }
        if (!payload.files && lastTimeQryMsg.fileList) {
          const files = lastTimeQryMsg.fileList.map((item) => {
            if (item.queryFile) {
              return {
                ...pick(item.queryFile, ['fileId', 'fileName', 'fileUrl']),
                fileType: getFileTypeByName(item?.queryFile?.fileName || ''),
                fileSize: item.queryFile.length,
              };
            }
            return item;
          });
          restPayload.files = files;
          set(msgOpt, 'queryMsg.fileList', files);
          // extParams参数里面的文件，每个数字员工的参数格式都不一样，做不了统一处理
        }
      }
    }

    // 创建用户查询消息对象
    let newQueryMsg = createMessage({
      text: _queryQuestion,
      fromBeyond: false,
      messageState: IMessageState.Done,
      sessionId,
      resourceList,
      agentType: _agentType,
      ...get(msgOpt, 'queryMsg', {}),
    });

    if (!onlyQuery) {
      newQueryMsg = updateMessage(newQueryMsg, { isAssign: true });
    }

    // 创建AI回答消息对象(初始为空)
    let newAnswerMsg = createMessage({
      text: '',
      fromBeyond: true,
      messageState: IMessageState.Query,
      queryMsgId: newQueryMsg.msgId,
      agentId: _agentId,
      sessionId,
      agentType: _agentType,
      metadata: _agentId ? JSON.stringify({ agentId: _agentId }) : '',
      ...get(msgOpt, 'answerMsg', {}),
    });

    const extParams = Object.assign<IExtParams, Record<string, unknown>>(
      cloneDeep(get(extParamsBySessionId, `${sessionId}`) || {}),
      {
        ...(myExtParams || {}),
        clientId: newAnswerMsg.msgId,
      }
    );
    set(newQueryMsg, 'extParams', extParams);
    set(newQueryMsg, 'answerMsgId', newAnswerMsg.msgId);

    const clientRequestId = newAnswerMsg.msgId;

    pendingChatStreamRef.current.set(clientRequestId, {
      clientRequestId,
      queryMsg: newQueryMsg,
      answerMsg: newAnswerMsg,
      onlyQuery,
    });

    chatSessionRuntimeManager.register({
      clientRequestId,
      answerClientMsgId: clientRequestId,
      sessionId: newAnswerMsg.sessionId,
      restored: false,
      cancel: () => newAnswerMsg.cancelSSE?.(),
    });

    // 发送请求并处理SSE响应
    const sendResult = send(_queryQuestion, {
      sessionId,
      resourceList,
      extParams,
      clientRequestId,
      ...restPayload,
      agentId: Number(_agentId) ? _agentId : null,
      agentCode: Number(_agentId) ? null : _agentId,
      agentType: _agentType,
    });
    const cancel = () => {
      pendingChatStreamRef.current.delete(clientRequestId);
      sendResult.cancel();
    };

    // 添加取消功能到回答消息
    newAnswerMsg.cancelSSE = debounce(() => {
      if (newAnswerMsg.messageState === IMessageState.Cancel) return Promise.resolve();
      set(newAnswerMsg, 'messageState', IMessageState.Cancel);

      updateMessage(newAnswerMsg);

      chatSessionRuntimeManager.complete(newAnswerMsg.msgId);

      cancel();

      return webSocketManager.sendMessageWhenReady({
        type: 'STOP_CHAT',
        clientRequestId: newAnswerMsg.msgId,
        ...pick(newAnswerMsg, ['agentId', 'sessionId', 'messageId', 'agentType']),
        agentId: Number(_agentId) ? _agentId : null,
        agentCode: Number(_agentId) ? null : _agentId,
      });
    }, 100);

    // 更新回答消息
    newAnswerMsg = updateMessage(newAnswerMsg, { isAssign: true });
    const pending = pendingChatStreamRef.current.get(clientRequestId);
    if (pending) {
      pending.answerMsg = newAnswerMsg;
    }

    return { cancel };
  });

  /**
   * 加载更多消息的方法
   */
  const onNext = useCallback(
    (isPrev?: boolean) => {
      if (!sessionId) return undefined;
      return getMoreSessionMessage(sessionId, isPrev);
    },
    [sessionId]
  );

  // 返回聊天相关的方法和状态
  return {
    messageList, // 消息列表
    sendQuery, // 发送查询的方法
    hasMore, // 是否有更多消息(用于分页)
    onNext, // 加载更多消息的方法
    updateMessage, // 更新消息的方法
    deleteMessage, // 删除消息的方法
    isSessionRunning,
    cancelCurrentSession,

    getMessageList,
    setMessageList,
  };
}

export default useChat;
