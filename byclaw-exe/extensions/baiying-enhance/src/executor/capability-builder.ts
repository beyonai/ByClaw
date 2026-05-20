import type { Capability, CapabilityTool, Dict, ResourceContext } from "./types.js";
import { asString, isRecord, nonEmptyString } from "./types.js";
import { normalizeCustomHeaders } from "./auth.js";
import { normalizeResourceId, normalizeResourceType } from "./resource-type.js";

/** Mirror of `_base_capability`. */
export function baseCapability(params: {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  description?: string;
  discoverySource: string;
}): Capability {
  return {
    id: `baiying_${params.resourceId}`,
    type: "capability",
    source: "baiying",
    name: params.resourceName || params.resourceId,
    description: params.description || params.resourceName || params.resourceId,
    resource_type: params.resourceType,
    metadata: {
      resource_id: params.resourceId,
    },
    _discovery_source: params.discoverySource,
  };
}

export function selectedResourceContext(rc: ResourceContext | undefined | null): Dict {
  return isRecord(rc?.selected_resource) ? (rc!.selected_resource as Dict) : {};
}

export function rootAgentContext(rc: ResourceContext | undefined | null): Dict {
  return isRecord(rc?.root_agent) ? (rc!.root_agent as Dict) : {};
}

export function getResourceContext(payload: Dict | undefined | null): ResourceContext {
  if (!isRecord(payload)) return {};
  const rc = payload.resource_context;
  return isRecord(rc) ? (rc as ResourceContext) : {};
}

export function extractOpenclawMcpForwardHeaders(
  resourceContext: ResourceContext | undefined | null,
): Record<string, string> {
  if (!isRecord(resourceContext)) return {};
  const raw = resourceContext.openclaw_mcp_headers;
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== "string") continue;
    const key = k.trim();
    if (!key || v === null || v === undefined) continue;
    const value = String(v).trim();
    if (!value) continue;
    out[key] = value;
  }
  return out;
}

function metaContentBlock(detail: Dict, param: Dict | undefined): Dict {
  const raw = (detail.metaContent ?? param?.metaContent) as unknown;
  return isRecord(raw) ? raw : {};
}

/** Mirror of `_resolve_mcp_server_url`. */
export function resolveMcpServerUrl(detail: Dict, param: Dict | undefined): string {
  const p = param ?? {};
  const meta = metaContentBlock(detail, p);
  let raw: string | undefined;
  for (const candidate of [p.mcpServerUrl, detail.mcpServerUrl, meta.mcpServerUrl]) {
    const s = nonEmptyString(candidate);
    if (s) {
      raw = s;
      break;
    }
  }
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw.replace(/\/+$/, "");
  }
  const base = String(detail.domainURL ?? p.domainURL ?? "").replace(/\/+$/, "");
  const rel = raw.startsWith("/") ? raw : `/${raw.replace(/^\/+/, "")}`;
  return base ? `${base}${rel}` : raw;
}

/**
 * Resolve MCP resource URL. MCP snapshots in some environments expose the
 * endpoint as `agentSseUrl` (relative path), while OBJECT/VIEW still use
 * `mcpServerUrl` and should keep existing behavior.
 */
export function resolveMcpResourceServerUrl(detail: Dict, param: Dict | undefined): string {
  const p = param ?? {};
  const meta = metaContentBlock(detail, p);
  let raw: string | undefined;
  for (const candidate of [
    p.agentSseUrl,
    detail.agentSseUrl,
    meta.agentSseUrl,
    meta.agent_sse_url,
    p.mcpServerUrl,
    detail.mcpServerUrl,
    meta.mcpServerUrl,
  ]) {
    const s = nonEmptyString(candidate);
    if (s) {
      raw = s;
      break;
    }
  }
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw.replace(/\/+$/, "");
  }
  const base = String(detail.domainURL ?? p.domainURL ?? "").replace(/\/+$/, "");
  const rel = raw.startsWith("/") ? raw : `/${raw.replace(/^\/+/, "")}`;
  return base ? `${base}${rel}` : raw;
}

