import path from "node:path";

export const SESSION_FILES_ROOT = "/by/.sessions";

export function getSessionPathBySessionId(sessionId: string) {
  return path.posix.join(SESSION_FILES_ROOT, sessionId.trim());
}
