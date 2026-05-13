/**
 * WebSocket 相关配置
 */

/**
 * 获取ASR WebSocket连接地址
 * 优先使用Nginx代理地址，如果代理不可用则回退到直连地址
 */
export const getASRWebSocketUrl = (): string => {
  // 使用Nginx代理的WebSocket地址
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const { host } = window.location;

  return `${protocol}//${host}/asr/ws`;
};
