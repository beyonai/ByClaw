/**
 * 统一错误处理机制
 */
import { message } from 'antd';
import type { AppError } from '../typescript/strict';
import { ERROR_CODES } from '../constants/app';

export class ErrorHandler {
  private static instance: ErrorHandler;

  private errorLog: AppError[] = [];

  private constructor() {}

  public static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  /**
   * 处理API错误
   */
  public handleApiError(error: unknown): AppError {
    const appError = this.normalizeError(error);
    this.logError(appError);
    this.showUserMessage(appError);
    return appError;
  }

  /**
   * 处理网络错误
   */
  public handleNetworkError(error: unknown): AppError {
    const appError: AppError = {
      code: ERROR_CODES.NETWORK_ERROR,
      message: '网络连接失败，请检查网络设置',
      details: { originalError: error },
    };
    this.logError(appError);
    this.showUserMessage(appError);
    return appError;
  }

  /**
   * 处理验证错误
   */
  public handleValidationError(field: string, message: string): AppError {
    const appError: AppError = {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `${field}: ${message}`,
      details: { field },
    };
    this.logError(appError);
    this.showUserMessage(appError);
    return appError;
  }

  /**
   * 标准化错误对象
   */
  private normalizeError(error: unknown): AppError {
    if (this.isAppError(error)) {
      return error;
    }

    if (error instanceof Error) {
      return {
        code: ERROR_CODES.SERVER_ERROR,
        message: error.message,
        stack: error.stack,
        details: { name: error.name },
      };
    }

    if (typeof error === 'string') {
      return {
        code: ERROR_CODES.SERVER_ERROR,
        message: error,
      };
    }

    return {
      code: ERROR_CODES.SERVER_ERROR,
      message: '未知错误',
      details: { originalError: error },
    };
  }

  /**
   * 检查是否为AppError类型
   */
  private isAppError(error: unknown): error is AppError {
    return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
  }

  /**
   * 记录错误日志
   */
  private logError(error: AppError): void {
    this.errorLog.push({
      ...error,
      timestamp: new Date().toISOString(),
    });

    // 限制日志数量，避免内存泄漏
    if (this.errorLog.length > 1000) {
      this.errorLog = this.errorLog.slice(-500);
    }

    // 开发环境下打印到控制台
    if (process.env.NODE_ENV === 'development') {
      console.error('Error logged:', error);
    }

    // 生产环境下可以发送到错误监控服务
    if (process.env.NODE_ENV === 'production') {
      this.sendToErrorService(error);
    }
  }

  /**
   * 显示用户友好的错误消息
   */
  private showUserMessage(error: AppError): void {
    const userMessage = this.getUserFriendlyMessage(error);

    switch (error.code) {
      case ERROR_CODES.UNAUTHORIZED:
        message.error('登录已过期，请重新登录');
        // 可以在这里触发登出逻辑
        break;
      case ERROR_CODES.FORBIDDEN:
        message.error('没有权限执行此操作');
        break;
      case ERROR_CODES.NETWORK_ERROR:
        message.error('网络连接失败，请检查网络设置');
        break;
      case ERROR_CODES.TIMEOUT:
        message.error('请求超时，请稍后重试');
        break;
      case ERROR_CODES.VALIDATION_ERROR:
        message.warning(userMessage);
        break;
      default:
        message.error(userMessage);
    }
  }

  /**
   * 获取用户友好的错误消息
   */
  private getUserFriendlyMessage(error: AppError): string {
    const messageMap: Record<string, string> = {
      [ERROR_CODES.UNAUTHORIZED]: '登录已过期，请重新登录',
      [ERROR_CODES.FORBIDDEN]: '没有权限执行此操作',
      [ERROR_CODES.NOT_FOUND]: '请求的资源不存在',
      [ERROR_CODES.VALIDATION_ERROR]: '输入数据有误，请检查后重试',
      [ERROR_CODES.SERVER_ERROR]: '服务器内部错误，请稍后重试',
      [ERROR_CODES.NETWORK_ERROR]: '网络连接失败，请检查网络设置',
      [ERROR_CODES.TIMEOUT]: '请求超时，请稍后重试',
    };

    return messageMap[error.code] || error.message || '操作失败，请稍后重试';
  }

  /**
   * 发送错误到监控服务
   */
  private sendToErrorService(error: AppError): void {
    // 这里可以集成错误监控服务，如Sentry、Bugsnag等
    try {
      // 示例：发送到自定义错误收集服务
      if (window.umami?.track) {
        window.umami.track('error_occurred', {
          error_code: error.code,
          error_message: error.message,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error('Failed to send error to monitoring service:', e);
    }
  }

  /**
   * 获取错误日志
   */
  public getErrorLog(): AppError[] {
    return [...this.errorLog];
  }

  /**
   * 清空错误日志
   */
  public clearErrorLog(): void {
    this.errorLog = [];
  }

  /**
   * 获取最近的错误
   */
  public getRecentErrors(count: number = 10): AppError[] {
    return this.errorLog.slice(-count);
  }
}

// 导出单例实例
export const errorHandler = ErrorHandler.getInstance();

// 导出便捷方法
export const handleError = (error: unknown) => errorHandler.handleApiError(error);
export const handleNetworkError = (error: unknown) => errorHandler.handleNetworkError(error);
export const handleValidationError = (field: string, message: string) =>
  errorHandler.handleValidationError(field, message);
