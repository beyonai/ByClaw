import type { Capability, Dict, ResourceContext } from "./types.js";
import { isRecord } from "./types.js";
import { normalizeResourceId, snapshotPrefixesForFolder } from "./resource-type.js";
import { buildCapabilityFromDetail } from "./capability-builder.js";
import { getSharedRedisJsonStore, resourceRedisKey } from "../redis-json-store.js";

/**
 * Directly read a single resource snapshot by `<resourceType, capabilityId>`.
 *
 * Resolves Redis key `<PREFIX>_<id>` where `PREFIX` is determined by
 * `snapshotPrefixesForFolder` (e.g. `TOOLKIT_`, `KG_DOC_`). No filesystem
 * fallback is used; if Redis has no snapshot, callers must build from
 * `resource_context` or return a minimal stub.
 *
 * Mirrors `_load_capability_details` in the original Python executor.
 */
export async function loadCapabilityDetails(params: {
  /** Deprecated. Retained for the public executor interface; not read. */
  resourcesDir: string;
  capabilityId: string;
  resourceType: string;
  resourceContext?: ResourceContext;
}): Promise<Capability | null> {
  const rawId = normalizeResourceId(params.capabilityId);
  const candidateIds = Array.from(new Set([rawId, String(params.capabilityId ?? "").trim()].filter(Boolean)));
  const prefixes = snapshotPrefixesForFolder(params.resourceType, params.resourceContext);
  if (prefixes.length === 0) return null;

  const store = getSharedRedisJsonStore();
  for (const rid of candidateIds) {
    if (!/^\d+$/.test(rid)) continue;
    for (const prefix of prefixes) {
      const payload = await store.getJsonByKey(resourceRedisKey(prefix, rid));
      const data = isRecord(payload?.raw) ? (payload.raw as Dict) : null;
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
