import { describe, expect, it } from "vitest";
import { buildCallAgentLangfuseEnvelope } from "./call-agent.js";

describe("buildCallAgentLangfuseEnvelope", () => {
  it("preserves the callAgent Langfuse lineage and compatibility aliases", () => {
    const result = buildCallAgentLangfuseEnvelope({
      traceId: "channel-trace-1",
      sessionId: "session-1",
      langfuseTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      langfuseParentObservationId: "405506aa1c59aa26",
      baseMetadata: { toolCallId: "call-1" },
      basePayload: { query: "hello" },
    });

    expect(result.dispatchTraceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(result.originalTraceId).toBe("channel-trace-1");
    expect(result.metadata).toMatchObject({
      toolCallId: "call-1",
      langfuseParentObservationId: "405506aa1c59aa26",
      langfuse_parent_observation_id: "405506aa1c59aa26",
      parentObservationId: "405506aa1c59aa26",
      parent_observation_id: "405506aa1c59aa26",
      langfuseTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      langfuse_trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
      sessionId: "session-1",
      session_id: "session-1",
      langfuseSessionId: "session-1",
      langfuse_session_id: "session-1",
      "langfuse.session.id": "session-1",
      "session.id": "session-1",
      byclaw_original_trace_id: "channel-trace-1",
      channel_trace_id: "channel-trace-1",
      openclaw_trace_id: "channel-trace-1",
    });
    expect(result.payload).toMatchObject({
      query: "hello",
      langfuseParentObservationId: "405506aa1c59aa26",
      langfuse_parent_observation_id: "405506aa1c59aa26",
      parentObservationId: "405506aa1c59aa26",
      parent_observation_id: "405506aa1c59aa26",
      langfuseTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      langfuse_trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
      langfuseSessionId: "session-1",
      langfuse_session_id: "session-1",
      "langfuse.session.id": "session-1",
      "session.id": "session-1",
      byclaw_original_trace_id: "channel-trace-1",
      channel_trace_id: "channel-trace-1",
      openclaw_trace_id: "channel-trace-1",
    });
    expect(result.payloadLangfuseContext).toMatchObject({
      langfuseParentObservationId: "405506aa1c59aa26",
      langfuse_parent_observation_id: "405506aa1c59aa26",
      parentObservationId: "405506aa1c59aa26",
      parent_observation_id: "405506aa1c59aa26",
      langfuseTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      langfuse_trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
      langfuseSessionId: "session-1",
      langfuse_session_id: "session-1",
      "langfuse.session.id": "session-1",
      "session.id": "session-1",
      byclaw_original_trace_id: "channel-trace-1",
    });
  });
});
