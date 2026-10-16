import { isSameSessionId, normalizeSessionId } from '../sessionId';
import type { SessionIdInput } from '../sessionId';

describe('session ID boundaries', () => {
  it.each<[SessionIdInput, string]>([
    [11273602, '11273602'],
    ['11273602', '11273602'],
    ['local-session-1', 'local-session-1'],
    [0, '0'],
    [null, ''],
    [undefined, ''],
    ['', ''],
  ])('normalizes %p to %p', (input, expected) => {
    expect(normalizeSessionId(input)).toBe(expected);
  });

  it.each<[SessionIdInput, SessionIdInput, boolean]>([
    [11273602, 11273602, true],
    ['11273602', '11273602', true],
    [11273602, '11273602', true],
    ['11273602', 11273602, true],
    [11273602, '11273603', false],
    ['', '', false],
    [null, undefined, false],
    [undefined, 'undefined', false],
    [null, 'null', false],
  ])('compares %p and %p as %p', (left, right, expected) => {
    expect(isSameSessionId(left, right)).toBe(expected);
  });
});
