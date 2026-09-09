import { describe, expect, it, vi } from "vitest";
import type { ConnectorRequest } from "@byclaw/by-conductor";
import {
  ByFrameworkConnector,
  type ByFrameworkConnectorOptions,
} from "../src/index.js";

function createHarness(
  options: Omit<ByFrameworkConnectorOptions, "connectorId" | "targetAgentTypeResolver"> = {},
) {
  const callAgent = vi.fn(async () => ({
    status: "QUEUED",
    messageId: "delegation-1:request",
    parentMessageId: "delegation-1",
    targetAgentType: "BYCLAW_EXE_user-1",
  }));
  const cancelTask = vi.fn(async () => ({
    success: true,
    message_id: "delegation-1",
    execution_id: "execution-1",
    worker_id: "worker-1",
    status: "CANCEL_REQUESTED",
    timestamp: Date.now(),
  }));
  const redis = {
    ping: vi.fn(async () => "PONG"),
    quit: vi.fn(async () => "OK"),
    status: "ready",
  };
  const connector = new ByFrameworkConnector({
    redis: redis as never,
    gatewayClient: { cancelTask },
    callAgent,
    sourceAgentType: "BY_SUPER",
    ...options,
    connectorId: "test-by-framework",
    targetAgentTypeResolver: (request) =>
      request.agent.execution.targetAgentType?.trim() || `BYCLAW_EXE_${request.userCode}`,
  });
  return {
    connector,
    callAgent,
    cancelTask,
    redis,
  };
}

describe("ByFrameworkConnector", () => {
  it("passes project metadata without overriding cwd and uses the session for temporary files", async () => {
    const harness = createHarness();
    const req = request();
    const project = { project_id: 42, project_name: "项目甲", workspace: "/by/projects/project-42" };
    req.metadata.project_info = project;
    await harness.connector.start(req, { signal: new AbortController().signal });
    const input = harness.callAgent.mock.calls[0][0];
    expect(input.metadata.project_info).toEqual(project);
    expect(input.extraPayload).not.toHaveProperty("cwd");
    expect(input.content).toContain("Your session workspace is `/by/.sessions/external-session-1/`");
    expect(input.content).toContain("Place temporary artifacts and temporary files");
    expect(input.content).toContain("Decide where to save final deliverables");
    expect(input.content).not.toContain("Your project workspace is");
  });

  it("uses callAgent, preserves the parent traceId and returns callback completion", async () => {
    const harness = createHarness();
    const req = request();
    const execution = await harness.connector.start(req, {
      signal: new AbortController().signal,
    });

    expect(harness.callAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "external-session-1",
        traceId: "trace-parent-1",
        sourceAgentType: "BY_SUPER",
        targetAgentType: "BYCLAW_EXE_user-1",
        messageId: "delegation-1:request",
        parentMessageId: "delegation-1",
        waitForReply: true,
        userCode: "user-1",
        metadata: expect.objectContaining({
          parent_run_id: "run-1",
          delegation_id: "delegation-1",
          delegated_agent_id: "1001",
          delegated_agent_name: "Analyst",
          delegated_agent_type: "BYCLAW_EXE_user-1",
          caller_parent_message_id: "parent-message-1",
        }),
      }),
    );
    expect(execution.completionMode).toBe("callback");
    expect(execution.events).toBeUndefined();
    expect("xread" in harness.redis).toBe(false);
  });

  it("resumes a persisted external reference without dispatching a duplicate task", async () => {
    const harness = createHarness();
    const execution = await harness.connector.start(request(), {
      signal: new AbortController().signal,
    });
    const resumed = await harness.connector.resume!(execution.ref, {
      signal: new AbortController().signal,
    });
    expect(resumed.completionMode).toBe("callback");
    expect(resumed.events).toBeUndefined();
    expect(harness.callAgent).toHaveBeenCalledOnce();
  });

  it("forwards attachments and the shared session workspace through callAgent", async () => {
    const harness = createHarness();
    const req = request();
    req.attachments = [
      {
        id: "123",
        name: "report.xlsx",
        mediaType: "application/vnd.openxmlformats",
        size: 1024,
        path: "/.sessions/external-session-1/report.xlsx",
        provenance: "by-framework",
      },
    ];
    await harness.connector.start(req, {
      signal: new AbortController().signal,
    });

    const input = harness.callAgent.mock.calls[0][0];
    const messages = input.content as Array<{
      content: { text: string; files: Array<Record<string, unknown>> };
    }>;
    expect(messages[0].content.text).toContain("/by/.sessions/external-session-1/report.xlsx");
    expect(messages[0].content.text).toContain("Place temporary artifacts and temporary files");
    expect(messages[0].content.text).toContain("Decide where to save final deliverables");
    expect(messages[0].content.files[0]).toMatchObject({
      fileId: "123",
      fileName: "report.xlsx",
      filePath: "/.sessions/external-session-1/report.xlsx",
    });
  });

  it("keeps cancellation idempotent without polling Redis execution state", async () => {
    const harness = createHarness();
    const execution = await harness.connector.start(request(), {
      signal: new AbortController().signal,
    });
    await execution.cancel("user cancelled");
    await execution.cancel("duplicate");
    expect(harness.cancelTask).toHaveBeenCalledOnce();
    expect(await harness.connector.health()).toMatchObject({ healthy: true });
  });
});

function request(): ConnectorRequest {
  return {
    userCode: "user-1",
    userName: "User",
    sessionId: "session-1",
    runId: "run-1",
    traceId: "trace-parent-1",
    delegationId: "delegation-1",
    externalSessionId: "external-session-1",
    parentMessageId: "parent-message-1",
    agent: {
      id: "1001",
      code: "analyst",
      name: "Analyst",
      execution: { connectorId: "test-by-framework", targetId: "1001" },
    },
    task: "analyze",
    attachments: [],
    metadata: { "Beyond-Token": "token-value" },
  };
}
