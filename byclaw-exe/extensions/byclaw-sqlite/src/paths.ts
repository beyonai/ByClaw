import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function getPluginRootDir(): string {
  return pluginRootDir;
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
