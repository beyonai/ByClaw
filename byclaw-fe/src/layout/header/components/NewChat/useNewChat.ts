import { useCallback } from 'react';
import useGlobal from '@/hooks/useGlobal';
import { App } from 'antd';
import { useLocation, useNavigate } from '@umijs/max';
import { DEF_SIDER } from '@/layout/sider';

export default function useNewChat() {
  const { message } = App.useApp();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { setAgentId, setSessionId, sessionId, agentId, EventEmitter } = useGlobal();
  return useCallback(() => {
    if (sessionId || agentId || pathname !== '/chat') {
      setAgentId?.('');
      setSessionId?.('');
      navigate('/chat');
      EventEmitter.emit('set-sider-active-key', DEF_SIDER);
    } else {
      message.success('已经是最新会话');
    }
  }, [pathname, sessionId, agentId]);
}
