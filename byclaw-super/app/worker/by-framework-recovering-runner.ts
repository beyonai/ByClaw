import { createHash, randomUUID } from "node:crypto";
import {
  CancelTaskCommand, ConsumerGroups, QueueNames, WorkerRunner, commandFromDict,
  type GatewayCommand, type GatewayWorker, type WorkerRegistry,
} from "@byclaw/by-framework";
import type { RedisClient } from "./by-framework-worker-contracts.js";

import { currentDelivery, DeliveryOwnershipLostError, withDeliveryScope } from "./by-framework-delivery-scope.js";
export { currentDelivery, DeliveryOwnershipLostError } from "./by-framework-delivery-scope.js";
const recoveredCommand = Symbol("byclaw-super.recovered-pending");

/** 统一 pending 接管和共享消息租约；历史消息必须携带可信恢复标记。 */
export class ByFrameworkRecoveringRunner extends WorkerRunner {
  readonly #redis: RedisClient;
  readonly #worker: GatewayWorker;
  readonly #registry: WorkerRegistry;
  readonly #group: string;
  readonly #leaseMs: number;
  #nextRecoveryAt = 0;
  #stopping = false;
  readonly #activeDeliveries = new Set<AbortController>();

  constructor(worker: GatewayWorker, options: {
    redisClient: RedisClient;
    maxConcurrency: number;
    leaseMs?: number;
  }) {
    const group = `${ConsumerGroups.AGENT_ENGINES}:${createHash("sha1")
      .update([...worker.getAgentTypes()].sort().join(",")).digest("hex").slice(0, 10)}`;
    super(worker, { ...options, redisClient: acknowledgedRedis(options.redisClient, worker.workerId), groupName: group });
    this.#redis = options.redisClient;
    this.#worker = worker;
    this.#registry = worker.registry;
    this.#group = group;
    this.#leaseMs = options.leaseMs ?? 30_000;
  }

  override async poll(options: { count?: number; block?: number } = {}) {
    if (Date.now() >= this.#nextRecoveryAt) {
      this.#nextRecoveryAt = Date.now() + 5_000;
      const recovered = await this.recoverPending(options.count ?? 10);
      if (recovered.length) return recovered;
    }
    return super.poll(options);
  }

  /** 只接管离线实例或本实例上已失去 handler 的 pending，绝不抢健康实例的长任务。 */
  async recoverPending(count: number): Promise<Awaited<ReturnType<WorkerRunner["poll"]>>> {
    const recovered: Awaited<ReturnType<WorkerRunner["poll"]>> = [];
    for (const agentType of this.#worker.getAgentTypes()) {
      const streamName = QueueNames.ctrl_stream(agentType);
      const consumers = await this.#redis.xinfo("CONSUMERS", streamName, this.#group) as Array<unknown[]>;
      for (const fields of consumers) {
        const consumer = String(fields[fields.indexOf("name") + 1] ?? "");
        if (!consumer || (consumer !== this.#worker.workerId && await this.#registry.isWorkerOnline(consumer))) continue;
        const pending = await this.#redis.xpending(streamName, this.#group, "IDLE", this.#leaseMs, "-", "+", count, consumer) as
          Array<[string, string, number, number]>;
        for (const [msgId, , idle] of pending) {
          if (idle < this.#leaseMs) continue;
          const messages = await this.#redis.xclaim(
            streamName, this.#group, this.#worker.workerId, this.#leaseMs, msgId,
          ) as Array<[string, string[]]>;
          for (const [id, fields] of messages) {
            const index = fields.indexOf("data");
            const raw = index >= 0 ? fields[index + 1] : undefined;
            if (!raw) continue;
            const data = commandFromDict(JSON.parse(raw));
            if (await this.#redis.get(deliveryLeaseKey(data))) continue;
            Object.defineProperty(data, recoveredCommand, { value: true });
            recovered.push({ streamName, msgId: id, data });
          }
        }
        if (recovered.length >= count) return recovered;
      }
    }
    return recovered;
  }

  override async processAndAck(streamName: string, msgId: string, data: GatewayCommand): Promise<void> {
    if (this.#stopping) return;
    const leaseKey = deliveryLeaseKey(data);
    const token = randomUUID();
    if (await this.#redis.set(leaseKey, token, "PX", this.#leaseMs, "NX") !== "OK") return;
    const abort = new AbortController();
    this.#activeDeliveries.add(abort);
    if (this.#stopping) abort.abort(new DeliveryOwnershipLostError());
    let renewing = false;
    const assertOwned = async () => {
      if (abort.signal.aborted || await this.#redis.get(leaseKey).catch(() => null) !== token) {
        abort.abort(new DeliveryOwnershipLostError());
        throw new DeliveryOwnershipLostError();
      }
    };
    const timer = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void this.#redis.eval(
        "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end",
        1, leaseKey, token, this.#leaseMs,
      ).then((renewed) => {
        if (Number(renewed) !== 1) abort.abort(new DeliveryOwnershipLostError());
      }).catch(() => abort.abort(new DeliveryOwnershipLostError())).finally(() => { renewing = false; });
    }, Math.max(100, Math.floor(this.#leaseMs / 3)));
    timer.unref?.();
    try {
      const execution = await this.#registry.getExecutionByMessageId(data.header.messageId, data.header.sessionId);
      if (execution?.cancel_requested) {
        await this.#worker.onCancelTask(new CancelTaskCommand(data.header, data.header.messageId,
          String(execution.execution_id ?? ""), "", String(execution.cancel_reason || "by-framework task cancelled")));
      }
      await withDeliveryScope({ signal: abort.signal, assertOwned, sessionId: data.header.sessionId, leaseKey, token, recovered: Boolean((data as GatewayCommand & { [recoveredCommand]?: boolean })[recoveredCommand]) }, () =>
        super.processAndAck(streamName, msgId, data));
    } finally {
      clearInterval(timer);
      this.#activeDeliveries.delete(abort);
      await this.#redis.eval(
        "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
        1, leaseKey, token,
      ).catch(() => undefined);
    }
  }
  override stop(): void {
    this.#stopping = true;
    for (const abort of this.#activeDeliveries) abort.abort(new DeliveryOwnershipLostError());
    super.stop();
  }

}

function deliveryLeaseKey(command: GatewayCommand): string {
  const digest = createHash("sha256").update(JSON.stringify([
    command.header.targetAgentType, command.header.sessionId, command.header.messageId,
  ])).digest("hex");
  return `byclaw-super:worker:{${command.header.sessionId}}:delivery-lease:${digest}`;
}

/** 控制流与 session 不同 slot，ACK 用 pending consumer 原子校验，防止旧实例 ACK 新 owner 的消息。 */
function acknowledgedRedis(redis: RedisClient, workerId: string): RedisClient {
  return new Proxy(redis, {
    get(target, property) {
      // SDK 1.6 新增另一条 orphan reclaim 路径，但它不携带本服务的恢复标记。
      // SDK 的扫描交给上方 recoverPending；其使用原始 Redis，不受此代理影响。
      if (property === "xpending") return async () => [];
      if (property === "xack") return async (stream: string, group: string, messageId: string) => {
        await currentDelivery()?.assertOwned();
        const acknowledged = await target.eval(`
local pending = redis.call('XPENDING', KEYS[1], ARGV[1], ARGV[2], ARGV[2], 1)
if #pending == 0 then return 1 end
if pending[1][2] ~= ARGV[3] then return 0 end
redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])
return 1`, 1, stream, group, messageId, workerId);
        if (Number(acknowledged) !== 1) throw new DeliveryOwnershipLostError();
        return 1;
      };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
