import { act, render, screen } from '@testing-library/react';
import { getLocaleIntl } from '@/testUtils/localeIntl';
import SandboxLifetime, { formatSandboxLifetime, sandboxLifetime } from '../SandboxLifetime';

let mockLocale: 'zh-CN' | 'en-US' = 'zh-CN';
jest.mock('@umijs/max', () => ({
  useIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
}));

const start = Date.parse('2026-11-06T08:00:00Z');

it('accepts milliseconds, numeric strings, ISO and existing local date strings', () => {
  for (const createTime of [start, String(start), '2026-11-06T08:00:00Z']) {
    expect(sandboxLifetime({ createTime }, start + 61000)).toBe(61000);
  }
  const local = new Date(2026, 10, 6, 8).getTime();
  expect(sandboxLifetime({ createTime: '2026-11-06 08:00:00' }, local + 61000)).toBe(61000);
});

it.each([undefined, null, '', 0, -1, NaN, Infinity, 'not-a-date', '2026-02-31 08:00:00', '2026-11-06 25:00:00'])(
  'does not manufacture a lifetime from invalid creation time %p',
  (createTime) => expect(sandboxLifetime({ createTime }, start)).toBeUndefined()
);

it('stops at release time and refuses missing, invalid or negative released intervals', () => {
  expect(sandboxLifetime({ createTime: start, releaseTime: start + 61000, status: 'RELEASED' }, start + 120000)).toBe(
    61000
  );
  expect(sandboxLifetime({ createTime: start, status: 'RELEASED' }, start + 120000)).toBeUndefined();
  expect(sandboxLifetime({ createTime: start, releaseTime: 'bad', status: 'RELEASED' })).toBeUndefined();
  expect(sandboxLifetime({ createTime: start, releaseTime: start - 1, status: 'RELEASED' })).toBeUndefined();
  expect(sandboxLifetime({ createTime: start }, start - 1)).toBeUndefined();
});

it.each([
  [0, '0秒', '0s'],
  [59000, '59秒', '59s'],
  [60000, '1分 0秒', '1m 0s'],
  [3600000, '1小时 0分 0秒', '1h 0m 0s'],
  [90061000, '1天 1小时 1分 1秒', '1d 1h 1m 1s'],
])('formats %p milliseconds with accurate localized unit boundaries', (duration, zh, en) => {
  expect(formatSandboxLifetime(duration, getLocaleIntl('zh-CN'))).toBe(zh);
  expect(formatSandboxLifetime(duration, getLocaleIntl('en-US'))).toBe(en);
});

it('keeps invalid formatter inputs empty', () => {
  for (const value of [undefined, -1, NaN, Infinity]) expect(formatSandboxLifetime(value, getLocaleIntl())).toBe('-');
});

it('updates locally every second, stops when released and cleans up its timer', () => {
  jest.useFakeTimers().setSystemTime(start + 59000);
  const interval = jest.spyOn(window, 'setInterval');
  const clear = jest.spyOn(window, 'clearInterval');
  try {
    mockLocale = 'en-US';
    const { rerender, unmount } = render(<SandboxLifetime record={{ createTime: start, status: 'RUNNING' }} />);
    expect(screen.getByText('59s')).toBeInTheDocument();
    expect(interval).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(1000));
    expect(screen.getByText('1m 0s')).toBeInTheDocument();
    rerender(<SandboxLifetime record={{ createTime: start, releaseTime: start + 60000, status: 'RELEASED' }} />);
    expect(clear).toHaveBeenCalledWith(interval.mock.results[0].value);
    act(() => jest.advanceTimersByTime(60000));
    expect(screen.getByText('1m 0s')).toBeInTheDocument();
    expect(interval).toHaveBeenCalledTimes(1);
    unmount();
  } finally {
    mockLocale = 'zh-CN';
    interval.mockRestore();
    clear.mockRestore();
    jest.useRealTimers();
  }
});
