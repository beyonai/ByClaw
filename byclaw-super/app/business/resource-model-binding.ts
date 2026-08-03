import { createHash } from "node:crypto";
import type { LeaderModelSelection, LlmProviderConfig } from "@byclaw/by-conductor";
import type { RedisFirstLlmProvider } from "../llm-provider/index.js";
import type { ByClawBeEndpointResolver } from "./endpoint-resolver.js";

const RESOURCE_DETAIL_PATH = "/byaiService/open/api/v1/queryDigEmployeeDetail";

type FetchLike = typeof globalThis.fetch;

export interface ByClawBeResourceModelResolverOptions {
  baseUrl: string;
  timeoutMs: number;
  llmProvider: RedisFirstLlmProvider;
  fetchImpl?: FetchLike;
  endpointResolver?: ByClawBeEndpointResolver;
}

/** 通过 BE 资源详情解析模型绑定，并用 Redis 模型配置生成不含密钥的选择指纹。 */
export class ByClawBeResourceModelResolver {
  readonly #fallbackBaseUrl: URL;
  readonly #timeoutMs: number;
  readonly #llmProvider: RedisFirstLlmProvider;
  readonly #fetch: FetchLike;
  readonly #endpointResolver: ByClawBeEndpointResolver | undefined;

  constructor(options: ByClawBeResourceModelResolverOptions) {
    this.#fallbackBaseUrl = normalizeBaseUrl(options.baseUrl);
    this.#timeoutMs = options.timeoutMs;
    this.#llmProvider = options.llmProvider;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#endpointResolver = options.endpointResolver;
  }

  async resolve(input: {
    resourceId: string;
    beyondToken: string;
    systemCode?: string;
  }): Promise<LeaderModelSelection> {
    const resourceId = requiredScalar(input.resourceId, "resourceId");
    const discoveredBaseUrl = await this.#endpointResolver?.resolve();
    const url = buildResourceDetailUrl(
      discoveredBaseUrl ? normalizeBaseUrl(discoveredBaseUrl) : this.#fallbackBaseUrl,
    );
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Beyond-Token": input.beyondToken,
          ...(input.systemCode ? { "System-Code": input.systemCode } : {}),
        },
        body: JSON.stringify({ resourceId }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `ByClaw BE resource model request failed: ${error.message}`
          : "ByClaw BE resource model request failed",
      );
    }
    if (!response.ok) {
      throw new Error(`ByClaw BE resource model returned HTTP ${response.status}`);
    }
    const payload = await parseResponse(response);
    if (payload.code !== 0 || payload.success === false || !isRecord(payload.data)) {
      throw new Error(
        `ByClaw BE resource model returned invalid result${payload.msg ? `: ${payload.msg}` : ""}`,
      );
    }
    const modelId = modelIdFromPrologue(payload.data.prologue);
    const config = await this.#llmProvider.resolveByModelId(modelId);
    return {
      modelId,
      fingerprint: fingerprintModelConfig(config),
    };
  }
}

export function fingerprintModelConfig(config: LlmProviderConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

function modelIdFromPrologue(raw: unknown): string {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error("ByClaw BE resource prologue is invalid JSON");
    }
  }
  if (!isRecord(parsed)) {
    throw new Error("ByClaw BE resource prologue is missing");
  }
  const nested = isRecord(parsed.modelInfo) ? parsed.modelInfo.modelId : undefined;
  return requiredScalar(parsed.modelId ?? nested, "resource prologue modelId");
}

function requiredScalar(value: unknown, name: string): string {
  const normalized =
    typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value);
  url.pathname =
    url.pathname === "/" ? "/" : `/${url.pathname.replace(/^\/+|\/+$/g, "")}`;
  url.search = "";
  url.hash = "";
  return url;
}

function buildResourceDetailUrl(baseUrl: URL): URL {
  const url = new URL(baseUrl);
  const prefix = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  url.pathname = `${prefix}${RESOURCE_DETAIL_PATH}`;
  return url;
}

async function parseResponse(response: Response): Promise<{
  code?: number;
  msg?: string;
  success?: boolean;
  data?: unknown;
}> {
  try {
    return (await response.json()) as {
      code?: number;
      msg?: string;
      success?: boolean;
      data?: unknown;
    };
  } catch {
    throw new Error("ByClaw BE resource model returned invalid JSON");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
