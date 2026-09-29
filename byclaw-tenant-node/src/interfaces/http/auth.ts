import type { FastifyRequest } from "fastify";
import type { TLSSocket } from "node:tls";
import type { Config } from "../../config.js";
import { ServiceError } from "../contracts/errors.js";

/** 客户端证书链必须可信，且 CN 必须匹配配置的 BE 服务身份。 */
export function authenticate(req: FastifyRequest, config: Config): void {
  const socket = req.raw.socket as TLSSocket;
  if (!socket.authorized || typeof socket.getPeerCertificate !== "function")
    throw new ServiceError(401, "UNAUTHORIZED");
  const certificate = socket.getPeerCertificate();
  // 可信证书链只说明签发来源；还需匹配被授权调用本服务的 BE 身份。
  if (certificate.subject?.CN !== config.beClientIdentity)
    throw new ServiceError(403, "CLIENT_IDENTITY_MISMATCH");
}
/** 请求头只能声明当前实例固定的租户与代际，不用于动态选库。 */
export function assertHeaders(req: FastifyRequest, config: Config): void {
  if (req.headers["x-enterprise-id"] !== config.enterpriseId)
    throw new ServiceError(403, "TENANT_MISMATCH");
  if (req.headers["x-tenant-generation"] !== config.generation)
    throw new ServiceError(403, "GENERATION_MISMATCH");
}
