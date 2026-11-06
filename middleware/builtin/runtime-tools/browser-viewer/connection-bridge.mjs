/** Optional host bridge. Connection outcomes come only from the caller's real connection events. */
export function createConnectionBridge(host = window) {
  let channelId;
  let parentOrigin;
  let attemptId = 0;
  let snapshot;

  function send(type, state) {
    if (!channelId || !parentOrigin || host.parent === host) return;
    host.parent.postMessage({
      type: 'beyond-iframe-receive-payload',
      data: { type, data: { version: 1, channelId, attemptId, ...state } },
    }, parentOrigin);
  }

  host.addEventListener('message', (event) => {
    if (host.parent === host || event.source !== host.parent || !event.origin || event.origin === 'null') return;
    const bridge = event.data?.type === 'beyond-iframe-payload' && event.data?.data?.bridge;
    if (bridge?.version !== 1 || typeof bridge.channelId !== 'string' || !bridge.channelId || bridge.channelId.length > 256) return;
    channelId = bridge.channelId;
    parentOrigin = event.origin;
    send('connection-observation-reset');
    if (snapshot) send('connection-state-change', snapshot);
  });

  return {
    begin() {
      attemptId += 1;
      snapshot = undefined;
      send('connection-observation-reset');
      return attemptId;
    },
    isCurrent(attempt) {
      return attempt === attemptId;
    },
    update(attempt, state, clean) {
      if (attempt !== attemptId || (state !== 'connected' && state !== 'disconnected')) return;
      snapshot = { state, ...(state === 'disconnected' && typeof clean === 'boolean' ? { clean } : {}) };
      send('connection-state-change', snapshot);
    },
  };
}
