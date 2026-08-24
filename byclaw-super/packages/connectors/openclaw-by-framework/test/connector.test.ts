import { describe, expect, it, vi } from "vitest";
import {
  OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID,
  OpenClawByFrameworkConnector,
} from "../src/index.js";

describe("OpenClawByFrameworkConnector", () => {
  it("uses the OpenClaw connector id and user-scoped default worker", async () => {
    const sendMessage = vi.fn(async () => ({
      success: true,
      message_id: "message-1",
      trace_id: "trace-1",
      target_worker_id: "worker-1",
      timestamp: Date.now(),
      status: "QUEUED",
    }));
    const connector = new OpenClawByFrameworkConnector({
      redis: {
        xread: vi.fn(),
        ping: vi.fn(async () => "PONG"),
        quit: vi.fn(async () => "OK"),
        status: "ready",
      } as never,
      gatewayClient: { sendMessage, cancelTask: vi.fn() },
    });
    const request: Parameters<OpenClawByFrameworkConnector["start"]>[0] = {
      userCode: "user-1",
      sessionId: "session-1",
      runId: "run-1",
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

    const execution = await connector.start(request, {
      signal: new AbortController().signal,
    });

    expect(connector.id).toBe("openclaw-by-framework");
    expect(execution.ref.connectorId).toBe("openclaw-by-framework");
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAgentType: "BY_SUPER",
        targetAgentType: "BYCLAW_EXE_user-1",
      }),
    );
  });
});
