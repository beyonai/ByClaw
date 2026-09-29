import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import type { TenantIdentity } from "../../domain/tenant.js";
import type { SchemaTaskService } from "../../application/schema/task-service.js";
import type { SchemaState } from "../../application/schema/types.js";
import { validateSchemaTask } from "../contracts/schema-task.js";
import { opaqueId, record } from "../contracts/validation.js";
import { publicResult } from "../../application/schema/result-view.js";
import { DomainError } from "../../domain/errors.js";

export async function schemaRoutes(
  app: FastifyInstance,
  identity: TenantIdentity,
  service: SchemaTaskService,
  state: () => SchemaState,
): Promise<void> {
  await app.register(multipart, {
    limits: { files: 1, fields: 1, parts: 2, fieldSize: 32768, fileSize: 8 * 1024 * 1024 },
  });
  app.post("/internal/v1/schema-tasks", async (req, reply) => {
    let json: unknown, bundle: Buffer | undefined;
    for await (const part of req.parts()) {
      if (
        part.type === "file" &&
        part.fieldname === "bundle" &&
        part.mimetype === "application/zip" &&
        !bundle
      )
        bundle = await part.toBuffer();
      else if (
        part.type === "field" &&
        part.fieldname === "task" &&
        json === undefined &&
        !part.valueTruncated &&
        part.mimetype === "application/json"
      ) {
        try {
          json = typeof part.value === "string" ? JSON.parse(part.value) : part.value;
        } catch {
          throw new DomainError("INVALID_SCHEMA_TASK");
        }
      } else throw new DomainError("INVALID_SCHEMA_UPLOAD");
    }
    if (!bundle || json === undefined) throw new DomainError("INVALID_SCHEMA_UPLOAD");
    const task = validateSchemaTask(json, identity);
    if (req.headers["idempotency-key"] !== `${task.auditId}:${task.attemptNo}`)
      throw new DomainError("INVALID_IDEMPOTENCY_KEY");
    const result = await service.accept(task, bundle);
    return reply.code(202).send({
      auditId: task.auditId,
      attemptNo: task.attemptNo,
      bundleDigest: task.bundleDigest,
      status: result.status,
    });
  });
  app.get<{ Params: { auditId: string } }>("/internal/v1/schema-tasks/:auditId", async (req) =>
    publicResult(await service.get(opaqueId(req.params.auditId))),
  );
  app.post<{ Params: { auditId: string } }>(
    "/internal/v1/schema-tasks/:auditId/report-ack",
    async (req, reply) => {
      const body = record(req.body);
      await service.acknowledge(opaqueId(req.params.auditId), body.attemptNo, body.status);
      return reply.code(204).send();
    },
  );
  app.get("/internal/v1/schema", async () => ({ ...identity, ...state() }));
}
