import React from 'react';
import { Button } from 'antd';
import { useIntl } from '@umijs/max';
import DesktopOutlined from '@ant-design/icons/DesktopOutlined';
import useGlobal from '@/hooks/useGlobal';
import useVncOpener from '@/hooks/useVncOpener';
import { hasVncActivity } from '@/utils/chatVnc';
import type { IMessage } from '@/typescript/message';
import { isSameSessionId, normalizeSessionId, type SessionIdInput } from '@/utils/sessionId';

interface VNCProps {
  sessionId?: SessionIdInput;
  latestDigitalEmployeeMessage?: IMessage;
}

export default function VNC({ sessionId, latestDigitalEmployeeMessage }: VNCProps) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const intl = useIntl();
  const { EventEmitter } = useGlobal();
  const [opened, setOpened] = React.useState(false);
  const openVnc = useVncOpener(normalizedSessionId);
  const latestMessageRef = React.useRef(latestDigitalEmployeeMessage);
  latestMessageRef.current = latestDigitalEmployeeMessage;

  React.useEffect(() => {
    const onOpened = (data: { sessionId?: SessionIdInput }) => {
      if (isSameSessionId(normalizedSessionId, data?.sessionId)) setOpened(true);
    };
    EventEmitter.on('beyond-chat-vnc-opened', onOpened);
    return () => EventEmitter.off('beyond-chat-vnc-opened', onOpened);
  }, [EventEmitter, normalizedSessionId]);

  if (!opened && !hasVncActivity(latestDigitalEmployeeMessage)) return null;

  return (
    <Button
      type="text"
      onClick={() => {
        const clickedMessage = latestMessageRef.current;
        const clickedMessageId = clickedMessage?.messageId || clickedMessage?.msgId;
        openVnc({
          isCurrent: () => {
            if (opened) return true;
            const latestMessage = latestMessageRef.current;
            return (
              (latestMessage?.messageId || latestMessage?.msgId) === clickedMessageId && hasVncActivity(latestMessage)
            );
          },
        });
      }}
      title={intl.formatMessage({ id: 'common.remoteComputer' })}
    >
      <DesktopOutlined />
    </Button>
  );
}
