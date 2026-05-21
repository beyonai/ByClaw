import { useCallback } from 'react';
import useGlobal from '@/hooks/useGlobal';
import { App } from 'antd';
import { useIntl, useLocation, useNavigate } from '@umijs/max';
import { DEF_SIDER } from '@/layout/sider';

export default function useNewChat() {
  const intl = useIntl();
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
      message.destroy();
      message.success(intl.formatMessage({ id: 'newChat.alreadyLatestSession' }));
    }
  }, [EventEmitter, agentId, intl, message, navigate, pathname, sessionId, setAgentId, setSessionId]);
}
