import { ConsumerLease } from "./consumer-lease.js";
import type { Redis } from "ioredis";
import type { TenantIdentity } from "../../domain/tenant.js";
import { MirrorDelivery } from "./mirror-delivery.js";
import type { MirrorService } from "../../application/mirror-service.js";

export interface StreamMetrics {
  committed: number;
  rejected: number;
  retries: number;
  pending: number;
  oldestPendingMs: number;
  lag: number | null;
}
/** 单流消费者：取得分片租约后先处理最老 pending，旧记录未解决时不读取新记录。 */
export class MirrorConsumer {
  readonly metrics: StreamMetrics = {
    committed: 0,
    rejected: 0,
    retries: 0,
    pending: 0,
    oldestPendingMs: 0,
    lag: null,
  };
  private readonly delivery: MirrorDelivery;
  private readonly lease: ConsumerLease;
  private stopped = false;
  private loop?: Promise<void>;
  private connected = false;
  constructor(
    private readonly redis: Redis,
    readonly stream: string,
    readonly group: string,
    private readonly consumer: string,
    identity: TenantIdentity,
    service: MirrorService,
    private readonly ready: () => boolean,
    inbound: boolean,
  ) {
    this.delivery = new MirrorDelivery(
      redis,
      stream,
      group,
      identity,
      service,
      () => this.lease.assert(),
      inbound,
      this.metrics,
    );
    this.lease = new ConsumerLease(redis, `${stream}:reader:${identity.generation}`, consumer);
  }
  get active(): boolean {
    return this.connected && !this.stopped;
  }
  async start(): Promise<void> {
    try {
      await this.redis.xgroup("CREATE", this.stream, this.group, "0", "MKSTREAM");
    } catch (error) {
      if (!(error instanceof Error && error.message.includes("BUSYGROUP"))) throw error;
    }
    this.loop ??= this.run();
  }
  process(id: string, fields: string[]) {
    return this.delivery.process(id, fields);
  }
  /** null 表示没有积压，false 表示最老记录尚不可处理；后者必须阻止读取新消息。 */
  private async pending(): Promise<[string, string[]] | null | false> {
    const oldest = (await this.redis.xpending(this.stream, this.group, "-", "+", 1)) as [
      string,
      string,
      number,
      number,
    ][];
    const record = oldest[0];
    if (!record) return null;
    if (record[1] === this.consumer) {
      const rows = (await this.redis.xreadgroup(
        "GROUP",
        this.group,
        this.consumer,
        "COUNT",
        1,
        "STREAMS",
        this.stream,
        "0",
      )) as [string, [string, string[]][]][] | null;
      return rows?.[0]?.[1]?.[0] ?? false;
    }
    if (record[2] < 30000) return false;
    const claimed = (await this.redis.xautoclaim(
      this.stream,
      this.group,
      this.consumer,
      30000,
      "0-0",
      "COUNT",
      1,
    )) as [string, [string, string[]][]];
    return claimed[1]?.[0] ?? false;
  }
  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        if (!this.ready() || !(await this.lease.acquire())) {
          this.connected = false;
          await this.delay();
          continue;
        }
        this.connected = true;
        const pending = await this.pending();
        if (pending === false) {
          await this.delay();
          continue;
        }
        const rows = pending
          ? null
          : ((await this.redis.xreadgroup(
              "GROUP",
              this.group,
              this.consumer,
              "COUNT",
              1,
              "BLOCK",
              1000,
              "STREAMS",
              this.stream,
              ">",
            )) as [string, [string, string[]][]][] | null);
        const entry = pending ?? rows?.[0]?.[1]?.[0];
        if (entry && !(await this.process(entry[0], entry[1]))) await this.delay();
      } catch {
        this.connected = false;
        await this.delay();
      }
    }
  }
  /** 采集消费组积压与延迟；指标只反映镜像持久化，不改变原 AI 实时流。 */
  async sample(): Promise<void> {
    const summary = (await this.redis.xpending(this.stream, this.group)) as [number, string | null];
    this.metrics.pending = summary[0];
    this.metrics.oldestPendingMs = summary[1]
      ? Math.max(0, Date.now() - Number(summary[1].split("-")[0]))
      : 0;
    const groups = (await this.redis.xinfo("GROUPS", this.stream)) as unknown as unknown[][];
    const group = groups
      .map((row) =>
        Object.fromEntries(
          Array.from({ length: row.length / 2 }, (_v, i) => [row[i * 2], row[i * 2 + 1]]),
        ),
      )
      .find((row) => row.name === this.group);
    this.metrics.lag = typeof group?.lag === "number" ? group.lag : null;
  }
  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 250));
  }
  async stop(): Promise<void> {
    this.stopped = true;
    await this.loop;
    this.connected = false;
    await this.lease.release();
  }
}
