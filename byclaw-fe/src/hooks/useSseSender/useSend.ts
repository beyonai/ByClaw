/**
 * useSend.ts
 *
 * 自定义Hook，用于处理消息发送功能，支持SSE（Server-Sent Events）通信
 * 封装了SendHelper实例，提供统一的消息发送接口
 * 主要用于聊天功能，支持会话管理和回调处理
 */
import { getAuthSnapshot, isCurrentAuthSnapshot } from '@/utils/auth';
import { NasReadinessCancelled } from '@/utils/nasReadinessWaiter';
import { waitForPersonalStorage } from '@/utils/personalStorageReadiness';
import { recordChatChain } from '@/utils/chatChainLog';
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
  chatUrl?: string; // 自定义聊天地址
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
      const requestId = payload?.clientRequestId || payload?.extParams?.requestId;

      // 从选项中提取callback回调函数
      // const { callback, ...optsRest } = opts;

      const { clientRequestId } = payload || {};
      let closed = false;

      const closeConsoleGroup = () => {
        if (closed) return;
        closed = true;
      };

      const storageWait = new AbortController();
      const auth = getAuthSnapshot();
      const scope = webSocketManager.getScopedSessionId();
      const current = () => isCurrentAuthSnapshot(auth) && scope === webSocketManager.getScopedSessionId();
      const promise = webSocketManager
        .requiresCloudStorage()
        .then((cloud) => {
          if (!current() || storageWait.signal.aborted) throw new NasReadinessCancelled();
          return cloud ? waitForPersonalStorage(storageWait.signal) : undefined;
        })
        .then(() =>
          webSocketManager.sendMessageWhenReady(
            {
              type: 'LLM_MESSAGE',
              clientRequestId,
              language: getLocale(),
              chatContent: DOMPurify.sanitize(text),
              relModelId: -1,
              accessTerminal: 'Web',
              sessionId,
              chatId: sessionId,
              ...(payload || {}),
              extParams: { ...(payload?.extParams || {}), requestId },
            },
            storageWait.signal,
            current
          )
        )
        .then(() => {
          recordChatChain('fe.sent', {
            requestId,
            sessionId: payload?.sessionId || sessionId,
            laneIds: payload?.extParams?.multiAgent?.lanes?.map((lane: any) => lane.clientRequestId),
          });
          return {};
        })
        .catch((error) => {
          recordChatChain('fe.sent', { requestId, sessionId: payload?.sessionId || sessionId }, 'failed');
          // WS 连接失败（本地开发后端未启动等）属预期情况：记录但不抛出，避免 Unhandled Rejection。
          if (error?.name !== 'NasReadinessCancelled') console.error('WebSocket 发送消息失败:', error);
          return { cancelled: error?.name === 'NasReadinessCancelled', failed: true };
        })
        .finally(closeConsoleGroup);

      return {
        promise,
        cancel: () => {
          storageWait.abort();
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
