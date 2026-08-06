import type { AgentProfile } from "@byclaw/by-conductor";
import type { ByClawBeEndpointResolver } from "./endpoint-resolver.js";
import { normalizeBaseUrl, postByClawBeJson, type FetchLike } from "./byclaw-be-http.js";
import {
  toAgentProfiles,
  type AgentResourceRecord,
} from "./agent-profile-mapper.js";

const DISCOVER_PATH = "/byaiService/api/v2/digitEmploy/discoverMine";

const DISCOVER_REQUEST = {
  terminals: ["ALL", "PC", "APP"],
  keyword: "",
  metaStatus: "ALL",
  orgFilters: [{ type: "all" }],
  orderField: "updateTime",
  orderBy: "desc",
  language: "zh-CN",
} as const;

type DiscoverAgent = AgentResourceRecord;

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

/** 通过 ByClaw BE 的 discoverMine API 加载当前账号下可使用的数字员工（全量、不分页）。 */
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
    const data = await postByClawBeJson({
      fetchImpl: this.#fetch,
      ...(this.#endpointResolver ? { endpointResolver: this.#endpointResolver } : {}),
      fallbackBaseUrl: this.#fallbackBaseUrl,
      timeoutMs: this.#timeoutMs,
      path: DISCOVER_PATH,
      beyondToken: input.beyondToken,
      ...(input.systemCode ? { systemCode: input.systemCode } : {}),
      body: DISCOVER_REQUEST,
      extraHeaders: { language: "zh-CN" },
      label: "discover",
      toError: (message, statusCode) =>
        new ByClawBeAgentCatalogError(message, statusCode),
    });
    if (!Array.isArray(data)) {
      throw new ByClawBeAgentCatalogError(
        "ByClaw BE discover returned invalid result",
      );
    }
    return toAgentProfiles(data as DiscoverAgent[], {
      requireUsesPermission: true,
    });
  }
}
