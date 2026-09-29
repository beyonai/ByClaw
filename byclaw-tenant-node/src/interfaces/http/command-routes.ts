import type { FastifyInstance } from "fastify";
import type { TenantIdentity } from "../../domain/tenant.js";
import type { CommandService } from "../../application/command-service.js";
import type { Operation } from "../../application/command.js";
import { validateTenantCommand } from "../contracts/command.js";
import { requireId } from "../../domain/values.js";
import { DomainError } from "../../domain/errors.js";

/** 路由与命令操作、路径资源、真实 actor 必须一致，再调用统一命令事务入口。 */
export function commandRoutes(
  app: FastifyInstance,
  identity: TenantIdentity,
  service: CommandService,
): void {
  const routes: ["POST" | "PATCH" | "DELETE", string, Operation][] = [
    ["POST", "/sessions", "CREATE_SESSION"],
    ["PATCH", "/sessions/:id", "UPDATE_SESSION"],
    ["DELETE", "/sessions/:id", "DELETE_SESSION"],
    ["POST", "/group-chats", "CREATE_GROUP"],
    ["PATCH", "/group-chats/:id", "UPDATE_SESSION"],
    ["POST", "/group-chats/:id/members", "ADD_MEMBERS"],
    ["POST", "/group-chats/:id/join", "JOIN_GROUP"],
    ["DELETE", "/group-chats/:id/members", "REMOVE_MEMBER"],
    ["PATCH", "/group-chats/:id/members/role", "SET_ROLE"],
    ["POST", "/group-chats/:id/owner", "TRANSFER_OWNER"],
    ["POST", "/group-chats/:id/leave", "LEAVE_GROUP"],
    ["POST", "/group-chats/:id/dissolve", "DISSOLVE_GROUP"],
    ["POST", "/group-chats/:id/dissolution-ack", "ACK_DISSOLUTION"],
    ["PATCH", "/group-chats/:id/settings", "UPDATE_SETTINGS"],
    ["PATCH", "/group-chats/:id/read-state", "READ_STATE"],
    ["POST", "/group-chats/:id/tasks", "CREATE_TASK"],
    ["PATCH", "/group-chats/:id/tasks/:taskId", "UPDATE_TASK"],
    ["POST", "/group-chats/:id/tasks/:taskId/publication", "PUBLISH_TASK"],
    ["POST", "/group-chats/:id/tasks/:taskId/pending-publication", "SAVE_PENDING_PUBLICATION"],
    ["DELETE", "/group-chats/:id/tasks/:taskId/pending-publication", "DELETE_PENDING_PUBLICATION"],
    ["POST", "/sessions/:id/messages/:messageId/recall", "RECALL_MESSAGE"],
    ["POST", "/group-chats/:id/messages", "SEND_GROUP_MESSAGE"],
  ];
  for (const [method, path, operation] of routes)
    app.route<{ Params: Record<string, string> }>({
      method,
      url: `/internal/v1${path}`,
      handler: async (req) => {
        const command = validateTenantCommand(
          req.body,
          identity,
          requireId(req.headers["x-actor-user-id"]),
        );
        if (
          command.operation !== operation ||
          (req.params.id && command.sessionId !== req.params.id) ||
          (req.params.taskId && command.payload.taskSessionId !== req.params.taskId) ||
          (req.params.messageId && command.payload.messageId !== req.params.messageId)
        )
          throw new DomainError("COMMAND_CONTEXT_MISMATCH");
        return service.execute(command);
      },
    });
}
