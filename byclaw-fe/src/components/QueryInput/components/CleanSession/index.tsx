import React, { memo, useState } from 'react';
import { Button, message } from 'antd';
import { get, debounce } from 'lodash';
import { useSearchParams, useIntl } from '@umijs/max';

import { GET } from '@/service/common/request';
import useGlobal from '@/hooks/useGlobal';

function CleanSession() {
  const intl = useIntl();

  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const { sessionId, agentId, EventEmitter, setSessionId } = useGlobal();

  const canCleanSession = searchParams.get('canCleanSession');
  const cleanSession = React.useCallback(
    debounce(async () => {
      EventEmitter.emit('on-cancel-sse', sessionId);

      setIsLoading(true);
      await GET('/byaiService/digitalEmployeeController/cleanupDebugMessages', {
        sessionId,
      })
        .then((res) => {
          // GET 成功时 request 已解包为 data 本体（如 { success: true }），无 res.data
          if (get(res, 'success') === true || get(res, 'data.success') === true) {
            EventEmitter.emit('on-clean-session-message', sessionId);
            setSessionId?.('');
            window?.refreshAgent?.(agentId);
            return;
          }
          message.error(res.msg || '清空会话失败');
        })
        .finally(() => {
          setIsLoading(false);
        });
    }, 300),
    [sessionId, agentId, EventEmitter, setSessionId]
  );

  if (!sessionId || !canCleanSession) {
    return null;
  }

  return (
    <div style={{ marginBottom: 6 }}>
      <Button size="small" onClick={cleanSession} loading={isLoading}>
        {intl.formatMessage({ id: 'common.cleanSession' })}
      </Button>
    </div>
  );
}

export default memo(CleanSession);
