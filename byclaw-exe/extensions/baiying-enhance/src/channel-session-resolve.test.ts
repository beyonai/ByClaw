import { afterEach, describe, expect, it } from "vitest";
import {
  parseUserPrefixedSessionId,
  resolveChannelRequestContextBySessionKey,
  resolveChannelSessionIdForTool,
} from "./channel-session-resolve.js";

const STORE_KEY = "__OPENCLAW_BYAI_CHANNEL_SESSION_CONTEXT_STORE__";

afterEach(() => {
  delete (globalThis as typeof globalThis & { [STORE_KEY]?: unknown })[STORE_KEY];
});

describe("parseUserPrefixedSessionId", () => {
  it("parses user: prefix", () => {
    expect(parseUserPrefixedSessionId("user:abc-123")).toBe("abc-123");
  });
  it("returns undefined for non-prefixed", () => {
    expect(parseUserPrefixedSessionId("abc")).toBeUndefined();
  });
});

describe("resolveChannelSessionIdForTool", () => {
  it("prefers explicit ChannelSessionId on ctx", () => {
    const r = resolveChannelSessionIdForTool({ ChannelSessionId: "gw-1" }, "agent:x:main");
    expect(r.sessionId).toBe("gw-1");
    expect(r.source).toBe("ctx_channel_session_id");
  });

  it("parses OriginatingTo", () => {
    const r = resolveChannelSessionIdForTool({ OriginatingTo: "user:gw-2" }, "agent:x:main");
    expect(r.sessionId).toBe("gw-2");
    expect(r.source).toBe("ctx_originating_to");
  });

  it("parses To before OriginatingTo", () => {
    const r = resolveChannelSessionIdForTool(
      { To: "user:gw-to", OriginatingTo: "user:gw-orig" },
      "agent:x:main",
    );
    expect(r.sessionId).toBe("gw-to");
    expect(r.source).toBe("ctx_to");
  });

  it("returns none when nothing matches", () => {
    const r = resolveChannelSessionIdForTool({}, "agent:x:main");
    expect(r.sessionId).toBeUndefined();
    expect(r.source).toBe("none");
  });

  it("enriches explicit channel session with shared context by session key", () => {
    (globalThis as typeof globalThis & { [STORE_KEY]?: unknown })[STORE_KEY] = {
      channelRequestContextsBySessionKey: new Map([
        ["agent:x:main", { sessionKey: "agent:x:main", traceId: "trace-shared", createdAt: Date.now(), fields: { language: "en-US" } }],
      ]),
    };

    const r = resolveChannelSessionIdForTool(
      { ChannelSessionId: "gw-ctx", ChannelTraceId: "trace-shared" },
      "agent:x:main",
    );
    expect(r.sessionId).toBe("gw-ctx");
    expect(r.traceId).toBe("trace-shared");
    expect(r.language).toBe("en-US");
  });

  it("resolves language from shared session context for active sessions", () => {
    (globalThis as typeof globalThis & { [STORE_KEY]?: unknown })[STORE_KEY] = {
      activeSdkRequestsBySession: new Map([
        ["agent:x:main", { sessionKey: "agent:x:main", sessionId: "gw-store", traceId: "trace-store", createdAt: Date.now() }],
      ]),
      activeSdkRequestsByChild: new Map(),
      channelRequestContextsBySessionKey: new Map([
        ["agent:x:main", { sessionKey: "agent:x:main", traceId: "trace-store", createdAt: Date.now(), fields: { language: "zh-CN" } }],
      ]),
    };

    const r = resolveChannelSessionIdForTool({}, "agent:x:main");
    expect(r.sessionId).toBe("gw-store");
    expect(r.traceId).toBe("trace-store");
    expect(r.language).toBe("zh-CN");
    expect(r.source).toBe("active_session");
    expect(resolveChannelRequestContextBySessionKey("agent:x:main")?.fields?.language).toBe("zh-CN");
  });
});
