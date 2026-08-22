import { describe, expect, it, vi } from "vitest";
import {
  OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID,
  OpenClawByFrameworkConnector,
} from "../src/index.js";

describe("OpenClawByFrameworkConnector", () => {
  it("dispatches the user-scoped worker through callAgent", async () => {
    const callAgent = vi.fn(async () => ({
      status: "QUEUED",
      messageId: "delegation-1:request",
      parentMessageId: "delegation-1",
      targetAgentType: "BYCLAW_EXE_user-1",
    }));
    const connector = new OpenClawByFrameworkConnector({
      redis: redis() as never,
      gatewayClient: { cancelTask: vi.fn() },
      callbacks: pendingCallbacks(),
      callAgent,
    });
    const execution = await connector.start(request(), {
      signal: new AbortController().signal,
    });

    expect(connector.id).toBe(OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID);
    expect(execution.ref.connectorId).toBe(OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID);
    expect(callAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAgentType: "BY_SUPER",
        targetAgentType: "BYCLAW_EXE_user-1",
        messageId: "delegation-1:request",
        parentMessageId: "delegation-1",
        traceId: "trace-1",
      }),
    );
  });
});

function request(): Parameters<OpenClawByFrameworkConnector["start"]>[0] {
  return {
    userCode: "user-1",
    sessionId: "session-1",
    runId: "run-1",
    traceId: "trace-1",
    delegationId: "delegation-1",
    agent: {
      id: "1001",
      name: "OpenClaw Agent",
      execution: {
        connectorId: OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID,
        targetId: "1001",
      },
    },
    task: "Analyze the request",
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
