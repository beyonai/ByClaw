import { useCallback, useState } from 'react';
import { normalizeSessionId } from '@/utils/sessionId';
import type { SessionIdInput } from '@/utils/sessionId';

type SessionIdUpdate = SessionIdInput | ((previous: string) => SessionIdInput);

export default function useSessionIdState(initialId: SessionIdInput = '') {
  const [sessionId, setValue] = useState(() => normalizeSessionId(initialId));
  const setSessionId = useCallback((value: SessionIdUpdate) => {
    setValue((previous) => normalizeSessionId(typeof value === 'function' ? value(previous) : value));
  }, []);

  return [sessionId, setSessionId] as const;
}
