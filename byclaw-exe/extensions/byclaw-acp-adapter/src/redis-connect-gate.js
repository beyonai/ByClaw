/**
 * Serialize lazy Redis connection attempts while allowing all callers to wait
 * for the same in-flight connection.
 */
export function createRedisConnectGate({ isReady, connect }) {
  let connectPromise = null;

  return async function ensureConnected() {
    if (isReady()) {
      return;
    }
    if (!connectPromise) {
      connectPromise = Promise.resolve().then(connect);
    }
    const pending = connectPromise;
    try {
      await pending;
    } finally {
      if (connectPromise === pending) {
        connectPromise = null;
      }
    }
  };
}
