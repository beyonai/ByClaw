import type { Capability, Dict, ExecutorFailure } from "./types.js";
import { asString, isRecord, nonEmptyString } from "./types.js";
import { normalizeCustomHeaders } from "./auth.js";
import { makeError } from "./errors.js";
import { normalizeResourceType } from "./resource-type.js";

/** Mirror of `_build_ontology_mcp_headers`. */
export function buildOntologyMcpHeaders(capability: Capability): {
  headers: Record<string, string>;
  error: ExecutorFailure | null;
} {
  const normalizedType = normalizeResourceType(capability.resource_type);
  const mcp: Dict = isRecord(capability.mcp) ? (capability.mcp as Dict) : {};
  const headers = normalizeCustomHeaders(mcp.headers);

  if (normalizedType !== "object" && normalizedType !== "view") {
    return { headers, error: null };
  }

  const resourceId = String(
    (capability.metadata?.resource_id as unknown) ?? capability.name ?? "",
  );
  const resourceCode = nonEmptyString(
    mcp.resource_code ??
      (capability.metadata as Dict)?.resource_code ??
      (capability as Dict).resourceCode ??
      (capability as Dict).resource_code,
  );
  if (!resourceCode) {
    return {
      headers,
      error: makeError(
        "RESOURCE_CODE_NOT_FOUND",
        `${asString(capability.resource_type).toUpperCase()} resource is missing resourceCode`,
        {
          target: {
            resource_id: resourceId,
            resource_type: capability.resource_type,
          },
        },
      ),
    };
  }

  headers["x-tool-list-mode"] = "per_object";
  const userCode = process.env.USER_CODE;
  if (userCode) headers["X-User-Id"] = userCode;
  const sessionId = process.env.BAIYING_SESSION;
  if (sessionId) headers["X-Session-Id"] = sessionId;
  if (normalizedType === "object") {
    headers["x-object-id"] = resourceCode;
  } else {
    headers["x-view-id"] = resourceCode;
  }
  return { headers, error: null };
}

/** Debug print gated by BAIYING_MCP_HEADER_DEBUG env. Mirror of `_debug_mcp_session_headers`. */
export function debugMcpSessionHeaders(params: {
  stage: string;
  capability: Capability;
  forwardHeaders: Record<string, string> | undefined;
  ontologyHeaders: Record<string, string> | undefined;
  finalHeaders: Record<string, string> | undefined;
}): void {
  if (process.env.BAIYING_MCP_HEADER_DEBUG !== "1") return;
  const pickInsensitive = (
    h: Record<string, string> | undefined,
    name: string,
  ): string | undefined => {
    if (!h) return undefined;
    const target = name.toLowerCase();
    for (const [key, value] of Object.entries(h)) {
      if (key.toLowerCase() === target) return value;
    }
    return undefined;
  };
  try {
    console.log(
      JSON.stringify({
        type: "baiying_mcp_header_debug",
        stage: params.stage,
        resource_id: String(params.capability.metadata?.resource_id ?? ""),
        resource_type: String(params.capability.resource_type ?? ""),
        forward_x_session_id: pickInsensitive(params.forwardHeaders, "X-Session-Id"),
        ontology_x_session_id: pickInsensitive(params.ontologyHeaders, "X-Session-Id"),
        final_x_session_id: pickInsensitive(params.finalHeaders, "X-Session-Id"),
        // OBJECT / VIEW scoping headers — handy for verifying that datacloud
        // MCP requests carry the correct per-resource identifier.
        final_x_object_id: pickInsensitive(params.finalHeaders, "X-Object-Id"),
        final_x_view_id: pickInsensitive(params.finalHeaders, "X-View-Id"),
        final_x_tool_list_mode: pickInsensitive(params.finalHeaders, "X-Tool-List-Mode"),
      }),
    );
  } catch {
    // ignore logging failures
  }
}
