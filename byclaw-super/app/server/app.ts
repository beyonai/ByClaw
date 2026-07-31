import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyLoggerOptions } from "fastify";
import { HTTP_API_PREFIX } from "./http-paths.js";
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
    // 生产保持默认 JSON；dev 环境（NODE_ENV !== production）经 pino-pretty 输出单行可读日志。
    logger: buildLogger(options.logger),
    // 禁止 Ajv 静默删除额外字段，避免调用方继续误传旧字段。
    ajv: { customOptions: { removeAdditional: false } },
  });
  await app.register(cors, { origin: options.corsOrigin });

  // 容器编排探针使用根路径；业务调用仍保留带服务前缀的健康检查。
  registerHealthRoutes(app, options);

  await app.register(
    async (api) => {
      registerHealthRoutes(api, options);
      registerCapabilityRoutes(api, options);
      registerSessionRoutes(api, options);
      registerRunRoutes(api, options);
    },
    { prefix: HTTP_API_PREFIX },
  );

  return app;
}

/** 按 logLevel 构造 pino 配置；非 production 环境附加 pino-pretty transport，让日志单行、带时间、去 pid/hostname 噪声。 */
function buildLogger(
  options: BuildHttpAppOptions["logger"],
): FastifyLoggerOptions | false {
  // 调用方只传 { level }；其它（false/未传）一律退化为关闭日志。
  if (typeof options !== "object" || options === null) {
    return false;
  }
  return {
    level: options.level,
    ...(process.env.NODE_ENV !== "production"
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:HH:MM:ss.l",
              ignore: "pid,hostname",
              singleLine: true,
            },
          },
        }
      : {}),
  };
}