/** Resolve AGENT SSE URL; supports relative path + `domainURL`. */
export function resolveAgentSseUrl(detail: Dict, param: Dict | undefined): string {
  const p = param ?? {};
  const meta = metaContentBlock(detail, p);
  let raw: string | undefined;
  for (const candidate of [
    p.agentSseUrl,
    detail.agentSseUrl,
    meta.agentSseUrl,
    meta.agent_sse_url,
  ]) {
    const s = nonEmptyString(candidate);
    if (s) {
      raw = s;
      break;
    }
  }
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw.replace(/\/+$/, "");
  }
  const base = String(detail.domainURL ?? p.domainURL ?? "").replace(/\/+$/, "");
  const rel = raw.startsWith("/") ? raw : `/${raw.replace(/^\/+/, "")}`;
  return base ? `${base}${rel}` : raw;
}

/** Resolve AGENT home URL; supports relative path + `domainURL`. */
export function resolveAgentHomeUrl(detail: Dict, param: Dict | undefined): string {
  const p = param ?? {};
  const meta = metaContentBlock(detail, p);
  let raw: string | undefined;
  for (const candidate of [
    p.agentHomeUrl,
    detail.agentHomeUrl,
    meta.agentHomeUrl,
    meta.agent_home_url,
  ]) {
    const s = nonEmptyString(candidate);
    if (s) {
      raw = s;
      break;
    }
  }
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw.replace(/\/+$/, "");
  }
  const base = String(detail.domainURL ?? p.domainURL ?? "").replace(/\/+$/, "");
  const rel = raw.startsWith("/") ? raw : `/${raw.replace(/^\/+/, "")}`;
  return base ? `${base}${rel}` : raw;
}

/** Mirror of `_resolve_mcp_transfer_type`. */
export function resolveMcpTransferType(detail: Dict, param: Dict | undefined): string {
  const p = param ?? {};
  const meta = metaContentBlock(detail, p);
  const tt =
    p.mcpType ??
    p.mcp_type ??
    p.mcpTransferType ??
    detail.mcpType ??
    detail.mcp_type ??
    detail.mcpTransferType ??
    meta.mcpType ??
    meta.mcp_type ??
    meta.transferType ??
    meta.transfer_type ??
    detail.transferType;
  return tt != null ? String(tt).trim() : "";
}

/** Mirror of `_merge_mcp_resource_headers`. */
export function mergeMcpResourceHeaders(detail: Dict, param: Dict | undefined): Record<string, string> {
  const p = param ?? {};
  const merged: Record<string, string> = {};
  for (const block of [detail.headers, p.headers]) {
    Object.assign(merged, normalizeCustomHeaders(block));
  }
  const extra = normalizeCustomHeaders(p.mcpHeader ?? detail.mcpHeader ?? p.mcpHeaders ?? detail.mcpHeaders);
  Object.assign(merged, extra);
  return merged;
}

/** Mirror of `_merge_resource_context_into_capability`. */
export function mergeResourceContextIntoCapability(
  capability: Capability,
  resourceContext: ResourceContext,
): Capability {
  const selected = selectedResourceContext(resourceContext);
  const rootAgent = rootAgentContext(resourceContext);
  const normalizedType = normalizeResourceType(capability.resource_type);

  if (normalizedType === "doc") {
    const docInfo = (capability.doc ?? ({} as Capability["doc"])) as NonNullable<Capability["doc"]>;
    if (selected.resourceSourcePkId) {
      docInfo.dataset_id = String(selected.resourceSourcePkId);
    }
    capability.doc = docInfo;
    const rc = asString(selected.resourceCode);
    if (rc && !asString(capability.metadata.resource_code)) {
      capability.metadata.resource_code = rc;
    }
  }
  if (normalizedType === "agent") {
    const agentInfo = (capability.agent ?? ({} as Capability["agent"])) as NonNullable<Capability["agent"]>;
    if (!agentInfo.sse_url && rootAgent.agentSseUrl) {
      agentInfo.sse_url = rootAgent.agentSseUrl;
    }
    if (!agentInfo.agent_home_url && rootAgent.agentHomeUrl) {
      agentInfo.agent_home_url = rootAgent.agentHomeUrl;
    }
    if (!agentInfo.integration_type && rootAgent.integrationType) {
      agentInfo.integration_type = rootAgent.integrationType;
    }
    capability.agent = agentInfo;
    const selImpl = asString(selected.implType);
    if (selImpl && !asString(capability.metadata.impl_type)) {
      capability.metadata.impl_type = selImpl;
    }
  }
  if (normalizedType === "mcp" || normalizedType === "object" || normalizedType === "view") {
    const mcpInfo = (capability.mcp ?? ({} as Capability["mcp"])) as NonNullable<Capability["mcp"]>;
    if (!mcpInfo.server_url && selected.mcpServerUrl) {
      mcpInfo.server_url = selected.mcpServerUrl;
    }
    if (!mcpInfo.transfer_type && selected.mcpTransferType) {
      mcpInfo.transfer_type = selected.mcpTransferType;
    }
    if (!mcpInfo.resource_code && selected.resourceCode) {
      mcpInfo.resource_code = selected.resourceCode;
    }
    const merged = normalizeCustomHeaders(selected.mcpHeader ?? selected.mcpHeaders);
    if (Object.keys(merged).length > 0) {
      const existing = normalizeCustomHeaders(mcpInfo.headers ?? {});
      mcpInfo.headers = { ...existing, ...merged };
    }
    capability.mcp = mcpInfo;
  }
  return capability;
}

