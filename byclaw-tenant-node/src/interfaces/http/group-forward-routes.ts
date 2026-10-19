import { groupForwardRecoveryRoutes } from "./group-forward-recovery-routes.js";
import type { FastifyInstance } from "fastify";
import type { GroupForwardService } from "../../application/group-forward-service.js";
import type {
  ForwardActor,
  RequestLease,
  TargetLease,
  FreezeCompletion,
  AttachmentCheckpointPatch,
} from "../../application/group-forward-types.js";
import { DomainError } from "../../domain/errors.js";
import { positiveId as requireId } from "../../application/group-forward-snapshot.js";
import { normalizeInput } from "../../application/group-forward-snapshot.js";
const invalid = (): never => {
  throw new DomainError("FORWARD_INVALID_REQUEST");
};
function object(value: unknown, keys: string[]): Record<string, any> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    return invalid();
  return value as Record<string, any>;
}
const base = "/internal/v1/group-chats/:sourceId/forward-requests";
/** Routes assign phase and compare all claimed identities; service auth/instance READY remain the parent app hooks. */
export function groupForwardRoutes(
  app: FastifyInstance,
  tenantId: string,
  service: GroupForwardService,
): void {
  groupForwardRecoveryRoutes(app, tenantId, service.recovery);
  app.addHook("preHandler", async (req: any) => {
    if (req.routeOptions.url?.startsWith(base) && req.params.requestId) {
      const binding = await service.inspect(requireId(req.params.requestId));
      if (
        binding.sourceSessionId !== requireId(req.params.sourceId) ||
        binding.actor.enterpriseId !== tenantId ||
        binding.actor.userId !== requireId(req.headers["x-actor-user-id"])
      )
        throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    }
  });
  const actor = (req: any): ForwardActor => ({
    userId: requireId(req.headers["x-actor-user-id"]),
    enterpriseId: tenantId,
  });
  const path = (req: any) => ({
    source: requireId(req.params.sourceId),
    request: requireId(req.params.requestId),
  });
  const lease = (req: any, raw: unknown, target: boolean): RequestLease | TargetLease => {
    const keys = [
      "requestId",
      "actor",
      "owner",
      "fencingVersion",
      "leaseUntil",
      ...(target ? ["targetId", "sourceSessionId", "targetSessionId", "state"] : []),
    ];
    const l = object(raw, keys);
    const a = object(l.actor, ["userId", "enterpriseId"]);
    const p = path(req);
    if (
      l.requestId !== p.request ||
      a.enterpriseId !== tenantId ||
      a.userId !== actor(req).userId ||
      typeof l.owner !== "string" ||
      !/^[A-Za-z0-9:_-]{1,128}$/.test(l.owner) ||
      typeof l.fencingVersion !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(l.fencingVersion) ||
      typeof l.leaseUntil !== "string" ||
      !Number.isFinite(Date.parse(l.leaseUntil))
    )
      return invalid();
    if (
      target &&
      (l.targetId !== requireId(req.params.targetId) ||
        l.sourceSessionId !== p.source ||
        !["COPYING", "READY"].includes(l.state))
    )
      return invalid();
    if (target) requireId(l.targetSessionId);
    return l as RequestLease | TargetLease;
  };
  const number = (value: unknown, fallback: number): number => {
    if (value === undefined) return fallback;
    if (
      typeof value !== "string" ||
      !/^[1-9][0-9]*$/.test(value) ||
      !Number.isSafeInteger(Number(value))
    )
      return invalid();
    return Number(value);
  };
  app.get("/internal/v1/group-chats/:sourceId/forward-targets", async (req: any) => {
    const q = object(req.query, ["pageNum", "pageSize", "keyword"]);
    const page = number(q.pageNum, 1),
      size = number(q.pageSize, 20);
    if (
      size > 100 ||
      (q.keyword !== undefined && (typeof q.keyword !== "string" || q.keyword.trim().length > 100))
    )
      return invalid();
    return service.listTargets(actor(req), requireId(req.params.sourceId), page, size, q.keyword);
  });
  app.get(
    "/internal/v1/group-chats/:targetId/messages/:messageId/forward-items",
    async (req: any) => {
      const q = object(req.query, ["pageSize", "cursor"]),
        size = number(q.pageSize, 20);
      if (size > 100) return invalid();
      return service.items(
        actor(req),
        requireId(req.params.targetId),
        requireId(req.params.messageId),
        size,
        q.cursor,
      );
    },
  );

  app.post(base, async (req: any, reply) =>
    reply
      .code(202)
      .send(
        await service.prepare(actor(req), requireId(req.params.sourceId), normalizeInput(req.body)),
      ),
  );
  app.get(`${base}/:requestId`, async (req: any) => {
    const p = path(req);
    return service.status(actor(req), p.source, p.request);
  });
  app.post(`${base}/:requestId/retry`, async (req: any) => {
    const b = object(req.body, ["targetSessionIds"]);
    if (
      !Array.isArray(b.targetSessionIds) ||
      b.targetSessionIds.length < 1 ||
      b.targetSessionIds.length > 10 ||
      b.targetSessionIds.some(
        (id: unknown) =>
          typeof id !== "string" || !/^[1-9][0-9]*$/.test(id) || BigInt(id) > 9223372036854775807n,
      )
    )
      invalid();
    const p = path(req);
    return service.retry(actor(req), p.source, p.request, b.targetSessionIds.map(requireId));
  });
  app.get("/internal/v1/forward-work", async (req: any) => {
    const q = object(req.query, ["limit", "afterTargetId"]);
    return service.discoverWork(
      q.afterTargetId === undefined ? null : requireId(q.afterTargetId),
      q.limit === undefined ? 20 : Number(q.limit),
    );
  });
  app.get("/internal/v1/forward-work/:requestId/targets/:targetId/binding", async (req: any) =>
    service.inspectTarget(requireId(req.params.requestId), requireId(req.params.targetId)),
  );
  // This service-only route reveals only persisted binding so BE can validate its actor before issuing new work.
  app.get("/internal/v1/forward-work/:requestId/binding", async (req: any) =>
    service.inspect(requireId(req.params.requestId)),
  );
  for (const target of [false, true]) {
    const prefix = target ? `${base}/:requestId/targets/:targetId` : `${base}/:requestId`;
    app.post(`${prefix}/lease`, async (req: any) => {
      const b = object(req.body, ["owner", "durationMs"]);
      const p = path(req);
      return target
        ? service.claimTarget(
            p.request,
            requireId(req.params.targetId),
            actor(req),
            p.source,
            b.owner,
            b.durationMs,
          )
        : service.claimRequest(p.request, actor(req), p.source, b.owner, b.durationMs);
    });
    app.patch(`${prefix}/lease`, async (req: any) => {
      const b = object(req.body, ["lease", "durationMs"]);
      const l = lease(req, b.lease, target);
      return target
        ? service.renewTarget(l as TargetLease, b.durationMs)
        : service.renewRequest(l, b.durationMs);
    });
    app.post(`${prefix}/work`, async (req: any) => {
      const b = object(req.body, ["lease"]);
      const l = lease(req, b.lease, target);
      return target ? service.targetWork(l as TargetLease) : service.requestWork(l);
    });
    app.post(`${prefix}/sources/:selectedMessageId`, async (req: any) => {
      const b = object(req.body, ["lease"]);
      return service.source(lease(req, b.lease, target), requireId(req.params.selectedMessageId));
    });
  }
  app.post(`${base}/:requestId/source-proofs`, async (req: any) => {
    const b = object(req.body, ["lease", "completion"]);
    const completion = object(b.completion, ["proofs", "resolutions"]);
    if (!Array.isArray(completion.proofs) || !Array.isArray(completion.resolutions)) invalid();
    for (const p of completion.proofs) {
      object(p, ["sourceId", "identity", "size", "sha256"]);
      object(p.identity, [
        "enterpriseId",
        "ownerId",
        "storageType",
        "scopeId",
        "path",
        "immutableVersion",
      ]);
    }
    for (const r of completion.resolutions) object(r, ["candidateId", "sourceId"]);
    await service.freezeSources(lease(req, b.lease, false), completion as FreezeCompletion);
    return { frozen: true };
  });
  app.patch(`${base}/:requestId/targets/:targetId/attachments/:attachmentId`, async (req: any) => {
    const b = object(req.body, ["lease", "expectedVersion", "patch"]);
    const patch = object(b.patch, ["phase", "sourceId", "object"]);
    const descriptor = object(patch.object, [
      "enterpriseId",
      "targetSessionId",
      "forwardTargetId",
      "itemId",
      "attachmentId",
      "attemptId",
      "fileName",
      "contentType",
      "size",
      "sha256",
      "createdAt",
      "uploadedFile",
    ]);
    if (
      descriptor.attachmentId !== req.params.attachmentId ||
      !["RESERVE", "VERIFY"].includes(patch.phase)
    )
      invalid();
    return service.checkpointAttachment(
      lease(req, b.lease, true) as TargetLease,
      b.expectedVersion,
      patch as AttachmentCheckpointPatch,
    );
  });
  app.post(`${base}/:requestId/targets/:targetId/ready`, async (req: any) => {
    const b = object(req.body, ["lease"]);
    return service.markReady(lease(req, b.lease, true) as TargetLease);
  });
  app.post(`${base}/:requestId/targets/:targetId/commit`, async (req: any) => {
    const b = object(req.body, ["lease"]);
    return service.commit(lease(req, b.lease, true) as TargetLease);
  });
}
