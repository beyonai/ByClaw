// Bounded, best-effort diagnostics. No prompt, answer, URL, token or headers are retained.
const STORAGE_KEY = 'byclaw.chat-chain.v1';
const MAX_EVENTS = 100;
const MAX_AGE = 24 * 60 * 60 * 1000;
type Stage =
  | 'fe.sent'
  | 'fe.final_received'
  | 'fe.final_applied'
  | 'fe.final_deferred'
  | 'fe.connection_closed'
  | 'fe.connection_opened';
type Entry = {
  eventId: string;
  time: number;
  stage: Stage;
  requestId: string;
  sessionId: string;
  streamId: string;
  result: string;
};
let queue: Entry[] = [];
const activeRequests = new Map<string, { fields: ReturnType<typeof chatChainFields>; remaining: Set<string> }>();
let timer: ReturnType<typeof setTimeout> | undefined;
let flushing = false;
const safe = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? `${value}`.slice(0, 160) : '';
const object = (value: any): any => {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value || {};
  } catch {
    return {};
  }
};
export const chatChainFields = (message: any) => {
  const frame = object(message);
  const payload = object(frame.data);
  const data = object(payload.data);
  const metadata = object(payload.metadata);
  const frameMetadata = object(frame.metadata);
  return {
    requestId: safe(
      frame.requestId ||
        payload.requestId ||
        data.requestId ||
        metadata.requestId ||
        frameMetadata.requestId ||
        frame.clientRequestId
    ),
    sessionId: safe(frame.sessionId || payload.sessionId || payload.session_id || data.sessionId),
    streamId: safe(frame.streamId || payload.stream_id || payload.streamId || data.streamId),
  };
};
export const isChatTerminal = (message: any) => {
  const frame = object(message);
  const payload = object(frame.data);
  return frame.type === 'ERROR' || ['appStreamResponse', 'error'].includes(frame.event || payload.event);
};
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(saved)) return;
    const ids = new Set(queue.map((item) => item.eventId));
    // Rebuild from an explicit field allowlist, including when local storage was edited.
    saved.slice(-MAX_EVENTS).forEach((item) => {
      if (!item || ids.has(item.eventId) || !Number.isFinite(item.time) || Date.now() - item.time > MAX_AGE) return;
      if (
        !safe(item.eventId) ||
        !safe(item.requestId) ||
        !['ok', 'failed', 'restoring', 'missing_context'].includes(item.result)
      )
        return;
      if (
        ![
          'fe.sent',
          'fe.final_received',
          'fe.final_applied',
          'fe.final_deferred',
          'fe.connection_closed',
          'fe.connection_opened',
        ].includes(item.stage)
      )
        return;
      queue.push({
        eventId: safe(item.eventId),
        time: item.time,
        stage: item.stage,
        ...chatChainFields(item),
        result: safe(item.result),
      });
      ids.add(item.eventId);
    });
    queue = queue.filter((item) => Date.now() - item.time <= MAX_AGE).slice(-MAX_EVENTS);
  } catch {
    return;
  }
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    return;
  }
}
function schedule(delay = 2000) {
  if (!timer && queue.length)
    timer = setTimeout(() => {
      timer = undefined;
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      void flushChatChainLogs();
    }, delay);
}
export async function flushChatChainLogs() {
  if (flushing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  restore();
  if (!queue.length) return;
  flushing = true;
  const batch = queue.slice(0, 20);
  let succeeded = false;
  try {
    const { sendChatChainBatch } = await import('./chatChainTransport');
    await sendChatChainBatch(batch);
    const sent = new Set(batch.map((item) => item.eventId));
    restore();
    queue = queue.filter((item) => !sent.has(item.eventId));
    persist();
    succeeded = true;
  } catch {
    return;
  } finally {
    flushing = false;
    schedule(succeeded ? 2000 : 30000);
  }
}
export function recordChatChain(stage: Stage, message: any, result = 'ok') {
  try {
    const fields = chatChainFields(message);
    if (!fields.requestId) return;
    if (stage === 'fe.sent' && result === 'ok') {
      const ids = Array.isArray(message.laneIds) ? message.laneIds.map(safe).filter(Boolean).slice(0, 100) : [];
      activeRequests.set(fields.requestId, { fields, remaining: new Set(ids.length ? ids : [fields.requestId]) });
      if (activeRequests.size > MAX_EVENTS) activeRequests.delete(activeRequests.keys().next().value!);
    }
    if (stage === 'fe.final_applied') {
      const active = activeRequests.get(fields.requestId);
      active?.remaining.delete(safe(message.appliedClientRequestId) || fields.requestId);
      if (active?.remaining.size === 0) activeRequests.delete(fields.requestId);
    }
    restore();
    queue.push({
      ...fields,
      eventId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      time: Date.now(),
      stage,
      result,
    });
    queue = queue.slice(-MAX_EVENTS);
    persist();
    schedule();
  } catch {
    return;
  }
}
export function recordChatConnection(connected: boolean) {
  activeRequests.forEach(({ fields }) =>
    recordChatChain(connected ? 'fe.connection_opened' : 'fe.connection_closed', fields)
  );
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void flushChatChainLogs();
  });
  window.addEventListener('pageshow', () => {
    void flushChatChainLogs();
  });
  restore();
  schedule();
}
