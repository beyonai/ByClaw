import type { TenantIdentity } from "../../domain/tenant.js";
import type { CommandService } from "../../application/command-service.js";
import type { HistoryService } from "../../application/history.js";
import type { SchemaTaskService } from "../../application/schema/task-service.js";
import { validateTenantCommand } from "../contracts/command.js";
import { record, requireId, opaqueId } from "../contracts/validation.js";
import { DomainError } from "../../domain/errors.js";
import { assertTenant } from "../../domain/tenant.js";
import { publicResult } from "../../application/schema/result-view.js";

export interface WorkerServices {
  commands: CommandService;
  history: HistoryService;
  schema: SchemaTaskService;
  ready(): boolean;
  schemaState(): unknown;
}
export async function dispatchWorker(
  input: unknown,
  identity: TenantIdentity,
  services: WorkerServices,
  actor?: string,
): Promise<unknown> {
  const body = record(input);
  assertTenant(body as unknown as TenantIdentity, identity);
  if (body.protocolVersion !== 1) throw new DomainError("INVALID_PROTOCOL_VERSION");
  if (body.kind === "GET_SCHEMA") return services.schemaState();
  if (body.kind === "GET_SCHEMA_TASK")
    return publicResult(await services.schema.get(opaqueId(body.auditId)));
  if (!services.ready()) throw new DomainError("NOT_READY");
  if (body.kind === "COMMAND")
    return services.commands.execute(
      validateTenantCommand(body.command, identity, requireId(actor)),
    );
  if (body.kind !== "QUERY" || body.userId !== requireId(actor))
    throw new DomainError("INVALID_WORKER_REQUEST");
  const user = requireId(body.userId),
    p = record(body.payload);
  switch (body.operation) {
    case "GET_MESSAGES":
      return services.history.traditional(
        user,
        requireId(p.sessionId),
        p.pageNum ?? 1,
        p.pageSize ?? 20,
      );
    case "GET_GROUP":
      return services.history.detail(user, requireId(p.sessionId));
    case "GET_GROUPS":
      return services.history.groups(user, p.pageNum ?? 1, p.pageSize ?? 20);
    case "GET_CONTEXT":
      return services.history.context(
        user,
        requireId(p.sessionId),
        p.beforeMessageId,
        p.maxMessages ?? 60,
        p.maxCharacters ?? 30000,
      );
    case "GET_TASK":
      return services.history.task(user, requireId(p.taskSessionId));
    default:
      throw new DomainError("INVALID_WORKER_OPERATION");
  }
}
