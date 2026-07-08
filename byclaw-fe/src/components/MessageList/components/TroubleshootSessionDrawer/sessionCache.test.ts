import { cacheTroubleshootSession, getCachedTroubleshootSession } from './sessionCache';

describe('troubleshoot session cache', () => {
  it('returns the cached session id by trace id', () => {
    cacheTroubleshootSession({
      traceId: 'trace-cache-hit',
      sessionId: 'session-cache-hit',
    });

    expect(getCachedTroubleshootSession({ traceId: 'trace-cache-hit' })).toBe('session-cache-hit');
  });

  it('returns the cached session id by message id', () => {
    cacheTroubleshootSession({
      messageId: 'message-cache-hit',
      sessionId: 'session-from-message',
    });

    expect(getCachedTroubleshootSession({ messageId: 'message-cache-hit' })).toBe('session-from-message');
  });

  it('prefers the cached session id by message id', () => {
    cacheTroubleshootSession({
      traceId: 'trace-fallback',
      sessionId: 'session-from-trace',
    });
    cacheTroubleshootSession({
      messageId: 'message-priority',
      sessionId: 'session-from-message-priority',
    });

    expect(
      getCachedTroubleshootSession({
        messageId: 'message-priority',
        traceId: 'trace-fallback',
      })
    ).toBe('session-from-message-priority');
  });

  it('ignores empty trace id, message id and session id', () => {
    cacheTroubleshootSession({
      sessionId: 'session-without-key',
    });
    cacheTroubleshootSession({
      traceId: 'trace-empty-session',
      sessionId: '',
    });
    cacheTroubleshootSession({
      messageId: 'message-empty-session',
      sessionId: '',
    });

    expect(getCachedTroubleshootSession({})).toBeUndefined();
    expect(getCachedTroubleshootSession({ traceId: 'trace-empty-session' })).toBeUndefined();
    expect(getCachedTroubleshootSession({ messageId: 'message-empty-session' })).toBeUndefined();
  });
});