type BuildFromDetailParams = {
  resourceId: string;
  detail: Dict;
  hintedType?: string;
  resourceContext?: ResourceContext;
};

function resolveToolkitActionUrl(params: {
  rawUrl: unknown;
  pathName?: string;
  toolkitBaseUrl: string;
  openapiServerUrl: string;
}): string {
  const { rawUrl, pathName, toolkitBaseUrl, openapiServerUrl } = params;
  const directUrl = asString(rawUrl);
  if (directUrl.startsWith("http://") || directUrl.startsWith("https://")) {
    return directUrl;
  }

  const path = asString(pathName) || directUrl;
  if (!path) return "";

  if (path.startsWith("/")) {
    if (toolkitBaseUrl) return `${toolkitBaseUrl}${path}`;
    if (openapiServerUrl) return `${openapiServerUrl}${path}`;
    return path;
  }

  if (toolkitBaseUrl) return `${toolkitBaseUrl}/${path.replace(/^\/+/, "")}`;
  if (openapiServerUrl) return `${openapiServerUrl}/${path.replace(/^\/+/, "")}`;
  return path;
}

/**
 * KG_DOC 等资源在部分导出里可能缺少顶层 `domainURL`，但 `resourceService[].openapiSchema.servers[].url`
 * 与顶层地址一致（见 `resources/doc/KG_DOC_*.json`）。用于补全知识服务 base URL。
 */
export function extractKnowledgeServiceBaseUrlFromDocDetail(detail: Dict): string {
  const services = Array.isArray(detail.resourceService) ? (detail.resourceService as unknown[]) : [];
  for (const entry of services) {
    if (!isRecord(entry)) continue;
    const schema = entry.openapiSchema;
    if (!isRecord(schema)) continue;
    const servers = Array.isArray(schema.servers) ? (schema.servers as unknown[]) : [];
    for (const s of servers) {
      if (!isRecord(s)) continue;
      const u = asString(s.url);
      if (u) return u;
    }
  }
  return "";
}

