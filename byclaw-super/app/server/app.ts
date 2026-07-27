import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { BuildHttpAppOptions } from "./http-types.js";
import { registerCapabilityRoutes } from "./routes/capability-routes.js";
import { registerHealthRoutes } from "./routes/health-routes.js";
import { registerRunRoutes } from "./routes/run-routes.js";
import { registerSessionRoutes } from "./routes/session-routes.js";

export type { BuildHttpAppOptions } from "./http-types.js";

/**
 * 构建 HTTP/SSE 适配层。
 * 本文件只负责 Fastify 初始化和路由装配，具体请求流程按业务资源拆到 routes 目录。
 */
export async function buildHttpApp(
  options: BuildHttpAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    // 禁止 Ajv 静默删除额外字段，避免调用方继续误传旧字段。
    ajv: { customOptions: { removeAdditional: false } },
  });
  await app.register(cors, { origin: options.corsOrigin });

  registerHealthRoutes(app, options);
  registerCapabilityRoutes(app, options);
  registerSessionRoutes(app, options);
  registerRunRoutes(app, options);

  return app;
}
