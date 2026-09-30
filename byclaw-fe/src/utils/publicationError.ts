/** 请求层可能拒绝字符串，也可能抛出 Error；保留发布接口返回的具体原因。 */
export function publicationErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; msg?: unknown; response?: { data?: { msg?: unknown } } };
    for (const text of [value.response?.data?.msg, value.msg, value.message]) {
      if (typeof text === 'string' && text.trim()) return text;
    }
  }
  return fallback;
}
