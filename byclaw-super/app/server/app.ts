import cors from "@fastify/cors";
import type { ConnectorHealth } from "@byclaw/by-conductor";
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
} from "fastify";
import type { RunService } from "@byclaw/by-conductor";
import { BeyondTokenAuthError } from "../auth/beyond-token.js";
import { ByClawBeAgentCatalogError } from "../byclaw-be-agent-catalog.js";
import type { RunIngressService } from "../run-ingress-service.js";
import { createByClawSseSerializer } from "./byclaw-sse.js";

type CreateRunBody = {
  message: string;
};

export interface BuildHttpAppOptions {
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

const idParamSchema = {
  type: "object",
  required: ["runId"],
  properties: { runId: { type: "string", minLength: 1 } },
} as const;

/**
 * 构建纯 HTTP/SSE 适配层；外部只暴露创建 Run 和订阅 Run 事件。
 * 该函数不启动端口，便于测试使用 Fastify inject。
 */
export async function buildHttpApp(options: BuildHttpAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    // 禁止 Ajv 静默删除额外字段，让 message-only 请求契约可被调用方明确感知。
    ajv: { customOptions: { removeAdditional: false } },
  });
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

  // 创建一次 Run；Thread 仍是内部状态机实现细节。
  app.post<{ Body: CreateRunBody }>(
    "/v1/runs",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["message"],
          properties: {
            message: { type: "string", minLength: 1, maxLength: 100_000 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const beyondToken = headerString(request.headers["beyond-token"]);
        if (!beyondToken) {
          return authError(reply, "Beyond-Token header is required");
        }
        const systemCode = headerString(request.headers["system-code"]);
        const run = await options.runIngress.createRun({
          message: request.body.message,
          beyondToken,
          ...(systemCode ? { systemCode } : {}),
        });
        return reply.code(202).send({
          runId: run.id,
          status: run.status,
          eventsUrl: `/v1/runs/${run.id}/events`,
        });
      } catch (error) {
        return requestError(reply, error);
      }
    },
  );

  // 订阅 Run 事件；输出 ByClaw 现有 answer/reasoning/appStreamResponse 格式。
  app.get<{ Params: { runId: string } }>(
    "/v1/runs/:runId/events",
    { schema: { params: idParamSchema } },
    async (request, reply) => {
      const run = await options.runService.getRun(request.params.runId);
      if (!run) {
        return reply.code(404).send({ error: "Run not found" });
      }
      const beyondToken = headerString(request.headers["beyond-token"]);
      if (!beyondToken) {
        return authError(reply, "Beyond-Token header is required");
      }
      const userCode = await options.runService.getRunUserCode(run.id);
      if (!userCode) {
        return reply.code(404).send({ error: "Run owner not found" });
      }
      const systemCode = headerString(request.headers["system-code"]);
      try {
        await options.runIngress.verifyRunOwner(userCode, {
          beyondToken,
          ...(systemCode ? { systemCode } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return authError(reply, message);
      }
      const afterEventId = parseLastEventId(request.headers["last-event-id"]);
      const controller = new AbortController();
      const serializeSse = createByClawSseSerializer();
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

/** 从 Fastify 请求头值中读取单个非空字符串。 */
function headerString(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim() : "";
}

/** 返回与 ByClaw 后端 AccessTokenVerifyInterceptor 一致的 401 响应结构。 */
function authError(reply: FastifyReply, message: string) {
  return reply.code(401).send({
    resultCode: 401,
    resultMsg: message,
    type: 1,
  });
}

/** 将鉴权、ByClaw BE 上游和普通请求异常映射为稳定的 HTTP 响应。 */
function requestError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    error instanceof BeyondTokenAuthError ||
    (error instanceof ByClawBeAgentCatalogError && error.statusCode === 401)
  ) {
    return authError(reply, message);
  }
  if (error instanceof ByClawBeAgentCatalogError) {
    return reply.code(502).send({ error: message });
  }
  return reply.code(400).send({ error: message });
}

/** 容错解析 SSE Last-Event-ID；非法值按首次订阅处理。 */
function parseLastEventId(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}
