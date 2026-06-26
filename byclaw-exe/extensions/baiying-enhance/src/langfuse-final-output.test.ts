import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractFinalAssistantOutput,
  scheduleLangfuseFinalOutputBackfill,
} from "./langfuse-final-output.js";

describe("extractFinalAssistantOutput", () => {
  it("uses the last assistant text message", () => {
    expect(
      extractFinalAssistantOutput([
        { role: "assistant", content: "first" },
        { role: "user", content: "next" },
        { role: "assistant", text: " final answer " },
      ]),
    ).toBe("final answer");
  });

  it("flattens assistant content blocks", () => {
    expect(
      extractFinalAssistantOutput([
        {
          role: "assistant",
          content: [
            { type: "text", text: "hello " },
            { type: "text", content: "world" },
          ],
        },
      ]),
    ).toBe("hello world");
  });
});

describe("scheduleLangfuseFinalOutputBackfill", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("backfills trace and OpenClaw high-level span outputs", async () => {
    vi.useFakeTimers();
    vi.stubEnv("LANGFUSE_BASE_URL", "http://langfuse.local/");
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
    vi.stubEnv("USER_CODE", "user-1");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/public/observations?")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "1111111111111111", name: "openclaw.message.processed", type: "SPAN" },
              { id: "2222222222222222", name: "openclaw.run", type: "SPAN" },
              { id: "3333333333333333", name: "openclaw.model.call", type: "GENERATION" },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    scheduleLangfuseFinalOutputBackfill({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      sessionId: "session-1",
      output: "final answer",
    });
    await vi.advanceTimersByTimeAsync(2_000);

    const bodies = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies).toHaveLength(3);
    expect(bodies[0].batch[0]).toMatchObject({
      type: "trace-create",
      body: {
        id: "4bf92f3577b34da6a3ce929d0e0e4736",
        sessionId: "session-1",
        userId: "user-1",
        output: "final answer",
      },
    });
    expect(bodies.slice(1).map((body) => body.batch[0].body.id)).toEqual([
      "1111111111111111",
      "2222222222222222",
    ]);
    expect(bodies.slice(1).every((body) => body.batch[0].body.output === "final answer"))
      .toBe(true);
  });
});
