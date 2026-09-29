import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import type { Config } from "../../config.js";
import type { MirrorService } from "../../application/mirror-service.js";
import { MirrorConsumer } from "../../interfaces/stream/mirror-consumer.js";
import {
  consumerGroup,
  inboundStream,
  outboundStream,
} from "../../interfaces/stream/stream-keys.js";

export class StreamSupervisor {
  private readonly readers: Redis[] = [];
  private readonly consumers: MirrorConsumer[] = [];
  private started = false;
  constructor(config: Config, service: MirrorService, ready: () => boolean) {
    const streams = [
      inboundStream(config.enterpriseId),
      ...Array.from({ length: 16 }, (_v, shard) => outboundStream(config.enterpriseId, shard)),
    ];
    for (const [index, stream] of streams.entries()) {
      const reader = new Redis({ ...config.redis, lazyConnect: true, maxRetriesPerRequest: 1 });
      reader.on("error", () => {});
      this.readers.push(reader);
      this.consumers.push(
        new MirrorConsumer(
          reader,
          stream,
          consumerGroup(config.enterpriseId, config.generation, index === 0),
          `${config.instanceId}:${randomUUID()}`,
          config,
          service,
          ready,
          index === 0,
        ),
      );
    }
  }
  get initialized(): boolean {
    return this.started;
  }
  get active(): boolean {
    return this.started && this.consumers.every((consumer) => consumer.active);
  }
  get metrics() {
    return this.consumers.map((consumer) => ({ stream: consumer.stream, ...consumer.metrics }));
  }
  async start(): Promise<void> {
    if (this.started) return;
    for (const consumer of this.consumers) await consumer.start();
    this.started = true;
  }
  async sample(): Promise<void> {
    if (this.started) await Promise.allSettled(this.consumers.map((consumer) => consumer.sample()));
  }
  async close(): Promise<void> {
    await Promise.all(this.consumers.map((consumer) => consumer.stop()));
    this.readers.forEach((reader) => reader.disconnect());
  }
}
