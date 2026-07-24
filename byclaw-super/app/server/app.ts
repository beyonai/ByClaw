import cors from "@fastify/cors";
import type { ConnectorHealth, Run } from "@byclaw/by-conductor";
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
} from "fastify";
import type { RunService } from "@byclaw/by-conductor";
import { BeyondTokenAuthError } from "../auth/beyond-token.js";
import { ByClawBeAgentCatalogError } from "../byclaw-be-agent-catalog.js";
import {
  ResourceNotFoundError,
  type RunIngressService,
} from "../run-ingress-service.js";
import { createByClawSseSerializer } from "./byclaw-sse.js";

type MessageBody = {
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

const messageBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    message: { type: "string", minLength: 1, maxLength: 100_000 },
  },
} as const;

const runIdParamSchema = {
  type: "object",
  required: ["runId"],
  properties: { runId: { type: "string", minLength: 1, maxLength: 200 } },
} as const;

const sessionIdParamSchema = {
  type: "object",
  required: ["sessionId"],
  properties: { sessionId: { type: "string", minLength: 1, maxLength: 200 } },
} as const;

/**
 * 构建纯 HTTP/SSE 适配层。
 * Session 表示多轮对话；Run 表示一次执行；SSE 始终只订阅一个 Run。
 */
export async function buildHttpApp(options: BuildHttpAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    // 禁止 Ajv 静默删除额外字段，避免调用方继续误传旧 conversationId/userCode。
    ajv: { customOptions: { removeAdditional: false } },
  });
  await app.register(cors, { origin: options.corsOrigin });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_request, reply) => {
    const readiness = await options.readiness();
    if (!readiness.ready) {
      reply.code(503);
    }
    return readiness;
  });

  // 创建一个新的多轮 Session，并原子创建首个 Run。
  app.post<{ Body: MessageBody }>(
    "/v1/sessions",
    { schema: { body: messageBodySchema } },
    async (request, reply) => {
      try {
        const auth = requestAuth(request.headers);
        if (!auth) {
          return authError(reply, "Beyond-Token header is required");
        }
        const run = await options.runIngress.createSessionRun({
          message: request.body.message,
          ...auth,
        });
        return reply.code(202).send(runResponse(run));
      } catch (error) {
        return requestError(reply, error);
      }
    },
  );

  // 在已有 Session/Pi 上下文中追加一轮 Run。
  app.post<{ Params: { sessionId: string }; Body: MessageBody }>(
    "/v1/sessions/:sessionId/runs",
    {
      schema: {
        params: sessionIdParamSchema,
        body: messageBodySchema,
      },
    },
    async (request, reply) => {
      try {
        const auth = requestAuth(request.headers);
        if (!auth) {
          return authError(reply, "Beyond-Token header is required");
        }
        const run = await options.runIngress.createRun({
          sessionId: request.params.sessionId,
          message: request.body.message,
          ...auth,
        });
        return reply.code(202).send(runResponse(run));
      } catch (error) {
        return requestError(reply, error);
      }
    },
  );

  // 查询单次 Run；不暴露 Agent 执行目标或认证凭证。
  app.get<{ Params: { runId: string } }>(
    "/v1/runs/:runId",
    { schema: { params: runIdParamSchema } },
    async (request, reply) => {
      try {
        const auth = requestAuth(request.headers);
        if (!auth) {
          return authError(reply, "Beyond-Token header is required");
        }
        const { run } = await options.runIngress.authorizeRun(request.params.runId, auth);
        return reply.send(publicRun(run));
      } catch (error) {
        return requestError(reply, error);
      }
    },
  );

  // 取消排队中或执行中的 Run。
  app.post<{ Params: { runId: string } }>(
    "/v1/runs/:runId/cancel",
    { schema: { params: runIdParamSchema } },
    async (request, reply) => {
      try {
        const auth = requestAuth(request.headers);
        if (!auth) {
          return authError(reply, "Beyond-Token header is required");
        }
        const { run } = await options.runIngress.authorizeRun(request.params.runId, auth);
        const cancelled = await options.runService.cancelRun(
          run.id,
          "user requested cancellation",
        );
        return reply.code(202).send({
          runId: run.id,
          sessionId: run.sessionId,
          status: cancelled?.status ?? run.status,
        });
      } catch (error) {
        return requestError(reply, error);
      }
    },
  );

  // 订阅一个 Run 的历史和实时事件；鉴权成功前不得 hijack 或注册 waiter。
  app.get<{ Params: { runId: string } }>(
    "/v1/runs/:runId/events",
    { schema: { params: runIdParamSchema } },
    async (request, reply) => {
      const auth = requestAuth(request.headers);
      if (!auth) {
        return authError(reply, "Beyond-Token header is required");
      }
      try {
        await options.runIngress.authorizeRun(request.params.runId, auth);
      } catch (error) {
        return requestError(reply, error);
      }

      const afterEventId = parseLastEventId(request.headers["last-event-id"]);
      const controller = new AbortController();
      const serializeSse = createByClawSseSerializer();
      reply.hijack();
      reply.raw.once("close", () => controller.abort());
      // reply.hijack() 绕过 Fastify 响应生命周期，SSE 流需自行携带 CORS 头。
      const allowOrigin = resolveAccessControlAllowOrigin(
        options.corsOrigin,
        headerString(request.headers.origin),
      );
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        ...(allowOrigin
          ? { "Access-Control-Allow-Origin": allowOrigin, Vary: "Origin" }
          : {}),
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

function runResponse(run: Run) {
  return {
    sessionId: run.sessionId,
    runId: run.id,
    status: run.status,
    eventsUrl: `/v1/runs/${run.id}/events`,
  };
}

function publicRun(run: Run) {
  return {
    runId: run.id,
    sessionId: run.sessionId,
    status: run.status,
    ...(run.finalAnswer ? { finalAnswer: run.finalAnswer } : {}),
    ...(run.error ? { error: run.error } : {}),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
  };
}

function requestAuth(headers: Record<string, unknown>) {
  const beyondToken = headerString(headers["beyond-token"] as string | string[] | undefined);
  if (!beyondToken) {
    return undefined;
  }
  const systemCode = headerString(headers["system-code"] as string | string[] | undefined);
  return {
    beyondToken,
    ...(systemCode ? { systemCode } : {}),
  };
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

/** 将鉴权、资源归属、ByClaw BE 上游和普通请求异常映射为稳定响应。 */
function requestError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    error instanceof BeyondTokenAuthError ||
    (error instanceof ByClawBeAgentCatalogError && error.statusCode === 401)
  ) {
    return authError(reply, message);
  }
  if (error instanceof ResourceNotFoundError) {
    return reply.code(404).send({ error: message });
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

/**
 * 复刻 @fastify/cors 的 origin 解析逻辑。
 * 被 hijack 的 SSE 响应需要自行决定 Access-Control-Allow-Origin。
 */
function resolveAccessControlAllowOrigin(
  corsOrigin: string | boolean,
  origin: string,
): string | null {
  if (corsOrigin === false) {
    return null;
  }
  if (corsOrigin === true) {
    return origin || "*";
  }
  if (corsOrigin === "*") {
    return "*";
  }
  return corsOrigin;
}
