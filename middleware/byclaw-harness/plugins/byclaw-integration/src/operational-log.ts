/** Remove credentials and credential-bearing URLs before records reach stdout. */
export function sanitizeByClawOperationalLog(value: unknown): string {
  return String(value)
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/giu, '[REDACTED_URL]')
    .replace(
      /(["'])([a-z0-9_-]*(?:token|authorization|password|secret|api[-_]?key)[a-z0-9_-]*)\1\s*:\s*(["'])(?:Bearer\s+)?[^"']*\3/giu,
      '$1$2$1:$3[REDACTED]$3',
    )
    .replace(
      /\b([a-z0-9_-]*authorization[a-z0-9_-]*)\b(\s*[:=]\s*)[^\r\n;]+/giu,
      '$1$2[REDACTED]',
    )
    .replace(
      /\b([a-z0-9_-]*(?:token|authorization|password|secret|api[-_]?key)[a-z0-9_-]*)\b(\s*[:=]\s*)["']?(?:Bearer\s+)?[^\s,;}"']+/giu,
      '$1$2[REDACTED]',
    )
}
