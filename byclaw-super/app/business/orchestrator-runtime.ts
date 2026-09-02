import {
  parseExpertTeamRuntimeSnapshot,
  type AgentProfile,
  type ExpertTeamRuntimeSnapshotV1,
  type LeaderModelSelection,
  type OrchestratorRefV1,
} from "@byclaw/by-conductor";
import type { RedisFirstLlmProvider } from "../llm-provider/index.js";
import {
  toAgentProfiles,
  type AgentResourceRecord,
} from "./agent-profile-mapper.js";
import {
  normalizeBaseUrl,
  postByClawBeJson,
  type FetchLike,
} from "./byclaw-be-http.js";
import type { ByClawBeEndpointResolver } from "./endpoint-resolver.js";
import { resolveLeaderModelSelection } from "./resource-model-binding.js";

const ORCHESTRATOR_RUNTIME_PATH =
  "/byaiService/internal/v1/orchestrators/resolve-runtime";

export interface ResolvedExpertTeamRuntime {
  orchestrator: ExpertTeamRuntimeSnapshotV1;
  agents: AgentProfile[];
  leaderModel: LeaderModelSelection;
}

export interface OrchestratorRuntimeProvider {
  /** 使用当前 Token 验权并返回一次 Run 可冻结的完整专家团配置。 */
  resolve(input: {
    orchestrator: OrchestratorRefV1;
    beyondToken: string;
    systemCode?: string;
  }): Promise<ResolvedExpertTeamRuntime>;
}

export interface ByClawBeOrchestratorRuntimeProviderOptions {
  baseUrl: string;
  timeoutMs: number;
  llmProvider: Pick<RedisFirstLlmProvider, "resolveByModelId">;
  fetchImpl?: FetchLike;
  endpointResolver?: ByClawBeEndpointResolver;
}

export class ByClawBeOrchestratorRuntimeError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ByClawBeOrchestratorRuntimeError";
  }
}

/** BE 是专家团权限、Prompt、模型和成员集合的唯一运行时真相源。 */
export class ByClawBeOrchestratorRuntimeProvider
  implements OrchestratorRuntimeProvider
{
  readonly #fallbackBaseUrl: URL;
  readonly #timeoutMs: number;
  readonly #llmProvider: Pick<RedisFirstLlmProvider, "resolveByModelId">;
  readonly #fetch: FetchLike;
  readonly #endpointResolver: ByClawBeEndpointResolver | undefined;

  constructor(options: ByClawBeOrchestratorRuntimeProviderOptions) {
    this.#fallbackBaseUrl = normalizeBaseUrl(options.baseUrl);
    this.#timeoutMs = options.timeoutMs;
    this.#llmProvider = options.llmProvider;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#endpointResolver = options.endpointResolver;
  }

  async resolve(input: {
    orchestrator: OrchestratorRefV1;
    beyondToken: string;
    systemCode?: string;
  }): Promise<ResolvedExpertTeamRuntime> {
    if (input.orchestrator.kind !== "EXPERT_TEAM") {
      throw new Error(
        "Orchestrator runtime provider only accepts EXPERT_TEAM",
      );
    }
    const data = await postByClawBeJson({
      fetchImpl: this.#fetch,
      ...(this.#endpointResolver
        ? { endpointResolver: this.#endpointResolver }
        : {}),
      fallbackBaseUrl: this.#fallbackBaseUrl,
      timeoutMs: this.#timeoutMs,
      path: ORCHESTRATOR_RUNTIME_PATH,
      beyondToken: input.beyondToken,
      ...(input.systemCode ? { systemCode: input.systemCode } : {}),
      body: {
        schemaVersion: "byclaw.orchestrator-runtime-request/v1",
        kind: input.orchestrator.kind,
        orchestratorId: input.orchestrator.id,
      },
      label: "orchestrator runtime",
      toError: (message, statusCode) =>
        new ByClawBeOrchestratorRuntimeError(message, statusCode),
    });
    const record = requiredRecord(data, "ByClaw BE orchestrator runtime");
    const orchestratorRecord = requiredRecord(
      record.orchestrator,
      "ByClaw BE orchestrator runtime.orchestrator",
    );
    const promptRecord = requiredRecord(
      record.prompt,
      "ByClaw BE orchestrator runtime.prompt",
    );
    const snapshot = parseExpertTeamRuntimeSnapshot({
      schemaVersion: record.schemaVersion,
      kind: orchestratorRecord.kind,
      id: orchestratorRecord.id,
      name: orchestratorRecord.name,
      prompt: promptRecord,
      contextProfile: record.contextProfile,
      configVersion: record.configVersion,
    });
    if (snapshot.id !== input.orchestrator.id) {
      throw new ByClawBeOrchestratorRuntimeError(
        "ByClaw BE orchestrator runtime does not match requested id",
      );
    }
    if (!Array.isArray(record.agents)) {
      throw new ByClawBeOrchestratorRuntimeError(
        "ByClaw BE orchestrator runtime agents must be an array",
      );
    }
    const model = requiredRecord(
      record.model,
      "ByClaw BE orchestrator runtime.model",
    );
    return {
      orchestrator: snapshot,
      agents: toAgentProfiles(record.agents as AgentResourceRecord[], {
        requireUsesPermission: false,
      }),
      leaderModel: await resolveLeaderModelSelection(
        this.#llmProvider,
        model.modelId,
      ),
    };
  }
}

function requiredRecord(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ByClawBeOrchestratorRuntimeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}
