import { createHash } from "node:crypto";
import type { LeaderModelSelection, LlmProviderConfig } from "@byclaw/by-conductor";
import type { RedisFirstLlmProvider } from "../llm-provider/index.js";
import type { ByClawBeEndpointResolver } from "./endpoint-resolver.js";
import { normalizeBaseUrl, postByClawBeJson, type FetchLike } from "./byclaw-be-http.js";

const RESOURCE_DETAIL_PATH = "/byaiService/open/api/v1/queryDigEmployeeDetail";

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
    const data = await postByClawBeJson({
      fetchImpl: this.#fetch,
      ...(this.#endpointResolver ? { endpointResolver: this.#endpointResolver } : {}),
      fallbackBaseUrl: this.#fallbackBaseUrl,
      timeoutMs: this.#timeoutMs,
      path: RESOURCE_DETAIL_PATH,
      beyondToken: input.beyondToken,
      ...(input.systemCode ? { systemCode: input.systemCode } : {}),
      body: { resourceId },
      label: "resource model",
      toError: (message) => new Error(message),
    });
    if (!isRecord(data)) {
      throw new Error("ByClaw BE resource model returned invalid result");
    }
    const modelId = modelIdFromPrologue(data.prologue);
    return resolveLeaderModelSelection(this.#llmProvider, modelId);
  }
}

/** 根据 BE 返回的模型主键生成不包含密钥的、可持久化的 Leader 选择快照。 */
export async function resolveLeaderModelSelection(
  llmProvider: Pick<RedisFirstLlmProvider, "resolveByModelId">,
  rawModelId: unknown,
): Promise<LeaderModelSelection> {
  const modelId = requiredScalar(rawModelId, "modelId");
  const config = await llmProvider.resolveByModelId(modelId);
  return {
    modelId,
    fingerprint: fingerprintModelConfig(config),
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
