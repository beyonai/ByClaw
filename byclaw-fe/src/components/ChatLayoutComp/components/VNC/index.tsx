import React from 'react';
import { Button } from 'antd';
import DesktopOutlined from '@ant-design/icons/DesktopOutlined';
import useVncOpener from '@/hooks/useVncOpener';
import { registerDesktops, useDesktopWorkspace } from '@/utils/desktopWorkspace';
import type { IMessage } from '@/typescript/message';
import { normalizeSessionId, type SessionIdInput } from '@/utils/sessionId';

interface VNCProps {
  sessionId?: SessionIdInput;
  latestDigitalEmployeeMessage?: IMessage;
  ownerType?: string;
  messages?: IMessage[];
}
export default function VNC({ sessionId, latestDigitalEmployeeMessage, ownerType = 'session', messages }: VNCProps) {
  const id = normalizeSessionId(sessionId);
  const openVnc = useVncOpener(sessionId, ownerType);
  const owner = openVnc.owner || (id ? JSON.stringify([ownerType, id]) : '');
  const preparing = useDesktopWorkspace((state) => state.pendingOwner === owner);
  const entry = useDesktopWorkspace((state) => state.owners[owner]);
  React.useEffect(() => {
    if (!owner) return;
    const refs = (messages || (latestDigitalEmployeeMessage ? [latestDigitalEmployeeMessage] : []))
      .filter((message) => String(message.sessionId) === String(id))
      .flatMap((message) => [...(message.thinkList || []), ...(message.messageList || [])])
      .flatMap((item) => item.content?.instanceRefs || []);
    registerDesktops(owner, refs);
  }, [owner, id, latestDigitalEmployeeMessage, messages]);
  const count =
    entry?.refs.filter(
      (ref) => !entry.hidden.includes(JSON.stringify([ref.sandboxId, ref.mappingId ?? null, ref.instance]))
    ).length || 0;
  return (
    <Button type="text" onClick={() => openVnc()} title="远程桌面">
      <DesktopOutlined />
      远程桌面{count ? ` ${count}` : ''}
      {preparing ? ' · 正在准备' : ''}
    </Button>
  );
}
