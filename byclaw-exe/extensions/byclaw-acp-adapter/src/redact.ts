const SENSITIVE_KEY_RE =
  /authorization|x-api-key|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|password|passwd|credential|headers/i;

export function redactSensitiveJson<T>(value: T): T {
  return redactValue(value, "") as T;
}

function redactValue(value: unknown, key: string): unknown {
  if (SENSITIVE_KEY_RE.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, ""));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    output[childKey] = redactValue(childValue, childKey);
  }
  return output;
}