/** Mirror of `_build_capability_from_detail`. */
export function buildCapabilityFromDetail(params: BuildFromDetailParams): Capability | null {
  const { detail } = params;
  let resourceBizType =
    asString(detail.resourceBizType) ||
    asString(detail.resourceType) ||
    asString(params.hintedType) ||
    "";
  if (resourceBizType === "ATOM") resourceBizType = "KG_DOC";
  if (!resourceBizType) return null;

  const capability = baseCapability({
    resourceId: params.resourceId,
    resourceName: asString(detail.resourceName) || params.resourceId,
    resourceType: resourceBizType,
    description:
      asString(detail.resourceDesc) || asString(detail.resourceName) || params.resourceId,
    discoverySource: "baiying_detail",
  });
  const resolvedDomainUrl =
    asString(detail.domainURL) || extractKnowledgeServiceBaseUrlFromDocDetail(detail);
  Object.assign(capability.metadata, {
    system_code: detail.systemCode,
    catalog_name: detail.catalogName,
    owner: detail.manUserName,
    created_at: detail.createTime,
    ...(resolvedDomainUrl ? { domain_url: resolvedDomainUrl } : {}),
  });
  const detailHeaders = normalizeCustomHeaders(detail.headers);
  if (Object.keys(detailHeaders).length > 0) {
    capability.metadata.default_headers = detailHeaders;
  }

  const param = isRecord(detail.param) ? (detail.param as Dict) : {};

  if (resourceBizType === "TOOLKIT") {
    capability.tools = [];
    const toolkitBaseUrl = String(detail.domainURL ?? "").replace(/\/+$/, "");

    let toolEntries: unknown = param.tools;
    if (!Array.isArray(toolEntries) || toolEntries.length === 0) {
      toolEntries = Array.isArray(detail.tools) ? detail.tools : [];
    }

    for (const tool of toolEntries as unknown[]) {
      if (!isRecord(tool)) continue;
      const toolParam = isRecord(tool.param) ? (tool.param as Dict) : {};
      const openapi = isRecord(tool.openAPI) ? (tool.openAPI as Dict) : {};
      const openapiInfo = isRecord(openapi.info) ? (openapi.info as Dict) : {};
      const openapiPaths = isRecord(openapi.paths) ? (openapi.paths as Dict) : {};
      const openapiServers = Array.isArray(openapi.servers) ? (openapi.servers as Dict[]) : [];

      let method = String(toolParam.method ?? tool.method ?? "POST");
      let url: unknown = toolParam.url ?? tool.url;
      let inputSchema: unknown = toolParam.inputSchema ?? tool.inputSchema ?? tool.input_schema;
      let outputSchema: unknown = toolParam.outputSchema ?? tool.outputSchema ?? tool.output_schema;
      let description: unknown = tool.resourceDesc ?? tool.description;
      let name: unknown = tool.resourceName ?? tool.name;

      const pathKeys = Object.keys(openapiPaths);
      if (pathKeys.length > 0) {
        const pathName = pathKeys[0];
        const pathItem = isRecord(openapiPaths[pathName]) ? (openapiPaths[pathName] as Dict) : {};
        const methodKeys = Object.keys(pathItem);
        if (methodKeys.length > 0) {
          const methodName = methodKeys[0];
          const operation = isRecord(pathItem[methodName]) ? (pathItem[methodName] as Dict) : null;
          if (operation) {
            method = String(methodName).toUpperCase();
            let serverUrl = "";
            if (openapiServers.length > 0 && isRecord(openapiServers[0])) {
              serverUrl = String((openapiServers[0] as Dict).url ?? "").replace(/\/+$/, "");
            }
            if (pathName) {
              url = resolveToolkitActionUrl({
                rawUrl: url,
                pathName,
                toolkitBaseUrl,
                openapiServerUrl: serverUrl,
              });
            }
            description = description || operation.description || operation.summary;
            const toolName = isRecord(tool.tool) ? (tool.tool as Dict).toolName : undefined;
            name = name || toolName || openapiInfo.title || operation.summary;
            const requestBody = operation.requestBody;
            if (isRecord(requestBody)) {
              const content = requestBody.content;
              if (isRecord(content)) {
                const jsonContent = content["application/json"];
                const multipartContent = content["multipart/form-data"];
                if (isRecord(jsonContent)) {
                  inputSchema = inputSchema || jsonContent.schema;
                } else if (isRecord(multipartContent)) {
                  inputSchema = inputSchema || multipartContent.schema;
                }
              }
            }
            const responses = operation.responses;
            if (isRecord(responses)) {
              const okResponse = responses["200"];
              if (isRecord(okResponse)) {
                const content = okResponse.content;
                if (isRecord(content)) {
                  const jsonContent = content["application/json"];
                  if (isRecord(jsonContent)) {
                    outputSchema = outputSchema || jsonContent.schema;
                  }
                }
              }
            }
          }
        }
      }

      capability.tools.push({
        name: name || (isRecord(tool.tool) ? (tool.tool as Dict).toolName : undefined),
        description,
        url,
        method,
        input_schema: inputSchema,
        output_schema: outputSchema,
        headers: detailHeaders,
      });
    }

    const pluginMachineInfo = detail.pluginMachineInfo;
    if (Array.isArray(pluginMachineInfo)) {
      const existingKeys = new Set<string>();
      for (const item of capability.tools ?? []) {
        existingKeys.add(
          `${asString(item.name).toLowerCase()}|${asString(item.method).toUpperCase()}|${asString(item.url)}`,
        );
      }
      for (const plugin of pluginMachineInfo) {
        if (!isRecord(plugin)) continue;
        const openapi = plugin.pluginMachineOpenAPI;
        if (!isRecord(openapi)) continue;
        const openapiInfo = isRecord(openapi.info) ? (openapi.info as Dict) : {};
        const openapiPaths = isRecord(openapi.paths) ? (openapi.paths as Dict) : {};
        const openapiServers = Array.isArray(openapi.servers) ? (openapi.servers as Dict[]) : [];

        let serverUrl = "";
        if (openapiServers.length > 0 && isRecord(openapiServers[0])) {
          serverUrl = String((openapiServers[0] as Dict).url ?? "").replace(/\/+$/, "");
        }
        if (!serverUrl) serverUrl = toolkitBaseUrl;

        for (const [pathName, pathItem] of Object.entries(openapiPaths)) {
          if (!isRecord(pathItem)) continue;
          for (const [methodName, operation] of Object.entries(pathItem)) {
            if (!isRecord(operation)) continue;
            const method = String(methodName).toUpperCase();
            if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)) {
              continue;
            }
            const fullUrl = resolveToolkitActionUrl({
              rawUrl: "",
              pathName,
              toolkitBaseUrl,
              openapiServerUrl: serverUrl,
            });
            const name =
              (operation as Dict).summary ||
              (operation as Dict).operationId ||
              openapiInfo.title ||
              pathName.replace(/^\/+|\/+$/g, "");
            const description =
              (operation as Dict).description ||
              (operation as Dict).summary ||
              openapiInfo.description;

            let inputSchema: unknown;
            const requestBody = (operation as Dict).requestBody;
            if (isRecord(requestBody)) {
              const content = requestBody.content;
              if (isRecord(content)) {
                const jsonContent = content["application/json"];
                const multipartContent = content["multipart/form-data"];
                if (isRecord(jsonContent)) {
                  inputSchema = jsonContent.schema;
                } else if (isRecord(multipartContent)) {
                  inputSchema = multipartContent.schema;
                }
              }
            }
            let outputSchema: unknown;
            const responses = (operation as Dict).responses;
            if (isRecord(responses)) {
              const okResponse =
                (responses as Dict)["200"] ||
                (responses as Dict)["201"] ||
                (responses as Dict).default;
              if (isRecord(okResponse)) {
                const content = okResponse.content;
                if (isRecord(content)) {
                  const jsonContent = content["application/json"];
                  if (isRecord(jsonContent)) {
                    outputSchema = jsonContent.schema;
                  }
                }
              }
            }
            const dedupeKey = `${asString(name).toLowerCase()}|${method}|${asString(fullUrl)}`;
            if (existingKeys.has(dedupeKey)) continue;
            existingKeys.add(dedupeKey);
            capability.tools.push({
              name,
              description,
              url: fullUrl,
              method,
              input_schema: inputSchema,
              output_schema: outputSchema,
              headers: detailHeaders,
            });
          }
        }
      }
    }
  } else if (resourceBizType === "TOOL") {
    capability.tool = {
      url: param.url,
      method: param.method ?? "POST",
      input_schema: param.inputSchema ?? param.input_schema,
      output_schema: param.outputSchema ?? param.output_schema,
    };
  } else if (resourceBizType === "AGENT") {
    const meta = metaContentBlock(detail, param);
    const detailHeaders = normalizeCustomHeaders(detail.headers);
    if (Object.keys(detailHeaders).length > 0) {
      capability.metadata.default_headers = detailHeaders;
    }
    capability.agent = {
      sse_url: resolveAgentSseUrl(detail, param),
      agent_home_url: resolveAgentHomeUrl(detail, param),
      integration_type:
        param.integrationType ??
        detail.integrationType ??
        meta.integrationType ??
        meta.agentType ??
        meta.agent_type,
      headers: detailHeaders,
    };
    const implType =
      asString(detail.implType) || asString(param.implType) || asString(meta.implType);
    if (implType) {
      capability.metadata.impl_type = implType;
    }
  } else if (resourceBizType === "MCP" || resourceBizType === "OBJECT" || resourceBizType === "VIEW") {
    const tools: CapabilityTool[] = [];
    const paramTools = Array.isArray(param.tools) ? (param.tools as unknown[]) : [];
    for (const tool of paramTools) {
      if (!isRecord(tool)) continue;
      const toolParam = isRecord(tool.param) ? (tool.param as Dict) : {};
      tools.push({
        name: tool.resourceName ?? tool.name,
        description: tool.resourceDesc ?? tool.description,
        input_schema: toolParam.inputSchema ?? tool.inputSchema ?? tool.input_schema,
        output_schema: toolParam.outputSchema ?? tool.outputSchema ?? tool.output_schema,
      });
    }
    capability.mcp = {
      server_url:
        resourceBizType === "MCP"
          ? resolveMcpResourceServerUrl(detail, param)
          : resolveMcpServerUrl(detail, param),
      transfer_type: resolveMcpTransferType(detail, param),
      resource_code: param.resourceCode ?? detail.resourceCode,
      headers: mergeMcpResourceHeaders(detail, param),
      tools,
    };
  } else if (
    resourceBizType === "KG_DOC" ||
    resourceBizType === "KG_DB" ||
    resourceBizType === "KG_QA"
  ) {
    const selected = selectedResourceContext(params.resourceContext);
    const datasetId =
      selected.resourceSourcePkId ??
      detail.resourceSourcePkId ??
      param.resourceSourcePkId ??
      params.resourceId;
    capability.doc = {
      dataset_id: String(datasetId),
      resource_type_name: detail.resourceTypeName,
    };
    const knCode =
      asString(selected.resourceCode) ||
      asString(param.resourceCode) ||
      asString(detail.resourceCode) ||
      "";
    if (knCode) {
      capability.metadata.resource_code = knCode;
    }
  } else {
    return null;
  }

  return mergeResourceContextIntoCapability(capability, params.resourceContext ?? {});
}

