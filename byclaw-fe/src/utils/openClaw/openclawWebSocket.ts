/* eslint-disable no-bitwise */
/* openclawWebSocket.ts
 *
 * OpenClaw Gateway WebSocket 客户端封装（浏览器环境）
 * 参考：test-openclaw-websocket.html
 *
 * 作用：
 * - 维护一个长连接 WebSocket，用 token 完成 connect 握手
 * - 提供 sendChat 接口，用于发送 chat.send 请求并以流式回调返回内容
 * - 提供静态方法，将 WebSocket chat 事件结构转换为现有 SSE 管线可复用的结构
 */

import { SSEEventStatus, SSEMessageType } from '@/constants/message';
import { getMsgId } from '@/utils/messgae';
import { isDevelopment } from '../common';

type ChatPhase = 'delta' | 'final' | 'error' | 'aborted';

type ChatChunkHandler = (payload: any, phase: ChatPhase) => void;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

interface SendChatOptions {

  /** 会话键，默认 main */
  sessionKey?: string;

  /** 收到服务端 chat 流事件时的回调 */
  onChunk: ChatChunkHandler;

  /** 超时时间（毫秒），仅作为提示，不负责真正的超时中断 */
  timeoutMs?: number;
}

/** chat.history 响应结构（与 openclaw gateway 一致） */
export interface ChatHistoryPayload {
  sessionKey: string;
  sessionId: string | null;
  messages: Array<{
    role: 'user' | 'assistant';
    content: unknown;
    timestamp?: number | string;
  }>;
  thinkingLevel?: string | null;
  verboseLevel?: string | null;
}

export class OpenClawWebSocketClient {
  private static readonly PROTOCOL_VERSION = 3;

  /** 使用 gateway-client 避免 HTTPS/localhost 校验 */
  private static readonly CLIENT_ID = 'gateway-client';
  // private static readonly CLIENT_ID = 'openclaw-control-ui';

  private static readonly CLIENT_MODE = 'backend';

  private ws: WebSocket | null = null;

  private readonly url: string;

  private readonly originUrl: string;

  private readonly token: string;

  private readonly port: string;

  private readonly ip: string;

  private readonly password?: string;

  public readonly agentId: string;

  private connectSent = false;

  private pending = new Map<string, PendingRequest>();

  private challengeFallbackTimer: number | null = null;

  private ready = false;

  private readyPromise: Promise<void> | null = null;

  private readyResolve: (() => void) | null = null;

  private readyReject: ((reason?: any) => void) | null = null;

  /** 当前已尝试的重连次数 */
  private reconnectAttempts = 0;

  /** 最大自动重连次数 */
  private readonly maxReconnectAttempts = 6;

  /** 重连定时器 id */
  private reconnectTimer: number | null = null;

  /** 是否为用户主动关闭，主动关闭时不再重连 */
  private manualClose = false;

  /** 重连失败回调（当达到最大重连次数时触发） */
  private onReconnectFailed?: () => void;

  public onConnectedCallback?: () => void;

  // 当前仅维护一个 chat 流监听器，与现有 SSE 并发限制保持一致
  private currentChatHandler: ChatChunkHandler | null = null;

  private currentChatResolve: (() => void) | null = null;

  private currentChatReject: ((reason?: any) => void) | null = null;

  public realSessionId: string = '';

  /**
   * 从 hello-ok.snapshot 中解析到的会话默认信息。
   * 用于将「main / agent:defaultId:main」等别名归一化为真正的 mainSessionKey，
   * 以便与官方 Control UI 所展示的会话历史对齐。
   */
  // eslint-disable-next-line @typescript-eslint/ban-types
  private sessionDefaults: {
    defaultAgentId?: string;
    mainKey?: string;
    mainSessionKey?: string;
    scope?: string;
  } | null = null;

