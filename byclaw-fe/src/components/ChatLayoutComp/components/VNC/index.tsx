import React from 'react';
import { Button } from 'antd';
import { useRequest } from 'ahooks';
import DesktopOutlined from '@ant-design/icons/DesktopOutlined';
import useVncOpener from '@/hooks/useVncOpener';
import useAppStore from '@/models/common/useAppStore';
import { hasVncActivity } from '@/utils/chatVnc';
import { desktopKey, listDesktops, normalizeInstanceRefs, resolveDesktop } from '@/utils/desktopInstances';
import { registerDesktops, selectDesktop, useDesktopWorkspace } from '@/utils/desktopWorkspace';
import type { IMessage } from '@/typescript/message';
import { normalizeSessionId, type SessionIdInput } from '@/utils/sessionId';
import styles from './index.module.less';

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

  const latest = latestDigitalEmployeeMessage;
  const refs = normalizeInstanceRefs(
    [...(latest?.thinkList || []), ...(latest?.messageList || [])].flatMap((item) => item.content?.instanceRefs || [])
  );
  const checkKey =
    id && (refs.length || hasVncActivity(latest))
      ? JSON.stringify([owner, latest?.messageId || latest?.msgId, refs])
      : '';
  const directory = useAppStore((state) => state.sandboxesInfo);
  const { data, error } = useRequest(
    async () => ({ key: checkKey, rows: await useAppStore.getState().getSandboxesInfoUrl() }),
    { ready: Boolean(checkKey), refreshDeps: [checkKey], pollingInterval: 10000, pollingWhenHidden: false }
  );
  if (!checkKey || error || data?.key !== checkKey) return null;

  const rows = (Array.isArray(directory) ? directory : data.rows).filter((row) => row.status === 'RUNNING');
  const matchingKeys = new Set(refs.map(desktopKey));
  const choices = listDesktops(rows).filter(
    ({ ref, row }) =>
      (refs.length ? matchingKeys.has(desktopKey(ref)) : ref.instance === 'vnc') &&
      row.instanceEndpoints?.[ref.instance]?.trim() &&
      resolveDesktop(rows, ref)
  );
  // Legacy browser calls carry no sandbox identity. Only use an unambiguous directory match.
  if (!choices.length || (!refs.length && choices.length !== 1)) return null;

  const count = entry?.refs.filter((ref) => !entry.hidden.includes(desktopKey(ref))).length || 0;
  return (
    <Button
      type="text"
      onClick={() => {
        const target = choices.find(({ ref }) => desktopKey(ref) === entry?.selected) || choices[0];
        selectDesktop(owner, target.ref);
        openVnc();
      }}
      title="远程桌面"
      aria-label={`远程桌面${count ? ` ${count}` : ''}${preparing ? ' · 正在准备' : ''}`}
    >
      <DesktopOutlined />
      <span>远程桌面</span>
      {count > 0 && (
        <span className={styles.count} aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      )}
      {preparing ? ' · 正在准备' : ''}
    </Button>
  );
}
