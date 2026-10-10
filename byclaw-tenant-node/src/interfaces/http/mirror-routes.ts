import type { FastifyInstance } from "fastify";
import type { Config } from "../../config.js";
import type { MirrorService } from "../../application/mirror-service.js";
import type { MirrorEnvelope } from "../../domain/mirror.js";
import { DomainError } from "../../domain/errors.js";
import { requireId } from "../../domain/values.js";
import { mirrorHash, validateMirror } from "../contracts/mirror.js";
import { record } from "../contracts/validation.js";

/** A synchronous commit boundary for BE chat turns. The regular stream consumer uses the same mirror service. */
export function mirrorRoutes(app: FastifyInstance, config: Config, service: MirrorService): void {
  app.post("/internal/v1/chat/mirror", async (req) => {
    const body = record(req.body);
    const actor = requireId(req.headers["x-actor-user-id"]);
    if (body.eventType === "INPUT" && body.payload?.userId !== actor)
      throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    const event = {
      ...body,
      protocolVersion: 1,
      enterpriseId: config.enterpriseId,
      generation: config.generation,
      dbSandboxRecordId: config.dbSandboxRecordId,
      payloadHash: "",
    } as MirrorEnvelope;
    event.payloadHash = mirrorHash(event);
    await service.apply(validateMirror(event, config));
    return { eventId: event.eventId, committed: true };
  });
}
