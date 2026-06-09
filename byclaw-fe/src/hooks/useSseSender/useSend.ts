/**
 * useSend.ts
 *
 * 自定义Hook，用于处理消息发送功能，支持SSE（Server-Sent Events）通信
 * 封装了SendHelper实例，提供统一的消息发送接口
 * 主要用于聊天功能，支持会话管理和回调处理
 */
import { useCallback } from 'react';
import DOMPurify from 'dompurify'; // HTML 净化器

// @ts-ignore
import { getLocale } from '@umijs/max';
import webSocketManager from '@/utils/websocket';

export { formatStreamPayload } from './chatStream';

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
  const { language = 'cn', sessionId } = params;

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
    (text: string, payload?: any) => {
      console.log('useSend payload---', payload);

      // 从选项中提取callback回调函数
      // const { callback, ...optsRest } = opts;

      const { clientRequestId } = payload;
      let closed = false;

      const closeConsoleGroup = () => {
        if (closed) return;
        closed = true;
      };

      const promise = webSocketManager
        .sendMessageWhenReady({
          type: 'LLM_MESSAGE',
          clientRequestId,
          language: getLocale(),
          chatContent: DOMPurify.sanitize(text),
          relModelId: -1,
          accessTerminal: 'Web',
          sessionId,
          chatId: sessionId,
          ...(payload || {}),
        })
        .then(() => ({}))
        .finally(closeConsoleGroup);

      return {
        promise,
        cancel: () => {
          closeConsoleGroup();
        },
      };
    },
    [language, sessionId] // 依赖项：language和sessionId变化时重新创建函数
  );

  // 返回包含send方法的对象
  return {
    send,
  };
}
