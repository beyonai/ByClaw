import { useCallback, useEffect, useRef } from 'react';
import { message } from 'antd';
import { getIntl } from '@umijs/max';
import useAppStore from '@/models/common/useAppStore';
import { getVNCUrl, resolveSandboxesInfo, type DesktopInstance } from '@/utils/chat';
import { normalizeSessionId, type SessionIdInput } from '@/utils/sessionId';
import useGlobal from './useGlobal';

export type VncOpenOptions = {
  key?: string;
  isCurrent?: () => boolean;

  /** Which declared desktop to open; the browser's (`vnc`) unless given. */
  instance?: DesktopInstance;
};

type OpenRequest = VncOpenOptions & {
  cancelled: boolean;
  refreshes: number;
  timer?: ReturnType<typeof setTimeout>;
};

// The desktop is served by the user's tool sandbox, which starts its browser on the
// first browser tool call: allow about a minute for the endpoint and the viewer.
const MAX_REFRESHES = 30;
const RETRY_DELAY_MS = 2000;

/**
 * Whether the viewer behind `url` answers. The sandbox proxy returns 5xx while the
 * desktop is not listening yet (or no longer); opening the iframe then would leave
 * the user on the proxy's error page. Same-origin request, so the session cookie applies.
 */
export async function isViewerReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'GET', credentials: 'include', redirect: 'manual', cache: 'no-store' });
    return response.type === 'opaqueredirect' || (response.status > 0 && response.status < 500);
  } catch {
    return false;
  }
}

export default function useVncOpener(sessionId?: SessionIdInput) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const { EventEmitter } = useGlobal();
  const emitterRef = useRef(EventEmitter);
  emitterRef.current = EventEmitter;
  const requestRef = useRef<OpenRequest | undefined>(undefined);
  const viewRef = useRef({ sessionId: normalizedSessionId, openedKeys: new Set<string>() });

  // A new object also invalidates requests from an earlier A -> B -> A visit.
  if (viewRef.current.sessionId !== normalizedSessionId) {
    viewRef.current = { sessionId: normalizedSessionId, openedKeys: new Set<string>() };
  }

  const cancelRequest = useCallback(() => {
    const request = requestRef.current;
    if (!request) return;
    request.cancelled = true;
    if (request.timer) clearTimeout(request.timer);
    requestRef.current = undefined;
  }, []);

  useEffect(() => cancelRequest, [normalizedSessionId, cancelRequest]);

  return useCallback(
    (options: VncOpenOptions = {}) => {
      const view = viewRef.current;
      if (!view.sessionId || (options.key && view.openedKeys.has(options.key))) return;
      if (options.key && requestRef.current?.key === options.key) return;
      cancelRequest();

      const request: OpenRequest = { ...options, cancelled: false, refreshes: 0 };
      requestRef.current = request;
      const isCurrent = () => {
        return (
          !request.cancelled &&
          requestRef.current === request &&
          viewRef.current === view &&
          (request.isCurrent?.() ?? true)
        );
      };

      const attempt = async (refresh: boolean): Promise<void> => {
        if (!isCurrent()) {
          if (requestRef.current === request) cancelRequest();
          return;
        }

        let sandboxes: unknown;
        try {
          const state = useAppStore.getState();
          if (refresh) {
            request.refreshes += 1;
            sandboxes = await state.getSandboxesInfoUrl();
          } else {
            sandboxes = await resolveSandboxesInfo(state.sandboxesInfo);
          }
        } catch {
          // A failed lookup can be retried while the sandbox is starting.
        }

        if (!isCurrent()) {
          if (requestRef.current === request) cancelRequest();
          return;
        }

        let url = '';
        try {
          url = getVNCUrl(Array.isArray(sandboxes) ? sandboxes : [], request.instance);
        } catch {
          // Invalid endpoints must never open an empty or malformed iframe.
        }
        if (url && !(await isViewerReady(url))) url = '';
        if (!isCurrent()) {
          if (requestRef.current === request) cancelRequest();
          return;
        }
        if (url) {
          if (request.key) view.openedKeys.add(request.key);
          cancelRequest();
          useAppStore.getState().setSiderCollapsed(true);
          emitterRef.current.emit('beyond-main-driver-open-type', {
            drawerType: 'vnc',
            canClose: true,
            width: '50vw',
          });
          emitterRef.current.emit('beyond-main-driver-message', { url });
          emitterRef.current.emit('beyond-chat-vnc-opened', { sessionId: view.sessionId });
          return;
        }

        if (!refresh) {
          await attempt(true);
        } else if (request.refreshes < MAX_REFRESHES) {
          request.timer = setTimeout(() => {
            request.timer = undefined;
            void attempt(true);
          }, RETRY_DELAY_MS);
        } else {
          cancelRequest();
          // A click (no tool key) deserves an answer; the desktop only exists while the
          // assistant's browser is open in its tool sandbox.
          if (!request.key) message.info(getIntl().formatMessage({ id: 'common.remoteComputerUnavailable' }));
        }
      };

      void attempt(false);
    },
    [cancelRequest]
  );
}
