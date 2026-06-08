/**
 * WebSocket 管理工具类 - 全局单例模式
 */

import { getToken } from './auth';

interface WebSocketMessage {
  type: string;
  clientRequestId?: string;
  sessionId?: string;
  event?: string;
  data?: any;
  [key: string]: any;
}

type MessageHandler = (message: WebSocketMessage) => void;

class WebSocketManager {
  private static instance?: WebSocketManager;

  private ws: WebSocket | null = null;

  private reconnectTimer: NodeJS.Timeout | null = null;

  private heartbeatTimer: NodeJS.Timeout | null = null;

  private isConnecting = false;

  private messageHandlers: Map<string, MessageHandler[]> = new Map();

  private reconnectCount: number = 0;

  private manuallyDisconnected = false;

  private connectResolvers: Array<() => void> = [];

  private connectRejecters: Array<(error: Error) => void> = [];

  private connectionSeq = 0;

  private activeConnectionId = 0;

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      this.ensureConnected();
    }
  };

  private constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.ensureConnected);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  public static getInstance(): WebSocketManager {
    const globalKey = '__BYCLAW_WEBSOCKET_MANAGER__';
    const globalScope = globalThis as typeof globalThis & {
      [globalKey]?: WebSocketManager;
    };

    if (globalScope[globalKey]) {
      WebSocketManager.instance = globalScope[globalKey]!;
      return WebSocketManager.instance!;
    }

    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
      globalScope[globalKey] = WebSocketManager.instance;
    }
    return WebSocketManager.instance!;
  }

  public static disposeInstance(instance: WebSocketManager): void {
    const globalKey = '__BYCLAW_WEBSOCKET_MANAGER__';
    const globalScope = globalThis as typeof globalThis & {
      [globalKey]?: WebSocketManager;
    };

    if (globalScope[globalKey] === instance) {
      delete globalScope[globalKey];
    }
    if (WebSocketManager.instance === instance) {
      WebSocketManager.instance = undefined;
    }
  }

  /**
   * 根据当前页面地址获取 WebSocket URL
   * @param path WebSocket 服务路径
   * @returns 完整的 WebSocket URL
   */
  private getWebSocketUrl(path: string): string {
    const url = new URL(window.location.href);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const { hostname, host } = url;
    if (process.env.NODE_ENV === 'development') {
      return `ws://${host}/${path}`;
    }
    const port = url.port ? `:${url.port}` : '';
    return `${protocol}//${hostname}${port}/${path}`;
  }

  /**
   * 初始化 WebSocket 连接
   */
  public init(): void {
    this.manuallyDisconnected = false;
    if (this.ws || this.isConnecting) {
      return;
    }

    const token = getToken();
    if (!token) {
      console.warn('Token 不存在，无法建立 WebSocket 连接');
      return;
    }

    this.isConnecting = true;

    try {
      // 创建 WebSocket 连接
      const wsUrl = this.getWebSocketUrl(`byaiService/ws?beyond-token=${token}`);
      const connectionId = this.connectionSeq + 1;
      this.connectionSeq = connectionId;
      this.activeConnectionId = connectionId;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      // 设置请求头 - 在连接建立后发送认证信息
      ws.onopen = () => {
        if (!this.isCurrentConnection(connectionId, ws)) {
          ws.close();
          return;
        }
        console.log('WebSocket 连接成功');
        this.isConnecting = false;

        this.startHeartbeat();
        this.reconnectCount = 0;
        this.resolveConnectWaiters();
      };

      ws.onmessage = (event) => {
        if (!this.isCurrentConnection(connectionId, ws)) {
          return;
        }
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('WebSocket 消息解析失败:', error);
        }
      };

      ws.onclose = (event) => {
        if (!this.isCurrentConnection(connectionId, ws)) {
          return;
        }
        console.log('WebSocket 连接关闭:', event.code, event.reason);
        this.ws = null;
        this.isConnecting = false;
        this.stopHeartbeat();
        this.scheduleReconnect();
      };

      ws.onerror = (error) => {
        if (!this.isCurrentConnection(connectionId, ws)) {
          return;
        }
        console.error('WebSocket 连接错误:', error);
        this.isConnecting = false;
        this.stopHeartbeat();
        this.rejectConnectWaiters(new Error('WebSocket connection error'));
      };
    } catch (error) {
      console.error('WebSocket 初始化失败:', error);
      this.isConnecting = false;
      this.rejectConnectWaiters(error instanceof Error ? error : new Error('WebSocket init failed'));
      this.scheduleReconnect();
    }
  }

  private isCurrentConnection(connectionId: number, ws: WebSocket): boolean {
    return this.ws === ws && this.activeConnectionId === connectionId;
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage(message: WebSocketMessage): void {
    // 调用注册的消息处理器
    const handlers = this.messageHandlers.get(message.type) || [];
    const wildcardHandlers = this.messageHandlers.get('*') || [];
    [...handlers, ...wildcardHandlers].forEach((handler) => {
      try {
        handler(message);
      } catch (error) {
        console.error('消息处理器执行失败:', error);
      }
    });
  }

  /**
   * 开始心跳检测
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendMessage({
          type: 'NOTIFICATION',
        });
      }
    }, 6000); // 每6秒发送一次
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 发送消息
   */
  public sendMessage(message: WebSocketMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('WebSocket 消息发送失败:', error);
      }
    }
  }

  public waitUntilConnected(timeout = 10000): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    this.init();
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const onResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      const onReject = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      timer = setTimeout(() => {
        this.connectResolvers = this.connectResolvers.filter((item) => item !== onResolve);
        this.connectRejecters = this.connectRejecters.filter((item) => item !== onReject);
        reject(new Error('WebSocket connection timeout'));
      }, timeout);

      this.connectResolvers.push(onResolve);
      this.connectRejecters.push(onReject);
    });
  }

  public async sendMessageWhenReady(message: WebSocketMessage): Promise<void> {
    await this.waitUntilConnected();
    this.sendMessage(message);
  }

  /**
   * 注册消息处理器
   */
  public onMessage(type: string, handler: MessageHandler): void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type)!.push(handler);
  }

  /**
   * 取消注册消息处理器
   */
  public offMessage(type: string, handler: MessageHandler): void {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * 断开连接
   */
  public disconnect(): void {
    this.manuallyDisconnected = true;
    this.activeConnectionId = 0;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnecting = false;
  }

  public dispose(): void {
    this.disconnect();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.ensureConnected);
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  private ensureConnected = (): void => {
    if (this.manuallyDisconnected) {
      return;
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.init();
  };

  /**
   * 重连调度
   */
  private scheduleReconnect(): void {
    if (this.manuallyDisconnected) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectCount += 1;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.reconnectCount, 5));
    this.reconnectTimer = setTimeout(() => {
      this.init();
    }, delay);
  }

  private resolveConnectWaiters(): void {
    const resolvers = [...this.connectResolvers];
    this.connectResolvers = [];
    this.connectRejecters = [];
    resolvers.forEach((resolve) => resolve());
  }

  private rejectConnectWaiters(error: Error): void {
    const rejecters = [...this.connectRejecters];
    this.connectResolvers = [];
    this.connectRejecters = [];
    rejecters.forEach((reject) => reject(error));
  }

  /**
   * 获取连接状态
   */
  public getConnectionStatus(): 'connected' | 'connecting' | 'disconnected' {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return 'connected';
    }
    if (this.isConnecting) {
      return 'connecting';
    }
    return 'disconnected';
  }
}

// 导出单例实例
const webSocketManager = WebSocketManager.getInstance();

const hotModule =
  typeof module !== 'undefined'
    ? (module as unknown as { hot?: { dispose(callback: () => void): void } }).hot
    : undefined;

if (hotModule) {
  hotModule.dispose(() => {
    webSocketManager.dispose();
    WebSocketManager.disposeInstance(webSocketManager);
  });
}

export default webSocketManager;
