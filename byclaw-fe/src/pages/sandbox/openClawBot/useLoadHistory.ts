/**
 * useHistory - OpenClaw 历史记录加载 Hook
 *
 * 按照 openclawHistoryHook 的方式，通过 WebSocket 客户端的 loadHistory 查询历史记录，
 * 将结果转换为 IMessage 格式后通过 setMessageList 设置到聊天组件
 */
import { useCallback } from 'react';
import { getOpenClawWebSocket } from '@/utils/openClaw/openclawWebSocket';
import { convertOpenClawToIMessage } from '@/utils/openClaw/openclawMessage';
import type { IMessage } from '@/typescript/message';
import usePersistFn from '@/hooks/usePersistFn';
import { fetchMessageHandler } from '@/utils/messgae';

const DEFAULT_LIMIT = 200;

export interface UseHistoryOptions {
  setMessageList: (messageList: IMessage[]) => void;
}

/**
 * 加载 OpenClaw 历史记录并设置到聊天组件
 * 与 openclawHistoryHook 中的逻辑保持一致
 */
export default function useLoadHistory({ setMessageList }: UseHistoryOptions) {
  const loadHistory = useCallback(async () => {
    const client = getOpenClawWebSocket();
    if (!client) {
      return;
    }

    try {
      await client.ensureConnected();
      const history = await client.loadHistory(undefined, DEFAULT_LIMIT);
      const messages = convertOpenClawToIMessage(history.messages, client.getRealSessionId(), client.agentId);
      setMessageList(messages.map(fetchMessageHandler));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[openClaw] load history error:', error);
    }
  }, [setMessageList]);

  return usePersistFn(loadHistory);
}
