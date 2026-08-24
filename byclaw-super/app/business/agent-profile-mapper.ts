import type { AgentProfile } from "@byclaw/by-conductor";
import { CODE_BY_FRAMEWORK_CONNECTOR_ID } from "@byclaw/connector-code-by-framework";
import { OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID } from "@byclaw/connector-openclaw-by-framework";
import { THIRD_PARTY_A2A_CONNECTOR_ID } from "@byclaw/connector-third-party-a2a";
import {
  THIRD_PARTY_INTERFACE_SSE_CONNECTOR_ID,
} from "@byclaw/connector-third-party-interface-sse";
import { THIRD_PARTY_PAGE_CONNECTOR_ID } from "@byclaw/connector-third-party-page";

/** BE 数字员工资源事实；不同目录接口可只返回其中一部分。 */
export interface AgentResourceRecord {
  id?: string | number;
  resourceId?: string | number;
  resourceCode?: string;
  name?: string;
  resourceDesc?: string;
  description?: string;
  tagName?: string;
  skills?: string;
  teamRole?: string;
  agentType?: string;
  createType?: string;
  integrationType?: string;
  usesPermissions?: boolean;
}

/** 将 BE 资源事实统一映射为 transport-neutral 的 AgentProfile。 */
export function toAgentProfiles(
  items: readonly AgentResourceRecord[],
  options: { requireUsesPermission: boolean },
): AgentProfile[] {
  const agents = new Map<string, AgentProfile>();
  for (const item of items) {
    if (options.requireUsesPermission && item.usesPermissions !== true) {
      continue;
    }
    const id = stringValue(item.id ?? item.resourceId);
    const name = stringValue(item.name);
    if (!id || !name) {
      continue;
    }
    const description = buildDescription(item);
    const role = stringValue(item.teamRole);
    const targetAgentType = resolveTargetAgentType(item.agentType);
    agents.set(id, {
      id,
      ...(stringValue(item.resourceCode)
        ? { code: stringValue(item.resourceCode) }
        : {}),
      name,
      ...(description ? { description } : {}),
      ...(role ? { role } : {}),
      execution: {
        connectorId: resolveConnectorId(item),
        targetId: id,
        ...(targetAgentType ? { targetAgentType } : {}),
      },
    });
  }
  return [...agents.values()];
}

/** 根据资源创建方式和集成类型选择执行链路。 */
function resolveConnectorId(item: AgentResourceRecord): string {
  if (normalizeEnum(item.createType) !== "FROM_THIRD") {
    return stringValue(item.agentType) === "011"
      ? CODE_BY_FRAMEWORK_CONNECTOR_ID
      : OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID;
  }
  switch (normalizeEnum(item.integrationType)) {
    case "INTERFACE":
      return THIRD_PARTY_INTERFACE_SSE_CONNECTOR_ID;
    case "A2A":
      return THIRD_PARTY_A2A_CONNECTOR_ID;
    case "PAGE":
      return THIRD_PARTY_PAGE_CONNECTOR_ID;
    default:
      return OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID;
  }
}

/** 与 BE 数字员工运行时路由保持一致。 */
function resolveTargetAgentType(
  agentType: string | undefined,
): string | undefined {
  switch (stringValue(agentType)) {
    case "005":
      return "BYCLAW_DATA";
    case "006":
      return "BYCLAW_QA";
    default:
      return undefined;
  }
}

function normalizeEnum(value: unknown): string {
  return stringValue(value).toUpperCase();
}

/** 汇总描述、标签和技能编码，作为 Leader 路由时可见的能力说明。 */
function buildDescription(item: AgentResourceRecord): string {
  const parts = [
    stringValue(item.description) || stringValue(item.resourceDesc),
    stringValue(item.tagName),
  ];
  const skillCodes = parseSkillCodes(item.skills);
  if (skillCodes.length > 0) {
    parts.push(`技能：${skillCodes.join("、")}`);
  }
  return [...new Set(parts.filter(Boolean))].join("；");
}

function parseSkillCodes(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((skill) =>
        typeof skill === "object" && skill !== null && "skillCode" in skill
          ? stringValue(skill.skillCode)
          : "",
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}
