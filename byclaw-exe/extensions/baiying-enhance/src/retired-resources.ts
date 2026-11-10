/** Keep in sync with the backend RetiredConversationResources policy; no name/description matching. */
export const RETIRED_RESOURCE_TYPES = ["OBJECT", "VIEW", "ONTOLOGY_BASE", "SCENE"] as const;
export const RETIRED_RESOURCE_REASON = "RESOURCE_TYPE_RETIRED";

export function isRetiredResourceType(type: unknown): boolean {
  return RETIRED_RESOURCE_TYPES.some((retired) => retired === String(type ?? "").trim().toUpperCase());
}

export function isRetiredResource(resource: unknown): boolean {
  if (!resource || typeof resource !== "object") return false;
  const item = resource as Record<string, unknown>;
  return [item.resourceBizType, item.resourceType, item.resource_type].some(isRetiredResourceType);
}

export function retiredResourceError() {
  return {
    success: false,
    error_code: RETIRED_RESOURCE_REASON,
    error: "This resource capability has been retired and cannot be queried or executed.",
  };
}
