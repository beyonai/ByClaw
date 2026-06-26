import { cacheTroubleshootSession, getCachedTroubleshootSession } from './sessionCache';

describe('troubleshoot session cache', () => {
  it('returns the cached session id by trace id', () => {
    cacheTroubleshootSession('trace-cache-hit', 'session-cache-hit');

    expect(getCachedTroubleshootSession('trace-cache-hit')).toBe('session-cache-hit');
  });

  it('ignores empty trace id and session id', () => {
    cacheTroubleshootSession('', 'session-empty-trace');
    cacheTroubleshootSession('trace-empty-session', '');

    expect(getCachedTroubleshootSession('')).toBeUndefined();
    expect(getCachedTroubleshootSession('trace-empty-session')).toBeUndefined();
  });
});
