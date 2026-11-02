import { describe, expect, it, vi } from "vitest";
import { validateRemoteResourceUse } from "./resource-use-guard.js";

describe("resource execution authorization", () => {
  it("accepts server approval and forwards authentication to the backend only", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "0", data: { allowed: true } })));
    await validateRemoteResourceUse({ baseUrl: "https://example.invalid/byaiService/", resourceId: "5001",
      headers: { "Beyond-Token": "test-token" }, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith("https://example.invalid/byaiService/tool/checkResourceUse",
      expect.objectContaining({ body: '{"resourceId":"5001"}', headers: expect.objectContaining({ "Beyond-Token": "test-token" }) }));
  });
  it("blocks revoked rights, rejected tokens, malformed replies and an unavailable backend", async () => {
    for (const response of [new Response(JSON.stringify({ code: 0, data: { allowed: false } })),
      new Response(JSON.stringify({ code: -1 })), new Response("{}"), new Response("unauthorized", { status: 401 })]) {
      await expect(validateRemoteResourceUse({ baseUrl: "https://example.invalid", resourceId: "5001", headers: {},
        fetchImpl: vi.fn().mockResolvedValue(response) })).rejects.toThrow();
    }
    await expect(validateRemoteResourceUse({ baseUrl: "", resourceId: "5001", headers: {} })).rejects.toThrow();
  });
});
