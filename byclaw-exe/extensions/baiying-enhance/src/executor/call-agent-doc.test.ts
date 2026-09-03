import { describe, expect, it, vi } from "vitest";

import { pollDocResult } from "./doc-shared.js";

describe("pollDocResult cancellation", () => {
  it("returns an aborted result without reporting a timeout", async () => {
    const controller = new AbortController();
    controller.abort(new Error("用户停止了轮询"));
    const xread = vi.fn();

    const result = await pollDocResult({
      redis: { xread } as never,
      sessionId: "session-1",
      traceId: "trace-1",
      messageId: "message-1",
      timeoutSec: 30,
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      success: false,
      event_type: "aborted",
      text: "用户停止了轮询",
      abort_reason: "用户停止了轮询",
    });
    expect(result.text).not.toContain("轮询超时");
    expect(xread).not.toHaveBeenCalled();
  });

  it("stops an in-flight blocking read when the caller aborts", async () => {
    const controller = new AbortController();
    const xread = vi.fn(() => new Promise(() => {}));
    const pending = pollDocResult({
      redis: { xread } as never,
      sessionId: "session-1",
      traceId: "trace-1",
      messageId: "message-1",
      timeoutSec: 30,
      intervalSec: 5,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(xread).toHaveBeenCalledTimes(1));

    controller.abort(new Error("停止阻塞轮询"));

    await expect(pending).resolves.toMatchObject({
      success: false,
      event_type: "aborted",
      text: "停止阻塞轮询",
    });
  });
});
