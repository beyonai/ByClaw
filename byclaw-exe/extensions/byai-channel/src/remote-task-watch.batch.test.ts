import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  ensureRequest: vi.fn(),
  markAwaiting: vi.fn(),
  markDispatched: vi.fn(),
  removeDelegatedWork: vi.fn(),
}));

vi.mock("./remote-followup.js", () => ({
  classifyRemoteTaskFollowupError: () => "retryable",
  dispatchRemoteTaskFollowup: mocks.dispatch,
}));

vi.mock("./session-context.js", () => ({
  ensureActiveSdkRequestForDelegatedFollowup: mocks.ensureRequest,
  markActiveSdkAwaitingDelegatedFollowup: mocks.markAwaiting,
  markActiveSdkDelegatedFollowupDispatched: mocks.markDispatched,
  removeActiveSdkDelegatedWork: mocks.removeDelegatedWork,
}));

vi.mock("./utils.js", () => ({
  createRedisInstance: () => null,
}));

import {
  __remoteTaskWatchTestInternals,
  followUpRemoteTaskByToolCallId,
} from "./remote-task-watch.js";

const originalStateDir = process.env.OPENCLAW_STATE_DIR;
let stateDir = "";

function startedEvent(toolCallId: string, sessionKey = "agent:main:direct:s-1", eventAt = 1_000) {
  return {
    schemaVersion: 1 as const,
    type: "task_started" as const,
    eventId: `event-${toolCallId}`,
    eventAt,
    taskId: `message-${toolCallId}`,
    messageId: `message-${toolCallId}`,
    sessionId: `doc-${toolCallId}`,
    traceId: "trace-1",
    toolCallId,
    requesterSessionKey: sessionKey,
    createdAt: eventAt,
  };
}

function createState(events: ReturnType<typeof startedEvent>[]) {
  const state = { schemaVersion: 1 as const, tasks: {} };
  __remoteTaskWatchTestInternals.applyTaskEvents(state, events);
  return state;
}

function markResultReady(task: Record<string, unknown>, result: string): void {
  task.status = "result_ready";
  task.resultStatus = "ok";
  task.result = result;
  task.resultReadyAt = Date.now();
  task.updatedAt = task.resultReadyAt;
}

beforeEach(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), "byai-remote-batch-"));
  process.env.OPENCLAW_STATE_DIR = stateDir;
  mocks.dispatch.mockReset().mockResolvedValue({ runId: "run-followup" });
  mocks.ensureRequest.mockReset();
  mocks.markAwaiting.mockReset();
  mocks.markDispatched.mockReset();
  mocks.removeDelegatedWork.mockReset();
});

afterEach(async () => {
  if (originalStateDir === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = originalStateDir;
  }
  await rm(stateDir, { recursive: true, force: true });
});

