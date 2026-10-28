import { createHash } from "node:crypto";
import type { SharedQuota, SharedQuotaReader } from "../../application/shared-quota.js";
import { DomainError } from "../../domain/errors.js";

interface QuotaRedis {
  hgetall(key: string): Promise<Record<string, string>>;
}
interface QuotaReadOptions {
  keyPrefix?: string;
  failurePolicy?: "ALLOW" | "REJECT";
  warn?: (code: string, enterpriseId: string) => void;
}

/** One atomic hash read avoids mixing revisions; policy corruption never uses the Redis outage fallback. */
export class RedisSharedQuotaReader implements SharedQuotaReader {
  constructor(
    private readonly redis: QuotaRedis,
    private readonly options: QuotaReadOptions = {},
  ) {}

  async read(enterpriseId: string): Promise<SharedQuota | null> {
    let hash: Record<string, string>;
    try {
      hash = await this.redis.hgetall(
        `${this.options.keyPrefix ?? "byclaw:shared:quota:v1:"}{${enterpriseId}}`,
      );
    } catch (error) {
      // A key of another Redis type is a corrupt present projection, rather than a missing/outage case.
      if (error instanceof Error && /^WRONGTYPE(?:\s|$)/.test(error.message))
        throw new DomainError("QUOTA_UNAVAILABLE");
      // Log only a stable code and tenant identity, never connection details or a Redis payload.
      this.options.warn?.("QUOTA_REDIS_UNAVAILABLE", enterpriseId);
      if (this.options.failurePolicy === "REJECT") throw new DomainError("QUOTA_UNAVAILABLE");
      return null;
    }
    if (Object.keys(hash).length === 0) return null;
    try {
      if (
        !hash.revision ||
        !hash.payload ||
        !hash.payloadHash ||
        !/^[a-f0-9]{64}$/.test(hash.payloadHash) ||
        createHash("sha256").update(hash.payload, "utf8").digest("hex") !== hash.payloadHash
      )
        throw new Error("Invalid quota hash");
      const value = JSON.parse(hash.payload);
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        value.schemaVersion !== 1 ||
        value.enterpriseId !== enterpriseId ||
        typeof value.revision !== "string" ||
        value.revision !== hash.revision ||
        value.revision.length > 19 ||
        !/^[1-9]\d*$/.test(value.revision) ||
        BigInt(value.revision) > 9223372036854775807n ||
        !["LIMITED", "UNLIMITED"].includes(value.mode) ||
        !value.limits ||
        typeof value.limits !== "object" ||
        Array.isArray(value.limits) ||
        !["memberLimit", "groupLimit", "groupMemberLimit", "agentLimit"].every(
          (key) =>
            Number.isSafeInteger(value.limits[key]) &&
            value.limits[key] >= 0 &&
            value.limits[key] <= 2147483647,
        ) ||
        !rfc3339(value.updatedAt)
      )
        throw new Error("Invalid quota payload");
      return value as SharedQuota;
    } catch {
      throw new DomainError("QUOTA_UNAVAILABLE");
    }
  }
}

/** Date.parse normalizes invalid calendar dates, so check the calendar and clock fields explicitly. */
function rfc3339(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) return false;
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1]! &&
    Number(match[4]) <= 23 &&
    Number(match[5]) <= 59 &&
    Number(match[6]) <= 59 &&
    (match[7] === undefined || (Number(match[8]) <= 23 && Number(match[9]) <= 59)) &&
    Number.isFinite(Date.parse(value))
  );
}
