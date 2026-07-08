import { afterEach, describe, expect, it, vi } from "vitest";
import { diagnoseTraceInSessionStreams, getCommonGatewayMetadata } from "./doc-shared.js";
import type { RedisCompatClient } from "../redis-compat.js";

const STORE_KEY = "__OPENCLAW_BYAI_CHANNEL_SESSION_CONTEXT_STORE__";

afterEach(() => {
  delete (globalThis as typeof globalThis & { [STORE_KEY]?: unknown })[STORE_KEY];
  vi.unstubAllEnvs();
});

describe("getCommonGatewayMetadata", () => {
  it("falls back to shared channel request context by session key", () => {
    (globalThis as typeof globalThis & { [STORE_KEY]?: unknown })[STORE_KEY] = {
      channelRequestContextsBySessionKey: new Map([
        [
          "agent:doc:main",
          {
            sessionKey: "agent:doc:main",
            traceId: "trace-doc",
            createdAt: Date.now(),
            fields: {
              language: "en-US",
              request_headers: {
                "Beyond-Token": "bt-123",
              },
            },
          },
        ],
      ]),
    };

    expect(
      getCommonGatewayMetadata({
        resource_context: {
          session_key: "agent:doc:main",
        },
      }),
    ).toEqual({
      "channel-trace-id": "trace-doc",
      language: "en-US",
      request_headers: {
        "Beyond-Token": "bt-123",
      },
    });
  });
});

describe("diagnoseTraceInSessionStreams", () => {
  it("scans every Redis Cluster master with the v2 session stream pattern", async () => {
    vi.stubEnv("REDIS_KEY_SCHEMA_VERSION", "v2");
    const nodeA = {
      scan: vi.fn(async () => ["0", []]),
    };
    const nodeB = {
      scan: vi.fn(async () => ["0", ["byai_gateway:v2:session:{session-1}:data_stream"]]),
    };
    const redis = {
      nodes: vi.fn(() => [nodeA, nodeB]),
      xrevrange: vi.fn(async () => [
        [
          "1-0",
          [
            "data",
            JSON.stringify({
              event_type: "finalAnswer",
              session_id: "session-1",
              trace_id: "trace-1",
              data: { content: "done" },
            }),
          ],
        ],
      ]),
    } as unknown as RedisCompatClient;

    const result = await diagnoseTraceInSessionStreams({
      redis,
      traceId: "trace-1",
    });

    expect(result.matched).toBe(true);
    expect(result.scanned_stream_count).toBe(1);
    expect(nodeA.scan).toHaveBeenCalledWith(
      "0",
      "MATCH",
      "byai_gateway:v2:session:{*}:data_stream",
      "COUNT",
      "300",
    );
    expect(nodeB.scan).toHaveBeenCalledWith(
      "0",
      "MATCH",
      "byai_gateway:v2:session:{*}:data_stream",
      "COUNT",
      "300",
    );
  });
});
