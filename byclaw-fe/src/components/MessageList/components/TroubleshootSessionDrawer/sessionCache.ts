const troubleshootSessionCache = new Map<string, string>();

export function cacheTroubleshootSession(traceId?: string, sessionId?: string) {
  if (!traceId || !sessionId) return;
  troubleshootSessionCache.set(traceId, sessionId);
}

export function getCachedTroubleshootSession(traceId?: string) {
  if (!traceId) return undefined;
  return troubleshootSessionCache.get(traceId);
}
