import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Select, Space, Spin, Tabs } from 'antd';
import IframeRender from '@/components/MessagesComp/Iframe/IframeRender';
import type { IframeConnectionSnapshot } from '@/components/MessagesComp/Iframe/iframeConnection';
import useAppStore, { type ISandboxesInfo } from '@/models/common/useAppStore';
import {
  desktopKey,
  isExplicitNonDesktop,
  probeDesktop,
  withDesktopTimeout,
  listDesktops,
  resolveDesktop,
} from '@/utils/desktopInstances';
import {
  desktopAuthEpoch,
  getDesktopOwner,
  selectDesktop,
  updateDesktopOwner,
  useDesktopWorkspace,
} from '@/utils/desktopWorkspace';

// Tabs incorporates keys into DOM IDs and CSS selectors; keep the canonical tuple in the store.
const tabKey = (key: string) =>
  `desktop_${Array.from(key)
    .map((char) => char.codePointAt(0)!.toString(16))
    .join('_')}`;

export default function DesktopWorkspace({ owner }: { owner: string }) {
  const entry = useDesktopWorkspace((state) => state.owners[owner]);
  const [rows, setRows] = useState<ISandboxesInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [access, setAccess] = useState<'auth' | 'timeout' | ''>('');
  const [readyAccess, setReadyAccess] = useState<{ key: string; url: string }>();
  const [retry, setRetry] = useState(0);
  const [connection, setConnection] = useState<IframeConnectionSnapshot>({ state: 'connecting' });
  const container = useRef<HTMLDivElement>(null);
  const value = entry || getDesktopOwner(owner);
  const selected = value.refs.find(
    (ref) => desktopKey(ref) === value.selected && !value.hidden.includes(desktopKey(ref))
  );
  const target = selected && resolveDesktop(rows, selected);
  const requestKey = JSON.stringify([owner, value.selected, retry]);
  const readyUrl = readyAccess?.key === requestKey ? readyAccess.url : '';
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const epoch = desktopAuthEpoch();
    const started = Date.now();
    setRows([]);
    setAccess('');
    setReadyAccess(undefined);
    setConnection({ state: 'connecting' });
    const load = async () => {
      timer = undefined;
      attempts += 1;
      setLoading(true);
      setFailed(false);
      try {
        const result = await withDesktopTimeout(
          useAppStore.getState().getSandboxesInfoUrl(),
          Math.min(5000, Math.max(1, 60000 - (Date.now() - started)))
        );
        if (cancelled || epoch !== desktopAuthEpoch()) return;
        setRows(result);
        const current = getDesktopOwner(owner);
        const refs = current.refs.filter((ref) => !isExplicitNonDesktop(result, ref));
        if (refs.length !== current.refs.length) updateDesktopOwner(owner, { refs });
        const resolved = selected && resolveDesktop(result, selected);
        if (resolved) {
          const result = await probeDesktop(resolved.url, Math.min(5000, Math.max(1, 60000 - (Date.now() - started))));
          if (cancelled || epoch !== desktopAuthEpoch()) return;
          if (result === 'ready') {
            setReadyAccess({ key: requestKey, url: resolved.url });
            return;
          }
          if (result === 'auth') {
            setAccess('auth');
            return;
          }
        }
        if (selected && attempts < 30 && Date.now() - started < 60000) timer = setTimeout(load, 2000);
        else if (selected) setAccess('timeout');
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled && !timer) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [owner, value.selected, retry]);
  const choices = listDesktops(rows);
  const groups = Array.from(
    new Set(choices.map((choice) => JSON.stringify([choice.row.sandboxId, choice.row.mappingId])))
  ).map((key) => ({
    label: choices.find((choice) => JSON.stringify([choice.row.sandboxId, choice.row.mappingId]) === key)?.row
      .sandboxId,
    options: choices
      .filter((choice) => JSON.stringify([choice.row.sandboxId, choice.row.mappingId]) === key)
      .map((choice) => ({ value: desktopKey(choice.ref), label: choice.label })),
  }));
  const status = {
    connecting: '连接中',
    connected: '已连接',
    disconnected: connection.clean === false ? '连接中断' : '已断开',
    unknown: '状态未上报',
  }[connection.state];
  return (
    <div ref={container} className="full-width full-height ub ub-ver" style={{ background: '#fff', minHeight: 0 }}>
      <Space style={{ padding: 12, flexWrap: 'wrap' }}>
        <Select
          aria-label="全部桌面"
          placeholder={loading ? '正在加载全部桌面' : '全部桌面'}
          loading={loading}
          style={{ minWidth: 220 }}
          value={undefined}
          options={groups}
          onSelect={(key) => {
            const item = choices.find((choice) => desktopKey(choice.ref) === key);
            if (item) selectDesktop(owner, item.ref);
          }}
        />
        <Button onClick={() => setRetry((value) => value + 1)}>重新连接</Button>
        <Button
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void container.current?.requestFullscreen?.();
          }}
        >
          全屏
        </Button>
        {target && readyUrl && <span role="status">{status}</span>}
      </Space>
      {process.env.UMI_APP_MULTI_DESKTOP_ENABLED !== 'false' && (
        <Tabs
          type="editable-card"
          hideAdd
          activeKey={value.selected && tabKey(value.selected)}
          onChange={(key) => {
            const ref = value.refs.find((item) => tabKey(desktopKey(item)) === key);
            if (ref) selectDesktop(owner, ref);
          }}
          onEdit={(key) => {
            const ref = value.refs.find((item) => tabKey(desktopKey(item)) === key);
            if (!ref) return;
            const hidden = [...value.hidden, desktopKey(ref)];
            updateDesktopOwner(owner, {
              hidden,
              selected:
                desktopKey(ref) !== value.selected
                  ? value.selected
                  : value.refs.find((ref) => !hidden.includes(desktopKey(ref))) &&
                    desktopKey(value.refs.find((ref) => !hidden.includes(desktopKey(ref)))!),
            });
          }}
          items={value.refs
            .filter((ref) => !value.hidden.includes(desktopKey(ref)))
            .map((ref) => ({
              key: tabKey(desktopKey(ref)),
              label: `${
                choices.find((item) => desktopKey(item.ref) === desktopKey(ref))?.label ||
                `${ref.instance} · ${ref.sandboxId}`
              }${value.unseen?.includes(desktopKey(ref)) ? ' · 新' : ''}`,
            }))}
        />
      )}
      {access && (
        <Alert
          type="warning"
          message={
            access === 'auth'
              ? '登录已失效或没有桌面访问权限，请重新登录或联系管理员'
              : '暂时无法获取访问入口，请重新连接'
          }
        />
      )}
      {failed && (
        <Alert
          type="warning"
          message="无法获取授权桌面清单，请重试"
          action={<Button onClick={() => setRetry((value) => value + 1)}>重试</Button>}
        />
      )}
      <div className="ub-f1" style={{ minHeight: 0, position: 'relative' }}>
        {target && readyUrl ? (
          <IframeRender
            key={`${owner}:${value.selected}:${retry}`}
            url={readyUrl}
            connectionBridge
            onConnectionStateChange={setConnection}
          />
        ) : loading ? (
          <div role="status">
            <Spin />
            正在准备
          </div>
        ) : (
          <Empty
            description={
              selected
                ? '暂时无法获取访问入口；需要请求头鉴权的入口须由服务端提供可导航地址'
                : '从全部桌面添加当前会话的远程桌面'
            }
          />
        )}
      </div>
    </div>
  );
}
