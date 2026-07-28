import type {
  AgentCapabilityCardRepository,
  AgentCapabilityCompileInput,
  AgentCapabilityCompiler,
  ConnectorHealth,
  RunService,
  SessionContextInput,
  ThinkingLevel,
  UserInteractionResponse,
} from "@byclaw/by-conductor";
import type { FastifyBaseLogger } from "fastify";
import type { RunIngressService } from "../ingress/run-ingress-service.js";

/** 创建或追加 Run 时接收的 HTTP 请求体。 */
export type MessageBody = {
  message: string;
  thinkingLevel?: ThinkingLevel;
};

export type CreateSessionBody = MessageBody & {
  context?: SessionContextInput;
};

/** Session 消息历史的分页参数。 */
export type SessionMessagesQuery = {
  limit?: number;
  before?: string;
};

export type InteractionResponseBody = UserInteractionResponse;
export type AgentCapabilityCompileBody = AgentCapabilityCompileInput;
export type AgentCapabilityUpsertBody = AgentCapabilityCompileInput & {
  sourceVersion?: string;
};
export type AgentCapabilityParams = {
  agentId: string;
};

/** HTTP 适配层所需依赖，统一由应用 Composition Root 注入。 */
export interface BuildHttpAppOptions {
  capabilityCards: AgentCapabilityCardRepository;
  capabilityCompiler: AgentCapabilityCompiler;
  runService: RunService;
  corsOrigin: string | boolean;
  logger?: boolean | { level: string } | FastifyBaseLogger;
  runIngress: RunIngressService;
  readiness(): Promise<{
    ready: boolean;
    pi: { healthy: boolean; message?: string; model?: string };
    connectors: Record<string, ConnectorHealth>;
    worker: {
      enabled: boolean;
      healthy: boolean;
      workerId?: string;
      agentType?: string;
      message?: string;
    };
  }>;
}
