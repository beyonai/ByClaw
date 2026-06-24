import { afterEach, describe, expect, it } from "vitest";
import {
  getCommonGatewayMetadata,
  resolveLangfuseParentObservationId,
  resolveLangfuseTraceId,
} from "./doc-shared.js";

const STORE_KEY = "__OPENCLAW_BYAI_CHANNEL_SESSION_CONTEXT_STORE__";

afterEach(() => {
  delete (globalThis as typeof globalThis & { [STORE_KEY]?: unknown })[STORE_KEY];
});

describe("resolveLangfuseParentObservationId", () => {
  it("reads Langfuse parent observation id from resource context", () => {
    expect(
      resolveLangfuseParentObservationId({
        resource_context: {
          langfuse_parent_observation_id: "405506aa1c59aa26",
        },
      }),
    ).toBe("405506aa1c59aa26");
  });
});

describe("resolveLangfuseTraceId", () => {
  it("uses a valid channel trace id when no explicit Langfuse trace id exists", () => {
    expect(
      resolveLangfuseTraceId({
        resource_context: {
          channel_trace_id: "4BF92F3577B34DA6A3CE929D0E0E4736",
        },
      }),
    ).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("ignores non-OTel channel trace ids for Langfuse trace adoption", () => {
    expect(
      resolveLangfuseTraceId({
        resource_context: {
          channel_trace_id: "trace-4bf92f3577b34da6a3ce929d0e0e4736",
        },
      }),
    ).toBe("");
  });
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
