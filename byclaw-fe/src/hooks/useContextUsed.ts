import { useCallback, useEffect, useState } from 'react';
import { GET } from '@/service/common/request';
import { theme } from 'antd';
import webSocketManager from '@/utils/websocket';
import { useSelector, useIntl } from '@umijs/max';

export interface ContextUsed {
  percent: number;
  usedTokens: number;
  contextTokens: number;
  format: string;
  strokeColor: string;
}

interface ContextUsedEventData extends ContextUsed {
  ok: boolean;
  fresh: boolean;
  agentId?: string;
}

function formatTokensCompact(tokens: number) {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(tokens);
}

type State = {
  user: {
    userInfo?: {
      userId?: string | number;
      defaultDigEmployeeId?: string | number;
    };
  };
};

export default function useContextUsed(params: { sessionId?: string; agentId?: string }): ContextUsed | null {
  const { sessionId, agentId } = params;
  const { token } = theme.useToken();
  const [contextUsed, setContextUsed] = useState<ContextUsed | null>(null);
  const { formatMessage } = useIntl();

  const userInfo = useSelector((state: State) => state.user.userInfo);

  const { userId, defaultDigEmployeeId } = userInfo || {};

  const resolveContextUsed = useCallback((data: ContextUsedEventData) => {
    if (!data.ok || !data.fresh) {
      setContextUsed(null);
      return;
    }
    let strokeColor = token.colorSuccess;
    if (data.percent >= 90) {
      strokeColor = token.colorError;
    } else if (data.percent >= 70) {
      strokeColor = token.colorWarning;
    }
    setContextUsed({
      strokeColor,
      percent: data.percent,
      usedTokens: data.usedTokens,
      contextTokens: data.contextTokens,
      format: formatMessage(
        { id: 'context.used.format' },
        {
          percent: data.percent,
          usedTokens: formatTokensCompact(data.usedTokens),
          contextTokens: formatTokensCompact(data.contextTokens),
        }
      ),
    });
  }, []);

  const qryContextUsed = useCallback(() => {
    GET<ContextUsedEventData>('/byaiService/chat/sessionStatus', {
      agentId,
      sessionId,
    }).then((res) => {
      resolveContextUsed(res);
    });
  }, [sessionId, agentId]);

  useEffect(() => {
    if (!sessionId) {
      setContextUsed(null);
      return;
    }
    qryContextUsed();
  }, [qryContextUsed]);

  useEffect(() => {
    const handleSessionStatusEvent = (message: { sessionId?: string; data?: ContextUsedEventData }) => {
      if (
        !sessionId ||
        !message.sessionId ||
        !message.data ||
        message.sessionId !== sessionId ||
        !message.data.agentId
      ) {
        return;
      }
      const { data } = message;
      if (data.agentId === 'main' && agentId && defaultDigEmployeeId && `${agentId}` !== `${defaultDigEmployeeId}`) {
        return;
      }
      if (data.agentId !== 'main' && `${data.agentId}` !== `${agentId}`) {
        return;
      }
      resolveContextUsed(data);
    };
    if (userId && sessionId) {
      webSocketManager.onMessage('SESSION_STATUS', handleSessionStatusEvent);
    }
    return () => {
      webSocketManager.offMessage('SESSION_STATUS', handleSessionStatusEvent);
    };
  }, [userId, agentId, sessionId, defaultDigEmployeeId]);

  return contextUsed;
}
