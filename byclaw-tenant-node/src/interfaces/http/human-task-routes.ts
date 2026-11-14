import type { FastifyInstance } from "fastify";
import type { HumanTaskRepository } from "../../infrastructure/persistence/human-task-repository.js";
import { check } from "../../domain/human-task.js";
/** Actor and tenant are supplied by the authenticated internal service transport. */
export function humanTaskRoutes(
  app: FastifyInstance,
  service: Pick<HumanTaskRepository, "call">,
): void {
  app.post<{ Params: { action: string } }>(
    "/internal/v1/group-human-tasks/:action",
    async (request) => {
      check(
        request.body && typeof request.body === "object" && !Array.isArray(request.body),
        "INVALID_BODY",
      );
      const actor = request.headers["x-actor-user-id"];
      check(typeof actor === "string", "INVALID_ACTOR");
      return service.call(actor, request.params.action, request.body as Record<string, any>);
    },
  );
}
