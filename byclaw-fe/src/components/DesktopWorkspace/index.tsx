import { useEffect, useRef, useState } from 'react';
import { DesktopOutlined, FullscreenOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Dropdown, Empty, Spin, Tabs } from 'antd';
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
import styles from './index.module.less';

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
  const [access, setAccess] = useState<'auth' | 'timeout' | 'unavailable' | ''>('');
  const [readyAccess, setReadyAccess] = useState<{ key: string; url: string }>();
  const [retry, setRetry] = useState(0);
  const [connection, setConnection] = useState<IframeConnectionSnapshot>({ state: 'connecting' });
  const container = useRef<HTMLDivElement>(null);
  const value = entry || getDesktopOwner(owner);
  const visibleRefs = value.refs.filter((ref) => !value.hidden.includes(desktopKey(ref)));
  const selected = value.refs.find(
    (ref) => desktopKey(ref) === value.selected && !value.hidden.includes(desktopKey(ref))
  );
  const target = selected && resolveDesktop(rows, selected);
  const requestKey = JSON.stringify([owner, value.selected, retry]);
  const readyUrl = readyAccess?.key === requestKey ? readyAccess.url : '';
  useEffect(() => {
    const element = container.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      // 预留固定操作区和溢出入口，窄面板仍能完整显示当前页签及关闭按钮。
      element.style.setProperty(
        '--desktop-tab-max-width',
        `${Math.max(100, Math.min(260, entry.contentRect.width - 164))}px`
      );
      element.style.setProperty('--desktop-tab-padding', entry.contentRect.width < 400 ? '8px' : '12px');
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let missingFromDirectory = false;
    let receivedDirectory = false;
    const epoch = desktopAuthEpoch();
    const started = Date.now();
    const remaining = () => 60000 - (Date.now() - started);
    const finishWaiting = () => {
      if (selected) setAccess(missingFromDirectory ? 'unavailable' : 'timeout');
    };
    setRows([]);
    setAccess('');
    setReadyAccess(undefined);
    setConnection({ state: 'connecting' });
    const load = async () => {
      timer = undefined;
      if (cancelled || epoch !== desktopAuthEpoch()) return;
      if (remaining() <= 0) {
        finishWaiting();
        setLoading(false);
        return;
      }
      attempts += 1;
      setLoading(true);
      setFailed(false);
      try {
        const result = await withDesktopTimeout(
          useAppStore.getState().getSandboxesInfoUrl(),
          Math.min(5000, remaining())
        );
        if (cancelled || epoch !== desktopAuthEpoch()) return;
        receivedDirectory = true;
        setRows(result);
        const current = getDesktopOwner(owner);
        const refs = current.refs.filter((ref) => !isExplicitNonDesktop(result, ref));
        if (refs.length !== current.refs.length) updateDesktopOwner(owner, { refs });
        const resolved = selected && resolveDesktop(result, selected);
        missingFromDirectory = Boolean(
          selected && !listDesktops(result).some((item) => desktopKey(item.ref) === desktopKey(selected))
        );
        if (resolved) {
          if (remaining() <= 0) {
            finishWaiting();
            return;
          }
          const result = await probeDesktop(resolved.url, Math.min(5000, remaining()));
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
        if (selected && attempts < 30 && remaining() > 0) timer = setTimeout(load, Math.min(2000, remaining()));
        else finishWaiting();
      } catch (error) {
        if (cancelled || epoch !== desktopAuthEpoch()) return;
        if (error instanceof Error && error.message === 'TIMEOUT' && remaining() <= 0 && receivedDirectory)
          finishWaiting();
        else setFailed(true);
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
  const directoryItems = groups.map((group, index) => ({
    type: 'group' as const,
    key: `sandbox-${index}`,
    label: group.label,
    children: group.options.map((option) => ({
      key: tabKey(option.value),
      label: option.label,
      title: option.label,
    })),
  }));
  const connectionLabel = {
    connecting: '连接中',
    connected: '已连接',
    disconnected: connection.clean === false ? '连接中断' : '已断开',
    unknown: '状态未上报',
  }[connection.state];
  const status = access === 'unavailable' ? '实例不可用' : connectionLabel;
  const connectionStatus = (access === 'unavailable' || (target && readyUrl)) && (
    <span className={styles.connectionStatus} role="status" title={status}>
      <span
        className={styles.connectionDot}
        data-state={access === 'unavailable' ? 'disconnected' : connection.state}
        aria-hidden="true"
      />
      <span className={styles.srOnly}>{status}</span>
    </span>
  );
  const getPopupContainer = () => (document.fullscreenElement ? container.current || document.body : document.body);
  return (
    <div ref={container} className={styles.workspace}>
      <div className={styles.workspaceHeader}>
        {process.env.UMI_APP_MULTI_DESKTOP_ENABLED !== 'false' && visibleRefs.length > 0 ? (
          <Tabs
            className={styles.workspaceTabs}
            type="editable-card"
            hideAdd
            getPopupContainer={getPopupContainer}
            activeKey={value.selected && tabKey(value.selected)}
            onChange={(key) => {
              const ref = visibleRefs.find((item) => tabKey(desktopKey(item)) === key);
              if (ref) selectDesktop(owner, ref);
            }}
            onEdit={(key, action) => {
              if (action !== 'remove') return;
              const index = visibleRefs.findIndex((item) => tabKey(desktopKey(item)) === key);
              const ref = visibleRefs[index];
              if (!ref) return;
              const closingKey = desktopKey(ref);
              const remaining = visibleRefs.filter((item) => desktopKey(item) !== closingKey);
              const neighbor = remaining[Math.min(index, remaining.length - 1)];
              const nextSelected = closingKey === value.selected ? neighbor && desktopKey(neighbor) : value.selected;
              updateDesktopOwner(owner, {
                hidden: [...value.hidden, closingKey],
                selected: nextSelected,
                unseen: value.unseen?.filter((item) => item !== nextSelected),
              });
            }}
            items={visibleRefs.map((ref) => {
              const key = desktopKey(ref);
              const choice = choices.find((item) => desktopKey(item.ref) === key);
              const instanceLabel = choice?.row.instanceDescriptors?.[ref.instance]?.label || ref.instance;
              const hasType = Boolean(choice?.row.sandboxType);
              const label = `${choice?.label || `${ref.instance} · ${ref.sandboxId}`}${
                value.unseen?.includes(key) ? ' · 新' : ''
              }`;
              return {
                key: tabKey(key),
                icon: (
                  <span className={styles.desktopTabIcon}>
                    <DesktopOutlined />
                    {key === value.selected && connectionStatus}
                  </span>
                ),
                label: (
                  <span className={styles.tabLabel} title={label}>
                    <span className={styles.tabName}>
                      {instanceLabel} · {hasType ? choice?.row.sandboxType : ref.sandboxId}
                    </span>
                    {hasType && <span className={styles.tabIdentity}>({ref.sandboxId.slice(-8)})</span>}
                    {value.unseen?.includes(key) && <span className={styles.tabIdentity}>· 新</span>}
                  </span>
                ),
              };
            })}
          />
        ) : (
          <div className={styles.singleDesktopTitle} title={target?.label}>
            <DesktopOutlined />
            <span className={styles.tabName}>
              {target?.label || (selected ? `${selected.instance} · ${selected.sandboxId}` : '暂无打开的桌面')}
            </span>
            {connectionStatus}
          </div>
        )}
        <div className={styles.toolbarActions}>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            getPopupContainer={getPopupContainer}
            menu={{
              selectable: true,
              selectedKeys: value.selected ? [tabKey(value.selected)] : [],
              className: styles.desktopMenu,
              items: directoryItems.length
                ? directoryItems
                : [{ key: 'empty', label: loading ? '正在加载全部桌面' : '暂无可用桌面', disabled: true }],
              onClick: ({ key }) => {
                const item = choices.find((choice) => tabKey(desktopKey(choice.ref)) === key);
                if (item) selectDesktop(owner, item.ref);
              },
            }}
          >
            <Button type="text" icon={<PlusOutlined />} aria-label="全部桌面" aria-haspopup="menu" title="添加桌面" />
          </Dropdown>
          <Button
            type="text"
            icon={<ReloadOutlined />}
            aria-label="重新连接"
            title="重新连接"
            onClick={() => setRetry((value) => value + 1)}
          />
          <Button
            type="text"
            icon={<FullscreenOutlined />}
            aria-label="全屏"
            title="全屏"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void container.current?.requestFullscreen?.();
            }}
          />
        </div>
      </div>
      {access && (
        <Alert
          className={styles.notice}
          type="warning"
          message={
            {
              auth: '登录已失效或没有桌面访问权限，请重新登录或联系管理员',
              unavailable: '该桌面实例当前不可用，可能已释放或不再授权；可从“全部桌面”选择其他实例',
              timeout: '暂时无法获取访问入口，请重新连接',
            }[access]
          }
        />
      )}
      {failed && (
        <Alert
          className={styles.notice}
          type="warning"
          message="无法获取授权桌面清单，请重试"
          action={<Button onClick={() => setRetry((value) => value + 1)}>重试</Button>}
        />
      )}
      <div className={styles.desktopContent}>
        {target && readyUrl ? (
          <IframeRender
            key={`${owner}:${value.selected}:${retry}`}
            url={readyUrl}
            connectionBridge
            onConnectionStateChange={setConnection}
          />
        ) : loading ? (
          <div className={styles.emptyState} role="status">
            <Spin />
            <span>正在准备</span>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <Empty
              description={
                selected
                  ? '暂时无法获取访问入口；需要请求头鉴权的入口须由服务端提供可导航地址'
                  : '从全部桌面添加当前会话的远程桌面'
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
