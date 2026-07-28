import { describe, expect, it, vi } from "vitest";
import {
  ExecutionDescriptorClient,
  parseSse,
  validateExternalUrl,
} from "../src/index.js";

describe("third-party connector common", () => {
  it("loads and validates a matching execution descriptor without exposing blocked headers", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        data: {
          resourceId: "1001",
          revision: 3,
          integrationType: " interface ",
          endpoint: "https://vendor.example.test/stream",
          headers: {
            Authorization: "Bearer vendor-token",
            Host: "evil.example",
            Cookie: "secret",
            "Beyond-Token": "vendor-beyond-token",
            "X-Vendor": "ok",
          },
        },
      }),
    );
    const client = new ExecutionDescriptorClient({
      baseUrl: "http://byclaw-be.test",
      timeoutMs: 1_000,
      fetchImpl: fetchImpl as typeof fetch,
      allowedExternalHosts: ["vendor.example.test"],
    });

    const descriptor = await client.get({
      resourceId: "1001",
      beyondToken: "user-token",
      systemCode: "BYAI",
      expectedIntegrationType: "INTERFACE",
    });

    expect(descriptor).toEqual({
      resourceId: "1001",
      revision: 3,
      integrationType: "INTERFACE",
      endpoint: "https://vendor.example.test/stream",
      headers: {
        Authorization: "Bearer vendor-token",
        Cookie: "secret",
        "Beyond-Token": "vendor-beyond-token",
        "X-Vendor": "ok",
      },
    });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://byclaw-be.test/byaiService/api/internal/v1/digital-employees/1001/execution-descriptor",
    );
    expect(init?.headers).toMatchObject({
      "Beyond-Token": "user-token",
      "System-Code": "BYAI",
    });
  });

  it("parses multiline SSE data and flushes an event without a trailing blank line", async () => {
    const body = new Response(
      ": heartbeat\r\nevent: message\r\ndata: first\r\ndata: second\r\n\r\ndata: tail",
    ).body;
    expect(body).not.toBeNull();
    const events = [];
    for await (const event of parseSse(body!)) {
      events.push(event);
    }
    expect(events).toEqual([
      { event: "message", data: "first\nsecond" },
      { data: "tail" },
    ]);
  });

  it("blocks local and insecure external endpoints by default", () => {
    expect(() => validateExternalUrl("http://vendor.example.test/stream")).toThrow(
      "protocol is not allowed",
    );
    expect(() => validateExternalUrl("https://127.0.0.1/stream")).toThrow(
      "host is not allowed",
    );
  });
});
