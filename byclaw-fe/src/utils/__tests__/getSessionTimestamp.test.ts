import getSessionTimestamp from '../getSessionTimestamp';

describe('getSessionTimestamp', () => {
  it.each([
    '2026-11-02 17:24:11',
    '2026-11-02T17:24:11',
    '2026-11-02T17:24:11+08:00',
    '2026-11-02T09:24:11Z',
    '2026-11-02T01:24:11-08:00',
    String(Date.parse('2026-11-02T09:24:11Z')),
    Date.parse('2026-11-02T09:24:11Z'),
  ])('parses %s as the same instant regardless of the computer timezone', (value) => {
    expect(getSessionTimestamp(value)).toBe(Date.parse('2026-11-02T09:24:11Z'));
  });

  it('preserves milliseconds and the explicit timezone of tenant session dates', () => {
    expect(getSessionTimestamp('2026-11-02 17:24:11.125')).toBe(Date.parse('2026-11-02T09:24:11.125Z'));
    expect(getSessionTimestamp('2026-11-02T17:24:11.125Z')).toBe(Date.parse('2026-11-02T17:24:11.125Z'));
  });

  it('allows message sorting to put unknown times last without treating the epoch as missing', () => {
    expect(getSessionTimestamp(undefined, Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(getSessionTimestamp('invalid', Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(getSessionTimestamp('1970-01-01T00:00:00Z', Number.MAX_SAFE_INTEGER)).toBe(0);
  });

  it('keeps the captured session ages distinct instead of treating all API dates as future times', () => {
    const capturedAt = Date.parse('2026-11-02T10:00:29Z');
    const dates = ['2026-11-02 17:24:11', '2026-11-02 17:10:47', '2026-11-02 16:31:21'];

    expect(dates.map((value) => Math.floor((capturedAt - getSessionTimestamp(value)) / 60000))).toEqual([36, 49, 89]);
  });

  it.each([undefined, null, '', ' ', 'invalid', Number.NaN, Number.POSITIVE_INFINITY])(
    'does not interpret missing or invalid time %s as the current time',
    (value) => {
      expect(getSessionTimestamp(value)).toBe(0);
    }
  );
});
