import { afterEach, describe, expect, it, vi } from "vitest";
import { sendDocAsyncMessage } from "./doc-redis.js";
import type { RedisCompatClient } from "../redis-compat.js";

function fakeRedisClient() {
  const xadd = vi.fn(async () => "1-0");
  return {
    client: { xadd } as unknown as RedisCompatClient,
    xadd,
  };
}

const baseParams = {
  content: "hello",
  sessionId: "session-1",
  targetAgentType: "AGENT",
  targetWorkerId: "worker-1",
  tenantId: "tenant-1",
  extraPayload: {},
  parentMessageId: "parent-1",
  metadata: {},
} as const;

describe("sendDocAsyncMessage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses v2 agent_type stream names for raw DOC dispatch", async () => {
    vi.stubEnv("REDIS_KEY_SCHEMA_VERSION", "v2");
    const { client, xadd } = fakeRedisClient();

    await sendDocAsyncMessage(client, { ...baseParams, routeMode: "agent_type" });

    expect(xadd.mock.calls[0]?.[0]).toBe("byai_gateway:v2:ctrl:agent_type:AGENT");
  });

  it("uses v2 worker stream names for raw DOC dispatch", async () => {
    vi.stubEnv("REDIS_KEY_SCHEMA_VERSION", "v2");
    const { client, xadd } = fakeRedisClient();

    await sendDocAsyncMessage(client, { ...baseParams, routeMode: "worker" });

    expect(xadd.mock.calls[0]?.[0]).toBe("byai_gateway:v2:ctrl:worker:{worker-1}");
  });

  it("uses v2 capability stream names for raw DOC dispatch", async () => {
    vi.stubEnv("REDIS_KEY_SCHEMA_VERSION", "v2");
    const { client, xadd } = fakeRedisClient();

    await sendDocAsyncMessage(client, { ...baseParams, routeMode: "capability" });

    expect(xadd.mock.calls[0]?.[0]).toBe("byai_gateway:v2:ctrl:capability:{worker-1}");
  });
});
