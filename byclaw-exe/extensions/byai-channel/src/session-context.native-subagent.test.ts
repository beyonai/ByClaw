import { describe, expect, it, vi } from "vitest";

vi.mock("./utils.js", () => ({
  generateRandomId: () => "mock-message-id",
}));

vi.mock("./diagnostics.js", () => ({
  emitByaiSdkFirstResponse: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/routing", () => ({
  resolveAgentIdFromSessionKey: () => "test",
}));

import {
  bindActiveSdkRequestRunId,
  clearActiveSdkRequestRecord,
  hasPendingNativeChildRun,
  markActiveSdkNativeChildRunTerminal,
  markActiveSdkRequestSubagentSpawned,
  markActiveSdkRootLifecycleFinished,
  markActiveSdkRootLifecycleStarted,
  registerActiveSdkRequest,
  shouldCompleteActiveSdkRequest,
  type ActiveSdkRequest,
  type NativeChildRunTerminalSource,
} from "./session-context.js";

/** 建一个已启动 root run 的 request，模拟入站 agent 正在跑。 */
function setupRequest(suffix: string): ActiveSdkRequest {
  const request = registerActiveSdkRequest({
    accountId: `acct-${suffix}`,
    sessionKey: `agent:test:direct:${suffix}`,
    to: `user:${suffix}`,
    sessionId: suffix,
    traceId: `trace-${suffix}`,
    language: "zh_CN",
    languageProvided: true,
  });
  bindActiveSdkRequestRunId(request.sessionKey, `run-inbound-${suffix}`);
  markActiveSdkRootLifecycleStarted(request.sessionKey, `run-inbound-${suffix}`);
  return request;
}

/** 入站 run 收尾（sessions_spawn 之后 parent 先结束本轮）。 */
function finishInboundRun(request: ActiveSdkRequest, suffix: string): void {
  markActiveSdkRootLifecycleFinished(request.sessionKey, "end", `run-inbound-${suffix}`);
}

/**
 * core 给 direct-path announce 续跑分配的 runId（announce 幂等键充当 runId）。
 * 见 `src/agents/announce-idempotency.ts` 与 `src/agents/subagent-announce-delivery.ts`。
 */
function announceRunId(childSessionKey: string, childRunId: string): string {
  return `announce:v1:${childSessionKey}:${childRunId}`;
}

/** parent 就某个 child 的 announce 续跑：start 后立即 end。 */
function runAnnounceFollowup(
  request: ActiveSdkRequest,
  childSessionKey: string,
  childRunId: string,
): void {
  const runId = announceRunId(childSessionKey, childRunId);
  bindActiveSdkRequestRunId(request.sessionKey, runId);
  markActiveSdkRootLifecycleStarted(request.sessionKey, runId);
  markActiveSdkRootLifecycleFinished(request.sessionKey, "end", runId);
}

async function spawnChild(
  request: ActiveSdkRequest,
  childSessionKey: string,
  childRunId: string,
): Promise<void> {
  await markActiveSdkRequestSubagentSpawned(request.sessionKey, childSessionKey, childRunId);
}

function reportTerminal(childRunId: string, source: NativeChildRunTerminalSource) {
  return markActiveSdkNativeChildRunTerminal({ childRunId, source });
}

