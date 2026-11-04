import { useCallback, useEffect, useRef, useState } from 'react';
import { querySyncProgress, SyncProgress } from './service';

export default function useSyncProgress(
  resourceIds: (string | number | undefined)[],
  onCompleted?: (resourceIds: string[]) => void
) {
  const key = JSON.stringify(
    [...new Set(resourceIds.filter((id) => id !== undefined && id !== null).map(String))].sort()
  );
  const [tasks, setTasks] = useState<Record<string, SyncProgress>>({});
  const [error, setError] = useState('');
  const refreshRef = useRef<() => void>(() => {});
  const completedRef = useRef(onCompleted);
  completedRef.current = onCompleted;
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    const ids: string[] = JSON.parse(key);
    let disposed = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout>;
    let previous: Record<string, SyncProgress> = {};
    setTasks({});
    setError('');
    const poll = async () => {
      if (disposed || running || !ids.length) return;
      clearTimeout(timer);
      running = true;
      let delay = 10000;
      try {
        const next: Record<string, SyncProgress> = {};
        for (let start = 0; start < ids.length; start += 100) {
          const response = await querySyncProgress(ids.slice(start, start + 100));
          if (disposed) return;
          if (response?.code !== 0 || !Array.isArray(response.data)) throw new Error('query failed');
          response.data.forEach((task) => {
            next[String(task.resourceId)] = task;
          });
        }
        if (disposed) return;
        const completed = Object.values(next).filter(
          (task) =>
            previous[task.resourceId] &&
            (previous[task.resourceId].status !== 'COMPLETED' || previous[task.resourceId].jobId !== task.jobId) &&
            task.status === 'COMPLETED'
        );
        if (
          Object.values(next).some(
            (task) =>
              ['PENDING', 'RUNNING'].includes(task.status) ||
              (['FAILED', 'PARTIAL'].includes(task.status) && task.retryCount < (task.retryLimit ?? 8))
          )
        )
          delay = 3000;
        previous = next;
        setTasks(next);
        setError('');
        if (completed.length) completedRef.current?.(completed.map((task) => task.resourceId));
      } catch {
        if (!disposed) setError('暂时无法获取同步进度，后台可能仍在处理，请稍后刷新。');
      } finally {
        running = false;
        if (!disposed && ids.length) timer = setTimeout(poll, delay);
      }
    };
    const visible = () => {
      if (!document.hidden) void poll();
    };
    refreshRef.current = () => void poll();
    void poll();
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [key]);
  return { tasks, error, refresh };
}
