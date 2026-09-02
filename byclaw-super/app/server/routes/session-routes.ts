import type { FastifyInstance } from "fastify";
import { normalizeRunAttachments } from "@byclaw/by-conductor";
import {
  authError,
  requestAuth,
  requestError,
} from "../http-request-utils.js";
import {
  decodeRunCursor,
  runResponse,
  sessionMessagesResponse,
} from "../http-responses.js";
import {
  createSessionBodySchema,
  messageBodySchema,
  sessionIdParamSchema,
  sessionMessagesQuerySchema,
} from "../http-schemas.js";
import type {
  BuildHttpAppOptions,
  CreateSessionBody,
  MessageBody,
  SessionMessagesQuery,
} from "../http-types.js";

/** 注册 Session 创建、追加 Run 和消息历史接口。 */
export function registerSessionRoutes(
  app: FastifyInstance,
  options: BuildHttpAppOptions,
): void {
  app.post<{ Body: CreateSessionBody }>(
    "/v1/sessions",
    { schema: { body: createSessionBodySchema } },
    async (request, reply) => {
      try {
        const auth = requestAuth(request.headers);
        if (!auth) {
          return authError(reply, "Beyond-Token header is required");
        }
        const attachments = normalizeRunAttachments(
          request.body.attachments ?? [],
          "http",
        );
        const run = await options.runIngress.createSessionRun({
          ...(request.body.message ? { message: request.body.message } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
          thinkingLevel: request.body.thinkingLevel ?? "off",
          ...(request.body.context
            ? { context: request.body.context }
            : {}),
          ...auth,
        });
        return reply.code(202).send(runResponse(run));
      } catch (error) {
        return requestError(reply, error);
      }
    },
  );

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
        const attachments = normalizeRunAttachments(
          request.body.attachments ?? [],
          "http",
        );
        const run = await options.runIngress.createRun({
          sessionId: request.params.sessionId,
          ...(request.body.message ? { message: request.body.message } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
          thinkingLevel: request.body.thinkingLevel ?? "off",
          ...auth,
        });
        return reply.code(202).send(runResponse(run));
      } catch (error) {
        return requestError(reply, error);
      }
    },
  );

  app.get<{
    Params: { sessionId: string };
    Querystring: SessionMessagesQuery;
  }>(
    "/v1/sessions/:sessionId/messages",
    {
      schema: {
        params: sessionIdParamSchema,
        querystring: sessionMessagesQuerySchema,
      },
    },
    async (request, reply) => {
      try {
        const auth = requestAuth(request.headers);
        if (!auth) {
          return authError(reply, "Beyond-Token header is required");
        }
        const before = request.query.before
          ? decodeRunCursor(request.query.before)
          : undefined;
        const page = await options.runIngress.listSessionRuns(
          request.params.sessionId,
          {
            ...auth,
            limit: request.query.limit ?? 50,
            ...(before ? { before } : {}),
          },
        );
        return reply.send(
          sessionMessagesResponse(request.params.sessionId, page),
        );
      } catch (error) {
        return requestError(reply, error);
      }
    },
  );
}