/** Mirror of `_build_capability_from_resource_context`. */
export function buildCapabilityFromResourceContext(
  capabilityId: string,
  resourceType: string | undefined,
  resourceContext: ResourceContext,
): Capability | null {
  const selected = selectedResourceContext(resourceContext);
  const rootAgent = rootAgentContext(resourceContext);
  const resourceId = normalizeResourceId(capabilityId);

  const selectedId = String(selected.resourceId ?? "");
  const selectedType = String(selected.resourceBizType ?? selected.resourceType ?? resourceType ?? "");
  if (selectedId && resourceId && selectedId === resourceId) {
    const normalizedType = normalizeResourceType(selectedType);
    if (normalizedType === "doc") {
      const capability = baseCapability({
        resourceId,
        resourceName: String(selected.resourceName ?? resourceId),
        resourceType: selectedType,
        description: String(selected.resourceDesc ?? selected.resourceName ?? resourceId),
        discoverySource: "resource_context",
      });
      capability.doc = {
        dataset_id: String(selected.resourceSourcePkId ?? resourceId),
        resource_type_name: selected.resourceTypeName,
      };
      if (selected.systemCode) {
        capability.metadata.system_code = selected.systemCode;
      }
      const selDomain = asString(selected.domainURL) || asString(selected.domainUrl);
      if (selDomain) {
        capability.metadata.domain_url = selDomain;
      }
      const selRc = asString(selected.resourceCode) || asString(selected.resource_code);
      if (selRc) {
        capability.metadata.resource_code = selRc;
      }
      return capability;
    }
    if (normalizedType === "view") {
      const capability = baseCapability({
        resourceId,
        resourceName: String(selected.resourceName ?? resourceId),
        resourceType: "VIEW",
        description: String(selected.resourceDesc ?? selected.resourceName ?? resourceId),
        discoverySource: "resource_context",
      });
      capability.mcp = {
        server_url: selected.mcpServerUrl,
        transfer_type: selected.mcpTransferType,
        resource_code: selected.resourceCode,
        headers: normalizeCustomHeaders(selected.mcpHeader ?? selected.mcpHeaders),
        tools: [],
      };
      return capability;
    }
    if (normalizedType === "object") {
      const capability = baseCapability({
        resourceId,
        resourceName: String(selected.resourceName ?? resourceId),
        resourceType: "OBJECT",
        description: String(selected.resourceDesc ?? selected.resourceName ?? resourceId),
        discoverySource: "resource_context",
      });
      capability.mcp = {
        server_url: selected.mcpServerUrl,
        transfer_type: selected.mcpTransferType,
        resource_code: selected.resourceCode,
        headers: normalizeCustomHeaders(selected.mcpHeader ?? selected.mcpHeaders),
        tools: [],
      };
      return capability;
    }
    if (normalizedType === "agent") {
      const capability = baseCapability({
        resourceId,
        resourceName: String(selected.resourceName ?? resourceId),
        resourceType: "AGENT",
        description: String(selected.resourceDesc ?? selected.resourceName ?? resourceId),
        discoverySource: "resource_context",
      });
      const sse = asString(selected.agentSseUrl);
      capability.agent = {
        sse_url: sse,
        agent_home_url: selected.agentHomeUrl,
        integration_type: selected.integrationType,
      };
      const impl = asString(selected.implType);
      if (impl) {
        capability.metadata.impl_type = impl;
      }
      return capability;
    }
  }

  const rootId = String(rootAgent.resourceId ?? "");
  const rootSseUrl = rootAgent.agentSseUrl;
  const rootHomeUrl = rootAgent.agentHomeUrl;
  if (rootId && resourceId && rootId === resourceId && (rootSseUrl || rootHomeUrl)) {
    const capability = baseCapability({
      resourceId,
      resourceName: String(rootAgent.resourceName ?? resourceId),
      resourceType: "AGENT",
      description: String(rootAgent.resourceName ?? resourceId),
      discoverySource: "resource_context",
    });
    capability.agent = {
      sse_url: rootSseUrl,
      agent_home_url: rootHomeUrl,
      integration_type: rootAgent.integrationType,
    };
    return capability;
  }
  return null;
}

