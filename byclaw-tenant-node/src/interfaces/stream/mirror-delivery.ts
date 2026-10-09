import type { Redis } from "ioredis";
import type { TenantIdentity } from "../../domain/tenant.js";
import type { MirrorService } from "../../application/mirror-service.js";
import { DomainError } from "../../domain/errors.js";
import { validateMirror } from "../contracts/mirror.js";
import { outboundStream, sessionShard } from "./stream-keys.js";
import type { StreamMetrics } from "./mirror-consumer.js";
/** 单条投递适配：合法事件提交后 ACK；临时失败保留 pending，永久错误原子隔离引用并 ACK。 */
export class MirrorDelivery {
  constructor(
    private readonly redis: Redis,
    private readonly stream: string,
    private readonly group: string,
    private readonly identity: TenantIdentity,
    private readonly service: MirrorService,
    private readonly guard: () => Promise<void>,
    private readonly inbound: boolean,
    private readonly metrics: StreamMetrics,
  ) {}
  async process(id: string, fields: string[]): Promise<boolean> {
    let validated = false;
    try {
      const index = fields.indexOf("data");
      if (index < 0 || index % 2 !== 0) throw new DomainError("INVALID_MIRROR");
      if (Buffer.byteLength(fields[index + 1] ?? "") > 2 * 1024 * 1024)
        throw new DomainError("INVALID_MIRROR");
      let value;
      try {
        value = JSON.parse(fields[index + 1]!);
      } catch {
        throw new DomainError("INVALID_MIRROR");
      }
      const event = validateMirror(value, this.identity);
      if (
        (event.eventType === "INPUT") !== this.inbound ||
        (!this.inbound &&
          this.stream !== outboundStream(this.identity.enterpriseId, sessionShard(event.sessionId)))
      )
        throw new DomainError("MIRROR_STREAM_MISMATCH");
      validated = true;
      await this.service.apply(event, this.guard);
      // apply 已等待数据库提交；ACK 失败时重投仍由既有行的幂等判断兜底。
      await this.redis.xack(this.stream, this.group, id);
      this.metrics.committed++;
      return true;
    } catch (error) {
      if (
        !(error instanceof DomainError) ||
        (validated &&
          [
            "CONSUMER_LEASE_LOST",
            "TENANT_UNAVAILABLE",
            "GENERATION_MISMATCH",
            "DB_INSTANCE_MISMATCH",
            "AUTHORITY_ROLLBACK",
            "TENANT_MISMATCH",
            "NOT_READY",
            "TENANT_SCHEMA_UPGRADING",
            "AUTHORITY_CHANGED",
            "LEASE_EXPIRED",
            "REFERENCE_NOT_COMMITTED",
            "INPUT_NOT_COMMITTED",
            "SESSION_NOT_COMMITTED",
            "MIRROR_SEQUENCE_GAP",
            "COMMIT_UNCERTAIN",
            "VERSION_CONFLICT",
          ].includes(error.code))
      ) {
        this.metrics.retries++;
        return false;
      }
      // 隔离记录仅保存源流/ID/错误码；原正文保留在源流，ACK 不表示业务成功。
      await this.redis.eval(
        "redis.call('XADD',KEYS[2],'*','sourceStream',KEYS[1],'sourceId',ARGV[2],'code',ARGV[3]); return redis.call('XACK',KEYS[1],ARGV[1],ARGV[2])",
        2,
        this.stream,
        `byclaw:tenant:{${this.identity.enterpriseId}}:quarantine`,
        this.group,
        id,
        error.code,
      );
      this.metrics.rejected++;
      return true;
    }
  }
}
