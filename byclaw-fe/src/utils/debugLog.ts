/**
 * 统一的调试日志开关。
 *
 * 不绑定 NODE_ENV：线上排查问题时也需要能打开，
 * 因此以「显式开关」为准，默认全部关闭。
 *
 * 开启方式（任一即可，按优先级）：
 *   1. URL 参数：?debug=chat 或 ?debug=chat,ws 或 ?debug=all
 *   2. localStorage：localStorage.setItem('byclaw:debug', 'chat')
 *
 * 关闭：localStorage.removeItem('byclaw:debug') 并去掉 URL 参数。
 */

export const DEBUG_STORAGE_KEY = 'byclaw:debug';

/** 调试域。新增域时在这里登记，避免散落的字符串。 */
export type DebugScope = 'chat' | 'ws' | 'store';

const ALL = 'all';

const readRawScopes = (): string => {
  if (typeof window === 'undefined') return '';
  let raw = '';
  try {
    raw = new URLSearchParams(window.location.search).get('debug') || '';
  } catch {
    raw = '';
  }
  if (raw) return raw;
  try {
    return window.localStorage?.getItem(DEBUG_STORAGE_KEY) || '';
  } catch {
    // Safari 隐私模式下访问 localStorage 会直接抛错。
    return '';
  }
};

/** 当前是否需要输出该调试域的日志。 */
export const isDebugEnabled = (scope: DebugScope): boolean => {
  const scopes = readRawScopes()
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!scopes.length) return false;
  return scopes.includes(ALL) || scopes.includes(scope);
};

/**
 * 输出一条调试日志；未开启对应调试域时是零成本的空操作。
 *
 * payload 用函数形式传入，避免在关闭状态下仍然构造大对象。
 */
export const debugLog = (scope: DebugScope, message: string, payload?: () => unknown): void => {
  if (!isDebugEnabled(scope)) return;
  if (payload) {
    console.info(`[ByClaw][${scope}] ${message}`, payload());
    return;
  }
  console.info(`[ByClaw][${scope}] ${message}`);
};
