import { useCallback, useEffect, useState } from 'react';
import { getEffectiveEnableDsh } from '@/service/system';
import { resolveChatRuntimeType, type ChatRuntimeType } from '@/utils/chatRuntime';

/** UI runtime comes only from the effective ENABLE_DSH, with personal configuration resolved by the server. */
export function useChatRuntime(sessionId?: string) {
  const [state, setState] = useState<{ sessionId?: string; type: ChatRuntimeType }>({ type: 'unknown' });
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    let cancelled = false;
    setError(false);
    setState({ sessionId, type: 'unknown' });
    getEffectiveEnableDsh()
      .then((enableDsh) => {
        const type = resolveChatRuntimeType({ enableDsh });
        if (type === 'unknown') throw new Error('Effective ENABLE_DSH is missing');
        if (!cancelled) setState({ sessionId, type });
      })
      .catch((reason) => {
        console.error('Failed to load effective ENABLE_DSH:', reason);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, attempt]);
  const runtimeType = state.sessionId === sessionId ? state.type : 'unknown';
  return { runtimeType, runtimeReady: runtimeType !== 'unknown', runtimeError: error, retry };
}
