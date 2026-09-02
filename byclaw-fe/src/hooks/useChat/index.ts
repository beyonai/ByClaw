/**
 * useChat/index.ts
 *
 * 聊天核心功能Hook，用于管理聊天会话、消息发送和接收
 * 集成了消息存储、会话管理和SSE通信
 * 处理不同类型的消息内容和响应状态
 */
import { useCallback, useRef, useEffect, useMemo, useState } from 'react';

// @ts-ignore
import { useSelector, useDispatch } from '@umijs/max';
import { cloneDeep, flow, get, noop, set, isNil, pick, debounce, omit, isFunction, assign } from 'lodash';

import usePersistFn from '@/hooks/usePersistFn';
import useSend from '@/hooks/useSseSender/useSend';
import { compareStreamId } from '@/hooks/useSseSender/chatStream';
import { getChatRunningSnapshot, getChatRunningStatus } from '@/service/message';

import { UserState } from '@/models/common/user';
import { ISessionState } from '@/models/session';
import useAppStore from '@/models/common/useAppStore';

import { createMessage, fetchMessageHandler } from '@/utils/messgae';
import { hydrateV2RuntimeState } from '@/utils/messageV2Runtime';
import { getFileTypeByName } from '@/utils/file';
import {
  commitScopedStream,
  getScopedChildRunState,
  isExternalChildExtParams,
  isExternalChildSession,
  isScopedChildProjection,
  isScopedStreamNewer,
} from '@/utils/scopedSession';

import useHandler from './useHandler';
import useMessage from './useMessage';
import useGlobal from '@/hooks/useGlobal';
import webSocketManager from '@/utils/websocket';
import { chatSessionRuntimeManager, type RunningChatInfo } from '@/utils/chatSessionRuntimeManager';
import {
  flushRestoredChatStreamBuffer,
  getRestoredStreamKey,
  registerPendingChatContext,
  registerSessionChatContext,
  startRestoringChatStream,
  stopRestoringChatStream,
  unregisterPendingChatContext,
  unregisterSessionChatContext,
} from './chatRuntime';

import { IMessageState } from '@/constants/message';
import { agentTypeMap, ROOT_AGENT_ID } from '@/constants/agent';
import { ResourceTypeMap } from '@/constants/resource';
import { getStoredProjectScopeId } from '@/pages/projectSpace/constants';

import type { IAgentCache, IAgentType } from '@/typescript/agent';
import type { IExtParams, IMessage, IMessageListItem } from '@/typescript/message';
import type { ISession } from '@/typescript/session';
import type { IState as IEmployeesState } from '@/models/useEmployees';
import type { IState } from '@/models/useEmployees';
import type { RichInputResourceList } from '@/components/QueryInput/RichInput';
import type { IMessageInfo } from '@/models/useMessageStore';
import { getSessionLastAnsMsgMetadata } from './util';
import { resolveDigitalEmployeePlaceholders } from '@/utils/session';

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

  /** 编辑页调试时锁定的数字员工资源 ID。 */
  fixedAgentId?: string;
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

  /** 输入框展示给用户的文本，包含数字员工名称；queryQuestion 仍保留后端识别所需的占位符。 */
  displayText?: string;
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

function getClientRequestId(queryMsgId: string, answerMsgId: string) {
  return `${queryMsgId}_${answerMsgId}`;
}

function getAnswerClientMsgId(clientRequestId: string) {
  return clientRequestId.split('_')[1];
}

function getQueryClientMsgId(clientRequestId: string) {
  return clientRequestId.split('_')[0];
}

const getPositiveNumber = (value: unknown) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
};

// 默认项目在后端使用 -1 标识，创建会话时应与普通项目一样参与列表临时项。
const getProjectNumber = (value: unknown) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && (numberValue === -1 || numberValue > 0) ? numberValue : undefined;
};

type MultiAgentLane = {
  laneId: string;
  agentId: string | null;
  agentCode: string | null;
  agentName: string;
  clientRequestId: string;
  queryMessageId: string;
  answerMessageId: string;
  order: number;
};

const getDigitalEmployeeResources = (resourceList?: RichInputResourceList) => {
  const uniqueMap = new Map<string, RichInputResourceList[number]>();
  (resourceList || []).forEach((item) => {
    if (`${item.resourceType}` !== ResourceTypeMap.digitalEmployee) return;
    const resourceId = `${item.resourceId || item.resourceCode || item.id || ''}`;
    if (!resourceId || uniqueMap.has(resourceId)) return;
    uniqueMap.set(resourceId, item);
  });
  return Array.from(uniqueMap.values());
};

const getAgentLaneIdentity = (resource: RichInputResourceList[number]) => {
  const resourceId = `${resource.resourceId || resource.resourceCode || resource.id || ''}`;
  const isNumericAgentId = Boolean(Number(resourceId));
  const agentId = isNumericAgentId ? resourceId : null;
  const agentCode = isNumericAgentId ? resource.resourceCode || null : resource.resourceCode || resourceId || null;
  const agentName = resource.resourceName || get(resource, 'name') || '';
  return {
    agentId,
    agentCode,
    agentName,
    agentKey: agentId || agentCode || '',
  };
};

/**
 * 聊天功能Hook
 * 提供消息发送、接收、会话管理等核心聊天功能
 *
 * @param {IProps} props - 聊天参数
 * @returns {object} 聊天相关方法和状态
 */
