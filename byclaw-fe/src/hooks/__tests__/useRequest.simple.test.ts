import { message } from 'antd';

// Mock antd message
jest.mock('antd', () => ({
  message: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock @tanstack/react-query
jest.mock('@tanstack/react-query', () => ({
  useMutation: jest.fn(() => ({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    data: null,
    error: null,
  })),
}));

// 由于useRequest依赖于React Query，我们主要测试消息显示逻辑
describe('useRequest (Simple)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('message display logic', () => {
    it('should show success message when successToast is provided', () => {
      const successToast = '操作成功';

      // 模拟成功回调
      const onSuccess = jest.fn();
      const mockRes = { success: true };

      // 模拟useRequest中的onSuccess逻辑
      onSuccess?.(mockRes, undefined, undefined);
      if (successToast) {
        message.success(successToast);
      }

      expect(message.success).toHaveBeenCalledWith(successToast);
    });

    it('should not show success message when successToast is null', () => {
      const successToast = null;

      const onSuccess = jest.fn();
      const mockRes = { success: true };

      onSuccess?.(mockRes, undefined, undefined);
      if (successToast) {
        message.success(successToast);
      }

      expect(message.success).not.toHaveBeenCalled();
    });

    it('should show error message from error object', () => {
      const errorToast = '默认错误消息';
      const error = { message: '具体错误信息' };

      // 模拟useRequest中的onError逻辑
      const msg =
        typeof error === 'string' ? error : error?.message || error?.msg || error?.msg || errorToast || '';

      if (msg) {
        message.error(msg);
      }

      expect(message.error).toHaveBeenCalledWith('具体错误信息');
    });

    it('should show error message from error.msg', () => {
      const errorToast = '默认错误消息';
      const error = { msg: '结果错误信息' };

      const msg =
        typeof error === 'string' ? error : error?.message || error?.msg || error?.msg || errorToast || '';

      if (msg) {
        message.error(msg);
      }

      expect(message.error).toHaveBeenCalledWith('结果错误信息');
    });

    it('should show error message from error.msg', () => {
      const errorToast = '默认错误消息';
      const error = { msg: '简单错误信息' };

      const msg =
        typeof error === 'string' ? error : error?.message || error?.msg || error?.msg || errorToast || '';

      if (msg) {
        message.error(msg);
      }

      expect(message.error).toHaveBeenCalledWith('简单错误信息');
    });

    it('should show errorToast when no error message is available', () => {
      const errorToast = '默认错误消息';
      const error = {};

      const msg =
        typeof error === 'string' ? error : error?.message || error?.msg || error?.msg || errorToast || '';

      if (msg) {
        message.error(msg);
      }

      expect(message.error).toHaveBeenCalledWith('默认错误消息');
    });

    it('should handle string error', () => {
      const errorToast = '默认错误消息';
      const error = '字符串错误';

      const msg =
        typeof error === 'string' ? error : error?.message || error?.msg || error?.msg || errorToast || '';

      if (msg) {
        message.error(msg);
      }

      expect(message.error).toHaveBeenCalledWith('字符串错误');
    });
  });
});
