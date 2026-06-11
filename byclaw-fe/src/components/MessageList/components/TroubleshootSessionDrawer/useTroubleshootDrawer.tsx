import React from 'react';
import { message } from 'antd';
import copy from 'copy-to-clipboard';
// @ts-ignore
import { useIntl } from '@umijs/max';

import { getDcSystemConfig } from '@/pages/manager/service/session';
import TroubleshootSessionDrawer from './index';

const TROUBLE_SHOOT_EMPLOYEE_PARAM_CODE = 'TROUBLE_SHOOT_EMPLOYEE_ID';

type DrawerPayload = {
  agentId: string;
  initialText: string;
};

export default function useTroubleshootDrawer() {
  const intl = useIntl();
  const [loading, setLoading] = React.useState(false);
  const [payload, setPayload] = React.useState<DrawerPayload | null>(null);

  const open = React.useCallback(
    async (traceId?: string) => {
      const initialText = intl.formatMessage({ id: 'messageList.troubleshootPrompt' }, { traceId: traceId || '' });

      try {
        setLoading(true);
        const res = await getDcSystemConfig({ paramCode: TROUBLE_SHOOT_EMPLOYEE_PARAM_CODE });
        const agentId = `${(res as any)?.paramValue || ''}`.trim();

        if (!agentId) {
          copy(initialText);
          message.success(intl.formatMessage({ id: 'common.copySuccess' }));
          return;
        }

        setPayload({
          agentId,
          initialText,
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
      agentId={payload.agentId}
      initialText={payload.initialText}
      open={!!payload}
      onClose={() => setPayload(null)}
    />
  ) : null;

  return {
    loading,
    open,
    placeholder,
  };
}
