import type { ConnectorRequest } from "@byclaw/by-conductor";
import { ExecutionDescriptorClient } from "@byclaw/connector-third-party-common";
import { describe, expect, it, vi } from "vitest";
import { ThirdPartyPageConnector } from "../src/index.js";

describe("ThirdPartyPageConnector", () => {
  it("emits a PAGE interaction and completes after the user response", async () => {
    const connector = new ThirdPartyPageConnector({
      descriptors: new ExecutionDescriptorClient({
        baseUrl: "http://byclaw-be.test",
        timeoutMs: 1_000,
        allowedExternalHosts: ["vendor.example.test"],
        fetchImpl: vi.fn(async () =>
          Response.json({
            resourceId: "1001",
            revision: 9,
            integrationType: "PAGE",
            endpoint: "https://vendor.example.test/page",
            headers: {},
          }),
        ) as typeof fetch,
      }),
    });
    const execution = await connector.start(request(), {
      signal: new AbortController().signal,
    });
    const iterator = execution.events[Symbol.asyncIterator]();

    const requested = await iterator.next();
    expect(requested.value).toMatchObject({
      type: "input_required",
      interactionId: "delegation-1",
      request: {
        kind: "external_page",
        uiPayload: {
          sessionId: "session-1",
          runId: "run-1",
          delegationId: "delegation-1",
          agentId: "1001",
          agentName: "PAGE agent",
          args: { input: "fill the page" },
        },
      },
      resumeToken: {
        resourceId: "1001",
        descriptorRevision: 9,
      },
    });

    await execution.respondToInput?.("delegation-1", {
      action: "submit",
      answers: { result: "ok" },
    });
    expect((await iterator.next()).value).toEqual({
      type: "completed",
      result: {
        status: "completed",
        output: '{"result":"ok"}',
        artifacts: [],
      },
    });
  });

  it("resumes a persisted PAGE wait without emitting a duplicate card", async () => {
    const connector = new ThirdPartyPageConnector({
      descriptors: {} as ExecutionDescriptorClient,
    });
    const execution = await connector.resume(
      {
        connectorId: "third-party-page",
        executionId: "delegation-1",
        metadata: {
          resourceId: "1001",
          agentId: "1001",
          agentName: "PAGE agent",
          sessionId: "session-1",
          runId: "run-1",
          task: "fill the page",
        },
      },
      { signal: new AbortController().signal },
    );
    const iterator = execution.events[Symbol.asyncIterator]();
    const waiting = iterator.next();

    await execution.respondToInput?.("delegation-1", {
      action: "submit",
      text: "page result",
    });

    expect((await waiting).value).toEqual({
      type: "completed",
      result: {
        status: "completed",
        output: "page result",
        artifacts: [],
      },
    });
  });
});

function request(): ConnectorRequest {
  return {
    userCode: "user-1",
    sessionId: "session-1",
    runId: "run-1",
    delegationId: "delegation-1",
    agent: {
      id: "1001",
      name: "PAGE agent",
      execution: {
        connectorId: "third-party-page",
        targetId: "1001",
      },
    },
    task: "fill the page",
    attachments: [],
    metadata: { "Beyond-Token": "user-token" },
  };
}
