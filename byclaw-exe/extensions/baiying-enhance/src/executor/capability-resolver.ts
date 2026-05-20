import type { Capability, CapabilityMcp, ResourceContext } from "./types.js";
import { asString, isRecord } from "./types.js";
import type { AuthContext } from "./auth.js";
import { normalizeCustomHeaders } from "./auth.js";
import { loadCapabilityDetails } from "./local-snapshot.js";
import {
  buildCapabilityFromResourceContext,
  buildDirectCapabilityStub,
  extractOpenclawMcpForwardHeaders,
  mergeResourceContextIntoCapability,
} from "./capability-builder.js";
import { resolveDatacloudMcpServerUrl } from "./datacloud-mcp-url.js";
import { refreshMcpCapability } from "./mcp-client.js";
import {
  SNAPSHOT_FOLDERS,
  normalizeResourceId,
  normalizeResourceType,
} from "./resource-type.js";

type FetchLike = typeof fetch;

/**
 * DOC 能力若从 `resource_context` 构建且缺 `domainURL`（例如仅带 `selected_resource`），WHALE_AGENT
 * 需从本地 `doc/KG_DOC_<id>.json` 补全 `domain_url` / 默认头 / `resource_code`（与 AGENT 快照补齐类似）。
 */
async function hydrateWhaleAgentDocFromSnapshotIfNeeded(params: {
  capability: Capability;
  resourcesDir: string;
  capabilityId: string;
  resourceContext: ResourceContext;
}): Promise<Capability> {
  const c = params.capability;
  if (normalizeResourceType(c.resource_type) !== "doc") return c;
  if (asString(c.metadata?.system_code).toUpperCase() !== "WHALE_AGENT") return c;
  if (asString(c.metadata?.domain_url)) return c;

  const fileCap = await loadCapabilityDetails({
    resourcesDir: params.resourcesDir,
    capabilityId: params.capabilityId,
    resourceType: "doc",
    resourceContext: params.resourceContext,
  });
  if (!fileCap) return c;

  const dom = asString(fileCap.metadata?.domain_url);
  if (dom) {
    c.metadata.domain_url = dom;
  }

  const fileHeaders = normalizeCustomHeaders(fileCap.metadata?.default_headers);
  if (Object.keys(fileHeaders).length > 0) {
    const existing = normalizeCustomHeaders(c.metadata?.default_headers);
    c.metadata.default_headers = { ...fileHeaders, ...existing };
  }

  const frc = asString(fileCap.metadata?.resource_code);
  if (frc && !asString(c.metadata?.resource_code)) {
    c.metadata.resource_code = frc;
  }

  return c;
}

/**
 * Mirror of `_resolve_capability`.
 *
 * Resolution order (OpenClaw baiying-enhance: **Redis snapshot-first**):
 *   1. Direct Redis lookup of `<PREFIX>_<id>` (hinted `resourceType` first,
 *      then other known resource prefixes).
 *   2. Retry the Redis lookup with the `baiying_`-stripped id.
 *   3. Build from `resource_context.selected_resource` / `root_agent` when no snapshot exists.
 *   3b. AGENT only: if the context-built stub has no gateway headers, load
 *        Redis `AGENT_<id>` and replace with the snapshot.
 *   4. Fall back to a minimal stub from `resource_context`.
 */
