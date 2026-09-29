import type { Redis } from "ioredis";
import { DomainError } from "../../domain/errors.js";

/** One reader owns a shard; a commit must still hold this lease. */
export class ConsumerLease {
  private owned = false;
  constructor(
    private readonly redis: Redis,
    private readonly key: string,
    private readonly token: string,
  ) {}
  async acquire(): Promise<boolean> {
    if (this.owned) {
      const renewed = await this.redis.eval(
        "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],60000) end return 0",
        1,
        this.key,
        this.token,
      );
      this.owned = renewed === 1;
      return this.owned;
    }
    this.owned = (await this.redis.set(this.key, this.token, "PX", 60000, "NX")) === "OK";
    return this.owned;
  }
  async assert(): Promise<void> {
    if ((await this.redis.get(this.key)) !== this.token)
      throw new DomainError("CONSUMER_LEASE_LOST");
  }
  async release(): Promise<void> {
    await this.redis.eval(
      "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",
      1,
      this.key,
      this.token,
    );
    this.owned = false;
  }
}
