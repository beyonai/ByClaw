if (typeof window.requestIdleCallback !== 'function') {
  // 实现 IdleDeadline 接口
  class IdleDeadlineImpl implements IdleDeadline {
    private _didTimeout: boolean;

    private _deadline: number;

    constructor(didTimeout: boolean, deadline: number) {
      this._didTimeout = didTimeout;
      this._deadline = deadline;
    }

    get didTimeout(): boolean {
      return this._didTimeout;
    }

    timeRemaining(): number {
      const remaining = this._deadline - performance.now();
      return remaining > 0 ? remaining : 0;
    }
  }

  // 存储所有待执行的回调信息
  interface CallbackInfo {
    callback: IdleRequestCallback;
    timerId: number;
    timeoutTimerId?: number;
    deadline: number;
    cancelled: boolean;
  }

  const callbacks: Map<number, CallbackInfo> = new Map();
  let callbackId = 0;

  // 执行回调的辅助函数
  const executeCallback = (id: number, didTimeout: boolean): void => {
    const info = callbacks.get(id);
    if (!info || info.cancelled) {
      return;
    }

    const idleDeadline = new IdleDeadlineImpl(didTimeout, info.deadline);
    try {
      info.callback(idleDeadline);
    } catch (error) {
      console.error('requestIdleCallback error:', error);
    }

    // 清理定时器
    clearTimeout(info.timerId);
    if (info.timeoutTimerId) {
      clearTimeout(info.timeoutTimerId);
    }
    callbacks.delete(id);
  };

  // 实现 requestIdleCallback
  window.requestIdleCallback = function (callback: IdleRequestCallback, options?: IdleRequestOptions): number {
    callbackId += 1;
    const id = callbackId;
    const timeout = options?.timeout ?? 0;
    const startTime = performance.now();
    const deadline = timeout > 0 ? startTime + timeout : Infinity;

    // 使用 setTimeout 模拟空闲回调
    // 默认延迟 1ms，让浏览器有机会处理其他任务
    const timerId = window.setTimeout(() => {
      const info = callbacks.get(id);
      if (!info || info.cancelled) {
        return;
      }

      const didTimeout = timeout > 0 && performance.now() >= deadline;
      executeCallback(id, didTimeout);
    }, 1);

    // 如果有超时设置，额外设置一个超时定时器
    let timeoutTimerId: number | undefined;
    if (timeout > 0) {
      timeoutTimerId = window.setTimeout(() => {
        const info = callbacks.get(id);
        if (info && !info.cancelled) {
          // 取消正常定时器，执行超时回调
          clearTimeout(info.timerId);
          executeCallback(id, true);
        }
      }, timeout);
    }

    callbacks.set(id, {
      callback,
      timerId,
      timeoutTimerId,
      deadline,
      cancelled: false,
    });

    return id;
  };

  // 实现 cancelIdleCallback
  if (typeof window.cancelIdleCallback !== 'function') {
    window.cancelIdleCallback = function (handle: number): void {
      const info = callbacks.get(handle);
      if (info) {
        info.cancelled = true;
        clearTimeout(info.timerId);
        if (info.timeoutTimerId) {
          clearTimeout(info.timeoutTimerId);
        }
        callbacks.delete(handle);
      }
    };
  }
}
