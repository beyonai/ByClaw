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
});
