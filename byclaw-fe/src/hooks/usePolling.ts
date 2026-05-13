import { useCallback, useRef, useState } from 'react';

export interface UsePollingOptions {

  /** 轮询间隔时间（毫秒），默认 1000ms */
  interval?: number;

  /** 是否立即执行第一次查询，默认 true */
  immediate?: boolean;

  /** 最大重试次数，默认 -1（无限重试） */
  maxRetries?: number;

  /** 是否在组件卸载时自动停止轮询，默认 true */
  autoStopOnUnmount?: boolean;

  /** 轮询成功回调 */
  onSuccess?: (result: any) => void;

  /** 轮询失败回调 */
  onError?: (error: any) => void;

  /** 轮询停止回调 */
  onStop?: () => void;
}

export interface UsePollingReturn {

  /** 开始轮询 */
  start: () => void;

  /** 停止轮询 */
  stop: () => void;

  /** 是否正在轮询 */
  isPolling: boolean;

  /** 当前重试次数 */
  retryCount: number;

  /** 是否已停止（达到最大重试次数或手动停止） */
  isStopped: boolean;
}

/**
 * 通用轮询 Hook
 * @param queryFn 查询函数，返回 Promise
 * @param options 轮询配置选项
 * @returns 轮询控制方法和状态
 */
function usePolling<T = any>(queryFn: () => Promise<T>, options: UsePollingOptions = {}): UsePollingReturn {
  const { interval = 1000, immediate = true, maxRetries = -1, onSuccess, onError, onStop } = options;

  const [isPolling, setIsPolling] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [isStopped, setIsStopped] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingRef = useRef(false);
  const retryCountRef = useRef(0);

  // 停止轮询
  const stop = useCallback(() => {
    if (!isPollingRef.current) return;

    isPollingRef.current = false;
    setIsPolling(false);
    setIsStopped(true);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    onStop?.();
  }, [onStop]);

  // 执行查询
  const executeQuery = useCallback(async () => {
    if (!isPollingRef.current) return;

    try {
      const result = await queryFn();

      // 更新重试次数
      const newRetryCount = retryCountRef.current + 1;
      setRetryCount(newRetryCount);
      retryCountRef.current = newRetryCount;

      // 调用成功回调
      const isSuccess = onSuccess?.(result);

      if (isSuccess) {
        stop();
        return;
      }

      // 检查是否达到最大重试次数
      if (maxRetries > 0 && newRetryCount >= maxRetries) {
        stop();
        return;
      }

      // 继续轮询
      if (isPollingRef.current) {
        timerRef.current = setTimeout(executeQuery, interval);
      }
    } catch (error) {
      console.error('Polling query failed:', error);

      // 调用错误回调
      onError?.(error);

      stop();
    }
  }, [queryFn, interval, maxRetries, onSuccess, onError]);

  // 开始轮询
  const start = useCallback(() => {
    if (isPollingRef.current) return;

    setIsPolling(true);
    setIsStopped(false);
    setRetryCount(0);
    retryCountRef.current = 0;
    isPollingRef.current = true;

    if (immediate) {
      executeQuery();
    } else {
      timerRef.current = setTimeout(executeQuery, interval);
    }
  }, [immediate, interval, executeQuery]);

  return {
    start,
    stop,
    isPolling,
    retryCount,
    isStopped,
  };
}

export default usePolling;