describe("remote-task-watch session batches", () => {
  it("waits until every active task in the session has returned", () => {
    const state = createState([
      startedEvent("call-1"),
      startedEvent("call-2"),
      startedEvent("call-3"),
      startedEvent("other-call", "agent:main:direct:s-2"),
    ]);
    const group = __remoteTaskWatchTestInternals
      .groupActiveTasksByRequesterSessionKey(state)
      .get("agent:main:direct:s-1")!;

    markResultReady(group[0] as unknown as Record<string, unknown>, "answer-1");
    markResultReady(group[1] as unknown as Record<string, unknown>, "answer-2");
    expect(__remoteTaskWatchTestInternals.isRemoteTaskGroupReady(group)).toBe(false);

    markResultReady(group[2] as unknown as Record<string, unknown>, "answer-3");
    expect(__remoteTaskWatchTestInternals.isRemoteTaskGroupReady(group)).toBe(true);
    expect(__remoteTaskWatchTestInternals.groupActiveTasksByRequesterSessionKey(state).size).toBe(2);
  });

  it("writes one result file per tool call and delivers the group once", async () => {
    const state = createState([
      startedEvent("call-1"),
      startedEvent("call-2"),
      startedEvent("call-3"),
    ]);
    const group = __remoteTaskWatchTestInternals
      .groupActiveTasksByRequesterSessionKey(state)
      .get("agent:main:direct:s-1")!;
    group.forEach((task, index) => {
      markResultReady(task as unknown as Record<string, unknown>, `final-answer-${index + 1}`);
    });

    expect(
      await __remoteTaskWatchTestInternals.deliverReadyTaskGroup(group, {
        retryDelayMs: 10,
        maxAttempts: 3,
      }),
    ).toBe(true);

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.markDispatched).toHaveBeenCalledWith({
      requesterSessionKey: "agent:main:direct:s-1",
      runId: "run-followup",
    });
    expect(mocks.markAwaiting.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dispatch.mock.invocationCallOrder[0]!,
    );
    expect(mocks.dispatch.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.markDispatched.mock.invocationCallOrder[0]!,
    );
    expect(mocks.markDispatched.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.removeDelegatedWork.mock.invocationCallOrder[0]!,
    );
    const followup = mocks.dispatch.mock.calls[0]?.[0];
    expect(followup.tasks).toHaveLength(3);
    expect(group.every((task) => task.status === "delivered")).toBe(true);
    expect(mocks.removeDelegatedWork).toHaveBeenCalledTimes(3);

    for (const task of group) {
      const resultFile = JSON.parse(await readFile(task.resultFilePath!, "utf8"));
      expect(resultFile).toMatchObject({
        schemaVersion: 1,
        toolCallId: task.toolCallId,
        status: "ok",
        result: task.result,
        messageId: task.messageId,
        traceId: task.traceId,
      });
    }
  });

  it("retries and completes the whole group atomically", async () => {
    const state = createState([startedEvent("call-1"), startedEvent("call-2")]);
    const group = __remoteTaskWatchTestInternals
      .groupActiveTasksByRequesterSessionKey(state)
      .get("agent:main:direct:s-1")!;
    group.forEach((task, index) => {
      markResultReady(task as unknown as Record<string, unknown>, `answer-${index + 1}`);
    });
    mocks.dispatch.mockRejectedValueOnce(new Error("gateway unavailable"));

    await __remoteTaskWatchTestInternals.deliverReadyTaskGroup(group, {
      retryDelayMs: 10,
      maxAttempts: 3,
    });
    expect(group.every((task) => task.status === "retry" && task.deliveryAttempts === 1)).toBe(true);
    expect(new Set(group.map((task) => task.nextAttemptAt)).size).toBe(1);
    const firstAttemptPaths = mocks.dispatch.mock.calls[0]?.[0].tasks.map(
      (task: { resultFilePath: string }) => task.resultFilePath,
    );

    group.forEach((task) => {
      task.nextAttemptAt = undefined;
    });
    await __remoteTaskWatchTestInternals.deliverReadyTaskGroup(group, {
      retryDelayMs: 10,
      maxAttempts: 3,
    });
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
    expect(group.every((task) => task.status === "delivered" && task.deliveryAttempts === 2)).toBe(true);
    expect(
      mocks.dispatch.mock.calls[1]?.[0].tasks.map(
        (task: { resultFilePath: string }) => task.resultFilePath,
      ),
    ).toEqual(firstAttemptPaths);
  });

  it("unblocks a ready session group when a successful sync task is deleted", () => {
    const state = createState([
      startedEvent("call-async"),
      { ...startedEvent("call-sync"), pollAfter: Date.now() + 30 * 60 * 1_000 },
    ]);
    const initialGroup = __remoteTaskWatchTestInternals
      .groupActiveTasksByRequesterSessionKey(state)
      .get("agent:main:direct:s-1")!;
    markResultReady(initialGroup[0] as unknown as Record<string, unknown>, "async-answer");
    expect(__remoteTaskWatchTestInternals.isRemoteTaskGroupReady(initialGroup)).toBe(false);

    __remoteTaskWatchTestInternals.applyTaskEvents(state, [
      {
        schemaVersion: 1,
        type: "task_deleted",
        eventId: "delete-sync",
        eventAt: Date.now(),
        toolCallId: "call-sync",
      },
    ]);
    const remainingGroup = __remoteTaskWatchTestInternals
      .groupActiveTasksByRequesterSessionKey(state)
      .get("agent:main:direct:s-1")!;
    expect(remainingGroup.map((task) => task.toolCallId)).toEqual(["call-async"]);
    expect(__remoteTaskWatchTestInternals.isRemoteTaskGroupReady(remainingGroup)).toBe(true);
  });

  it("excludes delivered history when the same session starts another round", () => {
    const state = createState([startedEvent("call-old")]);
    const oldTask = Object.values(state.tasks)[0]!;
    oldTask.status = "delivered";
    __remoteTaskWatchTestInternals.applyTaskEvents(state, [startedEvent("call-new", undefined, 2_000)]);

    const group = __remoteTaskWatchTestInternals
      .groupActiveTasksByRequesterSessionKey(state)
      .get("agent:main:direct:s-1")!;
    expect(group.map((task) => task.toolCallId)).toEqual(["call-new"]);
  });

  it("waits for sibling tasks when final answers arrive through the external recovery API", async () => {
    const events = [startedEvent("call-1"), startedEvent("call-2")];
    const logPath = path.join(stateDir, "baiying-remote-tasks", "tasks.jsonl");
    await mkdir(path.dirname(logPath), { recursive: true });
    await writeFile(
      logPath,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );

    await Promise.all([
      followUpRemoteTaskByToolCallId("call-1", "answer-1"),
      followUpRemoteTaskByToolCallId("call-2", "answer-2"),
    ]);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch.mock.calls[0]?.[0].tasks).toHaveLength(2);
  });
});
