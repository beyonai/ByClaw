import { getRecentTaskDateRange, getTaskDateRangePresets } from '../taskDatePresets';

describe('getTaskDateRangePresets', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 6, 23, 12));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses inclusive natural-day ranges for each quick filter', () => {
    const presets = getTaskDateRangePresets((id) => id);

    expect(presets.map((preset) => preset.label)).toEqual([
      'projectSpace.taskDatePreset.today',
      'projectSpace.taskDatePreset.recent7Days',
      'projectSpace.taskDatePreset.recent14Days',
      'projectSpace.taskDatePreset.recent30Days',
      'projectSpace.taskDatePreset.currentWeek',
      'projectSpace.taskDatePreset.currentMonth',
      'projectSpace.taskDatePreset.currentQuarter',
      'projectSpace.taskDatePreset.currentYear',
    ]);
    expect(presets[0].value[0].format('YYYY-MM-DD HH:mm:ss')).toBe('2026-07-23 00:00:00');
    expect(presets[1].value[0].format('YYYY-MM-DD HH:mm:ss')).toBe('2026-07-17 00:00:00');
    expect(presets[2].value[0].format('YYYY-MM-DD HH:mm:ss')).toBe('2026-07-10 00:00:00');
    expect(presets[3].value[0].format('YYYY-MM-DD HH:mm:ss')).toBe('2026-06-24 00:00:00');
    expect(presets[4].value[0].format('YYYY-MM-DD HH:mm:ss')).toBe('2026-07-20 00:00:00');
    expect(presets[4].value[1].format('YYYY-MM-DD HH:mm:ss')).toBe('2026-07-26 23:59:59');
    expect(presets[5].value[0].format('YYYY-MM-DD HH:mm:ss')).toBe('2026-07-01 00:00:00');
    expect(presets[6].value[0].format('YYYY-MM-DD HH:mm:ss')).toBe('2026-07-01 00:00:00');
    expect(presets[6].value[1].format('YYYY-MM-DD HH:mm:ss')).toBe('2026-09-30 23:59:59');
    expect(presets[7].value[0].format('YYYY-MM-DD HH:mm:ss')).toBe('2026-01-01 00:00:00');
    expect(presets[7].value[1].format('YYYY-MM-DD HH:mm:ss')).toBe('2026-12-31 23:59:59');
  });

  it('uses the same inclusive range for the recent-seven-days default', () => {
    const recentSevenDays = getRecentTaskDateRange(7);

    expect(recentSevenDays[0].format('YYYY-MM-DD HH:mm:ss')).toBe('2026-07-17 00:00:00');
    expect(recentSevenDays[1].format('YYYY-MM-DD HH:mm:ss')).toBe('2026-07-23 23:59:59');
  });
});
