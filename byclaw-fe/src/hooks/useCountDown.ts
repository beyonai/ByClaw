import { useState, useEffect, useCallback, useRef } from 'react';
import { throttle, delay } from 'lodash';

/**
 * 倒计时 Hook
 * @param initialTime 初始时间（毫秒）
 * @param onComplete 倒计时结束时的回调函数
 * @returns 包含倒计时状态和控制方法的对象
 */
const useCountdown = (initialTime: number, onComplete?: () => void) => {
  const [remainingTime, setRemainingTime] = useState(initialTime);
  const [isRunning, setIsRunning] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const totalTimeRef = useRef(initialTime);

  // 更新显示（使用 Lodash 节流优化）
  const updateDisplay = useCallback(
    throttle((time: number) => {
      setRemainingTime(time);
    }, 500),
    []
  );

  // 暂停倒计时
  const pause = () => {
    if (!isRunning) return;

    // 清除 Lodash 的 delay
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setIsRunning(false);

    // 更新剩余时间
    if (startTimeRef.current !== null) {
      const elapsed = Date.now() - startTimeRef.current;
      const newRemaining = Math.max(0, totalTimeRef.current - elapsed);
      setRemainingTime(newRemaining);
    }
  };

  // 重置倒计时
  const reset = () => {
    pause();
    setRemainingTime(totalTimeRef.current);
    setIsCompleted(false);
    startTimeRef.current = null;
  };

  // 核心倒计时逻辑
  const runCountdown = () => {
    if (startTimeRef.current === null) return;

    const now = Date.now();
    const elapsed = now - startTimeRef.current;
    const newRemaining = Math.max(0, totalTimeRef.current - elapsed);
    // 更新显示
    updateDisplay(newRemaining);

    if (newRemaining <= 0) {
      // 倒计时结束
      setIsRunning(false);
      setIsCompleted(true);
      startTimeRef.current = null;
      if (onComplete) {
        reset();
        onComplete();
      };
      return;
    }

    // 使用 Lodash 的 delay 设置下一个更新
    timerRef.current = delay(runCountdown, 10);
  };

  // 开始倒计时
  const start = () => {
    if (isRunning) return;

    // 如果是完成状态，重置倒计时
    if (isCompleted) {
      reset();
      return;
    }
    console.log('start');
    // 计算开始时间（考虑暂停后继续的情况）
    const elapsed = totalTimeRef.current - remainingTime;
    startTimeRef.current = Date.now() - elapsed;

    setIsRunning(true);
    runCountdown();
  };

  // 设置新的倒计时时间
  const setTime = (newTime: number) => {
    totalTimeRef.current = newTime;
    reset();
  };

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return {
    remainingTime,
    isRunning,
    isCompleted,
    start,
    pause,
    reset,
    setTime,
    progress: (totalTimeRef.current - remainingTime) / totalTimeRef.current,
  };
};

export default useCountdown;
