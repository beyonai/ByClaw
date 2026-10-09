import type { FastifyInstance } from "fastify";
import type { HistoryService } from "../../application/history.js";
import { bounded } from "../../application/history.js";
import type { SessionQueries } from "../../application/session-queries.js";
import { requireId } from "../../domain/values.js";
import { record } from "../contracts/validation.js";

/** 个人会话查询的 HTTP 适配；写操作复用命令路由，保持统一幂等语义。 */
export function sessionRoutes(
  app: FastifyInstance,
  queries: SessionQueries,
  history: HistoryService,
): void {
  app.post("/internal/v1/sessions/query", async (req) => {
    const body = record(req.body);
    return queries.list(requireId(req.headers["x-actor-user-id"]), body);
  });
  app.get<{ Params: { id: string } }>("/internal/v1/sessions/:id", async (req) =>
    history.access(requireId(req.headers["x-actor-user-id"]), req.params.id),
  );
  app.get<{ Params: { id: string }; Querystring: { pageNum?: string; pageSize?: string } }>(
    "/internal/v1/sessions/:id/messages",
    async (req) =>
      history.traditional(
        requireId(req.headers["x-actor-user-id"]),
        req.params.id,
        bounded(Number(req.query.pageNum ?? 1), 1, 100000),
        bounded(Number(req.query.pageSize ?? 20), 20, 100),
      ),
  );
}
