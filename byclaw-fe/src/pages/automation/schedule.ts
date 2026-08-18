import dayjs, { type Dayjs } from 'dayjs';
import type { AutomationChatConfig, AutomationFormValues, AutomationScheduleConfig, AutomationSource } from './types';

export const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

export const parseAutomationConfig = (config?: string): AutomationChatConfig => {
  if (!config) return { chatContent: '', resourceList: [] };
  try {
    const parsed = JSON.parse(config);
    if (!parsed || typeof parsed !== 'object') return { chatContent: '', resourceList: [] };
    return {
      ...parsed,
      chatContent: parsed.chatContent || '',
      resourceList: Array.isArray(parsed.resourceList) ? parsed.resourceList : [],
    };
  } catch {
    return { chatContent: '', resourceList: [] };
  }
};

const parseLegacyCron = (cronExpr?: string): AutomationScheduleConfig | undefined => {
  if (!cronExpr) return undefined;
  const rawParts = cronExpr.trim().split(/\s+/);
  const parts = rawParts.length === 6 ? rawParts.slice(1) : rawParts;
  if (parts.length !== 5) return undefined;
  const [minute, hour, day, month, weekday] = parts;
  if (minute.startsWith('*/') && hour === '*') {
    return {
      mode: 'interval',
      intervalHours: 1,
      intervalWeekdays: [...ALL_WEEKDAYS],
    };
  }
  if (hour.startsWith('*/')) {
    return {
      mode: 'interval',
      intervalHours: Math.max(1, Number(hour.slice(2)) || 1),
      intervalWeekdays:
        weekday === '*' || weekday === '?' ? [...ALL_WEEKDAYS] : weekday.split(',').map(Number).filter(Boolean),
    };
  }
  const hourValue = Number(hour);
  const minuteValue = Number(minute);
  if (!Number.isFinite(hourValue) || !Number.isFinite(minuteValue)) return undefined;
  const time = `${`${hourValue}`.padStart(2, '0')}:${`${minuteValue}`.padStart(2, '0')}`;
  if (weekday !== '*' && weekday !== '?') {
    return {
      mode: 'periodic',
      periodType: 'weekly',
      time,
      weekdays: weekday.split(',').map(Number).filter(Boolean),
    };
  }
  if (month !== '*' && day !== '*') {
    return {
      mode: 'periodic',
      periodType: 'yearly',
      time,
      month: Number(month) || 1,
      monthDay: Number(day) || 1,
    };
  }
  if (day !== '*') {
    const monthDays = day
      .split(',')
      .map(Number)
      .filter((value) => Number.isFinite(value) && value >= 1 && value <= 31);
    return {
      mode: 'periodic',
      periodType: 'monthly',
      time,
      monthDay: monthDays[0] || 1,
      monthDays: monthDays.length ? monthDays : [1],
    };
  }
  return { mode: 'periodic', periodType: 'daily', time };
};

export const getAutomationSchedule = (source?: AutomationSource) =>
  parseAutomationConfig(source?.config).schedule || parseLegacyCron(source?.cronExpr);

const parseTime = (value?: string) => {
  if (!value) return dayjs().hour(9).minute(0).second(0);
  const [hour, minute] = value.split(':').map(Number);
  return dayjs()
    .hour(Number.isFinite(hour) ? hour : 9)
    .minute(Number.isFinite(minute) ? minute : 0)
    .second(0);
};

export const getAutomationFormInitialValues = (source?: AutomationSource): AutomationFormValues => {
  const config = parseAutomationConfig(source?.config);
  const schedule = config.schedule || parseLegacyCron(source?.cronExpr);
  return {
    sourceName: source?.sourceName || '',
    projectId: source?.projectId === undefined || source?.projectId === null ? undefined : `${source.projectId}`,
    scheduleMode: schedule?.mode || 'periodic',
    periodType: schedule?.periodType || 'daily',
    periodTime: parseTime(schedule?.time),
    periodWeekdays: schedule?.weekdays?.length ? schedule.weekdays : [...ALL_WEEKDAYS],
    periodMonth: schedule?.month || 1,
    periodMonthDay: schedule?.monthDay || 1,
    periodMonthDays: schedule?.monthDays?.length ? schedule.monthDays : [schedule?.monthDay || 1],
    intervalHours: schedule?.intervalHours || 1,
    intervalWeekdays: schedule?.intervalWeekdays?.length ? schedule.intervalWeekdays : [...ALL_WEEKDAYS],
    onceTime: schedule?.onceTime ? dayjs(schedule.onceTime) : dayjs().add(1, 'hour').startOf('minute'),
    effectiveDateRange:
      schedule?.effectiveStartDate && schedule?.effectiveEndDate
        ? [dayjs(schedule.effectiveStartDate), dayjs(schedule.effectiveEndDate)]
        : undefined,
  };
};

export const buildAutomationSchedule = (values: AutomationFormValues): AutomationScheduleConfig => {
  const [effectiveStartDate, effectiveEndDate] = values.effectiveDateRange || [];
  const base = {
    mode: values.scheduleMode,
    effectiveStartDate: effectiveStartDate?.format('YYYY-MM-DD'),
    effectiveEndDate: effectiveEndDate?.format('YYYY-MM-DD'),
  };
  if (values.scheduleMode === 'once') {
    return {
      ...base,
      onceTime: values.onceTime?.format('YYYY-MM-DD HH:mm:ss'),
    };
  }
  if (values.scheduleMode === 'interval') {
    return {
      ...base,
      intervalHours: Math.max(1, Number(values.intervalHours) || 1),
      intervalWeekdays: values.intervalWeekdays?.length ? values.intervalWeekdays : [...ALL_WEEKDAYS],
    };
  }
  return {
    ...base,
    periodType: values.periodType || 'daily',
    time: values.periodTime?.format('HH:mm') || '09:00',
    weekdays: values.periodWeekdays,
    month: values.periodMonth,
    monthDay: values.periodMonthDay,
    monthDays:
      values.periodType === 'monthly'
        ? Array.from(
          new Set(
            (values.periodMonthDays?.length ? values.periodMonthDays : [values.periodMonthDay || 1]).map(Number)
          )
        )
          .filter((day) => Number.isFinite(day) && day >= 1 && day <= 31)
          .sort((left, right) => left - right)
        : undefined,
  };
};

