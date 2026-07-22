import type { AgentProfile } from "@byclaw/by-conductor";
import { OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID } from "@byclaw/connector-openclaw-by-framework";
import type { ByClawBeEndpointResolver } from "./redis-service-discovery.js";

const DISCOVER_PATH = "/byaiService/api/v2/digitEmploy/discover";

const DISCOVER_REQUEST = {
  terminals: ["ALL", "PC", "APP"],
  pageNum: 1,
  pageSize: 9_999,
  keyword: "",
  metaStatus: "ALL",
  orgFilters: [{ type: "ALL" }],
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

  /** 固定 discover 地址和超时，允许测试注入 fetch 实现。 */
  constructor(options: ByClawBeAgentCatalogOptions) {
    this.#fallbackBaseUrl = normalizeBaseUrl(options.baseUrl);
    this.#timeoutMs = options.timeoutMs;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#endpointResolver = options.endpointResolver;
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
    return toAuthorizedAgents(result.data.list);
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
function toAuthorizedAgents(items: DiscoverAgent[]): AgentProfile[] {
  const agents = new Map<string, AgentProfile>();
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
    agents.set(id, {
      id,
      ...(stringValue(item.resourceCode) ? { code: stringValue(item.resourceCode) } : {}),
      name,
      ...(description ? { description } : {}),
      execution: {
        connectorId: OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID,
        targetId: id,
      },
    });
  }
  return [...agents.values()];
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
