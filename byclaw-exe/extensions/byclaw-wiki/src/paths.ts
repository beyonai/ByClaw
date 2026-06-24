import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function getPluginRootDir(): string {
  return pluginRootDir;
}

export function resolveOpenClawStateDir(): string {
  const raw = process.env.OPENCLAW_STATE_DIR?.trim();
  if (!raw) {
    return path.join(homedir(), ".openclaw");
  }
  return expandPath(raw);
}

export function expandPath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("~")) {
    return path.join(homedir(), trimmed.slice(1));
  }
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  return path.resolve(trimmed);
}

export function resolveDefaultDataDir(): string {
  return path.join(resolveOpenClawStateDir(), "byclaw-wiki");
}

export function resolveDataPath(dataDir: string, raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("~") || path.isAbsolute(trimmed)) {
    return expandPath(trimmed);
  }
  return path.resolve(dataDir, trimmed);
}

export function sanitizePathSegment(raw: string): string {
  const sanitized = raw.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return sanitized || "repository";
}
