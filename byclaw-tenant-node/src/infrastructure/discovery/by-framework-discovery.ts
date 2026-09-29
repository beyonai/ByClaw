import { ServiceRegistry } from "@byclaw/by-framework";
import type { Redis } from "ioredis";
import type { Config } from "../../config.js";

/** 发布固定租户与代际的 HTTPS endpoint，模式改变时重新注册，失去连接权威时撤销。 */
export class Discovery {
  private readonly registry: ServiceRegistry;
  private published?: string;
  constructor(
    redis: Redis,
    private readonly config: Config,
  ) {
    this.registry = new ServiceRegistry(redis);
  }
  get active() {
    return this.registry.isRegistered();
  }
  async update(connected: boolean, ready: boolean, schemaVersion: string | null): Promise<void> {
    if (!connected) {
      await this.close();
      return;
    }
    const c = this.config;
    const metadata = {
      enterpriseId: c.enterpriseId,
      generation: c.generation,
      dbSandboxRecordId: c.dbSandboxRecordId,
      instanceId: c.instanceId,
      protocolVersion: 1,
      mode: ready ? "READY" : "ADMIN_ONLY",
      schemaVersion,
      endpoint: `https://${c.advertiseHost}:${c.port}`,
      agentType: `TENANT_DATA_${c.enterpriseId}`,
    };
    const signature = JSON.stringify(metadata);
    if (this.active && this.published === signature) return;
    await this.close();
    await this.registry.register({
      serviceName: `TENANT_DATA_${c.enterpriseId}`,
      host: c.advertiseHost,
      port: c.port,
      heartbeatInterval: 5,
      metadata,
    });
    this.published = signature;
  }
  async close(): Promise<void> {
    await this.registry.unregister();
    this.published = undefined;
  }
}
