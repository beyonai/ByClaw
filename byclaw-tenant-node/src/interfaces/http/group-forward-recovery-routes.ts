import type { FastifyInstance } from "fastify";
import type { ForwardRecoveryPort } from "../../application/group-forward-maintenance.js";
import { positiveId } from "../../application/group-forward-snapshot.js";
import { DomainError } from "../../domain/errors.js";
function object(raw: any, keys: string[]): any {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some((k) => !keys.includes(k))
  )
    throw new DomainError("FORWARD_INVALID_REQUEST");
  return raw;
}
/** Existing app hooks authenticate BE service and exact tenant/generation; paths only address persisted operations. */
export function groupForwardRecoveryRoutes(
  app: FastifyInstance,
  tenant: string,
  store: ForwardRecoveryPort,
): void {
  const base = "/internal/v1/forward-maintenance";
  const locator = (raw: any) => {
    const l = object(raw, ["enterpriseId", "requestId", "backend"]);
    positiveId(l.requestId);
    if (l.enterpriseId !== tenant || l.backend !== "TENANT")
      throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    return l;
  };
  const delivery = (raw: any) => {
    const l = object(raw, [
      "locator",
      "targetId",
      "owner",
      "fencingVersion",
      "leaseUntil",
      "pendingMessageIds",
    ]);
    locator(l.locator);
    positiveId(l.targetId);
    return l;
  };
  app.post(base + "/scan", async (req: any) => {
    const b = object(req.body, ["category", "after", "limit"]);
    return store.scan(b.category, b.after ?? null, b.limit);
  });
  app.post(base + "/delivery/claim", async (req: any) => {
    const b = object(req.body, ["locator", "targetId", "owner", "durationMs"]);
    return store.claimDelivery(locator(b.locator), positiveId(b.targetId), b.owner, b.durationMs);
  });
  app.post(base + "/delivery/read", async (req: any) => {
    const b = object(req.body, ["lease", "messageId"]);
    return store.delivery(delivery(b.lease), positiveId(b.messageId));
  });
  app.post(base + "/delivery/mark", async (req: any) => {
    const b = object(req.body, ["lease", "messageId", "outcome"]);
    return store.markDelivered(delivery(b.lease), positiveId(b.messageId), b.outcome);
  });
  app.post(base + "/delivery/renew", async (req: any) => {
    const b = object(req.body, ["lease", "durationMs"]);
    return store.renewDelivery(delivery(b.lease), b.durationMs);
  });
  app.post(base + "/request-failure", async (req: any) => {
    const b = object(req.body, ["lease", "code", "retryable"]);
    if (b.lease?.actor?.enterpriseId !== tenant || typeof b.retryable !== "boolean")
      throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    await store.failRequest(b.lease, b.code, b.retryable);
    return { ok: true };
  });
  app.post(base + "/failure", async (req: any) => {
    const b = object(req.body, ["lease", "code", "retryable"]);
    if (b.lease?.actor?.enterpriseId !== tenant || typeof b.retryable !== "boolean")
      throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    await store.failTarget(b.lease, b.code, b.retryable);
    return { ok: true };
  });
}
