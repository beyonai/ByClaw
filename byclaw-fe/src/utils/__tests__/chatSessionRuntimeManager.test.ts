import { chatSessionRuntimeManager } from '../chatSessionRuntimeManager';

describe('utils/chatSessionRuntimeManager', () => {
  beforeEach(() => {
    chatSessionRuntimeManager.clear();
  });

  it('does not revive a cancelled trace when delayed runtime frames arrive', () => {
    const stopped = {
      sessionId: 's1',
      traceId: 'trace-1',
      source: 'test-engine',
      status: 'cancelled',
      rootActive: false,
      acceptingInput: true,
      activeAgentCount: 0,
      activeChildCount: 0,
      waitingInteractionCount: 0,
      revision: 2,
      changedAt: 2000,
    };
    chatSessionRuntimeManager.register({ clientRequestId: 'req', sessionId: 's1', traceId: 'trace-1' });
    chatSessionRuntimeManager.applySessionRuntime({
      ...stopped,
      status: 'running',
      rootActive: true,
      acceptingInput: false,
    });
    chatSessionRuntimeManager.cancel('req');
    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(false);
    expect(
      chatSessionRuntimeManager.applySessionRuntime({
        ...stopped,
        status: 'running',
        rootActive: true,
        acceptingInput: false,
        activeAgentCount: 5,
        activeChildCount: 4,
        revision: 99,
        changedAt: 3000,
      })
    ).toBe(false);
    expect(chatSessionRuntimeManager.canAcceptInput('s1')).toBe(true);
    expect(
      chatSessionRuntimeManager.applySessionRuntime({
        ...stopped,
        traceId: 'trace-2',
        status: 'running',
        rootActive: true,
        acceptingInput: false,
        activeAgentCount: 1,
        revision: 1,
        changedAt: Date.now() + 1000,
      })
    ).toBe(true);
  });

  it('tracks running state by request and session', () => {
    chatSessionRuntimeManager.register({
      clientRequestId: 'client-req-1',
    });

    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(false);

    chatSessionRuntimeManager.bindSession('client-req-1', 's1');
    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(true);

    chatSessionRuntimeManager.complete('client-req-1');
    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(false);
  });

  it('keeps the pending session state while it is replaced with the real session', () => {
    chatSessionRuntimeManager.register({
      clientRequestId: 'client-req-1',
      sessionId: 'pending_client-req-1',
      restored: false,
    });

    // 项目列表替换临时会话项与 createSession 事件不是同一时刻，期间两个 ID 都应显示回答中。
    chatSessionRuntimeManager.bindSession('client-req-1', 's1');

    expect(chatSessionRuntimeManager.isSessionRunning('pending_client-req-1')).toBe(true);
    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(true);

    chatSessionRuntimeManager.complete('client-req-1');
    expect(chatSessionRuntimeManager.isSessionRunning('pending_client-req-1')).toBe(false);
    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(false);
  });

  it('hydrates restored running state from backend status', () => {
    chatSessionRuntimeManager.hydrateRunning({
      sessionId: 's1',
      running: true,
      clientRequestId: 'server-1',
      traceId: 'q1_a1',
      modelAnswerMessageId: 'a1',
    });

    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(true);
    expect(chatSessionRuntimeManager.getByTrace('s1', 'q1_a1')?.answerMessageId).toBe('a1');

    chatSessionRuntimeManager.hydrateRunning({
      sessionId: 's1',
      running: false,
      clientRequestId: 'server-1',
    });

    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(false);
  });

  it('does not mark an existing local running state as restored', () => {
    chatSessionRuntimeManager.register({
      clientRequestId: 'local-1',
      sessionId: 's1',
      restored: false,
    });

    chatSessionRuntimeManager.hydrateRunning({
      sessionId: 's1',
      running: true,
      clientRequestId: 'local-1',
      traceId: 'q1_a1',
      modelAnswerMessageId: 'a1',
    });

    const runtimeInfo = chatSessionRuntimeManager.getBySession('s1');
    expect(runtimeInfo?.clientRequestId).toBe('local-1');
    expect(runtimeInfo?.restored).toBe(false);
    expect(runtimeInfo?.traceId).toBe('q1_a1');
    expect(runtimeInfo?.answerMessageId).toBe('a1');
  });

  it('keeps a local stream active when the backend running status is temporarily stale', () => {
    chatSessionRuntimeManager.register({
      clientRequestId: 'local-1',
      sessionId: 's1',
      restored: false,
    });

    // 首轮流式回答建立后，运行状态接口可能暂时还未返回 running=true。
    chatSessionRuntimeManager.hydrateRunning({
      sessionId: 's1',
      running: false,
      clientRequestId: 'local-1',
    });

    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(true);

    chatSessionRuntimeManager.complete('local-1');
    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(false);
  });

  it('tracks the last applied stream id for restored sessions', () => {
    chatSessionRuntimeManager.hydrateRunning({
      sessionId: 's1',
      running: true,
      clientRequestId: 'local-1',
      traceId: 'q1_a1',
      modelAnswerMessageId: 'a1',
    });

    chatSessionRuntimeManager.updateLastAppliedStreamId('local-1', '1710000000000-1');

    expect(chatSessionRuntimeManager.getBySession('s1')?.lastAppliedStreamId).toBe('1710000000000-1');
  });

  it('keeps multiple active lanes in the same session independent', () => {
    chatSessionRuntimeManager.register({
      clientRequestId: 'q1_a1',
      sessionId: 's1',
      laneId: 'lane-a',
      traceId: 'trace-a',
    });
    chatSessionRuntimeManager.register({
      clientRequestId: 'q1_a2',
      sessionId: 's1',
      laneId: 'lane-b',
      traceId: 'trace-b',
    });

    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(true);
    expect(chatSessionRuntimeManager.getAllBySession('s1')).toHaveLength(2);
    expect(chatSessionRuntimeManager.getByLane('s1', 'lane-b')?.clientRequestId).toBe('q1_a2');
    expect(chatSessionRuntimeManager.getByTrace('s1', 'trace-a')?.clientRequestId).toBe('q1_a1');

    chatSessionRuntimeManager.complete('q1_a1');

    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(true);
    expect(chatSessionRuntimeManager.getAllBySession('s1')).toHaveLength(1);
    expect(chatSessionRuntimeManager.getByLane('s1', 'lane-b')?.clientRequestId).toBe('q1_a2');

    chatSessionRuntimeManager.complete('q1_a2');

    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(false);
  });

  it('tracks whether any active request in a session is waiting for user input', () => {
    chatSessionRuntimeManager.register({
      clientRequestId: 'q1_a1',
      sessionId: 'pending_q1_a1',
    });
    chatSessionRuntimeManager.bindSession('q1_a1', 's1');

    chatSessionRuntimeManager.setWaitingForUserInput('q1_a1', true);

    expect(chatSessionRuntimeManager.isSessionWaitingForUserInput('pending_q1_a1')).toBe(true);
    expect(chatSessionRuntimeManager.isSessionWaitingForUserInput('s1')).toBe(true);

    chatSessionRuntimeManager.setSessionWaitingForUserInput('s1', false);
    expect(chatSessionRuntimeManager.isSessionWaitingForUserInput('s1')).toBe(false);
  });

  it('tracks a generic server-projected session runtime without a local request', () => {
    chatSessionRuntimeManager.applySessionRuntime({
      sessionId: 's1',
      source: 'integration-a',
      traceId: 'trace-1',
      status: 'running',
      activeAgentCount: 3,
      activeChildCount: 2,
      waitingInteractionCount: 0,
      revision: 4,
      changedAt: 1000,
    });

    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(true);
    expect(chatSessionRuntimeManager.getSessionRuntime('s1')).toMatchObject({
      status: 'running',
      activeAgentCount: 3,
      activeChildCount: 2,
      revision: 4,
    });

    // Same source/trace cannot move backwards, even if a delayed terminal event arrives.
    chatSessionRuntimeManager.applySessionRuntime({
      sessionId: 's1',
      source: 'integration-a',
      traceId: 'trace-1',
      status: 'idle',
      activeAgentCount: 0,
      activeChildCount: 0,
      waitingInteractionCount: 0,
      revision: 3,
      changedAt: 2000,
    });
    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(true);

    chatSessionRuntimeManager.applySessionRuntime({
      sessionId: 's1',
      source: 'integration-a',
      traceId: 'trace-1',
      status: 'idle',
      activeAgentCount: 0,
      activeChildCount: 0,
      waitingInteractionCount: 0,
      revision: 5,
      changedAt: 3000,
    });
    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(false);
  });

  it('keeps aggregate team activity running while the captain can accept input', () => {
    chatSessionRuntimeManager.register({ clientRequestId: 'local-1', sessionId: 's1', traceId: 'trace-1' });
    chatSessionRuntimeManager.applySessionRuntime({
      sessionId: 's1',
      traceId: 'trace-1',
      status: 'running',
      activeAgentCount: 2,
      activeChildCount: 2,
      waitingInteractionCount: 0,
      rootActive: false,
      acceptingInput: true,
      revision: 2,
      changedAt: 2000,
    });

    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(true);
    expect(chatSessionRuntimeManager.getByClientRequest('local-1')).toBeDefined();
    expect(chatSessionRuntimeManager.canAcceptInput('s1')).toBe(true);
    chatSessionRuntimeManager.complete('local-1');
    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(true);
  });

  it('waits for the stream terminal before accepting the next employee turn', () => {
    chatSessionRuntimeManager.register({ clientRequestId: 'finishing', sessionId: 's1', traceId: 'trace-1' });
    chatSessionRuntimeManager.applySessionRuntime({
      sessionId: 's1',
      traceId: 'trace-1',
      source: 'test-engine',
      status: 'idle',
      activeAgentCount: 0,
      activeChildCount: 0,
      waitingInteractionCount: 0,
      rootActive: false,
      acceptingInput: true,
      revision: 2,
      changedAt: 2000,
    });
    expect(chatSessionRuntimeManager.canAcceptInput('s1')).toBe(false);
    chatSessionRuntimeManager.complete('finishing');
    expect(chatSessionRuntimeManager.canAcceptInput('s1')).toBe(true);
  });

  it('does not let an older trace hide a newer local turn', () => {
    chatSessionRuntimeManager.register({ clientRequestId: 'local-2', sessionId: 's1', traceId: 'trace-new' });
    chatSessionRuntimeManager.applySessionRuntime({
      sessionId: 's1',
      traceId: 'trace-old',
      status: 'idle',
      activeAgentCount: 0,
      activeChildCount: 0,
      waitingInteractionCount: 0,
      rootActive: false,
      acceptingInput: true,
      revision: 2,
      changedAt: 2000,
    });

    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(true);
    expect(chatSessionRuntimeManager.canAcceptInput('s1')).toBe(false);
  });

  it('uses explicit parent input readiness without hiding active child work', () => {
    chatSessionRuntimeManager.applySessionRuntime({
      sessionId: 's1',
      traceId: 'trace-1',
      status: 'running',
      activeAgentCount: 1,
      activeChildCount: 1,
      waitingInteractionCount: 0,
      acceptingInput: true,
      revision: 1,
      changedAt: 1000,
    });

    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(true);
    expect(chatSessionRuntimeManager.canAcceptInput('s1')).toBe(true);
  });

  it('falls back to the legacy running guard when input readiness is absent', () => {
    chatSessionRuntimeManager.applySessionRuntime({
      sessionId: 's1',
      traceId: 'trace-1',
      status: 'running',
      activeAgentCount: 1,
      activeChildCount: 0,
      waitingInteractionCount: 0,
      revision: 1,
      changedAt: 1000,
    });

    expect(chatSessionRuntimeManager.canAcceptInput('s1')).toBe(false);
    expect(chatSessionRuntimeManager.canAcceptInput('s2')).toBe(true);
  });

  describe('user-confirmed interaction override', () => {
    const waitingRuntime = {
      sessionId: 's1',
      traceId: 'trace-1',
      source: 'test-engine',
      status: 'waiting_user',
      activeAgentCount: 0,
      activeChildCount: 0,
      waitingInteractionCount: 1,
      revision: 3,
      changedAt: 1000,
    };

    it('converges the projected waiting state without forging the server projection', () => {
      chatSessionRuntimeManager.applySessionRuntime(waitingRuntime);
      expect(chatSessionRuntimeManager.isSessionWaitingForUserInput('s1')).toBe(true);

      chatSessionRuntimeManager.markWaitingForUserInputConfirmed('s1');

      expect(chatSessionRuntimeManager.isSessionWaitingForUserInput('s1')).toBe(false);
      // 覆盖位不得伪造/篡改来源 B：服务端投影原样保留（revision 未被抬高）。
      expect(chatSessionRuntimeManager.getSessionRuntime('s1')).toEqual(waitingRuntime);
    });

    it('releases the override once the runtime reports a newer turn, then shows the badge again', () => {
      chatSessionRuntimeManager.applySessionRuntime(waitingRuntime);
      chatSessionRuntimeManager.markWaitingForUserInputConfirmed('s1');
      expect(chatSessionRuntimeManager.isSessionWaitingForUserInput('s1')).toBe(false);

      // 外部运行时下发更新一轮（changedAt 晚于确认时间）的收敛态 → 覆盖位解除。
      expect(
        chatSessionRuntimeManager.applySessionRuntime({
          ...waitingRuntime,
          status: 'idle',
          waitingInteractionCount: 0,
          revision: 4,
          changedAt: Date.now() + 10,
        })
      ).toBe(true);
      expect(chatSessionRuntimeManager.isSessionWaitingForUserInput('s1')).toBe(false);

      // 覆盖位确已解除：再来的等待态必须重新显示标识（防「永不显示」）。
      expect(
        chatSessionRuntimeManager.applySessionRuntime({
          ...waitingRuntime,
          revision: 5,
          changedAt: Date.now() + 20,
        })
      ).toBe(true);
      expect(chatSessionRuntimeManager.isSessionWaitingForUserInput('s1')).toBe(true);
    });

    it('does not release the override for a stale frame rejected by the guard', () => {
      chatSessionRuntimeManager.applySessionRuntime(waitingRuntime);
      chatSessionRuntimeManager.markWaitingForUserInputConfirmed('s1');

      // 同 source/trace 且 revision 不前进 → 守卫拒绝，覆盖位不得被解除。
      expect(
        chatSessionRuntimeManager.applySessionRuntime({
          ...waitingRuntime,
          status: 'idle',
          waitingInteractionCount: 0,
          revision: 3,
          changedAt: Date.now() + 10,
        })
      ).toBe(false);
      expect(chatSessionRuntimeManager.isSessionWaitingForUserInput('s1')).toBe(false);
    });

    it('keeps the local pending interaction authoritative over the override', () => {
      chatSessionRuntimeManager.register({ clientRequestId: 'req', sessionId: 's1', traceId: 'trace-1' });
      chatSessionRuntimeManager.applySessionRuntime(waitingRuntime);
      chatSessionRuntimeManager.markWaitingForUserInputConfirmed('s1');
      expect(chatSessionRuntimeManager.isSessionWaitingForUserInput('s1')).toBe(false);

      // 本端出现新的未处理交互（来源 A）→ 覆盖位不得把它压掉。
      chatSessionRuntimeManager.setWaitingForUserInput('req', true);
      expect(chatSessionRuntimeManager.isSessionWaitingForUserInput('s1')).toBe(true);
    });

    it('drops the override when the turn is cancelled', () => {
      chatSessionRuntimeManager.register({ clientRequestId: 'req', sessionId: 's1', traceId: 'trace-1' });
      chatSessionRuntimeManager.applySessionRuntime(waitingRuntime);
      chatSessionRuntimeManager.markWaitingForUserInputConfirmed('s1');
      expect(chatSessionRuntimeManager.isSessionWaitingForUserInput('s1')).toBe(false);

      chatSessionRuntimeManager.cancel('req', 's1');

      // 覆盖位已清除：新 trace 的等待态必须重新显示标识。
      expect(
        chatSessionRuntimeManager.applySessionRuntime({
          ...waitingRuntime,
          traceId: 'trace-2',
          revision: 1,
          changedAt: Date.now() + 100,
        })
      ).toBe(true);
      expect(chatSessionRuntimeManager.isSessionWaitingForUserInput('s1')).toBe(true);
    });

    it('keeps the badge hidden after a refresh once the authoritative state converged', () => {
      chatSessionRuntimeManager.applySessionRuntime(waitingRuntime);
      chatSessionRuntimeManager.markWaitingForUserInputConfirmed('s1');
      expect(chatSessionRuntimeManager.isSessionWaitingForUserInput('s1')).toBe(false);

      // 刷新：本地内存全清（覆盖位随之消失）。
      chatSessionRuntimeManager.clear();
      // 回读的是后端已收敛的投影。
      chatSessionRuntimeManager.applySessionRuntime({
        ...waitingRuntime,
        status: 'idle',
        waitingInteractionCount: 0,
        revision: 4,
        changedAt: Date.now() + 10,
      });

      expect(chatSessionRuntimeManager.isSessionWaitingForUserInput('s1')).toBe(false);
    });

    it('converges the badge for a multi-agent lane registration', () => {
      chatSessionRuntimeManager.register({
        clientRequestId: 'lane-req',
        sessionId: 'pending_lane-req',
        laneId: 'lane-1',
        turnId: 'turn-1',
        traceId: 'trace-lane',
      });
      chatSessionRuntimeManager.applySessionRuntime({
        ...waitingRuntime,
        sessionId: 'pending_lane-req',
        traceId: 'trace-lane',
      });
      expect(chatSessionRuntimeManager.isSessionWaitingForUserInput('pending_lane-req')).toBe(true);

      chatSessionRuntimeManager.markWaitingForUserInputConfirmed('pending_lane-req');

      expect(chatSessionRuntimeManager.isSessionWaitingForUserInput('pending_lane-req')).toBe(false);
    });
  });
});
