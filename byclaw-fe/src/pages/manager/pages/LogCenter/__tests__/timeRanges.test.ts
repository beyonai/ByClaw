import dayjs from 'dayjs';
import { getTimePresets } from '../timeRanges';

describe('log time presets', () => {
  const now = dayjs('2026-11-12T14:30:00');

  it('uses complete calendar days for yesterday', () => {
    const preset = getTimePresets(now).find(({ label }) => label === '昨天')!;
    expect(preset.range.map((value) => value.format('YYYY-MM-DD HH:mm:ss'))).toEqual([
      '2026-11-11 00:00:00',
      '2026-11-12 00:00:00',
    ]);
    expect(preset.disabled).toBe(false);
  });

  it('starts the current week on Monday and respects the upstream limit', () => {
    const preset = getTimePresets(now).find(({ label }) => label === '本周')!;
    expect(preset.range[0].format('YYYY-MM-DD')).toBe('2026-11-09');
    expect(preset.disabled).toBe(true);
  });

  it('enables the last 24 hours while disabling longer ranges', () => {
    expect(getTimePresets(now).find(({ label }) => label === '1天')?.disabled).toBe(false);
    expect(getTimePresets(now).find(({ label }) => label === '30天')?.disabled).toBe(true);
  });
});
