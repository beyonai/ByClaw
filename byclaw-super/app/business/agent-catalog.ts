import type { AgentProfile } from "@byclaw/by-conductor";
import { OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID } from "@byclaw/connector-openclaw-by-framework";
import { THIRD_PARTY_A2A_CONNECTOR_ID } from "@byclaw/connector-third-party-a2a";
import { THIRD_PARTY_INTERFACE_SSE_CONNECTOR_ID } from "@byclaw/connector-third-party-interface-sse";
import { THIRD_PARTY_PAGE_CONNECTOR_ID } from "@byclaw/connector-third-party-page";
import type { ByClawBeEndpointResolver } from "./endpoint-resolver.js";

const DISCOVER_PATH = "/byaiService/api/v2/digitEmploy/discover";

const DISCOVER_REQUEST = {
  terminals: ["ALL", "PC", "APP"],
  pageNum: 1,
  pageSize: 9_999,
  keyword: "",
  metaStatus: "ALL",
  orgFilters: [{ type: "all" }],
  orderField: "updateTime",
  orderBy: "desc",
  language: "zh-CN",
} as const;

type FetchLike = typeof globalThis.fetch;

type DiscoverAgent = {
  id?: string | number;
  resourceId?: string | number;
  resourceCode?: string;
  name?: string;
  resourceDesc?: string;
  tagName?: string;
  skills?: string;
  agentType?: string;
  createType?: string;
  integrationType?: string;
  usesPermissions?: boolean;
};

type DiscoverResponse = {
  code?: number;
  msg?: string;
  success?: boolean;
  data?: { list?: DiscoverAgent[] };
};

export interface AuthorizedAgentCatalog {
  /** 使用当前登录 Token 查询并返回该用户有权调度的 Agent 快照。 */
  listAuthorizedAgents(input: {
    beyondToken: string;
    systemCode?: string;
  }): Promise<AgentProfile[]>;
}

export interface ByClawBeAgentCatalogOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  endpointResolver?: ByClawBeEndpointResolver;
  thirdPartyDirect?: {
    mode: "off" | "allowlist" | "all";
    allowlist: readonly string[];
  };
}

export class ByClawBeAgentCatalogError extends Error {
  /** 创建携带上游 HTTP 状态的 Agent Catalog 调用异常。 */
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ByClawBeAgentCatalogError";
  }
}

/** 通过 ByClaw BE 的 discover API 加载当前用户可使用的数字员工。 */
export class ByClawBeAgentCatalog implements AuthorizedAgentCatalog {
  readonly #fallbackBaseUrl: URL;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;
  readonly #endpointResolver: ByClawBeEndpointResolver | undefined;
  readonly #thirdPartyDirect: NonNullable<
    ByClawBeAgentCatalogOptions["thirdPartyDirect"]
  >;

  /** 固定 discover 地址和超时，允许测试注入 fetch 实现。 */
  constructor(options: ByClawBeAgentCatalogOptions) {
    this.#fallbackBaseUrl = normalizeBaseUrl(options.baseUrl);
    this.#timeoutMs = options.timeoutMs;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#endpointResolver = options.endpointResolver;
    this.#thirdPartyDirect = options.thirdPartyDirect ?? {
      mode: "off",
      allowlist: [],
    };
  }

  /** 携带 Beyond-Token 调用发现接口，并只保留 usesPermissions 为真的数字员工。 */
  async listAuthorizedAgents(input: {
    beyondToken: string;
    systemCode?: string;
  }): Promise<AgentProfile[]> {
    const discoveredBaseUrl = await this.#endpointResolver?.resolve();
    const url = buildDiscoverUrl(
      discoveredBaseUrl ? normalizeBaseUrl(discoveredBaseUrl) : this.#fallbackBaseUrl,
    );
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Beyond-Token": input.beyondToken,
          language: "zh-CN",
          ...(input.systemCode ? { "System-Code": input.systemCode } : {}),
        },
        body: JSON.stringify(DISCOVER_REQUEST),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new ByClawBeAgentCatalogError(
        error instanceof Error ? `ByClaw BE discover request failed: ${error.message}` : "ByClaw BE discover request failed",
      );
    }

    if (!response.ok) {
      throw new ByClawBeAgentCatalogError(
        `ByClaw BE discover returned HTTP ${response.status}`,
        response.status,
      );
    }

    const result = await parseResponse(response);
    if (result.code !== 0 || result.success === false || !Array.isArray(result.data?.list)) {
      throw new ByClawBeAgentCatalogError(
        `ByClaw BE discover returned invalid result${result.msg ? `: ${result.msg}` : ""}`,
      );
    }
    return toAuthorizedAgents(result.data.list, this.#thirdPartyDirect);
  }
}

