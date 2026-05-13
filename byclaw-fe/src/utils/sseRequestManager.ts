/**
 * SSE请求管理器
 * 用于跟踪和管理正在进行的SSE请求，限制并发数量
 */

type SSERequestInfo = {
  sessionId: string;
  msgId: string; // 消息ID，用于标识请求
  cancel: () => void; // 取消请求的方法
  promise: Promise<any>; // 请求的Promise
};

class SSERequestManager {
  private activeRequests: Map<string, SSERequestInfo> = new Map();

  private readonly maxConcurrent = 6; // 最大并发数

  /**
   * 注册一个新的SSE请求
   * @param sessionId 会话ID
   * @param msgId 消息ID
   * @param cancel 取消请求的方法
   * @param promise 请求的Promise
   * @returns 是否成功注册（如果超过最大并发数则返回false）
   */
  register(sessionId: string, msgId: string, cancel: () => void, promise: Promise<any>): boolean {
    // 检查是否超过最大并发数
    if (this.activeRequests.size >= this.maxConcurrent) {
      return false;
    }

    const key = `${sessionId}-${msgId}`;
    this.activeRequests.set(key, {
      sessionId,
      msgId,
      cancel,
      promise,
    });

    // 当请求完成时自动注销
    promise
      .then(() => {
        this.unregister(sessionId, msgId);
      })
      .catch(() => {
        this.unregister(sessionId, msgId);
      });

    return true;
  }

  /**
   * 注销一个SSE请求
   * @param sessionId 会话ID
   * @param msgId 消息ID
   */
  unregister(sessionId: string, msgId: string): void {
    const key = `${sessionId}-${msgId}`;
    this.activeRequests.delete(key);
  }

  /**
   * 获取指定会话的活跃请求数量
   * @param sessionId 会话ID
   * @returns 活跃请求数量
   */
  getActiveCountBySession(sessionId: string): number {
    let count = 0;
    this.activeRequests.forEach((request) => {
      if (request.sessionId === sessionId) {
        count += 1;
      }
    });
    return count;
  }

  /**
   * 获取所有活跃请求数量
   * @returns 活跃请求数量
   */
  getActiveCount(): number {
    return this.activeRequests.size;
  }

  /**
   * 检查是否可以发起新的SSE请求
   * @returns 是否可以发起
   */
  canStartNewRequest(): boolean {
    return this.activeRequests.size < this.maxConcurrent;
  }

  /**
   * 获取指定会话的所有活跃请求
   * @param sessionId 会话ID
   * @returns 活跃请求列表
   */
  getActiveRequestsBySession(sessionId: string): SSERequestInfo[] {
    const requests: SSERequestInfo[] = [];
    this.activeRequests.forEach((request) => {
      if (request.sessionId === sessionId) {
        requests.push(request);
      }
    });
    return requests;
  }

  /**
   * 取消指定会话的所有请求
   * @param sessionId 会话ID
   */
  cancelAllBySession(sessionId: string): void {
    const requests = this.getActiveRequestsBySession(sessionId);
    requests.forEach((request) => {
      request.cancel();
      this.unregister(request.sessionId, request.msgId);
    });
  }

  /**
   * 取消所有请求
   */
  cancelAll(): void {
    this.activeRequests.forEach((request) => {
      request.cancel();
    });
    this.activeRequests.clear();
  }
}

// 导出单例
export const sseRequestManager = new SSERequestManager();
