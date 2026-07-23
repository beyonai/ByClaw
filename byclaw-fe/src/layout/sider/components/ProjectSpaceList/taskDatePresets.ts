import dayjs, { type Dayjs } from 'dayjs';

export type TaskDateRange = [Dayjs | null, Dayjs | null] | null;

type TaskDatePreset = {
  label: string;
  value: [Dayjs, Dayjs];
};

// 近 N 天包含当天，开始日期按自然日零点计算，保证默认查询与快捷项口径一致。
export const getRecentTaskDateRange = (days: number): [Dayjs, Dayjs] => {
  const now = dayjs();
  return [now.subtract(days - 1, 'day').startOf('day'), now.endOf('day')];
};

// 两个任务入口共用同一自然日范围，避免快捷筛选的起止边界出现不一致。
export const getTaskDateRangePresets = (formatMessage: (id: string) => string): TaskDatePreset[] => {
  const now = dayjs();
  const todayStart = now.startOf('day');
  const todayEnd = now.endOf('day');
  // 不依赖 dayjs 的语言周起始日配置，明确按周一到周日计算本周范围。
  const currentWeekStart = now.subtract((now.day() + 6) % 7, 'day').startOf('day');
  const currentQuarterStart = now.month(Math.floor(now.month() / 3) * 3).startOf('month');

  return [
    {
      label: formatMessage('projectSpace.taskDatePreset.today'),
      value: [todayStart, todayEnd],
    },
    {
      label: formatMessage('projectSpace.taskDatePreset.recent7Days'),
      value: getRecentTaskDateRange(7),
    },
    {
      label: formatMessage('projectSpace.taskDatePreset.recent14Days'),
      value: getRecentTaskDateRange(14),
    },
    {
      label: formatMessage('projectSpace.taskDatePreset.recent30Days'),
      value: getRecentTaskDateRange(30),
    },
    {
      label: formatMessage('projectSpace.taskDatePreset.currentWeek'),
      value: [currentWeekStart, currentWeekStart.add(6, 'day').endOf('day')],
    },
    {
      label: formatMessage('projectSpace.taskDatePreset.currentMonth'),
      value: [now.startOf('month'), now.endOf('month')],
    },
    {
      label: formatMessage('projectSpace.taskDatePreset.currentQuarter'),
      value: [currentQuarterStart, currentQuarterStart.add(2, 'month').endOf('month')],
    },
    {
      label: formatMessage('projectSpace.taskDatePreset.currentYear'),
      value: [now.startOf('year'), now.endOf('year')],
    },
  ];
};