  constructor(agentHomeUrl: string, agentId: string) {
    const urlObj = new URL(agentHomeUrl);
    const host = isDevelopment() ? new URL(URI_TARGET).host : window.location.host;
    const wsUrl = `${urlObj.protocol === 'https:' ? 'wss' : 'ws'}://${host}/byaiService/openclaw`;

    this.url = wsUrl.trim();
    this.token = urlObj.searchParams.get('token') || '';
    this.port = urlObj.port || '';
    this.ip = urlObj.hostname || '';
    this.originUrl = agentHomeUrl.trim();
    this.agentId = agentId;
  }

  /** 获取当前 WebSocket 的 URL，供上传等 HTTP 接口从同一 host 构建请求 */
  public getWsUrl(): string {
    return this.url;
  }

  public getOriginUrl(): string {
    return this.originUrl;
  }

  /** 简单的 uuid 实现，优先使用 crypto.randomUUID */
  private uuid(): string {
    if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) {
      return (crypto as any).randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /** URL 是否为 ws / wss */
  private isValidWsUrl(s: string): boolean {
    const t = (s || '').trim();
    return t.startsWith('ws://') || t.startsWith('wss://');
  }

  /** 对外暴露：确保已经完成 connect/hello-ok 握手 */
  public ensureConnected(isReconnect = false): Promise<void> {
    if (this.ready && this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (this.readyPromise) {
      return this.readyPromise;
    }

    if (!this.isValidWsUrl(this.url)) {
      return Promise.reject(new Error('Invalid WebSocket URL'));
    }

    if (!this.token && !this.password) {
      return Promise.reject(new Error('Token or password is required for WebSocket connect'));
    }

    // 仅在非重连时才重置重连状态（重连时保持计数器）
    if (!isReconnect) {
      this.manualClose = false;
      this.reconnectAttempts = 0;
    }

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;

      this.connectInternal().catch((err) => {
        this.cleanupReadyPromise();
        reject(err);
      });
    });

    return this.readyPromise.then(() => {
      if (this.onConnectedCallback) {
        this.onConnectedCallback();
      }
    });
  }

