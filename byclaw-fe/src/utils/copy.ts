import { message } from 'antd';

/**
 * 传统复制方法（降级方案）
 */
const fallbackCopyTextToClipboard = (text: string, onSuccess?: () => void, onError?: (error: Error) => void): void => {
  const textArea = document.createElement('textarea');
  textArea.value = text;

  // 设置样式避免影响页面
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  textArea.style.opacity = '0';
  textArea.style.pointerEvents = 'none';

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    const successful = document.execCommand('copy');
    if (successful) {
      onSuccess?.();
    } else {
      const error = new Error('execCommand 复制失败');
      onError?.(error);
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error('复制过程中发生错误');
    onError?.(error);
  } finally {
    document.body.removeChild(textArea);
  }
};

/**
 * 复制文本到剪贴板
 * @param text 要复制的文本
 * @param onSuccess 成功回调
 * @param onError 错误回调
 */
export const copyTextToClipboard = (
  text: string,
  onSuccess?: () => void,
  onError?: (error: Error) => void
): Promise<void> => {
  return new Promise((resolve) => {
    // 优先使用现代 Clipboard API
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          onSuccess?.();
          resolve();
        })
        .catch((error) => {
          console.error('Clipboard API 复制失败:', error);
          // 降级到传统方法
          fallbackCopyTextToClipboard(text, onSuccess, onError);
          resolve();
        });
    } else {
      // 降级方案
      fallbackCopyTextToClipboard(text, onSuccess, onError);
      resolve();
    }
  });
};

/**
 * 带提示的复制方法
 */
export const copyWithMessage = async (
  text: string,
  successMessage = '复制成功',
  errorMessage = '复制失败'
): Promise<void> => {
  try {
    await copyTextToClipboard(text);
    // 这里可以集成你的消息提示系统
    message.success(successMessage);
  } catch (error) {
    message.error(errorMessage);
  }
};