export const buildAutomationCron = (schedule: AutomationScheduleConfig) => {
  if (schedule.mode === 'once') {
    const value = dayjs(schedule.onceTime);
    return value.isValid() ? `${value.minute()} ${value.hour()} ${value.date()} ${value.month() + 1} *` : undefined;
  }
  if (schedule.mode === 'interval') {
    const weekdays = schedule.intervalWeekdays?.length ? schedule.intervalWeekdays.join(',') : '*';
    // Cron 每小时提供候选触发点，真实的无限小时跨度由结构化配置和 lastScanTime 控制。
    return `0 * * * ${weekdays}`;
  }
  const value = parseTime(schedule.time);
  if (schedule.periodType === 'weekly' || schedule.periodType === 'biweekly') {
    const weekdays = schedule.weekdays?.length ? schedule.weekdays.join(',') : '*';
    return `${value.minute()} ${value.hour()} * * ${weekdays}`;
  }
  if (schedule.periodType === 'yearly') {
    const month = Math.min(12, Math.max(1, Number(schedule.month) || 1));
    const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    const monthDay = Math.min(maxDay, Math.max(1, Number(schedule.monthDay) || 1));
    return `${value.minute()} ${value.hour()} ${monthDay} ${month} *`;
  }
  if (schedule.periodType === 'monthly') {
    const monthDays = schedule.monthDays?.length ? schedule.monthDays : [schedule.monthDay || 1];
    return `${value.minute()} ${value.hour()} ${monthDays.join(',')} * *`;
  }
  return `${value.minute()} ${value.hour()} * * *`;
};

export const isAutomationEnabled = (source: AutomationSource) =>
  source.enabled === '1' || source.enabled === 1 || source.enabled === true;

export type AutomationListGroup = 'running' | 'current' | 'paused';

export const getAutomationListGroup = (source: AutomationSource): AutomationListGroup => {
  if (!isAutomationEnabled(source)) return 'paused';
  if (source.running === true) return 'running';
  return ['running', 'in_progress', 'executing', 'pending'].includes(`${source.status || ''}`.toLowerCase())
    ? 'running'
    : 'current';
};

export const getNextRunTime = (source: AutomationSource) => {
  if (!isAutomationEnabled(source)) return null;
  const schedule = getAutomationSchedule(source);
  if (!schedule) return null;
  const now = dayjs();
  if (schedule.mode === 'once') {
    const onceTime = dayjs(schedule.onceTime);
    return onceTime.isValid() && onceTime.isAfter(now) ? onceTime : null;
  }
  if (schedule.mode === 'interval') {
    const lastRun = dayjs(source.lastScanTime);
    return lastRun.isValid()
      ? lastRun.add(schedule.intervalHours || 1, 'hour')
      : now.add(schedule.intervalHours || 1, 'hour');
  }
  const time = parseTime(schedule.time);
  if (schedule.periodType === 'yearly') {
    const month = Math.min(12, Math.max(1, schedule.month || 1));
    const monthDay = Math.max(1, schedule.monthDay || 1);
    for (let yearOffset = 0; yearOffset <= 8; yearOffset += 1) {
      const year = now.year() + yearOffset;
      const base = dayjs()
        .year(year)
        .month(month - 1)
        .date(monthDay);
      if (base.month() !== month - 1 || base.date() !== monthDay) continue;
      const candidate = base.hour(time.hour()).minute(time.minute()).second(0);
      if (candidate.isAfter(now)) return candidate;
    }
    return null;
  }
  if (schedule.periodType === 'monthly') {
    const monthDays = schedule.monthDays?.length ? schedule.monthDays : [schedule.monthDay || 1];
    const getCandidate = (month: Dayjs) =>
      monthDays
        .map((day) => month.date(Math.min(day, month.daysInMonth())).hour(time.hour()).minute(time.minute()).second(0))
        .sort((left, right) => left.valueOf() - right.valueOf())
        .find((candidate) => candidate.isAfter(now));
    return getCandidate(now) || getCandidate(now.add(1, 'month')) || null;
  }
  if ((schedule.periodType === 'weekly' || schedule.periodType === 'biweekly') && schedule.weekdays?.length) {
    const anchor = dayjs(schedule.effectiveStartDate || source.createTime || now)
      .startOf('week')
      .add(1, 'day');
    const maxOffset = schedule.periodType === 'biweekly' ? 14 : 7;
    for (let offset = 0; offset <= maxOffset; offset += 1) {
      const candidate = now.add(offset, 'day').hour(time.hour()).minute(time.minute()).second(0);
      const weekday = candidate.day() === 0 ? 7 : candidate.day();
      const weekOffset = candidate.startOf('week').add(1, 'day').diff(anchor, 'week');
      const matchesCycle = schedule.periodType !== 'biweekly' || (weekOffset >= 0 && weekOffset % 2 === 0);
      if (matchesCycle && schedule.weekdays.includes(weekday) && candidate.isAfter(now)) return candidate;
    }
  }
  const today = now.hour(time.hour()).minute(time.minute()).second(0);
  return today.isAfter(now) ? today : today.add(1, 'day');
};
