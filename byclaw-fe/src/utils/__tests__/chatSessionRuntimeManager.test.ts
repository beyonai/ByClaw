import { chatSessionRuntimeManager } from '../chatSessionRuntimeManager';

describe('utils/chatSessionRuntimeManager', () => {
  beforeEach(() => {
    chatSessionRuntimeManager.clear();
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

  it('keeps local and server-projected runtime lifecycles independent', () => {
    chatSessionRuntimeManager.register({ clientRequestId: 'local-1', sessionId: 's1' });
    chatSessionRuntimeManager.applySessionRuntime({
      sessionId: 's1',
      traceId: 'trace-1',
      status: 'idle',
      activeAgentCount: 0,
      activeChildCount: 0,
      waitingInteractionCount: 0,
      revision: 2,
      changedAt: 2000,
    });

    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(true);
    chatSessionRuntimeManager.complete('local-1');
    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(false);
  });
});
