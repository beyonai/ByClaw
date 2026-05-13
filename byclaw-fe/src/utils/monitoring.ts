/* eslint-disable @typescript-eslint/no-explicit-any */
import { isDevelopment } from './common';

/**
 * 轻量异常监控封装
 */
class MonitoringService {
  private static instance: MonitoringService;

  private inited = false;

  private lastErrorSignature?: string;

  private lastErrorAt = 0;

  public static getInstance(): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService();
    }
    return MonitoringService.instance;
  }

  public init() {
    if (this.inited) return;
    this.bindGlobalHandlers();
    this.inited = true;
  }

  public captureException(error: unknown, errorType: string, extra?: Record<string, any>) {
    const now = Date.now();
    let fingerprint = '';
    if (error instanceof Error && error.stack) {
      fingerprint = error.stack;
    }
    if (fingerprint && this.lastErrorSignature === fingerprint && now - this.lastErrorAt < 1000) return;
    this.lastErrorSignature = fingerprint;
    this.lastErrorAt = now;
    try {
      this.reportToBackend({ errorType, error: this.serializeError(error), extra });
    } catch (e) {
      if (isDevelopment()) console.error('[monitor] captureException failed', e);
    }
  }

  private bindGlobalHandlers() {
    // 捕获运行时错误与资源加载错误（使用捕获阶段，因 error 事件不会冒泡）
    window.addEventListener(
      'error',
      (evt: Event) => {
        try {
          if ((evt as any).message !== undefined) {
            // 运行时错误
            const errEvt = evt as unknown as ErrorEvent;
            this.captureException(errEvt.error || errEvt.message, 'RuntimeError', {
              source: errEvt.filename,
              lineno: errEvt.lineno,
              colno: errEvt.colno,
            });
          } else {
            // 资源加载错误（如 script/img/link）
            const target = evt.target as any;
            if (!target) return;
            const tag = (target.localName || target.tagName || '').toLowerCase();
            if (tag !== 'script') {
              // 暂时只记录脚本加载问题
              return;
            }
            const url = target?.src || target?.href || '';
            this.captureException('ResourceLoadError', 'ResourceLoadError', { tag, url });
          }
        } catch (e) {
          //
        }
      },
      true
    );

    // unhandledrejection
    window.addEventListener('unhandledrejection', (event) => {
      try {
        const reason: any = (event && (event as any).reason) || 'unhandledrejection';
        if (reason && typeof reason === 'object' && reason.name === 'CanceledError') {
          // 请求被取消，不记录
          return;
        }
        this.captureException(reason, 'UnhandledRejection');
      } catch (e) {
        //
      }
    });
  }

  private reportToBackend(payload: Record<string, any>): void {
    // 仅生产环境尝试上报，开发环境只打印
    if (isDevelopment()) {
      console.error('[monitor] dev log', payload);
      return; // eslint-disable-line no-useless-return
    }
    const { errorType, error, extra } = payload;
    let errorStack = error.stack;
    if (extra) {
      errorStack = `${error.stack}\n${JSON.stringify(extra)}`;
    }
    fetch('/byaiService/logExceptionInfoController/saveLogExceptionInfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        errorCode: '11000', // 前端异常
        errorModule: 'APP_BY_FE',
        errorMsg: error.message,
        errorStack,
        className: errorType,
      }),
    }).catch(() => undefined);
  }

  private serializeError(error: any) {
    if (!error) return { message: String(error) };
    if (error instanceof Error) {
      return { name: error.name, message: error.message, stack: error.stack };
    }
    if (typeof error === 'object') {
      try {
        return { ...error };
      } catch {
        return { message: '[unserializable object]' };
      }
    }
    return { message: String(error) };
  }
}

export const monitoring = MonitoringService.getInstance();
