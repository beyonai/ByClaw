import { useCallback, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { iframeOrigins, isConnectionMessage } from './iframeConnection';
import type { IframeConnectionSnapshot } from './iframeConnection';

type Options = {
  url: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  iframePayload?: Record<string, any>;
  connectionBridge?: boolean;
  allowedOrigins?: string[];
  allowOpaqueOrigin?: boolean;
  onMessage?: (data: { type: string; data: any }) => void;
  onLoad?: (ref: RefObject<HTMLIFrameElement | null>) => void;
  onConnectionStateChange?: (snapshot: IframeConnectionSnapshot) => void;
  setLoading: (loading: boolean) => void;
  pauseAutoHeight: () => void;
};

let sequence = 0;
const nextChannel = () => globalThis.crypto?.randomUUID?.() || `frame-${Date.now()}-${++sequence}`;

export default function useIframeBridge(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const loadRef = useRef<() => void>();
  const sendRef = useRef<() => void>();
  const { url, iframeRef, connectionBridge = false, allowOpaqueOrigin = false } = options;
  const originKey = JSON.stringify(options.allowedOrigins || []);

  useLayoutEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return undefined;
    const origins = iframeOrigins(url, JSON.parse(originKey));
    let channelId = nextChannel();
    let attemptId: number | undefined;
    let pinnedOrigin: string | undefined;
    let observed = false;
    let loaded = false;
    let deadline = Date.now() + 15000;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let retries: Array<ReturnType<typeof setTimeout>> = [];
    let lastPayload: string | undefined;
    let lastSnapshot: string | undefined;

    const cancelRetries = () => {
      retries.forEach(clearTimeout);
      retries = [];
    };
    const publish = (state: IframeConnectionSnapshot['state'], clean?: boolean) => {
      if (!connectionBridge) return;
      const snapshot: IframeConnectionSnapshot = {
        state,
        channelId,
        ...(attemptId === undefined ? {} : { attemptId }),
      };
      if (clean !== undefined) snapshot.clean = clean;
      const serialized = JSON.stringify(snapshot);
      if (serialized !== lastSnapshot) {
        lastSnapshot = serialized;
        latest.current.onConnectionStateChange?.(snapshot);
      }
      if (state !== 'connecting') latest.current.setLoading(false);
    };
    const waitForObservation = (renew: boolean) => {
      if (!connectionBridge) return;
      if (renew) deadline = Date.now() + 15000;
      clearTimeout(timeout);
      if (deadline <= Date.now()) {
        publish('unknown');
      } else {
        publish('connecting');
        timeout = setTimeout(() => publish('unknown'), deadline - Date.now());
      }
    };
    const sendPayload = (force = false) => {
      if (!loaded) return;
      try {
        const payload = { ...(latest.current.iframePayload || {}) };
        if (connectionBridge) payload.bridge = { version: 1, channelId };
        const serialized = JSON.stringify(payload);
        if (!force && lastPayload === serialized) return;
        const targets = pinnedOrigin ? [pinnedOrigin] : origins;
        if (!targets.length && allowOpaqueOrigin && !connectionBridge) targets.push('*');
        targets.forEach((origin) =>
          frame.contentWindow?.postMessage({ type: 'beyond-iframe-payload', data: payload }, origin)
        );
        lastPayload = serialized;
      } catch {
        // A replaced or inaccessible document can be initialized by its next load.
      }
    };
    const handleLoad = () => {
      const renew = observed;
      channelId = nextChannel();
      attemptId = undefined;
      pinnedOrigin = undefined;
      observed = false;
      loaded = true;
      lastPayload = undefined;
      cancelRetries();
      latest.current.setLoading(false);
      waitForObservation(renew);
      sendPayload(true);
      if (connectionBridge) retries = [250, 1000, 3000].map((delay) => setTimeout(() => sendPayload(true), delay));
      latest.current.onLoad?.(iframeRef);
    };
    const handleMessage = (event: MessageEvent) => {
      try {
        if (event.source !== frame.contentWindow) return;
      } catch {
        return;
      }
      const opaqueAllowed = allowOpaqueOrigin && !connectionBridge && event.origin === 'null';
      if (!origins.includes(event.origin) && !opaqueAllowed) return;
      const envelope = event.data;
      if (!envelope || typeof envelope !== 'object') return;
      if (envelope.type === 'beyond-iframe-receive-payload') {
        const value = envelope.data;
        if (!value || typeof value !== 'object' || typeof value.type !== 'string') return;
        if (connectionBridge && ['connection-state-change', 'connection-observation-reset'].includes(value.type)) {
          if (!isConnectionMessage(value) || value.data.channelId !== channelId) return;
          if (pinnedOrigin && pinnedOrigin !== event.origin) return;
          const data = value.data;
          if (attemptId !== undefined && data.attemptId < attemptId) return;
          pinnedOrigin = event.origin;
          cancelRetries();
          if (data.attemptId !== attemptId) {
            const renew = attemptId !== undefined;
            attemptId = data.attemptId;
            observed = false;
            waitForObservation(renew);
          }
          if (value.type === 'connection-state-change') {
            observed = true;
            clearTimeout(timeout);
            publish(data.state!, data.state === 'disconnected' ? data.clean : undefined);
          }
          return;
        }
        latest.current.onMessage?.(value);
      } else if (envelope.type === 'iframe-set-height') {
        if (typeof envelope.data !== 'number' && typeof envelope.data !== 'string') return;
        const height = typeof envelope.data === 'number' ? `${envelope.data}px` : envelope.data;
        if (!height || (typeof envelope.data === 'number' && (!Number.isFinite(envelope.data) || envelope.data < 0)))
          return;
        latest.current.pauseAutoHeight();
        frame.style.height = height;
      }
    };

    window.addEventListener('message', handleMessage);
    loadRef.current = handleLoad;
    sendRef.current = () => sendPayload();
    latest.current.setLoading(true);
    waitForObservation(false);
    frame.setAttribute('src', url);
    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(timeout);
      cancelRetries();
      loadRef.current = undefined;
      sendRef.current = undefined;
    };
  }, [url, iframeRef, connectionBridge, allowOpaqueOrigin, originKey]);

  useLayoutEffect(() => {
    sendRef.current?.();
  }, [options.iframePayload]);

  return useCallback(() => loadRef.current?.(), []);
}
