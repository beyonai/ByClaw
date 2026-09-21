import { WorkerRunner } from "@byclaw/by-framework";
import { describe, expect, it, vi } from "vitest";
import { APP_CONFIG_DEFAULTS } from "../config/config-defaults.js";

describe("Worker 并发配置与框架兼容性", () => {
  it.each([
    { maxConcurrency: APP_CONFIG_DEFAULTS.worker.maxConcurrency, expected: 11 },
    { maxConcurrency: 2, expected: 2 },
  ])("并发上限 $maxConcurrency 时启动 $expected 个未完成任务", async ({ maxConcurrency, expected }) => {
    const runner = new WorkerRunner(
      { workerId: "concurrency-test", agentTypes: ["BY_SUPER"] },
      { redisClient: {} as never, maxConcurrency },
    );
    vi.spyOn(runner, "initialize").mockResolvedValue(undefined);
    vi.spyOn(runner, "release").mockResolvedValue(undefined);
    let finishTasks!: () => void;
    const pending = new Promise<void>((resolve) => { finishTasks = resolve; });
    const process = vi.spyOn(runner, "processAndAck").mockImplementation(() => pending);
    vi.spyOn(runner, "poll")
      .mockResolvedValueOnce(Array.from({ length: 11 }, (_, index) => ({
        streamName: "test-stream",
        msgId: String(index),
        data: {} as never,
      })))
      .mockImplementation(async () => {
        await pending;
        return [];
      });

    const running = runner.start({ handleSignals: false });
    try {
      await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(expected));
    } finally {
      runner.stop();
      finishTasks();
      await running;
    }
  });
});
