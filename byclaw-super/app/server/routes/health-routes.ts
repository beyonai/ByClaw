import type { FastifyInstance } from "fastify";
import type { BuildHttpAppOptions } from "../http-types.js";

/** 注册进程存活与依赖就绪检查。 */
export function registerHealthRoutes(
  app: FastifyInstance,
  options: BuildHttpAppOptions,
): void {
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_request, reply) => {
    const readiness = await options.readiness();
    if (!readiness.ready) {
      reply.code(503);
    }
    return readiness;
  });
}
