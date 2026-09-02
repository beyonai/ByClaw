import { describe, expect, it, vi } from "vitest";
import {
  CODE_BY_FRAMEWORK_CONNECTOR_ID,
  CodeByFrameworkConnector,
} from "../src/index.js";

describe("CodeByFrameworkConnector", () => {
  it("dispatches BYCLAW_CODE through callAgent and preserves the root trace", async () => {
    const callAgent = vi.fn(async () => ({
      status: "QUEUED",
      messageId: "delegation-1:request",
      parentMessageId: "delegation-1",
      targetAgentType: "BYCLAW_CODE_user-1",
    }));
    const connector = new CodeByFrameworkConnector({
      redis: redis() as never,
      gatewayClient: { cancelTask: vi.fn() },
      callbacks: pendingCallbacks(),
      callAgent,
    });
    const execution = await connector.start(request(), {
      signal: new AbortController().signal,
    });

    expect(connector.id).toBe(CODE_BY_FRAMEWORK_CONNECTOR_ID);
    expect(execution.ref.connectorId).toBe(CODE_BY_FRAMEWORK_CONNECTOR_ID);
    expect(callAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAgentType: "BY_SUPER",
        targetAgentType: "BYCLAW_CODE_user-1",
        messageId: "delegation-1:request",
        parentMessageId: "delegation-1",
        traceId: "trace-parent-1",
        extraPayload: expect.objectContaining({ agent_id: "1001" }),
      }),
    );
  });

  it("reports a callAgent routing failure without consuming a Redis result stream", async () => {
    const connector = new CodeByFrameworkConnector({
      redis: redis() as never,
      gatewayClient: { cancelTask: vi.fn() },
      callbacks: pendingCallbacks(),
      callAgent: vi.fn(async () => ({
        status: "FAILED",
        messageId: "delegation-1:request",
        parentMessageId: "delegation-1",
        targetAgentType: "BYCLAW_CODE_user-1",
        error_code: "AGENT_TYPE_UNAVAILABLE",
        error: "worker offline",
      })),
    });
    await expect(
      connector.start(request(), { signal: new AbortController().signal }),
    ).rejects.toThrow("AGENT_TYPE_UNAVAILABLE");
  });
});

function request(): Parameters<CodeByFrameworkConnector["start"]>[0] {
  return {
    userCode: "user-1",
    sessionId: "session-1",
    runId: "run-1",
    traceId: "trace-parent-1",
    delegationId: "delegation-1",
    agent: {
      id: "1001",
      name: "Code Agent",
      execution: { connectorId: CODE_BY_FRAMEWORK_CONNECTOR_ID, targetId: "1001" },
    },
    task: "Implement the change",
    attachments: [],
    metadata: {},
  };
}

function redis() {
  return {
    ping: vi.fn(async () => "PONG"),
    quit: vi.fn(async () => "OK"),
    status: "ready",
  };
}

function pendingCallbacks() {
  return {
    wait: vi.fn(() => ({ promise: new Promise(() => undefined), dispose: vi.fn() })),
  };
}
