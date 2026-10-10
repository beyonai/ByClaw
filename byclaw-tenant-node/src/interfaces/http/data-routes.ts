import type { FastifyInstance } from "fastify";
import type { HistoryService } from "../../application/history.js";
import { bounded } from "../../application/history.js";
import { requireId } from "../../domain/values.js";
import { DomainError } from "../../domain/errors.js";

/** 历史 HTTP 适配：解析参数和 actor，权限及投影由 HistoryService 统一处理。 */
export function historyRoutes(app: FastifyInstance, service: HistoryService) {
  const actor = (req: any) => requireId(req.headers["x-actor-user-id"]);
  const session = (req: any) => requireId(req.params.id);
  const body = (req: any) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
      throw new DomainError("INVALID_BODY");
    return req.body as Record<string, any>;
  };
  const cursor = (value: unknown) => {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw new DomainError("INVALID_CURSOR");
    return value;
  };
  const queryLimit = (req: any) =>
    bounded(req.query.limit === undefined ? undefined : Number(req.query.limit), 20, 50);
  app.get<{ Params: { messageId: string } }>(
    "/internal/v1/messages/:messageId/trace",
    async (req) => {
      const [message] = await service.byIds(actor(req), [requireId(req.params.messageId)]);
      if (!message) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
      return { traceId: typeof message.runId === "string" ? message.runId : null };
    },
  );
  app.get<{ Params: { commandId: string } }>(
    "/internal/v1/messages/by-command/:commandId",
    async (req) => service.byCommand(actor(req), req.params.commandId),
  );
  app.get<{ Params: { taskId: string } }>(
    "/internal/v1/group-chat/tasks/:taskId/cancellation",
    async (req) => service.cancellation(actor(req), req.params.taskId),
  );
  app.post("/internal/v1/group-chats/invitations/validate", async (req) =>
    service.invitation(actor(req), body(req).token),
  );
  app.post("/internal/v1/group-chats/name-check", async (req) =>
    service.groupNameCheck(actor(req), body(req).name),
  );
  app.post("/internal/v1/group-chats/project-access", async (req) =>
    service.groupProjectAccess(actor(req), requireId(body(req).projectId)),
  );
  app.get<{ Params: { taskId: string } }>(
    "/internal/v1/group-chat/tasks/:taskId/publication",
    async (req) => service.publication(actor(req), req.params.taskId),
  );
  app.post("/internal/v1/assiman/getMessages", async (req) => {
    const b = body(req);
    return service.traditional(
      actor(req),
      requireId(b.sessionId),
      bounded(b.pageNum, 1, 100000),
      bounded(b.pageSize, 10, 100),
    );
  });
  app.post("/internal/v1/assiman/getMessageOutline", async (req) =>
    service.outline(actor(req), requireId(body(req).sessionId)),
  );
  app.post("/internal/v1/assiman/getMessageByIds", async (req) => {
    const ids = body(req).messageIds;
    if (!Array.isArray(ids)) throw new DomainError("INVALID_MESSAGE_IDS");
    return service.byIds(actor(req), ids);
  });
  app.get<{ Params: { messageId: string } }>(
    "/internal/v1/assiman/getForwardMessage/:messageId",
    async (req) => service.forward(actor(req), req.params.messageId),
  );
  app.get<{ Querystring: { pageNum?: string; pageSize?: string } }>(
    "/internal/v1/group-chats",
    async (req) =>
      service.groups(
        actor(req),
        bounded(req.query.pageNum === undefined ? undefined : Number(req.query.pageNum), 1, 100000),
        bounded(req.query.pageSize === undefined ? undefined : Number(req.query.pageSize), 20, 100),
      ),
  );
  app.get("/internal/v1/group-chats/:id", async (req) => service.detail(actor(req), session(req)));
  app.get("/internal/v1/group-chats/:id/management", async (req) =>
    service.management(actor(req), session(req)),
  );
  app.get("/internal/v1/group-chats/:id/lifecycle", async (req) =>
    service.lifecycle(actor(req), session(req)),
  );
  app.get("/internal/v1/group-chats/:id/settings", async (req) =>
    service.settings(actor(req), session(req)),
  );
  app.post("/internal/v1/group-chats/:id/context", async (req) => {
    const b = body(req);
    return service.context(
      actor(req),
      session(req),
      cursor(b.beforeMessageId),
      bounded(b.maxMessages, 60, 60),
      bounded(b.maxCharacters, 30000, 30000),
      b.agentContext === true,
    );
  });
  app.post("/internal/v1/group-chats/:id/messages/search", async (req) =>
    service.search(actor(req), session(req), req.body === undefined ? {} : body(req)),
  );
  app.get<{ Params: { id: string; messageId: string } }>(
    "/internal/v1/group-chats/:id/messages/:messageId/context",
    async (req) => service.around(actor(req), session(req), req.params.messageId),
  );
  app.get<{ Params: { id: string }; Querystring: { pageSize?: string; cursor?: string } }>(
    "/internal/v1/group-chats/:id/files",
    async (req) =>
      service.files(
        actor(req),
        session(req),
        req.query.pageSize === undefined ? undefined : Number(req.query.pageSize),
        cursor(req.query.cursor),
      ),
  );
  app.get("/internal/v1/group-chats/:id/tasks", async (req) =>
    service.tasks(actor(req), session(req)),
  );
  app.get<{ Params: { id: string }; Querystring: { cursor?: string } }>(
    "/internal/v1/group-chats/:id/topics",
    async (req) =>
      service.topics(actor(req), session(req), queryLimit(req), cursor(req.query.cursor)),
  );
  app.get<{ Params: { id: string; topicId: string }; Querystring: { cursor?: string } }>(
    "/internal/v1/group-chats/:id/topics/:topicId/messages",
    async (req) =>
      service.topicMessages(
        actor(req),
        session(req),
        req.params.topicId,
        queryLimit(req),
        cursor(req.query.cursor),
      ),
  );
  app.get<{ Params: { taskId: string } }>("/internal/v1/group-chat/tasks/:taskId", async (req) =>
    service.task(actor(req), req.params.taskId),
  );
  app.get<{ Params: { sessionId: string } }>(
    "/internal/v1/group-chat/dispatches/:sessionId",
    async (req) => service.dispatch(actor(req), req.params.sessionId),
  );
  app.get<{ Params: { taskId: string } }>(
    "/internal/v1/group-chat/tasks/:taskId/pending-publication",
    async (req) => service.pending(actor(req), req.params.taskId),
  );
}
