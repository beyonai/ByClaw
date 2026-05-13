/**
 * WebSocket 管理工具类 - 全局单例模式
 */

import { getToken } from './auth';
import { noop } from 'lodash';

import type { ISession } from '@/typescript/session';

interface WebSocketMessage {
  type: string;
  session?: ISession;
}

type MessageHandler = (message: WebSocketMessage) => void;

class WebSocketManager {
  private static instance: WebSocketManager;

  private ws: WebSocket | null = null;

  private reconnectTimer: NodeJS.Timeout | null = null;

  private heartbeatTimer: NodeJS.Timeout | null = null;

  private isConnecting = false;

  private messageHandlers: Map<string, MessageHandler[]> = new Map();

  private hasNotification = false;

  private onNotificationChange: (hasNotification: boolean) => void = noop;

  private onAddNotificationSessionCb: (newSession: ISession) => void = noop;

  private reconnectCount: number = 0;

  private constructor() {}

  public static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
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
      this.ws = new WebSocket(wsUrl);

      // 设置请求头 - 在连接建立后发送认证信息
      this.ws.onopen = () => {
        console.log('WebSocket 连接成功');
        this.isConnecting = false;

        this.startHeartbeat();
        this.reconnectCount = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('WebSocket 消息解析失败:', error);
        }
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket 连接关闭:', event.code, event.reason);
        this.ws = null;
        this.isConnecting = false;
        this.stopHeartbeat();
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket 连接错误:', error);
        this.isConnecting = false;
        this.stopHeartbeat();
      };
    } catch (error) {
      console.error('WebSocket 初始化失败:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage(message: WebSocketMessage): void {
    // 如果有消息返回，设置红点标识
    if (message.session) {
      this.setHasNotification(true);

      // 通知其他组件处理会话逻辑：如果会话不存在则添加，存在则更新
      this.onAddNotificationSessionCb(message.session);
    }

    // 调用注册的消息处理器
    const handlers = this.messageHandlers.get(message.type) || [];
    handlers.forEach((handler) => {
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
   * 设置红点状态变化回调
   */
  public setOnNotificationChange(callback: (hasNotification: boolean) => void): void {
    this.onNotificationChange = callback;
  }

  public setOnAddNotificationSessionCb(callback: (newSession: ISession) => void): void {
    this.onAddNotificationSessionCb = callback;
  }

  /**
   * 设置是否有通知
   */
  private setHasNotification(hasNotification: boolean): void {
    if (this.hasNotification !== hasNotification) {
      this.hasNotification = hasNotification;
      if (this.onNotificationChange) {
        this.onNotificationChange(hasNotification);
      }
    }
  }

  /**
   * 获取当前是否有通知
   */
  public getHasNotification(): boolean {
    return this.hasNotification;
  }

  /**
   * 清除通知状态
   */
  public clearNotification(): void {
    this.setHasNotification(false);
  }

  /**
   * 断开连接
   */
  public disconnect(): void {
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

  /**
   * 重连调度
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectCount > 5) {
      return;
    }

    this.reconnectCount += 1;
    this.reconnectTimer = setTimeout(() => {
      this.init();
    }, 5000); // 5秒后重连
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
export default WebSocketManager.getInstance();
