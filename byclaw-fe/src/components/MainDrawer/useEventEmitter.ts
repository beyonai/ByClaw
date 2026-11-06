import { openDrawerView } from '@/utils/drawerView';
import { desktopAuthEpoch, selectDesktop, useDesktopWorkspace } from '@/utils/desktopWorkspace';
import useGlobal from '@/hooks/useGlobal';
import { isPlainObject, isString } from 'lodash';
import { useCallback, useEffect, useState, useRef } from 'react';

type IMainMessage = {
  sessionId: string; // 会话id
  messageId: string; // 当前messageId
  agentId: string; // 主驾id
  // message?: IMessage// 消息内容
  // agentType: IAgentType //主驾类型

  templateId: string; // 模板id
  docId: string; // 文档id
};

export const INIT_DRAWER_CFG = {
  title: '',
  canFullScreen: false,
  canClose: false,
  overlay: false,
  width: '25vw' as const,
  minWidth: '25vw' as const,
  maxWidth: '50vw' as const,
};

function useActionEffect() {
  const [drawerCfg, setDrawerCfg] = useState({ ...INIT_DRAWER_CFG });
  const [drawerType, setDrawerType] = useState<string>('');
  const [contentPayload, setContentPayload] = useState<Record<string, any>>({});
  const { EventEmitter } = useGlobal();
  const viewHandle = useRef<{ owner: string; generation: number }>();

  const driverOpen = useCallback((type: string) => {
    viewHandle.current = undefined;
    useDesktopWorkspace.setState((state) => ({ revision: state.revision + 1, pendingOwner: '' }));
    if (!isString(type)) {
      setDrawerType('');
      return;
    }

    const drawerType = `${type}`.toLocaleLowerCase();

    setDrawerType(['false', 'null', 'undefined'].includes(drawerType) ? '' : drawerType);
  }, []);

  useEffect(() => {
    let epoch = desktopAuthEpoch();
    const onAuth = () => {
      const next = desktopAuthEpoch();
      if (epoch === next) return;
      epoch = next;
      viewHandle.current = undefined;
      setContentPayload({});
      setDrawerType('');
    };
    window.addEventListener('byclaw-auth-change', onAuth);
    return () => window.removeEventListener('byclaw-auth-change', onAuth);
  }, []);

  useEffect(() => {
    const onDesktop = (event: Event) => {
      const { owner, ref } = (event as CustomEvent).detail || {};
      if (!owner || !ref) return;
      selectDesktop(owner, ref);
      useDesktopWorkspace.setState({ activeOwner: owner, visible: true });
      openDrawerView(
        EventEmitter,
        owner,
        {
          title: '远程桌面',
          canClose: true,
          drawerType: 'desktop',
          width: window.innerWidth < 768 ? '100vw' : '50vw',
          maxWidth: '100vw',
        },
        { owner }
      );
    };
    window.addEventListener('byclaw-desktop-open', onDesktop);
    return () => window.removeEventListener('byclaw-desktop-open', onDesktop);
  }, []);

  useEffect(() => {
    const onView = (event: any) => {
      if (!event?.handle?.owner || !event.handle.generation) return;
      const same =
        viewHandle.current?.owner === event.handle.owner && viewHandle.current?.generation === event.handle.generation;
      if (event.action === 'open') {
        useDesktopWorkspace.setState((state) => ({ revision: state.revision + 1, panel: event.config.drawerType }));
        viewHandle.current = event.handle;
        setDrawerCfg({ ...INIT_DRAWER_CFG, ...event.config });
        setContentPayload(event.content || {});
        setDrawerType(event.config.drawerType);
      } else if (same && event.action === 'update') setContentPayload(event.content || {});
      else if (same && event.action === 'close') {
        viewHandle.current = undefined;
        setDrawerType('');
      }
    };
    EventEmitter.on('beyond-drawer-view', onView);
    return () => EventEmitter.off('beyond-drawer-view', onView);
  }, [EventEmitter]);

  useEffect(() => {
    const onMessage = (data: Partial<IMainMessage> = {}) => {
      if (viewHandle.current) return;
      setContentPayload({ ...data });
    };

    EventEmitter.on('beyond-main-driver-message', onMessage);
    return () => {
      EventEmitter.off('beyond-main-driver-message', onMessage);
    };
  }, []);

  useEffect(() => {
    const drawerTypeHandler = (data: any) => {
      viewHandle.current = undefined;
      let myDrawerType = data;

      if (isPlainObject(data)) {
        const { drawerType, ...rest } = data;
        setDrawerCfg(Object.assign({}, INIT_DRAWER_CFG, { ...rest }));
        myDrawerType = drawerType;
      }

      if (myDrawerType !== 'desktop')
        useDesktopWorkspace.setState((state) => ({
          panel: myDrawerType || '',
          revision: state.revision + 1,
          pendingOwner: '',
        }));
      setDrawerType(myDrawerType);
    };

    EventEmitter.on('beyond-main-driver-open-type', drawerTypeHandler);
    return () => {
      EventEmitter.off('beyond-main-driver-open-type', drawerTypeHandler);
    };
  }, []);

  useEffect(() => {
    const drawerTypeHandler = () => {
      setDrawerType('');
    };

    EventEmitter.on('beyond-driver-close', drawerTypeHandler);
    return () => {
      EventEmitter.off('beyond-driver-close', drawerTypeHandler);
    };
  }, []);

  useEffect(() => {
    useDesktopWorkspace.setState((state) => ({
      panel: drawerType,
      pendingOwner: drawerType === 'desktop' ? state.pendingOwner : '',
      revision: state.revision + (drawerType === 'desktop' ? 0 : 1),
    }));
    if (!drawerType) {
      setDrawerCfg({ ...INIT_DRAWER_CFG });
    }
  }, [drawerType]);

  return {
    drawerCfg,
    drawerType,
    contentPayload,
    setDrawerCfg,
    setDrawerType,
    setContentPayload,

    driverOpen,
  };
}

export default useActionEffect;
