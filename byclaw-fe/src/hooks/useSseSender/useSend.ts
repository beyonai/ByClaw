/**
 * useSend.ts
 *
 * 自定义Hook，用于处理消息发送功能，支持SSE（Server-Sent Events）通信
 * 封装了SendHelper实例，提供统一的消息发送接口
 * 主要用于聊天功能，支持会话管理和回调处理
 */
import { useCallback, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify'; // HTML 净化器

import SendHelper from './sendHelper';
import OpenclawSendHelper from './openclaw/sendHelper';
// @ts-ignore
import { useDispatch } from '@umijs/max';
import useGlobal from '../useGlobal';
import { isOpenClawAgent } from '@/utils/openClaw/utils';
import { ISession } from '@/typescript/session';

/**
 * Hook参数类型定义
 * @type IParam
 * @property {string} [language] - 消息语言，默认为'cn'
 * @property {string} [sessionId] - 会话ID，用于标识当前会话
 * @property {object} [hooks] - 钩子函数集合
 * @property {Function} [hooks.onConnect] - 连接建立时的回调函数
 */
type IParam = {

  /** 自定义聊天地址 */
  chatUrl?: string;
  language?: string;
  sessionId?: string;
  hooks?: {
    onConnect?: () => void;
  };
  agentType?: string;
};

/**
 * 消息发送Hook
 * @param {IParam} params - 配置参数
 * @returns {object} 包含send方法的对象
 */
export default function useSend(params: IParam) {
  // 解构参数，设置默认值
  const { language = 'cn', sessionId, hooks = {}, agentType, chatUrl } = params;
  const sendHelper = useRef<any>(new SendHelper(chatUrl));

  const { agentInfo } = useGlobal();

  const dispatch = useDispatch();
  const updateSession = useCallback(
    (session: Partial<ISession>) => {
      dispatch({
        type: 'session/updateSession',
        payload: session,
      });
    },
    [dispatch]
  );
  const updateSessionRef = useRef(updateSession);
  updateSessionRef.current = updateSession;

  useEffect(() => {
    if (agentInfo && isOpenClawAgent(agentInfo)) {
      // 等到有接口获取openclaw的配置信息之后，就不需要传agentInfo进去了
      sendHelper.current = new OpenclawSendHelper({
        agentInfo,
        updateSession: updateSessionRef,
      });
    } else {
      sendHelper.current = new SendHelper(chatUrl);
    }
  }, [agentInfo, chatUrl]);

  /**
   * 发送消息函数
   * 使用useCallback进行记忆化，减少不必要的重渲染
   *
   * @param {string} text - 要发送的文本内容
   * @param {any} [payload] - 附加数据载荷
   * @param {Record<string, any>} [opts={}] - 选项配置
   * @returns {object} 包含promise和cancel方法的对象
   */
  const send = useCallback(
    (text: string, payload?: any, opts: Record<string, any> = {}) => {
      console.group('----sendHelper send----', sendHelper.current, agentType);
      console.log('useSend payload---', payload);

      // 从选项中提取callback回调函数
      const { callback, ...optsRest } = opts;

      // 调用SendHelper实例的send方法
      const { promise, cancel } = sendHelper.current.send(
        {
          language, // 语言设置
          chatContent: DOMPurify.sanitize(text), // 聊天内容
          relModelId: -1, // 相关模型ID（原传1，现说暂改为传-1先）
          accessTerminal: 'Web',

          sessionId, // 会话ID
          chatId: sessionId, // 聊天ID，使用相同的sessionId
          ...(payload || {}), // 合并其他载荷参数
        },
        {
          ...hooks, // 合并外部传入的hooks
          ...optsRest, // 合并其他选项
          callback: (formatMessage: any, sseMsg: any) => {
            // 调用回调并传递完整会话信息
            callback?.({ ...formatMessage }, sseMsg);
          },
        },
        {
          useEventSource: false, // 不使用EventSource，使用普通请求
        }
      );

      // 请求完成后关闭console分组
      promise.finally(() => {
        console.groupEnd();
      });

      return { promise, cancel };
    },
    [language, sessionId, agentType] // 依赖项：language和sessionId变化时重新创建函数
  );

  // 返回包含send方法的对象
  return {
    send,
  };
}
