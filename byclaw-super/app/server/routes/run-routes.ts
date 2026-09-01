import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { RunEvent, Session } from "@byclaw/by-conductor";
import { truncateForLog } from "../../log-format.js";
import { createByClawSseSerializer } from "../byclaw-sse.js";
import {
  authError,
  headerString,
  parseLastEventId,
  requestAuth,
  requestError,
  resolveAccessControlAllowOrigin,
} from "../http-request-utils.js";
import { runDetailsResponse } from "../http-responses.js";
import {
  interactionParamSchema,
  interactionResponseSchema,
  runIdParamSchema,
} from "../http-schemas.js";
import type {
  BuildHttpAppOptions,
  InteractionResponseBody,
} from "../http-types.js";

/** 注册 Run 查询、取消、交互恢复和 SSE 订阅接口。 */
export function registerRunRoutes(
  app: FastifyInstance,
  options: BuildHttpAppOptions,
): void {
  app.get<{ Params: { runId: string } }>(
    "/v1/runs/:runId",
    { schema: { params: runIdParamSchema } },
    async (request, reply) => {
      try {
        const auth = requestAuth(request.headers);
        if (!auth) {
          return authError(reply, "Beyond-Token header is required");
        }
        const { run, delegations } = await options.runIngress.getRunDetails(
          request.params.runId,
          auth,
        );
        return reply.send(runDetailsResponse(run, delegations));
      } catch (error) {
        return requestError(reply, error);
      }
    },
  );

  app.post<{ Params: { runId: string } }>(
    "/v1/runs/:runId/cancel",
    { schema: { params: runIdParamSchema } },
    async (request, reply) => {
      try {
        const auth = requestAuth(request.headers);
        if (!auth) {
          return authError(reply, "Beyond-Token header is required");
        }
        const { run } = await options.runIngress.authorizeRun(
          request.params.runId,
          auth,
        );
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

  app.post<{
    Params: { runId: string; interactionId: string };
    Body: InteractionResponseBody;
  }>(
    "/v1/runs/:runId/interactions/:interactionId/respond",
    {
      schema: {
        params: interactionParamSchema,
        body: interactionResponseSchema,
      },
    },
    async (request, reply) => {
      try {
        const auth = requestAuth(request.headers);
        if (!auth) {
          return authError(reply, "Beyond-Token header is required");
        }
        const { run } = await options.runIngress.authorizeRun(
          request.params.runId,
          auth,
        );
        await options.runService.respondToInteraction(
          run.id,
          request.params.interactionId,
          request.body,
          auth.beyondToken,
        );
        return reply.code(202).send({
          runId: run.id,
          interactionId: request.params.interactionId,
          accepted: true,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.startsWith("Pending interaction not found:") ||
            error.message.startsWith("Run is already terminal:"))
        ) {
          return reply.code(409).send({
            error: "INTERACTION_NOT_PENDING",
            message: error.message,
          });
        }
        return requestError(reply, error);
      }
    },
  );

  app.get<{ Params: { runId: string } }>(
    "/v1/runs/:runId/events",
    { schema: { params: runIdParamSchema } },
    async (request, reply) => {
      const auth = requestAuth(request.headers);
      if (!auth) {
        return authError(reply, "Beyond-Token header is required");
      }
      const owned = await options.runIngress
        .authorizeRun(request.params.runId, auth)
        .catch((error: unknown) => {
          void requestError(reply, error);
          return null;
        });
      if (owned === null) {
        return;
      }
      const { run, session } = owned;

      const afterEventId = parseLastEventId(request.headers["last-event-id"]);
      const controller = new AbortController();
      const serializeSse = createByClawSseSerializer();
      reply.hijack();
      reply.raw.once("close", () => controller.abort());
      // hijack 会绕过 Fastify 响应生命周期，因此 SSE 自行补充 CORS 头。
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
      const heartbeat = setInterval(
        () => reply.raw.write(": heartbeat\n\n"),
        15_000,
      );
      try {
        for await (const event of options.runService.streamEvents(
          request.params.runId,
          afterEventId,
          controller.signal,
        )) {
          reply.raw.write(serializeSse(event));
          logTerminalRunEvent(request.log, event, session, run.createdAt);
        }
      } finally {
        clearInterval(heartbeat);
        reply.raw.end();
      }
    },
  );
}

/** 在 SSE 流式转发到终态事件时打一条业务返回日志，记录调用者与会话维度。不记录 Token 与凭证。 */
function logTerminalRunEvent(
  log: FastifyBaseLogger,
  event: RunEvent,
  session: Session,
  startedAt: number,
): void {
  if (
    event.type !== "run.completed" &&
    event.type !== "run.failed" &&
    event.type !== "run.cancelled"
  ) {
    return;
  }
  const owner = session.owner;
  const fields: Record<string, unknown> = {
    source: "http",
    userCode: owner.userCode,
    ...(owner.userName ? { userName: owner.userName } : {}),
    sessionId: session.id,
    runId: event.runId,
    status:
      event.type === "run.completed"
        ? "completed"
        : event.type === "run.cancelled"
          ? "cancelled"
          : "failed",
    durationMs: Date.now() - startedAt,
  };
  if (event.type === "run.completed") {
    fields.finalAnswer = truncateForLog(textFieldValue(event, "finalAnswer"), 200);
  } else if (event.type === "run.failed") {
    fields.error = truncateForLog(textFieldValue(event, "error"), 200);
  } else {
    fields.reason = truncateForLog(textFieldValue(event, "reason"), 200);
  }
  log.info(fields, "Run 结束");
}

/** 从 RunEvent.data 里安全读取字符串字段（与 byclaw-sse 一致的提取方式）。 */
function textFieldValue(event: RunEvent, key: string): string {
  const value = event.data[key];
  return typeof value === "string" ? value : "";
}
