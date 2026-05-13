import { useRef, useCallback } from 'react';

interface UseDelayedHoverOptions {
  delay?: number; // 延时时间，默认300ms
  onEnter?: () => void; // 鼠标进入时的回调
  onLeave?: () => void; // 鼠标离开时的回调
}

/**
 * 延时悬停Hook
 * 当鼠标进入时，延时指定时间后执行onEnter回调
 * 如果在延时期间鼠标离开，则取消执行onEnter
 * @param options 配置选项
 * @returns 鼠标事件处理函数
 */
export default function useDelayedHover(options: UseDelayedHoverOptions = {}) {
  const { delay = 300, onEnter, onLeave } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    // 清除之前的定时器
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // 设置新的定时器
    timerRef.current = setTimeout(() => {
      onEnter?.();
      timerRef.current = null;
    }, delay);
  }, [delay, onEnter]);

  const handleMouseLeave = useCallback(() => {
    // 清除定时器，取消延时执行
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // 执行离开回调
    onLeave?.();
  }, [onLeave]);

  // 清理函数，组件卸载时清除定时器
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return {
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    cleanup,
  };
}