  /** 发送聊天请求，消费 chat 事件流 */
  public sendChat(message: string, options: SendChatOptions): { promise: Promise<void>; cancel: () => void } {
    const { sessionKey, onChunk, timeoutMs } = options;

    let cancelled = false;

    const promise = new Promise<void>((resolve, reject) => {
      this.ensureConnected()
        .then(() => {
          if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            reject(new Error('WebSocket not open'));
            return;
          }

          // 会话键处理：
          // - 如果网关提供了 sessionDefaults.mainSessionKey，则优先使用该值；
          // - 否则退回到 "main"（与 openclaw UI 默认行为一致）；
          // - 再通过 normalizeSessionKey 做别名归一化，确保与 Control UI 历史记录对齐。
          const rawSessionKey = sessionKey ?? this.sessionDefaults?.mainSessionKey ?? 'main';
          const resolvedSessionKey = this.normalizeSessionKey(rawSessionKey);

          const id = this.uuid();
          const frame = {
            type: 'req',
            id,
            method: 'chat.send',
            params: {
              deliver: false,
              sessionKey: resolvedSessionKey,
              message,
              idempotencyKey: id,
            },
          };

          // 注册当前 chat 流监听
          this.currentChatHandler = (payload, phase) => {
            if (cancelled) return;
            try {
              onChunk(payload, phase);
            } catch (e) {
              // 避免应用层回调抛错导致整个链接中断
              // eslint-disable-next-line no-console
              console.error('onChunk error', e);
            }
          };
          this.currentChatResolve = () => {
            if (cancelled) return;
            resolve();
          };
          this.currentChatReject = (err) => {
            if (cancelled) return;
            reject(err);
          };

          try {
            this.ws.send(JSON.stringify(frame));
          } catch (e) {
            this.clearCurrentChat();
            reject(e);
          }

          // 可选的本地超时，仅用于兜底
          if (timeoutMs && timeoutMs > 0) {
            window.setTimeout(() => {
              if (cancelled) return;
              cancelled = true;
              this.clearCurrentChat();
              reject(new Error('WebSocket chat timeout'));
            }, timeoutMs);
          }
        })
        .catch(reject);
    });

    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      this.clearCurrentChat();
    };

    return { promise, cancel };
  }

  /**
   * 通用 WebSocket 请求：发送 req 帧，等待对应 id 的 res 帧并返回 payload。
   * 与 openclaw GatewayBrowserClient.request 行为一致。
   */
  public async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.ensureConnected();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not open');
    }
    const id = this.uuid();
    const frame = { type: 'req' as const, id, method, params };
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
    });
    try {
      this.ws.send(JSON.stringify(frame));
    } catch (e) {
      this.pending.delete(id);
      throw e;
    }
    return p;
  }

  /**
   * 拉取聊天历史，与 openclaw UI chat.history 一致。
   * sessionKey 会经 mainSessionKey 与别名归一化，确保与 Control UI 同一会话。
   */
  public async loadHistory(sessionKey?: string, limit = 200): Promise<ChatHistoryPayload> {
    const rawKey = sessionKey ?? this.sessionDefaults?.mainSessionKey ?? 'main';
    const resolvedSessionKey = this.normalizeSessionKey(rawKey);
    const payload = await this.request<ChatHistoryPayload>('chat.history', {
      sessionKey: resolvedSessionKey,
      limit: Math.min(1000, Math.max(1, limit)),
    });
    return {
      sessionKey: payload?.sessionKey ?? resolvedSessionKey,
      sessionId: payload?.sessionId ?? null,
      messages: Array.isArray(payload?.messages) ? payload.messages : [],
      thinkingLevel: payload?.thinkingLevel ?? null,
      verboseLevel: payload?.verboseLevel ?? null,
    };
  }

  /** 主动关闭连接 */
  public close(code = 1000, reason = 'user disconnect'): void {
    if (this.challengeFallbackTimer !== null) {
      window.clearTimeout(this.challengeFallbackTimer);
      this.challengeFallbackTimer = null;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // 主动关闭时设置标记，onclose 中不再触发自动重连
    this.manualClose = true;
    this.reconnectAttempts = 0;
    this.ready = false;
    if (this.ws) {
      try {
        this.ws.close(code, reason);
      } catch (e) {
        // ignore
      }
    }
    this.ws = null;
    this.clearCurrentChat();
    this.rejectAllPending(new Error('WebSocket closed'));
    this.cleanupReadyPromise();
  }

  /** 将 WebSocket chat 事件结构转换成 SSE 兼容结构 */
  public static toSsePayloadFromChat(
    payload: any,
    phase: ChatPhase
  ): {
    sseRes: any;
    sseMsg: { data: string; event: string; id: string };
  } {
    const safePayload = payload || {};
    const { state } = safePayload;
    const text = safePayload.data?.delta || '';

    const id = getMsgId?.() || '';
    const data = JSON.stringify(safePayload);

    const isErrorPhase = phase === 'error' || state === 'error';
    const isFinalLike = phase === 'final' || phase === 'aborted' || state === 'final' || state === 'aborted';

    if (isErrorPhase) {
      const sseRes = {
        message: {
          contentType: SSEMessageType.error,
          content: {
            substance: {
              msg: safePayload.errorMessage || text || 'WebSocket error',
              traceback: '',
            },
          },
          status: SSEEventStatus.done,
        },
      };

      const sseMsg = {
        data,
        event: 'error',
        id,
      };

      return { sseRes, sseMsg };
    }

    const sseRes = {
      message: {
        contentType: SSEMessageType.text,
        content: {
          substance: text,
        },
        status: isFinalLike ? SSEEventStatus.done : SSEEventStatus.query,
      },
    };

    const sseMsg = {
      data,
      // 对于 aborted，我们也视为一次「自然结束」，只是在 payload.state 中保留 aborted 供上层区分。
      event: isFinalLike ? 'answerEnd' : 'answerDelta',
      id,
    };

    return { sseRes, sseMsg };
  }

  /** 内部：真正发起 WebSocket 连接并完成 connect 流程 */
  private async connectInternal(): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.connectSent = false;
    this.pending.clear();

    try {
      this.ws = new WebSocket(`${this.url}?token=${this.token}&ip=${this.ip}&port=${this.port}`);
    } catch (e) {
      console.error('OpenClaw websocket connect error', e);
      throw e;
    }

    this.ws.onopen = () => {
      // 等待 connect.challenge 事件，2s 后兜底直接发 connect
      if (this.challengeFallbackTimer !== null) {
        window.clearTimeout(this.challengeFallbackTimer);
      }
      this.challengeFallbackTimer = window.setTimeout(() => {
        this.challengeFallbackTimer = null;
        if (!this.connectSent && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.sendConnect();
        }
      }, 2000);
    };

    this.ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') return;
      let obj: any;
      try {
        obj = JSON.parse(ev.data);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Invalid WebSocket JSON frame', e);
        return;
      }

      const type = obj && obj.type;
      if (type === 'event') {
        const { event } = obj;
        // WebSocket 事件分为两类：
        // - event = "agent"：包含 assistant/lifecycle 等流，数据中带增量 delta（或 text）与 phase。
        // - event = "chat"：网关基于 agent 事件聚合出的会话级事件，state = delta/final/aborted/error。
        //
        // 由于当前业务需要使用 payload.data.delta 的增量内容，这里优先消费 "agent" 事件，
        // 将其转换为 chat 事件兼容结构后复用 handleChatEvent；同时也兼容 "chat" 事件的直接处理。
        if (event === 'agent') {
          this.handleAgentEvent(obj.payload);
          return;
        }
        if (event === 'chat') {
          this.handleChatEvent(obj.payload);
          return;
        }
        if (event === 'connect.challenge') {
          // 按 demo 行为，只记录 challenge 出现并立即发送 connect
          this.sendConnect();
          return;
        }
        return;
      }

      if (type === 'res') {
        const { id } = obj;
        const pendingReq = this.pending.get(id);
        if (pendingReq) {
          this.pending.delete(id);
          if (obj.ok) {
            pendingReq.resolve(obj.payload);
          } else {
            pendingReq.reject(new Error(obj.error?.message || 'request failed'));
          }
        }

        if (obj.ok && obj.payload && obj.payload.type === 'hello-ok') {
          // 缓存会话默认信息（如 mainSessionKey），用于后续会话键归一化
          const snapshot = (obj.payload as any).snapshot as
            | {
                sessionDefaults?: {
                  defaultAgentId?: string;
                  mainKey?: string;
                  mainSessionKey?: string;
                  scope?: string;
                };
              }
            | undefined;
          if (snapshot?.sessionDefaults) {
            this.sessionDefaults = snapshot.sessionDefaults;
          }

          // 握手成功后重置重连状态
          this.reconnectAttempts = 0;
          this.manualClose = false;
          if (this.reconnectTimer !== null) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }

          this.ready = true;
          if (this.readyResolve) {
            this.readyResolve();
          }
          this.cleanupReadyPromise(true);
        }
      }
    };

    this.ws.onclose = () => {
      if (this.challengeFallbackTimer !== null) {
        window.clearTimeout(this.challengeFallbackTimer);
        this.challengeFallbackTimer = null;
      }
      this.ready = false;
      this.clearCurrentChat();
      this.rejectAllPending(new Error('WebSocket closed'));
      this.cleanupReadyPromise();
      this.ws = null;
    };

    this.ws.onerror = (error) => {
      // 错误细节在 close 中体现，这里只做兜底和触发自动重连
      // 仅当不是手动关闭时才尝试重连
      // eslint-disable-next-line no-console
      console.error('OpenClaw webSocket error', error);
      this.scheduleReconnect();
    };
  }

  /** 发送 connect 请求，完成握手 */
  private sendConnect(): void {
    if (this.connectSent || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.connectSent = true;

    const auth =
      this.token || this.password
        ? {
          token: this.token || undefined,
          password: this.password || undefined,
        }
        : undefined;

    const params = {
      minProtocol: OpenClawWebSocketClient.PROTOCOL_VERSION,
      maxProtocol: OpenClawWebSocketClient.PROTOCOL_VERSION,
      client: {
        id: OpenClawWebSocketClient.CLIENT_ID,
        version: '1.0.0',
        platform: 'web',
        mode: OpenClawWebSocketClient.CLIENT_MODE,
      },
      role: 'operator',
      scopes: ['operator.admin'],
      auth,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      locale: typeof navigator !== 'undefined' ? navigator.language : 'zh-CN',
    };

    const id = this.uuid();
    const frame = {
      type: 'req' as const,
      id,
      method: 'connect',
      params,
    };

    const p = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    try {
      this.ws.send(JSON.stringify(frame));
    } catch (e) {
      this.pending.delete(id);
      if (this.readyReject) {
        this.readyReject(e);
      }
      this.cleanupReadyPromise();
      return;
    }

    p.catch((err) => {
      if (this.readyReject) {
        this.readyReject(err);
      }
      this.cleanupReadyPromise();
    });
  }

  private handleChatEvent(payload: any): void {
    if (!this.currentChatHandler) return;
    const state = payload?.state;
    let phase: ChatPhase = 'delta';
    if (state === 'final') {
      phase = 'final';
    } else if (state === 'error') {
      phase = 'error';
    } else if (state === 'aborted') {
      phase = 'aborted';
    }

    this.currentChatHandler(payload, phase);

    if (phase === 'final' || phase === 'aborted') {
      if (this.currentChatResolve) {
        this.currentChatResolve();
      }
      this.clearCurrentChat();
    }

    if (phase === 'error') {
      if (this.currentChatReject) {
        this.currentChatReject(new Error(payload?.errorMessage || 'WebSocket chat error'));
      }
      this.clearCurrentChat();
    }
  }

  /**
   * 处理 Gateway 的 agent 事件，并转换为 chat 事件兼容结构，再复用 handleChatEvent：
   * - stream = "assistant"：使用 data.delta（或 data.text）作为增量内容，映射为 state = "delta"
   * - stream = "lifecycle"：使用 data.phase：
   *   - "end"   → state = "final"
   *   - "error" → state = "error"，并尝试携带 errorMessage
   */
  private handleAgentEvent(payload: any): void {
    if (!payload) return;
    const { stream, data: rawData, sessionKey, runId } = payload;
    const data = rawData || {};

    if (stream === 'assistant') {
      const text = (typeof data.delta === 'string' && data.delta) || (typeof data.text === 'string' && data.text) || '';
      if (!text) {
        return;
      }
      const chatLike = {
        runId,
        sessionKey,
        state: 'delta',
        data: {
          delta: text,
        },
      };
      this.handleChatEvent(chatLike);
      return;
    }

    if (stream === 'lifecycle') {
      const phase = typeof data.phase === 'string' ? data.phase : '';
      if (phase === 'end') {
        const chatLike = {
          runId,
          sessionKey,
          state: 'final',
        };
        this.handleChatEvent(chatLike);
        return;
      }
      if (phase === 'error') {
        const errorMessage =
          (typeof data.errorMessage === 'string' && data.errorMessage) ||
          (typeof data.error === 'string' && data.error) ||
          undefined;
        const chatLike = {
          runId,
          sessionKey,
          state: 'error',
          errorMessage,
        };
        this.handleChatEvent(chatLike);
      }
    }
  }

  private clearCurrentChat(): void {
    this.currentChatHandler = null;
    this.currentChatResolve = null;
    this.currentChatReject = null;
  }

  private rejectAllPending(err: Error): void {
    this.pending.forEach((p) => {
      try {
        p.reject(err);
      } catch {
        // ignore
      }
    });
    this.pending.clear();
  }

  private cleanupReadyPromise(success = false): void {
    if (!success && this.readyResolve) {
      // 如果失败但已经调用 resolve，则不再重复
    }
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
  }

  /**
   * 将会话键归一化为网关实际使用的 mainSessionKey：
   * - 当 hello-ok.snapshot 提供了 sessionDefaults 时，按照 openclaw UI 中的
   *   normalizeSessionKeyForDefaults 规则处理别名：
   *   - "main"
   *   - mainKey（默认为 "main"）
   *   - agent:{defaultAgentId}:main
   *   - agent:{defaultAgentId}:{mainKey}
   *   均会被映射为 mainSessionKey；
   * - 其它值保持不变。
   */
  private normalizeSessionKey(raw: string): string {
    const value = (raw || '').trim();
    const defaults = this.sessionDefaults;
    const mainSessionKey = defaults?.mainSessionKey?.trim();
    if (!mainSessionKey) {
      return value;
    }
    if (!value) {
      return mainSessionKey;
    }
    const mainKey = defaults?.mainKey?.trim() || 'main';
    const defaultAgentId = defaults?.defaultAgentId?.trim();
    const isAlias =
      value === 'main' ||
      value === mainKey ||
      (defaultAgentId && (value === `agent:${defaultAgentId}:main` || value === `agent:${defaultAgentId}:${mainKey}`));
    return isAlias ? mainSessionKey : value;
  }

  public setRealSessionId(sessionId: string): void {
    this.realSessionId = sessionId;
  }

  public getRealSessionId(): string {
    return this.realSessionId;
  }

  /**
   * 设置重连失败回调
   */
  public setOnReconnectFailed(callback: () => void): void {
    this.onReconnectFailed = callback;
  }

  public setOnConnected(callback: () => void): void {
    this.onConnectedCallback = callback;
  }

  /**
   * 异常关闭后的自动重连逻辑：
   * - 最多重连 maxReconnectAttempts 次
   * - 使用简单的线性退避：1s, 2s, 3s...
   * - 仅在非手动关闭时生效
   */
  private scheduleReconnect(): void {
    if (this.manualClose) {
      return;
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // 超出最大重连次数，不再继续重连
      // 如果外层有人在等待 ensureConnected 的 readyPromise，则给一个明确错误
      if (this.readyReject) {
        this.readyReject(new Error('WebSocket reconnect attempts exceeded'));
      }
      // 触发重连失败回调
      if (this.onReconnectFailed) {
        this.onReconnectFailed();
      }
      this.cleanupReadyPromise();
      return;
    }

    this.reconnectAttempts += 1;

    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
    }

    // 使用定时器避免立即重连导致的频繁失败
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      // 这里直接复用 ensureConnected 的逻辑，保持与正常首次连接一致
      // 传入 isReconnect: true 以保持重连次数计数器
      this.ensureConnected(true)
        .then(() => {
          if (this.onConnectedCallback) {
            this.onConnectedCallback();
          }
        })
        .catch((err) => {
          // 重连失败后继续尝试下一次，直到达到最大次数
          // eslint-disable-next-line no-console
          console.error('OpenClaw websocket reconnect error', err);
          this.scheduleReconnect();
        });
    }, 10000);
  }
}

/** 全局单例管理 */
let globalClient: OpenClawWebSocketClient | null = null;

/** 初始化或复用全局 WebSocket 客户端 */
export function initOpenClawWebSocket(agentHomeUrl: string, agentId: string): OpenClawWebSocketClient {
  if (globalClient) {
    return globalClient;
  }
  globalClient = new OpenClawWebSocketClient(agentHomeUrl, agentId);
  return globalClient;
}

/** 获取当前全局 WebSocket 客户端实例（可能为 null） */
export function getOpenClawWebSocket(): OpenClawWebSocketClient | null {
  return globalClient;
}

/** 主动销毁全局 WebSocket 客户端并断开连接 */
export function destroyOpenClawWebSocket(): void {
  if (globalClient) {
    globalClient.close(1000, 'user destroy instance');
    globalClient = null;
  }
}
