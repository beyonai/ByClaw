import type { ConnectorRequest } from "@byclaw/by-conductor";
import { ExecutionDescriptorClient } from "@byclaw/connector-third-party-common";
import { describe, expect, it, vi } from "vitest";
import { ThirdPartyA2aConnector } from "../src/index.js";

describe("ThirdPartyA2aConnector", () => {
  it("loads the Agent Card and maps A2A message/status events", async () => {
    const descriptors = new ExecutionDescriptorClient({
      baseUrl: "http://byclaw-be.test",
      timeoutMs: 1_000,
      allowedExternalHosts: ["vendor.example.test"],
      fetchImpl: vi.fn(async () =>
        Response.json({
          resourceId: "1001",
          integrationType: "A2A",
          endpoint: "https://vendor.example.test/card?token=opaque",
          headers: {},
        }),
      ) as typeof fetch,
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ url: "https://vendor.example.test/rpc" }),
      )
      .mockResolvedValueOnce(
        new Response(
          [
            'data: {"jsonrpc":"2.0","result":{"kind":"message","role":"agent","parts":[{"kind":"text","text":"answer"}]}}',
            "",
            'data: {"jsonrpc":"2.0","result":{"kind":"status-update","status":{"state":"completed"}}}',
            "",
          ].join("\n"),
          { status: 200 },
        ),
      );
    const connector = new ThirdPartyA2aConnector({
      descriptors,
      fetchImpl: fetchImpl as typeof fetch,
      allowedExternalHosts: ["vendor.example.test"],
    });

    const execution = await connector.start(request(), {
      signal: new AbortController().signal,
    });
    const events = [];
    for await (const event of execution.events) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "output_delta", text: "answer" },
      {
        type: "completed",
        result: {
          status: "completed",
          output: "answer",
          artifacts: [],
        },
      },
    ]);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      "https://vendor.example.test/rpc?token=opaque",
    );
    const rpcBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(rpcBody).toMatchObject({
      jsonrpc: "2.0",
      id: "delegation-1",
      method: "message/stream",
      params: {
        message: {
          messageId: "delegation-1",
          contextId: "session-1",
        },
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
      name: "A2A agent",
      execution: {
        connectorId: "third-party-a2a",
        targetId: "1001",
      },
    },
    task: "analyze",
    attachments: [],
    metadata: { "Beyond-Token": "user-token" },
  };
}
