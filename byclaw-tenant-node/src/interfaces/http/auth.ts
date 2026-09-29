import type { FastifyRequest } from "fastify";
import type { TLSSocket } from "node:tls";
import { timingSafeEqual } from "node:crypto";
import type { Config } from "../../config.js";
import { ServiceError } from "../contracts/errors.js";

export function authenticate(req: FastifyRequest, config: Config): void {
  if (config.transport === "http") {
    const forwardedToken = req.headers["x-byclaw-internal-token"];
    const actual =
      typeof forwardedToken === "string"
        ? forwardedToken
        : (req.headers.authorization?.replace(/^Bearer /, "") ?? "");
    const expected = config.internalToken ?? "";
    const actualBytes = Buffer.from(actual);
    const expectedBytes = Buffer.from(expected);
    if (
      !expected ||
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)
    )
      throw new ServiceError(401, "UNAUTHORIZED");
    return;
  }
  const socket = req.raw.socket as TLSSocket;
  if (!socket.authorized || typeof socket.getPeerCertificate !== "function")
    throw new ServiceError(401, "UNAUTHORIZED");
  const certificate = socket.getPeerCertificate();
  // The BE service identity is pinned in addition to validating its certificate chain.
  if (certificate.subject?.CN !== config.beClientIdentity)
    throw new ServiceError(403, "CLIENT_IDENTITY_MISMATCH");
}
export function assertHeaders(req: FastifyRequest, config: Config): void {
  if (req.headers["x-enterprise-id"] !== config.enterpriseId)
    throw new ServiceError(403, "TENANT_MISMATCH");
  if (req.headers["x-tenant-generation"] !== config.generation)
    throw new ServiceError(403, "GENERATION_MISMATCH");
}
