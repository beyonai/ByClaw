import React from 'react';
import { message } from 'antd';
import copy from 'copy-to-clipboard';
// @ts-ignore
import { useIntl } from '@umijs/max';

import { getDcSystemConfig } from '@/pages/manager/service/session';
import TroubleshootSessionDrawer from './index';
import { getCachedTroubleshootSession } from './sessionCache';

const TROUBLE_SHOOT_EMPLOYEE_PARAM_CODE = 'TROUBLE_SHOOT_EMPLOYEE_ID';
// 运维数字员工 ID 只需要在当前页面生命周期里拉一次，后续直接复用。
let cachedTroubleshootAgentId: string | undefined;
let hasLoadedTroubleshootAgentId = false;
// 复用进行中的请求，避免并发点击时重复打同一个配置接口。
let troubleshootAgentIdRequest: Promise<string> | null = null;

type DrawerPayload = {
  agentId: string;
  initialText: string;
  messageId?: string;
  sessionId?: string;
  traceId?: string;
};

function getTroubleshootAgentId() {
  if (hasLoadedTroubleshootAgentId) {
    return Promise.resolve(cachedTroubleshootAgentId || '');
  }

  if (troubleshootAgentIdRequest) {
    return troubleshootAgentIdRequest;
  }

  troubleshootAgentIdRequest = getDcSystemConfig({ paramCode: TROUBLE_SHOOT_EMPLOYEE_PARAM_CODE })
    .then((res) => {
      const response = res as any;
      const agentId = `${response?.paramValue || response?.data?.paramValue || response?.value || ''}`.trim();
      // 成功后把结果落到模块级缓存，后续点击直接命中。
      cachedTroubleshootAgentId = agentId;
      hasLoadedTroubleshootAgentId = true;
      return agentId;
    })
    .finally(() => {
      troubleshootAgentIdRequest = null;
    });

  return troubleshootAgentIdRequest;
}

export default function useTroubleshootDrawer() {
  const intl = useIntl();
  const [loading, setLoading] = React.useState(false);
  const [available, setAvailable] = React.useState(false);
  const [payload, setPayload] = React.useState<DrawerPayload | null>(null);

  React.useEffect(() => {
    let active = true;
    void getTroubleshootAgentId()
      .then((agentId) => {
        if (active) setAvailable(Boolean(agentId));
      })
      .catch(() => {
        if (active) setAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const open = React.useCallback(
    async ({ messageId, sessionId, traceId }: { messageId?: string; sessionId?: string; traceId?: string } = {}) => {
      const initialText = intl.formatMessage({ id: 'messageList.troubleshootPrompt' }, { traceId: traceId || '' });
      const cachedSessionId = sessionId || getCachedTroubleshootSession({ messageId, traceId });

      try {
        setLoading(true);
        // 先拿缓存过的运维数字员工 ID，没有的话才触发一次接口请求。
        const agentId = await getTroubleshootAgentId();

        if (!agentId) {
          // 后端未配置运维数字员工时，保留原有兜底行为，直接复制排查文案。
          copy(initialText);
          message.success(intl.formatMessage({ id: 'common.copySuccess' }));
          return;
        }

        setPayload({
          agentId,
          initialText: cachedSessionId ? '' : initialText,
          messageId,
          sessionId: cachedSessionId,
          traceId,
        });
      } catch {
        copy(initialText);
        message.success(intl.formatMessage({ id: 'common.copySuccess' }));
      } finally {
        setLoading(false);
      }
    },
    [intl]
  );

  const placeholder = payload ? (
    <TroubleshootSessionDrawer
      key={payload.sessionId || payload.messageId || payload.traceId || payload.agentId}
      agentId={payload.agentId}
      initialText={payload.initialText}
      messageId={payload.messageId}
      initialSessionId={payload.sessionId}
      open={!!payload}
      onClose={() => setPayload(null)}
      traceId={payload.traceId}
    />
  ) : null;

  return {
    loading,
    available,
    open,
    placeholder,
  };
}
