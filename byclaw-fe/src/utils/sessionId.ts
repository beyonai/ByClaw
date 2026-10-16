export type SessionIdInput = string | number | null | undefined;

/** Transport IDs may be numeric; application state uses strings. */
export function normalizeSessionId(id: SessionIdInput): string {
  return id === null || id === undefined ? '' : String(id);
}

export function isSameSessionId(left: SessionIdInput, right: SessionIdInput): boolean {
  const sessionId = normalizeSessionId(left);
  return sessionId !== '' && sessionId === normalizeSessionId(right);
}
