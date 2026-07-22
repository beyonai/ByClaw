import cors from "@fastify/cors";
import type { ConnectorHealth, RunEvent, RunStatus } from "@byclaw/by-conductor";
import { OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID } from "@byclaw/connector-openclaw-by-framework";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { RunService } from "@byclaw/by-conductor";

type ThreadBody = {
  tenantId: string;
  userCode: string;
  userName?: string;
};

type AgentBody = {
  agentId: string;
  agentCode?: string;
  agentName: string;
  description?: string;
  connectorId?: string;
};

type RunBody = { message: string; agentList: AgentBody[] };

export interface BuildHttpAppOptions {
  runService: RunService;
  corsOrigin: string | boolean;
  logger?: boolean | { level: string } | FastifyBaseLogger;
  readiness(): Promise<{
    ready: boolean;
    pi: { healthy: boolean; message?: string; model?: string };
    connectors: Record<string, ConnectorHealth>;
  }>;
}

const idParamSchema = {
  type: "object",
  required: ["runId"],
  properties: { runId: { type: "string", minLength: 1 } },
} as const;

/**
 * 构建纯 HTTP/SSE 适配层；业务状态机和调度全部委托给 RunService。
 * 该函数不启动端口，便于测试使用 Fastify inject。
 */
export async function buildHttpApp(options: BuildHttpAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cors, { origin: options.corsOrigin });

  // 存活检查只表示 HTTP 进程可响应，不检查外部依赖。
  app.get("/health", async () => ({ status: "ok" }));
  // 就绪检查聚合 Pi 与 Connector 状态，不健康时返回 503。
  app.get("/ready", async (_request, reply) => {
    const readiness = await options.readiness();
    if (!readiness.ready) {
      reply.code(503);
    }
    return readiness;
  });

  // 创建 Thread，保存租户和用户上下文供后续 Run 使用。
  app.post<{ Body: ThreadBody }>(
    "/v1/threads",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["tenantId", "userCode"],
          properties: {
            tenantId: { type: "string", minLength: 1, maxLength: 256 },
            userCode: { type: "string", minLength: 1, maxLength: 256 },
            userName: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    async (request, reply) => {
      const thread = await options.runService.createThread(request.body);
      return reply.code(201).send(thread);
    },
  );

  // 创建 Run，并把 API Agent 描述转换为包含内部执行目标的授权快照。
  app.post<{ Params: { threadId: string }; Body: RunBody }>(
    "/v1/threads/:threadId/runs",
    {
      schema: {
        params: {
          type: "object",
          required: ["threadId"],
          properties: { threadId: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["message", "agentList"],
          properties: {
            message: { type: "string", minLength: 1, maxLength: 100_000 },
            agentList: {
              type: "array",
              maxItems: 1_000,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["agentId", "agentName"],
                properties: {
                  agentId: { type: "string", minLength: 1, maxLength: 256 },
                  agentCode: { type: "string", minLength: 1, maxLength: 256 },
                  agentName: { type: "string", minLength: 1, maxLength: 256 },
                  description: { type: "string", maxLength: 4_000 },
                  connectorId: { type: "string", minLength: 1, maxLength: 256 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const run = await options.runService.createRun({
          threadId: request.params.threadId,
          message: request.body.message,
          agentList: request.body.agentList.map((agent) => ({
            id: agent.agentId,
            ...(agent.agentCode ? { code: agent.agentCode } : {}),
            name: agent.agentName,
            ...(agent.description ? { description: agent.description } : {}),
            execution: {
              connectorId: agent.connectorId ?? OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID,
              targetId: agent.agentId,
            },
          })),
          metadata: beyondTokenMetadata(request.headers["beyond-token"]),
        });
        return reply.code(202).send({
          runId: run.id,
          threadId: run.threadId,
          status: run.status,
          eventsUrl: `/v1/runs/${run.id}/events`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(message.startsWith("Thread not found") ? 404 : 400).send({ error: message });
      }
    },
  );

  // 返回 Run 状态及其委派明细。
  app.get<{ Params: { runId: string } }>(
    "/v1/runs/:runId",
    { schema: { params: idParamSchema } },
    async (request, reply) => {
      const details = await options.runService.getRunDetails(request.params.runId);
      if (!details) {
        return reply.code(404).send({ error: "Run not found" });
      }
      return details;
    },
  );

  // 取消排队中或活动 Run；已在终态的 Run 保持幂等并返回 200。
  app.post<{ Params: { runId: string } }>(
    "/v1/runs/:runId/cancel",
    { schema: { params: idParamSchema } },
    async (request, reply) => {
      const before = await options.runService.getRun(request.params.runId);
      if (!before) {
        return reply.code(404).send({ error: "Run not found" });
      }
      const run = await options.runService.cancelRun(request.params.runId);
      return reply.code(isTerminal(before.status) ? 200 : 202).send(run);
    },
  );

  // 回放 Last-Event-ID 之后的事件并持续推送；客户端断开不会取消 Run。
  app.get<{ Params: { runId: string } }>(
    "/v1/runs/:runId/events",
    { schema: { params: idParamSchema } },
    async (request, reply) => {
      const run = await options.runService.getRun(request.params.runId);
      if (!run) {
        return reply.code(404).send({ error: "Run not found" });
      }
      const afterEventId = parseLastEventId(request.headers["last-event-id"]);
      const controller = new AbortController();
      reply.hijack();
      reply.raw.once("close", () => controller.abort());
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.raw.flushHeaders?.();
      const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);
      try {
        for await (const event of options.runService.streamEvents(
          request.params.runId,
          afterEventId,
          controller.signal,
        )) {
          reply.raw.write(serializeSse(event));
        }
      } finally {
        clearInterval(heartbeat);
        reply.raw.end();
      }
    },
  );

  return app;
}

/** 把请求头中的临时 Beyond-Token 放入当前 Run metadata，不进入响应或执行引用。 */
function beyondTokenMetadata(value: string | string[] | undefined): Record<string, unknown> {
  const token = Array.isArray(value) ? value[0] : value;
  return token ? { "Beyond-Token": token } : {};
}

/** 容错解析 SSE Last-Event-ID；非法值按首次订阅处理。 */
function parseLastEventId(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/** 按 SSE 协议序列化带递增 ID 的 Run 事件。 */
function serializeSse(event: RunEvent): string {
  return `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** 判断 Run 是否已经进入不可逆终态。 */
function isTerminal(status: RunStatus): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}
