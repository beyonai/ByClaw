import {
  AgentState,
  AnonymousWorker,
  WorkerRegistry,
  WorkerRunner,
  ensureJsonSerializable,
} from "@byclaw/by-framework";
import type { Redis } from "ioredis";
import type { Config } from "../../config.js";
import type { WorkerServices } from "../../interfaces/worker/dispatch.js";
import { dispatchWorker } from "../../interfaces/worker/dispatch.js";
import { DomainError } from "../../domain/errors.js";

/** 管理实际 by-framework Worker 的注册、消费与停止；共享 Redis 的最终关闭由 bootstrap 负责。 */
export class TenantWorker {
  private runner?: WorkerRunner;
  private loop?: Promise<void>;
  constructor(
    private readonly redis: Redis,
    private readonly config: Config,
    private readonly services: WorkerServices,
  ) {}
  get active(): boolean {
    return !!this.runner?.isHealthy();
  }
  async update(connected: boolean): Promise<void> {
    if (!connected) {
      await this.close();
      return;
    }
    if (this.runner && this.runner.health !== "fatal") return;
    await this.close();
    const c = this.config;
    const worker = new AnonymousWorker({
      workerId: `tenant-data-${c.enterpriseId}-g${c.generation}-${c.instanceId}`,
      agentTypes: [`TENANT_DATA_${c.enterpriseId}`],
      registry: new WorkerRegistry(this.redis),
      redisClient: this.redis,
      onTask: async (command) => {
        try {
          if (!("content" in command)) throw new DomainError("INVALID_WORKER_REQUEST");
          const result = await dispatchWorker(
            command.content,
            c,
            this.services,
            command.header.userCode,
          );
          return ensureJsonSerializable(
            JSON.parse(
              JSON.stringify({ status: AgentState.COMPLETED, replyData: { ok: true, result } }),
            ),
          );
        } catch (error) {
          return {
            // SDK 根据 status 判定任务成功，业务错误必须明确返回 FAILED。
            status: AgentState.FAILED,
            replyData: {
              ok: false,
              error: { code: error instanceof DomainError ? error.code : "SERVICE_UNAVAILABLE" },
            },
          };
        }
      },
    });
    const runner = new WorkerRunner(worker, {
      redisClient: this.redis,
      groupName: `tenant-data-${c.enterpriseId}-g${c.generation}-worker-v1`,
      maxConcurrency: 4,
      fetchCount: 1,
    });
    try {
      await runner.initialize();
    } catch (error) {
      await runner.release();
      throw error;
    }
    this.runner = runner;
    this.loop = runner
      .start({ initialize: false, handleSignals: false })
      .catch(() => {})
      .finally(() => {
        if (this.runner === runner) this.runner = undefined;
      });
  }
  async close(): Promise<void> {
    const runner = this.runner;
    if (!runner) return;
    runner.stop();
    await this.loop;
    this.runner = undefined;
    this.loop = undefined;
  }
}
