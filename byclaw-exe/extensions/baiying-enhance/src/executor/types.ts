/**
 * Internal types used by the TypeScript port of `skills/baiying/executor.py`.
 *
 * Field names intentionally mirror the original Python capability dictionary
 * (snake_case keys), so downstream consumers that previously parsed executor
 * JSON output keep working without changes.
 */

export type Dict = Record<string, unknown>;

export type CapabilityMetadata = {
  resource_id: string;
  /** 知识检索 knCode（WHALE_AGENT 等）；与 `dataset_id`/resourceId 可能不同 */
  resource_code?: unknown;
  system_code?: unknown;
  catalog_name?: unknown;
  owner?: unknown;
  created_at?: unknown;
  default_headers?: Record<string, string>;
  impl_type?: string;
  [key: string]: unknown;
};

export type CapabilityTool = {
  name?: unknown;
  description?: unknown;
  url?: unknown;
  method?: unknown;
  input_schema?: unknown;
  output_schema?: unknown;
  headers?: Record<string, string>;
};

export type CapabilityDoc = {
  dataset_id: string;
  resource_type_name?: unknown;
};

export type CapabilityAgent = {
  sse_url?: unknown;
  integration_type?: unknown;
  headers?: Record<string, string>;
};

export type CapabilityMcp = {
  server_url?: unknown;
  transfer_type?: unknown;
  resource_code?: unknown;
  headers?: Record<string, string>;
  tools?: CapabilityTool[];
};

export type Capability = {
  id: string;
  type: "capability";
  source: "baiying";
  name: string;
  description: string;
  resource_type: string;
  metadata: CapabilityMetadata;
  _discovery_source: string;
  _mcp_live_error?: unknown;
  doc?: CapabilityDoc;
  tool?: CapabilityTool;
  tools?: CapabilityTool[];
  agent?: CapabilityAgent;
  mcp?: CapabilityMcp;
  [key: string]: unknown;
};

export type ResourceContext = Dict & {
  root_agent?: Dict;
  selected_resource?: Dict;
  openclaw_mcp_headers?: Dict;
  session_key?: unknown;
  requester_session_key?: unknown;
  channel_session_id?: unknown;
  channel_trace_id?: unknown;
  language?: string;
  beyondToken?: string;
};

export type ExecutorSuccess = { success: true; [k: string]: unknown };
export type ExecutorFailure = {
  success: false;
  error_code: string;
  error: string;
  [k: string]: unknown;
};
export type ExecutorResponse = ExecutorSuccess | ExecutorFailure;

/** Snake-case resource type as normalized for internal branching. */
export type NormalizedResourceType =
  | "doc"
  | "agent"
  | "toolkit"
  | "tool"
  | "mcp"
  | "object"
  | "view"
  | string;

export function isRecord(value: unknown): value is Dict {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function asRecord(value: unknown): Dict | null {
  return isRecord(value) ? value : null;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
