import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { RedisSharedQuotaReader } from "../src/infrastructure/coordination/shared-quota-reader.js";
import { errorStatus } from "../src/interfaces/contracts/errors.js";
import { DomainError } from "../src/domain/errors.js";

const payload = {
  schemaVersion: 1,
  enterpriseId: "10",
  revision: "9007199254740993",
  mode: "LIMITED",
  limits: { memberLimit: 100, groupLimit: 20, groupMemberLimit: 2, agentLimit: 1 },
  updatedAt: "2026-10-27T01:00:00Z",
};
function projection(value: unknown = payload) {
  const json = JSON.stringify(value);
  return {
    revision: payload.revision,
    payloadHash: createHash("sha256").update(json).digest("hex"),
    payload: json,
  };
}

describe("shared Redis quota projection", () => {
  it("reads the complete hash without adding a deployment environment to the key", async () => {
    const hgetall = vi.fn(async () => projection());
    const reader = new RedisSharedQuotaReader({ hgetall });
    expect(await reader.read("10")).toEqual(payload);
    expect(hgetall).toHaveBeenCalledExactlyOnceWith("byclaw:shared:quota:v1:{10}");
  });

  it("allows a missing key and honors a custom prefix", async () => {
    const hgetall = vi.fn(async () => ({}));
    expect(
      await new RedisSharedQuotaReader({ hgetall }, { keyPrefix: "quota:" }).read("10"),
    ).toBeNull();
    expect(hgetall).toHaveBeenCalledExactlyOnceWith("quota:{10}");
  });

  it("preserves the maximum signed int64 revision without converting it to a JavaScript number", async () => {
    const value = { ...payload, revision: "9223372036854775807" };
    const hash = { ...projection(value), revision: value.revision };
    expect(await new RedisSharedQuotaReader({ hgetall: async () => hash }).read("10")).toEqual(
      value,
    );
  });

  it.each(["0", "01", "-1", "+1", "1.0", "1e3", "", " 1", "1 ", "9223372036854775808"])(
    "rejects noncanonical or out-of-range int64 revision %j even when hash and JSON agree",
    async (revision) => {
      const hash = { ...projection({ ...payload, revision }), revision };
      await expect(
        new RedisSharedQuotaReader({ hgetall: async () => hash }).read("10"),
      ).rejects.toMatchObject({ code: "QUOTA_UNAVAILABLE" });
    },
  );

  it("accepts zero and the maximum signed int32 quota limits", async () => {
    const value = {
      ...payload,
      limits: {
        memberLimit: 0,
        groupLimit: 2147483647,
        groupMemberLimit: 2147483647,
        agentLimit: 0,
      },
    };
    expect(
      await new RedisSharedQuotaReader({ hgetall: async () => projection(value) }).read("10"),
    ).toEqual(value);
  });

  it.each(["memberLimit", "groupLimit", "groupMemberLimit", "agentLimit"])(
    "rejects %s beyond the Java int range",
    async (key) => {
      const value = { ...payload, limits: { ...payload.limits, [key]: 2147483648 } };
      await expect(
        new RedisSharedQuotaReader({ hgetall: async () => projection(value) }).read("10"),
      ).rejects.toMatchObject({ code: "QUOTA_UNAVAILABLE" });
    },
  );

  it.each([
    { ...payload, schemaVersion: 2 },
    { ...payload, enterpriseId: "11" },
    { ...payload, revision: "1" },
    { ...payload, mode: "other" },
    { ...payload, limits: { ...payload.limits, agentLimit: -1 } },
    { ...payload, limits: { ...payload.limits, memberLimit: 0.1 } },
    { ...payload, limits: { ...payload.limits, groupLimit: Number.MAX_SAFE_INTEGER + 1 } },
    { ...payload, limits: { groupMemberLimit: 2, agentLimit: 1 } },
    { ...payload, updatedAt: "yesterday" },
    { ...payload, updatedAt: "2026-02-30T01:00:00Z" },
  ])("rejects a malformed present policy rather than treating it as legacy: %j", async (value) => {
    await expect(
      new RedisSharedQuotaReader({ hgetall: async () => projection(value) }).read("10"),
    ).rejects.toMatchObject({ code: "QUOTA_UNAVAILABLE" });
  });

  it.each([
    { revision: "1" },
    { ...projection(), payloadHash: "0".repeat(64) },
    { ...projection(), payload: "{" },
  ])("rejects incomplete or corrupt hashes: %j", async (value) => {
    await expect(
      new RedisSharedQuotaReader({ hgetall: async () => value }).read("10"),
    ).rejects.toMatchObject({ code: "QUOTA_UNAVAILABLE" });
  });

  it("warns and defaults to allowing Redis read failure without exposing error text", async () => {
    const warn = vi.fn();
    const reader = new RedisSharedQuotaReader(
      {
        hgetall: async () => {
          throw new Error("private connection information");
        },
      },
      { warn },
    );
    expect(await reader.read("10")).toBeNull();
    expect(warn).toHaveBeenCalledExactlyOnceWith("QUOTA_REDIS_UNAVAILABLE", "10");
  });

  it("can reject Redis read failure and maps policy unavailability to HTTP 503", async () => {
    await expect(
      new RedisSharedQuotaReader(
        {
          hgetall: async () => {
            throw new Error("offline");
          },
        },
        { failurePolicy: "REJECT" },
      ).read("10"),
    ).rejects.toMatchObject({ code: "QUOTA_UNAVAILABLE" });
    expect(errorStatus(new DomainError("QUOTA_UNAVAILABLE"))).toBe(503);
  });

  it("rejects a present key with the wrong Redis type even when outages are allowed", async () => {
    await expect(
      new RedisSharedQuotaReader({
        hgetall: async () => {
          throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        },
      }).read("10"),
    ).rejects.toMatchObject({ code: "QUOTA_UNAVAILABLE" });
  });

  it("re-reads each addition so a policy change takes effect without restarting", async () => {
    let value = projection();
    const reader = new RedisSharedQuotaReader({ hgetall: async () => value });
    expect((await reader.read("10"))?.mode).toBe("LIMITED");
    value = projection({ ...payload, mode: "UNLIMITED" });
    expect((await reader.read("10"))?.mode).toBe("UNLIMITED");
  });
});
