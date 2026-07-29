import {
  createRedisClient,
  scanRedisKeys,
  type RedisClient as IoredisClient,
} from "../../shared/src/redis-compat.js";
import type { RedisConnectionConfig } from "./types.js";
import { createRedisConnectGate } from "./redis-connect-gate.js";

export class RedisClient {
  private readonly client: IoredisClient;
  private readonly ensureConnected: () => Promise<void>;

  constructor(private readonly config: RedisConnectionConfig) {
    this.client = createRedisClient(config, {
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: config.connectTimeoutMs,
      retryStrategy: () => null,
      maxRetriesPerRequest: 2,
    });
    this.ensureConnected = createRedisConnectGate({
      isReady: () => (this.client as { status?: string }).status === "ready",
      connect: async () => {
        await this.client.connect();
      },
    });
  }

  async connect(): Promise<void> {
    await this.ensureConnected();
  }

  async get(key: string): Promise<string | null> {
    const reply = await this.client.get(this.withPrefix(key));
    return typeof reply === "string" ? reply : null;
  }

  async hget(key: string, field: string): Promise<string | null> {
    const reply = await this.client.hget(this.withPrefix(key), field);
    return typeof reply === "string" ? reply : null;
  }

  async keys(pattern: string): Promise<string[]> {
    await this.connect();
    const keys = await scanRedisKeys(this.client, this.withPrefix(pattern));
    return keys.map((key) => this.stripPrefix(key));
  }

  async mget(keys: string[]): Promise<Array<string | null>> {
    if (keys.length === 0) {
      return [];
    }
    return await Promise.all(keys.map((key) => this.get(key)));
  }

  close(): void {
    const client = this.client as {
      disconnect?: (reconnect?: boolean) => void;
    };
    client.disconnect?.(false);
  }

  private withPrefix(key: string): string {
    return `${this.config.keyPrefix}${key}`;
  }

  private stripPrefix(key: string): string {
    return this.config.keyPrefix && key.startsWith(this.config.keyPrefix)
      ? key.slice(this.config.keyPrefix.length)
      : key;
  }
}
