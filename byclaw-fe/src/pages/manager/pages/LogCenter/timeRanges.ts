import dayjs, { type Dayjs } from 'dayjs';

export type TimeRange = [Dayjs, Dayjs];

export const MAX_RANGE_SECONDS = 86400;

export const getTimePresets = (now = dayjs()) => {
  const today = now.startOf('day');
  const week = today.subtract((today.day() + 6) % 7, 'day');
  const month = now.startOf('month');
  const quarter = month.subtract(month.month() % 3, 'month');
  const ranges: { label: string; range: TimeRange }[] = [
    { label: '1分钟', range: [now.subtract(1, 'minute'), now] },
    { label: '5分钟', range: [now.subtract(5, 'minute'), now] },
    { label: '15分钟', range: [now.subtract(15, 'minute'), now] },
    { label: '1小时', range: [now.subtract(1, 'hour'), now] },
    { label: '4小时', range: [now.subtract(4, 'hour'), now] },
    { label: '1天', range: [now.subtract(1, 'day'), now] },
    { label: '今天', range: [today, now] },
    { label: '昨天', range: [today.subtract(1, 'day'), today] },
    { label: '前天', range: [today.subtract(2, 'day'), today.subtract(1, 'day')] },
    { label: '1周', range: [now.subtract(1, 'week'), now] },
    { label: '本周', range: [week, now] },
    { label: '上周', range: [week.subtract(1, 'week'), week] },
    { label: '30天', range: [now.subtract(30, 'day'), now] },
    { label: '本月', range: [month, now] },
    { label: '上月', range: [month.subtract(1, 'month'), month] },
    { label: '本季度', range: [quarter, now] },
    { label: '本年度', range: [now.startOf('year'), now] },
  ];
  return ranges.map((preset) => ({
    ...preset,
    disabled: preset.range[1].unix() - preset.range[0].unix() > MAX_RANGE_SECONDS,
  }));
};
