const RESOURCE_TYPES = new Set([
  "DIG_EMPLOYEE", "SKILL", "TOOL", "TOOLKIT", "MCP", "MCP_TOOL", "AGENT", "OBJECT", "VIEW",
  "KG_DOC", "KG_DB", "KG_QA", "KG_TERM", "KG_CLOUD",
]);

function normalizeId(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function collectAuthorizedId(value: unknown, out: Set<string>, includeResources = false): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  const parsed = value as Record<string, unknown>;
  const bizType = normalizeId(parsed.resourceBizType || parsed.resourceType).toUpperCase();
  const resourceId = normalizeId(parsed.resourceId || parsed.id || parsed.sourcePkId);
  if (resourceId && (includeResources ? RESOURCE_TYPES.has(bizType) : !bizType || bizType === "DIG_EMPLOYEE")) {
    out.add(resourceId);
  }
}

export function parseAuthorizedIds(payload: Record<string, string>, includeResources = false): Set<string> {
  const out = new Set<string>();
  for (const [field, value] of Object.entries(payload)) {
    const fieldId = normalizeId(field);
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            collectAuthorizedId(item, out, includeResources);
          }
        } else {
          collectAuthorizedId(parsed, out, includeResources);
        }
      } catch {
        // ignore parse failures and continue best-effort extraction.
      }
      continue;
    }
    if (/^\d+$/.test(fieldId) && (includeResources ? RESOURCE_TYPES.has(trimmed.toUpperCase()) : trimmed.toUpperCase() === "DIG_EMPLOYEE")) {
      out.add(fieldId);
    }
  }
  return out;
}
