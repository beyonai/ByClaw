import type { Capability, Dict, ExecutorResponse } from "./types.js";
import { isRecord } from "./types.js";
import { makeError } from "./errors.js";
import { loadJsonSchema, summarizeSchema } from "./schema.js";
import { normalizeResourceType } from "./resource-type.js";

/** Mirror of `BaiYingExecutor.describe_resource`. Returns metadata-only response. */
export function describeResource(params: {
  capability: Capability | null;
  resolvedType: string | null;
  capabilityId: string;
}): ExecutorResponse {
  const { capability } = params;
  if (!capability) {
    return makeError("CAPABILITY_NOT_FOUND", `Capability not found: ${params.capabilityId}`);
  }

  const resType = normalizeResourceType(params.resolvedType ?? capability.resource_type ?? "");
  const discoverySource = capability._discovery_source ?? "unknown";
  const resource: Dict = {
    resource_id: capability.metadata?.resource_id,
    resource_name: capability.name,
    resource_type: capability.resource_type,
    description: capability.description,
    discovery_source: discoverySource,
    executable: resType !== "",
  };
  const actions: Dict[] = [];

  if (resType === "doc") {
    const docInfo = isRecord(capability.doc) ? (capability.doc as Dict) : {};
    resource.dataset_id = String(docInfo.dataset_id ?? "");
    resource.source_resource_id = String(docInfo.dataset_id ?? "");
  } else if (resType === "tool") {
    const tool = isRecord(capability.tool) ? (capability.tool as Dict) : {};
    resource.method = tool.method;
    resource.url = tool.url;
    resource.input_schema = loadJsonSchema(tool.input_schema);
    resource.output_schema = loadJsonSchema(tool.output_schema);
    resource.schema_summary = summarizeSchema(tool.input_schema);
    const inputSchema = loadJsonSchema(tool.input_schema);
    actions.push({
      name: capability.name,
      action_type: "TOOL",
      description: capability.description,
      method: tool.method,
      url: tool.url,
      input_schema: inputSchema,
      output_schema: loadJsonSchema(tool.output_schema),
      schema_summary: summarizeSchema(tool.input_schema),
      required_fields: inputSchema && Array.isArray(inputSchema.required) ? inputSchema.required : [],
    });
  } else if (resType === "toolkit") {
    for (const tool of capability.tools ?? []) {
      const schema = loadJsonSchema(tool.input_schema);
      actions.push({
        name: tool.name,
        action_type: "TOOLKIT_TOOL",
        description: tool.description,
        method: tool.method,
        url: tool.url,
        input_schema: schema,
        output_schema: loadJsonSchema(tool.output_schema),
        schema_summary: summarizeSchema(schema),
        required_fields: schema && Array.isArray(schema.required) ? schema.required : [],
      });
    }
  } else if (resType === "mcp" || resType === "object" || resType === "view") {
    const mcp = isRecord(capability.mcp) ? (capability.mcp as Dict) : {};
    resource.server_url = mcp.server_url;
    resource.mcp_type = mcp.transfer_type;
    resource.transfer_type = mcp.transfer_type;
    resource.resource_code = mcp.resource_code;
    if (isRecord(capability._mcp_live_error)) {
      resource.live_discovery_error = capability._mcp_live_error;
    }
    for (const tool of Array.isArray(mcp.tools) ? (mcp.tools as Dict[]) : []) {
      const schema = loadJsonSchema(tool.input_schema);
      actions.push({
        name: tool.name,
        action_type: "MCP_TOOL",
        description: tool.description,
        input_schema: schema,
        output_schema: loadJsonSchema(tool.output_schema),
        schema_summary: summarizeSchema(schema),
        required_fields: schema && Array.isArray(schema.required) ? schema.required : [],
      });
    }
  } else if (resType === "agent") {
    const agentInfo = isRecord(capability.agent) ? (capability.agent as Dict) : {};
    resource.integration_type = agentInfo.integration_type;
    resource.agent_sse_url = agentInfo.sse_url;
  } else {
    resource.unsupported_reason = `Unknown resource type: ${resType}`;
    resource.executable = false;
  }

  return {
    success: true,
    mode: "metadata",
    data: { resource, actions },
  };
}
