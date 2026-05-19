import type { Dict, ExecutorFailure } from "./types.js";

/** Mirror of `BaiYingExecutor._make_error` in `executor.py`. */
export function makeError(
  code: string,
  message: string | Dict,
  extra: Record<string, unknown> = {},
): ExecutorFailure {
  return { success: false, error_code: code, error: message, ...extra };
}

/** Mirror of `_auth_error`: fixed error_code and standard message. */
export function authError(
  details?: string,
  extra: Record<string, unknown> = {},
): ExecutorFailure {
  return makeError(
    "AUTH_EXPIRED",
    "当前登录状态过期或失效，请重新登录",
    { details, ...extra },
  );
}

const AUTH_ERROR_TOKENS: readonly string[] = [
  "会话已失效",
  "重新登录",
  "登录状态过期",
  "登录状态失效",
  "session expired",
  "unauthorized",
];

/** Mirror of `_is_auth_error_message`. */
export function isAuthErrorMessage(message: string | undefined | null): boolean {
  if (!message) {
    return false;
  }
  const lowered = message.toLowerCase();
  return AUTH_ERROR_TOKENS.some((token) => message.includes(token) || lowered.includes(token));
}