export async function resolveCapability(params: {
  resourcesDir: string;
  capabilityId: string | null | undefined;
  resourceType: string | null | undefined;
  resourceContext: ResourceContext;
  authContext: AuthContext;
  session?: string;
  fetchImpl?: FetchLike;
}): Promise<{ capability: Capability | null; resolvedType: string | null }> {
  const { capabilityId } = params;
  let resourceType = params.resourceType ?? null;
  const hintedType = normalizeResourceType(resourceType);

  let capability: Capability | null = null;
  if (capabilityId) {
    const searchFolders = hintedType
      ? [hintedType, ...SNAPSHOT_FOLDERS.filter((f) => f !== hintedType)]
      : [...SNAPSHOT_FOLDERS];

    for (const resType of searchFolders) {
      const cap = await loadCapabilityDetails({
        resourcesDir: params.resourcesDir,
        capabilityId,
        resourceType: resType,
        resourceContext: params.resourceContext,
      });
      if (cap) {
        capability = cap;
        resourceType = resType;
        break;
      }
    }

    if (!capability) {
      const normalizedId = normalizeResourceId(capabilityId);
      if (normalizedId && normalizedId !== capabilityId) {
        for (const resType of searchFolders) {
          const cap = await loadCapabilityDetails({
            resourcesDir: params.resourcesDir,
            capabilityId: normalizedId,
            resourceType: resType,
            resourceContext: params.resourceContext,
          });
          if (cap) {
            capability = cap;
            resourceType = resType;
            break;
          }
        }
      }
    }

    if (!capability) {
      capability = buildCapabilityFromResourceContext(
        capabilityId,
        resourceType ?? undefined,
        params.resourceContext,
      );

      if (capability) {
        const capType = normalizeResourceType(capability.resource_type);
        const discovery = String((capability as { _discovery_source?: string })._discovery_source ?? "");
        if (capType === "agent" && discovery === "resource_context") {
          const agentBlock = isRecord(capability.agent) ? (capability.agent as Record<string, unknown>) : {};
          const headerCount =
            Object.keys(normalizeCustomHeaders(capability.metadata?.default_headers)).length +
            Object.keys(normalizeCustomHeaders(agentBlock.headers)).length;
          if (headerCount === 0) {
            const fileCap = await loadCapabilityDetails({
              resourcesDir: params.resourcesDir,
              capabilityId,
              resourceType: "agent",
              resourceContext: params.resourceContext,
            });
            if (fileCap) {
              capability = fileCap;
              resourceType = "agent";
            }
          }
        }
      }
    }

    if (capability) {
      capability = mergeResourceContextIntoCapability(capability, params.resourceContext);
      capability = await hydrateWhaleAgentDocFromSnapshotIfNeeded({
        capability,
        resourcesDir: params.resourcesDir,
        capabilityId: String(capabilityId),
        resourceContext: params.resourceContext,
      });
    }

    if (!capability) {
      capability = buildDirectCapabilityStub({
        capabilityId,
        resourceType: resourceType ?? undefined,
        resourceContext: params.resourceContext,
      });
    }
  }

  if (capability) {
    const capType = normalizeResourceType(capability.resource_type);
    if (capType === "object" || capType === "view") {
      // OBJECT / VIEW MCP lives on the datacloud-data-service, whose
      // host:port is registered in Redis service discovery (key
      // `byai_gateway:sd:instances:byclaw-datacloud`). The resource
      // metadata often lacks a usable `mcpServerUrl`; even if a URL appears on
      // `selected_resource`, the authoritative endpoint
      // is always the one advertised via SD — so
      // we override unconditionally, matching `byclaw-tool`'s behaviour
      // in `mcp-server-url.ts::resolveMcpServerUrlForExecutorSync`.
      const datacloudUrl = await resolveDatacloudMcpServerUrl();
      if (datacloudUrl) {
        const mcp: CapabilityMcp = isRecord(capability.mcp)
          ? (capability.mcp as CapabilityMcp)
          : {};
        mcp.server_url = datacloudUrl;
        if (!mcp.transfer_type) {
          mcp.transfer_type = "streamable_http";
        }
        capability.mcp = mcp;
      }
    }
    if (capType === "mcp" || capType === "object" || capType === "view") {
      const forward = extractOpenclawMcpForwardHeaders(params.resourceContext);
      capability = await refreshMcpCapability({
        capability,
        authContext: params.authContext,
        session: params.session,
        forwardHeaders: Object.keys(forward).length > 0 ? forward : undefined,
        fetchImpl: params.fetchImpl,
      });
    }
  }

  return { capability, resolvedType: resourceType };
}
