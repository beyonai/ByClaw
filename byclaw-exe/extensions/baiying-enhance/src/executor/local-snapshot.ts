import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Capability, Dict, ResourceContext } from "./types.js";
import { isRecord } from "./types.js";
import { normalizeResourceId, snapshotPrefixesForFolder } from "./resource-type.js";
import { buildCapabilityFromDetail } from "./capability-builder.js";

async function readJson(filePath: string): Promise<Dict | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Directly read a single snapshot file by `<resourceType, capabilityId>`.
 *
 * Resolves `<resourcesDir>/<resourceType>/<PREFIX>_<id>.json` where `PREFIX`
 * is determined by `snapshotPrefixesForFolder` (e.g. `TOOLKIT_`, `KG_DOC_`).
 * No in-memory index or full directory scan is performed — every call hits
 * the filesystem for the exact file being requested, which avoids any
 * inconsistency between a cached snapshot and what is currently on disk.
 *
 * Mirrors `_load_capability_details` in the original Python executor.
 */
export async function loadCapabilityDetails(params: {
  resourcesDir: string;
  capabilityId: string;
  resourceType: string;
  resourceContext?: ResourceContext;
}): Promise<Capability | null> {
  const dirPath = path.join(params.resourcesDir, params.resourceType);
  try {
    const stats = await stat(dirPath);
    if (!stats.isDirectory()) return null;
  } catch {
    return null;
  }

  const rawId = normalizeResourceId(params.capabilityId);
  const candidateIds = [rawId, String(params.capabilityId ?? "").trim()].filter(Boolean);
  const prefixes = snapshotPrefixesForFolder(params.resourceType, params.resourceContext);
  if (prefixes.length === 0) return null;

  for (const rid of candidateIds) {
    if (!/^\d+$/.test(rid)) continue;
    for (const prefix of prefixes) {
      const filepath = path.join(dirPath, `${prefix}_${rid}.json`);
      const data = await readJson(filepath);
      if (!data) continue;

      let capability: Dict = data;
      const looksLikeDetail =
        !("metadata" in data) &&
        (data.resourceId !== undefined || data.resourceName !== undefined);
      if (looksLikeDetail) {
        const normalized = buildCapabilityFromDetail({
          resourceId: rid,
          detail: data,
          hintedType: params.resourceType,
          resourceContext: params.resourceContext,
        });
        if (normalized) {
          capability = normalized;
        }
      }
      capability._discovery_source = "local_snapshot";
      return capability as Capability;
    }
  }
  return null;
}
