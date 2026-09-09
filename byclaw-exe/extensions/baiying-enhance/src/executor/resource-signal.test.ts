import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/routing", () => ({
  isSubagentSessionKey: () => false,
}));

import { executeMcp } from "./resource-types/mcp.js";
import { executeTool } from "./resource-types/tool.js";
import { executeToolkit } from "./resource-types/toolkit.js";
import { runLegacySseJsonRpcSequence } from "./mcp-legacy-sse.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function abortableFetch() {
  return vi.fn((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  );
}

describe("resource executor cancellation", () => {
  it("propagates cancellation to TOOL HTTP requests", async () => {
    const fetchMock = abortableFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pending = executeTool({
      capability: {
        resource_type: "TOOL",
        name: "tool",
        metadata: { resource_id: "tool-1" },
        tool: { url: "http://tool.test", input_schema: { type: "object" } },
      } as never,
      parameters: {},
      authContext: { session: "", userId: "", headers: {} },
      signal: controller.signal,
    });

    controller.abort(new Error("stop tool"));

    await expect(pending).resolves.toMatchObject({ success: false, error_code: "REQUEST_FAILED" });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("propagates cancellation to TOOLKIT HTTP requests", async () => {
    const fetchMock = abortableFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pending = executeToolkit({
      capability: {
        resource_type: "TOOLKIT",
        name: "toolkit",
        metadata: { resource_id: "toolkit-1" },
        tools: [{ name: "run", url: "http://toolkit.test", input_schema: { type: "object" } }],
      } as never,
      action: "run",
      parameters: {},
      authContext: { session: "", userId: "", headers: {} },
      signal: controller.signal,
    });

    controller.abort(new Error("stop toolkit"));

    await expect(pending).resolves.toMatchObject({ success: false, error_code: "REQUEST_FAILED" });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("propagates cancellation to streamable MCP HTTP requests", async () => {
    const fetchMock = abortableFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pending = executeMcp({
      capability: {
        resource_type: "MCP",
        name: "mcp",
        metadata: { resource_id: "mcp-1" },
        mcp: {
          server_url: "http://mcp.test",
          transfer_type: "streamable_http",
          tools: [{ name: "run", input_schema: { type: "object" } }],
        },
      } as never,
      action: "run",
      parameters: {},
      authContext: { session: "", userId: "", headers: {} },
      signal: controller.signal,
    });

    controller.abort(new Error("stop mcp"));

    await expect(pending).resolves.toMatchObject({ success: false, error_code: "MCP_CALL_FAILED" });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("propagates cancellation to legacy SSE MCP requests", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const stream = new ReadableStream({
        start(streamController) {
          init?.signal?.addEventListener(
            "abort",
            () => streamController.error(init?.signal?.reason),
            { once: true },
          );
        },
      });
      return Promise.resolve(
        new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
      );
    });

    const pending = runLegacySseJsonRpcSequence({
      sseUrl: "http://mcp.test/sse",
      headers: {},
      requests: [],
      timeoutMs: 30_000,
      signal: controller.signal,
      fetchImpl: fetchMock as typeof fetch,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort(new Error("stop legacy mcp"));

    await expect(pending).rejects.toThrow("stop legacy mcp");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
