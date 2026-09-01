import type { IngressSessionBindingRepository, RunService } from "@byclaw/by-conductor";
import { createRedis, type WorkerRegistry } from "@byclaw/by-framework";
import type { RunIngressService } from "../ingress/run-ingress-service.js";
import type { WorkerProtocolEmitter } from "./by-framework-run-presenter.js";

/** by-framework Worker 组装阶段使用的 Redis 客户端。 */
export type RedisClient = ReturnType<typeof createRedis>;

/** Worker 处理消息时需要的 Run 业务能力。 */
export type WorkerRunService = Pick<
  RunService,
  "streamEvents" | "cancelRun" | "respondToInteraction" | "resumeDelegation"
>;

/** Worker 把外部消息转换为内部 Run 时需要的入口能力。 */
export type WorkerRunIngress = Pick<
  RunIngressService,
  "createSessionRun" | "createRun" | "resolvePrincipal" | "authorizeRun"
>;

/** Worker 使用的最小日志契约。 */
export interface WorkerLogger {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
}

/** Composition Root 创建核心 Worker 时需要提供的全部依赖。 */
export interface ByClawSuperWorkerOptions {
  workerId: string;
  agentType: string;
  redis: RedisClient;
  registry?: WorkerRegistry;
  runService: WorkerRunService;
  runIngress: WorkerRunIngress;
  sessionBindings?: IngressSessionBindingRepository;
  protocolEmitter?: WorkerProtocolEmitter;
  logger?: WorkerLogger;
}
