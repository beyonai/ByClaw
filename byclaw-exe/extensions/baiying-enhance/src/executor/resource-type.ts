import type { Dict, ResourceContext } from "./types.js";
import { asString, isRecord } from "./types.js";

/**
 * Local snapshot folder → acceptable filename prefixes.
 * Mirrors `_SNAPSHOT_PREFIX_BY_FOLDER` in the Python executor.
 */
export const SNAPSHOT_PREFIX_BY_FOLDER: Record<string, readonly string[]> = {
  agent: ["AGENT"],
  toolkit: ["TOOLKIT"],
  tool: ["TOOL"],
  mcp: ["MCP"],
  object: ["OBJECT"],
  view: ["VIEW"],
  doc: ["KG_DOC", "KG_DB", "KG_QA"],
};

export const SNAPSHOT_FOLDERS: readonly string[] = Object.keys(SNAPSHOT_PREFIX_BY_FOLDER);

/** Mirror of `_normalize_resource_type`. Returns a lowercase type label. */
export function normalizeResourceType(resourceType: unknown): string {
  if (!resourceType) {
    return "";
  }
  const normalized = String(resourceType).trim().toUpperCase();
  if (normalized === "DOC" || normalized === "KG_DOC" || normalized === "KG_DB" || normalized === "KG_QA" || normalized === "ATOM") {
    return "doc";
  }
  if (normalized === "AGENT") return "agent";
  if (normalized === "TOOLKIT") return "toolkit";
  if (normalized === "TOOL") return "tool";
  if (normalized === "MCP") return "mcp";
  if (normalized === "OBJECT") return "object";
  if (normalized === "VIEW") return "view";
  return normalized.toLowerCase();
}

/** Mirror of `_normalize_resource_id` (strip leading `baiying_` marker). */
export function normalizeResourceId(capabilityId: unknown): string {
  if (!capabilityId) {
    return "";
  }
  const raw = String(capabilityId).trim();
  return raw.startsWith("baiying_") ? raw.slice("baiying_".length) : raw;
}

/** Mirror of `_doc_snapshot_prefixes`. */
export function docSnapshotPrefixes(resourceContext?: ResourceContext | null): string[] {
  const order = ["KG_DOC", "KG_DB", "KG_QA"];
  if (!resourceContext) {
    return [...order];
  }
  const candidates: string[] = [];
  const block = resourceContext.selected_resource;
  if (isRecord(block)) {
    const t = (block as Dict).resourceType ?? (block as Dict).resourceBizType;
    if (t !== undefined && t !== null) {
      let upper = String(t).trim().toUpperCase();
      if (upper === "DOC" || upper === "ATOM") {
        upper = "KG_DOC";
      }
      if (order.includes(upper) && !candidates.includes(upper)) {
        candidates.push(upper);
      }
    }
  }
  return [...candidates, ...order.filter((item) => !candidates.includes(item))];
}

/** Mirror of `_snapshot_prefixes_for_folder`. */
export function snapshotPrefixesForFolder(
  folder: string,
  resourceContext?: ResourceContext | null,
): string[] {
  if (folder === "doc") {
    return docSnapshotPrefixes(resourceContext);
  }
  return [...(SNAPSHOT_PREFIX_BY_FOLDER[folder] ?? [])];
}

/** Mirror of `_parse_snapshot_filename`. */
export function parseSnapshotFilename(
  filename: string,
  allowedPrefixes: readonly string[],
): { prefix: string; rid: string } | null {
  if (!filename.endsWith(".json") || filename === "_index.json") {
    return null;
  }
  for (const prefix of allowedPrefixes) {
    const head = `${prefix}_`;
    if (!filename.startsWith(head)) {
      continue;
    }
    const rid = filename.slice(head.length, filename.length - ".json".length);
    if (/^\d+$/.test(rid)) {
      return { prefix, rid };
    }
  }
  return null;
}

/** Mirror of `_stub_from_snapshot`. */
export function stubFromSnapshot(prefix: string, rid: string, data: Dict): Dict {
  const name =
    (data.resourceName as unknown) ||
    (data.name as unknown) ||
    `${prefix}_${rid}`;
  const desc = (data.resourceDesc as unknown) || (data.description as unknown) || name;
  return {
    id: rid,
    name: name != null ? asString(name) || String(name) : rid,
    description: desc != null ? asString(desc) || String(desc) : "",
    resource_type: prefix,
  };
}

/** Mirror of `_canonical_header_name`. */
export function canonicalHeaderName(key: string): string {
  const mapping: Record<string, string> = {
    authorization: "Authorization",
    "content-type": "Content-Type",
    accept: "Accept",
    cookie: "Cookie",
    "user-agent": "User-Agent",
    pid: "pid",
    "mcp-session-id": "Mcp-Session-Id",
  };
  const lower = key.toLowerCase();
  if (lower in mapping) {
    return mapping[lower];
  }
  return lower
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join("-");
}
