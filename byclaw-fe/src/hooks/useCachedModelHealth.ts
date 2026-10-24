import { useEffect, useState } from 'react';
import { useLocation } from '@umijs/max';
import {
  getCachedModelHealth,
  refreshCachedModelHealth,
  MODEL_HEALTH_EVENT,
  type HealthUser,
  type ModelHealthReport,
} from '@/service/modelHealth';

export default function useCachedModelHealth(user: HealthUser | undefined, scope: ModelHealthReport['scope']) {
  const userId = user?.userId ?? user?.id;
  const key = `${user?.enterpriseId ?? ''}:${userId}:${scope}`;
  const { pathname, search } = useLocation();
  const [cached, setCached] = useState(() => ({ key, report: getCachedModelHealth(user, scope) }));

  useEffect(() => {
    const sync = () => setCached({ key, report: getCachedModelHealth(user, scope) });
    const refresh = () => {
      void refreshCachedModelHealth(user, scope);
    };
    const handle = (event: Event) => {
      if ((event as CustomEvent).detail?.invalidated) refresh();
      else sync();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    sync();
    refresh();
    // Cross-tab/device updates read Redis only; polling never triggers inference.
    const timer = window.setInterval(onVisible, 60000);
    window.addEventListener(MODEL_HEALTH_EVENT, handle);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(MODEL_HEALTH_EVENT, handle);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, user?.enterpriseId, scope, pathname, search]);

  return cached.key === key ? cached.report : undefined;
}
