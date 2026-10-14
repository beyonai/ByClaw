import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshMcpCapability } from "../mcp-client.js";
import { buildResourceCallAgentPayload, executeMcp } from "./mcp.js";

vi.mock("../call-agent.js", () => ({
  executeViaCallAgent: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildResourceCallAgentPayload", () => {
  it("adds resource_ids alongside OBJECT resource codes", () => {
    const payload = buildResourceCallAgentPayload(
      {
        query: "ignored",
        arguments: {
          page: 1,
          call_object_ids: ["stale_object_code"],
          resource_ids: ["stale_resource_id"],
        },
      },
      {
        resourceType: "OBJECT",
        resourceCode: "po_users",
        resourceId: "10000018",
      },
    );

    expect(payload).toMatchObject({
      page: 1,
      call_object_ids: ["po_users"],
      resource_ids: ["10000018"],
    });
    expect(payload.query).toBeUndefined();
  });

  it("adds resource_ids alongside VIEW resource codes", () => {
    const payload = buildResourceCallAgentPayload(
      { arguments: { ownerUserCode: "0027003729" } },
      {
        resourceType: "VIEW",
        resourceCode: "todo_view",
        resourceId: "10810924",
      },
    );

    expect(payload).toMatchObject({
      ownerUserCode: "0027003729",
      call_view_ids: ["todo_view"],
      resource_ids: ["10810924"],
    });
  });
});

describe("streamable HTTP MCP session lifecycle", () => {
  it("uses the discovery session for the subsequent tools/call request", async () => {
    const discoveryFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } }),
          {
            status: 200,
            headers: { "content-type": "application/json", "mcp-session-id": "session-123" },
          },
        ),
      )
      .mockResolvedValueOnce(new Response("", { status: 202 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: { tools: [{ name: "run", inputSchema: { type: "object" } }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const capability = {
      resource_type: "MCP",
      name: "mcp",
      metadata: { resource_id: "mcp-1" },
      mcp: { server_url: "http://mcp.test", transfer_type: "streamable_http", tools: [] },
    };

    await refreshMcpCapability({
      capability: capability as never,
      authContext: { session: "", userId: "", headers: {} },
      fetchImpl: discoveryFetch as unknown as typeof fetch,
    });

    const callFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", callFetch);

    const result = await executeMcp({
      capability: capability as never,
      action: "run",
      parameters: {},
      authContext: { session: "", userId: "", headers: {} },
    });

    expect(result.success).toBe(true);
    const callHeaders = callFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(callHeaders["Mcp-Session-Id"]).toBe("session-123");
  });
});
