/**
 * 沙箱动态 URL 全局存储
 * 用于存储 sessionId -> 沙箱基础 URL(协议+域名+端口) 的映射
 * Markdown 中的 {{sandbox_dynamic_url}} 占位符会被替换为该 URL
 */
const sandboxDynamicUrlMap: Record<string, string | ((url: string, dynamicSymbol: string) => string)> = {};

/**
 * 设置指定 sessionId 对应的沙箱动态 URL
 * @param sessionId 会话 ID
 * @param url 沙箱基础 URL（协议+域名+端口）
 */
export function setSandboxDynamicUrl(
  sessionId: string,
  url: string | ((url: string, dynamicSymbol: string) => string)
): void {
  if (sessionId && url) {
    sandboxDynamicUrlMap[sessionId] = url;
  }
}

/**
 * 获取指定 sessionId 对应的沙箱动态 URL
 * @param sessionId 会话 ID
 * @returns 沙箱基础 URL 或 undefined
 */
export function getSandboxDynamicUrl(sessionId: string) {
  return sessionId ? sandboxDynamicUrlMap[sessionId] : undefined;
}