describe("native subagent completion gate", () => {
  it("completes without arming a follow-up wait when subagent_ended arrives after the announce run", async () => {
    const suffix = "ended-last";
    const request = setupRequest(suffix);
    await spawnChild(request, `agent:test:subagent:${suffix}`, `run-child-${suffix}`);
    finishInboundRun(request, suffix);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    // announce 续跑先跑完，本 channel 此时还没收到任何 child 终态事实。
    runAnnounceFollowup(request, `agent:test:subagent:${suffix}`, `run-child-${suffix}`);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    const outcome = reportTerminal(`run-child-${suffix}`, "subagent_ended");
    expect(outcome?.transitioned).toBe(true);
    expect(outcome?.allChildRunsTerminal).toBe(true);
    // 关键回归：已观测到 announce 续跑，不能再 arm 等待窗口空等一整个超时。
    expect(outcome?.awaitingFollowupArmed).toBe(false);
    expect(request.awaitingFollowup).toBe(false);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);

    clearActiveSdkRequestRecord(request);
  });

  it("arms the follow-up wait when the child terminal fact precedes the announce run", async () => {
    const suffix = "child-first";
    const request = setupRequest(suffix);
    await spawnChild(request, `agent:test:subagent:${suffix}`, `run-child-${suffix}`);
    finishInboundRun(request, suffix);

    const outcome = reportTerminal(`run-child-${suffix}`, "child_lifecycle");
    expect(outcome?.awaitingFollowupArmed).toBe(true);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    // announce 续跑到来：awaitingFollowup 转成挂在该 run 的 followupRunStarted。
    markActiveSdkRootLifecycleStarted(
      request.sessionKey,
      announceRunId(`agent:test:subagent:${suffix}`, `run-child-${suffix}`),
    );
    expect(request.awaitingFollowup).toBe(false);
    expect(request.followupRunStarted).toBe(true);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    markActiveSdkRootLifecycleFinished(
      request.sessionKey,
      "end",
      announceRunId(`agent:test:subagent:${suffix}`, `run-child-${suffix}`),
    );
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);

    clearActiveSdkRequestRecord(request);
  });

  it("reaches the same terminal state for every arrival order of the child terminal channels", async () => {
    const orders: NativeChildRunTerminalSource[][] = [
      ["subagent_progress", "child_lifecycle", "agent_end", "subagent_ended"],
      ["subagent_ended", "agent_end", "child_lifecycle", "subagent_progress"],
      ["agent_end", "subagent_ended", "subagent_progress", "child_lifecycle"],
      // 老核场景：subagent_progress 完全缺席，判定必须不受影响。
      ["child_lifecycle", "agent_end", "subagent_ended"],
      // spawnMode=session：core 从不发 subagent_ended。
      ["child_lifecycle", "agent_end"],
    ];

    for (const [index, order] of orders.entries()) {
      const suffix = `order-${index}`;
      const request = setupRequest(suffix);
      await spawnChild(request, `agent:test:subagent:${suffix}`, `run-child-${suffix}`);
      finishInboundRun(request, suffix);
      runAnnounceFollowup(request, `agent:test:subagent:${suffix}`, `run-child-${suffix}`);

      const transitions = order.map((source) => reportTerminal(`run-child-${suffix}`, source));
      // 只有首个信号推进状态，其余全部去重。
      expect(transitions.map((outcome) => outcome?.transitioned)).toEqual(
        order.map((_, position) => position === 0),
      );
      expect(hasPendingNativeChildRun(request)).toBe(false);
      expect(request.awaitingFollowup).toBe(false);
      expect(shouldCompleteActiveSdkRequest(request)).toBe(true);
      expect(request.nativeChildRuns.get(`run-child-${suffix}`)?.terminalSources.size).toBe(
        order.length,
      );

      clearActiveSdkRequestRecord(request);
    }
  });

  it("keeps the gate closed until every sibling child run is terminal", async () => {
    const suffix = "siblings";
    const request = setupRequest(suffix);
    const childA = `agent:test:subagent:${suffix}-a`;
    const childB = `agent:test:subagent:${suffix}-b`;
    await spawnChild(request, childA, `run-child-${suffix}-a`);
    await spawnChild(request, childB, `run-child-${suffix}-b`);
    finishInboundRun(request, suffix);
    runAnnounceFollowup(request, childA, `run-child-${suffix}-a`);
    runAnnounceFollowup(request, childB, `run-child-${suffix}-b`);

    const first = reportTerminal(`run-child-${suffix}-a`, "child_lifecycle");
    expect(first?.allChildRunsTerminal).toBe(false);
    expect(hasPendingNativeChildRun(request)).toBe(true);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    const second = reportTerminal(`run-child-${suffix}-b`, "subagent_ended");
    expect(second?.allChildRunsTerminal).toBe(true);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);

    clearActiveSdkRequestRecord(request);
  });

  it("waits for each concurrent child's own announce run before completing", async () => {
    // 并发 sessions_spawn 的实测回归：A 的 announce 续跑跑完时 B 还在跑，B 终态时
    // 只能凭「B 自己的续跑还没开始」继续等；记账若按次数共享，就会把 A 的续跑记到 B
    // 头上、在 B 的续跑启动前放行完成门，B 的 announce 输出整段丢失。
    const suffix = "concurrent-announce";
    const request = setupRequest(suffix);
    const childA = `agent:test:subagent:${suffix}-a`;
    const childB = `agent:test:subagent:${suffix}-b`;
    await spawnChild(request, childA, `run-child-${suffix}-a`);
    await spawnChild(request, childB, `run-child-${suffix}-b`);
    finishInboundRun(request, suffix);

    reportTerminal(`run-child-${suffix}-a`, "agent_end");
    runAnnounceFollowup(request, childA, `run-child-${suffix}-a`);
    // A 的续跑只能记到 A 名下；记错到仍在跑的 B 身上，B 终态就不会再等自己的续跑。
    expect(request.nativeChildRuns.get(`run-child-${suffix}-a`)?.announceRunObserved).toBe(true);
    expect(request.nativeChildRuns.get(`run-child-${suffix}-b`)?.announceRunObserved).toBe(false);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    const outcome = reportTerminal(`run-child-${suffix}-b`, "agent_end");
    expect(outcome?.allChildRunsTerminal).toBe(true);
    expect(outcome?.awaitingFollowupArmed).toBe(true);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    // B 自己的 announce 续跑启动后接管完成门，跑完才放行。
    const announceB = announceRunId(childB, `run-child-${suffix}-b`);
    bindActiveSdkRequestRunId(request.sessionKey, announceB);
    markActiveSdkRootLifecycleStarted(request.sessionKey, announceB);
    expect(request.awaitingFollowup).toBe(false);
    expect(request.followupRunStarted).toBe(true);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    markActiveSdkRootLifecycleFinished(request.sessionKey, "end", announceB);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);

    clearActiveSdkRequestRecord(request);
  });

  it("re-arms the wait when one announce run ends while a sibling's has not started", async () => {
    // 实测回归：两个 subagent 交错收尾——上海先终态、广州后终态，随后上海的 announce 续跑
    // 跑完，而广州的续跑还没启动。若续跑收尾时无条件清掉 awaitingFollowup，完成门会在此
    // 放行（日志中的 reason=message_sent:ok），广州 announce 的总结整段落在前端关流之后。
    const suffix = "interleaved-announce";
    const request = setupRequest(suffix);
    const childSh = `agent:test:subagent:${suffix}-sh`;
    const childGz = `agent:test:subagent:${suffix}-gz`;
    await spawnChild(request, childSh, `run-child-${suffix}-sh`);
    await spawnChild(request, childGz, `run-child-${suffix}-gz`);
    finishInboundRun(request, suffix);

    expect(reportTerminal(`run-child-${suffix}-sh`, "agent_end")?.allChildRunsTerminal).toBe(false);
    const bothTerminal = reportTerminal(`run-child-${suffix}-gz`, "agent_end");
    expect(bothTerminal?.allChildRunsTerminal).toBe(true);
    expect(bothTerminal?.awaitingFollowupArmed).toBe(true);

    // 上海的续跑跑完，但广州的续跑一次都没启动过 ⇒ 必须继续等，不能放行完成门。
    runAnnounceFollowup(request, childSh, `run-child-${suffix}-sh`);
    expect(request.nativeChildRuns.get(`run-child-${suffix}-gz`)?.announceRunObserved).toBe(false);
    expect(request.awaitingFollowup).toBe(true);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    runAnnounceFollowup(request, childGz, `run-child-${suffix}-gz`);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);

    clearActiveSdkRequestRecord(request);
  });

  it("credits an announce run by its runId, not by spawn order", async () => {
    // 归属只能靠 runId。若按「第一个还没记账的 child」之类的位置规则分配，后 spawn 的 child
    // 先 announce 时就会把这笔记到先 spawn 的 child 头上：前者被当成已 announce 而提前放行，
    // 后者永远等不到自己的续跑。这里让 B 先 announce，锁死这种位置式记账。
    const suffix = "announce-out-of-order";
    const request = setupRequest(suffix);
    const childA = `agent:test:subagent:${suffix}-a`;
    const childB = `agent:test:subagent:${suffix}-b`;
    await spawnChild(request, childA, `run-child-${suffix}-a`);
    await spawnChild(request, childB, `run-child-${suffix}-b`);
    finishInboundRun(request, suffix);

    runAnnounceFollowup(request, childB, `run-child-${suffix}-b`);
    expect(request.nativeChildRuns.get(`run-child-${suffix}-b`)?.announceRunObserved).toBe(true);
    expect(request.nativeChildRuns.get(`run-child-${suffix}-a`)?.announceRunObserved).toBe(false);

    // 两个 child 都终态时，A 的续跑还没来，完成门必须继续等 A。
    reportTerminal(`run-child-${suffix}-b`, "agent_end");
    const outcome = reportTerminal(`run-child-${suffix}-a`, "agent_end");
    expect(outcome?.allChildRunsTerminal).toBe(true);
    expect(outcome?.awaitingFollowupArmed).toBe(true);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    runAnnounceFollowup(request, childA, `run-child-${suffix}-a`);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);

    clearActiveSdkRequestRecord(request);
  });

  it("ignores terminal signals for runs outside the ledger", async () => {
    const suffix = "unknown-run";
    const request = setupRequest(suffix);
    await spawnChild(request, `agent:test:subagent:${suffix}`, `run-child-${suffix}`);

    // root run 自己的 agent_end 也会流经同一入口，不能被误记成 child 终态。
    expect(reportTerminal(`run-inbound-${suffix}`, "agent_end")).toBeUndefined();
    expect(reportTerminal("run-never-spawned", "subagent_ended")).toBeUndefined();
    expect(hasPendingNativeChildRun(request)).toBe(true);

    clearActiveSdkRequestRecord(request);
  });

  it("registers a spawn once per child run across both spawn channels", async () => {
    const suffix = "spawn-idempotent";
    const request = setupRequest(suffix);
    const childSessionKey = `agent:test:subagent:${suffix}`;
    await spawnChild(request, childSessionKey, `run-child-${suffix}`);
    await spawnChild(request, childSessionKey, `run-child-${suffix}`);
    expect(request.nativeChildRuns.size).toBe(1);

    finishInboundRun(request, suffix);
    runAnnounceFollowup(request, childSessionKey, `run-child-${suffix}`);
    reportTerminal(`run-child-${suffix}`, "child_lifecycle");
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);

    clearActiveSdkRequestRecord(request);
  });
});