function useChat(props: IProps) {
  const { sessionId, agentType, fixedAgentId, addSession, onBeforeSend = noop, chatUrl } = props;

  const messageListRef = useRef<IMessage[]>([]);
  const pendingProjectIdByClientRequestRef = useRef(new Map<string, string>());
  const boundProjectSessionKeysRef = useRef(new Set<string>());
  const scopedChildWatermarksRef = useRef(new Map<string, string>());
  const [runtimeVersion, setRuntimeVersion] = useState(0);

  const { userInfo, extParamsBySessionId, sessionList } = useSelector((state: ConnectState) => ({
    userInfo: state.user.userInfo,
    extParamsBySessionId: state.session.extParamsBySessionId,
    sessionList: state.session.sessionList,
  }));
  const { defaultDigEmployeeId, employeesList } = useSelector((state: { employees: IEmployeesState }) => ({
    defaultDigEmployeeId: state.employees.defaultDigEmployeeId,
    employeesList: state.employees.employeesList,
  }));
  const dispatch = useDispatch();

  const isCurrentExternalChildSession = useMemo(
    () =>
      isExternalChildSession(sessionList?.find((item) => `${item.sessionId}` === `${sessionId}`)) ||
      isExternalChildExtParams(get(extParamsBySessionId, `${sessionId}`)),
    [extParamsBySessionId, sessionId, sessionList]
  );

  const { agentId, EventEmitter } = useGlobal();
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
    waitForSessionMessageLoaded = () => Promise.resolve(),
    getSessionMessageLoadState = () => 'idle' as const,
    retrySessionMessageLoad = () => Promise.resolve(),
    applyScopedChildProjectionMessage,
  } = useMessage({
    sessionId,
  });

  const bindSessionToProject = usePersistFn(
    (projectId: unknown, targetSessionId: unknown, clientRequestId?: string, session?: ISession) => {
      const normalizedProjectId = getProjectNumber(projectId);
      const normalizedSessionId = getPositiveNumber(targetSessionId);
      if (normalizedProjectId === undefined || !normalizedSessionId) {
        return;
      }

      const cacheKey = `${normalizedProjectId}:${normalizedSessionId}`;
      if (boundProjectSessionKeysRef.current.has(cacheKey)) {
        if (clientRequestId) {
          pendingProjectIdByClientRequestRef.current.delete(clientRequestId);
        }
        return;
      }

      boundProjectSessionKeysRef.current.add(cacheKey);
      // 会话归属由创建链路写入 byai_session.project_id，这里只通知项目空间刷新临时项。
      EventEmitter.emit('projectSpace-session-bound', {
        projectId: `${normalizedProjectId}`,
        sessionId: `${normalizedSessionId}`,
        clientRequestId,
        session: session
          ? {
            ...session,
            sessionId: `${normalizedSessionId}`,
          }
          : undefined,
      });
      if (clientRequestId) {
        pendingProjectIdByClientRequestRef.current.delete(clientRequestId);
      }
    }
  );

  const onSessionCreated = usePersistFn(
    (params: { sessionId: string; clientRequestId?: string; session: ISession }) => {
      const clientRequestId = params.clientRequestId || '';
      const projectId = clientRequestId ? pendingProjectIdByClientRequestRef.current.get(clientRequestId) : undefined;
      if (!projectId) {
        return;
      }

      void bindSessionToProject(projectId, params.sessionId, clientRequestId, params.session);
    }
  );

  const {
    sessionInfoHandler,
    messageIdHandler,
    queryMessageIdHandler,
    messageHandler,
    resComIdsHandler,
    textHandler,
    rewriteQuestionHandler,
    browserHandler,
    answerCompletedHandler,
  } = useHandler({ addSession, setSessionId, onSessionCreated });

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
          answerCompletedHandler,
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
      answerCompletedHandler,
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

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return;
    (window as any).__BYCLAW_E2E__ = {
      ...((window as any).__BYCLAW_E2E__ || {}),
      getChatRuntimeState: () => ({
        sessionId: sessionId || '',
        isSessionRunning: chatSessionRuntimeManager.isSessionRunning(sessionId),
      }),
      isSessionRunning: (targetSessionId?: string) =>
        chatSessionRuntimeManager.isSessionRunning(targetSessionId || sessionId),
    };
  }, [sessionId, runtimeVersion]);

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

  const syncCurrentSessionRunningState = usePersistFn(async () => {
    if (!sessionId || !chatSessionRuntimeManager.isSessionRunning(sessionId)) {
      return;
    }
    try {
      const list: RunningChatInfo[] = await getChatRunningStatus({ sessionIds: [sessionId] });
      const hasRunningInfo = list.some((item) => `${item.sessionId}` === `${sessionId}` && item.running);
      if (hasRunningInfo) {
        return;
      }
      // 后端运行状态可能晚于首轮 SSE 建立，只清理断线恢复的旧运行态，保留本地流式回答。
      if (chatSessionRuntimeManager.completeRestoredBySession(sessionId)) {
        await reloadLatestMessageList();
      }
    } catch (error) {
      console.error(error);
    }
  });

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncCurrentSessionRunningState();
      }
    };

    window.addEventListener('online', syncCurrentSessionRunningState);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const timer = window.setInterval(syncCurrentSessionRunningState, 30000);

    return () => {
      window.removeEventListener('online', syncCurrentSessionRunningState);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(timer);
    };
  }, [sessionId, syncCurrentSessionRunningState]);

  const cancelCurrentSession = usePersistFn(() => {
    const runningMessage = [...messageListRef.current]
      .reverse()
      .find((item) => [IMessageState.Query, IMessageState.Answer].includes(item.messageState as IMessageState));
    if (runningMessage?.cancelSSE) {
      runningMessage.cancelSSE();
      return;
    }

    const runtimeInfo = chatSessionRuntimeManager.getBySession(sessionId);
    runtimeInfo?.cancel?.();
  });

  const createRestoredAnswerMessage = usePersistFn((runningInfo: RunningChatInfo, sessionId?: string) => {
    const messageId = runningInfo.modelAnswerMessageId ? `${runningInfo.modelAnswerMessageId}` : '';
    return createMessage({
      msgId: getAnswerClientMsgId(runningInfo.clientRequestId),
      messageId,
      text: '',
      fromBeyond: true,
      messageState: IMessageState.Answer,
      sessionId: runningInfo.sessionId ? `${runningInfo.sessionId}` : sessionId,
      traceId: runningInfo.traceId,
      laneId: runningInfo.laneId,
      turnId: runningInfo.turnId,
      queryMsgId: getQueryClientMsgId(runningInfo.clientRequestId),
      agentId: runningInfo.agentId ? `${runningInfo.agentId}` : undefined,
      agentType: runningInfo.agentType as IAgentType,
      metadata: runningInfo.agentId
        ? JSON.stringify({
          agentId: runningInfo.agentId,
          agentCode: runningInfo.agentCode,
          agentName: runningInfo.agentName,
          laneId: runningInfo.laneId,
          turnId: runningInfo.turnId,
        })
        : '',
    } as any);
  });

  const createRestoredAnswerMessageFromSnapshot = usePersistFn((snapshot: any, runningInfo: RunningChatInfo) => {
    const answerMsg = createMessage(fetchMessageHandler(snapshot));
    set(answerMsg, 'msgId', getAnswerClientMsgId(runningInfo.clientRequestId));
    set(answerMsg, 'messageState', IMessageState.Answer);
    set(answerMsg, 'thinkDone', false);
    set(answerMsg, 'traceId', snapshot?.traceId || runningInfo.traceId);
    set(answerMsg, 'laneId', snapshot?.laneId || runningInfo.laneId);
    set(answerMsg, 'turnId', snapshot?.turnId || runningInfo.turnId);
    set(answerMsg, 'snapshotStreamId', snapshot?.snapshotStreamId);
    set(answerMsg, 'streamId', snapshot?.snapshotStreamId);
    set(answerMsg, 'queryMsgId', getQueryClientMsgId(runningInfo.clientRequestId));
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
      set(
        answerMsg,
        'metadata',
        JSON.stringify({
          agentId: runningInfo.agentId,
          agentCode: runningInfo.agentCode,
          agentName: runningInfo.agentName,
          laneId: runningInfo.laneId,
          turnId: runningInfo.turnId,
        })
      );
    }
    hydrateV2RuntimeState(answerMsg);
    return answerMsg;
  });

  const stopRestoredRunningSession = usePersistFn((answerMsg: IMessage, runningInfo: RunningChatInfo) => {
    if (answerMsg.messageState === IMessageState.Cancel) return Promise.resolve();
    set(answerMsg, 'messageState', IMessageState.Cancel);
    updateMessage(answerMsg);
    chatSessionRuntimeManager.complete(runningInfo.clientRequestId);

    return webSocketManager
      .sendMessageWhenReady({
        type: 'STOP_CHAT',
        clientRequestId: runningInfo.clientRequestId,
        laneId: runningInfo.laneId || get(answerMsg, 'laneId'),
        turnId: runningInfo.turnId || get(answerMsg, 'turnId'),
        traceId: runningInfo.traceId || answerMsg.traceId,
        sessionId: answerMsg.sessionId || runningInfo.sessionId || sessionId,
        messageId: answerMsg.messageId || runningInfo.modelAnswerMessageId,
        agentId: runningInfo.agentId || answerMsg.agentId || null,
        agentCode: runningInfo.agentCode || null,
        agentType: runningInfo.agentType || answerMsg.agentType,
      })
      .catch((error) => {
        // STOP_CHAT 尽力发送，WS 未连接时忽略，避免 Unhandled Rejection。
        console.error('WebSocket 发送 STOP_CHAT 失败:', error);
      });
  });

  const applyScopedChildProjection = usePersistFn(async (projection: any, envelopeStreamId?: string) => {
    const projectionSessionId = `${projection?.sessionId || ''}`;
    if (!projectionSessionId || projectionSessionId !== `${sessionId}`) return false;

    await waitForSessionMessageLoaded(projectionSessionId);
    const streamId = projection?.snapshotStreamId || projection?.streamId || envelopeStreamId;
    if (
      !applyScopedChildProjectionMessage &&
      !isScopedStreamNewer(scopedChildWatermarksRef.current, projectionSessionId, streamId)
    ) {
      return true;
    }

    const message = fetchMessageHandler({
      ...projection,
      sessionId: projectionSessionId,
    });
    const terminal = projection?.running === false || `${projection?.msgStatus}` === '0';
    set(message, 'messageState', terminal ? IMessageState.Done : IMessageState.Answer);
    set(message, 'thinkDone', terminal);
    set(message, 'snapshotStreamId', streamId);
    set(message, 'streamId', streamId);
    hydrateV2RuntimeState(message);
    if (applyScopedChildProjectionMessage) {
      applyScopedChildProjectionMessage(projectionSessionId, message, getScopedChildRunState(projection, streamId));
    } else {
      updateMessage(message, { isAssign: true, allowCreateSession: false });
      commitScopedStream(scopedChildWatermarksRef.current, projectionSessionId, streamId);
    }
    return true;
  });

  const reconcileScopedChildProjection = usePersistFn(async () => {
    if (!sessionId || !isCurrentExternalChildSession) return false;
    try {
      await waitForSessionMessageLoaded(sessionId);
      const snapshot = await getChatRunningSnapshot({
        sessionId,
        traceId: `external-child-${sessionId}`,
      });
      if (snapshot?.messageId) {
        await applyScopedChildProjection(snapshot, snapshot.snapshotStreamId);
      } else {
        await reloadLatestMessageList();
      }
      return true;
    } catch (error) {
      console.error('同步外部子会话快照失败:', error);
      await reloadLatestMessageList();
      return true;
    }
  });

  /**
   * WebSocket 断线重连后，以后端运行态为准校正当前页面，避免连接恢复但前端仍永久停留在运行中。
   * 运行中的会话优先用快照补齐断线期间的内容；后端已无运行态时清理本地 runtime 并刷新已落库消息。
   */
  const reconcileCurrentSessionAfterReconnect = usePersistFn(async () => {
    if (!sessionId) {
      return;
    }

    if (await reconcileScopedChildProjection()) return;

    try {
      const runningInfoList: RunningChatInfo[] = await getChatRunningStatus({ sessionIds: [sessionId] });
      const runningInfos = runningInfoList.filter(
        (item) => `${item.sessionId}` === `${sessionId}` && item.running && item.traceId
      );

      if (!runningInfos.length) {
        if (chatSessionRuntimeManager.isSessionRunning(sessionId)) {
          chatSessionRuntimeManager.completeBySession(sessionId);
          await reloadLatestMessageList();
        }
        return;
      }

      for (const runningInfo of runningInfos) {
        chatSessionRuntimeManager.hydrateRunning(runningInfo);
        const snapshot = await getChatRunningSnapshot({
          sessionId,
          traceId: runningInfo.traceId,
          modelAnswerMessageId: runningInfo.modelAnswerMessageId,
        });
        if (!snapshot?.messageId) {
          continue;
        }

        const answerMessage = messageListRef.current.find(
          (item) =>
            `${item.messageId || ''}` === `${runningInfo.modelAnswerMessageId || ''}` ||
            `${item.msgId || ''}` === `${getAnswerClientMsgId(runningInfo.clientRequestId)}`
        );
        if (!answerMessage) {
          continue;
        }

        const runtimeInfo =
          chatSessionRuntimeManager.getByClientRequest(runningInfo.clientRequestId) ||
          chatSessionRuntimeManager.getByTrace(sessionId, runningInfo.traceId);
        const snapshotStreamId = snapshot.snapshotStreamId;
        if (
          snapshotStreamId &&
          runtimeInfo?.lastAppliedStreamId &&
          compareStreamId(snapshotStreamId, runtimeInfo.lastAppliedStreamId) <= 0
        ) {
          continue;
        }

        const snapshotAnswerMessage = createRestoredAnswerMessageFromSnapshot(snapshot, runningInfo);
        assign(answerMessage, snapshotAnswerMessage);
        const snapshotTerminal = snapshot.running === false;
        set(answerMessage, 'messageState', snapshotTerminal ? IMessageState.Done : IMessageState.Answer);
        updateMessage(answerMessage, { isAssign: true });
        if (snapshotTerminal) {
          // Redis 终态可能早于数据库落库完成，先用终态快照结束 loading 并保留完整回答。
          chatSessionRuntimeManager.complete(runningInfo.clientRequestId);
        } else {
          chatSessionRuntimeManager.updateLastAppliedStreamId(runningInfo.clientRequestId, snapshotStreamId);
        }
      }
    } catch (error) {
      console.error('WebSocket 重连后同步会话运行态失败:', error);
    }
  });

  useEffect(() => {
    return webSocketManager.onReconnect(() => {
      void reconcileCurrentSessionAfterReconnect();
    });
  }, [reconcileCurrentSessionAfterReconnect]);

  useEffect(() => {
    const handler = async (message: any) => {
      const data = get(message, 'data') || message;
      const clientRequestId = get(message, 'clientRequestId');
      const messageSessionId = get(data, 'sessionId') || get(message, 'sessionId');
      if (
        (isCurrentExternalChildSession || isScopedChildProjection(data)) &&
        `${messageSessionId}` === `${sessionId}` &&
        (await applyScopedChildProjection(data, get(message, 'streamId')))
      ) {
        return;
      }
      await waitForSessionMessageLoaded(messageSessionId);

      const newMsg = fetchMessageHandler({
        ...data,
        sessionId: messageSessionId,
      });
      if (clientRequestId) {
        newMsg.msgId = newMsg.fromBeyond ? getAnswerClientMsgId(clientRequestId) : getQueryClientMsgId(clientRequestId);
      }
      updateMessage(newMsg, { allowCreateSession: false });
      if (!newMsg.fromBeyond && `${sessionId}` === `${messageSessionId}`) {
        const agentId = get(message, 'agentId');
        const newAnswerMsg = createMessage({
          agentId,
          text: '',
          fromBeyond: true,
          messageState: IMessageState.Query,
          msgId: getAnswerClientMsgId(clientRequestId),
          queryMsgId: newMsg.msgId,
          sessionId: messageSessionId,
          metadata: agentId ? JSON.stringify({ agentId }) : '',
        });
        updateMessage(newAnswerMsg, { isAssign: true });
        registerPendingChatContext({
          clientRequestId,
          queryMsg: newMsg,
          answerMsg: newAnswerMsg,
          getMessageList,
          flowHandler,
          updateMessage,
        });

        chatSessionRuntimeManager.register({
          clientRequestId,
          sessionId: messageSessionId,
          restored: false,
          cancel: () => newAnswerMsg.cancelSSE?.(),
        });
      }
    };

    webSocketManager.onMessage('NEW_MESSAGE', handler);
    return () => {
      webSocketManager.offMessage('NEW_MESSAGE', handler);
    };
  }, [
    applyScopedChildProjection,
    isCurrentExternalChildSession,
    sessionId,
    updateMessage,
    waitForSessionMessageLoaded,
  ]);

  useEffect(() => {
    if (!isCurrentExternalChildSession) return;
    void reconcileScopedChildProjection();
  }, [isCurrentExternalChildSession, reconcileScopedChildProjection, sessionId]);

  useEffect(() => {
    if (!sessionId || isCurrentExternalChildSession) {
      return;
    }
    let disposed = false;
    const restoreKeys: string[] = [];

    waitForSessionMessageLoaded(sessionId)
      .then(() => {
        if (disposed) return [];
        return getChatRunningStatus({ sessionIds: [sessionId] });
      })
      .then(async (list: RunningChatInfo[] = []) => {
        if (disposed) return;
        const sessionRunningInfoList = list.filter((item) => `${item.sessionId}` === `${sessionId}`);
        const runningInfoList = sessionRunningInfoList.filter((item) => item.running && item.traceId);
        if (!runningInfoList.length) {
          if (sessionRunningInfoList.length) {
            // 初始状态回查不能覆盖当前页面正在接收 SSE 的本地请求。
            chatSessionRuntimeManager.completeRestoredBySession(sessionId);
          }
          return;
        }

        for (const runningInfo of runningInfoList) {
          if (disposed) return;
          const restoreKey = getRestoredStreamKey(sessionId, runningInfo.traceId);
          restoreKeys.push(restoreKey);
          startRestoringChatStream(restoreKey);

          const messageId = runningInfo.modelAnswerMessageId ? `${runningInfo.modelAnswerMessageId}` : '';
          let answerMsg = messageListRef.current.find((item) => {
            return (
              `${item.messageId}` === messageId ||
              `${item.msgId}` === `${getAnswerClientMsgId(runningInfo.clientRequestId)}`
            );
          });

          if (!answerMsg) {
            answerMsg = createRestoredAnswerMessage(runningInfo, sessionId);
          }
          answerMsg.cancelSSE = debounce(() => stopRestoredRunningSession(answerMsg!, runningInfo), 100);
          set(answerMsg, 'messageState', IMessageState.Answer);
          answerMsg = updateMessage(answerMsg, { isAssign: true });
          chatSessionRuntimeManager.hydrateRunning(runningInfo, () => answerMsg?.cancelSSE?.());

          const runtimeInfo =
            chatSessionRuntimeManager.getByClientRequest(runningInfo.clientRequestId) ||
            chatSessionRuntimeManager.getByTrace(sessionId, runningInfo.traceId);
          const askClientMessageId = getQueryClientMsgId(runningInfo.clientRequestId);
          const queryMsg =
            messageListRef.current.find(
              (item) =>
                `${item.messageId}` === `${runningInfo.userMessageId}` || `${item.msgId}` === `${askClientMessageId}`
            ) ||
            createMessage({
              msgId: askClientMessageId,
              messageId: `${runningInfo.userMessageId ?? askClientMessageId}`,
              text: runningInfo.chatContent || '',
              fromBeyond: false,
              messageState: IMessageState.Done,
              sessionId,
            });

          registerSessionChatContext(sessionId, {
            clientRequestId: runtimeInfo!.clientRequestId,
            queryMsg,
            answerMsg,
            restored: true,
            getMessageList,
            flowHandler,
            updateMessage,
            laneId: runningInfo.laneId,
            turnId: runningInfo.turnId,
          });

          let snapshotAnswerMsg: IMessage | undefined;
          let snapshotTerminal = false;
          try {
            const snapshot = await getChatRunningSnapshot({
              sessionId,
              traceId: runningInfo.traceId,
              modelAnswerMessageId: runningInfo.modelAnswerMessageId,
            });
            if (disposed) return;
            if (snapshot?.messageId) {
              snapshotAnswerMsg = createRestoredAnswerMessageFromSnapshot(snapshot, runningInfo);
              snapshotTerminal = snapshot.running === false;
            }
          } catch (error) {
            console.error(error);
          }

          if (snapshotAnswerMsg) {
            const latestRuntimeInfo =
              chatSessionRuntimeManager.getByClientRequest(runningInfo.clientRequestId) ||
              chatSessionRuntimeManager.getByTrace(sessionId, runningInfo.traceId);
            const snapshotStreamId = snapshotAnswerMsg.snapshotStreamId;
            const shouldApplySnapshot =
              !snapshotStreamId ||
              !latestRuntimeInfo?.lastAppliedStreamId ||
              compareStreamId(snapshotStreamId, latestRuntimeInfo.lastAppliedStreamId) > 0;
            if (shouldApplySnapshot) {
              assign(answerMsg, snapshotAnswerMsg);
              answerMsg.cancelSSE = snapshotTerminal
                ? undefined
                : debounce(() => stopRestoredRunningSession(answerMsg!, runningInfo), 100);
              set(answerMsg, 'messageState', snapshotTerminal ? IMessageState.Done : IMessageState.Answer);
              answerMsg = updateMessage(answerMsg, { isAssign: true });
              if (snapshotTerminal) {
                chatSessionRuntimeManager.complete(latestRuntimeInfo?.clientRequestId || runningInfo.clientRequestId);
              } else {
                chatSessionRuntimeManager.updateLastAppliedStreamId(
                  latestRuntimeInfo?.clientRequestId || runningInfo.clientRequestId,
                  snapshotStreamId
                );
              }
              EventEmitter.emit(
                'RECEIVE_SESSION_RECORDS_LAST_METADATA',
                getSessionLastAnsMsgMetadata(sessionId, answerMsg, queryMsg)
              );
              // scrollToMsgOnSessionChanged 消费者已经进行了 requestIdleCallback 处理
              EventEmitter.emit('scrollToMsgOnSessionChanged', { sessionId });
            }
          }

          flushRestoredChatStreamBuffer(restoreKey);
        }
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      disposed = true;
      restoreKeys.forEach((restoreKey) => {
        stopRestoringChatStream(restoreKey);
        flushRestoredChatStreamBuffer(restoreKey);
      });
    };
  }, [isCurrentExternalChildSession, sessionId, waitForSessionMessageLoaded]);

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

    const { queryQuestion, displayText, payload = {}, msgOpt = {} } = sendProps;
    const preliminaryDigitalEmployeeResources = getDigitalEmployeeResources(sendProps.resourceList);
    const isResumeChat = get(payload, 'actionType') === 'RESUME';
    let isContinuingRunningTrace = false;
    // 不要用 isSessionRunning，因为 isSessionRunning 是异步的，这里需要同步判断
    if (chatSessionRuntimeManager.isSessionRunning(sessionId)) {
      if (
        !isResumeChat &&
        preliminaryDigitalEmployeeResources.length <= 1 &&
        !chatSessionRuntimeManager.canAcceptInput(sessionId)
      ) {
        return false;
      }
      if (isResumeChat) {
        const runningInfo = chatSessionRuntimeManager.getBySession(sessionId);
        const traceId = payload.traceId ?? runningInfo?.traceId;
        if (!traceId) {
          return false;
        }
        isContinuingRunningTrace = true;
        if (!payload.traceId) {
          set(payload, 'traceId', traceId);
        }
      }
    }

    await checkSessionStateBeforeSendQuery();

    const { onlyQuery = false } = conf;
    const { inheritQryMsgId } = sendProps;
    let { resourceList } = sendProps;

    const myExtParams = get(payload, 'extParams');
    // 上传附件会提前生成 sessionId，但页面仍是新建任务；明确传入的项目选择优先于会话 ID 判断。
    const hasExplicitSelectedProject = get(payload, 'selectedProjectId') !== undefined;
    const selectedProjectId = hasExplicitSelectedProject
      ? getProjectNumber(get(payload, 'selectedProjectId'))
      : !sessionId
        ? getProjectNumber(getStoredProjectScopeId())
        : undefined;
    const selectedProjectName = hasExplicitSelectedProject ? get(payload, 'selectedProjectName') : undefined;
    const restPayload = omit(payload, ['extParams', 'selectedProjectId', 'selectedProjectName']);

    // 新建会话以输入框当前明确选择的项目为准，本地存储只作为首次加载时的兜底。
    if (selectedProjectId !== undefined) {
      set(restPayload, 'projectId', selectedProjectId);
      if (selectedProjectName) set(restPayload, 'projectName', selectedProjectName);
    }

    await onBeforeSend?.();

    let _queryQuestion = queryQuestion;
    let _agentId = (fixedAgentId || get(restPayload, 'agentId') || agentId) as string | undefined;
    let _agentType = (get(restPayload, 'agentType') || agentType) as IAgentType | undefined;

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

    const digitalEmployeeResources = getDigitalEmployeeResources(resourceList);
    const singleInlineAgent =
      digitalEmployeeResources.length === 1 ? getAgentLaneIdentity(digitalEmployeeResources[0]) : null;
    if (!fixedAgentId && singleInlineAgent?.agentKey && !isResumeChat) {
      _agentId = singleInlineAgent.agentKey;
    }

    if (_agentId === ROOT_AGENT_ID || !_agentId) {
      _agentId = defaultEmployee?.agentId || '';
      _agentType = defaultEmployee?.agentType || agentTypeMap.agent;
    }

    // 创建用户查询消息对象
    let newQueryMsg = createMessage({
      text: _queryQuestion,
      displayText,
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

    const isMultiAgentSend = !isResumeChat && digitalEmployeeResources.length > 1;
    const turnId = newQueryMsg.msgId;
    const laneEntries = (
      isMultiAgentSend
        ? digitalEmployeeResources.map((resource, index) => {
          const { agentId: laneAgentId, agentCode, agentName, agentKey } = getAgentLaneIdentity(resource);
          const answerMsg = createMessage({
            text: '',
            fromBeyond: true,
            messageState: IMessageState.Query,
            queryMsgId: newQueryMsg.msgId,
            agentId: agentKey,
            sessionId,
            agentType: _agentType,
            resourceList: [resource],
            metadata: JSON.stringify({
              agentId: agentKey,
              agentCode,
              agentName,
              laneId: '',
              turnId,
              multiAgent: true,
            }),
            ...get(msgOpt, 'answerMsg', {}),
          });
          const laneId = answerMsg.msgId;
          const clientRequestId = getClientRequestId(newQueryMsg.msgId, answerMsg.msgId);
          set(answerMsg, 'laneId', laneId);
          set(answerMsg, 'turnId', turnId);
          set(answerMsg, 'agentCode', agentCode);
          set(answerMsg, 'agentName', agentName);
          set(
            answerMsg,
            'metadata',
            JSON.stringify({
              agentId: agentKey,
              agentCode,
              agentName,
              laneId,
              turnId,
              multiAgent: true,
            })
          );
          return {
            answerMsg,
            lane: {
              laneId,
              agentId: laneAgentId,
              agentCode,
              agentName,
              clientRequestId,
              queryMessageId: newQueryMsg.msgId,
              answerMessageId: answerMsg.msgId,
              order: index,
            } as MultiAgentLane,
          };
        })
        : [
          (() => {
            const answerMsg = createMessage({
              text: '',
              fromBeyond: true,
              messageState: IMessageState.Query,
              queryMsgId: newQueryMsg.msgId,
              agentId: _agentId,
              sessionId,
              agentType: _agentType,
              agentCode: singleInlineAgent?.agentCode || undefined,
              agentName: singleInlineAgent?.agentName || undefined,
              resourceList: singleInlineAgent ? digitalEmployeeResources : undefined,
              metadata: _agentId
                ? JSON.stringify({
                  agentId: _agentId,
                  agentCode: singleInlineAgent?.agentCode || undefined,
                  agentName: singleInlineAgent?.agentName || undefined,
                })
                : '',
              ...get(msgOpt, 'answerMsg', {}),
            });
            return {
              answerMsg,
              lane: {
                laneId: answerMsg.msgId,
                agentId: Number(_agentId) ? _agentId || null : null,
                agentCode: Number(_agentId) ? null : _agentId || null,
                agentName: singleInlineAgent?.agentName || '',
                clientRequestId: getClientRequestId(newQueryMsg.msgId, answerMsg.msgId),
                queryMessageId: newQueryMsg.msgId,
                answerMessageId: answerMsg.msgId,
                order: 0,
              } as MultiAgentLane,
            };
          })(),
        ]
    ) as Array<{ answerMsg: IMessage; lane: MultiAgentLane }>;
    const primaryEntry = laneEntries[0];
    const newAnswerMsg = primaryEntry.answerMsg;
    const clientRequestId = primaryEntry.lane.clientRequestId;
    const projectId = getProjectNumber(get(restPayload, 'projectId'));
    // 新建任务上传文件后虽已有 sessionId，但首条消息仍需创建左侧临时会话缓存。
    const isNewProjectSession = projectId !== undefined && (!sessionId || hasExplicitSelectedProject);
    const multiAgent = isMultiAgentSend
      ? {
        turnId,
        mode: 'parallel',
        lanes: laneEntries.map((entry) => entry.lane),
      }
      : undefined;

    const extParams = Object.assign<IExtParams, Record<string, unknown>>(
      cloneDeep(get(extParamsBySessionId, `${sessionId}`) || {}),
      {
        ...(myExtParams || {}),
        clientId: isMultiAgentSend ? turnId : newAnswerMsg.msgId,
      }
    );
    if (multiAgent) {
      set(extParams, 'multiAgent', multiAgent);
    }
    set(newQueryMsg, 'extParams', extParams);
    set(newQueryMsg, 'answerMsgId', newAnswerMsg.msgId);
    if (isMultiAgentSend) {
      set(
        newQueryMsg,
        'answerMsgIds',
        laneEntries.map((entry) => entry.answerMsg.msgId)
      );
      set(newQueryMsg, 'multiAgent', multiAgent);
    }

    if (!isContinuingRunningTrace) {
      // 多员工并行回答属于同一轮对话，只在左侧会话列表插入一条临时会话。
      if (isNewProjectSession) {
        EventEmitter.emit('projectSpace-session-pending', {
          projectId: `${projectId}`,
          projectName: get(restPayload, 'projectName'),
          clientRequestId: primaryEntry.lane.clientRequestId,
          // 项目侧栏会先展示临时会话，不能把输入组件的数字员工占位符展示给用户。
          sessionName:
            newQueryMsg.displayText ||
            resolveDigitalEmployeePlaceholders(newQueryMsg.text || 'New Chat', [
              ...((resourceList || []) as any),
              { resourceId: primaryEntry.lane.agentId, resourceName: primaryEntry.lane.agentName },
            ]) ||
            'New Chat',
          sessionContent: newQueryMsg.text || '',
          updateTime: new Date().toISOString(),
        });
      }

      laneEntries.forEach((entry) => {
        if (projectId !== undefined) {
          // 会话创建成功后用 clientRequestId 找回所属项目，再用真实 sessionId 建立关系。
          pendingProjectIdByClientRequestRef.current.set(entry.lane.clientRequestId, `${projectId}`);
        }
        registerPendingChatContext({
          clientRequestId: entry.lane.clientRequestId,
          laneId: isMultiAgentSend ? entry.lane.laneId : undefined,
          turnId: isMultiAgentSend ? turnId : undefined,
          queryMsg: newQueryMsg,
          answerMsg: entry.answerMsg,
          onlyQuery,
          getMessageList,
          flowHandler,
          updateMessage,
        });

        chatSessionRuntimeManager.register({
          clientRequestId: entry.lane.clientRequestId,
          // 临时会话也注册到旧会话列表使用的运行状态管理器，完成事件会自动清除回答中标识。
          sessionId: isNewProjectSession ? `pending_${entry.lane.clientRequestId}` : entry.answerMsg.sessionId,
          laneId: isMultiAgentSend ? entry.lane.laneId : undefined,
          turnId: isMultiAgentSend ? turnId : undefined,
          answerMessageId: entry.answerMsg.msgId,
          agentId: entry.lane.agentId,
          agentCode: entry.lane.agentCode,
          agentName: entry.lane.agentName,
          restored: false,
          cancel: () => entry.answerMsg.cancelSSE?.(),
        });
      });
    }

    if (projectId !== undefined && sessionId) {
      bindSessionToProject(projectId, sessionId);
    }

    // 发送请求并处理SSE响应
    const sendResult = send(_queryQuestion, {
      sessionId,
      resourceList,
      extParams,
      clientRequestId,
      ...(multiAgent ? { multiAgent, turnId } : {}),
      ...restPayload,
      agentId: isMultiAgentSend ? primaryEntry.lane.agentId : Number(_agentId) ? _agentId : null,
      agentCode: isMultiAgentSend ? primaryEntry.lane.agentCode : Number(_agentId) ? null : _agentId,
      agentType: _agentType,
    });
    const cancel = () => {
      if (!isContinuingRunningTrace) {
        laneEntries.forEach((entry) => unregisterPendingChatContext(entry.lane.clientRequestId));
      }
      sendResult.cancel();
    };

    if (isContinuingRunningTrace) {
      return { cancel };
    }

    laneEntries.forEach((entry) => {
      entry.answerMsg.cancelSSE = debounce(() => {
        if (entry.answerMsg.messageState === IMessageState.Cancel) return Promise.resolve();
        set(entry.answerMsg, 'messageState', IMessageState.Cancel);

        updateMessage(entry.answerMsg);

        chatSessionRuntimeManager.complete(entry.lane.clientRequestId);
        unregisterPendingChatContext(entry.lane.clientRequestId);
        unregisterSessionChatContext(entry.answerMsg.sessionId || sessionId, entry.lane.clientRequestId);

        if (!isMultiAgentSend) {
          sendResult.cancel();
        }

        return webSocketManager
          .sendMessageWhenReady({
            type: 'STOP_CHAT',
            clientRequestId: entry.lane.clientRequestId,
            laneId: isMultiAgentSend ? entry.lane.laneId : undefined,
            turnId: isMultiAgentSend ? turnId : undefined,
            traceId: entry.answerMsg.traceId,
            ...pick(entry.answerMsg, ['agentId', 'sessionId', 'messageId', 'agentType']),
            agentId: isMultiAgentSend ? entry.lane.agentId : Number(_agentId) ? _agentId : null,
            agentCode: isMultiAgentSend ? entry.lane.agentCode : Number(_agentId) ? null : _agentId,
          })
          .catch((error) => {
            // STOP_CHAT 尽力发送，WS 未连接时忽略，避免 Unhandled Rejection。
            console.error('WebSocket 发送 STOP_CHAT 失败:', error);
          });
      }, 100);
    });

    // 更新回答消息
    laneEntries.forEach((entry) => {
      const nextAnswerMsg = updateMessage(entry.answerMsg, { isAssign: true });
      entry.answerMsg = nextAnswerMsg;
      registerPendingChatContext({
        clientRequestId: entry.lane.clientRequestId,
        laneId: isMultiAgentSend ? entry.lane.laneId : undefined,
        turnId: isMultiAgentSend ? turnId : undefined,
        queryMsg: newQueryMsg,
        answerMsg: nextAnswerMsg,
        onlyQuery,
        getMessageList,
        flowHandler,
        updateMessage,
      });
    });

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

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return;
    (window as any).__BYCLAW_E2E__ = {
      ...((window as any).__BYCLAW_E2E__ || {}),
      sendQuery,
      getState: () => ({
        sessionId: sessionId || '',
        isSessionRunning: chatSessionRuntimeManager.isSessionRunning(sessionId),
        messageList: getMessageList(),
      }),
    };
  }, [getMessageList, runtimeVersion, sendQuery, sessionId]);

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
    sessionMessageLoadState: getSessionMessageLoadState(sessionId),
    retrySessionMessageLoad: () => retrySessionMessageLoad(sessionId),
  };
}

export default useChat;
