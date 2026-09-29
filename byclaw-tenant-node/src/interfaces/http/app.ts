import Fastify from "fastify";
import type { SecureContextOptions } from "node:tls";
import type { Config } from "../../config.js";
import type { CommandService } from "../../application/command-service.js";
import type { HistoryService } from "../../application/history.js";
import type { SessionQueries } from "../../application/session-queries.js";
import type { SchemaTaskService } from "../../application/schema/task-service.js";
import type { SchemaState } from "../../application/schema/types.js";
import { DomainError } from "../../domain/errors.js";
import { ServiceError, errorStatus } from "../contracts/errors.js";
import { authenticate, assertHeaders } from "./auth.js";
import { historyRoutes } from "./data-routes.js";
import { commandRoutes } from "./command-routes.js";
import { sessionRoutes } from "./session-routes.js";
import { schemaRoutes } from "./schema-routes.js";

export interface HttpServices {
  commands: CommandService;
  history: HistoryService;
  sessions: SessionQueries;
  schema: SchemaTaskService;
  connected(): boolean;
  ready(): boolean;
  provisioned(): boolean;
  schemaState(): SchemaState;
  health(): Record<string, unknown>;
}
/** 组装 HTTPS、鉴权和就绪门禁；健康及 Schema 管理路由按开通阶段单独放行。 */
export function createApp(
  config: Config,
  services: HttpServices,
  tls: SecureContextOptions,
  options: { verifyClient?: typeof authenticate; logger?: boolean } = {},
) {
  const verifyClient = options.verifyClient ?? authenticate;
  const app = Fastify({
    https: { ...tls, requestCert: true, rejectUnauthorized: false },
    bodyLimit: 2 * 1024 * 1024,
    logger:
      options.logger === false
        ? false
        : { redact: ["req.headers.authorization", "req.headers.cookie", "req.body"] },
  });
  app.setErrorHandler((error, _req, reply) => {
    const status =
      error instanceof DomainError
        ? errorStatus(error)
        : [400, 413, 415].includes(Number((error as { statusCode?: number }).statusCode))
          ? Number((error as { statusCode?: number }).statusCode)
          : 503;
    reply.code(status).send({
      error: {
        code:
          error instanceof DomainError
            ? error.code
            : status < 500
              ? "INVALID_REQUEST"
              : "SERVICE_UNAVAILABLE",
      },
    });
  });
  app.addHook("onRequest", async (req) => {
    if (req.routeOptions.url === "/internal/v1/health/live") return;
    verifyClient(req, config);
    assertHeaders(req, config);
    if (
      ["/internal/v1/health/ready", "/internal/v1/health/db"].includes(req.routeOptions.url ?? "")
    )
      return;
    const management = req.url.startsWith("/internal/v1/schema");
    if (!(management ? services.connected() : services.ready()))
      throw new ServiceError(503, "NOT_READY");
  });
  app.get("/internal/v1/health/live", async () => ({ live: true }));
  app.get("/internal/v1/health/db", async (_req, reply) =>
    reply
      .code(services.connected() ? 200 : 503)
      .send({ ...configIdentity(config), dbWritable: services.connected() }),
  );
  app.get("/internal/v1/health/ready", async (_req, reply) =>
    reply
      .code(services.provisioned() ? 200 : 503)
      .send({ ...configIdentity(config), ready: services.provisioned(), ...services.health() }),
  );
  app.register(async (scope) => schemaRoutes(scope, config, services.schema, services.schemaState));
  historyRoutes(app, services.history);
  commandRoutes(app, config, services.commands);
  sessionRoutes(app, services.sessions, services.history);
  return app;
}
function configIdentity(config: Config) {
  return {
    enterpriseId: config.enterpriseId,
    generation: config.generation,
    dbSandboxRecordId: config.dbSandboxRecordId,
  };
}
