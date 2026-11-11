import { openDrawerView } from '@/utils/drawerView';
import { useCallback, useEffect, useRef } from 'react';
import useAppStore from '@/models/common/useAppStore';
import {
  isExplicitNonDesktop,
  withDesktopTimeout,
  listDesktops,
  resolveDesktop,
  type SandboxInstanceRef,
} from '@/utils/desktopInstances';
import {
  claimDesktopAutoOpen,
  desktopAuthEpoch,
  migrateDesktopOwner,
  mountDesktopOwner,
  getDesktopOwner,
  registerDesktops,
  selectDesktop,
  updateDesktopOwner,
  useDesktopWorkspace,
} from '@/utils/desktopWorkspace';
import { normalizeSessionId, type SessionIdInput } from '@/utils/sessionId';
import useGlobal from './useGlobal';

export type VncOpenOptions = {
  key?: string;
  isCurrent?: () => boolean;
  instance?: string;
  instanceRefs?: SandboxInstanceRef[];
};

export default function useVncOpener(sessionId?: SessionIdInput, ownerType = 'session') {
  const id = normalizeSessionId(sessionId);
  const temporary = useRef(`temporary:${Math.random().toString(36).slice(2)}`);
  const owner = id ? JSON.stringify([ownerType, id]) : temporary.current;
  const previousOwner = useRef(owner);
  const { EventEmitter } = useGlobal();
  const current = useRef(owner);
  const pendingIntent = useRef<number>();
  current.current = owner;
  useEffect(() => {
    current.current = owner;
    desktopAuthEpoch();
    if (previousOwner.current.startsWith('temporary:') && previousOwner.current !== owner)
      migrateDesktopOwner(previousOwner.current, owner);
    previousOwner.current = owner;
    const releaseOwner = mountDesktopOwner(owner);
    return () => {
      current.current = '';
      const state = useDesktopWorkspace.getState();
      if (state.pendingOwner === owner && state.revision === pendingIntent.current)
        useDesktopWorkspace.setState({ pendingOwner: '', revision: state.revision + 1 });
      releaseOwner();
    };
  }, [owner]);
  const openVnc = useCallback(
    (options: VncOpenOptions = {}) => {
      const { key } = options;
      if ((!id && key) || (options.instanceRefs !== undefined && !options.instanceRefs.length)) return;
      const epoch = desktopAuthEpoch();
      registerDesktops(owner, options.instanceRefs, Boolean(key));
      if (key) {
        if (process.env.UMI_APP_MULTI_DESKTOP_ENABLED === 'false' || !claimDesktopAutoOpen(owner, key)) return;
        const { activeOwner, visible, panel } = useDesktopWorkspace.getState();
        if (activeOwner !== owner || visible || (panel && panel !== 'desktop')) return;
      }
      useDesktopWorkspace.setState((state) => ({ revision: state.revision + 1, pendingOwner: '' }));
      const intent = useDesktopWorkspace.getState().revision;
      const open = (selected?: SandboxInstanceRef) => {
        if (
          current.current !== owner ||
          desktopAuthEpoch() !== epoch ||
          options.isCurrent?.() === false ||
          intent !== useDesktopWorkspace.getState().revision
        )
          return;
        if (selected) selectDesktop(owner, selected);
        useDesktopWorkspace.setState({ activeOwner: owner, visible: true, pendingOwner: '' });
        openDrawerView(
          EventEmitter,
          owner,
          {
            drawerType: 'desktop',
            title: '远程桌面',
            canClose: true,
            width: window.innerWidth < 768 ? '100vw' : '50vw',
            maxWidth: '100vw',
            canFullScreen: false,
          },
          { owner }
        );
      };
      if (!key) {
        open();
        return;
      }
      pendingIntent.current = intent;
      useDesktopWorkspace.setState({ pendingOwner: owner });

      const started = Date.now();
      let attempts = 0;
      const attempt = async (): Promise<void> => {
        attempts += 1;
        if (
          current.current !== owner ||
          desktopAuthEpoch() !== epoch ||
          options.isCurrent?.() === false ||
          intent !== useDesktopWorkspace.getState().revision
        )
          return;
        const front = useDesktopWorkspace.getState();
        if (front.activeOwner !== owner || front.visible) return;
        let rows: any[] = [];
        try {
          rows = await withDesktopTimeout(
            useAppStore.getState().getSandboxesInfoUrl(),
            Math.min(5000, Math.max(1, 60000 - (Date.now() - started)))
          );
        } catch {
          rows = [];
        }
        if (
          current.current !== owner ||
          desktopAuthEpoch() !== epoch ||
          intent !== useDesktopWorkspace.getState().revision ||
          options.isCurrent?.() === false
        )
          return;
        if (options.instanceRefs?.length && options.instanceRefs.every((ref) => isExplicitNonDesktop(rows, ref))) {
          const previous = getDesktopOwner(owner);
          useDesktopWorkspace.setState({ pendingOwner: '' });
          updateDesktopOwner(owner, {
            autoOpenKeys: previous.autoOpenKeys?.filter((messageKey) => messageKey !== key),
            refs: previous.refs.filter((ref) => !isExplicitNonDesktop(rows, ref)),
          });
          return;
        }
        let refs = options.instanceRefs;
        if (refs === undefined) {
          const choices = listDesktops(rows).filter(
            (entry) => !options.instance || entry.ref.instance === options.instance
          );
          if (choices.length > 1) {
            open();
            return;
          }
          if (!choices.length) {
            if (attempts < 30 && Date.now() - started < 60000) setTimeout(() => void attempt(), 2000);
            else useDesktopWorkspace.setState({ pendingOwner: '' });
            return;
          }
          refs = [choices[0].ref];
        }
        const selected = refs.find((ref) => resolveDesktop(rows, ref));
        if (selected) {
          open(selected);
          return;
        }
        if (attempts < 30 && Date.now() - started < 60000) setTimeout(() => void attempt(), 2000);
        else useDesktopWorkspace.setState({ pendingOwner: '' });
      };
      void attempt();
    },
    [owner, id, EventEmitter]
  );
  return Object.assign(openVnc, { owner });
}
