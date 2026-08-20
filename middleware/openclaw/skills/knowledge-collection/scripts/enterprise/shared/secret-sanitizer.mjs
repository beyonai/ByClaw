const SENSITIVE_KEY = /(token|cookie|secret|password|authorization|credential|device[_-]?code)/i;

function transform(value, ancestors, removeKeys) {
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError('cannot sanitize circular structure');
    ancestors.add(value);
    const sanitized = value.map((item) => transform(item, ancestors, removeKeys));
    ancestors.delete(value);
    return sanitized;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}'))
      || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object') {
          return JSON.stringify(transform(parsed, ancestors, removeKeys));
        }
      } catch (error) {
        if (error instanceof TypeError && /circular/i.test(error.message)) throw error;
      }
    }
    return value;
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (ancestors.has(value)) throw new TypeError('cannot sanitize circular structure');
  ancestors.add(value);
  const sanitized = Object.fromEntries(Object.entries(value)
    .filter(([key]) => !removeKeys || !SENSITIVE_KEY.test(key))
    .map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : transform(item, ancestors, removeKeys),
    ]));
  ancestors.delete(value);
  return sanitized;
}

export function sanitizeSensitive(value) {
  return transform(value, new WeakSet(), false);
}

export function removeSensitiveFields(value) {
  return transform(value, new WeakSet(), true);
}
