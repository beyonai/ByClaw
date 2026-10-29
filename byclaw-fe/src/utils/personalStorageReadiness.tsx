import { getIntl } from '@umijs/max';
import { Button, Modal, Space, Spin } from 'antd';
import { getAuthSnapshot, isCurrentAuthSnapshot } from './auth';
import webSocketManager from './websocket';
import { createNasReadinessWaiter, NasReadinessCancelled, ReadinessView, StorageReadiness } from './nasReadinessWaiter';

let active: { promise: Promise<void>; cancel: () => void; users: number; current: () => boolean } | undefined;
const t = (id: string) => getIntl().formatMessage({ id: `storageReadiness.${id}` });

/** Hold before dispatch. Never automatically replay a request that may already have executed. */
export async function waitForPersonalStorage(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new NasReadinessCancelled();
  if (active && !active.current()) active.cancel();
  if (!active || !active.current()) {
    const auth = getAuthSnapshot();
    const scope = webSocketManager.getScopedSessionId();
    const current = () => isCurrentAuthSnapshot(auth) && webSocketManager.getScopedSessionId() === scope;
    let waiter: ReturnType<typeof createNasReadinessWaiter>;
    let initial: ReturnType<typeof setTimeout> | undefined;
    let modal: ReturnType<typeof Modal.info> | undefined;
    const render = (state: ReadinessView) => {
      clearTimeout(initial);
      const stopped = state.phase === 'timeout' || state.phase === 'blocked';
      const config = {
        title: t('title'),
        icon: null,
        closable: false,
        maskClosable: false,
        keyboard: false,
        content: (
          <Space direction="vertical" role="status" aria-live="polite">
            {!stopped && <Spin />}
            <span>{t(state.phase)}</span>
            <Space>
              {stopped && <Button onClick={() => waiter.retry()}>{t('retry')}</Button>}
              <Button onClick={() => waiter.cancel()}>{t('cancel')}</Button>
            </Space>
          </Space>
        ),
        footer: null,
      };
      if (modal) modal.update(config);
      else modal = Modal.info(config);
    };
    waiter = createNasReadinessWaiter({
      isCurrent: current,
      onState: render,
      read: async (abort) => {
        const { POST } = await import('@/service/common/request');
        const controller = new AbortController();
        const cancel = () => controller.abort();
        abort.addEventListener('abort', cancel, { once: true });
        if (abort.aborted) cancel();
        try {
          return await POST<StorageReadiness>(
            '/byaiService/storage/personal/readiness',
            { sessionId: scope || undefined },
            { timeout: 10000, cancelToken: controller, responseCfg: { hideErrorTips: true } }
          );
        } finally {
          abort.removeEventListener('abort', cancel);
        }
      },
      subscribe: (wake) => {
        const receive = (event: any) => wake(event.data);
        webSocketManager.onMessage('STORAGE_PREPARATION', receive);
        const offReconnect = webSocketManager.onReconnect(() => wake());
        // The HTTP fallback also works when a WebSocket cannot be established.
        void webSocketManager.waitUntilConnected().catch(() => {});
        return () => {
          webSocketManager.offMessage('STORAGE_PREPARATION', receive);
          offReconnect();
        };
      },
    });
    const flight = { promise: waiter.promise, cancel: waiter.cancel, users: 0, current };
    active = flight;
    // Show loading only if the initial authoritative read is not immediate.
    initial = setTimeout(() => render({ phase: 'waiting' }), 300);
    flight.promise = waiter.promise.finally(() => {
      clearTimeout(initial);
      modal?.destroy();
      if (active === flight) active = undefined;
    });
    // All callers may cancel before the shared status request settles.
    void flight.promise.catch(() => {});
  }
  const flight = active!;
  flight.users += 1;
  let abort: (() => void) | undefined;
  try {
    await Promise.race([
      flight.promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(new NasReadinessCancelled());
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      }),
    ]);
    if (!flight.current() || signal?.aborted) throw new NasReadinessCancelled();
  } finally {
    if (abort) signal?.removeEventListener('abort', abort);
    flight.users -= 1;
    if (flight.users === 0 && active === flight) flight.cancel();
  }
}

/** Cloud personal-drive operations only; Git/devloop and desktop-local IO retain their existing paths. */
export function requiresPersonalStorage(url: string): boolean {
  return /^\/byaiService\/(?:chat\/uploadFiles|datasetController\/uploadFiles|fileBrowser\/(?:upload|createFolder|ensureFolder|copy|move|rename|saveToKnowledge))$/.test(
    url
  );
}
