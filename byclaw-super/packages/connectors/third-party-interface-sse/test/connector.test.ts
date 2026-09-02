import type { ConnectorRequest } from "@byclaw/by-conductor";
import { ExecutionDescriptorClient } from "@byclaw/connector-third-party-common";
import { describe, expect, it, vi } from "vitest";
import { ThirdPartyInterfaceSseConnector } from "../src/index.js";

describe("ThirdPartyInterfaceSseConnector", () => {
  it("posts the compatibility request and normalizes streamed deltas", async () => {
    const descriptors = descriptorClient("INTERFACE", "https://vendor.example.test/stream");
    const fetchImpl = vi.fn(async () =>
      new Response(
        [
          'data: {"choices":[{"delta":{"content":"hello "}}]}',
          "",
          'data: {"choices":[{"delta":{"content":"world"},"finish_reason":"stop"}]}',
          "",
        ].join("\n"),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );
    const connector = new ThirdPartyInterfaceSseConnector({
      descriptors,
      fetchImpl: fetchImpl as typeof fetch,
    });

    const execution = await connector.start(request(), {
      signal: new AbortController().signal,
    });
    const events = [];
    for await (const event of execution.events) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "output_delta", text: "hello " },
      { type: "output_delta", text: "world" },
      {
        type: "completed",
        result: {
          status: "completed",
          output: "hello world",
          artifacts: [],
        },
      },
    ]);
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      chatContent: "analyze",
      sessionId: "session-1",
      chatId: "delegation-1",
      agentId: "1001",
      stream: true,
    });
    expect(connector.capabilities.resumable).toBe(false);
  });
});

function descriptorClient(
  integrationType: "INTERFACE",
  endpoint: string,
): ExecutionDescriptorClient {
  return new ExecutionDescriptorClient({
    baseUrl: "http://byclaw-be.test",
    timeoutMs: 1_000,
    allowedExternalHosts: ["vendor.example.test"],
    fetchImpl: vi.fn(async () =>
      Response.json({
        resourceId: "1001",
        integrationType,
        endpoint,
        headers: { "X-Vendor": "one" },
      }),
    ) as typeof fetch,
  });
}

function request(): ConnectorRequest {
  return {
    userCode: "user-1",
    sessionId: "session-1",
    runId: "run-1",
    delegationId: "delegation-1",
    agent: {
      id: "1001",
      name: "Vendor agent",
      execution: {
        connectorId: "third-party-interface-sse",
        targetId: "1001",
      },
    },
    task: "analyze",
    attachments: [],
    metadata: {
      "Beyond-Token": "user-token",
      "System-Code": "BYAI",
    },
  };
}
