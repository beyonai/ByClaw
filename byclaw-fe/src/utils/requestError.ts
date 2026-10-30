/** Request interceptors may reject strings; callers also receive Error or API response objects. */
export const getRequestErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'string') return error.trim() || fallback;
  if (!error || typeof error !== 'object') return fallback;
  const value = error as { message?: unknown; msg?: unknown; response?: { data?: { msg?: unknown } } };
  for (const text of [value.response?.data?.msg, value.msg, value.message]) {
    if (typeof text === 'string' && text.trim()) return text.trim();
  }
  return fallback;
};
