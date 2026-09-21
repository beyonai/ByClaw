import { SessionManager, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ExecutionOwnershipLostError } from "../src/domain/execution-ownership.js";
import { PiLeaderSession } from "../src/pi-leader-session.js";

describe("Pi persistence failures during an active model request", () => {
  it.each(["answer", "reasoning", "checkpoint"] as const)(
    "immediately handles %s write rejection and preserves ownership loss",
    async (kind) => {
      let listener: (event: AgentSessionEvent) => void = () => undefined;
      let releasePrompt: () => void = () => undefined;
      const promptPending = new Promise<void>((resolve) => { releasePrompt = resolve; });
      const unsubscribe = vi.fn();
      const session = {
        sessionManager: SessionManager.inMemory("/test"),
        subscribe: vi.fn((callback: typeof listener) => {
          listener = callback;
          return unsubscribe;
        }),
        setThinkingLevel: vi.fn(),
        setActiveToolsByName: vi.fn(),
        prompt: vi.fn(async () => {
          listener((kind === "checkpoint"
            ? { type: "entry_appended" }
            : {
                type: "message_update",
                assistantMessageEvent: {
                  type: kind === "answer" ? "text_delta" : "thinking_delta",
                  delta: "output",
                },
              }) as AgentSessionEvent);
          await promptPending;
          throw new Error("model aborted");
        }),
        // Keep prompt pending after abort to prove the write rejection is handled
        // before the model request settles, not only in the final await.
        abort: vi.fn(async () => undefined),
      };
      const leader = Reflect.construct(PiLeaderSession, [
        session, 0, { enabled: false }, "session-test", undefined,
      ]) as PiLeaderSession;
      const lost = new ExecutionOwnershipLostError("run-test");
      const fail = vi.fn(async () => { throw lost; });
      const running = leader.run({
        message: "test",
        attachments: [],
        thinkingLevel: "off",
        agents: [],
        sessionContext: { schemaVersion: 1 },
        currentTime: Date.now(),
        signal: new AbortController().signal,
        onDelta: fail,
        onReasoningDelta: fail,
        onCheckpoint: fail,
        delegate: async () => { throw new Error("unused"); },
        askUser: async () => { throw new Error("unused"); },
      });
      const result = expect(running).rejects.toBe(lost);
      await vi.waitFor(() => expect(session.abort).toHaveBeenCalledOnce());
      await new Promise((resolve) => setTimeout(resolve, 10));
      releasePrompt();
      await result;
      expect(fail).toHaveBeenCalledOnce();
      expect(unsubscribe).toHaveBeenCalledOnce();
    },
  );
});
