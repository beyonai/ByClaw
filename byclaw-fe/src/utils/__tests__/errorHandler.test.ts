jest.mock('antd', () => ({
  message: {
    error: jest.fn(),
    warning: jest.fn(),
  },
}));

import { message } from 'antd';
import { ERROR_CODES } from '@/constants/app';
import { ErrorHandler, errorHandler, handleError, handleNetworkError, handleValidationError } from '../errorHandler';

describe('utils/errorHandler', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    errorHandler.clearErrorLog();
    (window as any).umami = undefined;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('returns a singleton instance', () => {
    expect(ErrorHandler.getInstance()).toBe(ErrorHandler.getInstance());
    expect(errorHandler).toBe(ErrorHandler.getInstance());
  });

  it('normalizes Error objects and shows user message', () => {
    const result = handleError(new Error('boom'));

    expect(result).toMatchObject({
      code: ERROR_CODES.SERVER_ERROR,
      message: 'boom',
    });
    expect(message.error).toHaveBeenCalledWith('服务器内部错误，请稍后重试');
  });

  it('passes through AppError objects and shows mapped message', () => {
    const appError = { code: ERROR_CODES.FORBIDDEN, message: 'forbidden' } as any;
    const result = handleError(appError);

    expect(result).toBe(appError);
    expect(message.error).toHaveBeenCalledWith('没有权限执行此操作');
  });

  it('handles network and validation errors', () => {
    const networkResult = handleNetworkError('offline');
    expect(networkResult.code).toBe(ERROR_CODES.NETWORK_ERROR);
    expect(message.error).toHaveBeenCalledWith('网络连接失败，请检查网络设置');

    const validationResult = handleValidationError('email', 'required');
    expect(validationResult).toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'email: required',
    });
    expect(message.warning).toHaveBeenCalledWith('输入数据有误，请检查后重试');
  });

  it('keeps only the latest 500 logs after overflow', () => {
    for (let i = 0; i < 1001; i += 1) {
      handleError(`error-${i}`);
    }

    const log = errorHandler.getErrorLog();
    expect(log).toHaveLength(500);
    expect(log[0].message).toBe('error-501');
    expect(errorHandler.getRecentErrors(2).map((item) => item.message)).toEqual(['error-999', 'error-1000']);
  });

  it('sends errors to monitoring service in production', () => {
    process.env.NODE_ENV = 'production';
    (window as any).umami = { track: jest.fn() };

    handleError('prod-error');

    expect((window as any).umami.track).toHaveBeenCalledWith(
      'error_occurred',
      expect.objectContaining({
        error_code: ERROR_CODES.SERVER_ERROR,
        error_message: 'prod-error',
      })
    );
  });
});
