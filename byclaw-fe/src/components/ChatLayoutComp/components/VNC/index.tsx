import React from 'react';
import { Button } from 'antd';
import { useIntl } from '@umijs/max';
import DesktopOutlined from '@ant-design/icons/DesktopOutlined';
import useGlobal from '@/hooks/useGlobal';
import useVncOpener from '@/hooks/useVncOpener';
import useAppStore from '@/models/common/useAppStore';
import { hasRunningDesktop } from '@/utils/chat';
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
  const [ownDesktop, setOwnDesktop] = React.useState(false);
  const latestMessageId = latestDigitalEmployeeMessage?.messageId || latestDigitalEmployeeMessage?.msgId;
  const latestMessageState = latestDigitalEmployeeMessage?.messageState;

  // A tool sandbox with its own desktop (a game, a design tool) is offered whenever it runs, browser use or not.
  // Looked up when the conversation or its latest answer changes; the sandbox may start during an answer.
  React.useEffect(() => {
    let cancelled = false;
    Promise.resolve(useAppStore.getState().getSandboxesInfoUrl?.())
      .then((sandboxes) => {
        if (!cancelled) setOwnDesktop(hasRunningDesktop(sandboxes));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [normalizedSessionId, latestMessageId, latestMessageState]);

  const browserActivity = hasVncActivity(latestDigitalEmployeeMessage);

  React.useEffect(() => {
    const onOpened = (data: { sessionId?: SessionIdInput }) => {
      if (isSameSessionId(normalizedSessionId, data?.sessionId)) setOpened(true);
    };
    EventEmitter.on('beyond-chat-vnc-opened', onOpened);
    return () => EventEmitter.off('beyond-chat-vnc-opened', onOpened);
  }, [EventEmitter, normalizedSessionId]);

  if (!opened && !ownDesktop && !browserActivity) return null;

  return (
    <Button
      type="text"
      onClick={() => {
        const clickedMessage = latestMessageRef.current;
        const clickedMessageId = clickedMessage?.messageId || clickedMessage?.msgId;
        openVnc({
          // The browser's desktop when the latest answer used the browser, otherwise the sandbox's own one.
          instance: ownDesktop && !browserActivity ? 'desktop' : 'vnc',
          isCurrent: () => {
            if (opened || ownDesktop) return true;
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
