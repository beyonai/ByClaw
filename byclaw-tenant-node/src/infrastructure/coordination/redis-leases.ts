import { createHash, randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { DomainError } from "../../domain/errors.js";

export interface RedisLease {
  check(): Promise<void>;
  release(): Promise<void>;
}
export interface LeaseManager {
  acquire(key: string, mode?: "read" | "write"): Promise<RedisLease>;
}

// One hash per logical lock keeps every command in one Redis Cluster slot.
// Reader entries carry individual server-clock expiry, so a lost reader cannot block upgrades forever.
const ACQUIRE = `
local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000)
local entries=redis.call('HGETALL',KEYS[1]); local count=0; local writer=false; local waiting=false
for i=1,#entries,2 do
  local mode,expiry=string.match(entries[i+1],'^(%a):(%d+)$')
  if not expiry or tonumber(expiry)<=now then redis.call('HDEL',KEYS[1],entries[i])
  elseif mode=='q' then waiting=true
  else count=count+1; if mode=='w' then writer=true end end
end
if writer or (ARGV[2]=='w' and count>0) or (ARGV[2]=='r' and waiting) then
  if ARGV[2]=='w' then
    redis.call('HSET',KEYS[1],ARGV[1],'q:'..(now+tonumber(ARGV[4])))
    redis.call('PEXPIRE',KEYS[1],math.max(tonumber(ARGV[3]),tonumber(ARGV[4]))*2)
  end
  return 0
end
redis.call('HSET',KEYS[1],ARGV[1],ARGV[2]..':'..(now+tonumber(ARGV[3])))
redis.call('PEXPIRE',KEYS[1],math.max(tonumber(ARGV[3]),tonumber(ARGV[4]))*2); return 1`;
const RENEW = `
local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000)
local value=redis.call('HGET',KEYS[1],ARGV[1]); if not value then return 0 end
local mode,expiry=string.match(value,'^(%a):(%d+)$')
if not expiry or tonumber(expiry)<=now then return 0 end
redis.call('HSET',KEYS[1],ARGV[1],mode..':'..(now+tonumber(ARGV[2])))
redis.call('PEXPIRE',KEYS[1],tonumber(ARGV[2])*2); return 1`;
const RELEASE = `return redis.call('HDEL',KEYS[1],ARGV[1])`;

/** Renewable Redis coordination only; SQL transactions retain their ordinary atomicity and constraints. */
export class RedisLeases implements LeaseManager {
  constructor(
    private readonly redis: Pick<Redis, "eval">,
    private readonly options: { prefix?: string; ttlMs?: number; waitMs?: number } = {},
  ) {}
  async acquire(name: string, mode: "read" | "write" = "write"): Promise<RedisLease> {
    const ttl = this.options.ttlMs ?? 60_000;
    const deadline = Date.now() + (this.options.waitMs ?? 30_000);
    const key = `${this.options.prefix ?? "byai:tenant-node:lock:"}${createHash("sha256").update(name).digest("hex")}`;
    const owner = randomUUID();
    do {
      if (
        Number(
          await this.redis.eval(
            ACQUIRE,
            1,
            key,
            owner,
            mode === "read" ? "r" : "w",
            ttl,
            Math.max(1, deadline - Date.now()),
          ),
        ) === 1
      ) {
        let lost = false,
          released = false;
        let pending: Promise<void> | undefined;
        const check = async () => {
          if (lost || released) throw new DomainError("LOCK_LOST");
          pending ??= (async () => {
            try {
              if (Number(await this.redis.eval(RENEW, 1, key, owner, ttl)) !== 1)
                throw new DomainError("LOCK_LOST");
            } catch (error) {
              lost = true;
              throw error;
            }
          })().finally(() => {
            pending = undefined;
          });
          await pending;
        };
        const timer = setInterval(
          () => {
            void check().catch(() => {});
          },
          Math.max(25, Math.floor(ttl / 3)),
        );
        timer.unref();
        return {
          check,
          release: async () => {
            if (released) return;
            released = true;
            clearInterval(timer);
            try {
              await pending;
            } catch {
              /* owner-only removal remains safe after a lost lease */
            }
            await this.redis.eval(RELEASE, 1, key, owner);
          },
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    await this.redis.eval(RELEASE, 1, key, owner);
    throw new DomainError("LOCK_TIMEOUT");
  }
}