/** 解析 discover JSON 响应，并把非 JSON 响应转换为明确的上游异常。 */
async function parseResponse(response: Response): Promise<DiscoverResponse> {
  try {
    return (await response.json()) as DiscoverResponse;
  } catch {
    throw new ByClawBeAgentCatalogError("ByClaw BE discover returned invalid JSON");
  }
}

/** 过滤无权限或字段不完整的记录，并转换为 by-conductor AgentProfile。 */
function toAuthorizedAgents(
  items: DiscoverAgent[],
  thirdPartyDirect: NonNullable<
    ByClawBeAgentCatalogOptions["thirdPartyDirect"]
  >,
): AgentProfile[] {
  const agents = new Map<string, AgentProfile>();
  const allowlist = new Set(
    thirdPartyDirect.allowlist.map((value) => String(value).trim()).filter(Boolean),
  );
  for (const item of items) {
    if (item.usesPermissions !== true) {
      continue;
    }
    const id = stringValue(item.id ?? item.resourceId);
    const name = stringValue(item.name);
    if (!id || !name) {
      continue;
    }
    const description = buildDescription(item);
    const targetAgentType = resolveTargetAgentType(item.agentType);
    agents.set(id, {
      id,
      ...(stringValue(item.resourceCode) ? { code: stringValue(item.resourceCode) } : {}),
      name,
      ...(description ? { description } : {}),
      execution: {
        connectorId: resolveConnectorId(item, id, thirdPartyDirect.mode, allowlist),
        targetId: id,
        ...(targetAgentType ? { targetAgentType } : {}),
      },
    });
  }
  return [...agents.values()];
}

/** 灰度开关关闭或员工不在 allowlist 时，保持旧 OpenClaw 执行链路。 */
function resolveConnectorId(
  item: DiscoverAgent,
  id: string,
  mode: "off" | "allowlist" | "all",
  allowlist: ReadonlySet<string>,
): string {
  const directEnabled =
    mode === "all" || (mode === "allowlist" && allowlist.has(id));
  if (!directEnabled || normalizeEnum(item.createType) !== "FROM_THIRD") {
    return OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID;
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

/**
 * 与 ByClaw BE ResourceRuntimeInfoResolver 的数字员工路由保持一致。
 * 普通数字员工不写目标类型，由 Connector 继续路由到用户隔离的 BYCLAW_EXE Worker。
 */
function resolveTargetAgentType(agentType: string | undefined): string | undefined {
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

/** 汇总数字员工描述、类型和技能编码，作为 Leader 路由时可见的能力说明。 */
function buildDescription(item: DiscoverAgent): string {
  const parts = [stringValue(item.resourceDesc), stringValue(item.tagName)];
  const skillCodes = parseSkillCodes(item.skills);
  if (skillCodes.length > 0) {
    parts.push(`技能：${skillCodes.join("、")}`);
  }
  return [...new Set(parts.filter(Boolean))].join("；");
}

/** 从 discover 的 skills JSON 字符串中安全提取 skillCode。 */
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

/** 将数字或字符串字段统一转换为去空格字符串。 */
function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

/** 校验并标准化 ByClaw BE 根地址，同时保留服务发现返回的 path_prefix。 */
function normalizeBaseUrl(value: string): URL {
  const url = new URL(value);
  url.pathname = url.pathname === "/" ? "/" : `/${url.pathname.replace(/^\/+|\/+$/g, "")}`;
  url.search = "";
  url.hash = "";
  return url;
}

/** 在环境变量或服务发现根地址后拼接固定的 discover API 路径。 */
function buildDiscoverUrl(baseUrl: URL): URL {
  const url = new URL(baseUrl);
  const prefix = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  url.pathname = `${prefix}${DISCOVER_PATH}`;
  return url;
}
