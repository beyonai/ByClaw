const mockPost = jest.fn();
jest.mock('../chatChainTransport', () => ({ sendChatChainBatch: (...args: any[]) => mockPost(...args) }));

describe('chat delivery diagnostics', () => {
  let logger: typeof import('../chatChainLog');
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    localStorage.clear();
    mockPost.mockReset().mockResolvedValue({});
    logger = require('../chatChainLog');
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });
  it('uses root request identity across lane frames and accepts string payloads', () => {
    const frame = {
      clientRequestId: 'lane',
      metadata: { requestId: 'root' },
      event: 'appStreamResponse',
      data: JSON.stringify({ sessionId: 'session' }),
    };
    expect(logger.isChatTerminal(frame)).toBe(true);
    expect(logger.chatChainFields(frame)).toMatchObject({ requestId: 'root', sessionId: 'session' });
    expect(logger.isChatTerminal({ event: 'reasoningLogDelta' })).toBe(false);
  });
  it('bounds offline storage and excludes message content and credentials', () => {
    for (let i = 0; i < 150; i++)
      logger.recordChatChain('fe.sent', { requestId: `root-${i}`, prompt: 'secret', token: 'secret' });
    const text = localStorage.getItem('byclaw.chat-chain.v1')!;
    expect(JSON.parse(text)).toHaveLength(100);
    expect(text).not.toContain('secret');
  });
  it('retains failed reports and removes only an acknowledged batch', async () => {
    logger.recordChatChain('fe.final_received', { requestId: 'root' });
    mockPost.mockRejectedValueOnce(new Error('offline'));
    await logger.flushChatChainLogs();
    expect(JSON.parse(localStorage.getItem('byclaw.chat-chain.v1')!)).toHaveLength(1);
    await logger.flushChatChainLogs();
    expect(JSON.parse(localStorage.getItem('byclaw.chat-chain.v1')!)).toHaveLength(0);
    expect(mockPost.mock.calls[1][0][0].stage).toBe('fe.final_received');
  });
  it('keeps disconnect diagnostics until every lane has applied its final message', async () => {
    logger.recordChatChain('fe.sent', { requestId: 'root', laneIds: ['a', 'b'] });
    logger.recordChatChain('fe.final_applied', { requestId: 'root', appliedClientRequestId: 'a' });
    logger.recordChatConnection(false);
    logger.recordChatConnection(true);
    logger.recordChatChain('fe.final_applied', { requestId: 'root', appliedClientRequestId: 'b' });
    logger.recordChatConnection(false);
    await logger.flushChatChainLogs();
    const stages = mockPost.mock.calls[0][0].map((item: any) => item.stage);
    expect(stages.filter((stage: string) => stage === 'fe.connection_closed')).toHaveLength(1);
    expect(stages).toContain('fe.connection_opened');
  });
  it('does not throw into rendering when storage is unavailable', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => logger.recordChatChain('fe.final_applied', { requestId: 'root' })).not.toThrow();
    spy.mockRestore();
  });
});
