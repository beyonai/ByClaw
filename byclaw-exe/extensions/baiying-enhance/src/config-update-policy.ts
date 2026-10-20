import { isDeepStrictEqual } from "node:util";

export type RuntimeConfigUpdateClassification = {
  safe: boolean;
  changedPaths: string[];
  reason?: string;
};

const SAFE_CONFIG_PREFIXES = ["agents", "models", "skills", "meta", "secrets.providers"];

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function matchesPrefix(path: readonly string[], prefix: string): boolean {
  return prefix.split(".").every((segment, index) => path[index] === segment);
}

/** Arrays are one config path; added/removed objects must still expose every leaf. */
function collectChangedPaths(before: unknown, after: unknown, path: string[], paths: string[][]): void {
  if (isDeepStrictEqual(before, after)) return;
  const beforeRecord = isRecord(before) ? before : undefined;
  const afterRecord = isRecord(after) ? after : undefined;
  if (
    (beforeRecord && afterRecord) ||
    (before === undefined && afterRecord) ||
    (after === undefined && beforeRecord)
  ) {
    const keys = [...new Set([...Object.keys(beforeRecord ?? {}), ...Object.keys(afterRecord ?? {})])].sort();
    if (keys.length === 0) {
      paths.push(path);
      return;
    }
    for (const key of keys) {
      collectChangedPaths(beforeRecord?.[key], afterRecord?.[key], [...path, key], paths);
    }
    return;
  }
  paths.push(path);
}

function resolveReloadMode(config: Record<string, unknown>): unknown {
  const gateway = config.gateway;
  if (gateway === undefined) return "hybrid";
  if (!isRecord(gateway)) return null;
  const reload = gateway.reload;
  if (reload === undefined) return "hybrid";
  if (!isRecord(reload)) return null;
  return reload.mode === undefined ? "hybrid" : reload.mode;
}

/**
 * This is the audited OpenClaw 2026.7.1 deployment allowlist, not a reload acknowledgement.
 * That host version has no public API exposing other plugins' registerReload declarations.
 * A controlled deployment must therefore exclude plugins overriding these ordinary paths.
 * Custom configSyncHotPluginEntriesPrefixes never expand this allowlist.
 * Production callers must pass the actual runtime version; config meta is not that version.
 */
export function classifyRuntimeConfigUpdate(params: {
  before: unknown;
  after: unknown;
  runtimeVersion?: string;
}): RuntimeConfigUpdateClassification {
  const changedPaths: string[] = [];
  if (!isRecord(params.before) || !isRecord(params.after)) {
    return { safe: false, changedPaths, reason: "Config must be a plain object" };
  }
  const changedPathSegments: string[][] = [];
  collectChangedPaths(params.before, params.after, [], changedPathSegments);
  changedPaths.push(...changedPathSegments.map((segments) => segments.join(".")));
  if (params.runtimeVersion !== undefined && !/^2026\.7\.1(?:[-+][0-9A-Za-z.+-]+)?$/.test(params.runtimeVersion)) {
    return { safe: false, changedPaths, reason: "OpenClaw runtime version has not been audited for safe updates" };
  }
  if (changedPaths.length === 0) return { safe: true, changedPaths };

  // restart mode upgrades even ordinary model/agent hot plans into gateway restarts.
  const mode = resolveReloadMode(params.after);
  if (mode !== "hybrid" && mode !== "hot") {
    return { safe: false, changedPaths, reason: "Gateway reload mode must be hot or hybrid" };
  }
  for (const key of ["agents", "models", "skills", "meta", "secrets"]) {
    for (const config of [params.before, params.after]) {
      if (config[key] !== undefined && !isRecord(config[key])) {
        return { safe: false, changedPaths, reason: `Unsupported config shape: ${key}` };
      }
    }
  }
  for (const path of changedPathSegments) {
    if (matchesPrefix(path, "models.pricing")) {
      return { safe: false, changedPaths, reason: "Model pricing changes require a gateway restart" };
    }
    if (!SAFE_CONFIG_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) {
      return { safe: false, changedPaths, reason: `Config path requires deferred reload: ${path.join(".")}` };
    }
  }
  return { safe: true, changedPaths };
}
