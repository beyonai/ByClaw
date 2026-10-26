import { describe, expect, it, vi } from "vitest";
import { postByClawBeJson, type PostByClawBeJsonInput } from "../business/byclaw-be-http.js";

const PATH = "/byaiService/query";
const DISCOVERED = "http://discovered.internal:8086/gateway";
const FALLBACK = "http://configured.internal:8086/prefix";

function request(fetchImpl: typeof fetch, overrides: Partial<PostByClawBeJsonInput> = {}) {
  return postByClawBeJson({
    fetchImpl,
    endpointResolver: { resolve: async () => DISCOVERED },
    fallbackBaseUrl: new URL(FALLBACK),
    timeoutMs: 1_000,
    path: PATH,
    beyondToken: "test-token",
    systemCode: "BYAI",
    extraHeaders: { language: "zh-CN" },
    body: { query: "employees" },
    label: "test",
    toError: (message) => new Error(message),
    ...overrides,
  });
}

describe("ByClaw BE query fallback", () => {
  it("retries an opted-in query once with the same credentials and body", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(Response.json({ code: 0, success: true, data: ["employee"] }));

    await expect(request(fetchImpl, { fallbackOnNetworkError: true })).resolves.toEqual(["employee"]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      `${DISCOVERED}${PATH}`,
      `${FALLBACK}${PATH}`,
    ]);
    const first = fetchImpl.mock.calls[0]?.[1];
    const retried = fetchImpl.mock.calls[1]?.[1];
    expect(retried).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Beyond-Token": "test-token",
        "System-Code": "BYAI",
        language: "zh-CN",
      },
      body: first?.body,
    });
    expect(retried?.signal).not.toBe(first?.signal);
  });

  it("does not replay writes or other requests that have not opted in", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));

    await expect(request(fetchImpl)).rejects.toThrow("ByClaw BE test request failed: fetch failed");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not retry when discovery already chose the configured URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));

    await expect(request(fetchImpl, {
      fallbackOnNetworkError: true,
      endpointResolver: { resolve: async () => `${FALLBACK}/` },
    })).rejects.toThrow("request failed");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("only calls the configured URL once when there is no online instance", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));

    await expect(request(fetchImpl, {
      fallbackOnNetworkError: true,
      endpointResolver: { resolve: async () => undefined },
    })).rejects.toThrow("request failed");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(`${FALLBACK}${PATH}`);
  });

  it("stops after a failed fallback attempt", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("discovered failed"))
      .mockRejectedValueOnce(new TypeError("configured failed"));

    await expect(request(fetchImpl, { fallbackOnNetworkError: true }))
      .rejects.toThrow("ByClaw BE test request failed: configured failed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 500])("does not retry HTTP %s responses", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));

    await expect(request(fetchImpl, { fallbackOnNetworkError: true }))
      .rejects.toThrow(`returned HTTP ${status}`);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not retry invalid business results", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValue(Response.json({ code: 403, msg: "not authorized" }));

    await expect(request(fetchImpl, { fallbackOnNetworkError: true }))
      .rejects.toThrow("returned invalid result: not authorized");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
