import { afterEach, describe, expect, it } from "vitest";
import { getCommonGatewayMetadata } from "./doc-shared.js";

const STORE_KEY = "__OPENCLAW_BYAI_CHANNEL_SESSION_CONTEXT_STORE__";

afterEach(() => {
  delete (globalThis as typeof globalThis & { [STORE_KEY]?: unknown })[STORE_KEY];
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
