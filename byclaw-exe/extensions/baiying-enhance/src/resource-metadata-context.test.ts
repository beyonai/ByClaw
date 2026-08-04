import { describe, expect, it } from "vitest";
import type { AdaptedManagedAgent } from "./agent-adapter.js";
import { buildExecutorResourceContext } from "./resource-metadata-context.js";

function makeAgentFixture(): AdaptedManagedAgent {
  return {
    sourceKey: "100",
    agentId: "baiying-agent-100",
    providerKey: "baiying-m-100",
    modelRef: "baiying-m-100/test-model",
    allowSpawnFrom: ["main"],
    listEntry: {
      id: "baiying-agent-100",
      name: "DingTalk assistant",
      identity: { name: "DingTalk assistant" },
    },
  };
}

describe("buildExecutorResourceContext", () => {
  it("preserves Langfuse trace and parent observation aliases", () => {
    expect(
      buildExecutorResourceContext({
        agent: makeAgentFixture(),
        sessionKey: "agent:dws:direct:100",
        channelSessionId: "100",
        channelTraceId: "channel-trace-1",
        langfuseTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        langfuseParentObservationId: "405506aa1c59aa26",
      }),
    ).toMatchObject({
      langfuseParentObservationId: "405506aa1c59aa26",
      langfuse_parent_observation_id: "405506aa1c59aa26",
      langfuseTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      langfuse_trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
    });
  });
});
