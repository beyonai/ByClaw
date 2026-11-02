import { useIntl } from '@umijs/max';
import { useMemo } from 'react';

import { IMessageState } from '@/constants/message';
import type { IMessage } from '@/typescript/message';
import { collectConnectorActions, requestConnectorAuthorization } from '@/utils/connectorAuthorization';
import styles from './index.module.less';

export default function ConnectorAuthorizationActions({ msg }: { msg: IMessage }) {
  const intl = useIntl();
  const turnEnded = [IMessageState.Done, IMessageState.Error, IMessageState.Cancel, IMessageState.Timeout].includes(
    msg.messageState
  );
  const actions = useMemo(
    () => collectConnectorActions([...(msg.thinkList || []), ...(msg.messageList || [])], intl),
    [msg.messageList, msg.thinkList, intl]
  );

  if (!turnEnded || !actions.length) return null;

  return (
    <div
      aria-label={intl.formatMessage({ id: 'connector.configurationRequired' })}
      className={styles.connectorActions}
      role="group"
    >
      {actions.map((action) => (
        <button
          className={styles.connectorActionButton}
          key={action.connectorCode}
          type="button"
          onClick={() => requestConnectorAuthorization(action.connectorCode)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
