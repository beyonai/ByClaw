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
  if (path.isAbsolute(raw)) {
    return raw;
  }
  if (raw.startsWith("~")) {
    return path.join(homedir(), raw.slice(1));
  }
  return path.resolve(raw);
}

export function resolveDefaultDbPath(): string {
  return path.join(resolveOpenClawStateDir(), "memory", "byclaw.sqlite");
}

export function resolvePluginPath(raw: string): string {
  if (path.isAbsolute(raw)) {
    return raw;
  }
  if (raw.startsWith("~")) {
    return path.join(homedir(), raw.slice(1));
  }
  return path.resolve(pluginRootDir, raw);
}
