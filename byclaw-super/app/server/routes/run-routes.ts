import type { FastifyInstance } from "fastify";
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
        }
      } finally {
        clearInterval(heartbeat);
        reply.raw.end();
      }
    },
  );
}
