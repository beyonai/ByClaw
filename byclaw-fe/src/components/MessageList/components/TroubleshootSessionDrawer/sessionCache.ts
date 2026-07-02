type TroubleshootSessionCachePayload = {
  traceId?: string;
  messageId?: string;
  sessionId?: string;
};

const troubleshootSessionCacheByTraceId = new Map<string, string>();
const troubleshootSessionCacheByMessageId = new Map<string, string>();

export function cacheTroubleshootSession(payload: TroubleshootSessionCachePayload = {}) {
  const { traceId, messageId, sessionId } = payload;
  if (!sessionId) return;

  if (traceId) {
    troubleshootSessionCacheByTraceId.set(`${traceId}`, sessionId);
  }

  if (messageId) {
    troubleshootSessionCacheByMessageId.set(`${messageId}`, sessionId);
  }
}

export function getCachedTroubleshootSession(payload: Omit<TroubleshootSessionCachePayload, 'sessionId'> = {}) {
  const { traceId, messageId } = payload;

  if (messageId) {
    const cachedSessionId = troubleshootSessionCacheByMessageId.get(`${messageId}`);
    if (cachedSessionId) {
      return cachedSessionId;
    }
  }

  if (!traceId) return undefined;
  return troubleshootSessionCacheByTraceId.get(`${traceId}`);
}