/** Mirror of `_build_direct_capability_stub`. */
export function buildDirectCapabilityStub(params: {
  capabilityId: string;
  resourceType?: string;
  resourceContext?: ResourceContext;
}): Capability | null {
  const normalizedType = normalizeResourceType(params.resourceType);
  const resourceId = normalizeResourceId(params.capabilityId);
  if (!resourceId) return null;

  if (normalizedType === "doc") {
    const selected = selectedResourceContext(params.resourceContext);
    const capability = baseCapability({
      resourceId,
      resourceName: String(selected.resourceName ?? resourceId),
      resourceType: "KG_DOC",
      description: String(selected.resourceDesc ?? selected.resourceName ?? resourceId),
      discoverySource: "direct_stub",
    });
    capability.doc = {
      dataset_id: String(selected.resourceSourcePkId ?? resourceId),
    };
    return capability;
  }

  if (normalizedType === "agent") {
    const rootAgent = rootAgentContext(params.resourceContext);
    if (rootAgent.agentSseUrl || rootAgent.agentHomeUrl) {
      const capability = baseCapability({
        resourceId: rootAgent.resourceId ? String(rootAgent.resourceId) : resourceId,
        resourceName: String(rootAgent.resourceName ?? resourceId),
        resourceType: "AGENT",
        description: String(rootAgent.resourceDesc ?? rootAgent.resourceName ?? resourceId),
        discoverySource: "direct_stub",
      });
      capability.agent = {
        sse_url: rootAgent.agentSseUrl,
        agent_home_url: rootAgent.agentHomeUrl,
        integration_type: rootAgent.integrationType,
      };
      return capability;
    }
  }

  if (normalizedType === "object" || normalizedType === "view") {
    const selected = selectedResourceContext(params.resourceContext);
    const capability = baseCapability({
      resourceId,
      resourceName: resourceId,
      resourceType: normalizedType === "object" ? "OBJECT" : "VIEW",
      description: resourceId,
      discoverySource: "direct_stub",
    });
    capability.mcp = {
      server_url: selected.mcpServerUrl,
      transfer_type: selected.mcpTransferType,
      resource_code: selected.resourceCode,
      headers: normalizeCustomHeaders(selected.mcpHeader ?? selected.mcpHeaders),
      tools: [],
    };
    return capability;
  }

  return null;
}
