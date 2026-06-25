import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLangfuseToolObservation,
  deriveLangfuseToolObservationId,
  updateLangfuseToolObservation,
} from "./langfuse-tool-observation.js";

describe("langfuse tool observation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("derives a stable 16 hex observation id from trace and tool call", () => {
    const id = deriveLangfuseToolObservationId({
      traceId: "A05E92A05D9123B1B03EF16B9CB50F2D",
      toolCallId: "call-1",
      sessionKey: "agent:baiying-agent-1:direct:100",
    });

    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(
      deriveLangfuseToolObservationId({
        traceId: "a05e92a05d9123b1b03ef16b9cb50f2d",
        toolCallId: "call-1",
        sessionKey: "agent:baiying-agent-1:direct:100",
      }),
    ).toBe(id);
  });

  it("creates a Langfuse span through public ingestion", async () => {
    vi.stubEnv("LANGFUSE_BASE_URL", "https://langfuse.example.test/");
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 207 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createLangfuseToolObservation({
        observationId: "405506aa1c59aa26",
        traceId: "a05e92a05d9123b1b03ef16b9cb50f2d",
        sessionId: "10028604",
        userId: "0027024710",
        input: { query: "hello" },
        metadata: { toolCallId: "call-1" },
        startTime: new Date("2026-06-22T06:00:00.000Z"),
      }),
    ).resolves.toBe(true);

    const [, init] = fetchMock.mock.calls[0]!;
    const payload = JSON.parse(String((init as RequestInit).body));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://langfuse.example.test/api/public/ingestion",
      expect.objectContaining({ method: "POST" }),
    );
    expect(payload.batch[0]).toMatchObject({
      type: "span-create",
      body: {
        id: "405506aa1c59aa26",
        traceId: "a05e92a05d9123b1b03ef16b9cb50f2d",
        name: "baiying_call",
        sessionId: "10028604",
        userId: "0027024710",
        input: { query: "hello" },
        metadata: {
          toolCallId: "call-1",
          byclawToolObservation: true,
        },
      },
    });
  });

  it("updates a Langfuse span through public ingestion", async () => {
    vi.stubEnv("LANGFUSE_BASE_URL", "https://langfuse.example.test/");
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 207 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateLangfuseToolObservation({
        observationId: "405506aa1c59aa26",
        output: { success: true },
        endTime: new Date("2026-06-22T06:00:01.000Z"),
      }),
    ).resolves.toBe(true);

    const [, init] = fetchMock.mock.calls[0]!;
    const payload = JSON.parse(String((init as RequestInit).body));
    expect(payload.batch[0]).toMatchObject({
      type: "span-update",
      body: {
        id: "405506aa1c59aa26",
        endTime: "2026-06-22T06:00:01.000Z",
        output: { success: true },
      },
    });
  });
});
