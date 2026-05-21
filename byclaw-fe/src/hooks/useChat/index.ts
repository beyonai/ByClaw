/**
 * useChat/index.ts
 *
 * 聊天核心功能Hook，用于管理聊天会话、消息发送和接收
 * 集成了消息存储、会话管理和SSE通信
 * 处理不同类型的消息内容和响应状态
 */
import { useCallback, useRef, useEffect, useMemo } from 'react';

// @ts-ignore
import { useSelector, useDispatch } from '@umijs/max';
import { cloneDeep, flow, get, isEmpty, last, noop, set, unset, isNil, pick, debounce, omit } from 'lodash';

import usePersistFn from '@/hooks/usePersistFn';
import useSend from '@/hooks/useSseSender/useSend';

import { UserState } from '@/models/common/user';
import { ISessionState } from '@/models/session';
import useAppStore from '@/models/common/useAppStore';

import { createMessage } from '@/utils/messgae';
import { getFileTypeByName } from '@/utils/file';
import { sseRequestManager } from '@/utils/sseRequestManager';

import useHandler from './useHandler';
import useMessage from './useMessage';
import useGlobal from '@/hooks/useGlobal';
import { stopChat } from '@/service/message';

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
  } = useHandler({ addSession, setSessionId });

  useEffect(() => {
    messageListRef.current = messageList;
  }, [messageList]);

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

    // 检查SSE并发限制
    if (!sseRequestManager.canStartNewRequest()) {
      return false;
    }

    const { queryQuestion, payload = {}, msgOpt = {} } = sendProps;
    const isResumeChat = get(payload, 'actionType') === 'RESUME';
    // 追问 RESUME：当前列表末尾常为「助手仍在回答」，需允许继续走与底部输入框一致的发送流程
    if (!isResumeChat) {
      const lastMessage = last(messageList);
      if (
        lastMessage?.messageState &&
        [IMessageState.Query, IMessageState.Answer].includes(lastMessage?.messageState)
      ) {
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

    const flowHandler = flow([
      sessionInfoHandler,
      messageIdHandler,
      queryMessageIdHandler,
      rewriteQuestionHandler,
      textHandler,
      messageHandler,
      resComIdsHandler,
    ]); // 暂不支持异步方法!!!

    // 发送请求并处理SSE响应
    const { promise, cancel } = send(
      _queryQuestion,
      {
        sessionId,
        resourceList,
        extParams,
        ...restPayload,
        agentId: Number(_agentId) ? _agentId : null,
        agentCode: Number(_agentId) ? null : _agentId,
        agentType: _agentType,
      },
      {
        callback: (sseRes: Partial<ISseRes> & Partial<ISession>, sseMsg: any) => {
          // 忽略空响应
          if (!sseRes || isEmpty(sseRes)) return;

          flowHandler({
            sseRes,
            sseMsg,
            newQueryMsg,
            newAnswerMsg,
          });

          // 更新消息状态 - 这里会正确更新到对应sessionId的消息列表
          if (!onlyQuery) {
            newQueryMsg = updateMessage(newQueryMsg);
          }
          newAnswerMsg = updateMessage(newAnswerMsg);
        },
      }
    );

    // 注册SSE请求到管理器
    sseRequestManager.register(newAnswerMsg.sessionId || sessionId || '', newAnswerMsg.msgId, cancel, promise);

    // 处理请求完成的情况
    promise
      .then(() => {
        return new Promise<void>((resolve) => {
          window.setTimeout(resolve, 100);
        }); // 确保callback已全部更新
      })
      .then(() => {
        // 注销SSE请求
        sseRequestManager.unregister(newAnswerMsg.sessionId || sessionId || '', newAnswerMsg.msgId);

        if (newAnswerMsg.shouldDelete) {
          deleteMessage(newAnswerMsg);
          return;
        }

        if (newAnswerMsg.messageState !== IMessageState.Cancel) {
          // 设置回答消息状态为"完成"
          set(newAnswerMsg, 'messageState', IMessageState.Done);
        }

        // 移除取消函数
        unset(newAnswerMsg, 'cancelSSE');

        updateMessage(newAnswerMsg);
      })
      .catch((e: Error) => {
        // 注销SSE请求
        sseRequestManager.unregister(newAnswerMsg.sessionId || sessionId || '', newAnswerMsg.msgId);

        // 处理请求失败的情况
        console.log('error', e);
        // TODO: 根据返回e，设置IMessageState

        set(newAnswerMsg, 'messageState', IMessageState.Error);

        // 移除取消函数
        unset(newAnswerMsg, 'cancelSSE');

        updateMessage(newAnswerMsg);
      });

    // 添加取消功能到回答消息
    newAnswerMsg.cancelSSE = debounce(() => {
      if (newAnswerMsg.messageState === IMessageState.Cancel) return Promise.resolve();
      set(newAnswerMsg, 'messageState', IMessageState.Cancel);

      // 注销SSE请求
      sseRequestManager.unregister(newAnswerMsg.sessionId || sessionId || '', newAnswerMsg.msgId);

      updateMessage(newAnswerMsg);

      cancel();

      return stopChat({
        ...pick(newAnswerMsg, ['agentId', 'sessionId', 'messageId', 'agentType']),
        agentId: Number(_agentId) ? _agentId : null,
        agentCode: Number(_agentId) ? null : _agentId,
        clientId: newAnswerMsg.msgId,
      });
    }, 100);

    // 更新回答消息
    newAnswerMsg = updateMessage(newAnswerMsg, { isAssign: true });

    // 返回包含promise和cancel的对象
    return { promise, cancel };
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

    getMessageList,
    setMessageList,
  };
}

export default useChat;
